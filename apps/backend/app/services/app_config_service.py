from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.app_config import AppConfig
from app.schemas.app_config import AppConfigItem, AppConfigResponse, AppConfigUpdateRequest

ConfigKind = Literal["int", "float"]
ConfigGroup = Literal["analytics", "workspace"]


@dataclass(frozen=True)
class ConfigDefinition:
    key: str
    default: int | float
    description: str
    group: ConfigGroup
    kind: ConfigKind
    minimum: float
    maximum: float


CONFIG_DEFINITIONS: tuple[ConfigDefinition, ...] = (
    ConfigDefinition(
        "analytics.max_statsmodels_points",
        5000,
        "Limite serie ARIMA/SARIMA",
        "analytics",
        "int",
        1,
        1_000_000,
    ),
    ConfigDefinition("analytics.max_prophet_points", 20000, "Limite serie Prophet", "analytics", "int", 1, 1_000_000),
    ConfigDefinition(
        "analytics.max_figure_points",
        4000,
        "Max puntos renderizados en grafico",
        "analytics",
        "int",
        100,
        1_000_000,
    ),
    ConfigDefinition(
        "analytics.min_series_length_sarima",
        12,
        "Minimo puntos para SARIMA",
        "analytics",
        "int",
        1,
        10_000,
    ),
    ConfigDefinition(
        "analytics.min_series_length_arima",
        8,
        "Minimo puntos para ARIMA",
        "analytics",
        "int",
        1,
        10_000,
    ),
    ConfigDefinition(
        "analytics.min_series_length_prophet",
        3,
        "Minimo puntos para Prophet",
        "analytics",
        "int",
        1,
        10_000,
    ),
    ConfigDefinition(
        "analytics.default_query_limit",
        5000,
        "Filas por defecto en query",
        "analytics",
        "int",
        1,
        500_000,
    ),
    ConfigDefinition(
        "analytics.source_list_limit",
        300,
        "Max fuentes devueltas en filtros",
        "analytics",
        "int",
        1,
        10_000,
    ),
    ConfigDefinition("workspace.default_rolling_window", 0, "Ventana rolling", "workspace", "int", 0, 3650),
    ConfigDefinition("workspace.default_decomposition_window", 21, "Ventana STL", "workspace", "int", 2, 3650),
    ConfigDefinition(
        "workspace.default_forecast_horizon",
        30,
        "Horizonte de pronostico (periodos)",
        "workspace",
        "int",
        1,
        365,
    ),
    ConfigDefinition("workspace.default_changepoint_window", 7, "Ventana changepoints", "workspace", "int", 1, 3650),
    ConfigDefinition(
        "workspace.default_changepoint_sensitivity",
        2,
        "Sensibilidad changepoints",
        "workspace",
        "float",
        0.1,
        10,
    ),
    ConfigDefinition("workspace.default_histogram_bins", 32, "Bins histograma", "workspace", "int", 1, 200),
    ConfigDefinition("workspace.default_confidence_level", 0.95, "Nivel IC (0-1)", "workspace", "float", 0.5, 0.99),
    ConfigDefinition(
        "workspace.default_marker_opacity",
        0.78,
        "Opacidad marcadores scatter",
        "workspace",
        "float",
        0.05,
        1,
    ),
    ConfigDefinition("workspace.default_marker_size", 7, "Tamano marcadores scatter", "workspace", "int", 1, 30),
    ConfigDefinition(
        "workspace.default_facet_columns",
        2,
        "Columnas en facet multi-variable",
        "workspace",
        "int",
        1,
        6,
    ),
)

CONFIG_BY_KEY = {definition.key: definition for definition in CONFIG_DEFINITIONS}


class AppConfigError(Exception):
    pass


def get_default_config_map() -> dict[str, int | float]:
    return {definition.key: definition.default for definition in CONFIG_DEFINITIONS}


def get_app_config(db: Session) -> AppConfigResponse:
    config_map = get_config_map(db)
    return AppConfigResponse(
        items=[
            AppConfigItem(
                key=definition.key,
                value=config_map[definition.key],
                default_value=definition.default,
                description=definition.description,
                group=definition.group,
            )
            for definition in CONFIG_DEFINITIONS
        ]
    )


def get_config_map(db: Session) -> dict[str, int | float]:
    rows = _ensure_config_rows(db)
    values = get_default_config_map()
    for row in rows.values():
        definition = CONFIG_BY_KEY.get(row.key)
        if definition is None:
            continue
        values[row.key] = _deserialize_value(row.value, definition)
    return values


def get_config_int(db: Session, key: str) -> int:
    value = get_config_map(db)[key]
    return int(value)


def update_app_config(db: Session, payload: AppConfigUpdateRequest) -> AppConfigResponse:
    rows = _ensure_config_rows(db)
    now = datetime.utcnow()
    seen: set[str] = set()
    for item in payload.items:
        if item.key in seen:
            raise AppConfigError(f"Duplicate config key: {item.key}")
        seen.add(item.key)
        definition = CONFIG_BY_KEY.get(item.key)
        if definition is None:
            raise AppConfigError(f"Unknown config key: {item.key}")
        value = _validate_value(item.value, definition)
        row = rows[item.key]
        row.value = _serialize_value(value, definition)
        row.description = definition.description
        row.updated_at = now
    db.commit()
    return get_app_config(db)


def reset_app_config(db: Session) -> AppConfigResponse:
    rows = _ensure_config_rows(db)
    now = datetime.utcnow()
    for definition in CONFIG_DEFINITIONS:
        row = rows[definition.key]
        row.value = _serialize_value(definition.default, definition)
        row.description = definition.description
        row.updated_at = now
    db.commit()
    return get_app_config(db)


def _ensure_config_rows(db: Session) -> dict[str, AppConfig]:
    rows = {
        row.key: row
        for row in db.scalars(select(AppConfig).where(AppConfig.key.in_(list(CONFIG_BY_KEY.keys())))).all()
    }
    missing = [definition for definition in CONFIG_DEFINITIONS if definition.key not in rows]
    if missing:
        for definition in missing:
            row = AppConfig(
                key=definition.key,
                value=_serialize_value(definition.default, definition),
                description=definition.description,
            )
            db.add(row)
            rows[definition.key] = row
        db.commit()
    return rows


def _validate_value(value: int | float, definition: ConfigDefinition) -> int | float:
    numeric_value = float(value)
    if numeric_value < definition.minimum or numeric_value > definition.maximum:
        raise AppConfigError(
            f"{definition.key} must be between {definition.minimum:g} and {definition.maximum:g}."
        )
    if definition.kind == "int":
        if not numeric_value.is_integer():
            raise AppConfigError(f"{definition.key} must be an integer.")
        return int(numeric_value)
    return numeric_value


def _serialize_value(value: int | float, definition: ConfigDefinition) -> str:
    clean_value = _validate_value(value, definition)
    if definition.kind == "int":
        return str(int(clean_value))
    return f"{float(clean_value):.12g}"


def _deserialize_value(raw_value: str, definition: ConfigDefinition) -> int | float:
    try:
        value = float(raw_value)
    except (TypeError, ValueError):
        return definition.default
    try:
        return _validate_value(value, definition)
    except AppConfigError:
        return definition.default
