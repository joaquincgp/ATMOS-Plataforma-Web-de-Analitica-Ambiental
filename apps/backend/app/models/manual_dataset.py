from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ManualDataset(Base):
    __tablename__ = "manual_datasets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    source_kind: Mapped[str] = mapped_column(String(32), index=True)
    source_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    original_file_name: Mapped[str] = mapped_column(String(512))
    raw_file_path: Mapped[str] = mapped_column(Text)
    processed_file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    checksum_sha256: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True, default="draft")
    storage_format: Mapped[str] = mapped_column(String(16), default="csv")
    dataset_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    column_count: Mapped[int] = mapped_column(Integer, default=0)
    operation_pipeline: Mapped[list[dict]] = mapped_column(JSON, default=list)
    column_schema: Mapped[list[dict]] = mapped_column(JSON, default=list)
    mapping_config: Mapped[dict] = mapped_column(JSON, default=dict)
    preview_rows: Mapped[list[dict]] = mapped_column(JSON, default=list)
    profile_summary: Mapped[dict] = mapped_column(JSON, default=dict)
    etl_run_id: Mapped[str | None] = mapped_column(ForeignKey("etl_runs.id"), nullable=True, index=True)
    source_file_id: Mapped[int | None] = mapped_column(ForeignKey("source_files.id"), nullable=True, index=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
