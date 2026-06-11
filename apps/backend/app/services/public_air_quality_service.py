from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case, desc, func, or_, select
from sqlalchemy.orm import Session

from app.core.time import ecuador_now_naive
from app.models.etl_run import EtlRun
from app.models.measurement import DATA_ORIGIN_PUBLIC, Measurement
from app.models.source_file import SourceFile
from app.models.station import Station
from app.models.variable import Variable
from app.schemas.public_air_quality import (
    PublicAirQualityResponse,
    PublicAirQualityVariableOption,
    PublicMeteorologySummary,
    PublicPeriodSummary,
    PublicStationObservation,
    PublicStationVariableObservation,
    PublicSyncSummary,
    PublicTimeSeriesPoint,
    PublicVariableSummary,
)
from app.services.etl import EtlService
from app.services.etl.helpers import normalize_variable_code
from app.services.etl.pipeline import REMMAQ_VARIABLE_CODES
from app.services.station_reference import resolve_station_reference, sync_station_reference_metadata

DEFAULT_PUBLIC_VARIABLE = "PM25"
PUBLIC_RANGE_MAX_DAYS = 31
PUBLIC_SERIES_ROW_LIMIT = 20_000
PUBLIC_LOCAL_TZ = ZoneInfo("America/Guayaquil")
PUBLIC_SYNC_MIN_INTERVAL = timedelta(hours=1)
PUBLIC_SYNC_ACTIVE_TIMEOUT = timedelta(hours=3)
PUBLIC_SYNC_LOOKBACK_DAYS = 540
PUBLIC_DEFAULT_PERIOD = "latest"
PUBLIC_DASHBOARD_SOURCE_TYPE = "public_dashboard"
PUBLIC_DASHBOARD_LEGACY_SOURCE_PREFIX = "aireambiente-current-"
PUBLIC_PERIOD_ALIASES = {
    "latest": "latest",
    "last_hour": "latest",
    "ultima_hora": "latest",
    "today": "today",
    "hoy": "today",
    "72h": "72h",
    "3d": "72h",
    "week": "week",
    "7d": "week",
    "month": "month",
    "mes": "month",
}
PUBLIC_METEOROLOGY_CODES = ("VEL", "DIR", "TMP", "HUM", "LLU", "RS", "IUV")
PUBLIC_VARIABLE_CATALOG: tuple[tuple[str, str, str, str | None], ...] = (
    ("PM25", "Material particulado fino PM2.5", "pollutant", "ug/m3"),
    ("PM10", "Material particulado PM10", "pollutant", "ug/m3"),
    ("NO2", "Dioxido de nitrogeno", "pollutant", "ug/m3"),
    ("O3", "Ozono", "pollutant", "ug/m3"),
    ("CO", "Monoxido de carbono", "pollutant", "mg/m3"),
    ("SO2", "Dioxido de azufre", "pollutant", "ug/m3"),
    ("TMP", "Temperatura", "meteorological", "C"),
    ("HUM", "Humedad relativa", "meteorological", "%"),
    ("VEL", "Velocidad del viento", "meteorological", "m/s"),
    ("DIR", "Direccion del viento", "meteorological", "degrees"),
    ("LLU", "Precipitacion", "meteorological", "mm"),
    ("RS", "Radiacion solar", "meteorological", "W/m2"),
    ("IUV", "Indice ultravioleta", "meteorological", "index"),
)
PUBLIC_VARIABLE_ORDER = {code: index for index, (code, _name, _category, _unit) in enumerate(PUBLIC_VARIABLE_CATALOG)}
PUBLIC_VARIABLE_ALIASES: dict[str, str] = {
    "PM25": "PM25",
    "PM25UG": "PM25",
    "PM2": "PM25",
    "PM2.5": "PM25",
    "PM10": "PM10",
    "PM10UG": "PM10",
    "NO2": "NO2",
    "NO2UG": "NO2",
    "SO2": "SO2",
    "SO2UG": "SO2",
    "O3": "O3",
    "OZONO": "O3",
    "OZONOUG": "O3",
    "CO": "CO",
    "COMG": "CO",
    "TMP": "TMP",
    "TEMP": "TMP",
    "TEMPAMB": "TMP",
    "TEMPERATURA": "TMP",
    "TEMPERATURAMEDIA": "TMP",
    "HUM": "HUM",
    "HUMREL": "HUM",
    "HUMEDAD": "HUM",
    "HUMEDADRELATIVA": "HUM",
    "VEL": "VEL",
    "RAPVEC": "VEL",
    "VELOCIDADVIENTO": "VEL",
    "VELOCIDADDELVIENTO": "VEL",
    "DIR": "DIR",
    "DIRVEC": "DIR",
    "DIRECCIONVIENTO": "DIR",
    "DIRECCIONDELVIENTO": "DIR",
    "LLU": "LLU",
    "LLUVIA": "LLU",
    "PRECIPITACION": "LLU",
    "PRE": "PRE",
    "PRESBAR": "PRE",
    "PRESION": "PRE",
    "PRESIONBAROMETRICA": "PRE",
    "RS": "RS",
    "RADSOLAR": "RS",
    "RADIACIONSOLAR": "RS",
    "IUV": "IUV",
    "UV": "IUV",
    "INDICEULTRAVIOLETA": "IUV",
    "RADIACIONULTRAVIOLETA": "IUV",
}
PUBLIC_METHODOLOGY_NOTES = [
    "Las estaciones son puntos observados REMMAQ; la superficie del mapa se estima en el cliente con IDW.",
    "El rango por defecto usa las ultimas lecturas disponibles por variable; no usa datos quemados.",
    "Los resumenes por variable pueden tener fechas distintas porque REMMAQ no siempre publica todas al mismo tiempo.",
]
PUBLIC_SNAPSHOT_CACHE_TTL = timedelta(minutes=1)
_PUBLIC_SNAPSHOT_CACHE: dict[
    tuple[int, str, date | None, date | None, int, str, int | None, str | None],
    tuple[datetime, PublicAirQualityResponse],
] = {}


def clear_public_snapshot_cache() -> None:
    _PUBLIC_SNAPSHOT_CACHE.clear()


@dataclass(frozen=True)
class PublicAirQualityWindow:
    start: datetime | None
    end: datetime | None


