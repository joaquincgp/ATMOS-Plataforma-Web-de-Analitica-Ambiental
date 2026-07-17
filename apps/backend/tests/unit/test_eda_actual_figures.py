# Integration-style unit tests over real EDA figure builders with synthetic data.
# pylint: disable=protected-access,unexpected-keyword-arg,no-value-for-parameter
# pylint: disable=use-implicit-booleaness-not-comparison

from types import SimpleNamespace

import numpy as np
import pandas as pd
import plotly.graph_objects as go

from app.schemas.eda import EdaPlotRequest
from app.schemas.etl import ManualDatasetColumnProfile, ManualDatasetRoleMapping, ManualDatasetSummary
from app.services.eda.service import EdaService
from app.services.manual_dataset.service import ManualDatasetEdaContext


def _service() -> EdaService:
    service = EdaService.__new__(EdaService)
    service.db = None
    service.user = SimpleNamespace(id="user-1")
    return service


def _generic_context() -> ManualDatasetEdaContext:
    dates = pd.date_range("2025-01-01", periods=48, freq="D", tz="UTC")
    frame = pd.DataFrame(
        {
            "observed_at": dates,
            "value": np.linspace(10.0, 24.0, num=len(dates)),
            "pm10": np.linspace(20.0, 44.0, num=len(dates)),
            "station": ["A", "B", "C", "D"] * 12,
            "category": ["urban", "rural", "industrial"] * 16,
        }
    )
    frame.loc[8, "value"] = 90.0
    summary = ManualDatasetSummary(
        row_count=len(frame),
        column_count=len(frame.columns),
        numeric_columns=["value", "pm10"],
        categorical_columns=["station", "category"],
        datetime_columns=["observed_at"],
    )
    columns = [
        ManualDatasetColumnProfile(
            name=column,
            pandas_dtype=str(frame[column].dtype),
            inferred_kind="numeric" if column in {"value", "pm10"} else "categorical",
            null_count=0,
            non_null_count=len(frame),
            unique_count=int(frame[column].nunique(dropna=True)),
            sample_values=[str(value) for value in frame[column].head(3).tolist()],
        )
        for column in frame.columns
    ]
    return ManualDatasetEdaContext(
        dataset=SimpleNamespace(name="Generic Dataset", source_file_id=10, dataset_kind="generic"),
        dataframe=frame,
        mapping=ManualDatasetRoleMapping(
            datetime_column="observed_at",
            value_column="value",
            station_code_column="station",
            variable_code_column="category",
        ),
        summary=summary,
        columns=columns,
    )


def test_generic_real_builders_cover_supported_sections() -> None:
    service = _service()
    context = _generic_context()
    prepared = service._prepare_generic_frame(
        context,
        EdaPlotRequest(section="summary", limit=100, x_axis="observed_at", y_axis="value", hue="station"),
        [],
    )

    for section in (
        "rolling",
        "distribution",
        "scatter",
        "data_trend",
        "time_profiles",
        "profiles",
        "heat_map",
        "seasonality",
        "summary",
        "correlation",
        "anomaly",
        "decomposition",
        "autocorr",
        "pacf",
        "forecast",
        "changepoints",
        "trend",
    ):
        payload = EdaPlotRequest(
            section=section,
            chart_type="line",
            x_axis="observed_at",
            y_axis="value",
            hue="station",
            variable_codes=["value", "pm10"] if section in {"rolling", "data_trend", "anomaly"} else [],
            granularity="day",
            decomposition_window=7,
            forecast_horizon=5,
            changepoint_window=3,
            histogram_bins=12,
            limit=1000,
        )
        warnings: list[str] = []

        figure, secondary, stats = service._build_generic_plot(context, prepared, payload, warnings)

        assert isinstance(figure, go.Figure)
        assert isinstance(secondary, list)
        assert stats["row_count"] == len(prepared)


