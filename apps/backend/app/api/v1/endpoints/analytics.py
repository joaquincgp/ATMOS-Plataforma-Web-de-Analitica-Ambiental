from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db_session
from app.schemas.analytics import (
    AnalyticsFilterOptionsResponse,
    AnalyticsQueryRequest,
    AnalyticsQueryResponse,
    SqlPreviewRequest,
    SqlPreviewResponse,
    StationLiveSnapshotResponse,
)
from app.services.analytics_service import (
    get_filter_options,
    get_station_live_snapshot,
    preview_sql,
    query_data,
)

router = APIRouter()


@router.get("/filters", response_model=AnalyticsFilterOptionsResponse)
def get_analytics_filters(db: Session = Depends(get_db_session)) -> AnalyticsFilterOptionsResponse:
    return get_filter_options(db)


@router.post("/query", response_model=AnalyticsQueryResponse)
def run_analytics_query(
    payload: AnalyticsQueryRequest,
    db: Session = Depends(get_db_session),
) -> AnalyticsQueryResponse:
    return query_data(db, payload)


@router.get("/station-live", response_model=StationLiveSnapshotResponse)
def get_station_live(
    station_codes: list[str] | None = Query(default=None),
    db: Session = Depends(get_db_session),
) -> StationLiveSnapshotResponse:
    return get_station_live_snapshot(db, station_codes=station_codes)


@router.post("/sql/preview", response_model=SqlPreviewResponse)
def run_sql_preview(
    payload: SqlPreviewRequest,
    db: Session = Depends(get_db_session),
) -> SqlPreviewResponse:
    try:
        return preview_sql(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
