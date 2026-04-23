from __future__ import annotations

import math
import warnings
from typing import Any

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots

try:
    from scipy.stats import kendalltau as _kendalltau
    from scipy.stats import theilslopes as _theilslopes

    _SCIPY_AVAILABLE = True
except ImportError:  # pragma: no cover
    _SCIPY_AVAILABLE = False

try:
    from statsmodels.tsa.seasonal import STL as _STL

    _STATSMODELS_AVAILABLE = True
except ImportError:  # pragma: no cover
    _STATSMODELS_AVAILABLE = False

from app.schemas.analytics import AnalyticsQueryRequest
from app.schemas.eda import EdaPlotRequest, EdaSecondaryFigure
from app.services.analytics_service import query_data
from app.services.eda.common import CHART_COLORS, MONTH_LABELS, WEEKDAY_LABELS
from app.services.etl.helpers import normalize_station_code, normalize_variable_code
from app.services.manual_dataset import ManualDatasetEdaContext


class EdaMeasurementMixin:
    def _load_measurement_frame(
        self,
        payload: EdaPlotRequest,
        context: ManualDatasetEdaContext | None,
    ) -> pd.DataFrame:
        if context is not None:
            return self._measurement_frame_from_manual_context(context, payload)

        navigation_window = self._navigation_window(payload)
        response = query_data(
            self.db,
            AnalyticsQueryRequest(
                source_file_ids=payload.source_file_ids,
                station_codes=payload.station_codes,
                variable_codes=payload.variable_codes,
                date_from=payload.date_from,
                date_to=payload.date_to,
                view_from=navigation_window[0].to_pydatetime() if navigation_window is not None else None,
                view_to=navigation_window[1].to_pydatetime() if navigation_window is not None else None,
                limit=None if self._supports_time_navigation(payload) else payload.limit,
            ),
        )
        rows = [row.model_dump() for row in response.rows]
        if not rows:
            return pd.DataFrame(
                columns=[
                    "observed_at",
                    "station_code",
                    "station_name",
                    "variable_code",
                    "variable_name",
                    "value",
                    "unit",
                    "source_file_id",
                    "source_file_name",
                    "source_type",
                ]
            )

        frame = pd.DataFrame(rows)
        frame["observed_at"] = pd.to_datetime(frame["observed_at"], utc=True, errors="coerce")
        frame["value"] = pd.to_numeric(frame["value"], errors="coerce")
        frame = frame.dropna(subset=["observed_at", "value"]).sort_values("observed_at").reset_index(drop=True)
        frame = self._clip_time_frame(frame, time_column="observed_at", payload=payload)
        return frame

    def _measurement_frame_from_manual_context(
        self,
        context: ManualDatasetEdaContext,
        payload: EdaPlotRequest,
    ) -> pd.DataFrame:
        frame = context.dataframe.copy()
        observed_at = self._resolve_context_datetime_series(context)
        value_column = self._resolve_context_value_column(context)
        station_column = (
            context.mapping.station_code_column if context.mapping.station_code_column in frame.columns else None
        )
        variable_column = (
            context.mapping.variable_code_column if context.mapping.variable_code_column in frame.columns else None
        )
        unit_column = context.mapping.unit_column if context.mapping.unit_column in frame.columns else None

        if observed_at is None or value_column is None:
            return pd.DataFrame(
                columns=[
                    "observed_at",
                    "station_code",
                    "station_name",
                    "variable_code",
                    "variable_name",
                    "value",
                    "unit",
                    "source_file_id",
                    "source_file_name",
                    "source_type",
                ]
            )

        frame["observed_at"] = observed_at
        frame["value"] = pd.to_numeric(frame[value_column], errors="coerce")
        frame["station_code"] = (
            frame[station_column].astype(str).map(normalize_station_code) if station_column else "DATASET"
        )
        frame["station_name"] = frame["station_code"]
        frame["variable_code"] = (
            frame[variable_column].astype(str).map(normalize_variable_code)
            if variable_column
            else normalize_variable_code(context.dataset.name)
        )
        frame["variable_name"] = frame["variable_code"]
        frame["unit"] = frame[unit_column].astype(str) if unit_column else None
        frame["source_file_id"] = int(context.dataset.source_file_id or 0)
        frame["source_file_name"] = context.dataset.name
        frame["source_type"] = "manual_dataset"
        frame = frame.dropna(subset=["observed_at", "value"])

        if payload.date_from is not None:
            frame = frame[frame["observed_at"] >= pd.Timestamp(payload.date_from, tz="UTC")]
        if payload.date_to is not None:
            frame = frame[frame["observed_at"] < pd.Timestamp(payload.date_to, tz="UTC") + pd.Timedelta(days=1)]
        if payload.station_codes:
            allowed_stations = {normalize_station_code(code) for code in payload.station_codes}
            frame = frame[frame["station_code"].isin(allowed_stations)]
        if payload.variable_codes:
            allowed_variables = {normalize_variable_code(code) for code in payload.variable_codes}
            frame = frame[frame["variable_code"].isin(allowed_variables)]

        frame = frame.sort_values("observed_at").reset_index(drop=True)
        frame = self._clip_time_frame(frame, time_column="observed_at", payload=payload)
        if self._supports_time_navigation(payload):
            return frame
        return frame.head(payload.limit).reset_index(drop=True)

    def _measurement_rolling_figure(
        self,
        frame: pd.DataFrame,
        temporal_frame: pd.DataFrame,
        series_keys: list[str],
        payload: EdaPlotRequest,
        chart_type: str,
    ) -> go.Figure:
        if chart_type == "bar":
            grouped = (
                frame.groupby("station_code", dropna=False)["value"]
                .mean()
                .reset_index(name="avg")
                .sort_values("avg", ascending=False)
            )
            fig = px.bar(
                grouped,
                x="station_code",
                y="avg",
                color="station_code",
                color_discrete_sequence=CHART_COLORS,
            )
            return self._finalize_figure(fig, "Station Averages")

        if chart_type == "scatter":
            scatter_frame = frame.copy()
            scatter_frame["hour"] = scatter_frame["observed_at"].dt.hour + (scatter_frame["observed_at"].dt.minute / 60)
            scatter_frame = self._apply_point_budget(scatter_frame, payload.limit)
            fig = px.scatter(
                scatter_frame,
                x="hour",
                y="value",
                color="station_code",
                color_discrete_sequence=CHART_COLORS,
            )
            fig.update_layout(xaxis_title="Hour of Day (UTC)", yaxis_title="Measured Value")
            return self._finalize_figure(fig, "Station Scatter")

        if chart_type == "heatmap":
            matrix = self._measurement_day_hour_matrix(frame)
            fig = go.Figure(
                data=go.Heatmap(
                    z=matrix["z"],
                    x=matrix["hours"],
                    y=matrix["days"],
                    colorscale="Blues",
                    hovertemplate="Day %{y}<br>Hour %{x}:00<br>Value %{z:.3f}<extra></extra>",
                )
            )
            fig.update_layout(xaxis_title="Hour", yaxis_title="Day")
            return self._finalize_figure(fig, "Calendar Heatmap")

        plotted_temporal = self._smoothed_temporal_frame(temporal_frame, payload.rolling_window)
        plot_temporal_frame = self._apply_point_budget(plotted_temporal, payload.limit)
        fig = go.Figure()
        for index, key in enumerate(series_keys):
            if key not in plot_temporal_frame.columns:
                continue
            fig.add_trace(
                go.Scatter(
                    x=plot_temporal_frame["bucket"],
                    y=plot_temporal_frame[key],
                    mode="lines",
                    name=key,
                    line={"color": CHART_COLORS[index % len(CHART_COLORS)], "width": 2.5},
                )
            )
        if "overall" in plot_temporal_frame.columns and not series_keys:
            fig.add_trace(
                go.Scatter(
                    x=plot_temporal_frame["bucket"],
                    y=plot_temporal_frame["overall"],
                    mode="lines",
                    name="overall",
                    line={"color": CHART_COLORS[0], "width": 2.5},
                )
            )
        if payload.show_std_band:
            envelope = self._rolling_stats_frame(temporal_frame, payload.rolling_window)
            envelope = self._apply_point_budget(envelope, payload.limit)
            fig.add_trace(
                go.Scatter(
                    x=envelope["bucket"],
                    y=envelope["upper"],
                    mode="lines",
                    line={"width": 0},
                    name="+1 std",
                    showlegend=False,
                    hoverinfo="skip",
                )
            )
            fig.add_trace(
                go.Scatter(
                    x=envelope["bucket"],
                    y=envelope["lower"],
                    mode="lines",
                    line={"width": 0},
                    name="-1 std",
                    fill="tonexty",
                    fillcolor="rgba(80, 158, 227, 0.14)",
                    hoverinfo="skip",
                )
            )
        fig.update_layout(xaxis_title="Bucket", yaxis_title="Mean value")
        return self._finalize_figure(fig, "Time Series")

    def _measurement_histogram_figure(self, frame: pd.DataFrame) -> go.Figure:
        fig = px.histogram(frame, x="value", nbins=16, color_discrete_sequence=[CHART_COLORS[0]])
        fig.update_layout(xaxis_title="Value", yaxis_title="Count")
        return self._finalize_figure(fig, "Distribution Snapshot")

    def _measurement_rolling_envelope_figure(self, rolling_frame: pd.DataFrame) -> go.Figure:
        if rolling_frame.empty:
            return self._empty_figure("No rolling window series available.")
        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=rolling_frame["bucket"],
                y=rolling_frame["overall"],
                mode="lines",
                name="Observed",
                line={"color": "#1F5A8A"},
            )
        )
        fig.add_trace(
            go.Scatter(
                x=rolling_frame["bucket"],
                y=rolling_frame["mean"],
                mode="lines",
                name="Rolling mean",
                line={"color": "#509EE3"},
            )
        )
        fig.add_trace(
            go.Scatter(
                x=rolling_frame["bucket"],
                y=rolling_frame["upper"],
                mode="lines",
                name="Upper band",
                line={"color": "#94A3B8"},
            )
        )
        fig.add_trace(
            go.Scatter(
                x=rolling_frame["bucket"],
                y=rolling_frame["lower"],
                mode="lines",
                name="Lower band",
                line={"color": "#94A3B8"},
            )
        )
        return self._finalize_figure(fig, "Rolling Envelope")

    def _measurement_anomaly_figure(self, temporal_frame: pd.DataFrame) -> go.Figure:
        anomaly_frame = self._anomaly_frame(temporal_frame)
        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=anomaly_frame["bucket"],
                y=anomaly_frame["overall"],
                mode="lines",
                name="Observed",
                line={"color": "#1F5A8A"},
            )
        )
        fig.add_trace(
            go.Scatter(
                x=anomaly_frame["bucket"],
                y=anomaly_frame["upper"],
                mode="lines",
                name="Upper IQR",
                line={"color": "#94A3B8"},
            )
        )
        fig.add_trace(
            go.Scatter(
                x=anomaly_frame["bucket"],
                y=anomaly_frame["lower"],
                mode="lines",
                name="Lower IQR",
                line={"color": "#94A3B8"},
            )
        )
        anomalies = anomaly_frame.dropna(subset=["anomaly_value"])
        fig.add_trace(
            go.Scatter(
                x=anomalies["bucket"],
                y=anomalies["anomaly_value"],
                mode="markers",
                name="Anomaly",
                marker={"color": "#DC2626", "size": 8},
            )
        )
        return self._finalize_figure(fig, "Anomaly Detection")

    def _measurement_profile_figure(self, frame: pd.DataFrame, mode: str, aggregation_mode: str) -> go.Figure:
        profile_frame = self._profile_series(frame, mode, aggregation_mode)
        fig = px.bar(profile_frame, x="bucket", y="overall", color_discrete_sequence=[CHART_COLORS[0]])
        fig.update_layout(xaxis_title="Bucket", yaxis_title=aggregation_mode.upper())
        return self._finalize_figure(fig, "Temporal Profiles")

    def _measurement_profile_heatmap_figure(self, frame: pd.DataFrame, mode: str, aggregation_mode: str) -> go.Figure:
        heatmap = self._profile_heatmap(frame, mode, aggregation_mode)
        fig = go.Figure(
            data=go.Heatmap(
                z=heatmap["z"],
                x=heatmap["x_labels"],
                y=heatmap["y_labels"],
                colorscale="Blues",
                hovertemplate="%{y} / %{x}<br>Value %{z:.3f}<extra></extra>",
            )
        )
        fig.update_layout(xaxis_title=mode, yaxis_title="Year")
        return self._finalize_figure(fig, "Profile Heatmap")

    def _measurement_seasonality_figure(self, frame: pd.DataFrame, mode: str, aggregation_mode: str) -> go.Figure:
        normalized_mode = mode if mode in {"weekday", "month", "hour"} else "weekday"
        profile_frame = self._seasonal_profile(frame, normalized_mode, aggregation_mode)
        fig = px.bar(profile_frame, x="bucket", y="overall", color_discrete_sequence=[CHART_COLORS[0]])
        fig.update_layout(xaxis_title=normalized_mode, yaxis_title=aggregation_mode.upper())
        return self._finalize_figure(fig, "Calendar Profile")

    def _measurement_decomposition_figure(
        self,
        temporal_frame: pd.DataFrame,
        granularity: str,
        trend_window: int,
    ) -> go.Figure:
        decomposition, method = self._stl_decomposition(temporal_frame, granularity, trend_window)
        buckets = decomposition["bucket"]
        fig = make_subplots(
            rows=4,
            cols=1,
            shared_xaxes=True,
            subplot_titles=["Observed", "Trend", "Seasonal", "Residual"],
            vertical_spacing=0.07,
        )
        fig.add_trace(
            go.Scatter(
                x=buckets,
                y=decomposition["overall"],
                mode="lines",
                name="Observed",
                line={"color": "#1F5A8A", "width": 2.2},
            ),
            row=1,
            col=1,
        )
        fig.add_trace(
            go.Scatter(
                x=buckets,
                y=decomposition["trend"],
                mode="lines",
                name="Trend",
                line={"color": "#509EE3", "width": 2.2},
            ),
            row=2,
            col=1,
        )
        fig.add_trace(
            go.Scatter(
                x=buckets,
                y=decomposition["seasonal"],
                mode="lines",
                name="Seasonal",
                line={"color": "#0B7285", "width": 1.8},
            ),
            row=3,
            col=1,
        )
        residual = decomposition["residual"]
        fig.add_trace(
            go.Scatter(
                x=buckets,
                y=residual,
                mode="markers",
                name="Residual",
                marker={"color": "#A16207", "size": 3, "opacity": 0.7},
            ),
            row=4,
            col=1,
        )
        fig.add_hline(y=0, line_color="#64748B", line_dash="dash", line_width=1, row=4, col=1)
        title = f"Time Series Decomposition - {method}"
        fig.update_layout(
            template="plotly_white",
            paper_bgcolor="white",
            plot_bgcolor="white",
            height=700,
            margin={"l": 50, "r": 20, "t": 60, "b": 40},
            showlegend=False,
            title={"text": title, "x": 0.01, "xanchor": "left", "font": {"size": 14}},
        )
        for annotation in fig.layout.annotations:
            annotation.font = {"size": 11, "color": "#64748B"}
        return fig

    def _measurement_autocorr_figure(self, temporal_frame: pd.DataFrame, partial: bool) -> go.Figure:
        series = (
            self._partial_autocorrelation_frame(temporal_frame)
            if partial
            else self._autocorrelation_frame(temporal_frame)
        )
        title = "Partial Autocorrelation (PACF)" if partial else "Autocorrelation Function (ACF)"
        subtitle = "Durbin-Levinson algorithm" if partial else "Normalized autocovariance"
        color = "#0B7285" if partial else "#1F5A8A"
        n = max(len(temporal_frame), 1)
        significance = 1.96 / math.sqrt(n)
        if series.empty:
            return self._empty_figure(f"Not enough data to compute {title}.")
        fig = go.Figure()
        fig.add_hrect(
            y0=-significance,
            y1=significance,
            fillcolor="rgba(148, 163, 184, 0.15)",
            line_width=0,
            annotation_text="95% CI",
            annotation_position="top right",
            annotation_font={"size": 9, "color": "#94A3B8"},
        )
        fig.add_trace(
            go.Bar(
                x=series["bucket"],
                y=series["overall"],
                name=title,
                marker_color=[
                    color if abs(float(value)) >= significance else "rgba(148,163,184,0.55)"
                    for value in series["overall"]
                ],
            )
        )
        fig.add_hline(
            y=+significance,
            line_color="#DC2626",
            line_dash="dash",
            line_width=1.5,
            annotation_text=f"+{significance:.3f}",
            annotation_position="top left",
            annotation_font={"size": 9, "color": "#DC2626"},
        )
        fig.add_hline(
            y=-significance,
            line_color="#DC2626",
            line_dash="dash",
            line_width=1.5,
            annotation_text=f"{-significance:.3f}",
            annotation_position="bottom left",
            annotation_font={"size": 9, "color": "#DC2626"},
        )
        fig.add_hline(y=0, line_color="#334155", line_width=1)
        fig.update_yaxes(range=[-1.05, 1.05], title_text="Correlation")
        fig.update_xaxes(title_text="Lag")
        fig.update_layout(
            bargap=0.15,
            annotations=[
                {
                    "text": subtitle,
                    "xref": "paper",
                    "yref": "paper",
                    "x": 0.99,
                    "y": 0.99,
                    "xanchor": "right",
                    "yanchor": "top",
                    "showarrow": False,
                    "font": {"size": 9, "color": "#94A3B8"},
                },
            ],
        )
        return self._finalize_figure(fig, title)

    def _measurement_forecast_figure(
        self,
        temporal_frame: pd.DataFrame,
        granularity: str,
        horizon: int,
        trend_window: int,
    ) -> go.Figure:
        decomposition = self._decomposition_frame(temporal_frame, granularity, trend_window)
        forecast = self._forecast_frame(temporal_frame, granularity, horizon, decomposition)
        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=forecast["bucket"],
                y=forecast["observed"],
                mode="lines",
                name="Observed",
                line={"color": "#1F5A8A", "width": 2.2},
            )
        )
        fig.add_trace(
            go.Scatter(
                x=forecast["bucket"],
                y=forecast["upper"],
                mode="lines",
                line={"width": 0},
                name="Upper 95% CI",
                showlegend=False,
                hoverinfo="skip",
            )
        )
        fig.add_trace(
            go.Scatter(
                x=forecast["bucket"],
                y=forecast["lower"],
                mode="lines",
                line={"width": 0},
                fill="tonexty",
                fillcolor="rgba(80, 158, 227, 0.18)",
                name="95% CI",
                hoverinfo="skip",
            )
        )
        fig.add_trace(
            go.Scatter(
                x=forecast["bucket"],
                y=forecast["forecast"],
                mode="lines",
                name="Forecast",
                line={"color": "#509EE3", "width": 2.2, "dash": "dot"},
            )
        )
        history_end = (
            forecast.loc[forecast["observed"].notna(), "bucket"].iloc[-1]
            if forecast["observed"].notna().any()
            else None
        )
        if history_end is not None:
            fig.add_vline(
                x=history_end,
                line_color="#64748B",
                line_dash="dash",
                line_width=1,
                annotation_text="Forecast start",
                annotation_position="top left",
                annotation_font={"size": 9, "color": "#64748B"},
            )
        fig.update_yaxes(title_text="Value")
        fig.update_xaxes(title_text="Period")
        return self._finalize_figure(fig, "Forecast - Linear trend + seasonal adjustment (95% CI)")

    def _measurement_changepoints_figure(
        self,
        temporal_frame: pd.DataFrame,
        rolling_window: int,
        sensitivity: float,
    ) -> tuple[go.Figure, dict[str, Any]]:
        result = self._changepoint_result(temporal_frame, rolling_window, sensitivity)
        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=temporal_frame["bucket"],
                y=temporal_frame["overall"],
                mode="lines",
                name="Observed",
                line={"color": "#1F5A8A"},
            )
        )
        if result["markers"]:
            marker_frame = pd.DataFrame(result["markers"])
            fig.add_trace(
                go.Scatter(
                    x=marker_frame["bucket"],
                    y=marker_frame["value"],
                    mode="markers",
                    name="Changepoint",
                    marker={"color": "#DC2626", "size": 9, "symbol": "diamond"},
                )
            )
        stats = {
            "changepoint_threshold": result["threshold"],
            "changepoint_count": len(result["markers"]),
        }
        return self._finalize_figure(fig, "Changepoints"), stats

    def _measurement_trend_figure(
        self,
        temporal_frame: pd.DataFrame,
        granularity: str,
        trend_window: int,
        deseasonalized: bool,
    ) -> tuple[go.Figure, dict[str, Any]]:
        decomposition = self._decomposition_frame(temporal_frame, granularity, trend_window)
        result = self._trend_frame(temporal_frame, decomposition, deseasonalized)
        diagnostics = result["diagnostics"]
        series = result["series"]
        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=series["bucket"],
                y=series["overall"],
                mode="lines",
                name="Observed",
                line={"color": "#1F5A8A", "width": 2.2},
            )
        )
        fig.add_trace(
            go.Scatter(
                x=series["bucket"],
                y=series["linear"],
                mode="lines",
                name=f"OLS linear (b={diagnostics['linearSlope']:.4f}, R²={diagnostics['linearR2']:.3f})",
                line={"color": "#509EE3", "width": 2, "dash": "dash"},
            )
        )
        fig.add_trace(
            go.Scatter(
                x=series["bucket"],
                y=series["quadratic"],
                mode="lines",
                name="Quadratic fit",
                line={"color": "#0B7285", "width": 1.5, "dash": "dot"},
            )
        )
        if "senSlope" in diagnostics and diagnostics["senSlope"] is not None:
            x_idx = np.arange(len(series))
            sen_line = diagnostics["senIntercept"] + diagnostics["senSlope"] * x_idx
            fig.add_trace(
                go.Scatter(
                    x=series["bucket"],
                    y=sen_line,
                    mode="lines",
                    name=f"Sen's slope ({diagnostics['senSlope']:.4f}/period)",
                    line={"color": "#E9730C", "width": 1.8, "dash": "longdash"},
                )
            )
        if "mannKendallTau" in diagnostics and diagnostics["mannKendallTau"] is not None:
            tau = diagnostics["mannKendallTau"]
            p_value = diagnostics["mannKendallP"]
            significance = "***" if p_value < 0.001 else ("**" if p_value < 0.01 else ("*" if p_value < 0.05 else "ns"))
            mk_text = f"Mann-Kendall: tau={tau:.3f}, p={p_value:.4f} {significance}"
            fig.add_annotation(
                text=mk_text,
                xref="paper",
                yref="paper",
                x=0.01,
                y=0.01,
                xanchor="left",
                yanchor="bottom",
                showarrow=False,
                bgcolor="rgba(255,255,255,0.85)",
                bordercolor="#e2e8f0",
                borderwidth=1,
                font={"size": 10, "color": "#334155"},
            )
        suffix = " (deseasonalized)" if deseasonalized else ""
        return self._finalize_figure(fig, f"Trend Analysis{suffix}"), diagnostics

    def _measurement_correlation_figures(
        self,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
    ) -> tuple[go.Figure, list[EdaSecondaryFigure]]:
        correlation_matrix = self._correlation_matrix(frame, payload.granularity)
        pair_figure, pair_stats = self._measurement_pair_figure(frame, payload)

        matrix_figure = go.Figure(
            data=go.Heatmap(
                z=correlation_matrix["z"],
                x=correlation_matrix["variables"],
                y=correlation_matrix["variables"],
                zmin=-1,
                zmax=1,
                colorscale="RdBu",
                reversescale=True,
                text=np.round(correlation_matrix["z"], 2),
                texttemplate="%{text}",
                hovertemplate="%{y} vs %{x}<br>%{z:.3f}<extra></extra>",
            )
        )
        matrix_figure.update_layout(xaxis_title="Variable", yaxis_title="Variable")
        matrix_figure = self._finalize_figure(matrix_figure, "Correlation Matrix")
        pair_secondary = [
            self._secondary(
                "pair-comparison",
                "Pair Comparison",
                f"Pearson correlation: {pair_stats['pair_correlation']:.4f}",
                pair_figure,
            )
        ]

        if payload.chart_type in {"scatter", "regression"}:
            primary = pair_figure
            secondary = [self._secondary("correlation-matrix", "Correlation Matrix", None, matrix_figure)]
            return primary, secondary

        return matrix_figure, pair_secondary

    def _measurement_summary_figure(
        self,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        stats: dict[str, Any],
    ) -> go.Figure:
        chart_type = payload.chart_type
        if chart_type in {"histogram", "kde", "box", "violin"}:
            return self._distribution_figure(
                frame.rename(columns={"value": "metric_value", "variable_code": "metric_group"}),
                chart_type=chart_type,
                x_axis="metric_group",
                y_axis="metric_value",
                hue=None,
                facet_row=None,
                facet_col=None,
                payload=payload,
                title="Value Distribution",
            )

        summary_frame = pd.DataFrame(stats.get("variable_summary", []))
        if summary_frame.empty:
            return self._empty_figure("No variable summary is available.")
        fig = go.Figure()
        fig.add_trace(go.Bar(x=summary_frame["label"], y=summary_frame["mean"], name="Mean", marker_color="#509EE3"))
        fig.add_trace(
            go.Bar(
                x=summary_frame["label"],
                y=summary_frame["max"],
                name="Max",
                marker_color="#EF4444",
                opacity=0.6,
            )
        )
        fig.update_layout(barmode="group", xaxis_title="Variable", yaxis_title="Value")
        return self._finalize_figure(fig, "Statistical Summary")

    def _measurement_pair_figure(
        self,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
    ) -> tuple[go.Figure, dict[str, float]]:
        pair_variables = [payload.pair_variable_x, payload.pair_variable_y]
        cleaned = [value for value in pair_variables if value]
        if len(cleaned) < 2:
            variables = sorted(frame["variable_code"].astype(str).unique().tolist())
            if len(variables) >= 2:
                cleaned = variables[:2]
            elif len(variables) == 1:
                cleaned = [variables[0], variables[0]]
            else:
                cleaned = []
        if len(cleaned) < 2 or cleaned[0] == cleaned[1]:
            return (
                self._empty_figure("Not enough shared points to render variable pair comparison."),
                {"pair_correlation": 0.0},
            )

        working = frame.copy()
        working["bucket"] = working["observed_at"].map(lambda value: self._bucket_key(value, payload.granularity))
        pivot = (
            working[working["variable_code"].isin(cleaned)]
            .pivot_table(index="bucket", columns="variable_code", values="value", aggfunc="mean")
            .dropna(subset=cleaned, how="any")
            .reset_index()
        )
        if pivot.empty:
            return (
                self._empty_figure("Not enough shared points to render variable pair comparison."),
                {"pair_correlation": 0.0},
            )

        correlation = float(pivot[cleaned[0]].corr(pivot[cleaned[1]]) or 0.0)
        if payload.chart_type == "regression":
            fig = px.scatter(pivot, x=cleaned[0], y=cleaned[1], color_discrete_sequence=[CHART_COLORS[0]])
            regression = self._regression_line(
                pivot[cleaned[0]].to_numpy(dtype=float),
                pivot[cleaned[1]].to_numpy(dtype=float),
            )
            fig.add_trace(
                go.Scatter(
                    x=regression["x"],
                    y=regression["upper"],
                    mode="lines",
                    line={"width": 0},
                    showlegend=False,
                    hoverinfo="skip",
                )
            )
            fig.add_trace(
                go.Scatter(
                    x=regression["x"],
                    y=regression["lower"],
                    mode="lines",
                    line={"width": 0},
                    fill="tonexty",
                    fillcolor="rgba(80, 158, 227, 0.12)",
                    showlegend=False,
                    hoverinfo="skip",
                )
            )
            fig.add_trace(
                go.Scatter(
                    x=regression["x"],
                    y=regression["y"],
                    mode="lines",
                    name="Regression",
                    line={"color": "#1F5A8A"},
                )
            )
        else:
            fig = px.scatter(pivot, x=cleaned[0], y=cleaned[1], color_discrete_sequence=[CHART_COLORS[0]])
        fig.update_layout(xaxis_title=cleaned[0], yaxis_title=cleaned[1])
        return self._finalize_figure(fig, "Pair Comparison"), {"pair_correlation": correlation}

    def _compute_temporal_frame(
        self,
        frame: pd.DataFrame,
        granularity: str,
        split_by_station: bool,
        aggregation_mode: str,
    ) -> tuple[pd.DataFrame, list[str]]:
        working = frame.copy()
        working["bucket"] = working["observed_at"].map(lambda value: self._bucket_key(value, granularity))
        series_column = "station_code" if split_by_station else "variable_code"
        counts = working[series_column].astype(str).value_counts().sort_values(ascending=False)
        series_keys = counts.index.tolist() if split_by_station else counts.index.tolist()[:4]

        pivot = (
            working.groupby(["bucket", series_column], dropna=False)["value"]
            .apply(lambda series: self._aggregate_values(series, aggregation_mode))
            .reset_index()
            .pivot(index="bucket", columns=series_column, values="value")
            .reset_index()
        )
        overall = (
            working.groupby("bucket", dropna=False)["value"]
            .apply(lambda series: self._aggregate_values(series, aggregation_mode))
            .reset_index(name="overall")
        )
        temporal = overall.merge(pivot, on="bucket", how="left").sort_values("bucket").reset_index(drop=True)
        return temporal, series_keys

    def _smoothed_temporal_frame(self, temporal_frame: pd.DataFrame, window_size: int) -> pd.DataFrame:
        if temporal_frame.empty or window_size <= 0:
            return temporal_frame
        safe_window = max(1, min(120, int(window_size)))
        smoothed = temporal_frame.copy()
        for column in smoothed.columns:
            if column == "bucket":
                continue
            smoothed[column] = pd.to_numeric(smoothed[column], errors="coerce").rolling(
                window=safe_window,
                min_periods=1,
            ).mean()
        return smoothed

    def _rolling_stats_frame(self, temporal_frame: pd.DataFrame, window_size: int) -> pd.DataFrame:
        if temporal_frame.empty:
            return pd.DataFrame(columns=["bucket", "overall", "mean", "upper", "lower"])
        safe_window = max(2, min(120, int(window_size)))
        rolling = temporal_frame[["bucket", "overall"]].copy()
        rolling["mean"] = rolling["overall"].rolling(window=safe_window, min_periods=1).mean()
        rolling_std = rolling["overall"].rolling(window=safe_window, min_periods=1).std(ddof=0).fillna(0)
        rolling["upper"] = rolling["mean"] + rolling_std
        rolling["lower"] = rolling["mean"] - rolling_std
        return rolling

    def _anomaly_frame(self, temporal_frame: pd.DataFrame) -> pd.DataFrame:
        if temporal_frame.empty:
            return pd.DataFrame(columns=["bucket", "overall", "upper", "lower", "anomaly_value"])
        values = temporal_frame["overall"].to_numpy(dtype=float)
        if values.size < 5:
            output = temporal_frame[["bucket", "overall"]].copy()
            output["upper"] = np.nan
            output["lower"] = np.nan
            output["anomaly_value"] = np.nan
            return output
        sorted_values = np.sort(values)
        q1 = float(sorted_values[int(math.floor(len(sorted_values) * 0.25))])
        q3 = float(sorted_values[int(math.floor(len(sorted_values) * 0.75))])
        iqr = q3 - q1
        lower = q1 - (iqr * 1.5)
        upper = q3 + (iqr * 1.5)
        output = temporal_frame[["bucket", "overall"]].copy()
        output["lower"] = lower
        output["upper"] = upper
        output["anomaly_value"] = np.where(
            (output["overall"] < lower) | (output["overall"] > upper),
            output["overall"],
            np.nan,
        )
        return output

    def _seasonal_profile(self, frame: pd.DataFrame, mode: str, aggregation_mode: str) -> pd.DataFrame:
        working = frame.copy()
        if mode == "weekday":
            working["bucket"] = working["observed_at"].dt.dayofweek.map(lambda index: WEEKDAY_LABELS[index])
            order = WEEKDAY_LABELS
        elif mode == "month":
            working["bucket"] = working["observed_at"].dt.month.map(lambda value: f"{value:02d}")
            order = [f"{index:02d}" for index in range(1, 13)]
        else:
            working["bucket"] = working["observed_at"].dt.hour.map(lambda value: f"{value:02d}")
            order = [f"{index:02d}" for index in range(0, 24)]

        grouped = (
            working.groupby("bucket", dropna=False)["value"]
            .apply(lambda series: self._aggregate_values(series, aggregation_mode))
            .reset_index(name="overall")
        )
        grouped["__order"] = grouped["bucket"].map(lambda value: order.index(value) if value in order else 999)
        return grouped.sort_values("__order").drop(columns="__order")

    def _profile_series(self, frame: pd.DataFrame, mode: str, aggregation_mode: str) -> pd.DataFrame:
        working = frame.copy()
        if mode == "hour":
            working["bucket"] = working["observed_at"].dt.hour.map(lambda value: f"{value:02d}")
            order = [f"{index:02d}" for index in range(0, 24)]
        elif mode == "weekday":
            working["bucket"] = working["observed_at"].dt.dayofweek.map(lambda index: WEEKDAY_LABELS[index])
            order = WEEKDAY_LABELS
        elif mode == "month":
            working["bucket"] = working["observed_at"].dt.month.map(lambda index: MONTH_LABELS[index - 1])
            order = MONTH_LABELS
        elif mode == "quarter":
            working["bucket"] = working["observed_at"].dt.quarter.map(lambda value: f"Q{value}")
            order = ["Q1", "Q2", "Q3", "Q4"]
        else:
            working["bucket"] = working["observed_at"].dt.year.astype(str)
            order = sorted(working["bucket"].astype(str).unique().tolist())

        grouped = (
            working.groupby("bucket", dropna=False)["value"]
            .apply(lambda series: self._aggregate_values(series, aggregation_mode))
            .reset_index(name="overall")
        )
        grouped["__order"] = grouped["bucket"].map(lambda value: order.index(value) if value in order else 999)
        return grouped.sort_values(["__order", "bucket"]).drop(columns="__order")

    def _profile_heatmap(self, frame: pd.DataFrame, mode: str, aggregation_mode: str) -> dict[str, Any]:
        working = frame.copy()
        working["year"] = working["observed_at"].dt.year.astype(str)
        if mode == "month":
            working["x_label"] = working["observed_at"].dt.month.map(lambda index: MONTH_LABELS[index - 1])
            x_labels = MONTH_LABELS
        elif mode == "hour":
            working["x_label"] = working["observed_at"].dt.hour.map(lambda value: f"{value:02d}")
            x_labels = [f"{index:02d}" for index in range(24)]
        elif mode == "weekday":
            working["x_label"] = working["observed_at"].dt.dayofweek.map(lambda index: WEEKDAY_LABELS[index])
            x_labels = WEEKDAY_LABELS
        else:
            working["x_label"] = (
                working["observed_at"].dt.isocalendar().week.astype(int).map(lambda value: f"{value:02d}")
            )
            x_labels = [f"{index:02d}" for index in range(1, 54)]

        pivot = (
            working.groupby(["year", "x_label"], dropna=False)["value"]
            .apply(lambda series: self._aggregate_values(series, aggregation_mode))
            .reset_index(name="overall")
            .pivot(index="year", columns="x_label", values="overall")
        )
        x_present = [label for label in x_labels if label in pivot.columns]
        pivot = pivot.reindex(columns=x_present).sort_index()
        return {
            "x_labels": x_present,
            "y_labels": pivot.index.astype(str).tolist(),
            "z": np.nan_to_num(pivot.to_numpy(dtype=float), nan=np.nan),
        }

    def _decomposition_frame(
        self,
        temporal_frame: pd.DataFrame,
        granularity: str,
        trend_window: int,
    ) -> pd.DataFrame:
        if temporal_frame.empty:
            return pd.DataFrame(columns=["bucket", "overall", "trend", "seasonal", "residual"])
        values = temporal_frame["overall"].to_numpy(dtype=float)
        safe_window = max(2, min(120, int(trend_window)))
        trend = pd.Series(values).rolling(window=safe_window, min_periods=1).mean().to_numpy()
        period = max(2, min(self._seasonal_period(granularity), values.size))
        detrended = values - trend
        template: list[float] = []
        for phase in range(period):
            sample = detrended[np.arange(values.size) % period == phase]
            template.append(self._safe_mean(sample))
        centered = np.array(template, dtype=float) - self._safe_mean(np.array(template, dtype=float))
        seasonal = np.array([centered[index % period] for index in range(values.size)], dtype=float)
        residual = values - trend - seasonal
        return pd.DataFrame(
            {
                "bucket": temporal_frame["bucket"],
                "overall": values,
                "trend": trend,
                "seasonal": seasonal,
                "residual": residual,
            }
        )

    def _stl_decomposition(
        self,
        temporal_frame: pd.DataFrame,
        granularity: str,
        trend_window: int,
    ) -> tuple[pd.DataFrame, str]:
        if temporal_frame.empty:
            return pd.DataFrame(columns=["bucket", "overall", "trend", "seasonal", "residual"]), "Empty"

        values = temporal_frame["overall"].to_numpy(dtype=float)
        period = self._seasonal_period(granularity)
        min_length = 2 * period + 1

        if _STATSMODELS_AVAILABLE and values.size >= min_length:
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    stl = _STL(pd.Series(values), period=period, robust=True)
                    result = stl.fit()
                frame = pd.DataFrame(
                    {
                        "bucket": temporal_frame["bucket"],
                        "overall": values,
                        "trend": result.trend,
                        "seasonal": result.seasonal,
                        "residual": result.resid,
                    }
                )
                return frame, "STL (Cleveland 1990, robust=True)"
            except Exception:  # noqa: BLE001
                pass

        naive = self._decomposition_frame(temporal_frame, granularity, trend_window)
        reason = "Additive (MA)" if not _STATSMODELS_AVAILABLE else f"Additive (n={values.size} < {min_length} for STL)"
        return naive, reason

    def _autocorrelation_frame(self, temporal_frame: pd.DataFrame, max_lag: int = 30) -> pd.DataFrame:
        values = temporal_frame["overall"].to_numpy(dtype=float)
        if values.size < 3:
            return pd.DataFrame(columns=["bucket", "overall"])
        mean = self._safe_mean(values)
        denominator = float(np.sum((values - mean) ** 2))
        if denominator <= 1e-12:
            return pd.DataFrame(columns=["bucket", "overall"])
        lag_limit = min(max_lag, values.size - 2)
        output = []
        for lag in range(1, lag_limit + 1):
            numerator = float(np.sum((values[lag:] - mean) * (values[:-lag] - mean)))
            output.append({"bucket": f"Lag {lag}", "overall": numerator / denominator})
        return pd.DataFrame(output)

    def _partial_autocorrelation_frame(self, temporal_frame: pd.DataFrame, max_lag: int = 30) -> pd.DataFrame:
        values = temporal_frame["overall"].to_numpy(dtype=float)
        if values.size < 4:
            return pd.DataFrame(columns=["bucket", "overall"])
        lag_limit = min(max_lag, values.size - 2)
        if lag_limit < 1:
            return pd.DataFrame(columns=["bucket", "overall"])
        acf = [self._autocorrelation_at_lag(values, lag) for lag in range(lag_limit + 1)]
        phi: list[list[float]] = [[0.0 for _ in range(lag_limit + 1)] for _ in range(lag_limit + 1)]
        variance = [0.0 for _ in range(lag_limit + 1)]
        phi[1][1] = acf[1]
        variance[1] = max(1e-9, 1 - (phi[1][1] ** 2))
        for lag in range(2, lag_limit + 1):
            numerator = acf[lag]
            for index in range(1, lag):
                numerator -= phi[lag - 1][index] * acf[lag - index]
            denominator = max(variance[lag - 1], 1e-9)
            phi[lag][lag] = numerator / denominator
            for index in range(1, lag):
                phi[lag][index] = phi[lag - 1][index] - (phi[lag][lag] * phi[lag - 1][lag - index])
            variance[lag] = max(1e-9, variance[lag - 1] * (1 - (phi[lag][lag] ** 2)))
        return pd.DataFrame(
            {
                "bucket": [f"Lag {index}" for index in range(1, lag_limit + 1)],
                "overall": [phi[index][index] for index in range(1, lag_limit + 1)],
            }
        )

    def _forecast_frame(
        self,
        temporal_frame: pd.DataFrame,
        granularity: str,
        horizon: int,
        decomposition_frame: pd.DataFrame,
    ) -> pd.DataFrame:
        values = temporal_frame["overall"].to_numpy(dtype=float)
        if values.size == 0:
            return pd.DataFrame(columns=["bucket", "observed", "forecast", "upper", "lower"])
        linear = self._fit_linear(values)
        period = max(2, min(self._seasonal_period(granularity), values.size))
        seasonal_template = decomposition_frame["seasonal"].to_numpy(dtype=float)[:period]
        if seasonal_template.size < period:
            seasonal_template = np.pad(seasonal_template, (0, period - seasonal_template.size), constant_values=0)

        fitted = np.array(
            [
                (linear["intercept"] + (linear["slope"] * index)) + seasonal_template[index % period]
                for index in range(values.size)
            ],
            dtype=float,
        )
        residual_std = self._safe_std(values - fitted)
        padding = residual_std * 1.96

        history = pd.DataFrame(
            {
                "bucket": temporal_frame["bucket"],
                "observed": values,
                "forecast": fitted,
                "upper": fitted + padding,
                "lower": fitted - padding,
            }
        )

        last_bucket = str(temporal_frame["bucket"].iloc[-1])
        future_rows = []
        for step in range(1, max(1, horizon) + 1):
            absolute_index = values.size + step - 1
            forecast_value = (linear["intercept"] + (linear["slope"] * absolute_index)) + seasonal_template[
                absolute_index % period
            ]
            future_rows.append(
                {
                    "bucket": self._increment_bucket(last_bucket, granularity, step),
                    "observed": np.nan,
                    "forecast": forecast_value,
                    "upper": forecast_value + padding,
                    "lower": forecast_value - padding,
                }
            )

        return pd.concat([history, pd.DataFrame(future_rows)], ignore_index=True)

    def _changepoint_result(
        self,
        temporal_frame: pd.DataFrame,
        rolling_window: int,
        sensitivity: float,
    ) -> dict[str, Any]:
        values = temporal_frame["overall"].to_numpy(dtype=float)
        if values.size < 6:
            return {"markers": [], "threshold": 0.0}
        smooth = pd.Series(values).rolling(window=max(2, rolling_window), min_periods=1).mean().to_numpy()
        scores = np.abs(np.diff(smooth))
        threshold = self._safe_std(scores) * max(0.5, sensitivity)
        marker_indices = np.where(scores >= threshold)[0] + 1
        markers = [
            {
                "bucket": str(temporal_frame["bucket"].iloc[index]),
                "score": float(scores[index - 1]),
                "value": float(temporal_frame["overall"].iloc[index]),
            }
            for index in marker_indices
        ]
        return {"markers": markers, "threshold": float(threshold)}

    def _trend_frame(
        self,
        temporal_frame: pd.DataFrame,
        decomposition_frame: pd.DataFrame,
        deseasonalized: bool,
    ) -> dict[str, Any]:
        empty_diag: dict[str, Any] = {
            "linearSlope": 0.0,
            "linearIntercept": 0.0,
            "linearR2": 0.0,
            "trendDirection": "Stable",
            "mannKendallTau": None,
            "mannKendallP": None,
            "senSlope": None,
            "senIntercept": None,
        }
        if temporal_frame.empty:
            return {
                "series": pd.DataFrame(columns=["bucket", "overall", "linear", "quadratic"]),
                "diagnostics": empty_diag,
            }
        values = temporal_frame["overall"].to_numpy(dtype=float)
        if deseasonalized and not decomposition_frame.empty:
            values = values - decomposition_frame["seasonal"].to_numpy(dtype=float)
        linear = self._fit_linear(values)
        quadratic = self._fit_quadratic(values)

        direction = "Stable"
        if linear["slope"] > 0.001:
            direction = "Rising"
        elif linear["slope"] < -0.001:
            direction = "Falling"

        mk_tau: float | None = None
        mk_p: float | None = None
        sen_slope: float | None = None
        sen_intercept: float | None = None

        if _SCIPY_AVAILABLE and values.size >= 4:
            try:
                x_idx = np.arange(values.size, dtype=float)
                tau_result = _kendalltau(x_idx, values)
                mk_tau = float(tau_result.statistic)
                mk_p = float(tau_result.pvalue)
                theil = _theilslopes(values, x_idx)
                sen_slope = float(theil.slope)
                sen_intercept = float(theil.intercept)
                if mk_p < 0.05:
                    direction = "Rising" if mk_tau > 0 else "Falling"
            except Exception:  # noqa: BLE001
                pass

        return {
            "series": pd.DataFrame(
                {
                    "bucket": temporal_frame["bucket"],
                    "overall": values,
                    "linear": linear["predicted"],
                    "quadratic": quadratic,
                }
            ),
            "diagnostics": {
                "linearSlope": float(linear["slope"]),
                "linearIntercept": float(linear["intercept"]),
                "linearR2": float(linear["r2"]),
                "trendDirection": direction,
                "mannKendallTau": mk_tau,
                "mannKendallP": mk_p,
                "senSlope": sen_slope,
                "senIntercept": sen_intercept,
            },
        }

    def _correlation_matrix(self, frame: pd.DataFrame, granularity: str) -> dict[str, Any]:
        working = frame.copy()
        working["bucket"] = working["observed_at"].map(lambda value: self._bucket_key(value, granularity))
        pivot = working.pivot_table(index="bucket", columns="variable_code", values="value", aggfunc="mean")
        if pivot.empty:
            return {"variables": [], "z": np.empty((0, 0))}
        corr = pivot.corr().fillna(0)
        return {"variables": corr.columns.astype(str).tolist(), "z": corr.to_numpy(dtype=float)}

    def _measurement_day_hour_matrix(self, frame: pd.DataFrame) -> dict[str, Any]:
        working = frame.copy()
        working["day"] = working["observed_at"].dt.strftime("%Y-%m-%d")
        working["hour"] = working["observed_at"].dt.hour
        pivot = working.pivot_table(index="day", columns="hour", values="value", aggfunc="mean").sort_index()
        days = pivot.index.astype(str).tolist()
        hours = [int(hour) for hour in pivot.columns.tolist()]
        return {"days": days, "hours": hours, "z": np.nan_to_num(pivot.to_numpy(dtype=float), nan=np.nan)}

    def _measurement_variable_summary(self, frame: pd.DataFrame) -> list[dict[str, Any]]:
        grouped = (
            frame.groupby(["variable_code", "variable_name"], dropna=False)["value"]
            .agg(["count", "mean", "std", "min", "median", "max"])
            .reset_index()
            .fillna(0)
        )
        grouped["label"] = grouped["variable_name"].fillna(grouped["variable_code"])
        return grouped.rename(columns={"count": "count"}).to_dict(orient="records")

    def _measurement_summary_stats(self, frame: pd.DataFrame, temporal_frame: pd.DataFrame) -> dict[str, Any]:
        if frame.empty:
            return {"samples": 0, "mean": 0.0, "min": 0.0, "max": 0.0, "trend": "Stable"}
        values = frame["value"].to_numpy(dtype=float)
        trend = "Stable"
        if len(temporal_frame) >= 2:
            delta = float(temporal_frame["overall"].iloc[-1] - temporal_frame["overall"].iloc[0])
            threshold = max(0.05, abs(float(np.nanmean(values))) * 0.02)
            if delta > threshold:
                trend = "Rising"
            elif delta < -threshold:
                trend = "Falling"
        return {
            "samples": int(values.size),
            "mean": float(np.nanmean(values)),
            "min": float(np.nanmin(values)),
            "max": float(np.nanmax(values)),
            "trend": trend,
        }
