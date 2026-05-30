# Unit tests intentionally exercise internal EDA dispatch paths with lightweight figures.
# pylint: disable=protected-access

from types import SimpleNamespace

import pandas as pd
import plotly.graph_objects as go

from app.schemas.eda import EdaPlotRequest
from app.services.eda.common import EdaServiceError
from app.services.eda.service import EdaService
from app.services.manual_dataset import ManualDatasetError


def _figure(name: str = "trace") -> go.Figure:
    figure = go.Figure()
    figure.add_scatter(x=[1], y=[1], name=name)
    return figure


def _frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "observed_at": pd.to_datetime(["2025-01-01T00:00:00Z"]),
            "station_code": ["A"],
            "variable_code": ["PM25"],
            "value": [10.0],
        }
    )


def _measurement_service(series_keys: list[str] | None = None) -> EdaService:
    service = EdaService.__new__(EdaService)
    temporal_frame = pd.DataFrame({"bucket": pd.to_datetime(["2025-01-01T00:00:00Z"]), "value": [10.0]})
    service._compute_temporal_frame = lambda frame, granularity, split_by_station, aggregation: (
        temporal_frame,
        series_keys or ["value"],
    )
    service._measurement_summary_stats = lambda frame, temporal: {"samples": 1, "mean": 10.0, "min": 10.0, "max": 10.0}
    service._measurement_variable_summary = lambda frame: [{"variable": "PM25"}]
    service._measurement_quality_summary = lambda frame: {"missing": 0}
    service._measurement_rolling_figure = lambda *args, **kwargs: _figure("rolling")
    service._rolling_stats_frame = lambda *args, **kwargs: temporal_frame
    service._measurement_histogram_figure = lambda *args, **kwargs: _figure("histogram")
    service._measurement_rolling_envelope_figure = lambda *args, **kwargs: _figure("envelope")
    service._measurement_distribution_figures = lambda *args, **kwargs: _figure("distribution")
    service._measurement_pair_figure = lambda *args, **kwargs: (_figure("pair"), {"correlation": 1.0})
    service._measurement_anomaly_figure = lambda *args, **kwargs: _figure("anomaly")
    service._measurement_multi_anomaly_figure = lambda *args, **kwargs: _figure("multi-anomaly")
    service._measurement_profile_figure = lambda *args, **kwargs: _figure("profile")
    service._measurement_profile_heatmap_figure = lambda *args, **kwargs: _figure("profile-heatmap")
    service._measurement_seasonality_figure = lambda *args, **kwargs: _figure("seasonality")
    service._measurement_decomposition_figure = lambda *args, **kwargs: _figure("decomposition")
    service._measurement_autocorr_figure = lambda *args, **kwargs: _figure("autocorr")
    service._measurement_forecast_figure = lambda *args, **kwargs: _figure("forecast")
    service._measurement_multi_forecast_figure = lambda *args, **kwargs: _figure("multi-forecast")
    service._measurement_changepoints_figure = lambda *args, **kwargs: (_figure("changepoints"), {"changes": 1})
    service._measurement_multi_changepoints_figure = lambda *args, **kwargs: _figure("multi-changepoints")
    service._measurement_trend_figure = lambda *args, **kwargs: (_figure("trend"), {"slope": 1.0})
    service._measurement_multi_trend_figure = lambda *args, **kwargs: _figure("multi-trend")
    service._measurement_correlation_figures = lambda *args, **kwargs: (_figure("correlation"), [])
    service._measurement_summary_figure = lambda *args, **kwargs: _figure("summary")
    return service


def test_build_measurement_plot_returns_empty_response_for_empty_frame() -> None:
    service = _measurement_service()

    figure, secondary, stats = service._build_measurement_plot(
        pd.DataFrame(),
        EdaPlotRequest(section="summary"),
        [],
    )

    assert len(figure.layout.annotations) == 1
    assert not secondary
    assert stats["row_count"] == 0


def test_build_measurement_plot_dispatches_single_series_sections() -> None:
    service = _measurement_service()

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
        figure, _secondary, stats = service._build_measurement_plot(_frame(), EdaPlotRequest(section=section), [])

        assert isinstance(figure, go.Figure)
        assert stats["row_count"] == 1


