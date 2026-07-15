from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db_session
from app.schemas.public_air_quality import PublicAirQualityResponse
from app.services.public_air_quality_service import get_public_air_quality_snapshot

router = APIRouter()


@router.get("/air-quality", response_model=PublicAirQualityResponse)
def get_public_air_quality(
    variable_code: str = Query(default="PM25"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    hours: int = Query(default=24, ge=1, le=744),
    period: str = Query(default="latest"),
    hour: int | None = Query(default=None, ge=0, le=23),
    station_code: str | None = Query(default=None),
    force_sync: bool = Query(default=False),
    db: Session = Depends(get_db_session),
) -> PublicAirQualityResponse:
    """Serve the pre-built public dashboard snapshot.

    This endpoint never performs network I/O. REMMAQ ingestion for the public
    map runs entirely in the background refresh loop (``app/main.py``), so a
    public request always returns instantly from the pre-built snapshot and can
    never time out or fail waiting on the upstream REMMAQ source. This is the
    single most important robustness property of the public dashboard: the page
    must render even when REMMAQ is slow, unreachable, or mid-sync.

    ``force_sync`` only controls whether the in-memory snapshot cache is reused;
    it rebuilds the snapshot from whatever data the background loop has already
    ingested into the database. The legacy ``sync`` query parameter is accepted
    but ignored (FastAPI drops unknown query params), preserving the frontend
    contract without ever blocking on REMMAQ.
    """
    try:
        return get_public_air_quality_snapshot(
            db,
            variable_code=variable_code,
            date_from=date_from,
            date_to=date_to,
            hours=hours,
            period=period,
            hour=hour,
            station_code=station_code,
            use_cache=not force_sync,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
