from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import ecuador_now_naive
from app.models.base import Base

# Valores válidos para data_origin:
#   "user"   → medición insertada por sincronización REMMAQ del usuario o carga manual.
#   "public" → medición insertada por el pipeline del dashboard público
#              (public_air_quality_service / remmaq_current).
# La separación evita que ambos flujos se sobreescriban mutuamente, ya que la
# UniqueConstraint ahora incluye data_origin como parte de la clave natural.
DATA_ORIGIN_USER = "user"
DATA_ORIGIN_PUBLIC = "public"


class Measurement(Base):
    __tablename__ = "measurements"
    __table_args__ = (
        # Constraint actualizada: permite coexistir la misma lectura con distinto origen.
        UniqueConstraint(
            "station_id",
            "variable_id",
            "observed_at",
            "data_origin",
            name="uq_measurement_station_variable_time_origin",
        ),
        Index("ix_measurements_variable_observed", "variable_id", "observed_at"),
        Index("ix_measurements_source_observed", "source_file_id", "observed_at"),
        Index("ix_measurements_station_source_observed", "station_id", "source_file_id", "observed_at"),
        Index("ix_measurements_created_at", "created_at"),
        Index("ix_measurements_updated_at", "updated_at"),
        Index("ix_measurements_data_origin", "data_origin"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"), index=True)
    variable_id: Mapped[int] = mapped_column(ForeignKey("variables.id"), index=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_file_id: Mapped[int] = mapped_column(ForeignKey("source_files.id"), index=True)
    record_hash: Mapped[str] = mapped_column(String(64), index=True)
    # Discriminador de origen: "user" (defecto) o "public".
    # El índice está declarado en __table_args__ como ix_measurements_data_origin.
    data_origin: Mapped[str] = mapped_column(String(16), nullable=False, default=DATA_ORIGIN_USER)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=ecuador_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=ecuador_now_naive, onupdate=ecuador_now_naive)
