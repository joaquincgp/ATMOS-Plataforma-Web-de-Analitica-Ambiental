from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots

from app.schemas.eda import EdaPlotRequest, EdaSecondaryFigure
from app.services.eda.common import CHART_COLORS, WEEKDAY_LABELS
from app.services.manual_dataset import ManualDatasetEdaContext


class EdaGenericMixin:
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
                    context.mapping.datetime_column,
                    context.mapping.date_column,
                }
                selected = [column for column in selected if column is not None]
                ordered = [
                    column
                    for column in frame.columns
                    if column in set(selected) | {value for value in passthrough if value}
                ]
                frame = frame[ordered].copy()

        filter_series = self._resolve_context_datetime_series(context)
        if filter_series is not None:
            frame["_filter_datetime"] = filter_series
            if payload.date_from is not None:
                frame = frame[frame["_filter_datetime"] >= pd.Timestamp(payload.date_from, tz="UTC")]
            if payload.date_to is not None:
                frame = frame[
                    frame["_filter_datetime"] < pd.Timestamp(payload.date_to, tz="UTC") + pd.Timedelta(days=1)
                ]

        for column_name in [payload.x_axis, payload.hue, payload.facet_row, payload.facet_col]:
            if column_name and column_name in frame.columns and self._is_categorical(frame[column_name]):
                frame = self._limit_categories(frame, column_name, warnings)

        frame = frame.reset_index(drop=True)
        if payload.section in {
            "rolling",
            "data_trend",
            "time_profiles",
            "profiles",
            "heat_map",
            "seasonality",
            "decomposition",
            "autocorr",
            "pacf",
            "forecast",
            "changepoints",
            "trend",
            "anomaly",
        }:
            return frame
        return frame.head(payload.limit).reset_index(drop=True)

    def _generic_time_series_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> go.Figure:
        x_axis = self._choose_generic_x_axis(context, frame, payload)
        selected_numeric = self._selected_numeric_columns(context, frame, payload)
        multi_series_mode = len(selected_numeric) > 1
        y_axis = None if multi_series_mode else self._choose_generic_y_axis(context, frame, payload)
        if x_axis is None or (y_axis is None and not multi_series_mode):
            warnings.append("Time series mode requires a datetime-like x-axis column and a numeric y-axis column.")
            return self._empty_figure("Select a valid datetime/object x-axis and numeric y-axis.")

        working = frame.copy()
        working["_x_time"] = self._coerce_datetime_series(working[x_axis])
        if int(working["_x_time"].notna().sum()) == 0:
            warnings.append("Time series mode requires a datetime-like object column on the x-axis.")
            return self._empty_figure("The selected x-axis cannot be interpreted as time.")

        if multi_series_mode:
            if payload.hue or payload.facet_row or payload.facet_col:
                warnings.append(
                    "Multi-variable time series uses the selected variables as the series dimension; "
                    "hue and facets are ignored."
                )
            long_frame = working[["_x_time", *selected_numeric]].melt(
                id_vars=["_x_time"],
                value_vars=selected_numeric,
                var_name="_series",
                value_name="_y_value",
            )
            long_frame["_y_value"] = pd.to_numeric(long_frame["_y_value"], errors="coerce")
            working = long_frame.dropna(subset=["_x_time", "_y_value"])
        else:
            working["_y_value"] = pd.to_numeric(working[y_axis], errors="coerce")
            working = working.dropna(subset=["_x_time", "_y_value"])

        working = self._clip_time_frame(working, time_column="_x_time", payload=payload)
        if working.empty:
            warnings.append("No time series rows remained after coercing the selected axes.")
            return self._empty_figure("No time series rows remained after applying the current axes.")

        chart_type = payload.chart_type or "line"
        category_orders = self._category_orders(payload)
        if not payload.time_is_here:
            working["_bucket"] = working["_x_time"].map(lambda value: self._bucket_key(value, payload.granularity))
            group_columns = ["_bucket"]
            if multi_series_mode:
                group_columns.append("_series")
            if not multi_series_mode and payload.hue and payload.hue in working.columns:
                group_columns.append(payload.hue)
            if not multi_series_mode and payload.facet_row and payload.facet_row in working.columns:
                group_columns.append(payload.facet_row)
            if not multi_series_mode and payload.facet_col and payload.facet_col in working.columns:
                group_columns.append(payload.facet_col)
            aggregated = (
                working.groupby(group_columns, dropna=False)["_y_value"]
                .agg(
                    _plot_value=lambda series: self._aggregate_values(series, payload.time_aggregation),
                    _plot_std="std",
                )
                .reset_index()
            )
            plot_frame = aggregated.sort_values("_bucket")
            x_column = "_bucket"
            y_column = "_plot_value"
        else:
            plot_frame = working.sort_values("_x_time")
            x_column = "_x_time"
            y_column = "_y_value"

        if payload.rolling_window > 0 and chart_type != "scatter":
            plot_frame = plot_frame.copy()
            if multi_series_mode and "_series" in plot_frame.columns:
                plot_frame = plot_frame.sort_values(["_series", x_column])
                plot_frame[y_column] = plot_frame.groupby("_series", dropna=False)[y_column].transform(
                    lambda series: pd.to_numeric(series, errors="coerce").rolling(
                        window=max(1, payload.rolling_window),
                        min_periods=1,
                    ).mean()
                )
            else:
                plot_frame[y_column] = pd.to_numeric(plot_frame[y_column], errors="coerce").rolling(
                    window=max(1, payload.rolling_window),
                    min_periods=1,
                ).mean()

        plot_frame = self._apply_point_budget(plot_frame, payload.limit)
        color_column = "_series" if multi_series_mode else (payload.hue if payload.hue in plot_frame.columns else None)
        facet_row = (
            None
            if multi_series_mode
            else (payload.facet_row if payload.facet_row in plot_frame.columns else None)
        )
        facet_col = (
            None
            if multi_series_mode
            else (payload.facet_col if payload.facet_col in plot_frame.columns else None)
        )
        y_axis_title = "Value" if multi_series_mode else y_axis

        if multi_series_mode and payload.facet_variables and chart_type in {"line", "bar", "scatter"}:
            facet_columns = max(1, min(4, payload.facet_columns))
            facet_rows = max(1, int(math.ceil(len(selected_numeric) / facet_columns)))
            common_kwargs: dict[str, Any] = {
                "data_frame": plot_frame,
                "x": x_column,
                "y": y_column,
                "color": "_series",
                "facet_col": "_series",
                "facet_col_wrap": facet_columns,
                "color_discrete_sequence": CHART_COLORS,
                "category_orders": {"_series": selected_numeric},
                "height": max(520, 330 * facet_rows),
            }
            if chart_type == "scatter":
                fig = px.scatter(**common_kwargs)
                fig.update_traces(
                    marker={"size": payload.marker_size, "opacity": payload.marker_opacity},
                    selector={"mode": "markers"},
                )
            elif chart_type == "bar":
                fig = px.bar(**common_kwargs)
            else:
                fig = px.line(**common_kwargs, markers=payload.show_markers)
            fig.for_each_annotation(lambda annotation: annotation.update(text=annotation.text.replace("_series=", "")))
            if not payload.same_y_axis:
                fig.update_yaxes(matches=None)
            fig.update_layout(
                showlegend=False,
                xaxis_title=x_axis,
                yaxis_title=y_axis_title,
            )
            return self._finalize_figure(fig, "Raw Time Series")

        if chart_type == "scatter":
            fig = px.scatter(
                plot_frame,
                x=x_column,
                y=y_column,
                color=color_column,
                facet_row=facet_row,
                facet_col=facet_col,
                category_orders=category_orders,
                color_discrete_sequence=CHART_COLORS,
            )
            fig.update_traces(
                marker={"size": payload.marker_size, "opacity": payload.marker_opacity},
                selector={"mode": "markers"},
            )
            fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis_title)
            return self._finalize_figure(fig, "Raw Time Series")

        if chart_type == "bar":
            fig = px.bar(
                plot_frame,
                x=x_column,
                y=y_column,
                color=color_column,
                facet_row=facet_row,
                facet_col=facet_col,
                category_orders=category_orders,
                color_discrete_sequence=CHART_COLORS,
            )
            fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis_title)
            return self._finalize_figure(fig, "Raw Time Series")

        if chart_type == "heatmap":
            return self._generic_heatmap_figure(frame, payload, warnings, title="Raw Heatmap")

        fig = px.line(
            plot_frame,
            x=x_column,
            y=y_column,
            color=color_column,
            facet_row=facet_row,
            facet_col=facet_col,
            category_orders=category_orders,
            color_discrete_sequence=CHART_COLORS,
            markers=payload.show_markers,
        )
        if (
            payload.show_std_band
            and "_plot_std" in plot_frame.columns
            and color_column is None
            and facet_row is None
            and facet_col is None
        ):
            upper = plot_frame[y_column] + plot_frame["_plot_std"].fillna(0)
            lower = plot_frame[y_column] - plot_frame["_plot_std"].fillna(0)
            fig.add_trace(
                go.Scatter(
                    x=plot_frame[x_column],
                    y=upper,
                    mode="lines",
                    line={"width": 0},
                    showlegend=False,
                    hoverinfo="skip",
                )
            )
            fig.add_trace(
                go.Scatter(
                    x=plot_frame[x_column],
                    y=lower,
                    mode="lines",
                    line={"width": 0},
                    fill="tonexty",
                    fillcolor="rgba(80, 158, 227, 0.15)",
                    showlegend=False,
                    hoverinfo="skip",
                )
            )
        elif payload.show_std_band and (
            "_plot_std" not in plot_frame.columns or color_column or facet_row or facet_col
        ):
            warnings.append("Standard deviation bands are only displayed for a single non-faceted time series.")

        fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis_title)
        return self._finalize_figure(fig, "Raw Time Series")

    def _generic_summary_figures(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> tuple[go.Figure, list[EdaSecondaryFigure]]:
        chart_type = payload.chart_type or "histogram"
        if chart_type == "missing":
            primary, secondary = self._missing_data_figures(frame, payload, warnings)
            return primary, secondary

        if chart_type == "ridge":
            figure = self._generic_ridge_figure(context, frame, payload, warnings)
            return figure, []

        if chart_type == "bar":
            return self._generic_bar_figure(context, frame, payload, warnings), []

        if chart_type == "lineplot":
            return self._generic_lineplot_figure(context, frame, payload, warnings), []

        if chart_type == "density2":
            return self._generic_density2_figure(context, frame, payload, warnings), []

        if chart_type == "catplot":
            return self._generic_catplot_figure(context, frame, payload, warnings), []

        selected_numeric = self._selected_numeric_columns(context, frame, payload)
        if len(selected_numeric) > 1:
            melted = frame[selected_numeric].melt(var_name="_series", value_name="_value")
            melted["_value"] = pd.to_numeric(melted["_value"], errors="coerce")
            melted = melted.dropna(subset=["_value"])
            if melted.empty:
                warnings.append("No numeric rows remained after preparing the selected variables.")
                return self._empty_figure("No numeric rows remained after applying the current selection."), []

            figure = self._distribution_figure(
                melted,
                chart_type=chart_type,
                x_axis="_series",
                y_axis="_value",
                hue="_series",
                facet_row=None,
                facet_col=None,
                payload=payload,
                title="Statistical Summary",
            )
            return figure, []

        x_axis = payload.x_axis if payload.x_axis in frame.columns else None
        y_axis = self._choose_generic_y_axis(context, frame, payload)
        if y_axis is None:
            warnings.append("Summary plots require at least one numeric column.")
            return self._empty_figure("Select a numeric column for summary plots."), []

        figure = self._distribution_figure(
            frame,
            chart_type=chart_type,
            x_axis=x_axis,
            y_axis=y_axis,
            hue=payload.hue if payload.hue in frame.columns else None,
            facet_row=payload.facet_row if payload.facet_row in frame.columns else None,
            facet_col=payload.facet_col if payload.facet_col in frame.columns else None,
            payload=payload,
            title="Statistical Summary",
        )
        return figure, []

    def _generic_correlation_figures(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> tuple[go.Figure, list[EdaSecondaryFigure]]:
        chart_type = payload.chart_type or "heatmap"
        if chart_type == "missing":
            primary, secondary = self._missing_data_figures(frame, payload, warnings)
            return primary, secondary

        if chart_type in {"heatmap"}:
            return self._generic_heatmap_figure(frame, payload, warnings, title="Correlation Heatmap"), []

        if chart_type == "clustermap":
            return self._generic_clustermap_figure(context, frame, payload, warnings), []

        if chart_type == "density2":
            return self._generic_density2_figure(context, frame, payload, warnings), []

        if chart_type == "catplot":
            return self._generic_catplot_figure(context, frame, payload, warnings), []

        if chart_type == "pairplot":
            numeric_columns = self._selected_numeric_columns(context, frame, payload)
            if len(numeric_columns) < 2:
                warnings.append("Pairplots require at least two numeric columns.")
                return self._empty_figure("Select at least two numeric columns."), []
            if len(numeric_columns) > 6:
                warnings.append("Pairplots are limited to the first six numeric columns.")
                numeric_columns = numeric_columns[:6]
            fig = px.scatter_matrix(
                frame.dropna(subset=numeric_columns),
                dimensions=numeric_columns,
                color=payload.hue
                if payload.hue in frame.columns and self._is_categorical(frame[payload.hue])
                else None,
                color_discrete_sequence=CHART_COLORS,
            )
            return self._finalize_figure(fig, "Pairplot"), []

        if chart_type == "ridge":
            return self._generic_ridge_figure(context, frame, payload, warnings), []

        x_axis = payload.x_axis if payload.x_axis in frame.columns else None
        y_axis = payload.y_axis if payload.y_axis in frame.columns else None
        if x_axis is None or y_axis is None:
            numeric_columns = self._selected_numeric_columns(context, frame, payload)
            if len(numeric_columns) >= 2:
                x_axis = numeric_columns[0]
                y_axis = numeric_columns[1]
            else:
                warnings.append("Scatter and regression plots require two numeric columns.")
                return self._empty_figure("Select numeric X and Y columns."), []

        x_series = pd.to_numeric(frame[x_axis], errors="coerce")
        y_series = pd.to_numeric(frame[y_axis], errors="coerce")
        plot_frame = frame.copy()
        plot_frame["_x"] = x_series
        plot_frame["_y"] = y_series
        plot_frame = plot_frame.dropna(subset=["_x", "_y"])
        if plot_frame.empty:
            warnings.append("Scatter and regression plots require numeric X and Y values.")
            return self._empty_figure("No numeric pairs remained after coercion."), []

        fig = px.scatter(
            plot_frame,
            x="_x",
            y="_y",
            color=payload.hue if payload.hue in plot_frame.columns else None,
            facet_row=payload.facet_row if payload.facet_row in plot_frame.columns else None,
            facet_col=payload.facet_col if payload.facet_col in plot_frame.columns else None,
            color_discrete_sequence=CHART_COLORS,
        )
        fig.update_traces(
            marker={"size": payload.marker_size, "opacity": payload.marker_opacity},
            selector={"mode": "markers"},
        )
        fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis)

        if chart_type == "regression":
            x_values = plot_frame["_x"].to_numpy(dtype=float)
            y_values = plot_frame["_y"].to_numpy(dtype=float)
            if payload.regression_order == 1:
                regression = self._regression_line(x_values, y_values, confidence_level=payload.confidence_level)
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
                        fillcolor="rgba(31, 90, 138, 0.12)",
                        name=f"{int(payload.confidence_level * 100)}% CI",
                    )
                )
                fig.add_trace(
                    go.Scatter(
                        x=regression["x"],
                        y=regression["y"],
                        mode="lines",
                        name="Regression",
                        line={"color": "#1F5A8A", "width": 2.5},
                    )
                )
            else:
                regression = self._polynomial_line(x_values, y_values, payload.regression_order)
                fig.add_trace(
                    go.Scatter(
                        x=regression["x"],
                        y=regression["y"],
                        mode="lines",
                        name=f"Polynomial order {payload.regression_order}",
                        line={"color": "#1F5A8A", "width": 2.5},
                    )
                )
        return self._finalize_figure(fig, "Bivariate Analysis"), []

    def _generic_bar_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> go.Figure:
        del context
        if frame.empty:
            return self._empty_figure("No rows are available for bar plotting.")

        x_axis = payload.x_axis if payload.x_axis in frame.columns else None
        if x_axis is None:
            categorical_columns = self._categorical_columns(frame)
            numeric_columns = self._numeric_columns(frame)
            x_axis = (categorical_columns or numeric_columns or frame.columns.tolist())[0]

        y_axis = payload.y_axis if payload.y_axis in frame.columns and self._is_numeric(frame[payload.y_axis]) else None
        if y_axis == x_axis:
            y_axis = None

        hue = payload.hue if payload.hue in frame.columns else None
        facet_row = payload.facet_row if payload.facet_row in frame.columns else None
        facet_col = payload.facet_col if payload.facet_col in frame.columns else None
        category_orders = self._category_orders(payload)

        if y_axis is None:
            fig = px.histogram(
                frame,
                x=x_axis,
                color=hue,
                facet_row=facet_row,
                facet_col=facet_col,
                barmode=payload.histogram_mode,
                category_orders=category_orders,
                color_discrete_sequence=CHART_COLORS,
            )
            fig.update_layout(xaxis_title=x_axis, yaxis_title="Count", bargap=0.08)
            return self._finalize_figure(fig, "Bar Plot")

        selected_columns = list(
            dict.fromkeys(column for column in [x_axis, y_axis, hue, facet_row, facet_col] if column)
        )
        plot_frame = frame[selected_columns].copy()
        plot_frame["_y_value"] = pd.to_numeric(plot_frame[y_axis], errors="coerce")
        plot_frame = plot_frame.dropna(subset=["_y_value"])
        if plot_frame.empty:
            warnings.append("Bar plots require at least one numeric y-axis value.")
            return self._empty_figure("No numeric y-axis values remained.")

        group_columns = [column for column in [x_axis, hue, facet_row, facet_col] if column]
        if self._is_categorical(plot_frame[x_axis]) or len(group_columns) > 1:
            plot_frame = (
                plot_frame.groupby(group_columns, dropna=False)["_y_value"]
                .apply(lambda series: self._aggregate_values(series, payload.time_aggregation))
                .reset_index(name="_plot_value")
            )
        else:
            plot_frame = self._apply_point_budget(plot_frame.rename(columns={"_y_value": "_plot_value"}), payload.limit)

        fig = px.bar(
            plot_frame,
            x=x_axis,
            y="_plot_value",
            color=hue,
            facet_row=facet_row,
            facet_col=facet_col,
            barmode=payload.histogram_mode,
            category_orders=category_orders,
            color_discrete_sequence=CHART_COLORS,
        )
        fig.update_layout(xaxis_title=x_axis, yaxis_title=f"{payload.time_aggregation}({y_axis})", bargap=0.08)
        return self._finalize_figure(fig, "Bar Plot")

    def _generic_lineplot_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> go.Figure:
        del context
        x_axis = payload.x_axis if payload.x_axis in frame.columns else None
        y_axis = payload.y_axis if payload.y_axis in frame.columns and self._is_numeric(frame[payload.y_axis]) else None
        if x_axis is None or y_axis is None:
            warnings.append("Line plots require a selected x-axis and a numeric y-axis.")
            return self._empty_figure("Select valid X and numeric Y columns for a line plot.")

        hue = payload.hue if payload.hue in frame.columns else None
        facet_row = payload.facet_row if payload.facet_row in frame.columns else None
        facet_col = payload.facet_col if payload.facet_col in frame.columns else None
        selected_columns = list(
            dict.fromkeys(column for column in [x_axis, y_axis, hue, facet_row, facet_col] if column)
        )
        plot_frame = frame[selected_columns].copy()
        plot_frame["_y_value"] = pd.to_numeric(plot_frame[y_axis], errors="coerce")
        plot_frame = plot_frame.dropna(subset=["_y_value"])
        if plot_frame.empty:
            return self._empty_figure("No numeric y-axis values remained.")

        parsed_x = self._coerce_datetime_series(plot_frame[x_axis])
        if int(parsed_x.notna().sum()) >= max(2, int(len(plot_frame) * 0.6)):
            plot_frame["_x_plot"] = parsed_x
            x_column = "_x_plot"
        else:
            x_column = x_axis

        group_columns = [column for column in [x_column, hue, facet_row, facet_col] if column]
        grouped = (
            plot_frame.groupby(group_columns, dropna=False)["_y_value"]
            .agg(
                _plot_value=lambda series: self._aggregate_values(series, payload.time_aggregation),
                _plot_std="std",
            )
            .reset_index()
            .sort_values(x_column)
        )
        grouped = self._apply_point_budget(grouped, payload.limit)

        fig = px.line(
            grouped,
            x=x_column,
            y="_plot_value",
            color=hue,
            facet_row=facet_row,
            facet_col=facet_col,
            markers=payload.show_markers,
            category_orders=self._category_orders(payload),
            color_discrete_sequence=CHART_COLORS,
        )

        if payload.show_std_band and hue is None and facet_row is None and facet_col is None:
            upper = grouped["_plot_value"] + grouped["_plot_std"].fillna(0)
            lower = grouped["_plot_value"] - grouped["_plot_std"].fillna(0)
            fig.add_trace(go.Scatter(x=grouped[x_column], y=upper, mode="lines", line={"width": 0}, showlegend=False))
            fig.add_trace(
                go.Scatter(
                    x=grouped[x_column],
                    y=lower,
                    mode="lines",
                    line={"width": 0},
                    fill="tonexty",
                    fillcolor="rgba(80, 158, 227, 0.15)",
                    name="Std band",
                )
            )

        fig.update_layout(xaxis_title=x_axis, yaxis_title=f"{payload.time_aggregation}({y_axis})")
        return self._finalize_figure(fig, "Line Plot")

    def _generic_density2_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> go.Figure:
        numeric_columns = self._selected_numeric_columns(context, frame, payload)
        x_axis = (
            payload.x_axis if payload.x_axis in numeric_columns else (numeric_columns[0] if numeric_columns else None)
        )
        y_axis = (
            payload.y_axis
            if payload.y_axis in numeric_columns
            else (numeric_columns[1] if len(numeric_columns) > 1 else None)
        )
        if x_axis is None or y_axis is None or x_axis == y_axis:
            warnings.append("2D density plots require two numeric columns.")
            return self._empty_figure("Select two different numeric columns for 2D density.")

        plot_frame = frame.copy()
        plot_frame["_x"] = pd.to_numeric(plot_frame[x_axis], errors="coerce")
        plot_frame["_y"] = pd.to_numeric(plot_frame[y_axis], errors="coerce")
        plot_frame = self._apply_point_budget(plot_frame.dropna(subset=["_x", "_y"]), payload.limit)
        if plot_frame.empty:
            return self._empty_figure("No numeric pairs remained after coercion.")

        if payload.density_kind == "contour":
            fig = px.density_contour(
                plot_frame,
                x="_x",
                y="_y",
                color=payload.hue if payload.hue in plot_frame.columns else None,
                facet_row=payload.facet_row if payload.facet_row in plot_frame.columns else None,
                facet_col=payload.facet_col if payload.facet_col in plot_frame.columns else None,
                color_discrete_sequence=CHART_COLORS,
            )
            fig.update_traces(contours_coloring="fill", opacity=0.72)
        else:
            fig = px.density_heatmap(
                plot_frame,
                x="_x",
                y="_y",
                facet_row=payload.facet_row if payload.facet_row in plot_frame.columns else None,
                facet_col=payload.facet_col if payload.facet_col in plot_frame.columns else None,
                color_continuous_scale=payload.color_scale,
                nbinsx=payload.histogram_bins,
                nbinsy=payload.histogram_bins,
            )
        fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis)
        return self._finalize_figure(fig, "2D Density")

    def _generic_catplot_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> go.Figure:
        del context
        categorical_columns = self._categorical_columns(frame)
        numeric_columns = self._numeric_columns(frame)
        x_axis = (
            payload.x_axis
            if payload.x_axis in frame.columns
            else (categorical_columns[0] if categorical_columns else None)
        )
        y_axis = (
            payload.y_axis if payload.y_axis in frame.columns else (numeric_columns[0] if numeric_columns else None)
        )
        if x_axis is None or y_axis is None:
            warnings.append("Categorical plots require X and Y columns.")
            return self._empty_figure("Select X and Y columns for the categorical plot.")

        selected_columns = list(
            dict.fromkeys(
                column
                for column in [x_axis, y_axis, payload.hue, payload.facet_row, payload.facet_col]
                if column in frame.columns
            )
        )
        plot_frame = frame[selected_columns].copy()
        if self._is_numeric(plot_frame[y_axis]):
            plot_frame["_y_plot"] = pd.to_numeric(plot_frame[y_axis], errors="coerce")
        else:
            plot_frame["_y_plot"] = plot_frame[y_axis].astype(str)
        plot_frame = plot_frame.dropna(subset=[x_axis, "_y_plot"])
        plot_frame = self._apply_point_budget(plot_frame, payload.limit)
        if plot_frame.empty:
            return self._empty_figure("No rows remained after preparing the categorical plot.")

        fig = px.strip(
            plot_frame,
            x=x_axis,
            y="_y_plot",
            color=payload.hue if payload.hue in plot_frame.columns else None,
            facet_row=payload.facet_row if payload.facet_row in plot_frame.columns else None,
            facet_col=payload.facet_col if payload.facet_col in plot_frame.columns else None,
            category_orders=self._category_orders(payload),
            color_discrete_sequence=CHART_COLORS,
            stripmode="overlay" if payload.swarm_overlay else "group",
        )
        fig.update_traces(marker={"size": payload.marker_size, "opacity": payload.marker_opacity})
        fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis)
        return self._finalize_figure(fig, "Categorical Plot")

    def _generic_clustermap_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> go.Figure:
        numeric_columns = self._selected_numeric_columns(context, frame, payload)
        if len(numeric_columns) < 2:
            warnings.append("Cluster maps require at least two numeric columns.")
            return self._empty_figure("Select at least two numeric columns.")
        if len(numeric_columns) > 40:
            warnings.append("Cluster maps are limited to the first 40 numeric columns.")
            numeric_columns = numeric_columns[:40]

        corr = frame[numeric_columns].apply(pd.to_numeric, errors="coerce").corr().fillna(0)
        try:
            from scipy.cluster import hierarchy
            from scipy.spatial.distance import squareform

            distances = 1 - corr.abs()
            np.fill_diagonal(distances.values, 0)
            linkage = hierarchy.linkage(squareform(distances.to_numpy()), method="average")
            order = hierarchy.leaves_list(linkage)
            corr = corr.iloc[order, order]
        except Exception:
            warnings.append("Hierarchical ordering was not available; showing the raw correlation order.")

        fig = go.Figure(
            data=go.Heatmap(
                z=corr.to_numpy(),
                x=corr.columns.tolist(),
                y=corr.index.tolist(),
                zmin=-1,
                zmax=1,
                colorscale=payload.color_scale,
                reversescale=payload.color_scale in {"RdBu", "RdYlBu"},
                text=np.round(corr.to_numpy(), 2),
                texttemplate="%{text}",
                hovertemplate="%{y} vs %{x}<br>%{z:.3f}<extra></extra>",
            )
        )
        return self._finalize_figure(fig, "Clustered Correlation")

    def _generic_heatmap_figure(
        self,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
        *,
        title: str,
    ) -> go.Figure:
        numeric_columns = self._numeric_columns(frame)
        selected_numeric = [column for column in payload.variable_codes if column in numeric_columns] or numeric_columns

        if len(selected_numeric) >= 2:
            corr = frame[selected_numeric].apply(pd.to_numeric, errors="coerce").corr().fillna(0)
            fig = go.Figure(
                data=go.Heatmap(
                    z=corr.to_numpy(),
                    x=corr.columns.tolist(),
                    y=corr.index.tolist(),
                    zmin=-1,
                    zmax=1,
                    colorscale=payload.color_scale,
                    reversescale=payload.color_scale in {"RdBu", "RdYlBu"},
                    text=np.round(corr.to_numpy(), 2),
                    texttemplate="%{text}",
                    hovertemplate="%{y} vs %{x}<br>%{z:.3f}<extra></extra>",
                )
            )
            return self._finalize_figure(fig, title)

        x_axis = payload.x_axis if payload.x_axis in frame.columns else None
        y_axis = payload.y_axis if payload.y_axis in frame.columns else None
        if x_axis is None or y_axis is None:
            warnings.append(
                "Raw Heatmap mode requires either multiple numeric columns or a categorical and numeric axis pair."
            )
            return self._empty_figure("Select numeric columns or a categorical + numeric pair.")

        y_numeric = pd.to_numeric(frame[y_axis], errors="coerce")
        if self._is_categorical(frame[x_axis]) and int(y_numeric.notna().sum()) > 0:
            plot_frame = frame.copy()
            plot_frame["_y_numeric"] = y_numeric
            plot_frame = plot_frame.dropna(subset=["_y_numeric"])
            fig = px.density_heatmap(
                plot_frame,
                x=x_axis,
                y="_y_numeric",
                facet_row=payload.facet_row if payload.facet_row in plot_frame.columns else None,
                facet_col=payload.facet_col if payload.facet_col in plot_frame.columns else None,
                category_orders=self._category_orders(payload),
                color_continuous_scale=payload.color_scale,
            )
            fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis)
            return self._finalize_figure(fig, title)

        warnings.append(
            "Raw Heatmap mode requires either multiple numeric columns or a categorical and numeric axis pair."
        )
        return self._empty_figure("Selected axes do not meet heatmap requirements.")

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
            warnings.append("Ridgeplots require a categorical x-axis and a numeric y-axis.")
            return self._empty_figure("Select a categorical X column and a numeric Y column.")

        plot_frame = frame.copy()
        plot_frame["_y_value"] = pd.to_numeric(plot_frame[y_axis], errors="coerce")
        plot_frame = plot_frame.dropna(subset=["_y_value"])
        categories = plot_frame[x_axis].astype(str).value_counts().head(12).index.tolist()
        plot_frame = plot_frame[plot_frame[x_axis].astype(str).isin(categories)]

        fig = go.Figure()
        for index, category in enumerate(categories):
            sample = plot_frame[plot_frame[x_axis].astype(str) == category]["_y_value"].to_numpy(dtype=float)
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
        fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis, violinmode="overlay")
        return self._finalize_figure(fig, "Ridgeplot")

    def _generic_time_profile_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> go.Figure:
        x_axis = self._choose_generic_x_axis(context, frame, payload)
        y_axis = self._choose_generic_y_axis(context, frame, payload)
        if x_axis is None or y_axis is None:
            warnings.append("Time profiles require a datetime-like x-axis and a numeric value column.")
            return self._empty_figure("Select a datetime column and numeric variable for profiles.")

        working = frame.copy()
        working["_x_time"] = self._coerce_datetime_series(working[x_axis])
        working["_value"] = pd.to_numeric(working[y_axis], errors="coerce")
        working = working.dropna(subset=["_x_time", "_value"])
        working = self._clip_time_frame(working, time_column="_x_time", payload=payload)
        if working.empty:
            return self._empty_figure("No rows remained after applying the current filters.")

        if payload.profile_mode == "weekday":
            working["_profile_bucket"] = working["_x_time"].dt.dayofweek.map(lambda index: WEEKDAY_LABELS[index])
            order = WEEKDAY_LABELS
        elif payload.profile_mode == "month":
            working["_profile_bucket"] = working["_x_time"].dt.month.map(lambda index: f"{index:02d}")
            order = [f"{index:02d}" for index in range(1, 13)]
        elif payload.profile_mode == "quarter":
            working["_profile_bucket"] = working["_x_time"].dt.quarter.map(lambda value: f"Q{value}")
            order = ["Q1", "Q2", "Q3", "Q4"]
        elif payload.profile_mode == "year":
            working["_profile_bucket"] = working["_x_time"].dt.year.astype(str)
            order = sorted(working["_profile_bucket"].unique().tolist())
        else:
            working["_profile_bucket"] = working["_x_time"].dt.hour.map(lambda value: f"{value:02d}")
            order = [f"{index:02d}" for index in range(24)]

        grouped = (
            working.groupby("_profile_bucket", dropna=False)["_value"]
            .apply(lambda series: self._aggregate_values(series, payload.profile_aggregation))
            .reset_index(name="_plot_value")
        )
        grouped["_order"] = grouped["_profile_bucket"].map(lambda value: order.index(value) if value in order else 999)
        grouped = grouped.sort_values(["_order", "_profile_bucket"])
        fig = go.Figure(
            data=go.Bar(
                x=grouped["_profile_bucket"],
                y=grouped["_plot_value"],
                marker_color=CHART_COLORS[0],
                hovertemplate="%{x}<br>Value %{y:.3f}<extra></extra>",
            )
        )
        fig.update_layout(xaxis_title=payload.profile_mode, yaxis_title=f"{payload.profile_aggregation}({y_axis})")
        return self._finalize_figure(fig, "Time Profiles")

    def _generic_calendar_heatmap_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> go.Figure:
        x_axis = self._choose_generic_x_axis(context, frame, payload)
        y_axis = self._choose_generic_y_axis(context, frame, payload)
        if x_axis is None or y_axis is None:
            warnings.append("Heat maps require a datetime-like x-axis and a numeric value column.")
            return self._empty_figure("Select a datetime column and numeric variable for the heat map.")

        working = frame.copy()
        working["_x_time"] = self._coerce_datetime_series(working[x_axis])
        working["_value"] = pd.to_numeric(working[y_axis], errors="coerce")
        working = working.dropna(subset=["_x_time", "_value"])
        working = self._clip_time_frame(working, time_column="_x_time", payload=payload)
        if working.empty:
            return self._empty_figure("No rows remained after applying the current filters.")

        working["_year"] = working["_x_time"].dt.year.astype(str)
        if payload.profile_heatmap_mode == "hour":
            working["_x_label"] = working["_x_time"].dt.hour.map(lambda value: f"{value:02d}")
            x_labels = [f"{index:02d}" for index in range(24)]
        elif payload.profile_heatmap_mode == "weekday":
            working["_x_label"] = working["_x_time"].dt.dayofweek.map(lambda index: WEEKDAY_LABELS[index])
            x_labels = WEEKDAY_LABELS
        elif payload.profile_heatmap_mode == "week":
            working["_x_label"] = working["_x_time"].dt.isocalendar().week.astype(int).map(lambda value: f"{value:02d}")
            x_labels = [f"{index:02d}" for index in range(1, 54)]
        else:
            working["_x_label"] = working["_x_time"].dt.month.map(lambda value: f"{value:02d}")
            x_labels = [f"{index:02d}" for index in range(1, 13)]

        pivot = (
            working.groupby(["_year", "_x_label"], dropna=False)["_value"]
            .apply(lambda series: self._aggregate_values(series, payload.profile_aggregation))
            .reset_index(name="_plot_value")
            .pivot(index="_year", columns="_x_label", values="_plot_value")
        )
        x_present = [label for label in x_labels if label in pivot.columns]
        pivot = pivot.reindex(columns=x_present).sort_index()
        fig = go.Figure(
            data=go.Heatmap(
                z=np.nan_to_num(pivot.to_numpy(dtype=float), nan=np.nan),
                x=x_present,
                y=pivot.index.astype(str).tolist(),
                colorscale=payload.color_scale,
                hovertemplate="%{y} / %{x}<br>Value %{z:.3f}<extra></extra>",
            )
        )
        fig.update_layout(xaxis_title=payload.profile_heatmap_mode, yaxis_title="Year")
        return self._finalize_figure(fig, "Heat Map")

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
        working["_value"] = pd.to_numeric(working[y_axis], errors="coerce")
        working = working.dropna(subset=["_value"])
        category_orders = self._category_orders(payload)
        group_column = (
            x_axis
            if x_axis
            and x_axis in working.columns
            and x_axis != y_axis
            and self._is_categorical(working[x_axis])
            else None
        )

        if chart_type in {"histogram", "kde"} and group_column:
            grouped_items = [
                (str(group_name), group_frame)
                for group_name, group_frame in working.groupby(group_column, dropna=False)
                if not group_frame["_value"].dropna().empty
            ]
            if len(grouped_items) > 1:
                return self._grouped_distribution_subplots(
                    grouped_items,
                    chart_type=chart_type,
                    payload=payload,
                    title=title,
                    value_label=y_axis,
                )

        if chart_type == "kde":
            fig = go.Figure()
            groups = [(None, working)] if hue is None else list(working.groupby(hue, dropna=False))
            for index, (group_name, group_frame) in enumerate(groups):
                grid, density = self._kde_curve(
                    group_frame["_value"].to_numpy(dtype=float),
                    cumulative=payload.cumulative,
                    normalize_density=payload.normalize_density,
                )
                fig.add_trace(
                    go.Scatter(
                        x=grid,
                        y=density,
                        mode="lines",
                        name=str(group_name) if group_name is not None else y_axis,
                        line={"color": CHART_COLORS[index % len(CHART_COLORS)], "width": 2.5},
                    )
                )
            fig.update_layout(xaxis_title=y_axis, yaxis_title="Density")
            return self._finalize_figure(fig, title)

        if chart_type == "box":
            fig = px.box(
                working,
                x=x_axis if x_axis in working.columns else None,
                y="_value",
                color=hue if hue in working.columns else None,
                facet_row=facet_row if facet_row in working.columns else None,
                facet_col=facet_col if facet_col in working.columns else None,
                points="all" if payload.swarm_overlay else False,
                category_orders=category_orders,
                color_discrete_sequence=CHART_COLORS,
            )
            fig.update_layout(xaxis_title=x_axis or y_axis, yaxis_title=y_axis)
            return self._finalize_figure(fig, title)

        if chart_type == "violin":
            fig = px.violin(
                working,
                x=x_axis if x_axis in working.columns else None,
                y="_value",
                color=hue if hue in working.columns else None,
                facet_row=facet_row if facet_row in working.columns else None,
                facet_col=facet_col if facet_col in working.columns else None,
                box=True,
                points="all" if payload.swarm_overlay else False,
                category_orders=category_orders,
                color_discrete_sequence=CHART_COLORS,
            )
            fig.update_layout(xaxis_title=x_axis or y_axis, yaxis_title=y_axis)
            return self._finalize_figure(fig, title)

        if chart_type == "histogram":
            fig = go.Figure()
            groups = [(None, working)] if hue is None else list(working.groupby(hue, dropna=False))
            histnorm = self._histogram_norm(payload)
            draw_density = payload.histogram_stat == "density"
            for index, (group_name, group_frame) in enumerate(groups):
                values = group_frame["_value"].to_numpy(dtype=float)
                color = CHART_COLORS[index % len(CHART_COLORS)]
                label = str(group_name) if group_name is not None else y_axis
                fig.add_trace(
                    go.Histogram(
                        x=values,
                        name=label,
                        histnorm=histnorm,
                        marker={
                            "color": "rgba(80, 158, 227, 0.14)" if payload.histogram_element == "step" else color,
                            "line": {
                                "color": color if payload.histogram_element == "step" else "white",
                                "width": 2 if payload.histogram_element == "step" else 1,
                            },
                        },
                        opacity=0.58 if payload.histogram_mode == "overlay" else 0.86,
                        nbinsx=payload.histogram_bins,
                        hovertemplate="Value %{x}<br>%{y:.4f}<extra></extra>",
                    )
                )
                grid, density = self._kde_curve(values, cumulative=False, normalize_density=False)
                if draw_density and grid.size > 1:
                    fig.add_trace(
                        go.Scatter(
                            x=grid,
                            y=density,
                            mode="lines",
                            name=f"{label} density",
                            line={"color": color, "width": 2.2},
                            hovertemplate="Value %{x:.3f}<br>Density %{y:.4f}<extra></extra>",
                        )
                    )
            fig.update_layout(
                barmode=payload.histogram_mode,
                xaxis_title=y_axis,
                yaxis_title=self._histogram_y_title(payload),
                bargap=0.03,
            )
            return self._finalize_figure(fig, title)

        fig = px.histogram(
            working,
            x="_value",
            color=hue if hue in working.columns else None,
            facet_row=facet_row if facet_row in working.columns else None,
            facet_col=facet_col if facet_col in working.columns else None,
            histnorm=self._histogram_norm(payload),
            cumulative=payload.cumulative,
            nbins=payload.histogram_bins,
            category_orders=category_orders,
            color_discrete_sequence=CHART_COLORS,
        )
        fig.update_layout(xaxis_title=y_axis, yaxis_title=self._histogram_y_title(payload))
        return self._finalize_figure(fig, title)

    def _grouped_distribution_subplots(
        self,
        grouped_items: list[tuple[str, pd.DataFrame]],
        *,
        chart_type: str,
        payload: EdaPlotRequest,
        title: str,
        value_label: str,
    ) -> go.Figure:
        del value_label
        column_count = 2 if len(grouped_items) > 1 else 1
        row_count = int(math.ceil(len(grouped_items) / column_count))
        fig = make_subplots(
            rows=row_count,
            cols=column_count,
            subplot_titles=[name for name, _ in grouped_items],
            horizontal_spacing=0.08,
            vertical_spacing=0.16 if row_count > 1 else 0.1,
        )

        for index, (group_name, group_frame) in enumerate(grouped_items):
            row = (index // column_count) + 1
            col = (index % column_count) + 1
            values = group_frame["_value"].to_numpy(dtype=float)
            color = CHART_COLORS[index % len(CHART_COLORS)]

            if chart_type == "kde":
                grid, density = self._kde_curve(
                    values,
                    cumulative=payload.cumulative,
                    normalize_density=payload.normalize_density,
                )
                fig.add_trace(
                    go.Scatter(
                        x=grid,
                        y=density,
                        mode="lines",
                        name=group_name,
                        showlegend=False,
                        line={"color": color, "width": 2.4},
                        hovertemplate="Value %{x:.3f}<br>Density %{y:.4f}<extra></extra>",
                    ),
                    row=row,
                    col=col,
                )
            else:
                histnorm = self._histogram_norm(payload)
                fig.add_trace(
                    go.Histogram(
                        x=values,
                        name=group_name,
                        showlegend=False,
                        histnorm=histnorm,
                        marker={
                            "color": "rgba(80, 158, 227, 0.14)" if payload.histogram_element == "step" else color,
                            "line": {
                                "color": color if payload.histogram_element == "step" else "white",
                                "width": 2 if payload.histogram_element == "step" else 1,
                            },
                        },
                        opacity=0.62,
                        nbinsx=payload.histogram_bins,
                        hovertemplate="Value %{x}<br>%{y:.4f}<extra></extra>",
                    ),
                    row=row,
                    col=col,
                )
                grid, density = self._kde_curve(values, cumulative=False, normalize_density=False)
                if payload.histogram_stat == "density" and grid.size > 1:
                    fig.add_trace(
                        go.Scatter(
                            x=grid,
                            y=density,
                            mode="lines",
                            name=f"{group_name} density",
                            showlegend=False,
                            line={"color": color, "width": 2.1},
                            hovertemplate="Value %{x:.3f}<br>Density %{y:.4f}<extra></extra>",
                        ),
                        row=row,
                        col=col,
                    )

            fig.update_xaxes(title_text=group_name, row=row, col=col)
            fig.update_yaxes(title_text=self._histogram_y_title(payload), row=row, col=col)

        fig.update_layout(
            barmode=payload.histogram_mode,
            bargap=0.04,
            height=max(460, 340 * row_count),
        )
        for annotation in fig.layout.annotations:
            annotation.font = {"size": 12, "color": "#334155"}
        return self._finalize_figure(fig, title)

    def _missing_data_figures(
        self,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> tuple[go.Figure, list[EdaSecondaryFigure]]:
        missing_matrix = frame.isna().astype(int)
        if missing_matrix.empty:
            return self._empty_figure("No columns are available for missing-data analysis."), []

        if missing_matrix.shape[1] > 40:
            warnings.append("Missing-data heatmaps are limited to the first 40 columns.")
            missing_matrix = missing_matrix.iloc[:, :40]

        matrix_figure = go.Figure(
            data=go.Heatmap(
                z=missing_matrix.transpose().to_numpy(),
                x=list(range(1, len(missing_matrix) + 1)),
                y=missing_matrix.columns.tolist(),
                colorscale=[[0, "#EEF6FF"], [1, "#DC2626"]],
                showscale=False,
                hovertemplate="Row %{x}<br>Column %{y}<br>Missing %{z}<extra></extra>",
            )
        )
        matrix_figure = self._finalize_figure(matrix_figure, "Missingness Matrix")

        missing_rate = (missing_matrix.mean() * 100).sort_values(ascending=False).reset_index()
        missing_rate.columns = ["column", "missing_pct"]
        rate_figure = px.bar(
            missing_rate,
            x="column",
            y="missing_pct",
            color_discrete_sequence=[CHART_COLORS[0]],
        )
        rate_figure.update_layout(xaxis_title="Column", yaxis_title="Missing %")
        rate_figure = self._finalize_figure(rate_figure, "Missing Rate")

        corr_figure: go.Figure | None = None
        if missing_matrix.shape[1] >= 2:
            corr = missing_matrix.corr().fillna(0)
            corr_figure = go.Figure(
                data=go.Heatmap(
                    z=corr.to_numpy(),
                    x=corr.columns.tolist(),
                    y=corr.index.tolist(),
                    colorscale="RdBu",
                    reversescale=True,
                    zmin=-1,
                    zmax=1,
                    text=np.round(corr.to_numpy(), 2),
                    texttemplate="%{text}",
                    hovertemplate="%{y} vs %{x}<br>%{z:.3f}<extra></extra>",
                )
            )
            corr_figure = self._finalize_figure(corr_figure, "Missing Correlation")

        if payload.missing_plot_type == "bars":
            primary = rate_figure
            secondary = [
                self._secondary(
                    "missing-matrix",
                    "Missingness Matrix",
                    "Presence/missingness by row and column.",
                    matrix_figure,
                )
            ]
            if corr_figure is not None:
                secondary.append(
                    self._secondary(
                        "missing-correlation",
                        "Missing Correlation",
                        "Correlation of missingness patterns across columns.",
                        corr_figure,
                    )
                )
            return primary, secondary

        if payload.missing_plot_type == "heatmap" and corr_figure is not None:
            secondary = [
                self._secondary("missing-rate", "Missing Rate", "Percent missing by column.", rate_figure),
                self._secondary(
                    "missing-matrix",
                    "Missingness Matrix",
                    "Presence/missingness by row and column.",
                    matrix_figure,
                ),
            ]
            return corr_figure, secondary

        secondary = [
            self._secondary(
                "missing-rate",
                "Missing Rate",
                "Percent missing by column.",
                rate_figure,
            )
        ]

        if corr_figure is not None:
            secondary.append(
                self._secondary(
                    "missing-correlation",
                    "Missing Correlation",
                    "Correlation of missingness patterns across columns.",
                    corr_figure,
                )
            )

        return matrix_figure, secondary

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
            "row_count": int(frame.shape[0]),
            "column_count": int(frame.shape[1]),
            "numeric_columns": numeric_columns,
            "categorical_columns": categorical_columns,
            "datetime_columns": context.summary.datetime_columns,
            "data_frame_summary": self._generic_column_summary(context, frame),
            "variable_summary": self._generic_numeric_summary(context, frame, numeric_columns),
            "quality_summary": self._generic_quality_summary(context, frame),
        }
        if y_axis and y_axis in frame.columns:
            values = pd.to_numeric(frame[y_axis], errors="coerce").dropna()
            if not values.empty:
                output.update(
                    {
                        "samples": int(values.shape[0]),
                        "mean": float(values.mean()),
                        "min": float(values.min()),
                        "max": float(values.max()),
                    }
                )
        return output

    def _generic_column_summary(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
    ) -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        profile_by_name = {column.name: column for column in context.columns}
        total_rows = int(frame.shape[0])

        for index, column_name in enumerate(frame.columns, start=1):
            series = frame[column_name]
            profile = profile_by_name.get(column_name)
            valid = int(series.notna().sum())
            missing = int(series.isna().sum())
            unique = int(series.nunique(dropna=True))
            inferred_kind = profile.inferred_kind if profile else str(series.dtype)
            variable_label = f"{column_name} [{inferred_kind}]"
            valid_pct = valid / total_rows if total_rows else 0
            missing_pct = missing / total_rows if total_rows else 0

            numeric_values = pd.to_numeric(series, errors="coerce").dropna()
            if not numeric_values.empty and self._is_numeric(series):
                stats_values = (
                    f"Mean (sd): {numeric_values.mean():.3g} ({numeric_values.std(ddof=0):.3g})\n"
                    f"min <= med <= max:\n"
                    f"{numeric_values.min():.3g} <= {numeric_values.median():.3g} <= {numeric_values.max():.3g}\n"
                    f"IQR: {(numeric_values.quantile(0.75) - numeric_values.quantile(0.25)):.3g}"
                )
                graph_values = numeric_values.sample(min(160, len(numeric_values)), random_state=7).tolist()
            else:
                counts = series.dropna().astype(str).value_counts().head(5)
                stats_values = "\n".join(f"{pos + 1}. {label}" for pos, label in enumerate(counts.index.tolist()))
                graph_values = counts.astype(float).tolist()

            output.append(
                {
                    "no": index,
                    "variable": variable_label,
                    "stats_values": stats_values or "--",
                    "freqs": f"{unique:,} distinct values",
                    "valid": valid,
                    "valid_pct": valid_pct,
                    "missing": missing,
                    "missing_pct": missing_pct,
                    "graph_values": graph_values,
                }
            )

        return output

    def _generic_numeric_summary(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        numeric_columns: list[str],
    ) -> list[dict[str, Any]]:
        del context
        output: list[dict[str, Any]] = []
        for column_name in numeric_columns:
            values = pd.to_numeric(frame[column_name], errors="coerce").dropna()
            if values.empty:
                continue
            output.append(
                {
                    "code": column_name,
                    "label": column_name,
                    "count": int(values.shape[0]),
                    "mean": float(values.mean()),
                    "std": float(values.std(ddof=0)),
                    "min": float(values.min()),
                    "median": float(values.median()),
                    "max": float(values.max()),
                }
            )
        return output

    def _generic_quality_summary(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
    ) -> list[dict[str, Any]]:
        del context
        total_rows = int(frame.shape[0])
        output: list[dict[str, Any]] = []
        for column_name in frame.columns:
            series = frame[column_name]
            valid = int(series.notna().sum())
            missing = int(series.isna().sum())
            output.append(
                {
                    "variable_code": column_name,
                    "label": column_name,
                    "valid": valid,
                    "missing": missing,
                    "distinct": int(series.nunique(dropna=True)),
                    "valid_pct": valid / total_rows if total_rows else 0,
                    "missing_pct": missing / total_rows if total_rows else 0,
                }
            )
        return output

    def _generic_anomaly_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> go.Figure:
        x_axis = self._choose_generic_x_axis(context, frame, payload)
        if x_axis is None or x_axis not in frame.columns:
            warnings.append("Anomaly detection requires a datetime x-axis column.")
            return self._empty_figure("No datetime column found for anomaly detection.")

        numeric_cols = self._selected_numeric_columns(context, frame, payload)
        if not numeric_cols:
            return self._empty_figure("No numeric columns available for anomaly detection.")

        working = frame.copy()
        working["_x_time"] = self._coerce_datetime_series(working[x_axis])
        working = working.dropna(subset=["_x_time"])
        working = self._clip_time_frame(working, time_column="_x_time", payload=payload)
        if working.empty:
            return self._empty_figure("No rows remained after applying filters.")

        working["_bucket"] = working["_x_time"].map(lambda value: self._bucket_key(value, payload.granularity))

        n_vars = len(numeric_cols)
        if n_vars > 1:
            fig = make_subplots(
                rows=n_vars,
                cols=1,
                shared_xaxes=True,
                subplot_titles=numeric_cols,
                vertical_spacing=0.06,
            )
        else:
            fig = go.Figure()

        for i, col in enumerate(numeric_cols):
            if col not in working.columns:
                continue
            col_values = pd.to_numeric(working[col], errors="coerce")
            agg_frame = (
                pd.DataFrame({"_bucket": working["_bucket"], "_value": col_values})
                .dropna()
                .groupby("_bucket", dropna=False)["_value"]
                .mean()
                .reset_index(name="overall")
                .sort_values("_bucket")
                .reset_index(drop=True)
            )
            if agg_frame.empty:
                continue

            values = agg_frame["overall"].to_numpy(dtype=float)
            sorted_values = np.sort(values)
            q1 = float(sorted_values[int(math.floor(len(sorted_values) * 0.25))])
            q3 = float(sorted_values[int(math.floor(len(sorted_values) * 0.75))])
            iqr = q3 - q1
            iqr_multiplier = self._config_float("analytics.anomaly_iqr_multiplier")
            lower_bound = q1 - iqr * iqr_multiplier
            upper_bound = q3 + iqr * iqr_multiplier
            agg_frame["upper"] = upper_bound
            agg_frame["lower"] = lower_bound
            agg_frame["anomaly_value"] = np.where(
                (agg_frame["overall"] < lower_bound) | (agg_frame["overall"] > upper_bound),
                agg_frame["overall"],
                np.nan,
            )

            color = CHART_COLORS[i % len(CHART_COLORS)]
            row_kwargs: dict[str, Any] = {"row": i + 1, "col": 1} if n_vars > 1 else {}
            show_in_legend = i == 0

            fig.add_trace(
                go.Scatter(
                    x=agg_frame["_bucket"],
                    y=agg_frame["overall"],
                    mode="lines",
                    name=col,
                    line={"color": color, "width": 1.8},
                ),
                **row_kwargs,
            )
            fig.add_trace(
                go.Scatter(
                    x=agg_frame["_bucket"],
                    y=agg_frame["upper"],
                    mode="lines",
                    name="Upper IQR",
                    line={"color": "#94A3B8", "width": 1, "dash": "dot"},
                    showlegend=show_in_legend,
                ),
                **row_kwargs,
            )
            fig.add_trace(
                go.Scatter(
                    x=agg_frame["_bucket"],
                    y=agg_frame["lower"],
                    mode="lines",
                    name="Lower IQR",
                    line={"color": "#94A3B8", "width": 1, "dash": "dot"},
                    showlegend=show_in_legend,
                ),
                **row_kwargs,
            )
            anomalies = agg_frame.dropna(subset=["anomaly_value"])
            if not anomalies.empty:
                fig.add_trace(
                    go.Scatter(
                        x=anomalies["_bucket"],
                        y=anomalies["anomaly_value"],
                        mode="markers",
                        name="Anomaly",
                        marker={"color": "#DC2626", "size": 8},
                        showlegend=show_in_legend,
                    ),
                    **row_kwargs,
                )

        title = "Anomaly Detection (Multi-Variable)" if n_vars > 1 else "Anomaly Detection"
        total_height = max(350, 280 * n_vars) if n_vars > 1 else 420
        fig.update_layout(
            template="plotly_white",
            paper_bgcolor="white",
            plot_bgcolor="white",
            height=total_height,
            margin={"l": 48, "r": 24, "t": 60, "b": 48},
            legend={"orientation": "h", "yanchor": "bottom", "y": 1.02, "xanchor": "left", "x": 0},
            title={"text": title, "x": 0.01, "xanchor": "left"},
        )
        if n_vars > 1:
            for annotation in fig.layout.annotations:
                annotation.font = {"size": 11, "color": "#64748B"}
        return self._finalize_figure(fig, title)

    def _generic_temporal_series_frame(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> tuple[pd.DataFrame, str | None]:
        x_axis = self._choose_generic_x_axis(context, frame, payload)
        y_axis = self._choose_generic_y_axis(context, frame, payload)
        if x_axis is None or y_axis is None:
            warnings.append("This analysis requires a datetime-like x-axis and one numeric variable.")
            return pd.DataFrame(columns=["bucket", "overall"]), y_axis

        working = frame.copy()
        working["_x_time"] = self._coerce_datetime_series(working[x_axis])
        working["_value"] = pd.to_numeric(working[y_axis], errors="coerce")
        working = working.dropna(subset=["_x_time", "_value"])
        working = self._clip_time_frame(working, time_column="_x_time", payload=payload)
        if working.empty:
            return pd.DataFrame(columns=["bucket", "overall"]), y_axis

        working["bucket"] = working["_x_time"].map(lambda value: self._bucket_key(value, payload.granularity))
        temporal = (
            working.groupby("bucket", dropna=False)["_value"]
            .apply(lambda series: self._aggregate_values(series, payload.time_aggregation))
            .reset_index(name="overall")
            .sort_values("bucket")
            .reset_index(drop=True)
        )
        return temporal, y_axis

    def _generic_decomposition_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> go.Figure:
        temporal, label = self._generic_temporal_series_frame(context, frame, payload, warnings)
        if temporal.shape[0] < 4:
            return self._empty_figure("Select a longer time series to compute decomposition.")

        decomposition = self._decomposition_frame(temporal, payload.granularity, payload.decomposition_window)
        buckets = decomposition["bucket"]
        fig = make_subplots(
            rows=4,
            cols=1,
            shared_xaxes=True,
            subplot_titles=["Observed", "Trend", "Seasonal", "Residual"],
            vertical_spacing=0.065,
        )
        traces = [
            ("overall", "Observed", CHART_COLORS[0], "lines"),
            ("trend", "Trend", CHART_COLORS[1], "lines"),
            ("seasonal", "Seasonal", "#16A34A", "lines"),
            ("residual", "Residual", "#A16207", "markers"),
        ]
        for row, (column, name, color, mode) in enumerate(traces, start=1):
            fig.add_trace(
                go.Scatter(
                    x=buckets,
                    y=decomposition[column],
                    mode=mode,
                    name=name,
                    line={"color": color, "width": 1.9},
                    marker={"color": color, "size": 4},
                    showlegend=False,
                ),
                row=row,
                col=1,
            )
        fig.add_hline(y=0, line_color="#64748B", line_dash="dash", line_width=1, row=4, col=1)
        fig.update_yaxes(title_text=label or "Value", row=1, col=1)
        fig.update_yaxes(title_text="Trend", row=2, col=1)
        fig.update_yaxes(title_text="Seasonal", row=3, col=1)
        fig.update_yaxes(title_text="Residual", row=4, col=1)
        fig.update_layout(height=700, showlegend=False)
        for annotation in fig.layout.annotations:
            annotation.font = {"size": 11, "color": "#64748B"}
        return self._finalize_figure(fig, f"Time Series Decomposition - {label or 'Value'}")

    def _generic_autocorr_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
        *,
        partial: bool,
    ) -> go.Figure:
        temporal, label = self._generic_temporal_series_frame(context, frame, payload, warnings)
        series = (
            self._partial_autocorrelation_frame(temporal)
            if partial
            else self._autocorrelation_frame(temporal)
        )
        title = "Partial Autocorrelation (PACF)" if partial else "Autocorrelation Function (ACF)"
        if series.empty:
            return self._empty_figure(f"Not enough data to compute {title}.")

        n = max(len(temporal), 1)
        significance = 1.96 / math.sqrt(n)
        color = "#0B7285" if partial else "#1F5A8A"
        fig = go.Figure()
        fig.add_hrect(y0=-significance, y1=significance, fillcolor="rgba(148, 163, 184, 0.15)", line_width=0)
        fig.add_trace(
            go.Bar(
                x=series["bucket"],
                y=series["overall"],
                name=label or title,
                marker_color=[
                    color if abs(float(value)) >= significance else "rgba(148,163,184,0.55)"
                    for value in series["overall"]
                ],
                hovertemplate="%{x}<br>Correlation %{y:.3f}<extra></extra>",
            )
        )
        fig.add_hline(y=significance, line_color="#DC2626", line_dash="dash", line_width=1)
        fig.add_hline(y=-significance, line_color="#DC2626", line_dash="dash", line_width=1)
        fig.add_hline(y=0, line_color="#334155", line_width=1)
        fig.update_yaxes(range=[-1.05, 1.05], title_text="Correlation")
        fig.update_xaxes(title_text="Lag")
        fig.update_layout(bargap=0.15)
        return self._finalize_figure(fig, f"{title} - {label or 'Value'}")

    def _generic_forecast_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> go.Figure:
        temporal, label = self._generic_temporal_series_frame(context, frame, payload, warnings)
        if temporal.shape[0] < 4:
            return self._empty_figure("Select a longer time series to build a forecast.")

        decomposition = self._decomposition_frame(temporal, payload.granularity, payload.decomposition_window)
        forecast = self._forecast_frame(temporal, payload.granularity, payload.forecast_horizon, decomposition)
        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=forecast["bucket"],
                y=forecast["observed"],
                mode="lines",
                name="Observed",
                line={"color": "#1F5A8A", "width": 2},
            )
        )
        fig.add_trace(
            go.Scatter(
                x=forecast["bucket"],
                y=forecast["upper"],
                mode="lines",
                line={"width": 0},
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
                name="95% interval",
                hoverinfo="skip",
            )
        )
        fig.add_trace(
            go.Scatter(
                x=forecast["bucket"],
                y=forecast["forecast"],
                mode="lines",
                name="Forecast",
                line={"color": "#16A34A", "width": 2},
            )
        )
        fig.update_layout(xaxis_title="Time", yaxis_title=label or "Value")
        return self._finalize_figure(fig, f"Forecast - {label or 'Value'}")

    def _generic_changepoints_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> tuple[go.Figure, dict[str, Any]]:
        temporal, label = self._generic_temporal_series_frame(context, frame, payload, warnings)
        if temporal.shape[0] < 6:
            return self._empty_figure("Select a longer time series to detect changepoints."), {}

        result = self._changepoint_result(temporal, payload.changepoint_window, payload.changepoint_sensitivity)
        markers = pd.DataFrame(result["markers"])
        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=temporal["bucket"],
                y=temporal["overall"],
                mode="lines",
                name=label or "Observed",
                line={"color": "#1F5A8A", "width": 2},
            )
        )
        if not markers.empty:
            fig.add_trace(
                go.Scatter(
                    x=markers["bucket"],
                    y=markers["value"],
                    mode="markers",
                    name="Changepoint",
                    marker={"color": "#DC2626", "size": 9, "symbol": "diamond"},
                )
            )
        fig.update_layout(xaxis_title="Time", yaxis_title=label or "Value")
        return self._finalize_figure(fig, f"Changepoint Analysis - {label or 'Value'}"), {
            "changepoints": result["markers"],
            "changepointThreshold": result["threshold"],
        }

    def _generic_trend_figure(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
        warnings: list[str],
    ) -> tuple[go.Figure, dict[str, Any]]:
        temporal, label = self._generic_temporal_series_frame(context, frame, payload, warnings)
        if temporal.shape[0] < 3:
            return self._empty_figure("Select a longer time series to compute trend."), {}

        decomposition = self._decomposition_frame(temporal, payload.granularity, payload.decomposition_window)
        trend = self._trend_frame(temporal, decomposition, payload.trend_deseasonalized)
        series = trend["series"]
        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=series["bucket"],
                y=series["overall"],
                mode="lines",
                name="Observed",
                line={"color": "#1F5A8A", "width": 1.8},
            )
        )
        fig.add_trace(
            go.Scatter(
                x=series["bucket"],
                y=series["linear"],
                mode="lines",
                name="Linear trend",
                line={"color": "#16A34A", "width": 2, "dash": "dash"},
            )
        )
        fig.add_trace(
            go.Scatter(
                x=series["bucket"],
                y=series["quadratic"],
                mode="lines",
                name="Quadratic trend",
                line={"color": "#E9730C", "width": 2, "dash": "dot"},
            )
        )
        fig.update_layout(xaxis_title="Time", yaxis_title=label or "Value")
        return self._finalize_figure(fig, f"Trend Analysis - {label or 'Value'}"), trend["diagnostics"]

    def _resolve_context_datetime_series(self, context: ManualDatasetEdaContext) -> pd.Series | None:
        frame = context.dataframe
        mapping = context.mapping
        if mapping.datetime_column and mapping.datetime_column in frame.columns:
            parsed = self._coerce_datetime_series(frame[mapping.datetime_column])
            if int(parsed.notna().sum()) > 0:
                return parsed
        if mapping.date_column and mapping.date_column in frame.columns:
            if mapping.time_column and mapping.time_column in frame.columns:
                combined = frame[mapping.date_column].astype(str) + " " + frame[mapping.time_column].astype(str)
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
        if (
            context.mapping.value_column
            and context.mapping.value_column in frame.columns
            and self._is_numeric(frame[context.mapping.value_column])
        ):
            return context.mapping.value_column
        numeric_columns = self._selected_numeric_columns(context, frame, payload)
        return numeric_columns[0] if numeric_columns else None

    def _selected_numeric_columns(
        self,
        context: ManualDatasetEdaContext,
        frame: pd.DataFrame,
        payload: EdaPlotRequest,
    ) -> list[str]:
        selected = [
            column for column in payload.variable_codes if column in frame.columns and self._is_numeric(frame[column])
        ]
        if selected:
            return selected
        return [
            column
            for column in context.summary.numeric_columns
            if column in frame.columns and self._is_numeric(frame[column])
        ]

    def _limit_categories(self, frame: pd.DataFrame, column_name: str, warnings: list[str]) -> pd.DataFrame:
        counts = frame[column_name].astype(str).value_counts(dropna=False)
        if len(counts) <= 100:
            return frame
        allowed = set(counts.head(100).index.tolist())
        warnings.append(f"Column '{column_name}' has more than 100 categories; only the top 100 are shown.")
        return frame[frame[column_name].astype(str).isin(allowed)].copy()

    def _histogram_norm(self, payload: EdaPlotRequest) -> str | None:
        if payload.normalize_density:
            return "probability density"
        if payload.histogram_stat == "probability":
            return "probability"
        if payload.histogram_stat == "percent":
            return "percent"
        if payload.histogram_stat == "density":
            return "probability density"
        return None

    def _histogram_y_title(self, payload: EdaPlotRequest) -> str:
        if payload.normalize_density or payload.histogram_stat == "density":
            return "Density"
        if payload.histogram_stat == "probability":
            return "Probability"
        if payload.histogram_stat == "percent":
            return "Percent"
        return "Count"

    def _category_orders(self, payload: EdaPlotRequest) -> dict[str, list[str]]:
        if payload.x_axis and payload.category_order:
            return {payload.x_axis: payload.category_order}
        return {}
