import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from app.api.router import api_router
from app.core.config import get_settings
from app.db.init_db import init_db
from app.services.ml_experiments.worker import ml_job_worker_loop, reset_orphaned_jobs

settings = get_settings()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    if settings.auto_init_db_on_startup:
        try:
            init_db()
        except OperationalError:
            logger.warning("Database auto-initialization skipped because PostgreSQL is unavailable at startup.")

    try:
        reset_orphaned_jobs()
    except OperationalError:
        logger.warning("Orphaned ML job reconciliation skipped because PostgreSQL is unavailable at startup.")

    worker_task = asyncio.create_task(ml_job_worker_loop())
    try:
        yield
    finally:
        worker_task.cancel()
        try:
            await worker_task
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
