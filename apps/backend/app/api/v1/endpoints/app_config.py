from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_db_session, require_roles
from app.models.user import User
from app.schemas.app_config import AppConfigResponse, AppConfigUpdateRequest
from app.schemas.auth import UserRole
from app.services.app_config_service import AppConfigError, get_app_config, reset_app_config, update_app_config

router = APIRouter(dependencies=[Depends(require_roles(UserRole.admin, UserRole.researcher))])


@router.get("", response_model=AppConfigResponse)
def read_app_config(db: Session = Depends(get_db_session)) -> AppConfigResponse:
    return get_app_config(db)


@router.patch("", response_model=AppConfigResponse)
def patch_app_config(
    payload: AppConfigUpdateRequest,
    db: Session = Depends(get_db_session),
    _admin: User = Depends(require_roles(UserRole.admin)),
) -> AppConfigResponse:
    try:
        return update_app_config(db, payload)
    except AppConfigError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/reset", response_model=AppConfigResponse)
def reset_config_to_defaults(
    db: Session = Depends(get_db_session),
    _admin: User = Depends(require_roles(UserRole.admin)),
) -> AppConfigResponse:
    return reset_app_config(db)
