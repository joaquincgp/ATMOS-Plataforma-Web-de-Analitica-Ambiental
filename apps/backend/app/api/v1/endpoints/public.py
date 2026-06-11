from __future__ import annotations

import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db_session
from app.schemas.public_air_quality import PublicAirQualityResponse
from app.services.public_air_quality_service import (
    clear_public_snapshot_cache,
    get_public_air_quality_snapshot,
)
from app.services.remmaq_current import should_sync_current_remmaq_snapshot, sync_current_remmaq_snapshot

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/air-quality", response_model=PublicAirQualityResponse)
def get_public_air_quality(
    variable_code: str = Query(default="PM25"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    hours: int = Query(default=24, ge=1, le=744),
    period: str = Query(default="latest"),
    hour: int | None = Query(default=None, ge=0, le=23),
    station_code: str | None = Query(default=None),
    sync: bool = Query(default=True),
    force_sync: bool = Query(default=False),
    db: Session = Depends(get_db_session),
) -> PublicAirQualityResponse:
    try:
        if sync:
            try:
                if should_sync_current_remmaq_snapshot(db, force_sync=force_sync):
                    sync_current_remmaq_snapshot(db)
                    clear_public_snapshot_cache()
            except Exception:
                logger.exception("Failed to sync current REMMAQ public map data.")
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
