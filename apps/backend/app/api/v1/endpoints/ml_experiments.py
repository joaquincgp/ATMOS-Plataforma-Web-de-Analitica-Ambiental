from __future__ import annotations

import logging
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db_session, require_roles
from app.db.session import SessionLocal
from app.models.user import User
from app.schemas.auth import UserRole
from app.schemas.etl import ManualDatasetResponse
from app.schemas.ml_experiment import (
    MLAlgorithmsResponse,
    MLExperimentRunDetail,
    MLExperimentRunRequest,
    MLExperimentRunSummary,
    MLExperimentSourceRenameRequest,
    MLExperimentSourceSyncRequest,
    MLModelSourceFile,
    MLModelSourcesResponse,
)
from app.services.manual_dataset import ManualDatasetError, ManualDatasetService
from app.services.ml_experiments import _register_all
from app.services.ml_experiments.registry import list_available_algorithms
from app.services.ml_experiments.service import MLExperimentService, MLExperimentServiceError
from app.services.ml_experiments.source_code import list_model_source_files

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_roles(UserRole.admin, UserRole.researcher))])


def _run_ml_experiment_source_sync_background(
    dataset_id: str,
    target_variable_code: str,
    date_from: date | None,
    date_to: date | None,
) -> None:
    db = SessionLocal()
    try:
        service = ManualDatasetService(db)
        service.run_ml_experiment_source_sync(
            dataset_id=dataset_id,
            target_variable_code=target_variable_code,
            date_from=date_from,
            date_to=date_to,
        )
    finally:
        db.close()


@router.get("/algorithms", response_model=MLAlgorithmsResponse)
def get_available_ml_algorithms() -> MLAlgorithmsResponse:
    _register_all()
    return MLAlgorithmsResponse(algorithms=list_available_algorithms())


@router.get("/model-sources", response_model=MLModelSourcesResponse)
def get_ml_model_sources() -> MLModelSourcesResponse:
    return MLModelSourcesResponse(
        files=[
            MLModelSourceFile(key=f.key, filename=f.filename, label=f.label, content=f.content)
            for f in list_model_source_files()
        ]
    )


@router.post("/sources/sync", response_model=ManualDatasetResponse)
def sync_ml_experiment_source(
    payload: MLExperimentSourceSyncRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db_session),
    user: User = Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> ManualDatasetResponse:
    service = ManualDatasetService(db)
    try:
        draft = service.create_ml_experiment_source_draft(
            workspace_id=payload.workspace_id,
            user=user,
            target_variable_code=payload.target_variable_code,
            date_from=payload.date_from,
            date_to=payload.date_to,
        )
    except ManualDatasetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    background_tasks.add_task(
        _run_ml_experiment_source_sync_background,
        draft.id,
        payload.target_variable_code,
        payload.date_from,
        payload.date_to,
    )
    return draft


@router.get("/sources", response_model=list[ManualDatasetResponse])
def list_ml_experiment_sources(
    workspace_id: str = Query(...),
    db: Session = Depends(get_db_session),
    user: User = Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> list[ManualDatasetResponse]:
    service = ManualDatasetService(db)
    try:
        return service.list_ml_experiment_sources(workspace_id=workspace_id, user=user)
    except ManualDatasetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/sources/{source_id}", response_model=ManualDatasetResponse)
def get_ml_experiment_source(
    source_id: str,
    db: Session = Depends(get_db_session),
    user: User = Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> ManualDatasetResponse:
    service = ManualDatasetService(db)
    try:
        return service.get_ml_experiment_source(dataset_id=source_id, user=user)
    except ManualDatasetError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/sources/{source_id}", response_model=ManualDatasetResponse)
def rename_ml_experiment_source(
    source_id: str,
    payload: MLExperimentSourceRenameRequest,
    db: Session = Depends(get_db_session),
    user: User = Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> ManualDatasetResponse:
    service = ManualDatasetService(db)
    try:
        return service.rename_ml_experiment_source(dataset_id=source_id, user=user, name=payload.name)
    except ManualDatasetError as exc:
        detail = str(exc)
        normalized_detail = detail.lower()
        if "sincronización" in normalized_detail:
            status_code = 409
        elif any(message in normalized_detail for message in ("no encontrado", "no tienes acceso", "no pertenece")):
            status_code = 404
        else:
            status_code = 400
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.delete("/sources/{source_id}", status_code=204)
def delete_ml_experiment_source(
    source_id: str,
    db: Session = Depends(get_db_session),
    user: User = Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> None:
    service = ManualDatasetService(db)
    try:
        service.delete_ml_experiment_source(dataset_id=source_id, user=user)
    except ManualDatasetError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


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


@router.delete("/runs/{run_id}", status_code=204)
def delete_ml_experiment_run(
    run_id: str,
    db: Session = Depends(get_db_session),
    user=Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> None:
    service = MLExperimentService(db)
    try:
        service.delete_run(user=user, run_id=run_id)
    except MLExperimentServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/runs", response_model=dict[str, int])
def clear_ml_experiment_run_history(
    workspace_id: str = Query(...),
    db: Session = Depends(get_db_session),
    user=Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> dict[str, int]:
    service = MLExperimentService(db)
    try:
        cleared = service.clear_run_history(user=user, workspace_id=workspace_id)
    except MLExperimentServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"cleared": cleared}