def test_build_measurement_plot_dispatches_multi_series_sections() -> None:
    service = _measurement_service(series_keys=["A", "B"])

    for section in ("anomaly", "forecast", "changepoints", "trend"):
        figure, secondary, stats = service._build_measurement_plot(_frame(), EdaPlotRequest(section=section), [])

        assert isinstance(figure, go.Figure)
        assert not secondary
        assert stats["row_count"] == 1


def _generic_service() -> EdaService:
    service = EdaService.__new__(EdaService)
    service._generic_stats = lambda context, frame, payload: {"row_count": len(frame)}
    service._generic_time_series_figure = lambda *args, **kwargs: _figure("time-series")
    service._generic_summary_figures = lambda *args, **kwargs: (_figure("summary"), [])
    service._generic_correlation_figures = lambda *args, **kwargs: (_figure("correlation"), [])
    service._generic_time_profile_figure = lambda *args, **kwargs: _figure("profile")
    service._generic_calendar_heatmap_figure = lambda *args, **kwargs: _figure("calendar")
    service._generic_anomaly_figure = lambda *args, **kwargs: _figure("anomaly")
    service._generic_decomposition_figure = lambda *args, **kwargs: _figure("decomposition")
    service._generic_autocorr_figure = lambda *args, **kwargs: _figure("autocorr")
    service._generic_forecast_figure = lambda *args, **kwargs: _figure("forecast")
    service._generic_changepoints_figure = lambda *args, **kwargs: (_figure("changepoints"), {"changes": 1})
    service._generic_trend_figure = lambda *args, **kwargs: (_figure("trend"), {"slope": 1.0})
    return service


def test_build_generic_plot_dispatches_supported_sections() -> None:
    service = _generic_service()
    context = SimpleNamespace(dataset=SimpleNamespace(dataset_kind="generic"))
    frame = pd.DataFrame({"observed_at": pd.to_datetime(["2025-01-01"]), "value": [10.0]})

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
        figure, secondary, stats = service._build_generic_plot(context, frame, EdaPlotRequest(section=section), [])

        assert isinstance(figure, go.Figure)
        assert isinstance(secondary, list)
        assert stats["row_count"] == 1


def test_build_generic_plot_returns_empty_for_empty_frame() -> None:
    service = _generic_service()

    figure, secondary, stats = service._build_generic_plot(
        SimpleNamespace(dataset=SimpleNamespace(dataset_kind="generic")),
        pd.DataFrame(),
        EdaPlotRequest(section="summary"),
        [],
    )

    assert len(figure.layout.annotations) == 1
    assert not secondary
    assert stats["row_count"] == 0


def test_build_plot_uses_manual_generic_context_and_wraps_manual_errors() -> None:
    service = EdaService.__new__(EdaService)
    context = SimpleNamespace(dataset=SimpleNamespace(dataset_kind="generic"))
    service.manual_dataset_service = SimpleNamespace(get_eda_context=lambda dataset_id, user: context)
    service.user = SimpleNamespace(id="user-1")
    service._prepare_generic_frame = lambda context, payload, warnings: pd.DataFrame({"value": [1]})
    service._build_generic_plot = lambda context, frame, payload, warnings: (_figure("generic"), [], {"row_count": 1})

    response = service.build_plot(EdaPlotRequest(section="summary", manual_dataset_id="dataset-1"))

    assert response.stats["row_count"] == 1
    assert response.figure_json["data"][0]["name"] == "generic"

    service.manual_dataset_service = SimpleNamespace(
        get_eda_context=lambda dataset_id, user: (_ for _ in ()).throw(ManualDatasetError("bad dataset"))
    )
    try:
        service.build_plot(EdaPlotRequest(section="summary", manual_dataset_id="dataset-1"))
    except EdaServiceError as exc:
        assert "bad dataset" in str(exc)
    else:
        raise AssertionError("Expected EdaServiceError for manual dataset failures.")


def test_build_plot_uses_measurement_loader_when_no_generic_context() -> None:
    service = EdaService.__new__(EdaService)
    service.manual_dataset_service = SimpleNamespace()
    service._load_measurement_frame = lambda payload, context: _frame()
    service._build_measurement_plot = lambda frame, payload, warnings: (_figure("measurement"), [], {"row_count": 1})

    response = service.build_plot(EdaPlotRequest(section="summary"))

    assert response.stats["row_count"] == 1
    assert response.figure_json["data"][0]["name"] == "measurement"
