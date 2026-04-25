from __future__ import annotations

import json
import math
from datetime import date, datetime, time, timedelta
from typing import Any

import pandas as pd
import plotly.graph_objects as go
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.measurement import Measurement
from app.models.station import Station
from app.models.user import User
from app.models.variable import Variable
from app.schemas.advanced_analytics import AdvancedAnalyticsRequest, AdvancedAnalyticsResponse
from app.services.advanced_analytics import fit_prophet_model, fit_statsmodels_model
from app.services.etl.helpers import normalize_variable_code
from app.services.manual_dataset import ManualDatasetEdaContext, ManualDatasetService

_FREQ_MAP = {
    "hour": "h",
    "day": "D",
    "week": "W-MON",
    "month": "MS",
    "quarter": "QS",
    "year": "YS",
}

_MAX_STATSMODELS_POINTS = 5000
_MAX_PROPHET_POINTS = 20000
_MAX_FIGURE_POINTS = 4000


class AdvancedAnalyticsError(Exception):
    pass


class AdvancedAnalyticsService:
    def __init__(self, db: Session, user: User):
        self.db = db
        self.user = user
        self.manual_dataset_service = ManualDatasetService(db)

    def run_forecast(self, payload: AdvancedAnalyticsRequest) -> AdvancedAnalyticsResponse:
        warnings: list[str] = []
        series, label = self._load_series(payload, warnings)
        if series.empty:
            raise AdvancedAnalyticsError("No se encontraron datos para construir la serie temporal.")
        self._validate_minimum_series_length(series, payload)
        self._validate_model_budget(series, payload)

        fitted_frame, forecast_frame, stats = self._fit_model(series, payload)
        figure = self._build_figure(series, fitted_frame, forecast_frame, label, payload.model)

        missing_points = int(series.isna().sum())
        stats.update(
            {
                "series_label": label,
                "frequency": payload.granularity,
                "training_points": int(series.shape[0]),
                "filled_points": missing_points,
                "model": payload.model.upper(),
                "order": payload.order if payload.model in {"arima", "sarima"} else [],
                "seasonal_order": payload.seasonal_order or [] if payload.model == "sarima" else [],
                "start_at": series.index.min().isoformat(),
                "end_at": series.index.max().isoformat(),
            }
        )
        if missing_points > 0:
            warnings.append("La serie tenía huecos temporales y se interpoló antes del ajuste del modelo.")

        return AdvancedAnalyticsResponse(
            figure_json=json.loads(figure.to_json()),
            stats=stats,
            warnings=warnings,
        )

    def _load_series(
        self,
        payload: AdvancedAnalyticsRequest,
        warnings: list[str],
    ) -> tuple[pd.Series, str]:
        if payload.manual_dataset_id:
            context = self.manual_dataset_service.get_eda_context(dataset_id=payload.manual_dataset_id, user=self.user)
            if context.dataset.dataset_kind == "generic":
                return self._load_generic_manual_series(context, payload)
            response = self.manual_dataset_service.get_analytics_rows(
                dataset_id=payload.manual_dataset_id,
                user=self.user,
                limit=None,
                date_from=payload.date_from,
                date_to=payload.date_to,
                station_codes=payload.station_codes or None,
                variable_codes=payload.variable_codes or None,
                view_from=payload.view_from,
                view_to=payload.view_to,
            )
            frame = pd.DataFrame(
                [
                    {
                        "observed_at": row.observed_at,
                        "value": row.value,
                        "station_code": row.station_code,
                        "variable_code": row.variable_code,
                    }
                    for row in response.rows
                ]
            )
            if frame.empty:
                return pd.Series(dtype=float), "selection"

            if frame["variable_code"].nunique(dropna=True) > 1:
                warnings.append("Se seleccionaron varias variables; la serie avanzada usa la media temporal agregada.")
            if frame["station_code"].nunique(dropna=True) > 1:
                warnings.append("Se seleccionaron varias estaciones; la serie avanzada usa la media temporal agregada.")

            label = (
                str(frame["variable_code"].dropna().iloc[0])
                if frame["variable_code"].notna().any()
                else "selection"
            )
            return (
                self._aggregate_series(
                    pd.to_datetime(frame["observed_at"], utc=True, errors="coerce"),
                    pd.to_numeric(frame["value"], errors="coerce"),
                    payload.granularity,
                ),
                label,
            )
        if not payload.source_file_ids:
            raise AdvancedAnalyticsError("Selecciona al menos una fuente o un dataset manual.")

        return self._load_measurement_series(payload, warnings)

    def _load_measurement_series(
        self,
        payload: AdvancedAnalyticsRequest,
        warnings: list[str],
    ) -> tuple[pd.Series, str]:
        station_count, variable_count, label = self._load_measurement_metadata(payload)
        if variable_count > 1:
            warnings.append("Se seleccionaron varias variables; la serie avanzada usa la media temporal agregada.")
        if station_count > 1:
            warnings.append("Se seleccionaron varias estaciones; la serie avanzada usa la media temporal agregada.")

        bucket = func.date_trunc(payload.granularity, Measurement.observed_at).label("bucket")
        statement = (
            select(
                bucket,
                func.avg(Measurement.value).label("value"),
            )
            .select_from(Measurement)
            .join(Station, Station.id == Measurement.station_id)
            .join(Variable, Variable.id == Measurement.variable_id)
        )
        statement = self._apply_measurement_filters(statement, payload)
        rows = self.db.execute(statement.group_by(bucket).order_by(bucket.asc())).all()
        if not rows:
            return pd.Series(dtype=float), label

        return (
            self._aggregate_series(
                pd.Series(pd.to_datetime([row.bucket for row in rows], utc=True, errors="coerce")),
                pd.Series([row.value for row in rows], dtype="float64"),
                payload.granularity,
            ),
            label,
        )

    def _load_measurement_metadata(self, payload: AdvancedAnalyticsRequest) -> tuple[int, int, str]:
        normalized_code_expr = self._normalized_variable_sql_expr(Variable.code)
        statement = (
            select(
                func.count(func.distinct(Station.code)).label("station_count"),
                func.count(func.distinct(normalized_code_expr)).label("variable_count"),
                func.min(Variable.code).label("first_variable_code"),
            )
            .select_from(Measurement)
            .join(Station, Station.id == Measurement.station_id)
            .join(Variable, Variable.id == Measurement.variable_id)
        )
        statement = self._apply_measurement_filters(statement, payload)
        row = self.db.execute(statement).one()
        label = normalize_variable_code(row.first_variable_code) if row.first_variable_code else "selection"
        return int(row.station_count or 0), int(row.variable_count or 0), label

    def _apply_measurement_filters(self, statement: Any, payload: AdvancedAnalyticsRequest) -> Any:
        if payload.source_file_ids:
            statement = statement.where(Measurement.source_file_id.in_(payload.source_file_ids))
        if payload.station_codes:
            statement = statement.where(Station.code.in_(payload.station_codes))
        if payload.variable_codes:
            statement = statement.where(
                self._normalized_variable_sql_expr(Variable.code).in_(
                    sorted({normalize_variable_code(code) for code in payload.variable_codes if code})
                )
            )
        if payload.date_from is not None:
            statement = statement.where(Measurement.observed_at >= datetime.combine(payload.date_from, time.min))
        if payload.date_to is not None:
            statement = statement.where(
                Measurement.observed_at < datetime.combine(payload.date_to + timedelta(days=1), time.min)
            )
        if payload.view_from is not None:
            statement = statement.where(Measurement.observed_at >= payload.view_from)
        if payload.view_to is not None:
            statement = statement.where(Measurement.observed_at <= payload.view_to)
        return statement

    def _load_generic_manual_series(
        self,
        context: ManualDatasetEdaContext,
        payload: AdvancedAnalyticsRequest,
    ) -> tuple[pd.Series, str]:
        frame = context.dataframe.copy()
        time_column = self._resolve_generic_time_column(context, payload.x_axis)
        value_column = self._resolve_generic_value_column(context, payload.y_axis)
        if time_column is None or value_column is None:
            raise AdvancedAnalyticsError(
                "El dataset manual necesita una columna temporal y una numérica para Advanced Analytics."
            )

        observed_at = pd.to_datetime(frame[time_column], utc=True, errors="coerce")
        values = pd.to_numeric(frame[value_column], errors="coerce")
        working = pd.DataFrame({"observed_at": observed_at, "value": values}).dropna(subset=["observed_at", "value"])
        if payload.date_from is not None:
            working = working[working["observed_at"] >= self._date_start(payload.date_from)]
        if payload.date_to is not None:
            working = working[working["observed_at"] < self._date_end(payload.date_to)]
        if payload.view_from is not None:
            working = working[working["observed_at"] >= self._to_utc_timestamp(payload.view_from)]
        if payload.view_to is not None:
            working = working[working["observed_at"] <= self._to_utc_timestamp(payload.view_to)]

        return (
            self._aggregate_series(working["observed_at"], working["value"], payload.granularity),
            str(value_column),
        )

    def _aggregate_series(
        self,
        observed_at: pd.Series,
        values: pd.Series,
        granularity: str,
    ) -> pd.Series:
        freq = _FREQ_MAP[granularity]
        working = pd.DataFrame({"observed_at": observed_at, "value": values}).dropna(subset=["observed_at", "value"])
        if working.empty:
            return pd.Series(dtype=float)
        series = (
            working.set_index("observed_at")["value"]
            .sort_index()
            .astype(float)
            .resample(freq)
            .mean()
            .asfreq(freq)
        )
        return series.interpolate(limit_direction="both")

    def _fit_model(
        self,
        series: pd.Series,
        payload: AdvancedAnalyticsRequest,
    ) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
        if payload.model == "prophet":
            return fit_prophet_model(series, payload, error_cls=AdvancedAnalyticsError)
        return fit_statsmodels_model(series, payload, error_cls=AdvancedAnalyticsError)

    def _validate_model_budget(self, series: pd.Series, payload: AdvancedAnalyticsRequest) -> None:
        point_count = int(series.dropna().shape[0])
        if payload.model in {"arima", "sarima"} and point_count > _MAX_STATSMODELS_POINTS:
            raise AdvancedAnalyticsError(
                "La serie es demasiado grande para ARIMA/SARIMA con la granularidad actual. "
                "Usa una granularidad más gruesa o reduce la ventana temporal."
            )
        if payload.model == "prophet" and point_count > _MAX_PROPHET_POINTS:
            raise AdvancedAnalyticsError(
                "La serie es demasiado grande para Prophet con la granularidad actual. "
                "Usa una granularidad más gruesa o reduce la ventana temporal."
            )

    def _validate_minimum_series_length(self, series: pd.Series, payload: AdvancedAnalyticsRequest) -> None:
        point_count = int(series.dropna().shape[0])
        minimum_points = 12 if payload.model == "sarima" else 8
        if payload.model == "prophet":
            minimum_points = 3
        if point_count < minimum_points:
            raise AdvancedAnalyticsError(
                "La serie tiene muy pocas observaciones para este modelo "
                f"({point_count} con granularidad {payload.granularity}). "
                "Prueba una granularidad más fina o amplía el rango de fechas."
            )

    def _build_figure(
        self,
        observed: pd.Series,
        fitted_frame: pd.DataFrame,
        forecast_frame: pd.DataFrame,
        label: str,
        model: str,
    ) -> go.Figure:
        figure = go.Figure()
        observed_frame = self._series_to_frame(observed.dropna())
        observed_frame = self._apply_plot_budget(observed_frame)
        figure.add_trace(
            go.Scatter(
                x=observed_frame["bucket"],
                y=observed_frame["value"],
                mode="lines",
                name=f"Observed {label}",
                line={"color": "#1F5A8A", "width": 2},
            )
        )
        if not fitted_frame.empty:
            fitted_frame = self._apply_plot_budget(fitted_frame)
            figure.add_trace(
                go.Scatter(
                    x=fitted_frame["bucket"],
                    y=fitted_frame["fitted"],
                    mode="lines",
                    name="Fitted",
                    line={"color": "#509EE3", "width": 1.5, "dash": "dot"},
                )
            )
        if not forecast_frame.empty:
            figure.add_trace(
                go.Scatter(
                    x=forecast_frame["bucket"],
                    y=forecast_frame["upper"],
                    mode="lines",
                    line={"width": 0},
                    showlegend=False,
                    hoverinfo="skip",
                )
            )
            figure.add_trace(
                go.Scatter(
                    x=forecast_frame["bucket"],
                    y=forecast_frame["lower"],
                    mode="lines",
                    line={"width": 0},
                    fill="tonexty",
                    fillcolor="rgba(80, 158, 227, 0.18)",
                    name="95% interval",
                    hoverinfo="skip",
                )
            )
            figure.add_trace(
                go.Scatter(
                    x=forecast_frame["bucket"],
                    y=forecast_frame["forecast"],
                    mode="lines",
                    name=f"{model.upper()} forecast",
                    line={"color": "#16A34A", "width": 2},
                )
            )

        figure.update_layout(
            title=f"Advanced Forecast · {label}",
            template="plotly_white",
            height=560,
            margin={"l": 48, "r": 24, "t": 56, "b": 48},
            legend={"orientation": "h", "yanchor": "bottom", "y": 1.02, "x": 0},
            xaxis={"title": "Time", "rangeslider": {"visible": True}},
            yaxis={"title": label},
        )
        return figure

    def _apply_plot_budget(self, frame: pd.DataFrame) -> pd.DataFrame:
        if len(frame) <= _MAX_FIGURE_POINTS:
            return frame
        step = max(1, math.ceil(len(frame) / _MAX_FIGURE_POINTS))
        decimated = frame.iloc[::step].copy()
        if decimated.iloc[-1]["bucket"] != frame.iloc[-1]["bucket"]:
            decimated = pd.concat([decimated, frame.iloc[[-1]]], ignore_index=True)
        return decimated.reset_index(drop=True)

    def _normalized_variable_sql_expr(self, column: Any) -> Any:
        expression = func.upper(column)
        for token in (" ", ".", "-", "_", "/", "(", ")", "[", "]", "{", "}"):
            expression = func.replace(expression, token, "")
        expression = func.replace(expression, "μ", "U")
        expression = func.replace(expression, "µ", "U")
        return expression

    def _series_to_frame(self, series: pd.Series) -> pd.DataFrame:
        return (
            series.rename("value")
            .rename_axis("bucket")
            .reset_index()
        )

    def _resolve_generic_time_column(
        self,
        context: ManualDatasetEdaContext,
        requested_column: str | None,
    ) -> str | None:
        frame = context.dataframe
        if requested_column and requested_column in frame.columns:
            parsed = pd.to_datetime(frame[requested_column], utc=True, errors="coerce")
            if int(parsed.notna().sum()) > 0:
                return requested_column
        if context.mapping.datetime_column and context.mapping.datetime_column in frame.columns:
            parsed = pd.to_datetime(frame[context.mapping.datetime_column], utc=True, errors="coerce")
            if int(parsed.notna().sum()) > 0:
                return context.mapping.datetime_column
        for column in context.summary.datetime_columns:
            if column in frame.columns:
                parsed = pd.to_datetime(frame[column], utc=True, errors="coerce")
                if int(parsed.notna().sum()) > 0:
                    return column
        return None

    def _resolve_generic_value_column(
        self,
        context: ManualDatasetEdaContext,
        requested_column: str | None,
    ) -> str | None:
        frame = context.dataframe
        if (
            requested_column
            and requested_column in frame.columns
            and pd.api.types.is_numeric_dtype(frame[requested_column])
        ):
            return requested_column
        if (
            context.mapping.value_column
            and context.mapping.value_column in frame.columns
            and pd.api.types.is_numeric_dtype(frame[context.mapping.value_column])
        ):
            return context.mapping.value_column
        for column in context.summary.numeric_columns:
            if column in frame.columns and pd.api.types.is_numeric_dtype(frame[column]):
                return column
        return None

    def _to_utc_timestamp(self, value: datetime | date) -> pd.Timestamp:
        timestamp = pd.Timestamp(value)
        if timestamp.tzinfo is None:
            return timestamp.tz_localize("UTC")
        return timestamp.tz_convert("UTC")

    def _date_start(self, value: date) -> pd.Timestamp:
        return self._to_utc_timestamp(datetime.combine(value, time.min))

    def _date_end(self, value: date) -> pd.Timestamp:
        return self._to_utc_timestamp(datetime.combine(value + timedelta(days=1), time.min))
