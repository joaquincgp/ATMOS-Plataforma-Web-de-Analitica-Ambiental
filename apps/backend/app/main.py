import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from app.api.router import api_router
from app.core.config import get_settings
from app.db.init_db import init_db
from app.services.ml_experiments.worker import ml_job_worker_loop, reset_orphaned_jobs

settings = get_settings()
logger = logging.getLogger(__name__)


async def _public_snapshot_refresh_loop() -> None:
    """Keeps the public dashboard snapshot cache always warm.

    Runs once at startup (after a short delay for DB init to settle) and then
    every 4 minutes, just before the 5-minute cache TTL expires. This means
    every user request hits a pre-built snapshot and never pays the cold-build
    cost of 30-50 synchronous DB queries.

    Defers the rebuild whenever ML training or a REMMAQ source sync is active
    so the two CPU/memory-intensive workloads never compete.
    """
    await asyncio.sleep(3)
    loop = asyncio.get_running_loop()
    while True:
        try:
            from app.db.session import SessionLocal
            from app.models.manual_dataset import ManualDataset
            from app.models.ml_experiment_run import MLExperimentRun
            from app.services.public_air_quality_service import get_public_air_quality_snapshot
            from sqlalchemy import select

            def _is_ml_busy() -> bool:
                db = SessionLocal()
                try:
                    has_active_run = db.execute(
                        select(MLExperimentRun.id)
                        .where(MLExperimentRun.status.in_(["pending", "running"]))
                        .limit(1)
                    ).scalar_one_or_none() is not None
                    has_active_sync = db.execute(
                        select(ManualDataset.id)
                        .where(
                            ManualDataset.status == "syncing",
                            ManualDataset.created_for == "ml_experiments",
                        )
                        .limit(1)
                    ).scalar_one_or_none() is not None
                    return has_active_run or has_active_sync
                finally:
                    db.close()

            def _build() -> None:
                db = SessionLocal()
                try:
                    get_public_air_quality_snapshot(db, use_cache=False)
                finally:
                    db.close()

            busy = await loop.run_in_executor(None, _is_ml_busy)
            if busy:
                logger.debug("Snapshot refresh deferred: ML training or source sync in progress.")
            else:
                await loop.run_in_executor(None, _build)
                logger.info("Public dashboard snapshot refreshed.")
        except Exception:
            logger.warning("Public dashboard snapshot refresh failed (non-fatal).", exc_info=True)
        await asyncio.sleep(240)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    if settings.auto_init_db_on_startup:
        try:
            init_db()
        except SQLAlchemyError:
            logger.warning("Database auto-initialization skipped due to a database error at startup.", exc_info=True)

    try:
        reset_orphaned_jobs()
    except SQLAlchemyError:
        logger.warning("Orphaned ML job reconciliation skipped due to a database error at startup.", exc_info=True)

    worker_task = asyncio.create_task(ml_job_worker_loop())
    snapshot_task = asyncio.create_task(_public_snapshot_refresh_loop())
    try:
        yield
    finally:
        worker_task.cancel()
        snapshot_task.cancel()
        for task in (worker_task, snapshot_task):
            try:
                await task
            except asyncio.CancelledError:
                pass


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="ATMOS backend API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.exception_handler(OperationalError)
async def handle_database_operational_error(
    _request: Request,
    _exc: OperationalError,
) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database connection unavailable. Verify PostgreSQL is running and DATABASE_URL is correct.",
        },
    )
