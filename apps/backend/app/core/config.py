from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "ATMOS API"
    environment: str = "development"
    api_v1_prefix: str = "/api/v1"
    cors_origins: list[str] = ["http://localhost:5173"]

    database_url: str = "postgresql+psycopg://atmos:atmos_dev_password@localhost:5432/atmos"

    jwt_secret_key: str = "change-this-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    remmaq_base_url: str = "https://datosambiente.quito.gob.ec/"
    etl_storage_dir: str = "./data/etl"
    etl_request_timeout_seconds: int = 60
    etl_discovery_max_pages: int = 20
    etl_user_agent: str = "ATMOS-ETL/1.0 (+https://udla.edu.ec)"
    etl_row_chunk_size: int = 10_000
    etl_sync_default_max_archives: int = 4
    auto_init_db_on_startup: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
