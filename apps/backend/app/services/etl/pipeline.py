from __future__ import annotations

import re
import shutil
import time
import zipfile
from collections.abc import Callable, Iterable, Iterator
from datetime import UTC, date, datetime
from datetime import time as dt_time
from pathlib import Path
from typing import Any

import httpx
import pandas as pd
from bs4 import BeautifulSoup
from sqlalchemy import delete, desc, func, select, tuple_
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
    normalize_station_code,
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
    "unnamed_0",
    "fecha_unidad",
    "fechaunidad",
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
            "timestamp": datetime.now(UTC).isoformat(),
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
        observed_from: date | None = None,
        observed_to: date | None = None,
    ) -> EtlRun:
        (
            run,
            normalized_variables,
            max_archives_effective,
            run_force_reprocess,
            run_observed_from,
            run_observed_to,
        ) = self.create_remmaq_run(
            variable_codes=variable_codes,
            max_archives=max_archives,
            force_reprocess=force_reprocess,
            observed_from=observed_from,
            observed_to=observed_to,
        )
        return self.run_remmaq_sync(
            run_id=run.id,
            selected_variables=normalized_variables,
            max_archives=max_archives_effective,
            force_reprocess=run_force_reprocess,
            observed_from=run_observed_from,
            observed_to=run_observed_to,
        )

    def ingest_manual_file(self, *, filename: str, content: bytes, force_reprocess: bool = False) -> EtlRun:
        suffix = Path(filename).suffix.lower()
        if suffix not in MANUAL_FILE_SUFFIXES:
            allowed = ", ".join(MANUAL_FILE_SUFFIXES)
            raise ValueError(f"Formato de carga manual no soportado. Usa: {allowed}")
        run = self.create_manual_run(filename=filename)
        return self.run_manual_ingestion(
            run_id=run.id,
            filename=filename,
            content=content,
            force_reprocess=force_reprocess,
        )

    def ingest_normalized_rows(
        self,
        *,
        filename: str,
        content: bytes,
        rows: Iterable[NormalizedMeasurementRow],
        source_type: str = "manual",
        source_url: str | None = None,
    ) -> EtlRun:
        run = self.create_manual_run(filename=filename)
        checksum = compute_sha256(content)
        safe_name = filename.replace("/", "_").replace("\\", "_")
        archive_name = f"{checksum[:12]}-{safe_name}"
        archive_path = self.raw_dir / archive_name
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        archive_path.write_bytes(content)

        source_file = SourceFile(
            etl_run_id=run.id,
            source_type=source_type,
            source_url=source_url,
            original_name=filename,
            local_archive_path=str(archive_path),
            extracted_path=None,
            checksum_sha256=checksum,
            status="processing",
        )
        self.db.add(source_file)
        self.db.commit()
        self.db.refresh(source_file)

        try:
            inserted, updated, skipped = self._load_rows(rows, source_file.id)
            source_file.row_count = inserted + updated
            source_file.status = "completed"
            source_file.processed_at = datetime.utcnow()

            run.archives_discovered = 1
            run.archives_processed = 1
            run.records_inserted = inserted
            run.records_updated = updated
            run.records_skipped = skipped
            run.status = "completed"
            run.finished_at = datetime.utcnow()
            self.db.add(source_file)
            self.db.add(run)
            self.db.commit()
            self._set_run_progress(
                run,
                stage="completed",
                stage_label="Completado",
                progress_percent=100,
                archives_total=1,
                archives_processed=1,
                records_inserted=inserted,
                records_updated=updated,
                records_skipped=skipped,
                filename=filename,
            )
            self.db.refresh(run)
            return run
        except Exception as exc:  # noqa: BLE001
            source_file.status = "failed"
            source_file.error_message = str(exc)
            self.db.add(source_file)
            self.db.commit()
            self._mark_run_failed(run_id=run.id, error_message=str(exc))
            raise

    def extract_remmaq_dataframe(
        self,
        *,
        variable_codes: list[str] | None,
        max_archives: int | None,
        observed_from: date | None = None,
        observed_to: date | None = None,
    ) -> tuple[pd.DataFrame, list[dict[str, str]]]:
        normalized_variables = self._normalize_variable_selection(variable_codes)
        normalized_from, normalized_to = self._normalize_observed_range(observed_from, observed_to)
        observed_from_dt, observed_to_dt = self._date_to_datetime_range(normalized_from, normalized_to)
        max_archives_effective = (
            len(normalized_variables)
            if variable_codes
            else max_archives or self.settings.etl_sync_default_max_archives
        )

        archives = self._discover_archive_urls(
            root_url=self.settings.remmaq_base_url,
            selected_variables=normalized_variables,
            max_archives=max_archives_effective,
        )

        records: list[dict[str, object]] = []
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.extracted_dir.mkdir(parents=True, exist_ok=True)

        for archive in archives:
            archive_url = archive["url"]
            content, filename = self._download_binary(archive_url)
            checksum = compute_sha256(content)
            safe_name = filename.replace("/", "_").replace("\\", "_")
            archive_name = f"{checksum[:12]}-{safe_name}"
            archive_path = self.raw_dir / archive_name
            archive_path.write_bytes(content)
            extracted_path = self._extract_input_file(archive_path, checksum)

            for row in self._extract_rows_from_directory(extracted_path):
                observed_at = row.observed_at.astimezone(UTC)
                if observed_from_dt is not None and observed_at < observed_from_dt:
                    continue
                if observed_to_dt is not None and observed_at > observed_to_dt:
                    continue
                records.append(
                    {
                        "station_code": normalize_station_code(row.station_code),
                        "observed_at": observed_at.replace(tzinfo=None).isoformat(),
                        "variable_code": normalize_variable_code(row.variable_code),
                        "value": float(row.value),
                        "unit": row.unit,
                        "source_file_name": filename,
                        "source_url": archive_url,
                    }
                )

        if not records:
            raise RuntimeError("No se encontraron filas REMMAQ para el rango o variables seleccionadas.")

        return pd.DataFrame.from_records(records), archives

    def _create_run(self, *, trigger_type: str, source: str) -> EtlRun:
        run = EtlRun(trigger_type=trigger_type, source=source, status="running")
        self.db.add(run)
        self.db.commit()
        self.db.refresh(run)
        return run

    def get_run(self, run_id: str) -> EtlRun | None:
        return self.db.get(EtlRun, run_id)

    def create_remmaq_run(
        self,
        *,
        variable_codes: list[str] | None,
        max_archives: int | None,
        force_reprocess: bool = False,
        observed_from: date | None = None,
        observed_to: date | None = None,
    ) -> tuple[EtlRun, list[str], int, bool, date | None, date | None]:
        normalized_variables = self._normalize_variable_selection(variable_codes)
        normalized_from, normalized_to = self._normalize_observed_range(observed_from, observed_to)
        # When the caller explicitly selects variables, process exactly those.
        if variable_codes:
            max_archives_effective = len(normalized_variables)
        else:
            max_archives_effective = max_archives or self.settings.etl_sync_default_max_archives
        run = self._create_run(trigger_type="automatic", source=self.settings.remmaq_base_url)
        self._set_run_progress(
            run,
            stage="queued",
            stage_label="En cola",
            progress_percent=0,
            selected_variables=normalized_variables,
            max_archives=max_archives_effective,
            force_reprocess=force_reprocess,
            observed_from=normalized_from.isoformat() if normalized_from else None,
            observed_to=normalized_to.isoformat() if normalized_to else None,
        )
        return run, normalized_variables, max_archives_effective, force_reprocess, normalized_from, normalized_to

    def create_manual_run(self, *, filename: str) -> EtlRun:
        run = self._create_run(trigger_type="manual", source="manual-upload")
        self._set_run_progress(
            run,
            stage="queued",
            stage_label="En cola",
            progress_percent=0,
            filename=filename,
        )
        return run

    def run_remmaq_sync(
        self,
        *,
        run_id: str,
        selected_variables: list[str],
        max_archives: int,
        force_reprocess: bool,
        observed_from: date | None,
        observed_to: date | None,
    ) -> EtlRun:
        run = self._get_run_or_raise(run_id)
        normalized_from, normalized_to = self._normalize_observed_range(observed_from, observed_to)
        observed_from_dt, observed_to_dt = self._date_to_datetime_range(normalized_from, normalized_to)
        effective_force_reprocess = force_reprocess
        try:
            self._set_run_progress(
                run,
                stage="discovering",
                stage_label="Descubriendo enlaces",
                progress_percent=2,
                selected_variables=selected_variables,
                max_archives=max_archives,
                force_reprocess=effective_force_reprocess,
                observed_from=normalized_from.isoformat() if normalized_from else None,
                observed_to=normalized_to.isoformat() if normalized_to else None,
            )

            archives = self._discover_archive_urls(
                root_url=self.settings.remmaq_base_url,
                selected_variables=selected_variables,
                max_archives=max_archives,
            )
            run.archives_discovered = len(archives)
            self.db.commit()

            discovered_variable_codes = sorted({archive["variable_code"] for archive in archives})
            deleted_measurements = 0
            overwritten_variables: list[str] = []
            if effective_force_reprocess:
                deleted_measurements = self._delete_existing_measurements_for_variable_codes(
                    discovered_variable_codes,
                    observed_from=observed_from_dt,
                    observed_to=observed_to_dt,
                )
                overwritten_variables = discovered_variable_codes
            self._set_run_progress(
                run,
                stage="discovering",
                stage_label="Fuentes identificadas",
                progress_percent=5,
                archives_total=len(archives),
                selected_variables=selected_variables,
                max_archives=max_archives,
                overwritten_variables=overwritten_variables,
                deleted_measurements=deleted_measurements,
                force_reprocess=effective_force_reprocess,
                observed_from=normalized_from.isoformat() if normalized_from else None,
                observed_to=normalized_to.isoformat() if normalized_to else None,
            )

            for archive_index, archive in enumerate(archives, start=1):
                archive_url = archive["url"]
                variable_code = archive["variable_code"]

                self._set_run_progress(
                    run,
                    stage="download",
                    stage_label="Descarga",
                    progress_percent=self._compute_progress_percent(
                        archives_total=len(archives),
                        archives_completed=archive_index - 1,
                        stage_fraction=0.05,
                    ),
                    archives_total=len(archives),
                    current_archive=archive_index,
                    current_variable=variable_code,
                    current_url=archive_url,
                )

                content, filename = self._download_binary(archive_url)
                self._process_binary(
                    etl_run=run,
                    content=content,
                    original_name=filename,
                    source_type="automatic",
                    source_url=archive_url,
                    force_reprocess=effective_force_reprocess,
                    archive_index=archive_index,
                    archives_total=len(archives),
                    selected_variables=selected_variables,
                    current_variable=variable_code,
                    observed_from=observed_from_dt,
                    observed_to=observed_to_dt,
                )

            run.status = "completed"
            run.finished_at = datetime.utcnow()
            self.db.add(run)
            self.db.commit()
            self._set_run_progress(
                run,
                stage="completed",
                stage_label="Completado",
                progress_percent=100,
                archives_total=run.archives_discovered,
                archives_processed=run.archives_processed,
                records_inserted=run.records_inserted,
                records_updated=run.records_updated,
                records_skipped=run.records_skipped,
            )
            self.db.refresh(run)
            return run
        except Exception as exc:  # noqa: BLE001
            self._mark_run_failed(run_id=run_id, error_message=str(exc))
            raise

    def run_manual_ingestion(
        self,
        *,
        run_id: str,
        filename: str,
        content: bytes,
        force_reprocess: bool = False,
    ) -> EtlRun:
        run = self._get_run_or_raise(run_id)
        try:
            run.archives_discovered = 1
            self.db.add(run)
            self.db.commit()

            self._set_run_progress(
                run,
                stage="download",
                stage_label="Descarga",
                progress_percent=5,
                archives_total=1,
                current_archive=1,
                filename=filename,
            )

            self._process_binary(
                etl_run=run,
                content=content,
                original_name=filename,
                source_type="manual",
                source_url=None,
                force_reprocess=force_reprocess,
                archive_index=1,
                archives_total=1,
                selected_variables=[],
                current_variable="MANUAL",
            )

            run.status = "completed"
            run.finished_at = datetime.utcnow()
            self.db.add(run)
            self.db.commit()
            self._set_run_progress(
                run,
                stage="completed",
                stage_label="Completado",
                progress_percent=100,
                archives_total=1,
                archives_processed=run.archives_processed,
                records_inserted=run.records_inserted,
                records_updated=run.records_updated,
                records_skipped=run.records_skipped,
            )
            self.db.refresh(run)
            return run
        except Exception as exc:  # noqa: BLE001
            self._mark_run_failed(run_id=run_id, error_message=str(exc))
            raise

    def _get_run_or_raise(self, run_id: str) -> EtlRun:
        run = self.get_run(run_id)
        if run is None:
            raise ValueError(f"No existe corrida ETL con id {run_id}.")
        return run

    def _mark_run_failed(self, *, run_id: str, error_message: str) -> None:
        self.db.rollback()
        run = self.get_run(run_id)
        if run is None:
            return
        run.status = "failed"
        run.finished_at = datetime.utcnow()
        self.db.add(run)
        self.db.commit()
        self._set_run_progress(
            run,
            stage="failed",
            stage_label="Falló",
            progress_percent=100,
            error=error_message,
        )

    def _set_run_progress(
        self,
        run: EtlRun,
        *,
        stage: str,
        stage_label: str,
        progress_percent: int,
        **extra: Any,
    ) -> None:
        details = dict(run.details or {})
        details.update(extra)
        details["stage"] = stage
        details["stage_label"] = stage_label
        details["progress_percent"] = max(0, min(100, int(progress_percent)))
        details["updated_at"] = datetime.now(UTC).isoformat()
        run.details = details
        self.db.add(run)
        self.db.commit()

    def _compute_progress_percent(self, *, archives_total: int, archives_completed: int, stage_fraction: float) -> int:
        safe_total = max(1, archives_total)
        safe_completed = max(0, min(archives_completed, safe_total))
        safe_fraction = max(0.0, min(stage_fraction, 1.0))
        value = ((safe_completed + safe_fraction) / safe_total) * 100
        return int(max(0, min(100, round(value))))

    def _normalize_observed_range(
        self,
        observed_from: date | None,
        observed_to: date | None,
    ) -> tuple[date | None, date | None]:
        if observed_from and observed_to and observed_from > observed_to:
            raise ValueError("El rango de fechas es inválido: observed_from no puede ser mayor que observed_to.")
        return observed_from, observed_to

    def _date_to_datetime_range(
        self,
        observed_from: date | None,
        observed_to: date | None,
    ) -> tuple[datetime | None, datetime | None]:
        from_dt = datetime.combine(observed_from, dt_time.min, tzinfo=UTC) if observed_from is not None else None
        to_dt = datetime.combine(observed_to, dt_time.max, tzinfo=UTC) if observed_to is not None else None
        return from_dt, to_dt

    def _delete_existing_measurements_for_variable_codes(
        self,
        variable_codes: list[str],
        *,
        observed_from: datetime | None = None,
        observed_to: datetime | None = None,
    ) -> int:
        if not variable_codes:
            return 0

        normalized_codes = sorted({normalize_variable_code(code) for code in variable_codes if code})
        if not normalized_codes:
            return 0

        variable_ids = list(self.db.scalars(select(Variable.id).where(Variable.code.in_(normalized_codes))).all())
        if not variable_ids:
            return 0

        statement = delete(Measurement).where(Measurement.variable_id.in_(variable_ids))
        if observed_from is not None:
            statement = statement.where(Measurement.observed_at >= observed_from.astimezone(UTC).replace(tzinfo=None))
        if observed_to is not None:
            statement = statement.where(Measurement.observed_at <= observed_to.astimezone(UTC).replace(tzinfo=None))

        result = self.db.execute(statement)
        self.db.commit()
        rowcount = int(result.rowcount or 0)
        return max(0, rowcount)

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
        discovered_variables: set[str] = set()
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
            if variable_code in discovered_variables:
                continue

            discovered.append(
                {
                    "url": normalized_url,
                    "label": text,
                    "variable_code": variable_code,
                }
            )
            discovered_urls.add(normalized_url)
            discovered_variables.add(variable_code)
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
        archive_index: int,
        archives_total: int,
        selected_variables: list[str],
        current_variable: str,
        observed_from: datetime | None = None,
        observed_to: datetime | None = None,
    ) -> None:
        checksum = compute_sha256(content)

        self._set_run_progress(
            etl_run,
            stage="download",
            stage_label="Descarga",
            progress_percent=self._compute_progress_percent(
                archives_total=archives_total,
                archives_completed=max(0, archive_index - 1),
                stage_fraction=0.1,
            ),
            archives_total=archives_total,
            current_archive=archive_index,
            current_variable=current_variable,
            selected_variables=selected_variables,
            records_inserted=etl_run.records_inserted,
            records_updated=etl_run.records_updated,
            records_skipped=etl_run.records_skipped,
        )

        existing_file = self.db.scalar(
            select(SourceFile).where(SourceFile.checksum_sha256 == checksum, SourceFile.status == "completed")
        )
        if existing_file and not force_reprocess and observed_from is None and observed_to is None:
            if existing_file.row_count > 0:
                etl_run.records_skipped += existing_file.row_count
                etl_run.archives_processed += 1
                self.db.commit()
                self._set_run_progress(
                    etl_run,
                    stage="completed_archive",
                    stage_label="Archivo ya procesado",
                    progress_percent=self._compute_progress_percent(
                        archives_total=archives_total,
                        archives_completed=archive_index,
                        stage_fraction=0.0,
                    ),
                    archives_total=archives_total,
                    current_archive=archive_index,
                    current_variable=current_variable,
                    selected_variables=selected_variables,
                    records_inserted=etl_run.records_inserted,
                    records_updated=etl_run.records_updated,
                    records_skipped=etl_run.records_skipped,
                )
                return

        safe_name = original_name.replace("/", "_").replace("\\", "_")
        archive_name = f"{checksum[:12]}-{safe_name}"
        archive_path = self.raw_dir / archive_name
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        archive_path.write_bytes(content)

        source_file = self._find_reusable_source_file(source_type=source_type, original_name=original_name)
        if source_file is None:
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
        else:
            source_file.etl_run_id = etl_run.id
            source_file.source_url = source_url
            source_file.local_archive_path = str(archive_path)
            source_file.checksum_sha256 = checksum
            source_file.status = "downloaded"
            source_file.error_message = None
            source_file.downloaded_at = datetime.utcnow()
            source_file.processed_at = None
            self.db.add(source_file)
            self.db.commit()
            self.db.refresh(source_file)

        self._set_run_progress(
            etl_run,
            stage="extraction",
            stage_label="Extracción",
            progress_percent=self._compute_progress_percent(
                archives_total=archives_total,
                archives_completed=max(0, archive_index - 1),
                stage_fraction=0.25,
            ),
            archives_total=archives_total,
            current_archive=archive_index,
            current_variable=current_variable,
            selected_variables=selected_variables,
        )

        extracted_path = self._extract_input_file(archive_path, checksum)
        source_file.extracted_path = str(extracted_path)
        source_file.status = "processing"
        self.db.commit()

        self._set_run_progress(
            etl_run,
            stage="normalization",
            stage_label="Normalización",
            progress_percent=self._compute_progress_percent(
                archives_total=archives_total,
                archives_completed=max(0, archive_index - 1),
                stage_fraction=0.5,
            ),
            archives_total=archives_total,
            current_archive=archive_index,
            current_variable=current_variable,
            selected_variables=selected_variables,
        )

        rows = self._extract_rows_from_directory(extracted_path)
        self._set_run_progress(
            etl_run,
            stage="insertion",
            stage_label="Inserción",
            progress_percent=self._compute_progress_percent(
                archives_total=archives_total,
                archives_completed=max(0, archive_index - 1),
                stage_fraction=0.7,
            ),
            archives_total=archives_total,
            current_archive=archive_index,
            current_variable=current_variable,
            selected_variables=selected_variables,
            records_inserted=etl_run.records_inserted,
            records_updated=etl_run.records_updated,
            records_skipped=etl_run.records_skipped,
        )

        chunk_counter = 0
        last_progress_update = time.monotonic()

        def _on_insert_progress(partial_inserted: int, partial_updated: int, partial_skipped: int) -> None:
            nonlocal chunk_counter, last_progress_update
            chunk_counter += 1
            now = time.monotonic()
            if chunk_counter % 3 != 0 and now - last_progress_update < 0.8:
                return
            last_progress_update = now
            stage_fraction = min(0.98, 0.75 + min(0.2, chunk_counter * 0.01))
            self._set_run_progress(
                etl_run,
                stage="insertion",
                stage_label="Inserción",
                progress_percent=self._compute_progress_percent(
                    archives_total=archives_total,
                    archives_completed=max(0, archive_index - 1),
                    stage_fraction=stage_fraction,
                ),
                archives_total=archives_total,
                current_archive=archive_index,
                current_variable=current_variable,
                selected_variables=selected_variables,
                records_inserted=etl_run.records_inserted + partial_inserted,
                records_updated=etl_run.records_updated + partial_updated,
                records_skipped=etl_run.records_skipped + partial_skipped,
            )

        inserted, updated, skipped = self._load_rows(
            rows,
            source_file.id,
            observed_from=observed_from,
            observed_to=observed_to,
            progress_callback=_on_insert_progress,
        )

        source_file.row_count = self._count_measurements_for_source_file(source_file.id)
        source_file.status = "completed"
        source_file.processed_at = datetime.utcnow()

        etl_run.archives_processed += 1
        etl_run.records_inserted += inserted
        etl_run.records_updated += updated
        etl_run.records_skipped += skipped
        self.db.commit()
        self._set_run_progress(
            etl_run,
            stage="completed_archive",
            stage_label="Archivo procesado",
            progress_percent=self._compute_progress_percent(
                archives_total=archives_total,
                archives_completed=archive_index,
                stage_fraction=0.0,
            ),
            archives_total=archives_total,
            current_archive=archive_index,
            current_variable=current_variable,
            selected_variables=selected_variables,
            records_inserted=etl_run.records_inserted,
            records_updated=etl_run.records_updated,
            records_skipped=etl_run.records_skipped,
        )

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

    def _find_reusable_source_file(self, *, source_type: str, original_name: str) -> SourceFile | None:
        if source_type != "automatic":
            return None

        statement = (
            select(SourceFile)
            .where(
                SourceFile.source_type == source_type,
                SourceFile.original_name == original_name,
            )
            .order_by(desc(SourceFile.downloaded_at), desc(SourceFile.id))
            .limit(1)
        )
        return self.db.scalar(statement)

    def _extract_rows_from_directory(self, extracted_path: Path) -> Iterator[NormalizedMeasurementRow]:
        workbook_paths = [
            path for path in extracted_path.rglob("*") if path.is_file() and path.suffix.lower() in {".xlsx", ".xls"}
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
        if datetime_column is None:
            datetime_column = self._guess_datetime_column(dataframe)
        date_column = self._first_existing(column_map, DATE_COLUMNS)
        time_column = self._first_existing(column_map, TIME_COLUMNS)
        variable_column = self._first_existing(column_map, VARIABLE_COLUMNS)
        value_column = self._first_existing(column_map, VALUE_COLUMNS)
        unit_column = self._first_existing(column_map, UNIT_COLUMNS)
        wide_variable_code = self._derive_wide_variable_code(sheet_name=sheet_name, workbook_name=workbook_name)
        wide_units_by_column = self._extract_wide_units_row(dataframe, datetime_column)

        metadata_columns = {
            column
            for column in [
                station_column,
                datetime_column,
                date_column,
                time_column,
                variable_column,
                value_column,
                unit_column,
            ]  # noqa: E501
            if column is not None
        }

        wide_value_columns = self._detect_wide_value_columns(dataframe, metadata_columns)

        for index, row in dataframe.iterrows():
            if row.dropna(how="all").empty:
                continue

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

            if wide_value_columns:
                row_values = pd.to_numeric(row[wide_value_columns], errors="coerce")
                if int(row_values.notna().sum()) == 0:
                    continue

            for value_col in wide_value_columns:
                raw_value = row.get(value_col)
                value = pd.to_numeric(raw_value, errors="coerce")
                if pd.isna(value):
                    continue

                station_code = normalize_station_code(str(value_col))
                variable_code = wide_variable_code
                unit = guess_unit(variable_code, wide_units_by_column.get(value_col))
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
        return normalize_station_code(str(raw_station))

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
            if int(series.notna().sum()) > 0:
                value_columns.append(column)

        return value_columns

    def _guess_datetime_column(self, dataframe: pd.DataFrame) -> str | None:
        best_column: str | None = None
        best_score = 0.0

        for column in dataframe.columns:
            sample = dataframe[column].dropna().head(25)
            if sample.empty:
                continue

            parsed = pd.to_datetime(sample, errors="coerce")
            score = float(parsed.notna().mean())
            if score > best_score:
                best_score = score
                best_column = column

        if best_score >= 0.5:
            return best_column
        return None

    def _derive_wide_variable_code(self, *, sheet_name: str, workbook_name: str) -> str:
        candidates = [sheet_name, Path(workbook_name).stem]
        for candidate in candidates:
            normalized = normalize_variable_code(candidate).replace("_", "")
            if normalized and normalized not in {"HOJA1", "SHEET1", "DATA", "DATOS"}:
                return normalized
        return "UNKNOWN_VARIABLE"

    def _extract_wide_units_row(self, dataframe: pd.DataFrame, datetime_column: str | None) -> dict[str, str]:
        if dataframe.empty or datetime_column is None:
            return {}

        first_row = dataframe.iloc[0]
        marker = normalize_text(str(first_row.get(datetime_column, "")))
        if "fecha" not in marker or "unidad" not in marker:
            return {}

        units: dict[str, str] = {}
        for column in dataframe.columns:
            if column == datetime_column:
                continue
            raw_unit = first_row.get(column)
            if raw_unit is None:
                continue

            value = str(raw_unit).strip()
            if not value or value.lower() == "nan":
                continue
            units[column] = value

        return units

    def _first_existing(self, column_map: dict[str, str], candidates: tuple[str, ...]) -> str | None:
        for candidate in candidates:
            mapped = column_map.get(candidate)
            if mapped is not None:
                return mapped
        return None

    def _load_rows(
        self,
        rows: Iterable[NormalizedMeasurementRow],
        source_file_id: int,
        *,
        observed_from: datetime | None = None,
        observed_to: datetime | None = None,
        progress_callback: Callable[[int, int, int], None] | None = None,
    ) -> tuple[int, int, int]:
        total_inserted = 0
        total_updated = 0
        total_skipped = 0
        chunk_size = max(100, self.settings.etl_row_chunk_size)
        chunk: list[NormalizedMeasurementRow] = []

        for row in rows:
            row_observed_at = row.observed_at.astimezone(UTC)
            if observed_from is not None and row_observed_at < observed_from:
                total_skipped += 1
                continue
            if observed_to is not None and row_observed_at > observed_to:
                total_skipped += 1
                continue

            chunk.append(row)
            if len(chunk) >= chunk_size:
                inserted, updated, skipped = self._load_rows_chunk(chunk, source_file_id)
                total_inserted += inserted
                total_updated += updated
                total_skipped += skipped
                if progress_callback is not None:
                    progress_callback(total_inserted, total_updated, total_skipped)
                chunk = []

        if chunk:
            inserted, updated, skipped = self._load_rows_chunk(chunk, source_file_id)
            total_inserted += inserted
            total_updated += updated
            total_skipped += skipped
            if progress_callback is not None:
                progress_callback(total_inserted, total_updated, total_skipped)

        return total_inserted, total_updated, total_skipped

    def _load_rows_chunk(self, rows: list[NormalizedMeasurementRow], source_file_id: int) -> tuple[int, int, int]:
        inserted = 0
        updated = 0
        skipped = 0

        deduplicated_rows: dict[tuple[str, str, datetime], NormalizedMeasurementRow] = {}
        for row in rows:
            if row.value is None:
                skipped += 1
                continue
            observed_at = row.observed_at.astimezone(UTC).replace(tzinfo=None)
            key = (
                normalize_station_code(row.station_code),
                normalize_variable_code(row.variable_code),
                observed_at,
            )
            if key in deduplicated_rows:
                skipped += 1
            deduplicated_rows[key] = row

        if not deduplicated_rows:
            return inserted, updated, skipped

        prepared_rows: list[tuple[NormalizedMeasurementRow, int, int, datetime]] = []
        keys: list[tuple[int, int, datetime]] = []

        for row in deduplicated_rows.values():
            station = self._get_or_create_station(row.station_code)
            variable = self._get_or_create_variable(row.variable_code, row.unit)
            observed_at = row.observed_at.astimezone(UTC).replace(tzinfo=None)
            prepared_rows.append((row, station.id, variable.id, observed_at))
            keys.append((station.id, variable.id, observed_at))

        self.db.flush()

        if not prepared_rows:
            return inserted, updated, skipped

        try:
            existing_map = self._load_existing_measurements(keys)

            to_insert: list[Measurement] = []
            for row, station_id, variable_id, observed_at in prepared_rows:
                key = (station_id, variable_id, observed_at)
                existing = existing_map.get(key)

                if existing is None:
                    to_insert.append(
                        Measurement(
                            station_id=station_id,
                            variable_id=variable_id,
                            observed_at=observed_at,
                            value=row.value,
                            unit=row.unit,
                            source_file_id=source_file_id,
                            record_hash=compute_record_hash(row.station_code, row.variable_code, observed_at),
                        )
                    )
                    inserted += 1
                    continue

                if abs(existing.value - row.value) > 1e-9 or (existing.unit or "") != (row.unit or ""):
                    existing.value = row.value
                    existing.unit = row.unit
                    existing.source_file_id = source_file_id
                    existing.record_hash = compute_record_hash(row.station_code, row.variable_code, observed_at)
                    updated += 1
                else:
                    skipped += 1

            if to_insert:
                self.db.add_all(to_insert)

            self.db.commit()
            return inserted, updated, skipped
        except Exception:  # noqa: BLE001
            self.db.rollback()
            raise

    def _load_existing_measurements(
        self,
        keys: list[tuple[int, int, datetime]],
    ) -> dict[tuple[int, int, datetime], Measurement]:
        unique_keys = list(dict.fromkeys(keys))
        if not unique_keys:
            return {}

        existing_map: dict[tuple[int, int, datetime], Measurement] = {}
        lookup_chunk_size = max(100, self.settings.etl_lookup_chunk_size)

        for offset in range(0, len(unique_keys), lookup_chunk_size):
            key_batch = unique_keys[offset : offset + lookup_chunk_size]
            statement = select(Measurement).where(
                tuple_(Measurement.station_id, Measurement.variable_id, Measurement.observed_at).in_(key_batch)
            )
            batch_rows = self.db.scalars(statement).all()
            for measurement in batch_rows:
                existing_map[(measurement.station_id, measurement.variable_id, measurement.observed_at)] = measurement

        return existing_map

    def _count_measurements_for_source_file(self, source_file_id: int) -> int:
        statement = select(func.count()).select_from(Measurement).where(Measurement.source_file_id == source_file_id)
        return int(
            self.db.scalar(statement) or 0
        )

    def _get_or_create_station(self, station_code: str) -> Station:
        station_code = normalize_station_code(station_code)
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
        variable_code = normalize_variable_code(variable_code)
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

    def get_preview(self, *, run_id: str | None = None, limit: int = 100) -> dict[str, object]:
        target_run_id = run_id
        if target_run_id is None:
            latest_run = self.db.scalar(select(EtlRun).order_by(desc(EtlRun.started_at)).limit(1))
            if latest_run is None:
                return {"run_id": None, "rows": []}
            target_run_id = latest_run.id

        statement = (
            select(
                Measurement.observed_at,
                Measurement.value,
                Measurement.unit,
                Station.code.label("station_code"),
                Variable.code.label("variable_code"),
                SourceFile.original_name.label("source_file_name"),
            )
            .join(Station, Station.id == Measurement.station_id)
            .join(Variable, Variable.id == Measurement.variable_id)
            .join(SourceFile, SourceFile.id == Measurement.source_file_id)
            .where(SourceFile.etl_run_id == target_run_id)
            .order_by(desc(Measurement.observed_at))
            .limit(limit)
        )
        rows = self.db.execute(statement).all()

        return {
            "run_id": target_run_id,
            "rows": [
                {
                    "observed_at": row.observed_at,
                    "station_code": row.station_code,
                    "variable_code": row.variable_code,
                    "value": float(row.value),
                    "unit": row.unit,
                    "source_file_name": row.source_file_name,
                }
                for row in rows
            ],
        }