def test_generic_specific_chart_variants_cover_distribution_and_correlation_paths() -> None:
    service = _service()
    context = _generic_context()
    frame = context.dataframe

    requests = [
        EdaPlotRequest(section="distribution", chart_type="box", x_axis="station", y_axis="value"),
        EdaPlotRequest(section="distribution", chart_type="violin", x_axis="station", y_axis="value"),
        EdaPlotRequest(section="distribution", chart_type="kde", y_axis="value", cumulative=True),
        EdaPlotRequest(section="distribution", chart_type="missing"),
        EdaPlotRequest(section="scatter", chart_type="scatter", x_axis="value", y_axis="pm10", hue="station"),
        EdaPlotRequest(section="correlation", chart_type="pairplot", variable_codes=["value", "pm10"]),
        EdaPlotRequest(section="correlation", chart_type="density2", x_axis="value", y_axis="pm10"),
        EdaPlotRequest(section="correlation", chart_type="clustermap", variable_codes=["value", "pm10"]),
    ]

    for payload in requests:
        warnings: list[str] = []
        figure, secondary, stats = service._build_generic_plot(context, frame, payload, warnings)

        assert isinstance(figure, go.Figure)
        assert isinstance(secondary, list)
        assert stats["row_count"] == len(frame)


def test_generic_additional_chart_variants_cover_summary_time_and_missing_paths() -> None:
    service = _service()
    context = _generic_context()
    frame = context.dataframe.copy()
    for index in range(7):
        frame[f"metric_{index}"] = np.linspace(index, index + 10, num=len(frame))
    frame.loc[0, "metric_0"] = np.nan
    context.dataframe = frame
    context.summary.numeric_columns = ["value", "pm10", *[f"metric_{index}" for index in range(7)]]
    context.summary.categorical_columns = ["station", "category"]
    context.columns = []

    requests = [
        EdaPlotRequest(section="summary", chart_type="missing", missing_plot_type="bars"),
        EdaPlotRequest(section="summary", chart_type="missing", missing_plot_type="heatmap"),
        EdaPlotRequest(section="summary", chart_type="ridge", x_axis="station", y_axis="value"),
        EdaPlotRequest(section="summary", chart_type="bar", x_axis="station", y_axis="value", hue="category"),
        EdaPlotRequest(section="summary", chart_type="bar", x_axis="category"),
        EdaPlotRequest(
            section="summary",
            chart_type="lineplot",
            x_axis="observed_at",
            y_axis="value",
            show_std_band=True,
        ),
        EdaPlotRequest(section="summary", chart_type="density2", x_axis="value", y_axis="pm10", density_kind="contour"),
        EdaPlotRequest(section="summary", chart_type="catplot", x_axis="station", y_axis="value", swarm_overlay=True),
        EdaPlotRequest(
            section="summary",
            chart_type="histogram",
            x_axis="station",
            y_axis="value",
            histogram_element="step",
            histogram_stat="density",
        ),
        EdaPlotRequest(
            section="correlation",
            chart_type="regression",
            x_axis="value",
            y_axis="pm10",
            regression_order=1,
        ),
        EdaPlotRequest(
            section="correlation",
            chart_type="regression",
            x_axis="value",
            y_axis="pm10",
            regression_order=2,
        ),
        EdaPlotRequest(
            section="correlation",
            chart_type="pairplot",
            hue="station",
            variable_codes=[f"metric_{index}" for index in range(7)],
        ),
        EdaPlotRequest(section="correlation", chart_type="missing", missing_plot_type="matrix"),
        EdaPlotRequest(section="rolling", chart_type="line", x_axis="observed_at", y_axis="value", show_std_band=True),
        EdaPlotRequest(
            section="rolling",
            chart_type="line",
            x_axis="observed_at",
            y_axis="value",
            hue="station",
            show_std_band=True,
        ),
        EdaPlotRequest(
            section="rolling",
            chart_type="line",
            x_axis="observed_at",
            variable_codes=["value", "pm10"],
            facet_variables=True,
        ),
        EdaPlotRequest(section="rolling", chart_type="scatter", x_axis="observed_at", y_axis="value"),
        EdaPlotRequest(section="rolling", chart_type="bar", x_axis="observed_at", y_axis="value"),
        EdaPlotRequest(section="rolling", chart_type="heatmap", x_axis="station", y_axis="value"),
    ]

    for payload in requests:
        warnings: list[str] = []
        figure, secondary, stats = service._build_generic_plot(context, frame, payload, warnings)

        assert isinstance(figure, go.Figure)
        assert isinstance(secondary, list)
        assert stats["row_count"] == len(frame)


