from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SourceFile(Base):
    __tablename__ = "source_files"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    etl_run_id: Mapped[str] = mapped_column(String(36), ForeignKey("etl_runs.id"), index=True)
    source_type: Mapped[str] = mapped_column(String(32), index=True)
    source_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    original_name: Mapped[str] = mapped_column(String(512))
    local_archive_path: Mapped[str] = mapped_column(String(2048))
    extracted_path: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    checksum_sha256: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    downloaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
