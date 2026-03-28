from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db_session, require_roles
from app.schemas.auth import UserRole
from app.schemas.eda import EdaPlotRequest, EdaPlotResponse
from app.services.eda_service import EdaService, EdaServiceError

router = APIRouter(dependencies=[Depends(require_roles(UserRole.admin, UserRole.researcher))])


@router.post("/plot", response_model=EdaPlotResponse)
def build_eda_plot(
    payload: EdaPlotRequest,
    db: Session = Depends(get_db_session),
    user=Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> EdaPlotResponse:
    service = EdaService(db, user)
    try:
        return service.build_plot(payload)
    except EdaServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
