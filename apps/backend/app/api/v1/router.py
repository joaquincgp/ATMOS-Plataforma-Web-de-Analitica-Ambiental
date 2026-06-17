from fastapi import APIRouter

from app.api.v1.endpoints.advanced_analytics import router as advanced_analytics_router
from app.api.v1.endpoints.analytics import router as analytics_router
from app.api.v1.endpoints.app_config import router as app_config_router
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.eda import router as eda_router
from app.api.v1.endpoints.etl import router as etl_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.public import router as public_router
from app.api.v1.endpoints.stations import router as stations_router
from app.api.v1.endpoints.workspaces import router as workspaces_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(public_router, prefix="/public", tags=["public"])
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(stations_router, prefix="/stations", tags=["stations"])
api_router.include_router(etl_router, prefix="/etl", tags=["etl"])
api_router.include_router(analytics_router, prefix="/analytics", tags=["analytics"])
api_router.include_router(app_config_router, prefix="/config", tags=["config"])
api_router.include_router(eda_router, prefix="/eda", tags=["eda"])
api_router.include_router(advanced_analytics_router, prefix="/advanced-analytics", tags=["advanced-analytics"])
api_router.include_router(workspaces_router, prefix="/workspaces", tags=["workspaces"])