@dataclass(frozen=True)
class PublicVariableSelector:
    code: str
    variable_ids: tuple[int, ...]
    clean_variable_ids: tuple[int, ...]
    clean_source_file_ids: tuple[int, ...]
    source_file_ids: tuple[int, ...] = ()
    source_row_count: int = 0
    latest_ingested_at: datetime | None = None

    @property
    def has_sources(self) -> bool:
        return bool(
            (self.variable_ids and self.source_file_ids)
            or (self.clean_variable_ids and self.clean_source_file_ids)
        )


def prepare_public_remmaq_sync(
    db: Session,
    *,
    force_sync: bool = False,
    now: datetime | None = None,
) -> tuple[str, list[str], int, bool, date | None, date | None] | None:
    current_time = _to_utc_naive(now) or _utc_naive_now()
    recent_runs = list(
        db.scalars(
            select(EtlRun)
            .where(EtlRun.trigger_type == "automatic")
            .order_by(desc(EtlRun.started_at), desc(EtlRun.id))
            .limit(50)
        ).all()
    )

    active_cutoff = current_time - PUBLIC_SYNC_ACTIVE_TIMEOUT
    for run in recent_runs:
        if run.status == "running" and run.started_at and run.started_at >= active_cutoff:
            return None

    latest_public_run = next(
        (
            run
            for run in recent_runs
            if isinstance(run.details, dict) and run.details.get("public_dashboard_sync") is True
        ),
        None,
    )
    if (
        not force_sync
        and latest_public_run is not None
        and latest_public_run.started_at is not None
        and latest_public_run.started_at >= current_time - PUBLIC_SYNC_MIN_INTERVAL
    ):
        return None

    public_observed_from = (current_time.date() - timedelta(days=PUBLIC_SYNC_LOOKBACK_DAYS))
    service = EtlService(db)
    run, selected_variables, max_archives, force_reprocess, observed_from, observed_to = service.create_remmaq_run(
        variable_codes=list(REMMAQ_VARIABLE_CODES),
        max_archives=len(REMMAQ_VARIABLE_CODES),
        force_reprocess=False,
        observed_from=public_observed_from,
        observed_to=None,
    )
    details = dict(run.details or {})
    details.update(
        {
            "public_dashboard_sync": True,
            "public_dashboard_force_sync": force_sync,
            "public_dashboard_policy": "all_remmaq_variables_1_hour_throttle_recent_window",
            "public_dashboard_lookback_days": PUBLIC_SYNC_LOOKBACK_DAYS,
            # Marca el origen de datos para que run_remmaq_sync use data_origin='public'.
            "data_origin": DATA_ORIGIN_PUBLIC,
        }
    )
    run.details = details
    db.add(run)
    db.commit()
    db.refresh(run)
    return run.id, selected_variables, max_archives, force_reprocess, observed_from, observed_to


def _canonicalize_variable_code(code: str | None) -> str:
    normalized = normalize_variable_code(code or "")
    compact = normalized.replace("_", "")
    return PUBLIC_VARIABLE_ALIASES.get(compact, PUBLIC_VARIABLE_ALIASES.get(normalized, normalized))


def _source_name_to_public_code(value: str | None) -> str | None:
    normalized = _canonicalize_variable_code(value)
    if normalized in PUBLIC_VARIABLE_ORDER:
        return normalized
    compact = normalize_variable_code(value or "").replace("_", "")
    patterns: tuple[tuple[str, str], ...] = (
        ("PM25", "PM25"),
        ("PM10", "PM10"),
        ("NO2", "NO2"),
        ("SO2", "SO2"),
        ("OZONO", "O3"),
        ("O3", "O3"),
        ("CO", "CO"),
        ("TEMPAMB", "TMP"),
        ("TEMPERATURA", "TMP"),
        ("TMP", "TMP"),
        ("HUMREL", "HUM"),
        ("HUMEDAD", "HUM"),
        ("HUM", "HUM"),
        ("RAPVEC", "VEL"),
        ("VELOCIDAD", "VEL"),
        ("VEL", "VEL"),
        ("DIRVEC", "DIR"),
        ("DIRECCION", "DIR"),
        ("DIR", "DIR"),
        ("LLUVIA", "LLU"),
        ("PRECIPITACION", "LLU"),
        ("LLU", "LLU"),
        ("PRESBAR", "PRE"),
        ("PRESION", "PRE"),
        ("PRE", "PRE"),
        ("RADSOLAR", "RS"),
        ("RADIACIONSOLAR", "RS"),
        ("RS", "RS"),
        ("ULTRAVIOLETA", "IUV"),
        ("IUV", "IUV"),
    )
    for token, code in patterns:
        if token in compact:
            return code
    return None


def _public_source_condition() -> Any:
    return or_(
        SourceFile.source_type == PUBLIC_DASHBOARD_SOURCE_TYPE,
        SourceFile.original_name.startswith(PUBLIC_DASHBOARD_LEGACY_SOURCE_PREFIX),
    )


def _utc_naive_now() -> datetime:
    return ecuador_now_naive()


def _normalized_variable_sql_expr(column: Any) -> Any:
    expression = func.upper(column)
    for token in (" ", ".", "-", "_", "/", "(", ")", "[", "]", "{", "}"):
        expression = func.replace(expression, token, "")
    expression = func.replace(expression, "Î¼", "U")
    expression = func.replace(expression, "Âµ", "U")
    return expression


