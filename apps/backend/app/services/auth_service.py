from app.core.config import get_settings
from app.schemas.auth import TokenResponse


settings = get_settings()


def login_user() -> TokenResponse:
    return TokenResponse(
        access_token="dev-token-replace-with-jwt",
        expires_in=settings.access_token_expire_minutes * 60,
    )