def test_generic_profile_modes_and_temporal_helpers_cover_remaining_paths() -> None:
    service = _service()
    context = _generic_context()
    frame = context.dataframe

    requests = [
        *[
            EdaPlotRequest(section="time_profiles", x_axis="observed_at", y_axis="value", profile_mode=mode)
            for mode in ("hour", "weekday", "month", "quarter", "year")
        ],
        *[
            EdaPlotRequest(section="heat_map", x_axis="observed_at", y_axis="value", profile_heatmap_mode=mode)
            for mode in ("month", "hour", "weekday", "week")
        ],
        EdaPlotRequest(section="anomaly", x_axis="observed_at", variable_codes=["value", "pm10"]),
        EdaPlotRequest(section="decomposition", x_axis="observed_at", y_axis="value", decomposition_window=4),
        EdaPlotRequest(section="autocorr", x_axis="observed_at", y_axis="value"),
        EdaPlotRequest(section="pacf", x_axis="observed_at", y_axis="value"),
        EdaPlotRequest(section="forecast", x_axis="observed_at", y_axis="value", forecast_horizon=3),
        EdaPlotRequest(section="changepoints", x_axis="observed_at", y_axis="value", changepoint_window=2),
        EdaPlotRequest(section="trend", x_axis="observed_at", y_axis="value", trend_deseasonalized=True),
    ]

    for payload in requests:
        warnings: list[str] = []
        figure, secondary, stats = service._build_generic_plot(context, frame, payload, warnings)

        assert isinstance(figure, go.Figure)
        assert isinstance(secondary, list)
        assert stats["row_count"] == len(frame)


def test_generic_direct_figure_helpers_cover_heatmap_histogram_and_datetime_fallbacks() -> None:
    service = _service()
    context = _generic_context()
    frame = context.dataframe.copy()
    warnings: list[str] = []

    duplicated = pd.concat([frame, frame.assign(value=frame["value"] + 1.5)], ignore_index=True)
    time_payload = EdaPlotRequest(
        section="rolling",
        chart_type="line",
        x_axis="observed_at",
        y_axis="value",
        variable_codes=["value"],
        show_std_band=True,
        granularity="day",
    )
    line_with_band = service._generic_time_series_figure(context, duplicated, time_payload, warnings)
    scatter = service._generic_time_series_figure(
        context,
        frame,
        EdaPlotRequest(
            section="rolling",
            chart_type="scatter",
            x_axis="observed_at",
            y_axis="value",
            variable_codes=["value"],
        ),
        warnings,
    )
    bar_figure = service._generic_time_series_figure(
        context,
        frame,
        EdaPlotRequest(
            section="rolling",
            chart_type="bar",
            x_axis="observed_at",
            y_axis="value",
            variable_codes=["value"],
        ),
        warnings,
    )
    heatmap_from_time = service._generic_time_series_figure(
        context,
        frame,
        EdaPlotRequest(
            section="rolling",
            chart_type="heatmap",
            x_axis="station",
            y_axis="value",
            variable_codes=["value"],
        ),
        warnings,
    )
    std_warning_line = service._generic_time_series_figure(
        context,
        frame,
        EdaPlotRequest(
            section="rolling",
            chart_type="line",
            x_axis="observed_at",
            y_axis="value",
            hue="station",
            variable_codes=["value"],
            show_std_band=True,
        ),
        warnings,
    )
    heatmap_corr = service._generic_heatmap_figure(
        frame,
        EdaPlotRequest(section="heat_map", variable_codes=["value", "pm10"], color_scale="RdBu"),
        warnings,
        title="Correlation heatmap",
    )
    heatmap_density = service._generic_heatmap_figure(
        frame[["station", "value"]].copy(),
        EdaPlotRequest(section="heat_map", x_axis="station", y_axis="value"),
        warnings,
        title="Density heatmap",
    )
    histogram = service._distribution_figure(
        frame,
        chart_type="histogram",
        x_axis=None,
        y_axis="value",
        hue="station",
        facet_row=None,
        facet_col=None,
        payload=EdaPlotRequest(
            section="distribution",
            histogram_element="step",
            histogram_stat="density",
            histogram_mode="overlay",
        ),
        title="Histogram",
    )
    kde = service._distribution_figure(
        frame,
        chart_type="kde",
        x_axis=None,
        y_axis="value",
        hue="station",
        facet_row=None,
        facet_col=None,
        payload=EdaPlotRequest(section="distribution", cumulative=True, normalize_density=True),
        title="KDE",
    )

    split_frame = frame.assign(_value=frame["value"])
    grouped_histogram = service._grouped_distribution_subplots(
        list(split_frame.groupby("station")),
        chart_type="histogram",
        payload=EdaPlotRequest(section="distribution", histogram_element="step", histogram_stat="density"),
        title="Grouped histogram",
        value_label="value",
    )
    grouped_kde = service._grouped_distribution_subplots(
        list(split_frame.groupby("station")),
        chart_type="kde",
        payload=EdaPlotRequest(section="distribution", cumulative=True, normalize_density=True),
        title="Grouped kde",
        value_label="value",
    )

    date_time_frame = pd.DataFrame(
        {
            "date": ["2025-01-01", "2025-01-02"],
            "time": ["01:00:00", "02:30:00"],
            "value": [1.0, 2.0],
        }
    )
    date_time_context = ManualDatasetEdaContext(
        dataset=SimpleNamespace(name="Date Time", source_file_id=20, dataset_kind="generic"),
        dataframe=date_time_frame,
        mapping=ManualDatasetRoleMapping(date_column="date", time_column="time", value_column="value"),
        summary=ManualDatasetSummary(
            row_count=2,
            column_count=3,
            numeric_columns=["value"],
            categorical_columns=[],
            datetime_columns=[],
        ),
        columns=[],
    )
    date_only_context = ManualDatasetEdaContext(
        dataset=SimpleNamespace(name="Date Only", source_file_id=21, dataset_kind="generic"),
        dataframe=date_time_frame.drop(columns=["time"]),
        mapping=ManualDatasetRoleMapping(date_column="date", value_column="value"),
        summary=ManualDatasetSummary(
            row_count=2,
            column_count=2,
            numeric_columns=["value"],
            categorical_columns=[],
            datetime_columns=[],
        ),
        columns=[],
    )

    assert all(
        isinstance(figure, go.Figure)
        for figure in (
            line_with_band,
            scatter,
            bar_figure,
            heatmap_from_time,
            std_warning_line,
            heatmap_corr,
            heatmap_density,
            histogram,
            kde,
            grouped_histogram,
            grouped_kde,
        )
    )
    assert service._resolve_context_datetime_series(date_time_context).notna().all()
    assert service._resolve_context_datetime_series(date_only_context).notna().all()
    assert (
        service._histogram_norm(EdaPlotRequest(section="distribution", histogram_stat="probability"))
        == "probability"
    )
    assert service._histogram_norm(EdaPlotRequest(section="distribution", histogram_stat="percent")) == "percent"
    assert service._histogram_y_title(EdaPlotRequest(section="distribution", histogram_stat="percent")) == "Percent"