def _effective_variable_sql_expr() -> Any:
    normalized_code = _normalized_variable_sql_expr(Variable.code)
    source_name = _normalized_variable_sql_expr(func.coalesce(SourceFile.original_name, ""))
    is_clean_sheet = normalized_code == "LIMPIO"
    canonical_code = case(
        (normalized_code.in_(["PM25", "PM25UG"]), "PM25"),
        (normalized_code.in_(["PM10", "PM10UG"]), "PM10"),
        (normalized_code.in_(["NO2", "NO2UG"]), "NO2"),
        (normalized_code.in_(["SO2", "SO2UG"]), "SO2"),
        (normalized_code.in_(["O3", "OZONO", "OZONOUG"]), "O3"),
        (normalized_code.in_(["CO", "COMG"]), "CO"),
        (normalized_code.in_(["TMP", "TEMP", "TEMPAMB", "TEMPERATURA", "TEMPERATURAMEDIA"]), "TMP"),
        (normalized_code.in_(["HUM", "HUMREL", "HUMEDAD", "HUMEDADRELATIVA"]), "HUM"),
        (normalized_code.in_(["VEL", "RAPVEC", "VELOCIDADVIENTO", "VELOCIDADDELVIENTO"]), "VEL"),
        (normalized_code.in_(["DIR", "DIRVEC", "DIRECCIONVIENTO", "DIRECCIONDELVIENTO"]), "DIR"),
        (normalized_code.in_(["LLU", "LLUVIA", "PRECIPITACION"]), "LLU"),
        (normalized_code.in_(["PRE", "PRESBAR", "PRESION", "PRESIONBAROMETRICA"]), "PRE"),
        (normalized_code.in_(["RS", "RADSOLAR", "RADIACIONSOLAR"]), "RS"),
        (normalized_code.in_(["IUV", "UV", "INDICEULTRAVIOLETA", "RADIACIONULTRAVIOLETA"]), "IUV"),
        else_=normalized_code,
    )
    return case(
        (and_(is_clean_sheet, source_name.like("%PM25%")), "PM25"),
        (and_(is_clean_sheet, source_name.like("%PM25%")), "PM25"),
        (and_(is_clean_sheet, source_name.like("%PM10%")), "PM10"),
        (and_(is_clean_sheet, source_name.like("%NO2%")), "NO2"),
        (and_(is_clean_sheet, source_name.like("%SO2%")), "SO2"),
        (and_(is_clean_sheet, source_name.like("%O3%")), "O3"),
        (and_(is_clean_sheet, source_name.like("%OZONO%")), "O3"),
        (and_(is_clean_sheet, source_name.like("%CO%")), "CO"),
        (and_(is_clean_sheet, source_name.like("%TMP%")), "TMP"),
        (and_(is_clean_sheet, source_name.like("%TEMPAMB%")), "TMP"),
        (and_(is_clean_sheet, source_name.like("%TEMPERATURA%")), "TMP"),
        (and_(is_clean_sheet, source_name.like("%HUM%")), "HUM"),
        (and_(is_clean_sheet, source_name.like("%VEL%")), "VEL"),
        (and_(is_clean_sheet, source_name.like("%RAPVEC%")), "VEL"),
        (and_(is_clean_sheet, source_name.like("%VIENTO%")), "VEL"),
        (and_(is_clean_sheet, source_name.like("%DIR%")), "DIR"),
        (and_(is_clean_sheet, source_name.like("%DIRVEC%")), "DIR"),
        (and_(is_clean_sheet, source_name.like("%LLU%")), "LLU"),
        (and_(is_clean_sheet, source_name.like("%LLUVIA%")), "LLU"),
        (and_(is_clean_sheet, source_name.like("%PRECIPITACION%")), "LLU"),
        (and_(is_clean_sheet, source_name.like("%PRE%")), "PRE"),
        (and_(is_clean_sheet, source_name.like("%PRESBAR%")), "PRE"),
        (and_(is_clean_sheet, source_name.like("%PRESION%")), "PRE"),
        (and_(is_clean_sheet, source_name.like("%RS%")), "RS"),
        (and_(is_clean_sheet, source_name.like("%RADSOLAR%")), "RS"),
        (and_(is_clean_sheet, source_name.like("%RADIA%")), "RS"),
        (and_(is_clean_sheet, source_name.like("%IUV%")), "IUV"),
        (and_(is_clean_sheet, source_name.like("%ULTRAVIOLETA%")), "IUV"),
        else_=canonical_code,
    )


