from __future__ import annotations

import json
import math
from typing import Any

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import plotly.io as pio

from app.schemas.eda import EdaPlotRequest, EdaSecondaryFigure
from app.services.app_config_service import get_default_config_map
from app.services.plotly_theme import apply_atmos_plotly_theme

CHART_COLORS = ["#509EE3", "#1F5A8A", "#0EA5E9", "#0B7285", "#16A34A", "#E9730C", "#D946EF", "#A16207"]
WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
GENERIC_SECTIONS = {
    "rolling",
    "distribution",
    "scatter",
    "data_trend",
    "time_profiles",
    "heat_map",
    "summary",
    "correlation",
    "anomaly",
    "profiles",
    "seasonality",
    "decomposition",
    "autocorr",
    "pacf",
    "forecast",
    "changepoints",
    "trend",
}
TIME_NAVIGATION_SECTIONS = {
    "rolling",
    "data_trend",
    "anomaly",
    "decomposition",
    "forecast",
    "changepoints",
    "trend",
}


class EdaServiceError(ValueError):
    pass


class EdaSharedMixin:
    def _config_float(self, key: str) -> float:
        config = getattr(self, "config", None)
        if config is None:
            config = get_default_config_map()
            self.config = config
        return float(config[key])

    def _serialize_figure(self, figure: go.Figure) -> dict[str, Any]:
        return json.loads(pio.to_json(figure, pretty=False))

    def _secondary(
        self,
        key: str,
        title: str,
        description: str | None,
        figure: go.Figure,
    ) -> EdaSecondaryFigure:
        return EdaSecondaryFigure(
            key=key,
            title=title,
            description=description,
            figure_json=self._serialize_figure(figure),
        )

    def _empty_figure(self, message: str) -> go.Figure:
        fig = go.Figure()
        fig.add_annotation(
            text=message,
            x=0.5,
            y=0.5,
            xref="paper",
            yref="paper",
            showarrow=False,
            font={"size": 15, "color": "#64748B"},
        )
        fig.update_xaxes(visible=False)
        fig.update_yaxes(visible=False)
        return self._finalize_figure(fig)

    def _supports_time_navigation(self, payload: EdaPlotRequest) -> bool:
        return payload.section in TIME_NAVIGATION_SECTIONS

    def _apply_time_navigation(self, figure: go.Figure, payload: EdaPlotRequest) -> go.Figure:
        xaxis_update: dict[str, Any] = {"type": "date"}
        if payload.view_from and payload.view_to:
            xaxis_update["range"] = [payload.view_from.isoformat(), payload.view_to.isoformat()]
        figure.update_xaxes(**xaxis_update)
        slider_update: dict[str, Any] = {"rangeslider": {"visible": True, "thickness": 0.08}}
        if "range" in xaxis_update:
            slider_update["range"] = xaxis_update["range"]
        xaxis_keys = [
            key
            for key in figure.layout
            if key.startswith("xaxis") and getattr(figure.layout, key, None) is not None
        ]
        if not xaxis_keys:
            figure.update_xaxes(**slider_update)
            return figure
        xaxis_keys.sort(key=lambda key: 1 if key == "xaxis" else int(key.replace("xaxis", "") or "1"))
        getattr(figure.layout, xaxis_keys[-1]).update(slider_update)
        return figure

    def _clip_time_frame(
        self,
        frame: pd.DataFrame,
        *,
        time_column: str,
        payload: EdaPlotRequest,
    ) -> pd.DataFrame:
        if frame.empty or time_column not in frame.columns:
            return frame
        window = self._navigation_window(payload)
        if window is None:
            return frame

        start, end = window
        timestamps = pd.to_datetime(frame[time_column], utc=True, errors="coerce")
        mask = timestamps.notna() & timestamps.ge(start) & timestamps.le(end)
        clipped = frame.loc[mask].copy()
        if clipped.empty:
            visible_window = self._visible_navigation_window(payload)
            if visible_window is None:
                return clipped
            visible_start, visible_end = visible_window
            visible_mask = timestamps.notna() & timestamps.ge(visible_start) & timestamps.le(visible_end)
            return frame.loc[visible_mask].copy()
        return clipped

    def _navigation_window(self, payload: EdaPlotRequest) -> tuple[pd.Timestamp, pd.Timestamp] | None:
        if not self._supports_time_navigation(payload) or payload.view_from is None or payload.view_to is None:
            return None

        visible_window = self._visible_navigation_window(payload)
        if visible_window is None:
            return None
        start, end = visible_window

        lookback_steps = self._navigation_lookback_steps(payload)
        lookahead_steps = self._navigation_lookahead_steps(payload)
        buffered_start = self._shift_timestamp(start, payload.granularity, -lookback_steps)
        buffered_end = self._shift_timestamp(end, payload.granularity, lookahead_steps)
        return buffered_start, buffered_end

    def _visible_navigation_window(self, payload: EdaPlotRequest) -> tuple[pd.Timestamp, pd.Timestamp] | None:
        if payload.view_from is None or payload.view_to is None:
            return None

        start = pd.Timestamp(payload.view_from)
        end = pd.Timestamp(payload.view_to)
        if start.tzinfo is None:
            start = start.tz_localize("UTC")
        else:
            start = start.tz_convert("UTC")
        if end.tzinfo is None:
            end = end.tz_localize("UTC")
        else:
            end = end.tz_convert("UTC")
        if end < start:
            start, end = end, start
        return start, end

    def _navigation_lookback_steps(self, payload: EdaPlotRequest) -> int:
        if payload.section in {"rolling", "data_trend"}:
            return max(2, payload.rolling_window)
        if payload.section in {"decomposition", "trend", "forecast"}:
            return max(2, payload.decomposition_window)
        if payload.section == "changepoints":
            return max(2, payload.changepoint_window)
        if payload.section == "anomaly":
            return max(2, payload.rolling_window)
        return 2

    def _navigation_lookahead_steps(self, payload: EdaPlotRequest) -> int:
        if payload.section == "forecast":
            return max(1, payload.forecast_horizon)
        return 1

    def _shift_timestamp(self, timestamp: pd.Timestamp, granularity: str, steps: int) -> pd.Timestamp:
        if steps == 0:
            return timestamp
        if granularity == "year":
            return timestamp + pd.DateOffset(years=steps)
        if granularity == "quarter":
            return timestamp + pd.DateOffset(months=steps * 3)
        if granularity == "month":
            return timestamp + pd.DateOffset(months=steps)
        if granularity == "week":
            return timestamp + pd.Timedelta(weeks=steps)
        if granularity == "hour":
            return timestamp + pd.Timedelta(hours=steps)
        return timestamp + pd.Timedelta(days=steps)

    def _finalize_figure(self, figure: go.Figure, title: str | None = None) -> go.Figure:
        return apply_atmos_plotly_theme(figure, title=title)

    def _apply_point_budget(self, frame: pd.DataFrame, limit: int | None) -> pd.DataFrame:
        if limit is None or frame.empty or len(frame) <= limit:
            return frame
        safe_limit = max(1, int(limit))
        positions = np.linspace(0, len(frame) - 1, num=safe_limit, dtype=int)
        unique_positions = np.unique(positions)
        return frame.iloc[unique_positions].reset_index(drop=True)

    def _regression_line(
        self,
        x_values: np.ndarray,
        y_values: np.ndarray,
        *,
        confidence_level: float = 0.95,
    ) -> dict[str, np.ndarray]:
        slope, intercept, _, _, _ = self._linear_regression_terms(x_values, y_values)
        x_grid = np.linspace(float(np.min(x_values)), float(np.max(x_values)), 100)
        y_grid = intercept + (slope * x_grid)
        if x_values.size < 3:
            return {"x": x_grid, "y": y_grid, "lower": y_grid, "upper": y_grid}

        y_hat = intercept + (slope * x_values)
        residuals = y_values - y_hat
        s_err = math.sqrt(max(float(np.sum(residuals**2)) / max(1, x_values.size - 2), 0.0))
        mean_x = float(np.mean(x_values))
        s_xx = float(np.sum((x_values - mean_x) ** 2))
        if s_xx <= 1e-12:
            return {"x": x_grid, "y": y_grid, "lower": y_grid, "upper": y_grid}

        z_lookup = {0.68: 1.0, 0.9: 1.645, 0.95: 1.96, 0.99: 2.576}
        z_value = z_lookup.get(round(float(confidence_level), 2), 1.96)
        conf = z_value * s_err * np.sqrt((1 / x_values.size) + (((x_grid - mean_x) ** 2) / s_xx))
        return {"x": x_grid, "y": y_grid, "lower": y_grid - conf, "upper": y_grid + conf}

    def _polynomial_line(self, x_values: np.ndarray, y_values: np.ndarray, order: int) -> dict[str, np.ndarray]:
        if x_values.size == 0 or y_values.size == 0:
            return {"x": np.array([]), "y": np.array([])}
        clean = pd.DataFrame({"x": x_values, "y": y_values}).replace([np.inf, -np.inf], np.nan).dropna()
        if clean.shape[0] < order + 1:
            return self._regression_line(clean["x"].to_numpy(dtype=float), clean["y"].to_numpy(dtype=float))
        x_grid = np.linspace(float(clean["x"].min()), float(clean["x"].max()), 140)
        coefficients = np.polyfit(clean["x"].to_numpy(dtype=float), clean["y"].to_numpy(dtype=float), deg=order)
        return {"x": x_grid, "y": np.polyval(coefficients, x_grid)}

    def _kde_curve(
        self,
        values: np.ndarray,
        *,
        cumulative: bool,
        normalize_density: bool,
    ) -> tuple[np.ndarray, np.ndarray]:
        clean = values[np.isfinite(values)]
        if clean.size == 0:
            return np.array([]), np.array([])
        if clean.size == 1:
            return np.array([clean[0]]), np.array([1.0])

        std = float(np.std(clean, ddof=1))
        bandwidth = (
            1.06 * std * (clean.size ** (-1 / 5)) if std > 1e-9 else max(abs(float(np.mean(clean))) * 0.01, 1e-3)
        )
        grid = np.linspace(float(np.min(clean)), float(np.max(clean)), 200)
        normalized = (grid[:, None] - clean[None, :]) / bandwidth
        density = np.exp(-0.5 * normalized**2).sum(axis=1) / (clean.size * bandwidth * math.sqrt(2 * math.pi))

        if cumulative:
            density = np.cumsum(density)
            if density[-1] > 0:
                density = density / density[-1]
        if normalize_density and density.max() > 0:
            density = density / density.max()
        return grid, density

    def _fit_linear(self, values: np.ndarray) -> dict[str, Any]:
        if values.size == 0:
            return {"slope": 0.0, "intercept": 0.0, "r2": 0.0, "predicted": np.array([])}
        x_values = np.arange(values.size, dtype=float)
        slope, intercept, ss_tot, ss_res, predicted = self._linear_regression_terms(x_values, values)
        r2 = 0.0 if ss_tot <= 1e-12 else max(0.0, 1 - (ss_res / ss_tot))
        return {"slope": slope, "intercept": intercept, "r2": r2, "predicted": predicted}

    def _linear_regression_terms(
        self,
        x_values: np.ndarray,
        y_values: np.ndarray,
    ) -> tuple[float, float, float, float, np.ndarray]:
        if x_values.size == 0 or y_values.size == 0:
            return 0.0, 0.0, 0.0, 0.0, np.array([])
        x_mean = float(np.mean(x_values))
        y_mean = float(np.mean(y_values))
        numerator = float(np.sum((x_values - x_mean) * (y_values - y_mean)))
        denominator = float(np.sum((x_values - x_mean) ** 2))
        slope = 0.0 if abs(denominator) < 1e-12 else numerator / denominator
        intercept = y_mean - (slope * x_mean)
        predicted = intercept + (slope * x_values)
        ss_tot = float(np.sum((y_values - y_mean) ** 2))
        ss_res = float(np.sum((y_values - predicted) ** 2))
        return slope, intercept, ss_tot, ss_res, predicted

    def _fit_quadratic(self, values: np.ndarray) -> np.ndarray:
        if values.size == 0:
            return np.array([])
        if values.size < 3:
            return self._fit_linear(values)["predicted"]
        x_values = np.arange(values.size, dtype=float)
        coefficients = np.polyfit(x_values, values, deg=2)
        return np.polyval(coefficients, x_values)

    def _autocorrelation_at_lag(self, values: np.ndarray, lag: int) -> float:
        if values.size == 0 or lag >= values.size:
            return 0.0
        if lag == 0:
            return 1.0
        mean = self._safe_mean(values)
        denominator = float(np.sum((values - mean) ** 2))
        if abs(denominator) < 1e-12:
            return 0.0
        numerator = float(np.sum((values[lag:] - mean) * (values[:-lag] - mean)))
        return numerator / denominator

    def _bucket_key(self, value: pd.Timestamp | Any, granularity: str) -> str:
        timestamp = pd.Timestamp(value)
        if granularity == "year":
            return f"{timestamp.year}"
        if granularity == "quarter":
            return f"{timestamp.year}-Q{timestamp.quarter}"
        if granularity == "month":
            return f"{timestamp.year}-{timestamp.month:02d}"
        if granularity == "week":
            iso = timestamp.isocalendar()
            return f"{int(iso.year)}-W{int(iso.week):02d}"
        if granularity == "hour":
            return f"{timestamp.year}-{timestamp.month:02d}-{timestamp.day:02d} {timestamp.hour:02d}:00"
        return f"{timestamp.year}-{timestamp.month:02d}-{timestamp.day:02d}"

    def _increment_bucket(self, bucket: str, granularity: str, step: int) -> str:
        if granularity == "year":
            return f"{int(bucket) + step}"
        if granularity == "quarter":
            year_part, quarter_part = bucket.split("-Q")
            base = pd.Period(f"{year_part}Q{quarter_part}", freq="Q")
            target = base + step
            return f"{target.year}-Q{target.quarter}"
        if granularity == "month":
            base = pd.Timestamp(f"{bucket}-01T00:00:00Z")
            target = base + pd.DateOffset(months=step)
            return f"{target.year}-{target.month:02d}"
        if granularity == "week":
            year_part, week_part = bucket.split("-W")
            base = pd.Timestamp.fromisocalendar(int(year_part), int(week_part), 1).tz_localize("UTC")
            target = base + pd.Timedelta(weeks=step)
            iso = target.isocalendar()
            return f"{int(iso.year)}-W{int(iso.week):02d}"
        if granularity == "hour":
            base = pd.Timestamp(bucket.replace(" ", "T") + ":00Z")
            target = base + pd.Timedelta(hours=step)
            return f"{target.year}-{target.month:02d}-{target.day:02d} {target.hour:02d}:00"
        base = pd.Timestamp(f"{bucket}T00:00:00Z")
        target = base + pd.Timedelta(days=step)
        return f"{target.year}-{target.month:02d}-{target.day:02d}"

    def _seasonal_period(self, granularity: str) -> int:
        if granularity == "hour":
            return 24
        if granularity == "week":
            return 52
        if granularity == "month":
            return 12
        if granularity == "quarter":
            return 4
        if granularity == "year":
            return 4
        return 7

    def _aggregate_values(self, series: pd.Series, aggregation_mode: str) -> float:
        numeric = pd.to_numeric(series, errors="coerce").dropna()
        if numeric.empty:
            return 0.0
        if aggregation_mode == "median":
            return float(numeric.median())
        if aggregation_mode == "sum":
            return float(numeric.sum())
        if aggregation_mode == "min":
            return float(numeric.min())
        if aggregation_mode == "max":
            return float(numeric.max())
        if aggregation_mode == "std":
            return float(numeric.std(ddof=0))
        return float(numeric.mean())

    def _coerce_datetime_series(self, series: pd.Series | Any) -> pd.Series:
        return pd.to_datetime(series, utc=True, errors="coerce")

    def _numeric_columns(self, frame: pd.DataFrame) -> list[str]:
        return [column for column in frame.columns if self._is_numeric(frame[column])]

    def _categorical_columns(self, frame: pd.DataFrame) -> list[str]:
        return [column for column in frame.columns if self._is_categorical(frame[column])]

    def _is_numeric(self, series: pd.Series) -> bool:
        if pd.api.types.is_numeric_dtype(series):
            return True
        coerced = pd.to_numeric(series, errors="coerce")
        return int(coerced.notna().sum()) >= max(2, int(len(series) * 0.7))

    def _is_categorical(self, series: pd.Series) -> bool:
        return not self._is_numeric(series)

    def _safe_mean(self, values: np.ndarray) -> float:
        if values.size == 0:
            return 0.0
        return float(np.nanmean(values))

    def _safe_std(self, values: np.ndarray) -> float:
        if values.size == 0:
            return 0.0
        return float(np.nanstd(values, ddof=0))