def test_generic_edge_cases_cover_empty_invalid_and_warning_paths() -> None:
    service = _service()
    context = _generic_context()
    frame = context.dataframe.copy()
    warnings: list[str] = []

    empty_figure, secondary, empty_stats = service._build_generic_plot(
        context,
        frame.head(0),
        EdaPlotRequest(section="summary"),
        warnings,
    )
    unsupported = EdaPlotRequest.model_construct(section="unsupported", limit=10, variable_codes=[])
    unsupported_figure, _secondary, _stats = service._build_generic_plot(context, frame, unsupported, warnings)
    huge_categories = pd.DataFrame(
        {
            "observed_at": pd.date_range("2025-01-01", periods=130, freq="D", tz="UTC"),
            "value": range(130),
            "category": [f"cat-{index}" for index in range(130)],
        }
    )
    limited = service._prepare_generic_frame(
        ManualDatasetEdaContext(
            dataset=SimpleNamespace(name="Huge", source_file_id=1, dataset_kind="generic"),
            dataframe=huge_categories,
            mapping=ManualDatasetRoleMapping(datetime_column="observed_at", value_column="value"),
            summary=ManualDatasetSummary(
                row_count=130,
                column_count=3,
                numeric_columns=["value"],
                categorical_columns=["category"],
                datetime_columns=["observed_at"],
            ),
            columns=[],
        ),
        EdaPlotRequest(section="summary", x_axis="category", y_axis="value", limit=130),
        warnings,
    )
    no_numeric = pd.DataFrame({"label": ["a", "b"], "category": ["x", "y"]})
    no_numeric_context = ManualDatasetEdaContext(
        dataset=SimpleNamespace(name="No numeric", source_file_id=1, dataset_kind="generic"),
        dataframe=no_numeric,
        mapping=ManualDatasetRoleMapping(),
        summary=ManualDatasetSummary(
            row_count=2,
            column_count=2,
            numeric_columns=[],
            categorical_columns=["label", "category"],
            datetime_columns=[],
        ),
        columns=[],
    )

    figures = [
        empty_figure,
        unsupported_figure,
        service._generic_bar_figure(context, frame.head(0), EdaPlotRequest(section="summary"), warnings),
        service._generic_lineplot_figure(context, no_numeric, EdaPlotRequest(section="summary"), warnings),
        service._generic_density2_figure(context, no_numeric, EdaPlotRequest(section="summary"), warnings),
        service._generic_catplot_figure(no_numeric_context, no_numeric, EdaPlotRequest(section="summary"), warnings),
        service._generic_clustermap_figure(no_numeric_context, no_numeric, EdaPlotRequest(section="summary"), warnings),
        service._generic_ridge_figure(context, frame, EdaPlotRequest(section="summary", x_axis="value"), warnings),
        service._generic_time_profile_figure(
            no_numeric_context,
            no_numeric,
            EdaPlotRequest(section="time_profiles"),
            warnings,
        ),
        service._generic_calendar_heatmap_figure(
            no_numeric_context,
            no_numeric,
            EdaPlotRequest(section="heat_map"),
            warnings,
        ),
        service._generic_anomaly_figure(
            no_numeric_context,
            no_numeric,
            EdaPlotRequest(section="anomaly"),
            warnings,
        ),
        service._generic_decomposition_figure(
            no_numeric_context,
            no_numeric,
            EdaPlotRequest(section="decomposition"),
            warnings,
        ),
        service._generic_autocorr_figure(
            no_numeric_context,
            no_numeric,
            EdaPlotRequest(section="autocorr"),
            warnings,
            partial=False,
        ),
        service._generic_forecast_figure(no_numeric_context, no_numeric, EdaPlotRequest(section="forecast"), warnings),
        service._generic_changepoints_figure(
            no_numeric_context,
            no_numeric,
            EdaPlotRequest(section="changepoints"),
            warnings,
        )[0],
        service._generic_trend_figure(no_numeric_context, no_numeric, EdaPlotRequest(section="trend"), warnings)[0],
    ]

    assert isinstance(empty_figure, go.Figure)
    assert secondary == []
    assert empty_stats["row_count"] == 0
    assert isinstance(unsupported_figure, go.Figure)
    assert len(limited) == 100
    assert all(isinstance(figure, go.Figure) for figure in figures)
    assert warnings


