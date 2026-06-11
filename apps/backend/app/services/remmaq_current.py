import calendar
import hashlib
import json
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import quote, urljoin

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import ecuador_now_naive
from app.models.etl_run import EtlRun
from app.models.measurement import DATA_ORIGIN_PUBLIC, Measurement
from app.models.source_file import SourceFile
from app.models.station import Station
from app.models.variable import Variable
from app.services.station_reference import resolve_station_reference

CURRENT_REMMQA_SITES_URL = "https://aireambiente.quito.gob.ec/Modules/Maps/GoogleMap.aspx/GetSitesInfo"
REMMQA_PUBLIC_ROOT_URL = "https://aireambiente.quito.gob.ec/"
REMMQA_REPORT_HANDLER_URL = "https://aireambiente.quito.gob.ec/DXXRDV.axd"
PUBLIC_DASHBOARD_SOURCE_TYPE = "public_dashboard"

LAYER_TO_PUBLIC_VARIABLE: dict[str, tuple[str, str, str, str]] = {
    "CO_mg": ("CO", "Monoxido de carbono", "pollutant", "mg/m3"),
    "NO2_ug": ("NO2", "Dioxido de nitrogeno", "pollutant", "ug/m3"),
    "O3_ug": ("O3", "Ozono", "pollutant", "ug/m3"),
    "SO2_ug": ("SO2", "Dioxido de azufre", "pollutant", "ug/m3"),
    "PM2.5_ug": ("PM25", "Material particulado fino PM2.5", "pollutant", "ug/m3"),
    "PM10_ug": ("PM10", "Material particulado PM10", "pollutant", "ug/m3"),
    "TEMP_AMB": ("TMP", "Temperatura", "meteorological", "C"),
    "TEMPERATURA_MEDIA": ("TMP", "Temperatura", "meteorological", "C"),
    "HUM_REL": ("HUM", "Humedad relativa", "meteorological", "%"),
    "RAD_SOLAR": ("RS", "Radiacion solar", "meteorological", "W/m2"),
    "RADIACION_SOLAR": ("RS", "Radiacion solar", "meteorological", "W/m2"),
    "LLUVIA": ("LLU", "Precipitacion", "meteorological", "mm"),
    "PRECIPITACION": ("LLU", "Precipitacion", "meteorological", "mm"),
    "RAP_VEC": ("VEL", "Velocidad del viento", "meteorological", "m/s"),
    "VELOCIDAD_VIENTO": ("VEL", "Velocidad del viento", "meteorological", "m/s"),
    "DIR_VEC": ("DIR", "Direccion del viento", "meteorological", "degrees"),
    "DIRECCION_VIENTO": ("DIR", "Direccion del viento", "meteorological", "degrees"),
    "INDICE_UV": ("IUV", "Indice ultravioleta", "meteorological", "index"),
}
NORMALIZED_LAYER_TO_PUBLIC_VARIABLE = {
    re.sub(r"[^A-Z0-9]", "", key.upper()): value for key, value in LAYER_TO_PUBLIC_VARIABLE.items()
}
LAYER_TOKEN_TO_PUBLIC_VARIABLE: tuple[tuple[str, tuple[str, str, str, str]], ...] = (
    ("PM25", LAYER_TO_PUBLIC_VARIABLE["PM2.5_ug"]),
    ("PM10", LAYER_TO_PUBLIC_VARIABLE["PM10_ug"]),
    ("NO2", LAYER_TO_PUBLIC_VARIABLE["NO2_ug"]),
    ("SO2", LAYER_TO_PUBLIC_VARIABLE["SO2_ug"]),
    ("OZONO", LAYER_TO_PUBLIC_VARIABLE["O3_ug"]),
    ("O3", LAYER_TO_PUBLIC_VARIABLE["O3_ug"]),
    ("CO", LAYER_TO_PUBLIC_VARIABLE["CO_mg"]),
    ("TEMPAMB", LAYER_TO_PUBLIC_VARIABLE["TEMP_AMB"]),
    ("TEMPERATURA", LAYER_TO_PUBLIC_VARIABLE["TEMPERATURA_MEDIA"]),
    ("HUMREL", LAYER_TO_PUBLIC_VARIABLE["HUM_REL"]),
    ("HUMEDAD", LAYER_TO_PUBLIC_VARIABLE["HUM_REL"]),
    ("RADSOLAR", LAYER_TO_PUBLIC_VARIABLE["RAD_SOLAR"]),
    ("RADIACIONSOLAR", LAYER_TO_PUBLIC_VARIABLE["RADIACION_SOLAR"]),
    ("LLUVIA", LAYER_TO_PUBLIC_VARIABLE["LLUVIA"]),
    ("PRECIPITACION", LAYER_TO_PUBLIC_VARIABLE["PRECIPITACION"]),
    ("RAPVEC", LAYER_TO_PUBLIC_VARIABLE["RAP_VEC"]),
    ("VELOCIDAD", LAYER_TO_PUBLIC_VARIABLE["VELOCIDAD_VIENTO"]),
    ("DIRVEC", LAYER_TO_PUBLIC_VARIABLE["DIR_VEC"]),
    ("DIRECCION", LAYER_TO_PUBLIC_VARIABLE["DIRECCION_VIENTO"]),
    ("INDICEUV", LAYER_TO_PUBLIC_VARIABLE["INDICE_UV"]),
    ("IUV", LAYER_TO_PUBLIC_VARIABLE["INDICE_UV"]),
    ("ULTRAVIOLETA", LAYER_TO_PUBLIC_VARIABLE["INDICE_UV"]),
)

