from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Any

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.measurement import DATA_ORIGIN_USER, Measurement
from app.models.station import Station
from app.models.variable import Variable
from app.services.etl.helpers import normalize_variable_code

MIN_USABLE_ROWS = 48

_COVARIATE_VARIABLE_CODES = ("TMP", "HUM", "VEL")
_COVARIATE_FEATURE_NAMES = {
    "TMP": "Temperature",
    "HUM": "Humidity",
    "VEL": "Wind Speed",
}
_TARGET_DISPLAY_NAMES = {
    "PM25": "PM2.5 Concentration",
    "PM10": "PM10 Concentration",
    "NO2": "NO2 Level",
    "O3": "Ozone Level",
}


class MLExperimentError(Exception):
    pass


@dataclass
class MLDataset:
    train_df: pd.DataFrame
    test_df: pd.DataFrame
    feature_names: list[str]
    target_name: str
    station_codes_used: list[str]
    warnings: list[str] = field(default_factory=list)


def normalized_variable_sql_expr(column: Any) -> Any:
    expression = func.upper(column)
    for token in (" ", ".", "-", "_", "\\", "(", ")", "[", "]", "{", "}"):
        expression = func.replace(expression, token, "")
    return expression


def _load_variable_hourly_series(
    db: Session,
    *,
    variable_code: str,
    station_codes: list[str],
    date_from: date | None,
    date_to: date | None,
) -> pd.Series:
    normalized_target = normalize_variable_code(variable_code)
    statement = (
        select(Measurement.observed_at, Measurement.value)
        .select_from(Measurement)
        .join(Station, Station.id == Measurement.station_id)
        .join(Variable, Variable.id == Measurement.variable_id)
        .where(Measurement.data_origin == DATA_ORIGIN_USER)
        .where(normalized_variable_sql_expr(Variable.code) == normalized_target)
    )
    if date_from is not None:
        statement = statement.where(Measurement.observed_at >= datetime.combine(date_from, time.min))
    if date_to is not None:
        statement = statement.where(
            Measurement.observed_at < datetime.combine(date_to + timedelta(days=1), time.min)
        )

    def _run(filtered_statement: Any) -> pd.Series:
        rows = db.execute(filtered_statement).all()
        if not rows:
            return pd.Series(dtype=float)
        frame = pd.DataFrame(rows, columns=["observed_at", "value"])
        frame["observed_at"] = pd.to_datetime(frame["observed_at"])
        series = frame.set_index("observed_at")["value"].sort_index().astype(float)
        return series.resample("h").mean()

    if station_codes:
        scoped_series = _run(statement.where(Station.code.in_(station_codes)))
        if not scoped_series.dropna().empty:
            return scoped_series
    return _run(statement)


def _engineer_time_features(index: pd.DatetimeIndex) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "hour_of_day": index.hour,
            "day_of_week": index.dayofweek,
        },
        index=index,
    )


def build_ml_dataset(
    db: Session,
    *,
    target_variable_code: str,
    station_codes: list[str],
    date_from: date | None,
    date_to: date | None,
    train_split: float,
) -> MLDataset:
    warnings: list[str] = []

    target_series = _load_variable_hourly_series(
        db,
        variable_code=target_variable_code,
        station_codes=station_codes,
        date_from=date_from,
        date_to=date_to,
    )
    if target_series.dropna().empty:
        raise MLExperimentError(
            f"No se encontraron mediciones para la variable objetivo '{target_variable_code}' "
            "en el rango de fechas y estaciones seleccionados."
        )

    target_series = target_series.interpolate(limit_direction="both")
    full_index = target_series.index

    target_display = _TARGET_DISPLAY_NAMES.get(
        normalize_variable_code(target_variable_code), target_variable_code
    )
    frame = pd.DataFrame({target_display: target_series})

    for covariate_code in _COVARIATE_VARIABLE_CODES:
        feature_name = _COVARIATE_FEATURE_NAMES[covariate_code]
        covariate_series = _load_variable_hourly_series(
            db,
            variable_code=covariate_code,
            station_codes=station_codes,
            date_from=date_from,
            date_to=date_to,
        )
        covariate_series = covariate_series.reindex(full_index).interpolate(limit_direction="both")
        if covariate_series.isna().all():
            warnings.append(
                f"No hay datos de '{feature_name}' en el rango seleccionado; se usará un valor constante."
            )
            covariate_series = covariate_series.fillna(0.0)
        frame[feature_name] = covariate_series

    time_features = _engineer_time_features(full_index)
    frame["Hour of Day"] = time_features["hour_of_day"].to_numpy()
    frame["Day of Week"] = time_features["day_of_week"].to_numpy()

    if len(frame) < MIN_USABLE_ROWS:
        raise MLExperimentError(
            f"Solo se encontraron {len(frame)} observaciones horarias utilizables; "
            f"se requieren al menos {MIN_USABLE_ROWS} para entrenar un modelo."
        )

    split_index = max(1, min(len(frame) - 1, round(len(frame) * train_split)))
    train_df = frame.iloc[:split_index].copy()
    test_df = frame.iloc[split_index:].copy()
    if test_df.empty:
        raise MLExperimentError("El conjunto de prueba quedó vacío; ajusta el rango de fechas o el split.")

    feature_names = [column for column in frame.columns if column != target_display]
    return MLDataset(
        train_df=train_df,
        test_df=test_df,
        feature_names=feature_names,
        target_name=target_display,
        station_codes_used=station_codes,
        warnings=warnings,
    )