def _measurement_frame() -> pd.DataFrame:
    dates = pd.date_range("2025-01-01", periods=72, freq="h", tz="UTC")
    rows = []
    for index, observed_at in enumerate(dates):
        for station in ("A", "B"):
            for variable in ("PM25", "PM10"):
                rows.append(
                    {
                        "observed_at": observed_at,
                        "station_code": station,
                        "station_name": f"Station {station}",
                        "variable_code": variable,
                        "variable_name": variable,
                        "value": float(index + (10 if variable == "PM10" else 0) + (2 if station == "B" else 0)),
                        "unit": "ug/m3",
                        "source_file_id": 1,
                        "source_file_name": "synthetic.csv",
                        "source_type": "manual",
                    }
                )
    return pd.DataFrame(rows)


def test_measurement_real_builders_cover_supported_sections() -> None:
    service = _service()
    frame = _measurement_frame()

    for section in (
        "rolling",
        "distribution",
        "scatter",
        "data_trend",
        "anomaly",
        "profiles",
        "time_profiles",
        "heat_map",
        "seasonality",
        "decomposition",
        "autocorr",
        "pacf",
        "forecast",
        "changepoints",
        "trend",
        "correlation",
        "summary",
    ):
        payload = EdaPlotRequest(
            section=section,
            station_codes=["A", "B"],
            variable_codes=["PM25", "PM10"],
            granularity="hour",
            chart_type="line",
            rolling_window=3,
            decomposition_window=24,
            forecast_horizon=6,
            changepoint_window=3,
            pair_variable_x="PM25",
            pair_variable_y="PM10",
            histogram_bins=12,
            limit=5000,
        )

        figure, secondary, stats = service._build_measurement_plot(frame, payload, [])

        assert isinstance(figure, go.Figure)
        assert isinstance(secondary, list)
        assert stats["row_count"] == len(frame)


