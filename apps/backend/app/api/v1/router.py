from fastapi import APIRouter

from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.etl import router as etl_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.stations import router as stations_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(stations_router, prefix="/stations", tags=["stations"])
api_router.include_router(etl_router, prefix="/etl", tags=["etl"])
