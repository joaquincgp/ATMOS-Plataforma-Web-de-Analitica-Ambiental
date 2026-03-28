from __future__ import annotations

import json
import math
import warnings
from typing import Any

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import plotly.io as pio
from plotly.subplots import make_subplots
from sqlalchemy.orm import Session

try:
    from statsmodels.tsa.seasonal import STL as _STL
    _STATSMODELS_AVAILABLE = True
except ImportError:  # pragma: no cover
    _STATSMODELS_AVAILABLE = False

try:
    from scipy.stats import kendalltau as _kendalltau
    from scipy.stats import theilslopes as _theilslopes
    _SCIPY_AVAILABLE = True
except ImportError:  # pragma: no cover
    _SCIPY_AVAILABLE = False

from app.models.user import User
from app.schemas.analytics import AnalyticsQueryRequest
from app.schemas.eda import EdaPlotRequest, EdaPlotResponse, EdaSecondaryFigure
from app.services.analytics_service import query_data
from app.services.etl.helpers import normalize_station_code, normalize_variable_code
from app.services.manual_dataset_service import ManualDatasetEdaContext, ManualDatasetService

CHART_COLORS = ['#509EE3', '#1F5A8A', '#0EA5E9', '#0B7285', '#16A34A', '#E9730C', '#D946EF', '#A16207']
WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
GENERIC_SECTIONS = {'rolling', 'summary', 'correlation'}


class EdaServiceError(ValueError):
    pass