def test_measurement_chart_variants_cover_rolling_paths_and_manual_context_loader() -> None:
    service = _service()
    frame = _measurement_frame()

    for chart_type in ("bar", "scatter", "heatmap"):
        figure, _secondary, stats = service._build_measurement_plot(
            frame,
            EdaPlotRequest(
                section="rolling",
                chart_type=chart_type,
                station_codes=["A", "B"],
                variable_codes=["PM25"],
                granularity="hour",
            ),
            [],
        )

        assert isinstance(figure, go.Figure)
        assert stats["row_count"] == len(frame)

    context = _generic_context()
    payload = EdaPlotRequest(
        section="summary",
        date_from=pd.Timestamp("2025-01-02").date(),
        date_to=pd.Timestamp("2025-01-03").date(),
        station_codes=["A", "B"],
        variable_codes=["urban", "rural"],
        limit=100,
    )

    manual_frame = service._measurement_frame_from_manual_context(context, payload)

    assert set(manual_frame["station_code"]).issubset({"A", "B"})
    assert set(manual_frame["variable_code"]).issubset({"URBAN", "RURAL"})


def test_measurement_additional_distribution_correlation_and_profile_variants() -> None:
    service = _service()
    frame = _measurement_frame()
    requests = [
        EdaPlotRequest(section="rolling", chart_type="line", rolling_window=4, show_std_band=True),
        EdaPlotRequest(section="distribution", chart_type="kde", cumulative=True, normalize_density=True),
        EdaPlotRequest(section="distribution", chart_type="box", swarm_overlay=True),
        EdaPlotRequest(section="distribution", chart_type="violin", swarm_overlay=True),
        EdaPlotRequest(section="summary", chart_type="histogram"),
        EdaPlotRequest(section="summary", chart_type="kde"),
        EdaPlotRequest(section="summary", chart_type="box"),
        EdaPlotRequest(section="summary", chart_type="violin"),
        EdaPlotRequest(section="correlation", chart_type="scatter", pair_variable_x="PM25", pair_variable_y="PM10"),
        EdaPlotRequest(section="correlation", chart_type="regression", pair_variable_x="PM25", pair_variable_y="PM10"),
        EdaPlotRequest(section="correlation", chart_type="heatmap"),
        *[
            EdaPlotRequest(section="profiles", profile_mode=mode)
            for mode in ("hour", "weekday", "month", "quarter", "year")
        ],
        *[
            EdaPlotRequest(section="heat_map", profile_heatmap_mode=mode)
            for mode in ("month", "hour", "weekday", "week")
        ],
        *[EdaPlotRequest(section="seasonality", profile_mode=mode) for mode in ("hour", "weekday", "month")],
    ]

    for payload in requests:
        payload.station_codes = ["A", "B"]
        payload.variable_codes = ["PM25", "PM10"]
        payload.granularity = "hour"
        payload.pair_variable_x = payload.pair_variable_x or "PM25"
        payload.pair_variable_y = payload.pair_variable_y or "PM10"
        figure, secondary, stats = service._build_measurement_plot(frame, payload, [])

        assert isinstance(figure, go.Figure)
        assert isinstance(secondary, list)
        assert stats["samples"] > 0


