from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db_session, require_roles
from app.schemas.auth import UserRole
from app.schemas.ml_experiment import (
    MLExperimentRunDetail,
    MLExperimentRunRequest,
    MLExperimentRunSummary,
)
from app.services.ml_experiments.service import MLExperimentService, MLExperimentServiceError

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_roles(UserRole.admin, UserRole.researcher))])


@router.post("/runs", response_model=MLExperimentRunDetail)
def submit_ml_experiment_run(
    payload: MLExperimentRunRequest,
    db: Session = Depends(get_db_session),
    user=Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> MLExperimentRunDetail:
    service = MLExperimentService(db)
    try:
        return service.submit_run(user=user, payload=payload)
    except MLExperimentServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/runs/{run_id}", response_model=MLExperimentRunDetail)
def get_ml_experiment_run(
    run_id: str,
    db: Session = Depends(get_db_session),
    user=Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> MLExperimentRunDetail:
    service = MLExperimentService(db)
    try:
        return service.get_run(user=user, run_id=run_id)
    except MLExperimentServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/runs", response_model=list[MLExperimentRunSummary])
def list_ml_experiment_runs(
    workspace_id: str = Query(...),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db_session),
    user=Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> list[MLExperimentRunSummary]:
    service = MLExperimentService(db)
    try:
        return service.list_runs(user=user, workspace_id=workspace_id, limit=limit)
    except MLExperimentServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