class EdaService:
    def __init__(self, db: Session, user: User):
        self.db = db
        self.user = user
        self.manual_dataset_service = ManualDatasetService(db)

    def build_plot(self, payload: EdaPlotRequest) -> EdaPlotResponse:
        warnings: list[str] = []
        context: ManualDatasetEdaContext | None = None

        if payload.manual_dataset_id:
            context = self.manual_dataset_service.get_eda_context(dataset_id=payload.manual_dataset_id, user=self.user)

        if context is not None and context.dataset.dataset_kind == 'generic' and payload.section in GENERIC_SECTIONS:
            frame = self._prepare_generic_frame(context, payload, warnings)
            figure, secondary_figures, stats = self._build_generic_plot(context, frame, payload, warnings)
        else:
            frame = self._load_measurement_frame(payload, context)
            figure, secondary_figures, stats = self._build_measurement_plot(frame, payload, warnings)

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
                self._empty_figure('No data matched the current selection.'),
                [],
                {'samples': 0, 'mean': 0, 'min': 0, 'max': 0, 'trend': 'Stable', 'row_count': 0},
            )

        split_by_station = len(payload.variable_codes) <= 1 and len(payload.station_codes) > 1
        temporal_frame, series_keys = self._compute_temporal_frame(frame, payload.granularity, split_by_station)
        summary_stats = self._measurement_summary_stats(frame, temporal_frame)
        variable_summary = self._measurement_variable_summary(frame)
        stats: dict[str, Any] = {
            **summary_stats,
            'row_count': int(frame.shape[0]),
            'variable_summary': variable_summary,
            'selected_variables': sorted(frame['variable_code'].astype(str).unique().tolist()),
            'selected_stations': sorted(frame['station_code'].astype(str).unique().tolist()),
        }

        if payload.section == 'rolling':
            chart_type = payload.chart_type or 'line'
            figure = self._measurement_rolling_figure(frame, temporal_frame, series_keys, payload, chart_type)
            rolling_frame = self._rolling_stats_frame(temporal_frame, payload.rolling_window)
            secondary = [
                self._secondary(
                    'distribution',
                    'Distribution Snapshot',
                    'Histogram of the currently loaded values.',
                    self._measurement_histogram_figure(frame),
                ),
                self._secondary(
                    'rolling-envelope',
                    'Rolling Envelope',
                    f'Observed values against the rolling baseline for the last {payload.rolling_window} buckets.',
                    self._measurement_rolling_envelope_figure(rolling_frame),
                ),
            ]
            return figure, secondary, stats

        if payload.section == 'anomaly':
            return self._measurement_anomaly_figure(temporal_frame), [], stats

        if payload.section == 'profiles':
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
                        'profile-heatmap',
                        'Profile Heatmap',
                        f'{payload.profile_heatmap_mode} aggregation matrix',
                        heatmap_figure,
                    )
                ],
                stats,
            )

        if payload.section == 'seasonality':
            return self._measurement_seasonality_figure(frame, payload.profile_mode, payload.profile_aggregation), [], stats

        if payload.section == 'decomposition':
            return self._measurement_decomposition_figure(temporal_frame, payload.granularity, payload.decomposition_window), [], stats

        if payload.section == 'autocorr':
            return self._measurement_autocorr_figure(temporal_frame, partial=False), [], stats

        if payload.section == 'pacf':
            return self._measurement_autocorr_figure(temporal_frame, partial=True), [], stats

        if payload.section == 'forecast':
            return self._measurement_forecast_figure(
                temporal_frame,
                payload.granularity,
                payload.forecast_horizon,
                payload.decomposition_window,
            ), [], stats

        if payload.section == 'changepoints':
            figure, changepoint_stats = self._measurement_changepoints_figure(
                temporal_frame,
                payload.changepoint_window,
                payload.changepoint_sensitivity,
            )
            stats.update(changepoint_stats)
            return figure, [], stats

        if payload.section == 'trend':
            figure, trend_stats = self._measurement_trend_figure(
                temporal_frame,
                payload.granularity,
                payload.decomposition_window,
                payload.trend_deseasonalized,
            )
            stats.update(trend_stats)
            return figure, [], stats

        if payload.section == 'correlation':
            figure, secondary = self._measurement_correlation_figures(frame, payload)
            return figure, secondary, stats

        if payload.section == 'summary':
            return self._measurement_summary_figure(frame, payload, stats), [], stats

        raise EdaServiceError(f'Unsupported EDA section: {payload.section}')

    def _build_generic_plot(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> tuple[go.Figure, list[EdaSecondaryFigure], dict[str, Any]]:
        stats = self._generic_stats(context, frame, payload)
        if frame.empty:
            return self._empty_figure('No rows matched the current EDA filters.'), [], stats

        if payload.section == 'rolling':
            figure = self._generic_time_series_figure(context, frame, payload, warnings)
            return figure, [], stats

        if payload.section == 'summary':
            figure, secondary = self._generic_summary_figures(context, frame, payload, warnings)
            return figure, secondary, stats

        if payload.section == 'correlation':
            figure, secondary = self._generic_correlation_figures(context, frame, payload, warnings)
            return figure, secondary, stats

        warnings.append(
            'This generic dataset currently supports Plotly-backed rolling, summary, and correlation sections.'
        )
        return self._empty_figure('Choose Rolling, Statistical Summary, or Correlation for generic datasets.'), [], stats

    def _load_measurement_frame(
        self,
        payload: EdaPlotRequest,
        context: ManualDatasetEdaContext | None,
    ) -> pd.DataFrame:
        if context is not None:
            return self._measurement_frame_from_manual_context(context, payload)

        response = query_data(
            self.db,
            AnalyticsQueryRequest(
                source_file_ids=payload.source_file_ids,
                station_codes=payload.station_codes,
                variable_codes=payload.variable_codes,
                date_from=payload.date_from,
                date_to=payload.date_to,
                limit=payload.limit,
            ),
        )
        rows = [row.model_dump() for row in response.rows]
        if not rows:
            return pd.DataFrame(
                columns=[
                    'observed_at',
                    'station_code',
                    'station_name',
                    'variable_code',
                    'variable_name',
                    'value',
                    'unit',
                    'source_file_id',
                    'source_file_name',
                    'source_type',
                ]
            )

        frame = pd.DataFrame(rows)
        frame['observed_at'] = pd.to_datetime(frame['observed_at'], utc=True, errors='coerce')
        frame['value'] = pd.to_numeric(frame['value'], errors='coerce')
        frame = frame.dropna(subset=['observed_at', 'value']).sort_values('observed_at').reset_index(drop=True)
        return frame

    def _measurement_frame_from_manual_context(
        self,
        context: ManualDatasetEdaContext,
        payload: EdaPlotRequest,
    ) -> pd.DataFrame:
        frame = context.dataframe.copy()
        observed_at = self._resolve_context_datetime_series(context)
        value_column = self._resolve_context_value_column(context)
        station_column = context.mapping.station_code_column if context.mapping.station_code_column in frame.columns else None
        variable_column = context.mapping.variable_code_column if context.mapping.variable_code_column in frame.columns else None
        unit_column = context.mapping.unit_column if context.mapping.unit_column in frame.columns else None

        if observed_at is None or value_column is None:
            return pd.DataFrame(
                columns=[
                    'observed_at',
                    'station_code',
                    'station_name',
                    'variable_code',
                    'variable_name',
                    'value',
                    'unit',
                    'source_file_id',
                    'source_file_name',
                    'source_type',
                ]
            )

        frame['observed_at'] = observed_at
        frame['value'] = pd.to_numeric(frame[value_column], errors='coerce')
        frame['station_code'] = (
            frame[station_column].astype(str).map(normalize_station_code) if station_column else 'DATASET'
        )
        frame['station_name'] = frame['station_code']
        frame['variable_code'] = (
            frame[variable_column].astype(str).map(normalize_variable_code)
            if variable_column
            else normalize_variable_code(context.dataset.name)
        )
        frame['variable_name'] = frame['variable_code']
        frame['unit'] = frame[unit_column].astype(str) if unit_column else None
        frame['source_file_id'] = int(context.dataset.source_file_id or 0)
        frame['source_file_name'] = context.dataset.name
        frame['source_type'] = 'manual_dataset'
        frame = frame.dropna(subset=['observed_at', 'value'])

        if payload.date_from is not None:
            frame = frame[frame['observed_at'] >= pd.Timestamp(payload.date_from, tz='UTC')]
        if payload.date_to is not None:
            frame = frame[frame['observed_at'] < pd.Timestamp(payload.date_to, tz='UTC') + pd.Timedelta(days=1)]
        if payload.station_codes:
            allowed_stations = {normalize_station_code(code) for code in payload.station_codes}
            frame = frame[frame['station_code'].isin(allowed_stations)]
        if payload.variable_codes:
            allowed_variables = {normalize_variable_code(code) for code in payload.variable_codes}
            frame = frame[frame['variable_code'].isin(allowed_variables)]

        return frame.sort_values('observed_at').head(payload.limit).reset_index(drop=True)

    def _prepare_generic_frame(
        self,
        context: ManualDatasetEdaContext,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> pd.DataFrame:
        frame = context.dataframe.copy()
        if payload.variable_codes:
            selected = [column for column in payload.variable_codes if column in frame.columns]
            if selected:
                passthrough = {
                    payload.x_axis,
                    payload.y_axis,
                    payload.hue,
                    payload.facet_row,
                    payload.facet_col,
                }
                selected = [column for column in selected if column is not None]
                ordered = [column for column in frame.columns if column in set(selected) | {value for value in passthrough if value}]
                frame = frame[ordered].copy()

        filter_series = self._resolve_context_datetime_series(context)
        if filter_series is not None:
            frame['_filter_datetime'] = filter_series
            if payload.date_from is not None:
                frame = frame[frame['_filter_datetime'] >= pd.Timestamp(payload.date_from, tz='UTC')]
            if payload.date_to is not None:
                frame = frame[frame['_filter_datetime'] < pd.Timestamp(payload.date_to, tz='UTC') + pd.Timedelta(days=1)]

        for column_name in [payload.x_axis, payload.hue, payload.facet_row, payload.facet_col]:
            if column_name and column_name in frame.columns and self._is_categorical(frame[column_name]):
                frame = self._limit_categories(frame, column_name, warnings)

        return frame.head(payload.limit).reset_index(drop=True)

    def _measurement_rolling_figure(
        self,
        frame: pd.DataFrame,
        temporal_frame: pd.DataFrame,
        series_keys: list[str],
        payload: EdaPlotRequest,
        chart_type: str,
    ) -> go.Figure:
        if chart_type == 'bar':
            grouped = frame.groupby('station_code', dropna=False)['value'].mean().reset_index(name='avg').sort_values('avg', ascending=False)
            fig = px.bar(grouped, x='station_code', y='avg', color='station_code', color_discrete_sequence=CHART_COLORS)
            return self._finalize_figure(fig, 'Station Averages')

        if chart_type == 'scatter':
            scatter_frame = frame.copy()
            scatter_frame['hour'] = scatter_frame['observed_at'].dt.hour + (scatter_frame['observed_at'].dt.minute / 60)
            fig = px.scatter(
                scatter_frame.head(4000),
                x='hour',
                y='value',
                color='station_code',
                color_discrete_sequence=CHART_COLORS,
            )
            fig.update_layout(xaxis_title='Hour of Day (UTC)', yaxis_title='Measured Value')
            return self._finalize_figure(fig, 'Station Scatter')

        if chart_type == 'heatmap':
            matrix = self._measurement_day_hour_matrix(frame)
            fig = go.Figure(
                data=go.Heatmap(
                    z=matrix['z'],
                    x=matrix['hours'],
                    y=matrix['days'],
                    colorscale='Blues',
                    hovertemplate='Day %{y}<br>Hour %{x}:00<br>Value %{z:.3f}<extra></extra>',
                )
            )
            fig.update_layout(xaxis_title='Hour', yaxis_title='Day')
            return self._finalize_figure(fig, 'Calendar Heatmap')

        fig = go.Figure()
        for index, key in enumerate(series_keys):
            if key not in temporal_frame.columns:
                continue
            fig.add_trace(
                go.Scatter(
                    x=temporal_frame['bucket'],
                    y=temporal_frame[key],
                    mode='lines',
                    name=key,
                    line={'color': CHART_COLORS[index % len(CHART_COLORS)], 'width': 2.5},
                )
            )
        if 'overall' in temporal_frame.columns and not series_keys:
            fig.add_trace(
                go.Scatter(
                    x=temporal_frame['bucket'],
                    y=temporal_frame['overall'],
                    mode='lines',
                    name='overall',
                    line={'color': CHART_COLORS[0], 'width': 2.5},
                )
            )
        if payload.show_std_band:
            envelope = self._rolling_stats_frame(temporal_frame, payload.rolling_window)
            fig.add_trace(
                go.Scatter(
                    x=envelope['bucket'],
                    y=envelope['upper'],
                    mode='lines',
                    line={'width': 0},
                    name='+1 std',
                    showlegend=False,
                    hoverinfo='skip',
                )
            )
            fig.add_trace(
                go.Scatter(
                    x=envelope['bucket'],
                    y=envelope['lower'],
                    mode='lines',
                    line={'width': 0},
                    name='-1 std',
                    fill='tonexty',
                    fillcolor='rgba(80, 158, 227, 0.14)',
                    hoverinfo='skip',
                )
            )
        fig.update_layout(xaxis_title='Bucket', yaxis_title='Mean value')
        return self._finalize_figure(fig, 'Time Series')

    def _measurement_histogram_figure(self, frame: pd.DataFrame) -> go.Figure:
        fig = px.histogram(frame, x='value', nbins=16, color_discrete_sequence=[CHART_COLORS[0]])
        fig.update_layout(xaxis_title='Value', yaxis_title='Count')
        return self._finalize_figure(fig, 'Distribution Snapshot')

    def _measurement_rolling_envelope_figure(self, rolling_frame: pd.DataFrame) -> go.Figure:
        if rolling_frame.empty:
            return self._empty_figure('No rolling window series available.')
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=rolling_frame['bucket'], y=rolling_frame['overall'], mode='lines', name='Observed', line={'color': '#1F5A8A'}))
        fig.add_trace(go.Scatter(x=rolling_frame['bucket'], y=rolling_frame['mean'], mode='lines', name='Rolling mean', line={'color': '#509EE3'}))
        fig.add_trace(go.Scatter(x=rolling_frame['bucket'], y=rolling_frame['upper'], mode='lines', name='Upper band', line={'color': '#94A3B8'}))
        fig.add_trace(go.Scatter(x=rolling_frame['bucket'], y=rolling_frame['lower'], mode='lines', name='Lower band', line={'color': '#94A3B8'}))
        return self._finalize_figure(fig, 'Rolling Envelope')

    def _measurement_anomaly_figure(self, temporal_frame: pd.DataFrame) -> go.Figure:
        anomaly_frame = self._anomaly_frame(temporal_frame)
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=anomaly_frame['bucket'], y=anomaly_frame['overall'], mode='lines', name='Observed', line={'color': '#1F5A8A'}))
        fig.add_trace(go.Scatter(x=anomaly_frame['bucket'], y=anomaly_frame['upper'], mode='lines', name='Upper IQR', line={'color': '#94A3B8'}))
        fig.add_trace(go.Scatter(x=anomaly_frame['bucket'], y=anomaly_frame['lower'], mode='lines', name='Lower IQR', line={'color': '#94A3B8'}))
        anomalies = anomaly_frame.dropna(subset=['anomaly_value'])
        fig.add_trace(
            go.Scatter(
                x=anomalies['bucket'],
                y=anomalies['anomaly_value'],
                mode='markers',
                name='Anomaly',
                marker={'color': '#DC2626', 'size': 8},
            )
        )
        return self._finalize_figure(fig, 'Anomaly Detection')

    def _measurement_profile_figure(self, frame: pd.DataFrame, mode: str, aggregation_mode: str) -> go.Figure:
        profile_frame = self._profile_series(frame, mode, aggregation_mode)
        fig = px.bar(profile_frame, x='bucket', y='overall', color_discrete_sequence=[CHART_COLORS[0]])
        fig.update_layout(xaxis_title='Bucket', yaxis_title=aggregation_mode.upper())
        return self._finalize_figure(fig, 'Temporal Profiles')

    def _measurement_profile_heatmap_figure(self, frame: pd.DataFrame, mode: str, aggregation_mode: str) -> go.Figure:
        heatmap = self._profile_heatmap(frame, mode, aggregation_mode)
        fig = go.Figure(
            data=go.Heatmap(
                z=heatmap['z'],
                x=heatmap['x_labels'],
                y=heatmap['y_labels'],
                colorscale='Blues',
                hovertemplate='%{y} / %{x}<br>Value %{z:.3f}<extra></extra>',
            )
        )
        fig.update_layout(xaxis_title=mode, yaxis_title='Year')
        return self._finalize_figure(fig, 'Profile Heatmap')

    def _measurement_seasonality_figure(self, frame: pd.DataFrame, mode: str, aggregation_mode: str) -> go.Figure:
        normalized_mode = mode if mode in {'weekday', 'month', 'hour'} else 'weekday'
        profile_frame = self._seasonal_profile(frame, normalized_mode, aggregation_mode)
        fig = px.bar(profile_frame, x='bucket', y='overall', color_discrete_sequence=[CHART_COLORS[0]])
        fig.update_layout(xaxis_title=normalized_mode, yaxis_title=aggregation_mode.upper())
        return self._finalize_figure(fig, 'Calendar Profile')

    def _measurement_decomposition_figure(
        self,
        temporal_frame: pd.DataFrame,
        granularity: str,
        trend_window: int,
    ) -> go.Figure:
        decomposition, method = self._stl_decomposition(temporal_frame, granularity, trend_window)
        buckets = decomposition['bucket']
        fig = make_subplots(
            rows=4,
            cols=1,
            shared_xaxes=True,
            subplot_titles=['Observed', 'Trend', 'Seasonal', 'Residual'],
            vertical_spacing=0.07,
        )
        fig.add_trace(
            go.Scatter(x=buckets, y=decomposition['overall'], mode='lines', name='Observed',
                       line={'color': '#1F5A8A', 'width': 2.2}),
            row=1, col=1,
        )
        fig.add_trace(
            go.Scatter(x=buckets, y=decomposition['trend'], mode='lines', name='Trend',
                       line={'color': '#509EE3', 'width': 2.2}),
            row=2, col=1,
        )
        fig.add_trace(
            go.Scatter(x=buckets, y=decomposition['seasonal'], mode='lines', name='Seasonal',
                       line={'color': '#0B7285', 'width': 1.8}),
            row=3, col=1,
        )
        residual = decomposition['residual']
        fig.add_trace(
            go.Scatter(
                x=buckets,
                y=residual,
                mode='markers',
                name='Residual',
                marker={'color': '#A16207', 'size': 3, 'opacity': 0.7},
            ),
            row=4, col=1,
        )
        fig.add_hline(y=0, line_color='#64748B', line_dash='dash', line_width=1, row=4, col=1)
        title = f'Time Series Decomposition — {method}'
        fig.update_layout(
            template='plotly_white',
            paper_bgcolor='white',
            plot_bgcolor='white',
            height=700,
            margin={'l': 50, 'r': 20, 't': 60, 'b': 40},
            showlegend=False,
            title={'text': title, 'x': 0.01, 'xanchor': 'left', 'font': {'size': 14}},
        )
        for annotation in fig.layout.annotations:
            annotation.font = {'size': 11, 'color': '#64748B'}
        return fig

    def _measurement_autocorr_figure(self, temporal_frame: pd.DataFrame, partial: bool) -> go.Figure:
        series = self._partial_autocorrelation_frame(temporal_frame) if partial else self._autocorrelation_frame(temporal_frame)
        title = 'Partial Autocorrelation (PACF)' if partial else 'Autocorrelation Function (ACF)'
        subtitle = 'Durbin–Levinson algorithm' if partial else 'Normalized autocovariance'
        color = '#0B7285' if partial else '#1F5A8A'
        n = max(len(temporal_frame), 1)
        # Bartlett's formula: ±1.96/√n is the 95% confidence band for white noise
        significance = 1.96 / math.sqrt(n)
        if series.empty:
            return self._empty_figure(f'Not enough data to compute {title}.')
        fig = go.Figure()
        # Shaded confidence region
        fig.add_hrect(
            y0=-significance,
            y1=significance,
            fillcolor='rgba(148, 163, 184, 0.15)',
            line_width=0,
            annotation_text='95% CI',
            annotation_position='top right',
            annotation_font={'size': 9, 'color': '#94A3B8'},
        )
        # Bars
        fig.add_trace(
            go.Bar(
                x=series['bucket'],
                y=series['overall'],
                name=title,
                marker_color=[
                    color if abs(float(v)) >= significance else 'rgba(148,163,184,0.55)'
                    for v in series['overall']
                ],
            )
        )
        # Significance boundaries
        fig.add_hline(y=+significance, line_color='#DC2626', line_dash='dash', line_width=1.5,
                      annotation_text=f'+{significance:.3f}', annotation_position='top left',
                      annotation_font={'size': 9, 'color': '#DC2626'})
        fig.add_hline(y=-significance, line_color='#DC2626', line_dash='dash', line_width=1.5,
                      annotation_text=f'{-significance:.3f}', annotation_position='bottom left',
                      annotation_font={'size': 9, 'color': '#DC2626'})
        fig.add_hline(y=0, line_color='#334155', line_width=1)
        fig.update_yaxes(range=[-1.05, 1.05], title_text='Correlation')
        fig.update_xaxes(title_text='Lag')
        fig.update_layout(
            bargap=0.15,
            annotations=[
                {'text': subtitle, 'xref': 'paper', 'yref': 'paper',
                 'x': 0.99, 'y': 0.99, 'xanchor': 'right', 'yanchor': 'top',
                 'showarrow': False, 'font': {'size': 9, 'color': '#94A3B8'}},
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
        # Observed series
        fig.add_trace(
            go.Scatter(
                x=forecast['bucket'],
                y=forecast['observed'],
                mode='lines',
                name='Observed',
                line={'color': '#1F5A8A', 'width': 2.2},
            )
        )
        # Shaded 95% CI band — upper boundary (invisible, anchor for fill)
        fig.add_trace(
            go.Scatter(
                x=forecast['bucket'],
                y=forecast['upper'],
                mode='lines',
                line={'width': 0},
                name='Upper 95% CI',
                showlegend=False,
                hoverinfo='skip',
            )
        )
        # Lower boundary with fill to upper → shaded region
        fig.add_trace(
            go.Scatter(
                x=forecast['bucket'],
                y=forecast['lower'],
                mode='lines',
                line={'width': 0},
                fill='tonexty',
                fillcolor='rgba(80, 158, 227, 0.18)',
                name='95% CI',
                hoverinfo='skip',
            )
        )
        # Forecast line on top of the band
        fig.add_trace(
            go.Scatter(
                x=forecast['bucket'],
                y=forecast['forecast'],
                mode='lines',
                name='Forecast',
                line={'color': '#509EE3', 'width': 2.2, 'dash': 'dot'},
            )
        )
        # Vertical separator between history and forecast
        history_end = forecast.loc[forecast['observed'].notna(), 'bucket'].iloc[-1] if forecast['observed'].notna().any() else None
        if history_end is not None:
            fig.add_vline(
                x=history_end,
                line_color='#64748B',
                line_dash='dash',
                line_width=1,
                annotation_text='Forecast start',
                annotation_position='top left',
                annotation_font={'size': 9, 'color': '#64748B'},
            )
        fig.update_yaxes(title_text='Value')
        fig.update_xaxes(title_text='Period')
        return self._finalize_figure(fig, 'Forecast — Linear trend + seasonal adjustment (95% CI)')

    def _measurement_changepoints_figure(
        self,
        temporal_frame: pd.DataFrame,
        rolling_window: int,
        sensitivity: float,
    ) -> tuple[go.Figure, dict[str, Any]]:
        result = self._changepoint_result(temporal_frame, rolling_window, sensitivity)
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=temporal_frame['bucket'], y=temporal_frame['overall'], mode='lines', name='Observed', line={'color': '#1F5A8A'}))
        if result['markers']:
            marker_frame = pd.DataFrame(result['markers'])
            fig.add_trace(
                go.Scatter(
                    x=marker_frame['bucket'],
                    y=marker_frame['value'],
                    mode='markers',
                    name='Changepoint',
                    marker={'color': '#DC2626', 'size': 9, 'symbol': 'diamond'},
                )
            )
        stats = {
            'changepoint_threshold': result['threshold'],
            'changepoint_count': len(result['markers']),
        }
        return self._finalize_figure(fig, 'Changepoints'), stats

    def _measurement_trend_figure(
        self,
        temporal_frame: pd.DataFrame,
        granularity: str,
        trend_window: int,
        deseasonalized: bool,
    ) -> tuple[go.Figure, dict[str, Any]]:
        decomposition = self._decomposition_frame(temporal_frame, granularity, trend_window)
        result = self._trend_frame(temporal_frame, decomposition, deseasonalized)
        diag = result['diagnostics']
        series = result['series']
        fig = go.Figure()
        # Observed
        fig.add_trace(
            go.Scatter(
                x=series['bucket'], y=series['overall'],
                mode='lines', name='Observed',
                line={'color': '#1F5A8A', 'width': 2.2},
            )
        )
        # Linear OLS fit
        fig.add_trace(
            go.Scatter(
                x=series['bucket'], y=series['linear'],
                mode='lines', name=f"OLS linear (β={diag['linearSlope']:.4f}, R²={diag['linearR2']:.3f})",
                line={'color': '#509EE3', 'width': 2, 'dash': 'dash'},
            )
        )
        # Quadratic fit
        fig.add_trace(
            go.Scatter(
                x=series['bucket'], y=series['quadratic'],
                mode='lines', name="Quadratic fit",
                line={'color': '#0B7285', 'width': 1.5, 'dash': 'dot'},
            )
        )
        # Sen's slope line (if scipy available and computed)
        if 'senSlope' in diag and diag['senSlope'] is not None:
            x_idx = np.arange(len(series))
            sen_line = diag['senIntercept'] + diag['senSlope'] * x_idx
            fig.add_trace(
                go.Scatter(
                    x=series['bucket'], y=sen_line,
                    mode='lines',
                    name=f"Sen's slope ({diag['senSlope']:.4f}/period)",
                    line={'color': '#E9730C', 'width': 1.8, 'dash': 'longdash'},
                )
            )
        # Mann-Kendall annotation
        mk_text = ''
        if 'mannKendallTau' in diag and diag['mannKendallTau'] is not None:
            tau = diag['mannKendallTau']
            pval = diag['mannKendallP']
            significance = '***' if pval < 0.001 else ('**' if pval < 0.01 else ('*' if pval < 0.05 else 'ns'))
            mk_text = f'Mann-Kendall: τ={tau:.3f}, p={pval:.4f} {significance}'
            fig.add_annotation(
                text=mk_text,
                xref='paper', yref='paper',
                x=0.01, y=0.01,
                xanchor='left', yanchor='bottom',
                showarrow=False,
                bgcolor='rgba(255,255,255,0.85)',
                bordercolor='#e2e8f0',
                borderwidth=1,
                font={'size': 10, 'color': '#334155'},
            )
        suffix = ' (deseasonalized)' if deseasonalized else ''
        return self._finalize_figure(fig, f'Trend Analysis{suffix}'), diag

    def _measurement_correlation_figures(
        self,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
    ) -> tuple[go.Figure, list[EdaSecondaryFigure]]:
        correlation_matrix = self._correlation_matrix(frame, payload.granularity)
        pair_figure, pair_stats = self._measurement_pair_figure(frame, payload)

        matrix_figure = go.Figure(
            data=go.Heatmap(
                z=correlation_matrix['z'],
                x=correlation_matrix['variables'],
                y=correlation_matrix['variables'],
                zmin=-1,
                zmax=1,
                colorscale='RdBu',
                reversescale=True,
                text=np.round(correlation_matrix['z'], 2),
                texttemplate='%{text}',
                hovertemplate='%{y} vs %{x}<br>%{z:.3f}<extra></extra>',
            )
        )
        matrix_figure.update_layout(xaxis_title='Variable', yaxis_title='Variable')
        matrix_figure = self._finalize_figure(matrix_figure, 'Correlation Matrix')
        pair_secondary = [
            self._secondary(
                'pair-comparison',
                'Pair Comparison',
                f"Pearson correlation: {pair_stats['pair_correlation']:.4f}",
                pair_figure,
            )
        ]

        if payload.chart_type in {'scatter', 'regression'}:
            primary = pair_figure
            secondary = [self._secondary('correlation-matrix', 'Correlation Matrix', None, matrix_figure)]
            return primary, secondary

        return matrix_figure, pair_secondary

    def _measurement_summary_figure(
        self,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        stats: dict[str, Any],
    ) -> go.Figure:
        chart_type = payload.chart_type
        if chart_type in {'histogram', 'kde', 'box', 'violin'}:
            return self._distribution_figure(
                frame.rename(columns={'value': 'metric_value', 'variable_code': 'metric_group'}),
                chart_type=chart_type,
                x_axis='metric_group',
                y_axis='metric_value',
                hue=None,
                facet_row=None,
                facet_col=None,
                payload=payload,
                title='Value Distribution',
            )

        summary_frame = pd.DataFrame(stats.get('variable_summary', []))
        if summary_frame.empty:
            return self._empty_figure('No variable summary is available.')
        fig = go.Figure()
        fig.add_trace(go.Bar(x=summary_frame['label'], y=summary_frame['mean'], name='Mean', marker_color='#509EE3'))
        fig.add_trace(go.Bar(x=summary_frame['label'], y=summary_frame['max'], name='Max', marker_color='#EF4444', opacity=0.6))
        fig.update_layout(barmode='group', xaxis_title='Variable', yaxis_title='Value')
        return self._finalize_figure(fig, 'Statistical Summary')

    def _generic_time_series_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> go.Figure:
        x_axis = self._choose_generic_x_axis(context, frame, payload)
        y_axis = self._choose_generic_y_axis(context, frame, payload)
        if x_axis is None or y_axis is None:
            warnings.append(
                'Time series mode requires a datetime-like x-axis column and a numeric y-axis column.'
            )
            return self._empty_figure('Select a valid datetime/object x-axis and numeric y-axis.')

        working = frame.copy()
        working['_x_time'] = self._coerce_datetime_series(working[x_axis])
        if int(working['_x_time'].notna().sum()) == 0:
            warnings.append(
                'Time series mode requires a datetime-like object column on the x-axis.'
            )
            return self._empty_figure('The selected x-axis cannot be interpreted as time.')

        working['_y_value'] = pd.to_numeric(working[y_axis], errors='coerce')
        working = working.dropna(subset=['_x_time', '_y_value'])
        if working.empty:
            warnings.append('No time series rows remained after coercing the selected axes.')
            return self._empty_figure('No time series rows remained after applying the current axes.')

        chart_type = payload.chart_type or 'line'
        category_orders = self._category_orders(payload)
        if not payload.time_is_here:
            working['_bucket'] = working['_x_time'].map(lambda value: self._bucket_key(value, payload.granularity))
            group_columns = ['_bucket']
            if payload.hue and payload.hue in working.columns:
                group_columns.append(payload.hue)
            if payload.facet_row and payload.facet_row in working.columns:
                group_columns.append(payload.facet_row)
            if payload.facet_col and payload.facet_col in working.columns:
                group_columns.append(payload.facet_col)
            aggregated = (
                working.groupby(group_columns, dropna=False)['_y_value']
                .agg(['mean', 'std'])
                .reset_index()
                .rename(columns={'mean': '_plot_value', 'std': '_plot_std'})
            )
            plot_frame = aggregated.sort_values('_bucket')
            x_column = '_bucket'
            y_column = '_plot_value'
        else:
            plot_frame = working.sort_values('_x_time')
            x_column = '_x_time'
            y_column = '_y_value'

        if chart_type == 'scatter':
            fig = px.scatter(
                plot_frame,
                x=x_column,
                y=y_column,
                color=payload.hue if payload.hue in plot_frame.columns else None,
                facet_row=payload.facet_row if payload.facet_row in plot_frame.columns else None,
                facet_col=payload.facet_col if payload.facet_col in plot_frame.columns else None,
                category_orders=category_orders,
                color_discrete_sequence=CHART_COLORS,
            )
            fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis)
            return self._finalize_figure(fig, 'Raw Time Series')

        if chart_type == 'bar':
            fig = px.bar(
                plot_frame,
                x=x_column,
                y=y_column,
                color=payload.hue if payload.hue in plot_frame.columns else None,
                facet_row=payload.facet_row if payload.facet_row in plot_frame.columns else None,
                facet_col=payload.facet_col if payload.facet_col in plot_frame.columns else None,
                category_orders=category_orders,
                color_discrete_sequence=CHART_COLORS,
            )
            fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis)
            return self._finalize_figure(fig, 'Raw Time Series')

        if chart_type == 'heatmap':
            return self._generic_heatmap_figure(frame, payload, warnings, title='Raw Heatmap')

        fig = px.line(
            plot_frame,
            x=x_column,
            y=y_column,
            color=payload.hue if payload.hue in plot_frame.columns else None,
            facet_row=payload.facet_row if payload.facet_row in plot_frame.columns else None,
            facet_col=payload.facet_col if payload.facet_col in plot_frame.columns else None,
            category_orders=category_orders,
            color_discrete_sequence=CHART_COLORS,
        )
        if payload.show_std_band and '_plot_std' in plot_frame.columns and payload.hue is None and payload.facet_row is None and payload.facet_col is None:
            upper = plot_frame[y_column] + plot_frame['_plot_std'].fillna(0)
            lower = plot_frame[y_column] - plot_frame['_plot_std'].fillna(0)
            fig.add_trace(go.Scatter(x=plot_frame[x_column], y=upper, mode='lines', line={'width': 0}, showlegend=False, hoverinfo='skip'))
            fig.add_trace(
                go.Scatter(
                    x=plot_frame[x_column],
                    y=lower,
                    mode='lines',
                    line={'width': 0},
                    fill='tonexty',
                    fillcolor='rgba(80, 158, 227, 0.15)',
                    showlegend=False,
                    hoverinfo='skip',
                )
            )
        elif payload.show_std_band and ('_plot_std' not in plot_frame.columns or payload.hue or payload.facet_row or payload.facet_col):
            warnings.append('Standard deviation bands are only displayed for a single non-faceted time series.')

        fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis)
        return self._finalize_figure(fig, 'Raw Time Series')

    def _generic_summary_figures(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> tuple[go.Figure, list[EdaSecondaryFigure]]:
        chart_type = payload.chart_type or 'histogram'
        if chart_type == 'missing':
            primary, secondary = self._missing_data_figures(frame, warnings)
            return primary, secondary

        if chart_type == 'ridge':
            figure = self._generic_ridge_figure(context, frame, payload, warnings)
            return figure, []

        x_axis = payload.x_axis if payload.x_axis in frame.columns else None
        y_axis = self._choose_generic_y_axis(context, frame, payload)
        if y_axis is None:
            warnings.append('Summary plots require at least one numeric column.')
            return self._empty_figure('Select a numeric column for summary plots.'), []

        figure = self._distribution_figure(
            frame,
            chart_type=chart_type,
            x_axis=x_axis,
            y_axis=y_axis,
            hue=payload.hue if payload.hue in frame.columns else None,
            facet_row=payload.facet_row if payload.facet_row in frame.columns else None,
            facet_col=payload.facet_col if payload.facet_col in frame.columns else None,
            payload=payload,
            title='Statistical Summary',
        )
        return figure, []

    def _generic_correlation_figures(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> tuple[go.Figure, list[EdaSecondaryFigure]]:
        chart_type = payload.chart_type or 'heatmap'
        if chart_type == 'missing':
            primary, secondary = self._missing_data_figures(frame, warnings)
            return primary, secondary

        if chart_type in {'heatmap'}:
            return self._generic_heatmap_figure(frame, payload, warnings, title='Correlation Heatmap'), []

        if chart_type == 'pairplot':
            numeric_columns = self._selected_numeric_columns(context, frame, payload)
            if len(numeric_columns) < 2:
                warnings.append('Pairplots require at least two numeric columns.')
                return self._empty_figure('Select at least two numeric columns.'), []
            if len(numeric_columns) > 6:
                warnings.append('Pairplots are limited to the first six numeric columns.')
                numeric_columns = numeric_columns[:6]
            fig = px.scatter_matrix(
                frame.dropna(subset=numeric_columns),
                dimensions=numeric_columns,
                color=payload.hue if payload.hue in frame.columns and self._is_categorical(frame[payload.hue]) else None,
                color_discrete_sequence=CHART_COLORS,
            )
            return self._finalize_figure(fig, 'Pairplot'), []

        if chart_type == 'ridge':
            return self._generic_ridge_figure(context, frame, payload, warnings), []

        x_axis = payload.x_axis if payload.x_axis in frame.columns else None
        y_axis = payload.y_axis if payload.y_axis in frame.columns else None
        if x_axis is None or y_axis is None:
            numeric_columns = self._selected_numeric_columns(context, frame, payload)
            if len(numeric_columns) >= 2:
                x_axis = numeric_columns[0]
                y_axis = numeric_columns[1]
            else:
                warnings.append('Scatter and regression plots require two numeric columns.')
                return self._empty_figure('Select numeric X and Y columns.'), []

        x_series = pd.to_numeric(frame[x_axis], errors='coerce')
        y_series = pd.to_numeric(frame[y_axis], errors='coerce')
        plot_frame = frame.copy()
        plot_frame['_x'] = x_series
        plot_frame['_y'] = y_series
        plot_frame = plot_frame.dropna(subset=['_x', '_y'])
        if plot_frame.empty:
            warnings.append('Scatter and regression plots require numeric X and Y values.')
            return self._empty_figure('No numeric pairs remained after coercion.'), []

        fig = px.scatter(
            plot_frame,
            x='_x',
            y='_y',
            color=payload.hue if payload.hue in plot_frame.columns else None,
            facet_row=payload.facet_row if payload.facet_row in plot_frame.columns else None,
            facet_col=payload.facet_col if payload.facet_col in plot_frame.columns else None,
            color_discrete_sequence=CHART_COLORS,
        )
        fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis)

        if chart_type == 'regression':
            regression = self._regression_line(plot_frame['_x'].to_numpy(dtype=float), plot_frame['_y'].to_numpy(dtype=float))
            fig.add_trace(
                go.Scatter(
                    x=regression['x'],
                    y=regression['upper'],
                    mode='lines',
                    line={'width': 0},
                    showlegend=False,
                    hoverinfo='skip',
                )
            )
            fig.add_trace(
                go.Scatter(
                    x=regression['x'],
                    y=regression['lower'],
                    mode='lines',
                    line={'width': 0},
                    fill='tonexty',
                    fillcolor='rgba(31, 90, 138, 0.12)',
                    name='95% CI',
                )
            )
            fig.add_trace(
                go.Scatter(
                    x=regression['x'],
                    y=regression['y'],
                    mode='lines',
                    name='Regression',
                    line={'color': '#1F5A8A', 'width': 2.5},
                )
            )
        return self._finalize_figure(fig, 'Bivariate Analysis'), []

    def _generic_heatmap_figure(
        self,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
        *,
        title: str,
    ) -> go.Figure:
        numeric_columns = self._numeric_columns(frame)
        selected_numeric = [
            column for column in payload.variable_codes if column in numeric_columns
        ] or numeric_columns

        if len(selected_numeric) >= 2:
            corr = frame[selected_numeric].apply(pd.to_numeric, errors='coerce').corr().fillna(0)
            fig = go.Figure(
                data=go.Heatmap(
                    z=corr.to_numpy(),
                    x=corr.columns.tolist(),
                    y=corr.index.tolist(),
                    zmin=-1,
                    zmax=1,
                    colorscale='RdBu',
                    reversescale=True,
                    text=np.round(corr.to_numpy(), 2),
                    texttemplate='%{text}',
                    hovertemplate='%{y} vs %{x}<br>%{z:.3f}<extra></extra>',
                )
            )
            return self._finalize_figure(fig, title)

        x_axis = payload.x_axis if payload.x_axis in frame.columns else None
        y_axis = payload.y_axis if payload.y_axis in frame.columns else None
        if x_axis is None or y_axis is None:
            warnings.append(
                'Raw Heatmap mode requires either multiple numeric columns or a categorical and numeric axis pair.'
            )
            return self._empty_figure('Select numeric columns or a categorical + numeric pair.')

        y_numeric = pd.to_numeric(frame[y_axis], errors='coerce')
        if self._is_categorical(frame[x_axis]) and int(y_numeric.notna().sum()) > 0:
            plot_frame = frame.copy()
            plot_frame['_y_numeric'] = y_numeric
            plot_frame = plot_frame.dropna(subset=['_y_numeric'])
            fig = px.density_heatmap(
                plot_frame,
                x=x_axis,
                y='_y_numeric',
                facet_row=payload.facet_row if payload.facet_row in plot_frame.columns else None,
                facet_col=payload.facet_col if payload.facet_col in plot_frame.columns else None,
                category_orders=self._category_orders(payload),
                color_continuous_scale='Blues',
            )
            fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis)
            return self._finalize_figure(fig, title)

        warnings.append(
            'Raw Heatmap mode requires either multiple numeric columns or a categorical and numeric axis pair.'
        )
        return self._empty_figure('Selected axes do not meet heatmap requirements.')

    def _generic_ridge_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> go.Figure:
        x_axis = payload.x_axis if payload.x_axis in frame.columns else None
        y_axis = self._choose_generic_y_axis(context, frame, payload)
        if x_axis is None or y_axis is None or not self._is_categorical(frame[x_axis]):
            warnings.append('Ridgeplots require a categorical x-axis and a numeric y-axis.')
            return self._empty_figure('Select a categorical X column and a numeric Y column.')

        plot_frame = frame.copy()
        plot_frame['_y_value'] = pd.to_numeric(plot_frame[y_axis], errors='coerce')
        plot_frame = plot_frame.dropna(subset=['_y_value'])
        categories = plot_frame[x_axis].astype(str).value_counts().head(12).index.tolist()
        plot_frame = plot_frame[plot_frame[x_axis].astype(str).isin(categories)]

        fig = go.Figure()
        for index, category in enumerate(categories):
            sample = plot_frame[plot_frame[x_axis].astype(str) == category]['_y_value'].to_numpy(dtype=float)
            if sample.size == 0:
                continue
            fig.add_trace(
                go.Violin(
                    x=np.repeat(category, sample.size),
                    y=sample,
                    name=category,
                    box_visible=False,
                    meanline_visible=True,
                    line_color=CHART_COLORS[index % len(CHART_COLORS)],
                    fillcolor=CHART_COLORS[index % len(CHART_COLORS)],
                    opacity=0.5,
                )
            )
        fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis, violinmode='overlay')
        return self._finalize_figure(fig, 'Ridgeplot')

    def _distribution_figure(
        self,
        frame: pd.DataFrame,
        *,
        chart_type: str,
        x_axis: str | None,
        y_axis: str,
        hue: str | None,
        facet_row: str | None,
        facet_col: str | None,
        payload: EdaPlotRequest,
        title: str,
    ) -> go.Figure:
        working = frame.copy()
        working['_value'] = pd.to_numeric(working[y_axis], errors='coerce')
        working = working.dropna(subset=['_value'])
        category_orders = self._category_orders(payload)

        if chart_type == 'kde':
            fig = go.Figure()
            groups = [(None, working)] if hue is None else list(working.groupby(hue, dropna=False))
            for index, (group_name, group_frame) in enumerate(groups):
                grid, density = self._kde_curve(
                    group_frame['_value'].to_numpy(dtype=float),
                    cumulative=payload.cumulative,
                    normalize_density=payload.normalize_density,
                )
                fig.add_trace(
                    go.Scatter(
                        x=grid,
                        y=density,
                        mode='lines',
                        name=str(group_name) if group_name is not None else y_axis,
                        line={'color': CHART_COLORS[index % len(CHART_COLORS)], 'width': 2.5},
                    )
                )
            fig.update_layout(xaxis_title=y_axis, yaxis_title='Density')
            return self._finalize_figure(fig, title)

        if chart_type == 'box':
            fig = px.box(
                working,
                x=x_axis if x_axis in working.columns else None,
                y='_value',
                color=hue if hue in working.columns else None,
                facet_row=facet_row if facet_row in working.columns else None,
                facet_col=facet_col if facet_col in working.columns else None,
                points='all' if payload.swarm_overlay else False,
                category_orders=category_orders,
                color_discrete_sequence=CHART_COLORS,
            )
            fig.update_layout(xaxis_title=x_axis or y_axis, yaxis_title=y_axis)
            return self._finalize_figure(fig, title)

        if chart_type == 'violin':
            fig = px.violin(
                working,
                x=x_axis if x_axis in working.columns else None,
                y='_value',
                color=hue if hue in working.columns else None,
                facet_row=facet_row if facet_row in working.columns else None,
                facet_col=facet_col if facet_col in working.columns else None,
                box=True,
                points='all' if payload.swarm_overlay else False,
                category_orders=category_orders,
                color_discrete_sequence=CHART_COLORS,
            )
            fig.update_layout(xaxis_title=x_axis or y_axis, yaxis_title=y_axis)
            return self._finalize_figure(fig, title)

        fig = px.histogram(
            working,
            x='_value',
            color=hue if hue in working.columns else None,
            facet_row=facet_row if facet_row in working.columns else None,
            facet_col=facet_col if facet_col in working.columns else None,
            histnorm='probability density' if payload.normalize_density else None,
            cumulative={'enabled': payload.cumulative},
            category_orders=category_orders,
            color_discrete_sequence=CHART_COLORS,
        )
        fig.update_layout(xaxis_title=y_axis, yaxis_title='Density' if payload.normalize_density else 'Count')
        return self._finalize_figure(fig, title)

    def _missing_data_figures(
        self,
        frame: pd.DataFrame,
        warnings: list[str],
    ) -> tuple[go.Figure, list[EdaSecondaryFigure]]:
        missing_matrix = frame.isna().astype(int)
        if missing_matrix.empty:
            return self._empty_figure('No columns are available for missing-data analysis.'), []

        if missing_matrix.shape[1] > 40:
            warnings.append('Missing-data heatmaps are limited to the first 40 columns.')
            missing_matrix = missing_matrix.iloc[:, :40]

        primary = go.Figure(
            data=go.Heatmap(
                z=missing_matrix.transpose().to_numpy(),
                x=list(range(1, len(missing_matrix) + 1)),
                y=missing_matrix.columns.tolist(),
                colorscale=[[0, '#EEF6FF'], [1, '#DC2626']],
                showscale=False,
                hovertemplate='Row %{x}<br>Column %{y}<br>Missing %{z}<extra></extra>',
            )
        )
        primary = self._finalize_figure(primary, 'Missingness Matrix')

        missing_rate = (missing_matrix.mean() * 100).sort_values(ascending=False).reset_index()
        missing_rate.columns = ['column', 'missing_pct']
        rate_figure = px.bar(missing_rate, x='column', y='missing_pct', color_discrete_sequence=[CHART_COLORS[0]])
        rate_figure.update_layout(xaxis_title='Column', yaxis_title='Missing %')
        secondary = [self._secondary('missing-rate', 'Missing Rate', 'Percent missing by column.', self._finalize_figure(rate_figure, 'Missing Rate'))]

        if missing_matrix.shape[1] >= 2:
            corr = missing_matrix.corr().fillna(0)
            corr_figure = go.Figure(
                data=go.Heatmap(
                    z=corr.to_numpy(),
                    x=corr.columns.tolist(),
                    y=corr.index.tolist(),
                    colorscale='RdBu',
                    reversescale=True,
                    zmin=-1,
                    zmax=1,
                    text=np.round(corr.to_numpy(), 2),
                    texttemplate='%{text}',
                    hovertemplate='%{y} vs %{x}<br>%{z:.3f}<extra></extra>',
                )
            )
            secondary.append(
                self._secondary(
                    'missing-correlation',
                    'Missing Correlation',
                    'Correlation of missingness patterns across columns.',
                    self._finalize_figure(corr_figure, 'Missing Correlation'),
                )
            )

        return primary, secondary

    def _measurement_pair_figure(
        self,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
    ) -> tuple[go.Figure, dict[str, float]]:
        pair_variables = [payload.pair_variable_x, payload.pair_variable_y]
        cleaned = [value for value in pair_variables if value]
        if len(cleaned) < 2:
            variables = sorted(frame['variable_code'].astype(str).unique().tolist())
            if len(variables) >= 2:
                cleaned = variables[:2]
            elif len(variables) == 1:
                cleaned = [variables[0], variables[0]]
            else:
                cleaned = []
        if len(cleaned) < 2 or cleaned[0] == cleaned[1]:
            return self._empty_figure('Not enough shared points to render variable pair comparison.'), {'pair_correlation': 0.0}

        working = frame.copy()
        working['bucket'] = working['observed_at'].map(lambda value: self._bucket_key(value, payload.granularity))
        pivot = (
            working[working['variable_code'].isin(cleaned)]
            .pivot_table(index='bucket', columns='variable_code', values='value', aggfunc='mean')
            .dropna(subset=cleaned, how='any')
            .reset_index()
        )
        if pivot.empty:
            return self._empty_figure('Not enough shared points to render variable pair comparison.'), {'pair_correlation': 0.0}

        correlation = float(pivot[cleaned[0]].corr(pivot[cleaned[1]]) or 0.0)
        if payload.chart_type == 'regression':
            fig = px.scatter(pivot, x=cleaned[0], y=cleaned[1], color_discrete_sequence=[CHART_COLORS[0]])
            regression = self._regression_line(
                pivot[cleaned[0]].to_numpy(dtype=float),
                pivot[cleaned[1]].to_numpy(dtype=float),
            )
            fig.add_trace(go.Scatter(x=regression['x'], y=regression['upper'], mode='lines', line={'width': 0}, showlegend=False, hoverinfo='skip'))
            fig.add_trace(
                go.Scatter(
                    x=regression['x'],
                    y=regression['lower'],
                    mode='lines',
                    line={'width': 0},
                    fill='tonexty',
                    fillcolor='rgba(80, 158, 227, 0.12)',
                    showlegend=False,
                    hoverinfo='skip',
                )
            )
            fig.add_trace(go.Scatter(x=regression['x'], y=regression['y'], mode='lines', name='Regression', line={'color': '#1F5A8A'}))
        else:
            fig = px.scatter(pivot, x=cleaned[0], y=cleaned[1], color_discrete_sequence=[CHART_COLORS[0]])
        fig.update_layout(xaxis_title=cleaned[0], yaxis_title=cleaned[1])
        return self._finalize_figure(fig, 'Pair Comparison'), {'pair_correlation': correlation}

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
        fig.add_annotation(text=message, x=0.5, y=0.5, xref='paper', yref='paper', showarrow=False, font={'size': 15, 'color': '#64748B'})
        fig.update_xaxes(visible=False)
        fig.update_yaxes(visible=False)
        return self._finalize_figure(fig)

    def _finalize_figure(self, figure: go.Figure, title: str | None = None) -> go.Figure:
        figure.update_layout(
            template='plotly_white',
            paper_bgcolor='white',
            plot_bgcolor='white',
            margin={'l': 40, 'r': 20, 't': 48 if title else 24, 'b': 40},
            legend={'orientation': 'h', 'yanchor': 'bottom', 'y': 1.02, 'xanchor': 'left', 'x': 0},
        )
        if title:
            figure.update_layout(title={'text': title, 'x': 0.01, 'xanchor': 'left'})
        return figure

    def _compute_temporal_frame(
        self,
        frame: pd.DataFrame,
        granularity: str,
        split_by_station: bool,
    ) -> tuple[pd.DataFrame, list[str]]:
        working = frame.copy()
        working['bucket'] = working['observed_at'].map(lambda value: self._bucket_key(value, granularity))
        series_column = 'station_code' if split_by_station else 'variable_code'
        counts = working[series_column].astype(str).value_counts().sort_values(ascending=False)
        series_keys = counts.index.tolist() if split_by_station else counts.index.tolist()[:4]

        pivot = (
            working.groupby(['bucket', series_column], dropna=False)['value']
            .mean()
            .reset_index()
            .pivot(index='bucket', columns=series_column, values='value')
            .reset_index()
        )
        overall = working.groupby('bucket', dropna=False)['value'].mean().reset_index(name='overall')
        temporal = overall.merge(pivot, on='bucket', how='left').sort_values('bucket').reset_index(drop=True)
        return temporal, series_keys

    def _rolling_stats_frame(self, temporal_frame: pd.DataFrame, window_size: int) -> pd.DataFrame:
        if temporal_frame.empty:
            return pd.DataFrame(columns=['bucket', 'overall', 'mean', 'upper', 'lower'])
        safe_window = max(2, min(120, int(window_size)))
        rolling = temporal_frame[['bucket', 'overall']].copy()
        rolling['mean'] = rolling['overall'].rolling(window=safe_window, min_periods=1).mean()
        rolling_std = rolling['overall'].rolling(window=safe_window, min_periods=1).std(ddof=0).fillna(0)
        rolling['upper'] = rolling['mean'] + rolling_std
        rolling['lower'] = rolling['mean'] - rolling_std
        return rolling

    def _anomaly_frame(self, temporal_frame: pd.DataFrame) -> pd.DataFrame:
        if temporal_frame.empty:
            return pd.DataFrame(columns=['bucket', 'overall', 'upper', 'lower', 'anomaly_value'])
        values = temporal_frame['overall'].to_numpy(dtype=float)
        if values.size < 5:
            output = temporal_frame[['bucket', 'overall']].copy()
            output['upper'] = np.nan
            output['lower'] = np.nan
            output['anomaly_value'] = np.nan
            return output
        sorted_values = np.sort(values)
        q1 = float(sorted_values[int(math.floor(len(sorted_values) * 0.25))])
        q3 = float(sorted_values[int(math.floor(len(sorted_values) * 0.75))])
        iqr = q3 - q1
        lower = q1 - (iqr * 1.5)
        upper = q3 + (iqr * 1.5)
        output = temporal_frame[['bucket', 'overall']].copy()
        output['lower'] = lower
        output['upper'] = upper
        output['anomaly_value'] = np.where((output['overall'] < lower) | (output['overall'] > upper), output['overall'], np.nan)
        return output

    def _seasonal_profile(self, frame: pd.DataFrame, mode: str, aggregation_mode: str) -> pd.DataFrame:
        working = frame.copy()
        if mode == 'weekday':
            working['bucket'] = working['observed_at'].dt.dayofweek.map(lambda index: WEEKDAY_LABELS[index])
            order = WEEKDAY_LABELS
        elif mode == 'month':
            working['bucket'] = working['observed_at'].dt.month.map(lambda value: f'{value:02d}')
            order = [f'{index:02d}' for index in range(1, 13)]
        else:
            working['bucket'] = working['observed_at'].dt.hour.map(lambda value: f'{value:02d}')
            order = [f'{index:02d}' for index in range(0, 24)]

        grouped = working.groupby('bucket', dropna=False)['value'].apply(lambda series: self._aggregate_values(series, aggregation_mode)).reset_index(name='overall')
        grouped['__order'] = grouped['bucket'].map(lambda value: order.index(value) if value in order else 999)
        return grouped.sort_values('__order').drop(columns='__order')

    def _profile_series(self, frame: pd.DataFrame, mode: str, aggregation_mode: str) -> pd.DataFrame:
        working = frame.copy()
        if mode == 'hour':
            working['bucket'] = working['observed_at'].dt.hour.map(lambda value: f'{value:02d}')
            order = [f'{index:02d}' for index in range(0, 24)]
        elif mode == 'weekday':
            working['bucket'] = working['observed_at'].dt.dayofweek.map(lambda index: WEEKDAY_LABELS[index])
            order = WEEKDAY_LABELS
        elif mode == 'month':
            working['bucket'] = working['observed_at'].dt.month.map(lambda index: MONTH_LABELS[index - 1])
            order = MONTH_LABELS
        elif mode == 'quarter':
            working['bucket'] = working['observed_at'].dt.quarter.map(lambda value: f'Q{value}')
            order = ['Q1', 'Q2', 'Q3', 'Q4']
        else:
            working['bucket'] = working['observed_at'].dt.year.astype(str)
            order = sorted(working['bucket'].astype(str).unique().tolist())

        grouped = working.groupby('bucket', dropna=False)['value'].apply(lambda series: self._aggregate_values(series, aggregation_mode)).reset_index(name='overall')
        grouped['__order'] = grouped['bucket'].map(lambda value: order.index(value) if value in order else 999)
        return grouped.sort_values(['__order', 'bucket']).drop(columns='__order')

    def _profile_heatmap(self, frame: pd.DataFrame, mode: str, aggregation_mode: str) -> dict[str, Any]:
        working = frame.copy()
        working['year'] = working['observed_at'].dt.year.astype(str)
        if mode == 'month':
            working['x_label'] = working['observed_at'].dt.month.map(lambda index: MONTH_LABELS[index - 1])
            x_labels = MONTH_LABELS
        elif mode == 'hour':
            working['x_label'] = working['observed_at'].dt.hour.map(lambda value: f'{value:02d}')
            x_labels = [f'{index:02d}' for index in range(24)]
        elif mode == 'weekday':
            working['x_label'] = working['observed_at'].dt.dayofweek.map(lambda index: WEEKDAY_LABELS[index])
            x_labels = WEEKDAY_LABELS
        else:
            working['x_label'] = working['observed_at'].dt.isocalendar().week.astype(int).map(lambda value: f'{value:02d}')
            x_labels = [f'{index:02d}' for index in range(1, 54)]

        pivot = (
            working.groupby(['year', 'x_label'], dropna=False)['value']
            .apply(lambda series: self._aggregate_values(series, aggregation_mode))
            .reset_index(name='overall')
            .pivot(index='year', columns='x_label', values='overall')
        )
        x_present = [label for label in x_labels if label in pivot.columns]
        pivot = pivot.reindex(columns=x_present).sort_index()
        return {
            'x_labels': x_present,
            'y_labels': pivot.index.astype(str).tolist(),
            'z': np.nan_to_num(pivot.to_numpy(dtype=float), nan=np.nan),
        }

    def _decomposition_frame(self, temporal_frame: pd.DataFrame, granularity: str, trend_window: int) -> pd.DataFrame:
        """Naive additive decomposition (moving-average trend + periodic seasonal template).
        Used as fallback and as the source for forecast/trend helpers."""
        if temporal_frame.empty:
            return pd.DataFrame(columns=['bucket', 'overall', 'trend', 'seasonal', 'residual'])
        values = temporal_frame['overall'].to_numpy(dtype=float)
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
                'bucket': temporal_frame['bucket'],
                'overall': values,
                'trend': trend,
                'seasonal': seasonal,
                'residual': residual,
            }
        )

    def _stl_decomposition(
        self,
        temporal_frame: pd.DataFrame,
        granularity: str,
        trend_window: int,
    ) -> tuple[pd.DataFrame, str]:
        """STL decomposition (Seasonal-Trend using Loess, Cleveland 1990).
        Falls back to naive additive decomposition when statsmodels is unavailable
        or data is too short for the estimated seasonal period."""
        if temporal_frame.empty:
            return pd.DataFrame(columns=['bucket', 'overall', 'trend', 'seasonal', 'residual']), 'Empty'

        values = temporal_frame['overall'].to_numpy(dtype=float)
        period = self._seasonal_period(granularity)
        min_length = 2 * period + 1  # STL requirement

        if _STATSMODELS_AVAILABLE and values.size >= min_length:
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore')
                    stl = _STL(pd.Series(values), period=period, robust=True)
                    result = stl.fit()
                frame = pd.DataFrame({
                    'bucket': temporal_frame['bucket'],
                    'overall': values,
                    'trend': result.trend,
                    'seasonal': result.seasonal,
                    'residual': result.resid,
                })
                return frame, 'STL (Cleveland 1990, robust=True)'
            except Exception:  # noqa: BLE001
                pass  # Fall through to naive decomposition

        # Naive additive fallback
        naive = self._decomposition_frame(temporal_frame, granularity, trend_window)
        reason = 'Additive (MA)' if not _STATSMODELS_AVAILABLE else f'Additive (n={values.size} < {min_length} for STL)'
        return naive, reason

    def _autocorrelation_frame(self, temporal_frame: pd.DataFrame, max_lag: int = 30) -> pd.DataFrame:
        values = temporal_frame['overall'].to_numpy(dtype=float)
        if values.size < 3:
            return pd.DataFrame(columns=['bucket', 'overall'])
        mean = self._safe_mean(values)
        denominator = float(np.sum((values - mean) ** 2))
        if denominator <= 1e-12:
            return pd.DataFrame(columns=['bucket', 'overall'])
        lag_limit = min(max_lag, values.size - 2)
        output = []
        for lag in range(1, lag_limit + 1):
            numerator = float(np.sum((values[lag:] - mean) * (values[:-lag] - mean)))
            output.append({'bucket': f'Lag {lag}', 'overall': numerator / denominator})
        return pd.DataFrame(output)

    def _partial_autocorrelation_frame(self, temporal_frame: pd.DataFrame, max_lag: int = 30) -> pd.DataFrame:
        values = temporal_frame['overall'].to_numpy(dtype=float)
        if values.size < 4:
            return pd.DataFrame(columns=['bucket', 'overall'])
        lag_limit = min(max_lag, values.size - 2)
        if lag_limit < 1:
            return pd.DataFrame(columns=['bucket', 'overall'])
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
        return pd.DataFrame({'bucket': [f'Lag {index}' for index in range(1, lag_limit + 1)], 'overall': [phi[index][index] for index in range(1, lag_limit + 1)]})

    def _forecast_frame(
        self,
        temporal_frame: pd.DataFrame,
        granularity: str,
        horizon: int,
        decomposition_frame: pd.DataFrame,
    ) -> pd.DataFrame:
        values = temporal_frame['overall'].to_numpy(dtype=float)
        if values.size == 0:
            return pd.DataFrame(columns=['bucket', 'observed', 'forecast', 'upper', 'lower'])
        linear = self._fit_linear(values)
        period = max(2, min(self._seasonal_period(granularity), values.size))
        seasonal_template = decomposition_frame['seasonal'].to_numpy(dtype=float)[:period]
        if seasonal_template.size < period:
            seasonal_template = np.pad(seasonal_template, (0, period - seasonal_template.size), constant_values=0)

        fitted = np.array([(linear['intercept'] + (linear['slope'] * index)) + seasonal_template[index % period] for index in range(values.size)], dtype=float)
        residual_std = self._safe_std(values - fitted)
        padding = residual_std * 1.96

        history = pd.DataFrame(
            {
                'bucket': temporal_frame['bucket'],
                'observed': values,
                'forecast': fitted,
                'upper': fitted + padding,
                'lower': fitted - padding,
            }
        )

        last_bucket = str(temporal_frame['bucket'].iloc[-1])
        future_rows = []
        for step in range(1, max(1, horizon) + 1):
            absolute_index = values.size + step - 1
            forecast_value = (linear['intercept'] + (linear['slope'] * absolute_index)) + seasonal_template[absolute_index % period]
            future_rows.append(
                {
                    'bucket': self._increment_bucket(last_bucket, granularity, step),
                    'observed': np.nan,
                    'forecast': forecast_value,
                    'upper': forecast_value + padding,
                    'lower': forecast_value - padding,
                }
            )

        return pd.concat([history, pd.DataFrame(future_rows)], ignore_index=True)

    def _changepoint_result(self, temporal_frame: pd.DataFrame, rolling_window: int, sensitivity: float) -> dict[str, Any]:
        values = temporal_frame['overall'].to_numpy(dtype=float)
        if values.size < 6:
            return {'markers': [], 'threshold': 0.0}
        smooth = pd.Series(values).rolling(window=max(2, rolling_window), min_periods=1).mean().to_numpy()
        scores = np.abs(np.diff(smooth))
        threshold = self._safe_std(scores) * max(0.5, sensitivity)
        marker_indices = np.where(scores >= threshold)[0] + 1
        markers = [
            {
                'bucket': str(temporal_frame['bucket'].iloc[index]),
                'score': float(scores[index - 1]),
                'value': float(temporal_frame['overall'].iloc[index]),
            }
            for index in marker_indices
        ]
        return {'markers': markers, 'threshold': float(threshold)}

    def _trend_frame(
        self,
        temporal_frame: pd.DataFrame,
        decomposition_frame: pd.DataFrame,
        deseasonalized: bool,
    ) -> dict[str, Any]:
        empty_diag: dict[str, Any] = {
            'linearSlope': 0.0, 'linearIntercept': 0.0, 'linearR2': 0.0, 'trendDirection': 'Stable',
            'mannKendallTau': None, 'mannKendallP': None,
            'senSlope': None, 'senIntercept': None,
        }
        if temporal_frame.empty:
            return {
                'series': pd.DataFrame(columns=['bucket', 'overall', 'linear', 'quadratic']),
                'diagnostics': empty_diag,
            }
        values = temporal_frame['overall'].to_numpy(dtype=float)
        if deseasonalized and not decomposition_frame.empty:
            values = values - decomposition_frame['seasonal'].to_numpy(dtype=float)
        linear = self._fit_linear(values)
        quadratic = self._fit_quadratic(values)

        # ── Direction from OLS slope ───────────────────────────────────────────
        direction = 'Stable'
        if linear['slope'] > 0.001:
            direction = 'Rising'
        elif linear['slope'] < -0.001:
            direction = 'Falling'

        # ── Mann-Kendall non-parametric trend test (scipy) ────────────────────
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
                # Sen's slope: robust non-parametric slope estimator
                theil = _theilslopes(values, x_idx)
                sen_slope = float(theil.slope)
                sen_intercept = float(theil.intercept)
                # Refine direction from Mann-Kendall p-value
                if mk_p < 0.05:
                    direction = 'Rising' if mk_tau > 0 else 'Falling'
            except Exception:  # noqa: BLE001
                pass

        return {
            'series': pd.DataFrame(
                {
                    'bucket': temporal_frame['bucket'],
                    'overall': values,
                    'linear': linear['predicted'],
                    'quadratic': quadratic,
                }
            ),
            'diagnostics': {
                'linearSlope': float(linear['slope']),
                'linearIntercept': float(linear['intercept']),
                'linearR2': float(linear['r2']),
                'trendDirection': direction,
                'mannKendallTau': mk_tau,
                'mannKendallP': mk_p,
                'senSlope': sen_slope,
                'senIntercept': sen_intercept,
            },
        }

    def _correlation_matrix(self, frame: pd.DataFrame, granularity: str) -> dict[str, Any]:
        working = frame.copy()
        working['bucket'] = working['observed_at'].map(lambda value: self._bucket_key(value, granularity))
        pivot = working.pivot_table(index='bucket', columns='variable_code', values='value', aggfunc='mean')
        if pivot.empty:
            return {'variables': [], 'z': np.empty((0, 0))}
        corr = pivot.corr().fillna(0)
        return {'variables': corr.columns.astype(str).tolist(), 'z': corr.to_numpy(dtype=float)}

    def _measurement_day_hour_matrix(self, frame: pd.DataFrame) -> dict[str, Any]:
        working = frame.copy()
        working['day'] = working['observed_at'].dt.strftime('%Y-%m-%d')
        working['hour'] = working['observed_at'].dt.hour
        pivot = working.pivot_table(index='day', columns='hour', values='value', aggfunc='mean').sort_index()
        days = pivot.index.astype(str).tolist()
        hours = [int(hour) for hour in pivot.columns.tolist()]
        return {'days': days, 'hours': hours, 'z': np.nan_to_num(pivot.to_numpy(dtype=float), nan=np.nan)}

    def _measurement_variable_summary(self, frame: pd.DataFrame) -> list[dict[str, Any]]:
        grouped = (
            frame.groupby(['variable_code', 'variable_name'], dropna=False)['value']
            .agg(['count', 'mean', 'std', 'min', 'median', 'max'])
            .reset_index()
            .fillna(0)
        )
        grouped['label'] = grouped['variable_name'].fillna(grouped['variable_code'])
        return grouped.rename(columns={'count': 'count'}).to_dict(orient='records')

    def _measurement_summary_stats(self, frame: pd.DataFrame, temporal_frame: pd.DataFrame) -> dict[str, Any]:
        if frame.empty:
            return {'samples': 0, 'mean': 0.0, 'min': 0.0, 'max': 0.0, 'trend': 'Stable'}
        values = frame['value'].to_numpy(dtype=float)
        trend = 'Stable'
        if len(temporal_frame) >= 2:
            delta = float(temporal_frame['overall'].iloc[-1] - temporal_frame['overall'].iloc[0])
            threshold = max(0.05, abs(float(np.nanmean(values))) * 0.02)
            if delta > threshold:
                trend = 'Rising'
            elif delta < -threshold:
                trend = 'Falling'
        return {
            'samples': int(values.size),
            'mean': float(np.nanmean(values)),
            'min': float(np.nanmin(values)),
            'max': float(np.nanmax(values)),
            'trend': trend,
        }

    def _generic_stats(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
    ) -> dict[str, Any]:
        numeric_columns = self._numeric_columns(frame)
        categorical_columns = self._categorical_columns(frame)
        y_axis = self._choose_generic_y_axis(context, frame, payload)
        output: dict[str, Any] = {
            'row_count': int(frame.shape[0]),
            'column_count': int(frame.shape[1]),
            'numeric_columns': numeric_columns,
            'categorical_columns': categorical_columns,
            'datetime_columns': context.summary.datetime_columns,
        }
        if y_axis and y_axis in frame.columns:
            values = pd.to_numeric(frame[y_axis], errors='coerce').dropna()
            if not values.empty:
                output.update(
                    {
                        'samples': int(values.shape[0]),
                        'mean': float(values.mean()),
                        'min': float(values.min()),
                        'max': float(values.max()),
                    }
                )
        return output

    def _resolve_context_datetime_series(self, context: ManualDatasetEdaContext) -> pd.Series | None:
        frame = context.dataframe
        mapping = context.mapping
        if mapping.datetime_column and mapping.datetime_column in frame.columns:
            parsed = self._coerce_datetime_series(frame[mapping.datetime_column])
            if int(parsed.notna().sum()) > 0:
                return parsed
        if mapping.date_column and mapping.date_column in frame.columns:
            if mapping.time_column and mapping.time_column in frame.columns:
                combined = frame[mapping.date_column].astype(str) + ' ' + frame[mapping.time_column].astype(str)
                parsed = self._coerce_datetime_series(combined)
                if int(parsed.notna().sum()) > 0:
                    return parsed
            parsed = self._coerce_datetime_series(frame[mapping.date_column])
            if int(parsed.notna().sum()) > 0:
                return parsed
        for column in context.summary.datetime_columns:
            if column in frame.columns:
                parsed = self._coerce_datetime_series(frame[column])
                if int(parsed.notna().sum()) > 0:
                    return parsed
        return None

    def _resolve_context_value_column(self, context: ManualDatasetEdaContext) -> str | None:
        if context.mapping.value_column and context.mapping.value_column in context.dataframe.columns:
            return context.mapping.value_column
        numeric_columns = [column for column in context.summary.numeric_columns if column in context.dataframe.columns]
        return numeric_columns[0] if numeric_columns else None

    def _choose_generic_x_axis(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
    ) -> str | None:
        if payload.x_axis and payload.x_axis in frame.columns:
            return payload.x_axis
        for column in context.summary.datetime_columns:
            if column in frame.columns:
                return column
        if context.mapping.datetime_column and context.mapping.datetime_column in frame.columns:
            return context.mapping.datetime_column
        return None

    def _choose_generic_y_axis(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
    ) -> str | None:
        if payload.y_axis and payload.y_axis in frame.columns and self._is_numeric(frame[payload.y_axis]):
            return payload.y_axis
        if context.mapping.value_column and context.mapping.value_column in frame.columns and self._is_numeric(frame[context.mapping.value_column]):
            return context.mapping.value_column
        numeric_columns = self._selected_numeric_columns(context, frame, payload)
        return numeric_columns[0] if numeric_columns else None

    def _selected_numeric_columns(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
    ) -> list[str]:
        selected = [column for column in payload.variable_codes if column in frame.columns and self._is_numeric(frame[column])]
        if selected:
            return selected
        return [column for column in context.summary.numeric_columns if column in frame.columns and self._is_numeric(frame[column])]

    def _limit_categories(self, frame: pd.DataFrame, column_name: str, warnings: list[str]) -> pd.DataFrame:
        counts = frame[column_name].astype(str).value_counts(dropna=False)
        if len(counts) <= 100:
            return frame
        allowed = set(counts.head(100).index.tolist())
        warnings.append(f"Column '{column_name}' has more than 100 categories; only the top 100 are shown.")
        return frame[frame[column_name].astype(str).isin(allowed)].copy()

    def _category_orders(self, payload: EdaPlotRequest) -> dict[str, list[str]]:
        if payload.x_axis and payload.category_order:
            return {payload.x_axis: payload.category_order}
        return {}

    def _regression_line(self, x_values: np.ndarray, y_values: np.ndarray) -> dict[str, np.ndarray]:
        slope, intercept, _, _, _ = self._linear_regression_terms(x_values, y_values)
        x_grid = np.linspace(float(np.min(x_values)), float(np.max(x_values)), 100)
        y_grid = intercept + (slope * x_grid)
        if x_values.size < 3:
            return {'x': x_grid, 'y': y_grid, 'lower': y_grid, 'upper': y_grid}

        y_hat = intercept + (slope * x_values)
        residuals = y_values - y_hat
        s_err = math.sqrt(max(float(np.sum(residuals**2)) / max(1, x_values.size - 2), 0.0))
        mean_x = float(np.mean(x_values))
        s_xx = float(np.sum((x_values - mean_x) ** 2))
        if s_xx <= 1e-12:
            return {'x': x_grid, 'y': y_grid, 'lower': y_grid, 'upper': y_grid}

        conf = 1.96 * s_err * np.sqrt((1 / x_values.size) + (((x_grid - mean_x) ** 2) / s_xx))
        return {'x': x_grid, 'y': y_grid, 'lower': y_grid - conf, 'upper': y_grid + conf}

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
        bandwidth = 1.06 * std * (clean.size ** (-1 / 5)) if std > 1e-9 else max(abs(float(np.mean(clean))) * 0.01, 1e-3)
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
            return {'slope': 0.0, 'intercept': 0.0, 'r2': 0.0, 'predicted': np.array([])}
        x_values = np.arange(values.size, dtype=float)
        slope, intercept, ss_tot, ss_res, predicted = self._linear_regression_terms(x_values, values)
        r2 = 0.0 if ss_tot <= 1e-12 else max(0.0, 1 - (ss_res / ss_tot))
        return {'slope': slope, 'intercept': intercept, 'r2': r2, 'predicted': predicted}

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
            return self._fit_linear(values)['predicted']
        x_values = np.arange(values.size, dtype=float)
        coefficients = np.polyfit(x_values, values, deg=2)
        return np.polyval(coefficients, x_values)

    def _autocorrelation_at_lag(self, values: np.ndarray, lag: int) -> float:
        if values.size == 0 or lag >= values.size:
            return 0.0
        mean = self._safe_mean(values)
        denominator = float(np.sum((values - mean) ** 2))
        if abs(denominator) < 1e-12:
            return 0.0
        numerator = float(np.sum((values[lag:] - mean) * (values[:-lag] - mean)))
        return numerator / denominator

    def _bucket_key(self, value: pd.Timestamp | Any, granularity: str) -> str:
        timestamp = pd.Timestamp(value)
        if granularity == 'year':
            return f'{timestamp.year}'
        if granularity == 'month':
            return f'{timestamp.year}-{timestamp.month:02d}'
        if granularity == 'hour':
            return f'{timestamp.year}-{timestamp.month:02d}-{timestamp.day:02d} {timestamp.hour:02d}:00'
        return f'{timestamp.year}-{timestamp.month:02d}-{timestamp.day:02d}'

    def _increment_bucket(self, bucket: str, granularity: str, step: int) -> str:
        if granularity == 'year':
            return f'{int(bucket) + step}'
        if granularity == 'month':
            base = pd.Timestamp(f'{bucket}-01T00:00:00Z')
            target = base + pd.DateOffset(months=step)
            return f'{target.year}-{target.month:02d}'
        if granularity == 'hour':
            base = pd.Timestamp(bucket.replace(' ', 'T') + ':00Z')
            target = base + pd.Timedelta(hours=step)
            return f'{target.year}-{target.month:02d}-{target.day:02d} {target.hour:02d}:00'
        base = pd.Timestamp(f'{bucket}T00:00:00Z')
        target = base + pd.Timedelta(days=step)
        return f'{target.year}-{target.month:02d}-{target.day:02d}'

    def _seasonal_period(self, granularity: str) -> int:
        if granularity == 'hour':
            return 24
        if granularity == 'month':
            return 12
        if granularity == 'year':
            return 4
        return 7

    def _aggregate_values(self, series: pd.Series, aggregation_mode: str) -> float:
        numeric = pd.to_numeric(series, errors='coerce').dropna()
        if numeric.empty:
            return 0.0
        if aggregation_mode == 'median':
            return float(numeric.median())
        if aggregation_mode == 'sum':
            return float(numeric.sum())
        if aggregation_mode == 'min':
            return float(numeric.min())
        if aggregation_mode == 'max':
            return float(numeric.max())
        if aggregation_mode == 'std':
            return float(numeric.std(ddof=0))
        return float(numeric.mean())

    def _coerce_datetime_series(self, series: pd.Series | Any) -> pd.Series:
        return pd.to_datetime(series, utc=True, errors='coerce')

    def _numeric_columns(self, frame: pd.DataFrame) -> list[str]:
        return [column for column in frame.columns if self._is_numeric(frame[column])]

    def _categorical_columns(self, frame: pd.DataFrame) -> list[str]:
        return [column for column in frame.columns if self._is_categorical(frame[column])]

    def _is_numeric(self, series: pd.Series) -> bool:
        if pd.api.types.is_numeric_dtype(series):
            return True
        coerced = pd.to_numeric(series, errors='coerce')
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
