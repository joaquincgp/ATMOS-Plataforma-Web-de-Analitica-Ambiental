from app.core.config import get_settings
from app.schemas.health import HealthResponse


settings = get_settings()


def get_health_status() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="atmos-api",
        version="0.1.0",
        environment=settings.environment,
    )