REPORT_TO_PUBLIC_VARIABLE: dict[str, tuple[str, str, str, str, str]] = {
    "CO": (
        "1e651a52-6c8a-e611-aa94-001a4aa8010a",
        "CO",
        "Monoxido de carbono",
        "pollutant",
        "mg/m3",
    ),
    "NO2": (
        "11f84886-626b-4c36-99e2-f811e969e39e",
        "NO2",
        "Dioxido de nitrogeno",
        "pollutant",
        "ug/m3",
    ),
    "O3": (
        "62f276f0-32ce-452b-a234-92be7456dc56",
        "O3",
        "Ozono",
        "pollutant",
        "ug/m3",
    ),
    "PM10": (
        "8517bcfc-0a33-4aa3-b7a0-997e140cf1ea",
        "PM10",
        "Material particulado PM10",
        "pollutant",
        "ug/m3",
    ),
    "PM25": (
        "f2717ac3-6273-461a-8fdb-12b5d5d05277",
        "PM25",
        "Material particulado fino PM2.5",
        "pollutant",
        "ug/m3",
    ),
    "SO2": (
        "f6eca64c-22ad-4430-9133-a4f0fd385e38",
        "SO2",
        "Dioxido de azufre",
        "pollutant",
        "ug/m3",
    ),
    "HUM": (
        "b8eb385b-d952-4ab8-b629-e7b63139faa9",
        "HUM",
        "Humedad relativa",
        "meteorological",
        "%",
    ),
    "LLU": (
        "35dda4cc-f58a-4300-ad82-9d9783dffa6d",
        "LLU",
        "Precipitacion",
        "meteorological",
        "mm",
    ),
    "RS": (
        "36f22de8-4a0a-4838-b0d1-e0e33c56caa3",
        "RS",
        "Radiacion solar",
        "meteorological",
        "W/m2",
    ),
    "IUV": (
        "a10ac7e8-acd0-4b7a-9133-76d3a5d288a4",
        "IUV",
        "Indice ultravioleta",
        "meteorological",
        "index",
    ),
    "TMP": (
        "23ab149a-256c-4ddc-a10b-998536f551af",
        "TMP",
        "Temperatura",
        "meteorological",
        "C",
    ),
    "VEL": (
        "78e4e20b-2499-40fc-8f74-e6ce2e8ba52e",
        "VEL",
        "Velocidad del viento",
        "meteorological",
        "m/s",
    ),
}

REPORT_MONTHS = {month: index for index, month in enumerate(calendar.month_name) if month}


@dataclass(frozen=True)
class CurrentRemmaqSyncResult:
    run_id: str
    inserted: int
    updated: int
    skipped: int
    observed_at: datetime | None


CURRENT_REMMQA_MIN_INTERVAL = timedelta(hours=1)


