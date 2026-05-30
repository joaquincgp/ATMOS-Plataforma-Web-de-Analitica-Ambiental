# Unit tests cover advanced analytics orchestration and manual dataset loading paths.
# pylint: disable=protected-access

from datetime import UTC, date, datetime
from types import SimpleNamespace

import pandas as pd
import plotly.graph_objects as go
import pytest

from app.schemas.advanced_analytics import AdvancedAnalyticsRequest
from app.schemas.etl import ManualDatasetRoleMapping, ManualDatasetSummary
from app.services.advanced_analytics_service import AdvancedAnalyticsError, AdvancedAnalyticsService
from app.services.manual_dataset.service import ManualDatasetEdaContext


def _service() -> AdvancedAnalyticsService:
    service = AdvancedAnalyticsService.__new__(AdvancedAnalyticsService)
    service.db = None
    service.user = SimpleNamespace(id="user-1")
    return service


def _generic_context(frame: pd.DataFrame | None = None) -> ManualDatasetEdaContext:
    dataframe = frame if frame is not None else pd.DataFrame(
        {
            "observed_at": pd.date_range("2025-01-01", periods=10, freq="D", tz="UTC"),
            "value": range(10),
            "fallback_value": [index * 2 for index in range(10)],
        }
    )
    return ManualDatasetEdaContext(
        dataset=SimpleNamespace(dataset_kind="generic"),
        dataframe=dataframe,
        mapping=ManualDatasetRoleMapping(datetime_column="observed_at", value_column="value"),
        summary=ManualDatasetSummary(
            row_count=len(dataframe),
            column_count=len(dataframe.columns),
            numeric_columns=[column for column in dataframe.columns if column != "observed_at"],
            datetime_columns=["observed_at"] if "observed_at" in dataframe.columns else [],
            categorical_columns=[],
        ),
        columns=[],
    )


def test_run_forecast_orchestrates_loading_modeling_and_response(monkeypatch) -> None:
    service = _service()
    observed = pd.Series(
        [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0],
        index=pd.date_range("2025-01-01", periods=8, freq="D", tz="UTC"),
    )
    fitted = pd.DataFrame(
        {
            "bucket": observed.index,
            "observed": observed.to_numpy(),
            "fitted": observed.to_numpy() - 0.1,
        }
    )
    forecast = pd.DataFrame(
        {
            "bucket": pd.date_range("2025-01-09", periods=2, freq="D", tz="UTC"),
            "forecast": [9.0, 10.0],
            "upper": [10.0, 11.0],
            "lower": [8.0, 9.0],
        }
    )

    monkeypatch.setattr(service, "_load_series", lambda payload, warnings: (observed, "PM25"))
    monkeypatch.setattr(service, "_fit_model", lambda series, payload: (fitted, forecast, {"aic": 1.2}))

    response = service.run_forecast(AdvancedAnalyticsRequest(source_file_ids=[1], model="arima", horizon=2))

    assert response.stats["series_label"] == "PM25"
    assert response.stats["training_points"] == 8
    assert response.stats["model"] == "ARIMA"
    assert response.figure_json["data"]


def test_run_forecast_rejects_empty_and_too_short_series(monkeypatch) -> None:
    service = _service()
    payload = AdvancedAnalyticsRequest(source_file_ids=[1], model="sarima", seasonal_order=[1, 0, 1, 7])

    monkeypatch.setattr(service, "_load_series", lambda _payload, _warnings: (pd.Series(dtype=float), "PM25"))
    with pytest.raises(AdvancedAnalyticsError, match="No se encontraron"):
        service.run_forecast(payload)

    short = pd.Series([1.0, 2.0, 3.0], index=pd.date_range("2025-01-01", periods=3, freq="D", tz="UTC"))
    monkeypatch.setattr(service, "_load_series", lambda _payload, _warnings: (short, "PM25"))
    with pytest.raises(AdvancedAnalyticsError, match="muy pocas observaciones"):
        service.run_forecast(payload)


def test_generic_manual_series_resolves_requested_and_fallback_columns() -> None:
    service = _service()
    context = _generic_context()
    payload = AdvancedAnalyticsRequest(
        manual_dataset_id="dataset-1",
        x_axis="observed_at",
        y_axis="fallback_value",
        date_from=date(2025, 1, 3),
        date_to=date(2025, 1, 5),
        granularity="day",
    )

    series, label = service._load_generic_manual_series(context, payload)

    assert label == "fallback_value"
    assert series.index.min() == pd.Timestamp("2025-01-03T00:00:00Z")
    assert series.index.max() == pd.Timestamp("2025-01-05T00:00:00Z")
    assert service._resolve_generic_time_column(context, None) == "observed_at"
    assert service._resolve_generic_value_column(context, None) == "value"


