from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import advanced_analytics, analytics, eda, stations
from app.schemas.advanced_analytics import AdvancedAnalyticsRequest, AdvancedAnalyticsResponse
from app.schemas.analytics import (
    AnalyticsFilterOptionsResponse,
    AnalyticsQueryRequest,
    AnalyticsQueryResponse,
    SqlPreviewRequest,
    SqlPreviewResponse,
    StationLiveSnapshotResponse,
)
from app.schemas.eda import EdaPlotRequest, EdaPlotResponse
from app.schemas.station import StationListResponse
from app.services.advanced_analytics_service import AdvancedAnalyticsError
from app.services.eda import EdaServiceError


def test_analytics_endpoint_functions_delegate_to_services(monkeypatch) -> None:
    filters = AnalyticsFilterOptionsResponse(
        sources=[],
        stations=[],
        variables=[],
        min_observed_at=None,
        max_observed_at=None,
    )
    query = AnalyticsQueryResponse(rows=[], row_count=0, truncated=False)
    live = StationLiveSnapshotResponse(stations=[], total=0, latest_observed_at=None)
    preview = SqlPreviewResponse(columns=["value"], rows=[{"value": 1}], row_count=1, truncated=False)

    monkeypatch.setattr(analytics, "get_filter_options", lambda db: filters)
    monkeypatch.setattr(analytics, "query_data", lambda db, payload: query)
    monkeypatch.setattr(analytics, "get_station_live_snapshot", lambda db, station_codes=None: live)
    monkeypatch.setattr(analytics, "preview_sql", lambda db, payload: preview)

    assert analytics.get_analytics_filters(db=None) is filters
    assert analytics.run_analytics_query(AnalyticsQueryRequest(), db=None) is query
    assert analytics.get_station_live(station_codes=["A"], db=None) is live
    assert analytics.run_sql_preview(SqlPreviewRequest(sql="select 1"), db=None) is preview


def test_sql_preview_endpoint_converts_validation_errors_to_http_400(monkeypatch) -> None:
    monkeypatch.setattr(analytics, "preview_sql", lambda db, payload: (_ for _ in ()).throw(ValueError("bad sql")))

    with pytest.raises(HTTPException) as exc:
        analytics.run_sql_preview(SqlPreviewRequest(sql="select 1"), db=None)

    assert exc.value.status_code == 400


def test_eda_endpoint_returns_plot_and_converts_service_errors(monkeypatch) -> None:
    response = EdaPlotResponse(figure_json={"data": []}, stats={"row_count": 1})

    class FakeEdaService:
        def __init__(self, db, user):
            pass

        def build_plot(self, _payload):
            return response

    monkeypatch.setattr(eda, "EdaService", FakeEdaService)
    assert eda.build_eda_plot(EdaPlotRequest(section="summary"), db=None, user=SimpleNamespace()) is response

    class FailingEdaService:
        def __init__(self, db, user):
            pass

        def build_plot(self, payload):
            raise EdaServiceError("bad plot")

    monkeypatch.setattr(eda, "EdaService", FailingEdaService)
    with pytest.raises(HTTPException) as exc:
        eda.build_eda_plot(EdaPlotRequest(section="summary"), db=None, user=SimpleNamespace())
    assert exc.value.status_code == 400


def test_advanced_analytics_endpoint_maps_expected_and_unexpected_errors(monkeypatch) -> None:
    response = AdvancedAnalyticsResponse(figure_json={"data": []}, stats={"samples": 1})

    class FakeAdvancedService:
        def __init__(self, db, user):
            pass

        def run_forecast(self, _payload):
            return response

    monkeypatch.setattr(advanced_analytics, "AdvancedAnalyticsService", FakeAdvancedService)
    assert (
        advanced_analytics.run_advanced_forecast(AdvancedAnalyticsRequest(), db=None, user=SimpleNamespace())
        is response
    )

    class ExpectedFailingAdvancedService:
        def __init__(self, db, user):
            pass

        def run_forecast(self, payload):
            raise AdvancedAnalyticsError("bad forecast")

    monkeypatch.setattr(advanced_analytics, "AdvancedAnalyticsService", ExpectedFailingAdvancedService)
    with pytest.raises(HTTPException) as expected:
        advanced_analytics.run_advanced_forecast(AdvancedAnalyticsRequest(), db=None, user=SimpleNamespace())
    assert expected.value.status_code == 400

    class UnexpectedFailingAdvancedService:
        def __init__(self, db, user):
            pass

        def run_forecast(self, payload):
            raise RuntimeError("boom")

    monkeypatch.setattr(advanced_analytics, "AdvancedAnalyticsService", UnexpectedFailingAdvancedService)
    with pytest.raises(HTTPException) as unexpected:
        advanced_analytics.run_advanced_forecast(AdvancedAnalyticsRequest(), db=None, user=SimpleNamespace())
    assert unexpected.value.status_code == 500


def test_stations_endpoint_delegates_to_service(monkeypatch) -> None:
    response = StationListResponse(items=[], total=0)
    monkeypatch.setattr(stations, "list_stations", lambda db: response)

    assert stations.get_stations(db=None) is response