def should_sync_current_remmaq_snapshot(
    db: Session,
    *,
    force_sync: bool = False,
    now: datetime | None = None,
) -> bool:
    if force_sync:
        return True
    current_time = now or ecuador_now_naive()
    recent_runs = list(
        db.scalars(
            select(EtlRun)
            .where(EtlRun.trigger_type == "automatic")
            .order_by(EtlRun.started_at.desc(), EtlRun.id.desc())
            .limit(50)
        ).all()
    )
    latest_run = next(
        (
            run
            for run in recent_runs
            if isinstance(run.details, dict) and run.details.get("public_dashboard_current_sync") is True
        ),
        None,
    )
    if latest_run is None:
        return True
    if latest_run.started_at is None:
        return True
    return latest_run.started_at < current_time - CURRENT_REMMQA_MIN_INTERVAL


def latest_current_remmaq_sync_started_at(db: Session) -> datetime | None:
    recent_runs = list(
        db.scalars(
            select(EtlRun)
            .where(EtlRun.trigger_type == "automatic")
            .order_by(EtlRun.started_at.desc(), EtlRun.id.desc())
            .limit(50)
        ).all()
    )
    latest_run = next(
        (
            run
            for run in recent_runs
            if isinstance(run.details, dict) and run.details.get("public_dashboard_current_sync") is True
        ),
        None,
    )
    return latest_run.started_at if latest_run is not None else None


def sync_current_remmaq_snapshot(db: Session, *, timeout_seconds: float = 30.0) -> CurrentRemmaqSyncResult:
    payload = _fetch_current_sites(timeout_seconds=timeout_seconds)
    sites = payload.get("d") if isinstance(payload, dict) else None
    if not isinstance(sites, list):
        raise RuntimeError("La fuente oficial vigente no devolvio el arreglo esperado de estaciones.")

    now = ecuador_now_naive()
    run = EtlRun(
        id=str(uuid.uuid4()),
        trigger_type="automatic",
        source="REMMAQ current public map",
        status="running",
        started_at=now,
        details={
            "public_dashboard_current_sync": True,
            "source_url": CURRENT_REMMQA_SITES_URL,
        },
    )
    db.add(run)
    db.flush()

    checksum = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()
    source = SourceFile(
        etl_run_id=run.id,
        source_type=PUBLIC_DASHBOARD_SOURCE_TYPE,
        source_url=CURRENT_REMMQA_SITES_URL,
        original_name="aireambiente-current-public-map.json",
        local_archive_path="remote://aireambiente-current-public-map.json",
        extracted_path=None,
        checksum_sha256=checksum,
        status="downloaded",
        downloaded_at=now,
        processed_at=None,
        row_count=0,
    )
    db.add(source)
    db.flush()

    inserted = 0
    updated = 0
    skipped = 0
    latest_observed_at: datetime | None = None

    for site in sites:
        station = _get_or_create_station(db, site)
        layer_infos = site.get("LayerInfos") if isinstance(site, dict) else None
        if not isinstance(layer_infos, list):
            continue
        for layer in layer_infos:
            if not isinstance(layer, dict) or not layer.get("IsValid"):
                skipped += 1
                continue
            layer_name = str(layer.get("Layer") or "")
            variable_info = _layer_to_public_variable(layer_name)
            value = layer.get("Concentration")
            if variable_info is None or value is None:
                skipped += 1
                continue
            observed_at = _parse_observed_at(layer.get("DataTime"), site.get("AqiTimeString"))
            if observed_at is None:
                skipped += 1
                continue
            latest_observed_at = observed_at if latest_observed_at is None else max(latest_observed_at, observed_at)

            variable = _get_or_create_variable(db, variable_info, layer)
            record_hash = _measurement_hash(station.id, variable.id, observed_at, float(value))
            existing = db.scalar(
                select(Measurement).where(
                    Measurement.station_id == station.id,
                    Measurement.variable_id == variable.id,
                    Measurement.observed_at == observed_at,
                    Measurement.data_origin == DATA_ORIGIN_PUBLIC,
                )
            )
            if existing is None:
                db.add(
                    Measurement(
                        station_id=station.id,
                        variable_id=variable.id,
                        observed_at=observed_at,
                        value=float(value),
                        unit=_normalize_unit(str(layer.get("UnitName") or variable.default_unit or "")),
                        source_file_id=source.id,
                        record_hash=record_hash,
                        data_origin=DATA_ORIGIN_PUBLIC,
                    )
                )
                inserted += 1
                continue

            normalized_unit = _normalize_unit(str(layer.get("UnitName") or existing.unit or ""))
            if abs(float(existing.value) - float(value)) > 1e-12 or existing.unit != normalized_unit:
                existing.value = float(value)
                existing.unit = normalized_unit
                existing.source_file_id = source.id
                existing.record_hash = record_hash
                existing.updated_at = now
                updated += 1
            else:
                skipped += 1

    report_inserted, report_updated, report_skipped, report_observed_at = _sync_current_month_reports(
        db,
        run=run,
        timeout_seconds=timeout_seconds,
        now=now,
    )
    inserted += report_inserted
    updated += report_updated
    skipped += report_skipped
    if report_observed_at is not None:
        latest_observed_at = (
            report_observed_at if latest_observed_at is None else max(latest_observed_at, report_observed_at)
        )

    source.status = "completed"
    source.processed_at = ecuador_now_naive()
    source.row_count = inserted + updated + skipped
    run.status = "completed"
    run.finished_at = source.processed_at
    run.archives_discovered = 1
    run.archives_processed = 1
    run.records_inserted = inserted
    run.records_updated = updated
    run.records_skipped = skipped
    db.commit()
    return CurrentRemmaqSyncResult(run.id, inserted, updated, skipped, latest_observed_at)


