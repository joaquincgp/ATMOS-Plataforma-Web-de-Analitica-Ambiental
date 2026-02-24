from __future__ import annotations

from collections.abc import Iterable, Iterator
from datetime import datetime, timezone
from pathlib import Path
import re
import shutil
import zipfile

from bs4 import BeautifulSoup
import httpx
import pandas as pd
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.init_db import init_db
from app.models.etl_run import EtlRun
from app.models.measurement import Measurement
from app.models.source_file import SourceFile
from app.models.station import Station
from app.models.variable import Variable
from app.services.etl.contracts import NormalizedMeasurementRow
from app.services.etl.helpers import (
    compute_record_hash,
    compute_sha256,
    guess_unit,
    normalize_text,
    normalize_variable_code,
    parse_datetime,
)

FILE_SUFFIXES = (".rar", ".zip", ".xlsx", ".xls")
MANUAL_FILE_SUFFIXES = (".csv", ".xlsx", ".txt")
REMMAQ_VARIABLE_CODES = (
    "CO",
    "NO2",
    "O3",
    "PM25",
    "PM10",
    "SO2",
    "DIR",
    "HUM",
    "IUV",
    "LLU",
    "PRE",
    "RS",
    "TMP",
    "VEL",
)
REMMAQ_VARIABLE_HINTS: dict[str, tuple[str, ...]] = {
    "CO": ("monoxido_carbono",),
    "NO2": ("dioxido_de_nitrogeno",),
    "O3": ("ozono",),
    "PM25": ("pm25", "particulas_menores_a_25", "particulas_menores_a_2_5"),
    "PM10": ("pm10", "particulas_menores_a_10", "particulas_menores_a_10_micrometros"),
    "SO2": ("dioxido_de_azufre",),
    "DIR": ("direccion_del_viento",),
    "HUM": ("humedad_relativa",),
    "IUV": ("radiacion_ultravioleta",),
    "LLU": ("precipitacion",),
    "PRE": ("presion_barometrica",),
    "RS": ("radiacion_solar",),
    "TMP": ("temperatura_media",),
    "VEL": ("velocidad_del_viento",),
}
REMMAQ_VARIABLE_ALIASES: dict[str, str] = {
    "co": "CO",
    "no2": "NO2",
    "o3": "O3",
    "pm25": "PM25",
    "pm2.5": "PM25",
    "pm10": "PM10",
    "so2": "SO2",
    "dir": "DIR",
    "hum": "HUM",
    "iuv": "IUV",
    "llu": "LLU",
    "pre": "PRE",
    "rs": "RS",
    "tmp": "TMP",
    "vel": "VEL",
}
STATION_COLUMNS = (
    "station",
    "station_id",
    "station_code",
    "estacion",
    "id_estacion",
    "codigo_estacion",
    "cod_estacion",
)
DATETIME_COLUMNS = (
    "timestamp",
    "datetime",
    "date_time",
    "fecha_hora",
    "fechahora",
)
DATE_COLUMNS = ("date", "fecha")
TIME_COLUMNS = ("time", "hora")
VARIABLE_COLUMNS = ("variable", "pollutant", "contaminante", "parametro", "parameter")
VALUE_COLUMNS = ("value", "valor", "measurement", "medicion", "concentracion")
UNIT_COLUMNS = ("unit", "unidad", "units", "unidades")