def test_generic_manual_series_rejects_missing_required_columns() -> None:
    service = _service()
    context = _generic_context(pd.DataFrame({"label": ["a", "b"], "value": ["x", "y"]}))

    with pytest.raises(AdvancedAnalyticsError, match="columna temporal"):
        service._load_generic_manual_series(context, AdvancedAnalyticsRequest(manual_dataset_id="dataset-1"))


def test_manual_measurement_series_aggregates_response_rows_and_warns() -> None:
    service = _service()
    response = SimpleNamespace(
        rows=[
            SimpleNamespace(
                observed_at=datetime(2025, 1, 1, tzinfo=UTC),
                value=10.0,
                station_code="A",
                variable_code="PM25",
            ),
            SimpleNamespace(
                observed_at=datetime(2025, 1, 1, 1, tzinfo=UTC),
                value=20.0,
                station_code="B",
                variable_code="PM10",
            ),
        ]
    )
    service.manual_dataset_service = SimpleNamespace(
        get_eda_context=lambda dataset_id, user: SimpleNamespace(dataset=SimpleNamespace(dataset_kind="measurements")),
        get_analytics_rows=lambda **_kwargs: response,
    )
    warnings: list[str] = []

    series, label = service._load_series(
        AdvancedAnalyticsRequest(manual_dataset_id="dataset-1", granularity="day"),
        warnings,
    )

    assert label == "PM25"
    assert series.iloc[0] == 15.0
    assert len(warnings) == 2


def test_measurement_series_uses_database_metadata_filters_and_rows() -> None:
    service = _service()

    class FakeResult:
        def __init__(self, value):
            self.value = value

        def one(self):
            return self.value

        def all(self):
            return self.value

    class FakeDb:
        def __init__(self) -> None:
            self.calls = 0

        def execute(self, _statement):
            self.calls += 1
            if self.calls == 1:
                return FakeResult(SimpleNamespace(station_count=2, variable_count=2, first_variable_code="pm-2.5"))
            return FakeResult(
                [
                    SimpleNamespace(bucket=datetime(2025, 1, 1), value=10.0),
                    SimpleNamespace(bucket=datetime(2025, 1, 2), value=20.0),
                ]
            )

    service.db = FakeDb()
    warnings: list[str] = []

    series, label = service._load_series(
        AdvancedAnalyticsRequest(
            source_file_ids=[1],
            station_codes=["A", "B"],
            variable_codes=["PM25", "PM10"],
            date_from=date(2025, 1, 1),
            date_to=date(2025, 1, 2),
            view_from=datetime(2025, 1, 1),
            view_to=datetime(2025, 1, 2),
            granularity="day",
        ),
        warnings,
    )

    assert label == "PM25"
    assert series.tolist() == [10.0, 20.0]
    assert len(warnings) == 2


def test_load_series_rejects_missing_sources_and_handles_empty_measurement_rows() -> None:
    service = _service()
    with pytest.raises(AdvancedAnalyticsError, match="fuente"):
        service._load_series(AdvancedAnalyticsRequest(), [])

    service._load_measurement_metadata = lambda payload: (0, 0, "selection")
    service.db = SimpleNamespace(execute=lambda _statement: SimpleNamespace(all=lambda: []))
    series, label = service._load_measurement_series(AdvancedAnalyticsRequest(source_file_ids=[1]), [])

    assert series.empty
    assert label == "selection"


def test_validation_budget_and_time_helpers_cover_boundaries() -> None:
    service = _service()
    arima_series = pd.Series(range(5001), index=pd.date_range("2020-01-01", periods=5001, freq="D", tz="UTC"))
    prophet_series = pd.Series(range(20001), index=pd.date_range("2020-01-01", periods=20001, freq="D", tz="UTC"))

    with pytest.raises(AdvancedAnalyticsError, match="ARIMA/SARIMA"):
        service._validate_model_budget(arima_series, AdvancedAnalyticsRequest(source_file_ids=[1], model="arima"))
    with pytest.raises(AdvancedAnalyticsError, match="Prophet"):
        service._validate_model_budget(prophet_series, AdvancedAnalyticsRequest(source_file_ids=[1], model="prophet"))

    assert service._to_utc_timestamp(datetime(2025, 1, 1)).tzinfo is not None
    assert service._date_start(date(2025, 1, 1)) == pd.Timestamp("2025-01-01T00:00:00Z")
    assert service._date_end(date(2025, 1, 1)) == pd.Timestamp("2025-01-02T00:00:00Z")


def test_build_figure_handles_empty_fitted_and_forecast_frames() -> None:
    service = _service()
    observed = pd.Series([1.0, 2.0], index=pd.date_range("2025-01-01", periods=2, freq="D", tz="UTC"))

    figure = service._build_figure(
        observed,
        pd.DataFrame(columns=["bucket", "observed", "fitted"]),
        pd.DataFrame(columns=["bucket", "forecast", "upper", "lower"]),
        "PM25",
        "arima",
    )

    assert isinstance(figure, go.Figure)
    assert len(figure.data) == 1