def _fetch_current_sites(*, timeout_seconds: float) -> dict[str, Any]:
    with httpx.Client(
        timeout=timeout_seconds,
        follow_redirects=True,
        headers={"User-Agent": "ATMOS-REMMAQ-Public/1.0"},
    ) as client:
        response = client.post(CURRENT_REMMQA_SITES_URL, json={})
        response.raise_for_status()
        return response.json()


def _layer_to_public_variable(layer_name: str) -> tuple[str, str, str, str] | None:
    direct_match = LAYER_TO_PUBLIC_VARIABLE.get(layer_name)
    if direct_match is not None:
        return direct_match
    normalized = re.sub(r"[^A-Z0-9]", "", layer_name.upper())
    normalized_match = NORMALIZED_LAYER_TO_PUBLIC_VARIABLE.get(normalized)
    if normalized_match is not None:
        return normalized_match
    for token, variable_info in LAYER_TOKEN_TO_PUBLIC_VARIABLE:
        if token in normalized:
            return variable_info
    return None


def _sync_current_month_reports(
    db: Session,
    *,
    run: EtlRun,
    timeout_seconds: float,
    now: datetime,
) -> tuple[int, int, int, datetime | None]:
    inserted = 0
    updated = 0
    skipped = 0
    latest_observed_at: datetime | None = None

    with httpx.Client(
        timeout=max(timeout_seconds, 60.0),
        follow_redirects=True,
        headers={"User-Agent": "ATMOS-REMMAQ-Public/1.0"},
    ) as client:
        for variable_info in REPORT_TO_PUBLIC_VARIABLE.values():
            favorite_id, code, _name, _category, _default_unit = variable_info
            report_url = f"{REMMQA_PUBLIC_ROOT_URL}Public/Viewer.aspx?GuiFavoriteID={favorite_id}"
            try:
                pages = _fetch_current_month_report_pages(client, report_url)
            except Exception:  # noqa: BLE001
                skipped += 1
                continue

            checksum = hashlib.sha256(
                json.dumps(pages, sort_keys=True, default=str).encode("utf-8")
            ).hexdigest()
            source = SourceFile(
                etl_run_id=run.id,
                source_type=PUBLIC_DASHBOARD_SOURCE_TYPE,
                source_url=report_url,
                original_name=f"aireambiente-current-month-{code}.json",
                local_archive_path=f"remote://aireambiente-current-month-{code}.json",
                extracted_path=None,
                checksum_sha256=checksum,
                status="downloaded",
                downloaded_at=now,
                processed_at=None,
                row_count=0,
            )
            db.add(source)
            db.flush()

            source_rows = 0
            variable = _get_or_create_variable(db, variable_info[1:], {})
            for page in pages:
                for row in _parse_report_page_rows(page, variable_info):
                    station = _get_or_create_report_station(db, row["station_name"])
                    observed_at = row["observed_at"]
                    value = row["value"]
                    unit = row["unit"]
                    source_rows += 1
                    latest_observed_at = (
                        observed_at if latest_observed_at is None else max(latest_observed_at, observed_at)
                    )
                    record_hash = _measurement_hash(station.id, variable.id, observed_at, value)
                    existing = db.scalar(
                        select(Measurement).where(
                            Measurement.station_id == station.id,
                            Measurement.variable_id == variable.id,
                            Measurement.observed_at == observed_at,
                            Measurement.data_origin == DATA_ORIGIN_PUBLIC,
                        )
                    )
                    if existing is None:
                        db.add(
                            Measurement(
                                station_id=station.id,
                                variable_id=variable.id,
                                observed_at=observed_at,
                                value=value,
                                unit=unit,
                                source_file_id=source.id,
                                record_hash=record_hash,
                                data_origin=DATA_ORIGIN_PUBLIC,
                            )
                        )
                        inserted += 1
                        continue
                    if abs(float(existing.value) - value) > 1e-12 or existing.unit != unit:
                        existing.value = value
                        existing.unit = unit
                        existing.source_file_id = source.id
                        existing.record_hash = record_hash
                        existing.updated_at = now
                        updated += 1
                    else:
                        skipped += 1

            source.status = "completed"
            source.processed_at = ecuador_now_naive()
            source.row_count = source_rows

    return inserted, updated, skipped, latest_observed_at


