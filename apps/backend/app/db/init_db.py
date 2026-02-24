from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import engine
from app.models.base import Base
from app import models  # noqa: F401


def init_db() -> None:
    """Initialize the relational schema from SQLAlchemy models."""
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    except SQLAlchemyError:
        # Non-PostgreSQL engines won't support extension creation.
        pass
    Base.metadata.create_all(bind=engine)
