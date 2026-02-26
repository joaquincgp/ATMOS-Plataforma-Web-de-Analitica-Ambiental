from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Query, UploadFile
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db_session
from app.db.session import SessionLocal
from app.models.etl_run import EtlRun
from app.schemas.etl import DbInitResponse, EtlMetricsResponse, EtlPreviewResponse, EtlRunResponse
from app.services.etl import EtlService

router = APIRouter()


def _to_run_response(run: EtlRun) -> EtlRunResponse:
    return EtlRunResponse(
        id=run.id,
        trigger_type=run.trigger_type,
        source=run.source,
        status=run.status,
        started_at=run.started_at,
        finished_at=run.finished_at,
        archives_discovered=run.archives_discovered,
        archives_processed=run.archives_processed,
        records_inserted=run.records_inserted,
        records_updated=run.records_updated,
        records_skipped=run.records_skipped,
        details=run.details or {},
    )


def _run_remmaq_sync_background(
    run_id: str,
    selected_variables: list[str],
    max_archives: int,
) -> None:
    db = SessionLocal()
    try:
        service = EtlService(db)
        service.run_remmaq_sync(
            run_id=run_id,
            selected_variables=selected_variables,
            max_archives=max_archives,
        )
    finally:
        db.close()


def _run_manual_ingestion_background(
    run_id: str,
    filename: str,
    content: bytes,
    force_reprocess: bool,
) -> None:
    db = SessionLocal()
    try:
        service = EtlService(db)
        service.run_manual_ingestion(
            run_id=run_id,
            filename=filename,
            content=content,
            force_reprocess=force_reprocess,
        )
    finally:
        db.close()


@router.post("/db/init", response_model=DbInitResponse)
def initialize_database(db: Session = Depends(get_db_session)) -> DbInitResponse:
    service = EtlService(db)
    payload = service.initialize_database()
    return DbInitResponse(**payload)


@router.post("/sync/remmaq", response_model=EtlRunResponse)
def sync_remmaq(
    force_reprocess: bool = Query(default=False),
    variable_codes: list[str] | None = Query(default=None),
    max_archives: int | None = Query(default=None, ge=1, le=30),
    db: Session = Depends(get_db_session),
) -> EtlRunResponse:
    service = EtlService(db)
    try:
        run = service.sync_remmaq(
            force_reprocess=force_reprocess,
            variable_codes=variable_codes,
            max_archives=max_archives,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_run_response(run)


@router.post("/sync/remmaq/start", response_model=EtlRunResponse)
def start_sync_remmaq(
    background_tasks: BackgroundTasks,
    variable_codes: list[str] | None = Query(default=None),
    max_archives: int | None = Query(default=None, ge=1, le=30),
    db: Session = Depends(get_db_session),
) -> EtlRunResponse:
    service = EtlService(db)
    try:
        run, selected_variables, max_archives_effective = service.create_remmaq_run(
            variable_codes=variable_codes,
            max_archives=max_archives,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    background_tasks.add_task(
        _run_remmaq_sync_background,
        run.id,
        selected_variables,
        max_archives_effective,
    )
    return _to_run_response(run)


@router.post("/upload", response_model=EtlRunResponse)
async def upload_manual_file(
    file: UploadFile = File(...),
    force_reprocess: bool = Query(default=False),
    db: Session = Depends(get_db_session),
) -> EtlRunResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".csv", ".xlsx", ".txt"}:
        raise HTTPException(status_code=400, detail="Carga manual solo soporta archivos CSV, XLSX o TXT.")

    content = await file.read()
    service = EtlService(db)
    try:
        run = service.ingest_manual_file(
            filename=file.filename or "manual-upload",
            content=content,
            force_reprocess=force_reprocess,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_run_response(run)


@router.post("/upload/start", response_model=EtlRunResponse)
async def start_upload_manual_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    force_reprocess: bool = Query(default=False),
    db: Session = Depends(get_db_session),
) -> EtlRunResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".csv", ".xlsx", ".txt"}:
        raise HTTPException(status_code=400, detail="Carga manual solo soporta archivos CSV, XLSX o TXT.")

    content = await file.read()
    service = EtlService(db)
    run = service.create_manual_run(filename=file.filename or "manual-upload")
    background_tasks.add_task(
        _run_manual_ingestion_background,
        run.id,
        file.filename or "manual-upload",
        content,
        force_reprocess,
    )
    return _to_run_response(run)


@router.get("/runs", response_model=list[EtlRunResponse])
def list_runs(
    limit: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db_session),
) -> list[EtlRunResponse]:
    service = EtlService(db)
    return [_to_run_response(run) for run in service.list_runs(limit=limit)]


@router.get("/runs/{run_id}", response_model=EtlRunResponse)
def get_run(run_id: str, db: Session = Depends(get_db_session)) -> EtlRunResponse:
    service = EtlService(db)
    run = service.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"No existe corrida ETL con id {run_id}.")
    return _to_run_response(run)


@router.get("/metrics", response_model=EtlMetricsResponse)
def get_metrics(db: Session = Depends(get_db_session)) -> EtlMetricsResponse:
    service = EtlService(db)
    return EtlMetricsResponse(**service.get_metrics())


@router.get("/preview", response_model=EtlPreviewResponse)
def get_preview(
    run_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db_session),
) -> EtlPreviewResponse:
    service = EtlService(db)
    payload = service.get_preview(run_id=run_id, limit=limit)
    return EtlPreviewResponse(**payload)