class EtlService:
    def __init__(self, db: Session, settings: Settings | None = None):
        self.db = db
        self.settings = settings or get_settings()
        self.storage_root = Path(self.settings.etl_storage_dir)
        self.raw_dir = self.storage_root / "raw"
        self.extracted_dir = self.storage_root / "extracted"
        self._station_cache: dict[str, Station] = {}
        self._variable_cache: dict[str, Variable] = {}

    def initialize_database(self) -> dict[str, str]:
        init_db()
        return {
            "status": "initialized",
            "database": str(self.settings.database_url),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def list_runs(self, limit: int = 20) -> list[EtlRun]:
        statement = select(EtlRun).order_by(desc(EtlRun.started_at)).limit(limit)
        return list(self.db.scalars(statement).all())

    def sync_remmaq(
        self,
        *,
        force_reprocess: bool = False,
        variable_codes: list[str] | None = None,
        max_archives: int | None = None,
    ) -> EtlRun:
        run = self._create_run(trigger_type="automatic", source=self.settings.remmaq_base_url)
        normalized_variables = self._normalize_variable_selection(variable_codes)
        max_archives_effective = max_archives or self.settings.etl_sync_default_max_archives

        try:
            archives = self._discover_archive_urls(
                root_url=self.settings.remmaq_base_url,
                selected_variables=normalized_variables,
                max_archives=max_archives_effective,
            )
            run.archives_discovered = len(archives)
            run.details = {
                "selected_variables": normalized_variables,
                "max_archives": max_archives_effective,
                "stage": "discovered",
            }
            self.db.commit()

            for index, archive in enumerate(archives, start=1):
                run.details = {
                    "selected_variables": normalized_variables,
                    "max_archives": max_archives_effective,
                    "stage": "processing",
                    "current_archive": index,
                    "current_variable": archive["variable_code"],
                    "current_url": archive["url"],
                }
                self.db.commit()

                archive_url = archive["url"]
                content, filename = self._download_binary(archive_url)
                self._process_binary(
                    etl_run=run,
                    content=content,
                    original_name=filename,
                    source_type="automatic",
                    source_url=archive_url,
                    force_reprocess=force_reprocess,
                )

            run.status = "completed"
            run.finished_at = datetime.utcnow()
            run.details = {
                "selected_variables": normalized_variables,
                "max_archives": max_archives_effective,
                "stage": "completed",
            }
            self.db.commit()
            self.db.refresh(run)
            return run
        except Exception as exc:  # noqa: BLE001
            run.status = "failed"
            run.finished_at = datetime.utcnow()
            run.details = {"error": str(exc)}
            self.db.commit()
            self.db.refresh(run)
            raise

    def ingest_manual_file(self, *, filename: str, content: bytes, force_reprocess: bool = False) -> EtlRun:
        suffix = Path(filename).suffix.lower()
        if suffix not in MANUAL_FILE_SUFFIXES:
            allowed = ", ".join(MANUAL_FILE_SUFFIXES)
            raise ValueError(f"Formato de carga manual no soportado. Usa: {allowed}")

        run = self._create_run(trigger_type="manual", source="manual-upload")

        try:
            run.archives_discovered = 1
            self.db.commit()

            self._process_binary(
                etl_run=run,
                content=content,
                original_name=filename,
                source_type="manual",
                source_url=None,
                force_reprocess=force_reprocess,
            )

            run.status = "completed"
            run.finished_at = datetime.utcnow()
            self.db.commit()
            self.db.refresh(run)
            return run
        except Exception as exc:  # noqa: BLE001
            run.status = "failed"
            run.finished_at = datetime.utcnow()
            run.details = {"error": str(exc)}
            self.db.commit()
            self.db.refresh(run)
            raise

    def _create_run(self, *, trigger_type: str, source: str) -> EtlRun:
        run = EtlRun(trigger_type=trigger_type, source=source, status="running")
        self.db.add(run)
        self.db.commit()
        self.db.refresh(run)
        return run

    def _normalize_variable_selection(self, variable_codes: list[str] | None) -> list[str]:
        if not variable_codes:
            return list(REMMAQ_VARIABLE_CODES)

        normalized = [normalize_variable_code(code) for code in variable_codes]
        filtered = [code for code in normalized if code in REMMAQ_VARIABLE_CODES]
        if not filtered:
            raise ValueError(
                "No se recibieron variables válidas para REMMAQ. "
                f"Variables soportadas: {', '.join(REMMAQ_VARIABLE_CODES)}"
            )

        seen: set[str] = set()
        deduplicated: list[str] = []
        for code in filtered:
            if code in seen:
                continue
            deduplicated.append(code)
            seen.add(code)
        return deduplicated

    def _discover_archive_urls(
        self,
        *,
        root_url: str,
        selected_variables: list[str],
        max_archives: int,
    ) -> list[dict[str, str]]:
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.extracted_dir.mkdir(parents=True, exist_ok=True)

        discovered: list[dict[str, str]] = []
        discovered_urls: set[str] = set()
        selected_set = set(selected_variables)

        with httpx.Client(
            timeout=self.settings.etl_request_timeout_seconds,
            follow_redirects=True,
            headers={"User-Agent": self.settings.etl_user_agent},
        ) as client:
            response = client.get(root_url)
            response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")
        for anchor in soup.find_all("a", href=True):
            href = str(anchor["href"]).strip()
            if href.startswith(("javascript:", "mailto:")):
                continue

            text = anchor.get_text(separator=" ", strip=True)

            try:
                candidate = httpx.URL(root_url).join(href)
            except ValueError:
                continue

            if candidate.scheme not in {"http", "https"}:
                continue

            normalized_url = str(candidate.copy_with(fragment=None))
            if normalized_url in discovered_urls:
                continue

            if not normalized_url.lower().startswith(self.settings.remmaq_base_url.lower()):
                continue

            variable_code = self._match_remmaq_variable(text=text, href=href, full_url=normalized_url)
            if variable_code is None or variable_code not in selected_set:
                continue

            discovered.append(
                {
                    "url": normalized_url,
                    "label": text,
                    "variable_code": variable_code,
                }
            )
            discovered_urls.add(normalized_url)
            if len(discovered) >= max_archives:
                break

        if not discovered:
            raise RuntimeError("No se encontraron enlaces REMMAQ válidos en la página estática.")

        return discovered

    def _match_remmaq_variable(self, *, text: str, href: str, full_url: str) -> str | None:
        lower_text = text.lower()
        code_groups = re.findall(r"\(([a-z0-9\.\-]+)\)", lower_text)
        for raw_code in code_groups:
            normalized_code = raw_code.strip().replace("-", "")
            alias_match = REMMAQ_VARIABLE_ALIASES.get(normalized_code)
            if alias_match:
                return alias_match

        haystack = " ".join(
            [
                normalize_text(text),
                normalize_text(href),
                normalize_text(full_url),
            ]
        )

        for variable_code in REMMAQ_VARIABLE_CODES:
            hints = REMMAQ_VARIABLE_HINTS[variable_code]
            if any(hint in haystack for hint in hints):
                return variable_code
        return None

    def _download_binary(self, url: str) -> tuple[bytes, str]:
        with httpx.Client(
            timeout=self.settings.etl_request_timeout_seconds,
            follow_redirects=True,
            headers={"User-Agent": self.settings.etl_user_agent},
        ) as client:
            response = client.get(url)
            response.raise_for_status()

        filename = self._resolve_filename(url=url, response=response)
        return response.content, filename

    def _resolve_filename(self, *, url: str, response: httpx.Response) -> str:
        content_disposition = response.headers.get("content-disposition", "")
        filename = ""

        utf8_match = re.search(r"filename\*=UTF-8''([^;]+)", content_disposition, flags=re.IGNORECASE)
        if utf8_match:
            filename = utf8_match.group(1)
        else:
            basic_match = re.search(r'filename="?([^";]+)"?', content_disposition, flags=re.IGNORECASE)
            if basic_match:
                filename = basic_match.group(1)

        if not filename:
            filename = Path(httpx.URL(url).path).name or f"download-{datetime.utcnow().timestamp()}"

        clean_name = Path(filename).name
        suffix = Path(clean_name).suffix.lower()
        if suffix in FILE_SUFFIXES or suffix in MANUAL_FILE_SUFFIXES:
            return clean_name

        content_type = response.headers.get("content-type", "").lower()
        detected_suffix = self._detect_binary_suffix(content=response.content, content_type=content_type)
        return f"{clean_name}{detected_suffix}"

    def _detect_binary_suffix(self, *, content: bytes, content_type: str) -> str:
        if content.startswith(b"Rar!\x1a\x07"):
            return ".rar"
        if content.startswith(b"PK\x03\x04"):
            return ".zip"
        if "spreadsheetml" in content_type or "ms-excel" in content_type:
            return ".xlsx"
        return ".bin"

    def _process_binary(
        self,
        *,
        etl_run: EtlRun,
        content: bytes,
        original_name: str,
        source_type: str,
        source_url: str | None,
        force_reprocess: bool,
    ) -> None:
        checksum = compute_sha256(content)

        existing_file = self.db.scalar(
            select(SourceFile).where(SourceFile.checksum_sha256 == checksum, SourceFile.status == "completed")
        )
        if existing_file and not force_reprocess:
            etl_run.records_skipped += existing_file.row_count
            etl_run.archives_processed += 1
            self.db.commit()
            return

        safe_name = original_name.replace("/", "_").replace("\\", "_")
        archive_name = f"{checksum[:12]}-{safe_name}"
        archive_path = self.raw_dir / archive_name
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        archive_path.write_bytes(content)

        source_file = SourceFile(
            etl_run_id=etl_run.id,
            source_type=source_type,
            source_url=source_url,
            original_name=original_name,
            local_archive_path=str(archive_path),
            checksum_sha256=checksum,
            status="downloaded",
        )
        self.db.add(source_file)
        self.db.commit()
        self.db.refresh(source_file)

        extracted_path = self._extract_input_file(archive_path, checksum)
        source_file.extracted_path = str(extracted_path)
        source_file.status = "processing"
        self.db.commit()

        rows = self._extract_rows_from_directory(extracted_path)
        inserted, updated, skipped = self._load_rows(rows, source_file.id)

        source_file.row_count = inserted + updated
        source_file.status = "completed"
        source_file.processed_at = datetime.utcnow()

        etl_run.archives_processed += 1
        etl_run.records_inserted += inserted
        etl_run.records_updated += updated
        etl_run.records_skipped += skipped
        self.db.commit()

    def _extract_input_file(self, input_path: Path, checksum: str) -> Path:
        destination = self.extracted_dir / f"{checksum[:12]}-{input_path.stem}"
        if destination.exists():
            shutil.rmtree(destination)
        destination.mkdir(parents=True, exist_ok=True)

        suffix = input_path.suffix.lower()

        if suffix == ".zip":
            with zipfile.ZipFile(input_path) as archive:
                archive.extractall(destination)
            return destination

        if suffix == ".rar":
            try:
                import rarfile

                with rarfile.RarFile(input_path) as archive:
                    archive.extractall(destination)
                return destination
            except rarfile.Error as exc:
                raise RuntimeError(
                    "No se pudo descomprimir RAR. Instala 'unrar' o 'unar' en el host del backend."
                ) from exc
            except ModuleNotFoundError as exc:
                raise RuntimeError(
                    "Falta dependencia 'rarfile'. Ejecuta 'pip install -e \"[dev]\"' en apps/backend."
                ) from exc

        if suffix in {".xlsx", ".xls"}:
            shutil.copy2(input_path, destination / input_path.name)
            return destination

        if suffix in {".csv", ".txt"}:
            shutil.copy2(input_path, destination / input_path.name)
            return destination

        raise ValueError(f"Formato no soportado para ETL: {input_path.name}")

    def _extract_rows_from_directory(self, extracted_path: Path) -> Iterator[NormalizedMeasurementRow]:
        workbook_paths = [
            path
            for path in extracted_path.rglob("*")
            if path.is_file() and path.suffix.lower() in {".xlsx", ".xls"}
        ]
        delimited_paths = [
            path for path in extracted_path.rglob("*") if path.is_file() and path.suffix.lower() in {".csv", ".txt"}
        ]

        for workbook_path in workbook_paths:
            yield from self._extract_rows_from_workbook(workbook_path)

        for delimited_path in delimited_paths:
            yield from self._extract_rows_from_delimited(delimited_path)

    def _extract_rows_from_workbook(self, workbook_path: Path) -> Iterator[NormalizedMeasurementRow]:
        try:
            sheets = pd.read_excel(workbook_path, sheet_name=None)
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"No se pudo leer el archivo Excel {workbook_path.name}: {exc}") from exc

        for sheet_name, dataframe in sheets.items():
            if dataframe is None or dataframe.empty:
                continue
            yield from self._normalize_dataframe(
                dataframe=dataframe,
                workbook_name=workbook_path.name,
                sheet_name=sheet_name,
            )

    def _extract_rows_from_delimited(self, file_path: Path) -> Iterator[NormalizedMeasurementRow]:
        dataframe = self._read_delimited_file(file_path)
        if dataframe is None or dataframe.empty:
            return

        yield from self._normalize_dataframe(
            dataframe=dataframe,
            workbook_name=file_path.name,
            sheet_name="data",
        )

    def _read_delimited_file(self, file_path: Path) -> pd.DataFrame | None:
        attempted_encodings = ["utf-8-sig", "latin-1"]
        for encoding in attempted_encodings:
            try:
                return pd.read_csv(file_path, sep=None, engine="python", encoding=encoding)
            except Exception:  # noqa: BLE001
                continue
        raise RuntimeError(f"No se pudo leer el archivo delimitado {file_path.name}.")

    def _normalize_dataframe(
        self,
        *,
        dataframe: pd.DataFrame,
        workbook_name: str,
        sheet_name: str,
    ) -> Iterator[NormalizedMeasurementRow]:
        dataframe = dataframe.dropna(how="all")
        if dataframe.empty:
            return

        column_map = {normalize_text(str(column)): column for column in dataframe.columns}

        station_column = self._first_existing(column_map, STATION_COLUMNS)
        datetime_column = self._first_existing(column_map, DATETIME_COLUMNS)
        date_column = self._first_existing(column_map, DATE_COLUMNS)
        time_column = self._first_existing(column_map, TIME_COLUMNS)
        variable_column = self._first_existing(column_map, VARIABLE_COLUMNS)
        value_column = self._first_existing(column_map, VALUE_COLUMNS)
        unit_column = self._first_existing(column_map, UNIT_COLUMNS)

        metadata_columns = {
            column
            for column in [station_column, datetime_column, date_column, time_column, variable_column, value_column, unit_column]
            if column is not None
        }

        wide_value_columns = self._detect_wide_value_columns(dataframe, metadata_columns)

        for index, row in dataframe.iterrows():
            station_code = self._extract_station_code(row, station_column)
            observed_at = self._extract_observed_at(row, datetime_column, date_column, time_column)
            if observed_at is None:
                continue

            if variable_column and value_column:
                variable_raw = row.get(variable_column)
                value_raw = row.get(value_column)
                value = pd.to_numeric(value_raw, errors="coerce")
                if pd.isna(value) or variable_raw is None:
                    continue

                variable_code = normalize_variable_code(str(variable_raw))
                unit = guess_unit(variable_code, self._extract_unit(row, unit_column))
                yield NormalizedMeasurementRow(
                    station_code=station_code,
                    observed_at=observed_at,
                    variable_code=variable_code,
                    value=float(value),
                    unit=unit,
                    source_sheet=sheet_name,
                    source_row_number=int(index) + 2,
                    source_workbook=workbook_name,
                )
                continue

            for value_col in wide_value_columns:
                raw_value = row.get(value_col)
                value = pd.to_numeric(raw_value, errors="coerce")
                if pd.isna(value):
                    continue

                variable_code = normalize_variable_code(str(value_col))
                unit = guess_unit(variable_code, self._extract_unit(row, unit_column))
                yield NormalizedMeasurementRow(
                    station_code=station_code,
                    observed_at=observed_at,
                    variable_code=variable_code,
                    value=float(value),
                    unit=unit,
                    source_sheet=sheet_name,
                    source_row_number=int(index) + 2,
                    source_workbook=workbook_name,
                )

    def _extract_station_code(self, row: pd.Series, station_column: str | None) -> str:
        if station_column is None:
            return "UNKNOWN_STATION"

        raw_station = row.get(station_column)
        if raw_station is None or str(raw_station).strip() == "" or str(raw_station).lower() == "nan":
            return "UNKNOWN_STATION"
        return normalize_variable_code(str(raw_station))

    def _extract_observed_at(
        self,
        row: pd.Series,
        datetime_column: str | None,
        date_column: str | None,
        time_column: str | None,
    ) -> datetime | None:
        if datetime_column:
            return parse_datetime(row.get(datetime_column))

        if date_column and time_column:
            date_value = row.get(date_column)
            time_value = row.get(time_column)
            return parse_datetime(f"{date_value} {time_value}")

        if date_column:
            return parse_datetime(row.get(date_column))

        return None

    def _extract_unit(self, row: pd.Series, unit_column: str | None) -> str | None:
        if unit_column is None:
            return None

        raw_unit = row.get(unit_column)
        if raw_unit is None or str(raw_unit).strip() == "" or str(raw_unit).lower() == "nan":
            return None

        return str(raw_unit).strip()

    def _detect_wide_value_columns(self, dataframe: pd.DataFrame, metadata_columns: set[str]) -> list[str]:
        value_columns: list[str] = []

        for column in dataframe.columns:
            if column in metadata_columns:
                continue

            series = pd.to_numeric(dataframe[column], errors="coerce")
            if series.notna().mean() >= 0.6:
                value_columns.append(column)

        return value_columns

    def _first_existing(self, column_map: dict[str, str], candidates: tuple[str, ...]) -> str | None:
        for candidate in candidates:
            mapped = column_map.get(candidate)
            if mapped is not None:
                return mapped
        return None

    def _load_rows(self, rows: Iterable[NormalizedMeasurementRow], source_file_id: int) -> tuple[int, int, int]:
        total_inserted = 0
        total_updated = 0
        total_skipped = 0
        chunk_size = max(100, self.settings.etl_row_chunk_size)
        chunk: list[NormalizedMeasurementRow] = []

        for row in rows:
            chunk.append(row)
            if len(chunk) >= chunk_size:
                inserted, updated, skipped = self._load_rows_chunk(chunk, source_file_id)
                total_inserted += inserted
                total_updated += updated
                total_skipped += skipped
                chunk = []

        if chunk:
            inserted, updated, skipped = self._load_rows_chunk(chunk, source_file_id)
            total_inserted += inserted
            total_updated += updated
            total_skipped += skipped

        return total_inserted, total_updated, total_skipped

    def _load_rows_chunk(self, rows: list[NormalizedMeasurementRow], source_file_id: int) -> tuple[int, int, int]:
        inserted = 0
        updated = 0
        skipped = 0

        for row in rows:
            station = self._get_or_create_station(row.station_code)
            variable = self._get_or_create_variable(row.variable_code, row.unit)

            statement = select(Measurement).where(
                Measurement.station_id == station.id,
                Measurement.variable_id == variable.id,
                Measurement.observed_at == row.observed_at,
            )
            existing = self.db.scalar(statement)

            if existing is None:
                measurement = Measurement(
                    station_id=station.id,
                    variable_id=variable.id,
                    observed_at=row.observed_at,
                    value=row.value,
                    unit=row.unit,
                    source_file_id=source_file_id,
                    record_hash=compute_record_hash(row.station_code, row.variable_code, row.observed_at),
                )
                self.db.add(measurement)
                inserted += 1
                continue

            if abs(existing.value - row.value) > 1e-9 or (existing.unit or "") != (row.unit or ""):
                existing.value = row.value
                existing.unit = row.unit
                existing.source_file_id = source_file_id
                existing.record_hash = compute_record_hash(row.station_code, row.variable_code, row.observed_at)
                updated += 1
            else:
                skipped += 1

        self.db.commit()
        return inserted, updated, skipped

    def _get_or_create_station(self, station_code: str) -> Station:
        cached = self._station_cache.get(station_code)
        if cached is not None:
            return cached

        existing = self.db.scalar(select(Station).where(Station.code == station_code))
        if existing is not None:
            self._station_cache[station_code] = existing
            return existing

        station = Station(code=station_code, name=station_code)
        self.db.add(station)
        self.db.flush()
        self._station_cache[station_code] = station
        return station

    def _get_or_create_variable(self, variable_code: str, unit: str | None) -> Variable:
        cached = self._variable_cache.get(variable_code)
        if cached is not None:
            if cached.default_unit is None and unit:
                cached.default_unit = unit
            return cached

        existing = self.db.scalar(select(Variable).where(Variable.code == variable_code))
        if existing is not None:
            if existing.default_unit is None and unit:
                existing.default_unit = unit
            self._variable_cache[variable_code] = existing
            return existing

        variable = Variable(
            code=variable_code,
            display_name=variable_code,
            category=self._categorize_variable(variable_code),
            default_unit=unit,
        )
        self.db.add(variable)
        self.db.flush()
        self._variable_cache[variable_code] = variable
        return variable

    def _categorize_variable(self, variable_code: str) -> str:
        upper_code = variable_code.upper()

        if upper_code in {"PM25", "PM2.5", "PM10", "NO2", "SO2", "O3", "CO"}:
            return "pollutant"
        if upper_code in {"TMP", "TEMP", "TEMPERATURA", "HUM", "HUMEDAD", "VEL", "PRE", "IUV", "RS", "LLU"}:
            return "meteorological"
        return "other"

    def get_metrics(self) -> dict[str, int | str]:
        total_measurements = self.db.scalar(select(func.count()).select_from(Measurement)) or 0
        total_stations = self.db.scalar(select(func.count()).select_from(Station)) or 0
        total_variables = self.db.scalar(select(func.count()).select_from(Variable)) or 0

        latest_run = self.db.scalar(select(EtlRun).order_by(desc(EtlRun.started_at)).limit(1))

        return {
            "total_measurements": int(total_measurements),
            "total_stations": int(total_stations),
            "total_variables": int(total_variables),
            "latest_run_status": latest_run.status if latest_run else "never-run",
        }