def _fetch_current_month_report_pages(client: httpx.Client, report_url: str) -> list[dict[str, Any]]:
    viewer_response = client.get(report_url)
    viewer_response.raise_for_status()
    action_match = re.search(r'<form[^>]+action="([^"]+)"', viewer_response.text, flags=re.IGNORECASE)
    if action_match is None:
        raise RuntimeError("La fuente REMMAQ no devolvio el formulario del visor.")

    action_url = urljoin(report_url, action_match.group(1).replace("&amp;", "&"))
    viewer_page = client.get(action_url)
    viewer_page.raise_for_status()
    report_id_match = re.search(r'this\.reportId\s*=\s*"([^"]+)"', viewer_page.text)
    if report_id_match is None:
        raise RuntimeError("La fuente REMMAQ no devolvio el identificador del reporte.")

    report_id = report_id_match.group(1)
    document_id = _start_report_document(client, report_id)
    page_count, first_page = _wait_report_document(client, document_id)
    pages: list[dict[str, Any]] = []
    if first_page:
        pages.append(first_page)

    for page_index in range(1, page_count):
        page = _fetch_report_page(client, document_id, page_index)
        pages.append(page)

    pages_with_month = [(month, page) for page in pages if (month := _report_current_month(page)) is not None]
    if not pages_with_month:
        return pages

    latest_month = max(month for month, _page in pages_with_month)
    return [page for month, page in pages_with_month if month == latest_month]


def _start_report_document(client: httpx.Client, report_id: str) -> str:
    payload = {
        "reportId": report_id,
        "reportUrl": "",
        "drillDownKeys": {},
        "sortingState": [],
        "timeZoneOffset": 300,
        "parameters": [],
    }
    response = client.post(
        REMMQA_REPORT_HANDLER_URL,
        data={"actionKey": "startBuild", "arg": json.dumps(payload, separators=(",", ":"))},
    )
    response.raise_for_status()
    document = response.json()
    document_id = ((document.get("result") or {}).get("documentId")) if isinstance(document, dict) else None
    if not document_id:
        raise RuntimeError("La fuente REMMAQ no pudo construir el documento del reporte.")
    return str(document_id)