def _to_utc_naive(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _hour_window(anchor: datetime) -> PublicAirQualityWindow:
    start = anchor.replace(minute=0, second=0, microsecond=0)
    return PublicAirQualityWindow(start=start, end=start + timedelta(hours=1))


def _resolve_window(
    db: Session,
    *,
    selector: PublicVariableSelector | None = None,
    date_from: date | None,
    date_to: date | None,
    hours: int,
    period: str | None = None,
    hour: int | None = None,
    station_ids: tuple[int, ...] = (),
) -> PublicAirQualityWindow:
    if date_from and date_to and date_from > date_to:
        raise ValueError("date_from no puede ser mayor que date_to.")

    normalized_period = _normalize_period(period)
    if normalized_period is not None:
        anchor = _load_anchor_observed_at(db, selector, station_ids)
        if anchor is None:
            return PublicAirQualityWindow(start=None, end=None)
        if normalized_period == "latest":
            return _hour_window(anchor)
        if normalized_period == "today":
            anchor_day = anchor.date()
            if hour is not None:
                bounded_hour = max(0, min(23, hour))
                start = datetime.combine(anchor_day, time(hour=bounded_hour))
                return PublicAirQualityWindow(start=start, end=start + timedelta(hours=1))
            start = datetime.combine(anchor_day, time.min)
            return PublicAirQualityWindow(start=start, end=start + timedelta(days=1))
        if normalized_period == "72h":
            return PublicAirQualityWindow(
                start=anchor - timedelta(hours=72) + timedelta(seconds=1),
                end=anchor + timedelta(hours=1),
            )
        if normalized_period == "week":
            return PublicAirQualityWindow(
                start=anchor - timedelta(days=7) + timedelta(seconds=1),
                end=anchor + timedelta(hours=1),
            )
        if normalized_period == "month":
            start = datetime(anchor.year, anchor.month, 1)
            next_month = datetime(
                anchor.year + int(anchor.month == 12),
                1 if anchor.month == 12 else anchor.month + 1,
                1,
            )
            return PublicAirQualityWindow(start=start, end=next_month)

    if date_from or date_to:
        start = datetime.combine(date_from, time.min) if date_from else None
        end = datetime.combine(date_to + timedelta(days=1), time.min) if date_to else None
    else:
        anchor = _load_anchor_observed_at(db, selector, station_ids)
        if anchor is None:
            return PublicAirQualityWindow(start=None, end=None)
        bounded_hours = max(1, min(hours, PUBLIC_RANGE_MAX_DAYS * 24))
        end = anchor + timedelta(seconds=1)
        start = anchor - timedelta(hours=bounded_hours)

    if start is not None and end is not None and end - start > timedelta(days=PUBLIC_RANGE_MAX_DAYS + 1):
        raise ValueError(f"El rango publico no puede superar {PUBLIC_RANGE_MAX_DAYS} dias.")

    return PublicAirQualityWindow(start=start, end=end)


def _normalize_period(period: str | None) -> str | None:
    if not period:
        return None
    return PUBLIC_PERIOD_ALIASES.get(period.strip().lower())


def _load_anchor_observed_at(
    db: Session,
    selector: PublicVariableSelector | None,
    station_ids: tuple[int, ...] = (),
) -> datetime | None:
    anchor_statement = select(func.max(Measurement.observed_at))
    if selector is not None:
        anchor_statement = _apply_selector(anchor_statement, selector)
    anchor_statement = _apply_station_filter(anchor_statement, station_ids)
    anchor = db.scalar(anchor_statement)
    return anchor


def _apply_station_filter(statement: Any, station_ids: tuple[int, ...]) -> Any:
    if station_ids:
        return statement.where(Measurement.station_id.in_(station_ids))
    return statement


def _resolve_station_ids(db: Session, station_code: str | None) -> tuple[int, ...]:
    if not station_code:
        return ()
    normalized = station_code.strip()
    if not normalized or normalized.lower() == "all":
        return ()
    rows = db.scalars(
        select(Station.id).where(
            or_(
                func.upper(Station.code) == normalized.upper(),
                func.upper(Station.name) == normalized.upper(),
            )
        )
    ).all()
    return tuple(int(row) for row in rows)


def _apply_window(statement: Any, window: PublicAirQualityWindow) -> Any:
    if window.start is not None:
        statement = statement.where(Measurement.observed_at >= window.start)
    if window.end is not None:
        statement = statement.where(Measurement.observed_at < window.end)
    return statement


def _current_local_day_window(now: datetime) -> PublicAirQualityWindow:
    local_now = now.astimezone(PUBLIC_LOCAL_TZ)
    local_start = datetime.combine(local_now.date(), time.min)
    return PublicAirQualityWindow(start=local_start, end=local_start + timedelta(days=1))


def _load_variable_options(db: Session) -> tuple[list[PublicAirQualityVariableOption], dict[str, Variable]]:
    variable_rows = db.scalars(select(Variable).order_by(Variable.code.asc())).all()
    canonical_variables: dict[str, Variable] = {}
    option_map: dict[str, PublicAirQualityVariableOption] = {
        code: PublicAirQualityVariableOption(code=code, name=name, category=category, unit=unit)
        for code, name, category, unit in PUBLIC_VARIABLE_CATALOG
    }
    for variable in variable_rows:
        code = _canonicalize_variable_code(variable.code)
        if code in PUBLIC_VARIABLE_ORDER:
            catalog_option = option_map.get(code)
            canonical_variables[code] = variable
            display_name = (variable.display_name or "").strip()
            catalog_name = catalog_option.name if catalog_option else code
            public_name = catalog_name if not display_name or display_name.upper() == code else display_name
            option_map[code] = PublicAirQualityVariableOption(
                code=code,
                name=public_name,
                category=(catalog_option.category if catalog_option else variable.category),
                unit=variable.default_unit or (catalog_option.unit if catalog_option else None),
            )

    options = sorted(
        option_map.values(),
        key=lambda item: (PUBLIC_VARIABLE_ORDER.get(item.code, len(PUBLIC_VARIABLE_ORDER)), item.code),
    )
    return options, canonical_variables


def _load_variable_selectors(db: Session) -> dict[str, PublicVariableSelector]:
    variables = db.scalars(select(Variable)).all()
    source_files = db.scalars(select(SourceFile).where(_public_source_condition())).all()
    direct_ids: dict[str, list[int]] = defaultdict(list)
    clean_ids: list[int] = []
    clean_source_ids: dict[str, list[int]] = defaultdict(list)
    source_ids: dict[str, list[int]] = defaultdict(list)
    source_row_counts: dict[str, int] = defaultdict(int)
    latest_ingested: dict[str, datetime] = {}

    for variable in variables:
        code = _canonicalize_variable_code(variable.code)
        if code == "LIMPIO":
            clean_ids.append(variable.id)
            continue
        if code in PUBLIC_VARIABLE_ORDER:
            direct_ids[code].append(variable.id)

    for source_file in source_files:
        code = _source_name_to_public_code(source_file.original_name) or _source_name_to_public_code(
            source_file.source_url
        )
        source_timestamp = source_file.processed_at or source_file.downloaded_at
        for public_code in PUBLIC_VARIABLE_ORDER:
            source_ids[public_code].append(source_file.id)
            if source_timestamp and (
                public_code not in latest_ingested or source_timestamp > latest_ingested[public_code]
            ):
                latest_ingested[public_code] = source_timestamp

        if code in PUBLIC_VARIABLE_ORDER:
            clean_source_ids[code].append(source_file.id)
            source_row_counts[code] += int(source_file.row_count or 0)

    return {
        code: PublicVariableSelector(
            code=code,
            variable_ids=tuple(sorted(set(direct_ids.get(code, [])))),
            clean_variable_ids=tuple(sorted(set(clean_ids))),
            clean_source_file_ids=tuple(sorted(set(clean_source_ids.get(code, [])))),
            source_file_ids=tuple(sorted(set(source_ids.get(code, [])))),
            source_row_count=source_row_counts.get(code, 0),
            latest_ingested_at=latest_ingested.get(code),
        )
        for code in PUBLIC_VARIABLE_ORDER
    }


def _selector_condition(selector: PublicVariableSelector) -> Any:
    conditions = []
    if selector.variable_ids:
        conditions.append(
            and_(
                Measurement.variable_id.in_(selector.variable_ids),
                Measurement.source_file_id.in_(selector.source_file_ids),
            )
        )
    if selector.clean_variable_ids and selector.clean_source_file_ids:
        conditions.append(
            and_(
                Measurement.variable_id.in_(selector.clean_variable_ids),
                Measurement.source_file_id.in_(selector.clean_source_file_ids),
            )
        )
    if not conditions:
        return False
    return conditions[0] if len(conditions) == 1 else or_(*conditions)


def _apply_selector(statement: Any, selector: PublicVariableSelector) -> Any:
    if not selector.has_sources:
        return statement.where(False)
    return statement.where(_selector_condition(selector))


def get_public_air_quality_snapshot(
    db: Session,
    *,
    variable_code: str = DEFAULT_PUBLIC_VARIABLE,
    date_from: date | None = None,
    date_to: date | None = None,
    hours: int = 24,
    period: str = PUBLIC_DEFAULT_PERIOD,
    hour: int | None = None,
    station_code: str | None = None,
    use_cache: bool = True,
) -> PublicAirQualityResponse:
    selected_code = _canonicalize_variable_code(variable_code) or DEFAULT_PUBLIC_VARIABLE
    if selected_code not in PUBLIC_VARIABLE_ORDER:
        selected_code = DEFAULT_PUBLIC_VARIABLE
    normalized_hours = max(1, min(hours, PUBLIC_RANGE_MAX_DAYS * 24))
    normalized_period = _normalize_period(period) or PUBLIC_DEFAULT_PERIOD
    normalized_hour = max(0, min(23, hour)) if hour is not None else None
    normalized_station_code = station_code.strip().upper() if station_code and station_code != "all" else None
    cache_key = (
        id(db.get_bind()),
        selected_code,
        date_from,
        date_to,
        normalized_hours,
        normalized_period,
        normalized_hour,
        normalized_station_code,
    )
    now = datetime.now(UTC)
    if use_cache:
        cached = _PUBLIC_SNAPSHOT_CACHE.get(cache_key)
        if cached is not None and now - cached[0] <= PUBLIC_SNAPSHOT_CACHE_TTL:
            return cached[1]

    response = _build_public_air_quality_snapshot(
        db,
        variable_code=selected_code,
        date_from=date_from,
        date_to=date_to,
        hours=normalized_hours,
        period=normalized_period,
        hour=normalized_hour,
        station_code=normalized_station_code,
    )
    _PUBLIC_SNAPSHOT_CACHE[cache_key] = (now, response)
    if len(_PUBLIC_SNAPSHOT_CACHE) > 64:
        oldest_key = min(_PUBLIC_SNAPSHOT_CACHE, key=lambda key: _PUBLIC_SNAPSHOT_CACHE[key][0])
        _PUBLIC_SNAPSHOT_CACHE.pop(oldest_key, None)
    return response


def _build_public_air_quality_snapshot(
    db: Session,
    *,
    variable_code: str = DEFAULT_PUBLIC_VARIABLE,
    date_from: date | None = None,
    date_to: date | None = None,
    hours: int = 24,
    period: str | None = PUBLIC_DEFAULT_PERIOD,
    hour: int | None = None,
    station_code: str | None = None,
) -> PublicAirQualityResponse:
    sync_station_reference_metadata(db)
    variables, variable_map = _load_variable_options(db)
    selectors = _load_variable_selectors(db)
    variable_option_map = {variable.code: variable for variable in variables}
    selected_code = _canonicalize_variable_code(variable_code) or DEFAULT_PUBLIC_VARIABLE
    selected_variable = variable_map.get(selected_code)
    selected_option = variable_option_map.get(selected_code)
    if selected_option is None:
        selected_code = DEFAULT_PUBLIC_VARIABLE
        selected_variable = variable_map.get(selected_code)
        selected_option = variable_option_map.get(selected_code)

    station_ids = _resolve_station_ids(db, station_code)
    uses_relative_window = not date_from and not date_to
    window = _resolve_window(
        db,
        selector=selectors.get(selected_code) if uses_relative_window or period else None,
        date_from=date_from,
        date_to=date_to,
        hours=hours,
        period=period if uses_relative_window else None,
        hour=hour,
        station_ids=station_ids,
    )
    generated_at = datetime.now(UTC)
    today_window = _current_local_day_window(generated_at)
    variable_summaries = _load_variable_summaries(
        db,
        variables,
        selectors,
        window,
        today_window,
        rolling_hours=max(1, min(hours, PUBLIC_RANGE_MAX_DAYS * 24)) if uses_relative_window else None,
        station_ids=station_ids,
        period=period if uses_relative_window else None,
    )
    sync_summary = _load_sync_summary(db, today_window)
    latest_ingested_at = db.scalar(
        select(func.max(Measurement.updated_at))
        .join(SourceFile, SourceFile.id == Measurement.source_file_id)
        .where(
            _public_source_condition(),
            Measurement.data_origin == DATA_ORIGIN_PUBLIC,
        )
    )
    today_observation_count = db.scalar(
        _apply_window(
            select(func.count(Measurement.id))
            .select_from(Measurement)
            .where(Measurement.data_origin == DATA_ORIGIN_PUBLIC),
            today_window,
        )
    ) or 0

    if window.start is None or window.end is None:
        return PublicAirQualityResponse(
            variable_code=selected_code,
            variable_name=selected_option.name if selected_option else selected_code,
            unit=selected_option.unit if selected_option else None,
            generated_at=generated_at,
            latest_ingested_at=latest_ingested_at,
            today_observation_count=int(today_observation_count),
            station_count=0,
            observation_count=0,
            variables=variables,
            variable_summaries=variable_summaries,
            period_summary=PublicPeriodSummary(unit=selected_option.unit if selected_option else None),
            sync=sync_summary,
            methodology_notes=PUBLIC_METHODOLOGY_NOTES,
        )

    selected_unit = (
        (selected_variable.default_unit if selected_variable else None)
        or (selected_option.unit if selected_option else None)
    )
    selected_selector = selectors.get(selected_code) or PublicVariableSelector(selected_code, (), (), ())
    stations = _load_station_observations(
        db,
        selected_code,
        selected_selector,
        selected_unit,
        window,
        selectors,
        station_ids,
    )
    time_series, observation_count = _load_public_time_series(db, selected_selector, window, station_ids)
    meteorology = _load_meteorology_summary(db, window, selectors, station_ids)
    period_summary = _load_period_summary(db, selected_selector, window, selected_unit, station_ids)
    latest_observed_at = max((station.latest_observed_at for station in stations), default=None)

    return PublicAirQualityResponse(
        variable_code=selected_code,
        variable_name=(selected_variable.display_name if selected_variable else None)
        or (selected_option.name if selected_option else selected_code),
        unit=selected_unit,
        date_from=window.start,
        date_to=window.end,
        generated_at=generated_at,
        latest_observed_at=latest_observed_at,
        latest_ingested_at=latest_ingested_at,
        today_observation_count=int(today_observation_count),
        station_count=len(stations),
        observation_count=observation_count,
        variables=variables,
        stations=stations,
        time_series=time_series,
        meteorology=meteorology,
        variable_summaries=variable_summaries,
        period_summary=period_summary,
        sync=sync_summary,
        methodology_notes=PUBLIC_METHODOLOGY_NOTES,
    )


def _load_period_summary(
    db: Session,
    selector: PublicVariableSelector,
    window: PublicAirQualityWindow,
    unit: str | None,
    station_ids: tuple[int, ...] = (),
) -> PublicPeriodSummary:
    aggregate = _load_variable_aggregate(db, selector, window, station_ids)
    if aggregate is None:
        return PublicPeriodSummary(unit=unit, date_from=window.start, date_to=window.end)

    sample_count = int(aggregate.sample_count or 0)
    return PublicPeriodSummary(
        max_value=float(aggregate.max_value) if aggregate.max_value is not None else None,
        avg_value=float(aggregate.mean_value) if aggregate.mean_value is not None else None,
        rds=sample_count,
        sample_count=sample_count,
        station_count=int(aggregate.station_count or 0),
        unit=unit,
        date_from=window.start,
        date_to=window.end,
    )


def _load_variable_summaries(
    db: Session,
    variables: list[PublicAirQualityVariableOption],
    selectors: dict[str, PublicVariableSelector],
    window: PublicAirQualityWindow,
    today_window: PublicAirQualityWindow,
    rolling_hours: int | None = None,
    station_ids: tuple[int, ...] = (),
    period: str | None = None,
) -> list[PublicVariableSummary]:
    if window.start is None or window.end is None:
        return [
            PublicVariableSummary(
                variable_code=variable.code,
                variable_name=variable.name,
                category=variable.category,
                unit=variable.unit,
            )
            for variable in variables
        ]

    summaries: list[PublicVariableSummary] = []
    normalized_period = _normalize_period(period)
    for variable in variables:
        selector = selectors.get(variable.code) or PublicVariableSelector(variable.code, (), (), ())
        global_latest_row = _load_variable_latest(db, selector, None, station_ids)
        variable_window = window
        if normalized_period == "latest" and global_latest_row is not None:
            variable_window = _hour_window(global_latest_row.observed_at)
        elif normalized_period == "today" and global_latest_row is not None:
            start = datetime.combine(global_latest_row.observed_at.date(), time.min)
            variable_window = PublicAirQualityWindow(start=start, end=start + timedelta(days=1))
        elif normalized_period == "72h" and global_latest_row is not None:
            variable_window = PublicAirQualityWindow(
                start=global_latest_row.observed_at - timedelta(hours=72) + timedelta(seconds=1),
                end=global_latest_row.observed_at + timedelta(hours=1),
            )
        elif normalized_period == "week" and global_latest_row is not None:
            variable_window = PublicAirQualityWindow(
                start=global_latest_row.observed_at - timedelta(days=7) + timedelta(seconds=1),
                end=global_latest_row.observed_at + timedelta(hours=1),
            )
        elif normalized_period == "month" and global_latest_row is not None:
            next_month = datetime(
                global_latest_row.observed_at.year + int(global_latest_row.observed_at.month == 12),
                1 if global_latest_row.observed_at.month == 12 else global_latest_row.observed_at.month + 1,
                1,
            )
            variable_window = PublicAirQualityWindow(
                start=datetime(global_latest_row.observed_at.year, global_latest_row.observed_at.month, 1),
                end=next_month,
            )
        elif rolling_hours is not None and global_latest_row is not None:
            variable_window = PublicAirQualityWindow(
                start=global_latest_row.observed_at - timedelta(hours=rolling_hours),
                end=global_latest_row.observed_at + timedelta(seconds=1),
            )
        aggregate = _load_variable_aggregate(db, selector, variable_window, station_ids)
        latest_row = _load_variable_latest(db, selector, variable_window, station_ids)
        today_count = (
            _load_variable_count(db, selector, today_window, station_ids)
            if global_latest_row is not None
            and today_window.start is not None
            and today_window.end is not None
            and today_window.start <= global_latest_row.observed_at < today_window.end
            else 0
        )
        summaries.append(
            PublicVariableSummary(
                variable_code=variable.code,
                variable_name=variable.name,
                category=variable.category,
                unit=(latest_row.unit if latest_row else None)
                or (global_latest_row.unit if global_latest_row else None)
                or variable.unit,
                mean_value=float(aggregate.mean_value) if aggregate and aggregate.mean_value is not None else None,
                min_value=float(aggregate.min_value) if aggregate and aggregate.min_value is not None else None,
                max_value=float(aggregate.max_value) if aggregate and aggregate.max_value is not None else None,
                latest_value=float(latest_row.value) if latest_row else None,
                latest_observed_at=latest_row.observed_at if latest_row else None,
                first_available_at=None,
                latest_available_at=global_latest_row.observed_at if global_latest_row else None,
                latest_ingested_at=selector.latest_ingested_at
                or (global_latest_row.updated_at if global_latest_row else None),
                total_sample_count=selector.source_row_count,
                today_sample_count=today_count,
                sample_count=int(aggregate.sample_count or 0) if aggregate else 0,
                station_count=int(aggregate.station_count or 0) if aggregate else 0,
            )
        )
    return summaries


def _load_variable_availability(db: Session, selector: PublicVariableSelector) -> Any | None:
    if not selector.has_sources:
        return None
    statement = select(
        func.min(Measurement.observed_at).label("first_available_at"),
        func.max(Measurement.observed_at).label("latest_available_at"),
        func.max(Measurement.updated_at).label("latest_ingested_at"),
        func.count(Measurement.id).label("total_sample_count"),
        func.count(func.distinct(Measurement.station_id)).label("total_station_count"),
    )
    return db.execute(_apply_selector(statement, selector)).first()


def _load_variable_aggregate(
    db: Session,
    selector: PublicVariableSelector,
    window: PublicAirQualityWindow | None,
    station_ids: tuple[int, ...] = (),
) -> Any | None:
    if not selector.has_sources:
        return None
    statement = select(
        func.avg(Measurement.value).label("mean_value"),
        func.min(Measurement.value).label("min_value"),
        func.max(Measurement.value).label("max_value"),
        func.count(Measurement.id).label("sample_count"),
        func.count(func.distinct(Measurement.station_id)).label("station_count"),
    )
    statement = _apply_selector(statement, selector)
    statement = _apply_station_filter(statement, station_ids)
    if window is not None:
        statement = _apply_window(statement, window)
    return db.execute(statement).first()


def _load_variable_latest(
    db: Session,
    selector: PublicVariableSelector,
    window: PublicAirQualityWindow | None,
    station_ids: tuple[int, ...] = (),
) -> Any | None:
    if not selector.has_sources:
        return None
    statement = (
        select(Measurement.value, Measurement.unit, Measurement.observed_at, Measurement.updated_at)
        .order_by(Measurement.observed_at.desc())
        .limit(1)
    )
    statement = _apply_selector(statement, selector)
    statement = _apply_station_filter(statement, station_ids)
    if window is not None:
        statement = _apply_window(statement, window)
    return db.execute(statement).first()


def _load_variable_count(
    db: Session,
    selector: PublicVariableSelector,
    window: PublicAirQualityWindow,
    station_ids: tuple[int, ...] = (),
) -> int:
    if not selector.has_sources:
        return 0
    statement = _apply_station_filter(_apply_selector(select(func.count(Measurement.id)), selector), station_ids)
    statement = _apply_window(statement, window)
    return int(db.scalar(statement) or 0)


def _load_sync_summary(db: Session, today_window: PublicAirQualityWindow) -> PublicSyncSummary:
    recent_runs = list(
        db.scalars(
            select(EtlRun)
            .where(EtlRun.trigger_type == "automatic")
            .order_by(desc(EtlRun.started_at), desc(EtlRun.id))
            .limit(50)
        ).all()
    )
    latest_run = next(
        (
            run
            for run in recent_runs
            if isinstance(run.details, dict)
            and (
                run.details.get("public_dashboard_current_sync") is True
                or run.details.get("public_dashboard_sync") is True
            )
        ),
        recent_runs[0] if recent_runs else None,
    )
    latest_source = db.scalar(
        select(SourceFile)
        .where(_public_source_condition())
        .order_by(desc(SourceFile.processed_at), desc(SourceFile.downloaded_at), desc(SourceFile.id))
        .limit(1)
    )

    records_today_statement = (
        select(func.count(Measurement.id))
        .select_from(Measurement)
        .join(SourceFile, SourceFile.id == Measurement.source_file_id)
        .where(_public_source_condition())
    )
    if today_window.start is not None:
        records_today_statement = records_today_statement.where(Measurement.created_at >= today_window.start)
    if today_window.end is not None:
        records_today_statement = records_today_statement.where(Measurement.created_at < today_window.end)
    records_today = db.scalar(records_today_statement) or 0

    return PublicSyncSummary(
        status=latest_run.status if latest_run else "unknown",
        latest_run_started_at=latest_run.started_at if latest_run else None,
        latest_run_finished_at=latest_run.finished_at if latest_run else None,
        latest_source_downloaded_at=latest_source.downloaded_at if latest_source else None,
        latest_source_processed_at=latest_source.processed_at if latest_source else None,
        records_today=int(records_today),
        records_inserted=int(latest_run.records_inserted or 0) if latest_run else 0,
        records_updated=int(latest_run.records_updated or 0) if latest_run else 0,
        records_skipped=int(latest_run.records_skipped or 0) if latest_run else 0,
        archives_processed=int(latest_run.archives_processed or 0) if latest_run else 0,
    )


def _load_station_observations(
    db: Session,
    variable_code: str,
    selector: PublicVariableSelector,
    variable_unit: str | None,
    window: PublicAirQualityWindow,
    selectors: dict[str, PublicVariableSelector],
    station_ids: tuple[int, ...] = (),
) -> list[PublicStationObservation]:
    aggregate_statement = (
        select(
            Station.id.label("station_id"),
            Station.code.label("station_code"),
            Station.name.label("station_name"),
            Station.latitude.label("latitude"),
            Station.longitude.label("longitude"),
            func.avg(Measurement.value).label("mean_value"),
            func.min(Measurement.value).label("min_value"),
            func.max(Measurement.value).label("max_value"),
            func.count(Measurement.id).label("sample_count"),
            func.max(Measurement.observed_at).label("latest_observed_at"),
        )
        .join(Measurement, Measurement.station_id == Station.id)
        .group_by(Station.id, Station.code, Station.name, Station.latitude, Station.longitude)
    )
    aggregate_statement = _apply_selector(aggregate_statement, selector)
    aggregate_statement = _apply_station_filter(aggregate_statement, station_ids)
    aggregate_rows = db.execute(_apply_window(aggregate_statement, window)).all()

    latest_statement = select(
        Measurement.station_id.label("station_id"),
        Measurement.value.label("value"),
        Measurement.unit.label("unit"),
        Measurement.observed_at.label("observed_at"),
        func.row_number()
        .over(partition_by=Measurement.station_id, order_by=Measurement.observed_at.desc())
        .label("row_num"),
    ).select_from(Measurement)
    latest_statement = _apply_station_filter(_apply_selector(latest_statement, selector), station_ids)
    latest_ranked = _apply_window(latest_statement, window).subquery()
    latest_rows = db.execute(select(latest_ranked).where(latest_ranked.c.row_num == 1)).all()
    latest_by_station = {row.station_id: row for row in latest_rows}

    observations: list[PublicStationObservation] = []
    station_ids_by_code: dict[str, int] = {}
    for row in aggregate_rows:
        latest = latest_by_station.get(row.station_id)
        reference = resolve_station_reference(row.station_code, row.station_name)
        latitude = row.latitude if row.latitude is not None else (reference.latitude if reference else None)
        longitude = row.longitude if row.longitude is not None else (reference.longitude if reference else None)
        if latitude is None or longitude is None or latest is None:
            continue
        observations.append(
            PublicStationObservation(
                station_code=row.station_code,
                station_name=row.station_name,
                latitude=float(latitude),
                longitude=float(longitude),
                region=reference.region if reference else None,
                latest_value=float(latest.value),
                mean_value=float(row.mean_value),
                min_value=float(row.min_value),
                max_value=float(row.max_value),
                sample_count=int(row.sample_count),
                unit=latest.unit or variable_unit,
                latest_observed_at=latest.observed_at,
            )
        )
        station_ids_by_code[row.station_code] = row.station_id

    station_variables = _load_latest_station_variables(db, list(station_ids_by_code.values()), selectors)
    for observation in observations:
        observation.variables = station_variables.get(station_ids_by_code.get(observation.station_code), [])
    observations.sort(key=lambda item: item.station_name)
    return observations


def _load_latest_station_variables(
    db: Session,
    station_ids: list[int],
    selectors: dict[str, PublicVariableSelector],
) -> dict[int, list[PublicStationVariableObservation]]:
    if not station_ids:
        return {}

    catalog = {
        code: PublicAirQualityVariableOption(code=code, name=name, category=category, unit=unit)
        for code, name, category, unit in PUBLIC_VARIABLE_CATALOG
    }
    variables_by_station: dict[int, list[PublicStationVariableObservation]] = defaultdict(list)
    for code in PUBLIC_VARIABLE_ORDER:
        selector = selectors.get(code)
        catalog_item = catalog.get(code)
        if selector is None or catalog_item is None or not selector.has_sources:
            continue
        ranked = (
            _apply_selector(
                select(
                    Measurement.station_id.label("station_id"),
                    Measurement.value.label("value"),
                    Measurement.unit.label("unit"),
                    Measurement.observed_at.label("observed_at"),
                    func.row_number()
                    .over(partition_by=Measurement.station_id, order_by=Measurement.observed_at.desc())
                    .label("row_num"),
                ).where(Measurement.station_id.in_(station_ids)),
                selector,
            )
        ).subquery()
        rows = db.execute(select(ranked).where(ranked.c.row_num == 1)).all()
        for row in rows:
            variables_by_station[int(row.station_id)].append(
                PublicStationVariableObservation(
                    variable_code=code,
                    variable_name=catalog_item.name,
                    category=catalog_item.category,
                    value=float(row.value),
                    unit=row.unit or catalog_item.unit,
                    observed_at=row.observed_at,
                )
            )

    for items in variables_by_station.values():
        items.sort(key=lambda item: PUBLIC_VARIABLE_ORDER.get(item.variable_code, len(PUBLIC_VARIABLE_ORDER)))
    return variables_by_station


def _series_bucket(value: datetime, *, use_daily: bool) -> datetime:
    if use_daily:
        return datetime(value.year, value.month, value.day)
    return datetime(value.year, value.month, value.day, value.hour)


def _load_public_time_series(
    db: Session,
    selector: PublicVariableSelector,
    window: PublicAirQualityWindow,
    station_ids: tuple[int, ...] = (),
) -> tuple[list[PublicTimeSeriesPoint], int]:
    statement = (
        select(Measurement.observed_at, Measurement.value)
        .order_by(Measurement.observed_at.asc())
        .limit(PUBLIC_SERIES_ROW_LIMIT)
    )
    statement = _apply_selector(statement, selector)
    statement = _apply_station_filter(statement, station_ids)
    rows = db.execute(_apply_window(statement, window)).all()
    if not rows:
        return [], 0

    use_daily = bool(window.start and window.end and window.end - window.start > timedelta(days=7))
    buckets: dict[datetime, list[float]] = defaultdict(list)
    for row in rows:
        buckets[_series_bucket(row.observed_at, use_daily=use_daily)].append(float(row.value))

    points = [
        PublicTimeSeriesPoint(
            timestamp=timestamp,
            mean_value=sum(values) / len(values),
            min_value=min(values),
            max_value=max(values),
            sample_count=len(values),
        )
        for timestamp, values in sorted(buckets.items(), key=lambda item: item[0])
    ]
    return points, len(rows)


def _load_meteorology_summary(
    db: Session,
    window: PublicAirQualityWindow,
    selectors: dict[str, PublicVariableSelector],
    station_ids: tuple[int, ...] = (),
) -> list[PublicMeteorologySummary]:
    summaries: list[PublicMeteorologySummary] = []
    catalog = {
        code: PublicAirQualityVariableOption(code=code, name=name, category=category, unit=unit)
        for code, name, category, unit in PUBLIC_VARIABLE_CATALOG
    }
    for code in PUBLIC_METEOROLOGY_CODES:
        catalog_item = catalog.get(code)
        selector = selectors.get(code)
        if selector is None or not selector.has_sources:
            continue
        aggregate_statement = (
            select(
                func.avg(Measurement.value).label("mean_value"),
                func.count(Measurement.id).label("sample_count"),
            )
        )
        aggregate_statement = _apply_selector(aggregate_statement, selector)
        aggregate_statement = _apply_station_filter(aggregate_statement, station_ids)
        aggregate = db.execute(_apply_window(aggregate_statement, window)).one()

        latest_statement = (
            select(Measurement.value, Measurement.unit, Measurement.observed_at)
            .order_by(Measurement.observed_at.desc())
            .limit(1)
        )
        latest_statement = _apply_selector(latest_statement, selector)
        latest_statement = _apply_station_filter(latest_statement, station_ids)
        latest = db.execute(_apply_window(latest_statement, window)).first()
        if not latest and not int(aggregate.sample_count or 0):
            continue
        summaries.append(
            PublicMeteorologySummary(
                variable_code=code,
                variable_name=(catalog_item.name if catalog_item else code),
                unit=(latest.unit if latest else None) or (catalog_item.unit if catalog_item else None),
                mean_value=float(aggregate.mean_value) if aggregate.mean_value is not None else None,
                latest_value=float(latest.value) if latest else None,
                latest_observed_at=latest.observed_at if latest else None,
                sample_count=int(aggregate.sample_count or 0),
            )
        )
    return summaries
