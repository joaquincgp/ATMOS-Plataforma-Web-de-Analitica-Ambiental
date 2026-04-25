from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db_session, require_roles
from app.schemas.advanced_analytics import AdvancedAnalyticsRequest, AdvancedAnalyticsResponse
from app.schemas.auth import UserRole
from app.services.advanced_analytics_service import AdvancedAnalyticsError, AdvancedAnalyticsService

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_roles(UserRole.admin, UserRole.researcher))])


@router.post("/forecast", response_model=AdvancedAnalyticsResponse)
def run_advanced_forecast(
    payload: AdvancedAnalyticsRequest,
    db: Session = Depends(get_db_session),
    user=Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> AdvancedAnalyticsResponse:
    service = AdvancedAnalyticsService(db, user)
    try:
        return service.run_forecast(payload)
    except AdvancedAnalyticsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Advanced Analytics request failed unexpectedly.")
        raise HTTPException(
            status_code=500,
            detail="Advanced Analytics failed unexpectedly. Check backend logs for the root cause.",
        ) from exc
