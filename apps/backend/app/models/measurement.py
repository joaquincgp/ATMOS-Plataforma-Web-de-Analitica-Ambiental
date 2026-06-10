from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Measurement(Base):
    __tablename__ = "measurements"
    __table_args__ = (
        UniqueConstraint("station_id", "variable_id", "observed_at", name="uq_measurement_station_variable_time"),
        Index("ix_measurements_variable_observed", "variable_id", "observed_at"),
        Index("ix_measurements_source_observed", "source_file_id", "observed_at"),
        Index("ix_measurements_station_source_observed", "station_id", "source_file_id", "observed_at"),
        Index("ix_measurements_created_at", "created_at"),
        Index("ix_measurements_updated_at", "updated_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"), index=True)
    variable_id: Mapped[int] = mapped_column(ForeignKey("variables.id"), index=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_file_id: Mapped[int] = mapped_column(ForeignKey("source_files.id"), index=True)
    record_hash: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
