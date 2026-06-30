import json
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "ATMOS API"
    environment: str = "development"
    api_v1_prefix: str = "/api/v1"
    # Stored as a string to avoid pydantic-settings JSON-parsing errors on plain
    # URL env vars.  Use .cors_origins_list to get the parsed list.
    cors_origins: str = (
        "http://localhost:5173,"
        "http://127.0.0.1:5173,"
        "http://localhost:5174,"
        "http://127.0.0.1:5174,"
        "http://localhost:4173,"
        "http://127.0.0.1:4173"
    )

    database_url: str = "postgresql+psycopg://atmos:atmos_dev_password@localhost:5432/atmos"

    jwt_secret_key: str = "change-this-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 14
    password_reset_token_expire_minutes: int = 30
    email_verification_token_expire_minutes: int = 60 * 24
    allowed_email_domains: str = "udla.edu.ec"

    frontend_base_url: str = "http://localhost:5173"
    backend_base_url: str = "http://localhost:8000"

    email_provider: str = "log"
    acs_email_connection_string: str = ""
    acs_email_sender_address: str = ""
    email_from_name: str = "ATMOS"
    email_atmos_logo_url: str = ""
    email_udla_logo_url: str = ""

    remmaq_base_url: str = "https://datosambiente.quito.gob.ec/"
    remmaq_proxy_base_url: str = ""
    etl_storage_dir: str = "./data/etl"
    workspace_storage_dir: str = "./data/workspaces"
    etl_request_timeout_seconds: int = 60
    etl_discovery_max_pages: int = 20
    etl_user_agent: str = "ATMOS-ETL/1.0 (+https://udla.edu.ec)"
    etl_row_chunk_size: int = 2_000
    etl_lookup_chunk_size: int = 500
    etl_sync_default_max_archives: int = 4
    auto_init_db_on_startup: bool = True

    model_config = SettingsConfigDict(
        env_file=("../../.env", ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @staticmethod
    def parse_cors_origins(value: str | list[str]) -> list[str]:
        """Parse CORS origins from a JSON array string or a comma-separated string."""
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]
            except (json.JSONDecodeError, ValueError):
                pass
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def cors_origins_list(self) -> list[str]:
        return self.parse_cors_origins(self.cors_origins)

    @property
    def allowed_email_domains_list(self) -> list[str]:
        return [
            domain.strip().lower().lstrip("@")
            for domain in self.allowed_email_domains.split(",")
            if domain.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
