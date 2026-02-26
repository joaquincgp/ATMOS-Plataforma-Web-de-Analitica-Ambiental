from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db_session
from app.schemas.analytics import (
    AnalyticsFilterOptionsResponse,
    AnalyticsQueryRequest,
    AnalyticsQueryResponse,
    SqlPreviewRequest,
    SqlPreviewResponse,
)
from app.services.analytics_service import get_filter_options, preview_sql, query_data

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


@router.post("/sql/preview", response_model=SqlPreviewResponse)
def run_sql_preview(
    payload: SqlPreviewRequest,
    db: Session = Depends(get_db_session),
) -> SqlPreviewResponse:
    try:
        return preview_sql(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

