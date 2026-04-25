from __future__ import annotations

from typing import Any

import pandas as pd
import plotly.graph_objects as go
from sqlalchemy.orm import Session

from app.models.user import User
from app.schemas.eda import EdaPlotRequest, EdaPlotResponse, EdaSecondaryFigure
from app.services.eda.common import GENERIC_SECTIONS, EdaServiceError, EdaSharedMixin
from app.services.eda.generic import EdaGenericMixin
from app.services.eda.measurement import EdaMeasurementMixin
from app.services.manual_dataset import ManualDatasetEdaContext, ManualDatasetService


class EdaService(EdaGenericMixin, EdaMeasurementMixin, EdaSharedMixin):
    def __init__(self, db: Session, user: User):
        self.db = db
        self.user = user
        self.manual_dataset_service = ManualDatasetService(db)

    def build_plot(self, payload: EdaPlotRequest) -> EdaPlotResponse:
        warnings: list[str] = []
        context: ManualDatasetEdaContext | None = None

        if payload.manual_dataset_id:
            context = self.manual_dataset_service.get_eda_context(dataset_id=payload.manual_dataset_id, user=self.user)

        if context is not None and context.dataset.dataset_kind == "generic" and payload.section in GENERIC_SECTIONS:
            frame = self._prepare_generic_frame(context, payload, warnings)
            figure, secondary_figures, stats = self._build_generic_plot(context, frame, payload, warnings)
        else:
            frame = self._load_measurement_frame(payload, context)
            figure, secondary_figures, stats = self._build_measurement_plot(frame, payload, warnings)

        if self._supports_time_navigation(payload):
            figure = self._apply_time_navigation(figure, payload)

        return EdaPlotResponse(
            figure_json=self._serialize_figure(figure),
            secondary_figures=secondary_figures,
            stats=stats,
            warnings=warnings,
        )

    def _build_measurement_plot(
        self,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> tuple[go.Figure, list[EdaSecondaryFigure], dict[str, Any]]:
        if frame.empty:
            return (
                self._empty_figure("No data matched the current selection."),
                [],
                {"samples": 0, "mean": 0, "min": 0, "max": 0, "trend": "Stable", "row_count": 0},
            )

        split_by_station = len(payload.variable_codes) <= 1 and len(payload.station_codes) > 1
        temporal_frame, series_keys = self._compute_temporal_frame(
            frame,
            payload.granularity,
            split_by_station,
            payload.time_aggregation,
        )
        summary_stats = self._measurement_summary_stats(frame, temporal_frame)
        variable_summary = self._measurement_variable_summary(frame)
        stats: dict[str, Any] = {
            **summary_stats,
            "row_count": int(frame.shape[0]),
            "variable_summary": variable_summary,
            "selected_variables": sorted(frame["variable_code"].astype(str).unique().tolist()),
            "selected_stations": sorted(frame["station_code"].astype(str).unique().tolist()),
        }

        if payload.section == "rolling":
            chart_type = payload.chart_type or "line"
            figure = self._measurement_rolling_figure(frame, temporal_frame, series_keys, payload, chart_type)
            rolling_frame = self._rolling_stats_frame(temporal_frame, payload.rolling_window)
            secondary = [
                self._secondary(
                    "distribution",
                    "Distribution Snapshot",
                    "Histogram of the currently loaded values.",
                    self._measurement_histogram_figure(frame),
                ),
                self._secondary(
                    "rolling-envelope",
                    "Rolling Envelope",
                    f"Observed values against the rolling baseline for the last {payload.rolling_window} buckets.",
                    self._measurement_rolling_envelope_figure(rolling_frame),
                ),
            ]
            return figure, secondary, stats

        if payload.section == "anomaly":
            return self._measurement_anomaly_figure(temporal_frame), [], stats

        if payload.section == "profiles":
            figure = self._measurement_profile_figure(frame, payload.profile_mode, payload.profile_aggregation)
            heatmap_figure = self._measurement_profile_heatmap_figure(
                frame,
                payload.profile_heatmap_mode,
                payload.profile_aggregation,
            )
            return (
                figure,
                [
                    self._secondary(
                        "profile-heatmap",
                        "Profile Heatmap",
                        f"{payload.profile_heatmap_mode} aggregation matrix",
                        heatmap_figure,
                    )
                ],
                stats,
            )

        if payload.section == "seasonality":
            return (
                self._measurement_seasonality_figure(
                    frame,
                    payload.profile_mode,
                    payload.profile_aggregation,
                ),
                [],
                stats,
            )

        if payload.section == "decomposition":
            return (
                self._measurement_decomposition_figure(
                    temporal_frame,
                    payload.granularity,
                    payload.decomposition_window,
                ),
                [],
                stats,
            )

        if payload.section == "autocorr":
            return self._measurement_autocorr_figure(temporal_frame, partial=False), [], stats

        if payload.section == "pacf":
            return self._measurement_autocorr_figure(temporal_frame, partial=True), [], stats

        if payload.section == "forecast":
            return (
                self._measurement_forecast_figure(
                    temporal_frame,
                    payload.granularity,
                    payload.forecast_horizon,
                    payload.decomposition_window,
                ),
                [],
                stats,
            )

        if payload.section == "changepoints":
            figure, changepoint_stats = self._measurement_changepoints_figure(
                temporal_frame,
                payload.changepoint_window,
                payload.changepoint_sensitivity,
            )
            stats.update(changepoint_stats)
            return figure, [], stats

        if payload.section == "trend":
            figure, trend_stats = self._measurement_trend_figure(
                temporal_frame,
                payload.granularity,
                payload.decomposition_window,
                payload.trend_deseasonalized,
            )
            stats.update(trend_stats)
            return figure, [], stats

        if payload.section == "correlation":
            figure, secondary = self._measurement_correlation_figures(frame, payload)
            return figure, secondary, stats

        if payload.section == "summary":
            return self._measurement_summary_figure(frame, payload, stats), [], stats

        raise EdaServiceError(f"Unsupported EDA section: {payload.section}")

    def _build_generic_plot(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> tuple[go.Figure, list[EdaSecondaryFigure], dict[str, Any]]:
        stats = self._generic_stats(context, frame, payload)
        if frame.empty:
            return self._empty_figure("No rows matched the current EDA filters."), [], stats

        if payload.section == "rolling":
            figure = self._generic_time_series_figure(context, frame, payload, warnings)
            return figure, [], stats

        if payload.section == "summary":
            figure, secondary = self._generic_summary_figures(context, frame, payload, warnings)
            return figure, secondary, stats

        if payload.section == "correlation":
            figure, secondary = self._generic_correlation_figures(context, frame, payload, warnings)
            return figure, secondary, stats

        warnings.append(
            "This generic dataset currently supports Plotly-backed rolling, summary, and correlation sections."
        )
        return (
            self._empty_figure("Choose Rolling, Statistical Summary, or Correlation for generic datasets."),
            [],
            stats,
        )
