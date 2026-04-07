from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

from app.schemas.eda import EdaPlotRequest, EdaSecondaryFigure
from app.services.eda.common import CHART_COLORS
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
        if payload.section == "rolling":
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
        y_axis = self._choose_generic_y_axis(context, frame, payload)
        if x_axis is None or y_axis is None:
            warnings.append("Time series mode requires a datetime-like x-axis column and a numeric y-axis column.")
            return self._empty_figure("Select a valid datetime/object x-axis and numeric y-axis.")

        working = frame.copy()
        working["_x_time"] = self._coerce_datetime_series(working[x_axis])
        if int(working["_x_time"].notna().sum()) == 0:
            warnings.append("Time series mode requires a datetime-like object column on the x-axis.")
            return self._empty_figure("The selected x-axis cannot be interpreted as time.")

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
            if payload.hue and payload.hue in working.columns:
                group_columns.append(payload.hue)
            if payload.facet_row and payload.facet_row in working.columns:
                group_columns.append(payload.facet_row)
            if payload.facet_col and payload.facet_col in working.columns:
                group_columns.append(payload.facet_col)
            aggregated = (
                working.groupby(group_columns, dropna=False)["_y_value"]
                .agg(["mean", "std"])
                .reset_index()
                .rename(columns={"mean": "_plot_value", "std": "_plot_std"})
            )
            plot_frame = aggregated.sort_values("_bucket")
            x_column = "_bucket"
            y_column = "_plot_value"
        else:
            plot_frame = working.sort_values("_x_time")
            x_column = "_x_time"
            y_column = "_y_value"

        plot_frame = self._apply_point_budget(plot_frame, payload.limit)

        if chart_type == "scatter":
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
            return self._finalize_figure(fig, "Raw Time Series")

        if chart_type == "bar":
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
            return self._finalize_figure(fig, "Raw Time Series")

        if chart_type == "heatmap":
            return self._generic_heatmap_figure(frame, payload, warnings, title="Raw Heatmap")

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
        if (
            payload.show_std_band
            and "_plot_std" in plot_frame.columns
            and payload.hue is None
            and payload.facet_row is None
            and payload.facet_col is None
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
            "_plot_std" not in plot_frame.columns or payload.hue or payload.facet_row or payload.facet_col
        ):
            warnings.append("Standard deviation bands are only displayed for a single non-faceted time series.")

        fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis)
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
            primary, secondary = self._missing_data_figures(frame, warnings)
            return primary, secondary

        if chart_type == "ridge":
            figure = self._generic_ridge_figure(context, frame, payload, warnings)
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
            primary, secondary = self._missing_data_figures(frame, warnings)
            return primary, secondary

        if chart_type in {"heatmap"}:
            return self._generic_heatmap_figure(frame, payload, warnings, title="Correlation Heatmap"), []

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
        fig.update_layout(xaxis_title=x_axis, yaxis_title=y_axis)

        if chart_type == "regression":
            regression = self._regression_line(
                plot_frame["_x"].to_numpy(dtype=float),
                plot_frame["_y"].to_numpy(dtype=float),
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
                    fillcolor="rgba(31, 90, 138, 0.12)",
                    name="95% CI",
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
        return self._finalize_figure(fig, "Bivariate Analysis"), []

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
                    colorscale="RdBu",
                    reversescale=True,
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
                color_continuous_scale="Blues",
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

        fig = px.histogram(
            working,
            x="_value",
            color=hue if hue in working.columns else None,
            facet_row=facet_row if facet_row in working.columns else None,
            facet_col=facet_col if facet_col in working.columns else None,
            histnorm="probability density" if payload.normalize_density else None,
            cumulative={"enabled": payload.cumulative},
            category_orders=category_orders,
            color_discrete_sequence=CHART_COLORS,
        )
        fig.update_layout(xaxis_title=y_axis, yaxis_title="Density" if payload.normalize_density else "Count")
        return self._finalize_figure(fig, title)

    def _missing_data_figures(
        self,
        frame: pd.DataFrame,
        warnings: list[str],
    ) -> tuple[go.Figure, list[EdaSecondaryFigure]]:
        missing_matrix = frame.isna().astype(int)
        if missing_matrix.empty:
            return self._empty_figure("No columns are available for missing-data analysis."), []

        if missing_matrix.shape[1] > 40:
            warnings.append("Missing-data heatmaps are limited to the first 40 columns.")
            missing_matrix = missing_matrix.iloc[:, :40]

        primary = go.Figure(
            data=go.Heatmap(
                z=missing_matrix.transpose().to_numpy(),
                x=list(range(1, len(missing_matrix) + 1)),
                y=missing_matrix.columns.tolist(),
                colorscale=[[0, "#EEF6FF"], [1, "#DC2626"]],
                showscale=False,
                hovertemplate="Row %{x}<br>Column %{y}<br>Missing %{z}<extra></extra>",
            )
        )
        primary = self._finalize_figure(primary, "Missingness Matrix")

        missing_rate = (missing_matrix.mean() * 100).sort_values(ascending=False).reset_index()
        missing_rate.columns = ["column", "missing_pct"]
        rate_figure = px.bar(
            missing_rate,
            x="column",
            y="missing_pct",
            color_discrete_sequence=[CHART_COLORS[0]],
        )
        rate_figure.update_layout(xaxis_title="Column", yaxis_title="Missing %")
        secondary = [
            self._secondary(
                "missing-rate",
                "Missing Rate",
                "Percent missing by column.",
                self._finalize_figure(rate_figure, "Missing Rate"),
            )
        ]

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
            secondary.append(
                self._secondary(
                    "missing-correlation",
                    "Missing Correlation",
                    "Correlation of missingness patterns across columns.",
                    self._finalize_figure(corr_figure, "Missing Correlation"),
                )
            )

        return primary, secondary

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

    def _category_orders(self, payload: EdaPlotRequest) -> dict[str, list[str]]:
        if payload.x_axis and payload.category_order:
            return {payload.x_axis: payload.category_order}
        return {}
