from functools import lru_cache
import json

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

    remmaq_base_url: str = "https://datosambiente.quito.gob.ec/"
    etl_storage_dir: str = "./data/etl"
    workspace_storage_dir: str = "./data/workspaces"
    etl_request_timeout_seconds: int = 60
    etl_discovery_max_pages: int = 20
    etl_user_agent: str = "ATMOS-ETL/1.0 (+https://udla.edu.ec)"
    etl_row_chunk_size: int = 2_000
    etl_lookup_chunk_size: int = 500
    etl_sync_default_max_archives: int = 4
    auto_init_db_on_startup: bool = True

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