def _wait_report_document(client: httpx.Client, document_id: str) -> tuple[int, dict[str, Any] | None]:
    first_page_request = {
        "pageIndex": 0,
        "documentId": document_id,
        "resolution": 96,
        "includeBricks": True,
    }
    first_page: dict[str, Any] | None = None
    page_count = 0
    for attempt in range(8):
        payload = {
            "documentId": document_id,
            "firstPageRequest": first_page_request,
            "isFirstRequest": attempt == 0,
            "timeOut": 5000,
        }
        response = client.post(
            REMMQA_REPORT_HANDLER_URL,
            data={"actionKey": "getBuildStatus", "arg": json.dumps(payload, separators=(",", ":"))},
        )
        response.raise_for_status()
        result = (response.json().get("result") or {})
        page_count = int(result.get("pageCount") or page_count or 0)
        first_page_response = result.get("firstPageResponse")
        if isinstance(first_page_response, dict):
            first_page = first_page_response
        if result.get("completed"):
            return page_count, first_page
    if page_count and first_page:
        return page_count, first_page
    raise RuntimeError("La fuente REMMAQ no completo la construccion del reporte.")


def _fetch_report_page(client: httpx.Client, document_id: str, page_index: int) -> dict[str, Any]:
    payload = {
        "pageIndex": page_index,
        "documentId": document_id,
        "resolution": 96,
        "includeBricks": True,
    }
    response = client.get(
        f"{REMMQA_REPORT_HANDLER_URL}?actionKey=getPage&unifier=atmospub&arg="
        f"{quote(json.dumps(payload, separators=(',', ':')))}"
    )
    response.raise_for_status()
    page = response.json()
    result = page.get("result") if isinstance(page, dict) else None
    if not isinstance(result, dict):
        raise RuntimeError("La fuente REMMAQ no devolvio una pagina valida del reporte.")
    return result


def _report_current_month(page: dict[str, Any] | None) -> tuple[int, int] | None:
    if not page:
        return None
    rows = _report_rows(page)
    header = _sorted_row_text(rows, 3)
    for index, text in enumerate(header):
        month = REPORT_MONTHS.get(text)
        if month and index + 1 < len(header):
            try:
                return int(header[index + 1]), month
            except ValueError:
                return None
    return None


def _parse_report_page_rows(
    page: dict[str, Any],
    variable_info: tuple[str, str, str, str, str],
) -> list[dict[str, Any]]:
    _favorite_id, code, _name, _category, default_unit = variable_info
    rows = _report_rows(page)
    header = _sorted_row_text(rows, 3)
    metadata = _sorted_row_text(rows, 4)
    if len(header) < 4:
        return []
    station_name = header[1]
    month = REPORT_MONTHS.get(header[2])
    try:
        year = int(header[3])
    except ValueError:
        return []
    if not month:
        return []

    unit = default_unit
    if "Units:" in metadata:
        unit_index = metadata.index("Units:")
        if unit_index + 1 < len(metadata):
            unit = _normalize_unit(metadata[unit_index + 1]) or default_unit

    measurements: list[dict[str, Any]] = []
    for row_items in rows.values():
        day_text_item = next((item for item in row_items if item.get("col") == 0), None)
        day_text = str(day_text_item.get("text") if day_text_item else "").strip()
        if not re.fullmatch(r"\d{1,2}", day_text):
            continue
        day = int(day_text)
        for item in row_items:
            col = item.get("col")
            if not isinstance(col, int) or col < 1 or col > 24:
                continue
            value = _parse_report_number(str(item.get("text") or ""))
            if value is None:
                continue
            try:
                observed_at = datetime(year, month, day, col - 1)
            except ValueError:
                continue
            measurements.append(
                {
                    "station_name": station_name,
                    "variable_code": code,
                    "observed_at": observed_at,
                    "value": value,
                    "unit": unit,
                }
            )
    return measurements


def _report_rows(page: dict[str, Any]) -> dict[int, list[dict[str, Any]]]:
    rows: dict[int, list[dict[str, Any]]] = {}

    def visit(brick: dict[str, Any] | None) -> None:
        if not isinstance(brick, dict):
            return
        text = ""
        for content in brick.get("content") or []:
            if isinstance(content, dict) and content.get("Key") == "text":
                text = str(content.get("Value") or "").strip()
                break
        row = brick.get("row")
        if text and isinstance(row, int):
            rows.setdefault(row, []).append(
                {
                    "row": row,
                    "col": brick.get("col"),
                    "left": brick.get("left") or 0,
                    "text": text,
                }
            )
        for child in brick.get("bricks") or []:
            visit(child)

    visit(page.get("brick"))
    for row_items in rows.values():
        row_items.sort(key=lambda item: (float(item.get("left") or 0), int(item.get("col") or 0)))
    return rows


