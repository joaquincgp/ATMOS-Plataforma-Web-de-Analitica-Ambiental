from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db_session
from app.models.etl_run import EtlRun
from app.schemas.etl import DbInitResponse, EtlMetricsResponse, EtlRunResponse
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
    )


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


@router.get("/runs", response_model=list[EtlRunResponse])
def list_runs(
    limit: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db_session),
) -> list[EtlRunResponse]:
    service = EtlService(db)
    return [_to_run_response(run) for run in service.list_runs(limit=limit)]


@router.get("/metrics", response_model=EtlMetricsResponse)
def get_metrics(db: Session = Depends(get_db_session)) -> EtlMetricsResponse:
    service = EtlService(db)
    return EtlMetricsResponse(**service.get_metrics())
