from fastapi import FastAPI
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import OperationalError

from app.api.router import api_router
from app.core.config import get_settings
from app.db.init_db import init_db

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="ATMOS backend API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


if settings.auto_init_db_on_startup:
    init_db()


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