def _sorted_row_text(rows: dict[int, list[dict[str, Any]]], row: int) -> list[str]:
    return [str(item["text"]) for item in rows.get(row, [])]


def _parse_report_number(value: str) -> float | None:
    clean = value.strip().replace(",", ".")
    if not clean or clean.upper() in {"N/A", "NA", "NULL"}:
        return None
    if clean.startswith("."):
        clean = f"0{clean}"
    if clean.startswith("-."):
        clean = clean.replace("-.", "-0.", 1)
    try:
        return float(clean)
    except ValueError:
        return None


def _get_or_create_report_station(db: Session, station_name: str) -> Station:
    reference = resolve_station_reference(station_name, station_name)
    canonical_name = reference.name if reference else station_name
    canonical_code = canonical_name.replace(" ", "").upper()
    existing = db.scalar(select(Station).where(Station.code == canonical_code))
    if existing is not None:
        if reference:
            existing.name = reference.name
            existing.latitude = existing.latitude if existing.latitude is not None else reference.latitude
            existing.longitude = existing.longitude if existing.longitude is not None else reference.longitude
        existing.is_active = True
        return existing
    station = Station(
        code=canonical_code,
        name=canonical_name,
        latitude=reference.latitude if reference else None,
        longitude=reference.longitude if reference else None,
        is_active=True,
    )
    db.add(station)
    db.flush()
    return station


def _get_or_create_station(db: Session, site: dict[str, Any]) -> Station:
    site_name = str(site.get("SiteName") or "Unknown Station").strip()
    reference = resolve_station_reference(site_name, site_name)
    stations = db.scalars(select(Station)).all()
    for station in stations:
        if resolve_station_reference(station.code, station.name) == reference and reference is not None:
            _update_station_location(station, site, reference.name)
            return station
        if station.code.lower() == site_name.replace(" ", "").lower():
            _update_station_location(station, site, reference.name if reference else site_name)
            return station

    station = Station(
        code=(reference.name if reference else site_name).replace(" ", "").upper(),
        name=reference.name if reference else site_name,
        latitude=float(site["Latitude"])
        if site.get("Latitude") is not None
        else (reference.latitude if reference else None),
        longitude=float(site["Longitude"])
        if site.get("Longitude") is not None
        else (reference.longitude if reference else None),
        is_active=True,
    )
    db.add(station)
    db.flush()
    return station


def _update_station_location(station: Station, site: dict[str, Any], name: str) -> None:
    station.name = name
    if site.get("Latitude") is not None:
        station.latitude = float(site["Latitude"])
    if site.get("Longitude") is not None:
        station.longitude = float(site["Longitude"])
    station.is_active = True


def _get_or_create_variable(db: Session, variable_info: tuple[str, str, str, str], layer: dict[str, Any]) -> Variable:
    code, display_name, category, default_unit = variable_info
    variable = db.scalar(select(Variable).where(Variable.code == code))
    if variable is not None:
        return variable
    variable = Variable(
        code=code,
        display_name=display_name,
        category=category,
        default_unit=_normalize_unit(str(layer.get("UnitName") or default_unit)),
    )
    db.add(variable)
    db.flush()
    return variable


def _parse_observed_at(raw_date: Any, fallback: Any) -> datetime | None:
    if isinstance(fallback, str) and fallback:
        try:
            return datetime.fromisoformat(fallback)
        except ValueError:
            pass
    if isinstance(raw_date, str) and raw_date.startswith("/Date("):
        digits = raw_date.removeprefix("/Date(").split(")", 1)[0]
        try:
            return datetime.utcfromtimestamp(int(digits) / 1000)
        except ValueError:
            return None
    return None


def _normalize_unit(unit: str) -> str | None:
    clean = unit.strip()
    if not clean:
        return None
    if clean == "°C":
        return "C"
    if clean.upper() == "DEG":
        return "degrees"
    if clean.lower() == "u":
        return "index"
    return clean


def _measurement_hash(station_id: int, variable_id: int, observed_at: datetime, value: float) -> str:
    return hashlib.sha256(f"{station_id}|{variable_id}|{observed_at.isoformat()}|{value:.12g}".encode()).hexdigest()
