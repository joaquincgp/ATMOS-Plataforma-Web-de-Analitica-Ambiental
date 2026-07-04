from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import get_db_session, require_roles
from app.schemas.analytics import (
    AnalyticsFilterOptionsResponse,
    AnalyticsQueryRequest,
    AnalyticsQueryResponse,
    SqlPreviewRequest,
    SqlPreviewResponse,
    StationLiveSnapshotResponse,
)
from app.schemas.auth import UserRole
from app.services.analytics_service import (
    export_query_data,
    get_filter_options,
    get_station_live_snapshot,
    preview_sql,
    query_data,
)

router = APIRouter(dependencies=[Depends(require_roles(UserRole.admin, UserRole.researcher))])


@router.get("/filters", response_model=AnalyticsFilterOptionsResponse)
def get_analytics_filters(db: Session = Depends(get_db_session)) -> AnalyticsFilterOptionsResponse:
    return get_filter_options(db)


@router.post("/query", response_model=AnalyticsQueryResponse)
def run_analytics_query(
    payload: AnalyticsQueryRequest,
    db: Session = Depends(get_db_session),
) -> AnalyticsQueryResponse:
    return query_data(db, payload)


@router.post("/export")
def export_analytics_query(
    payload: AnalyticsQueryRequest,
    db: Session = Depends(get_db_session),
) -> Response:
    response = export_query_data(db, payload)
    columns = [
        "observed_at",
        "station_code",
        "station_name",
        "variable_code",
        "variable_name",
        "value",
        "unit",
        "source_file_id",
        "source_file_name",
        "source_type",
    ]
    rows = [",".join(columns)]
    for row in response.rows:
        values = [getattr(row, column) for column in columns]
        rows.append(",".join(_escape_csv_cell(value) for value in values))
    content = ("\ufeff" + "\n".join(rows)).encode("utf-8")
    filename = quote("remmaq-records.csv")
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


def _escape_csv_cell(value: object) -> str:
    if value is None:
        return ""
    text = str(value)
    if any(token in text for token in [",", "\"", "\n", "\r"]):
        return '"' + text.replace('"', '""') + '"'
    return text


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