def test_measurement_direct_temporal_helpers_cover_empty_short_and_multiseries_paths() -> None:
    service = _service()
    frame = _measurement_frame()
    temporal, series_keys = service._compute_temporal_frame(
        frame,
        "hour",
        split_by_station=False,
        aggregation_mode="mean",
    )
    by_station, station_keys = service._compute_temporal_frame(
        frame,
        "hour",
        split_by_station=True,
        aggregation_mode="sum",
    )
    short = temporal.head(3)
    empty = temporal.head(0)

    assert service._temporal_series_frame(temporal, "missing").empty
    assert service._rolling_stats_frame(empty, 3).empty
    assert service._anomaly_frame(empty).empty
    assert service._anomaly_frame(short)["anomaly_value"].isna().all()
    assert service._decomposition_frame(empty, "day", 3).empty
    assert service._stl_decomposition(empty, "day", 3)[1] == "Empty"
    assert service._autocorrelation_frame(pd.DataFrame({"bucket": ["a"], "overall": [1.0]})).empty
    assert service._partial_autocorrelation_frame(pd.DataFrame({"bucket": ["a"], "overall": [1.0]})).empty
    assert service._forecast_frame(empty, "day", 2, empty).empty
    assert service._changepoint_result(short, 2, 2.0)["markers"] == []
    assert service._trend_frame(empty, empty, False)["diagnostics"]["trendDirection"] == "Stable"
    assert service._correlation_matrix(frame.head(0), "hour")["variables"] == []
    assert service._measurement_quality_summary(frame.head(0)) == []
    assert service._measurement_summary_stats(frame.head(0), empty)["samples"] == 0

    figures = [
        service._measurement_multi_forecast_figure(temporal, series_keys, "hour", 3, 4),
        service._measurement_multi_changepoints_figure(temporal, series_keys, 2, 0.5),
        service._measurement_multi_trend_figure(temporal, series_keys, "hour", 4, True),
        service._measurement_multi_anomaly_figure(temporal, series_keys),
        service._measurement_multi_forecast_figure(by_station, station_keys, "hour", 3, 4),
    ]

    assert all(isinstance(figure, go.Figure) for figure in figures)


def test_measurement_direct_single_series_figures_and_loaders(monkeypatch) -> None:
    service = _service()
    frame = _measurement_frame()
    temporal, _series_keys = service._compute_temporal_frame(
        frame[frame["variable_code"] == "PM25"],
        "hour",
        split_by_station=False,
        aggregation_mode="mean",
    )

    anomaly = service._measurement_anomaly_figure(temporal)
    monkeypatch.setattr(go.Figure, "add_vline", lambda figure, *args, **kwargs: figure)
    forecast = service._measurement_forecast_figure(temporal, "hour", horizon=4, trend_window=6)
    changepoints, changepoint_stats = service._measurement_changepoints_figure(
        temporal,
        rolling_window=3,
        sensitivity=0.4,
    )
    trend, trend_stats = service._measurement_trend_figure(
        temporal,
        granularity="hour",
        trend_window=6,
        deseasonalized=True,
    )

    empty_context = ManualDatasetEdaContext(
        dataset=SimpleNamespace(name="Empty", source_file_id=30, dataset_kind="generic"),
        dataframe=pd.DataFrame({"label": ["a", "b"]}),
        mapping=ManualDatasetRoleMapping(),
        summary=ManualDatasetSummary(
            row_count=2,
            column_count=1,
            numeric_columns=[],
            categorical_columns=["label"],
            datetime_columns=[],
        ),
        columns=[],
    )
    assert service._measurement_frame_from_manual_context(empty_context, EdaPlotRequest(section="summary")).empty

    class FakeRow:
        def __init__(self, payload: dict[str, object]) -> None:
            self.payload = payload

        def model_dump(self) -> dict[str, object]:
            return self.payload

    sample_row = {
        "observed_at": pd.Timestamp("2025-01-01T00:00:00Z"),
        "station_code": "A",
        "station_name": "Station A",
        "variable_code": "PM25",
        "variable_name": "PM25",
        "value": "12.5",
        "unit": "ug/m3",
        "source_file_id": 1,
        "source_file_name": "manual.csv",
        "source_type": "manual",
    }

    monkeypatch.setattr(
        "app.services.eda.measurement.query_data",
        lambda _db, _request: SimpleNamespace(rows=[FakeRow(sample_row)]),
    )
    loaded = service._load_measurement_frame(EdaPlotRequest(section="summary"), context=None)
    monkeypatch.setattr(
        "app.services.eda.measurement.query_data",
        lambda _db, _request: SimpleNamespace(rows=[]),
    )
    empty_loaded = service._load_measurement_frame(EdaPlotRequest(section="summary"), context=None)

    assert all(isinstance(figure, go.Figure) for figure in (anomaly, forecast, changepoints, trend))
    assert changepoint_stats["changepoint_count"] >= 0
    assert "trendDirection" in trend_stats
    assert loaded.loc[0, "value"] == 12.5
    assert empty_loaded.empty
