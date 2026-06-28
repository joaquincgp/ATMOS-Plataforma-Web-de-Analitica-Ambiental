from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import ecuador_now_naive
from app.models.base import Base


class MLExperimentRun(Base):
    __tablename__ = "ml_experiment_runs"
    __table_args__ = (
        Index("ix_ml_experiment_runs_workspace_status", "workspace_id", "status"),
        Index("ix_ml_experiment_runs_status_created", "status", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)

    algorithm: Mapped[str] = mapped_column(String(32), index=True)
    target_variable_code: Mapped[str] = mapped_column(String(32))
    station_codes: Mapped[list[str]] = mapped_column(JSON, default=list)
    # When set, training reads exclusively from this ML-Experiments-owned
    # manual dataset (an isolated REMMAQ extraction) instead of the shared
    # measurement pool. No FK constraint: the source may be deleted later
    # while the run's record of having used it remains for history purposes.
    manual_dataset_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    date_from: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    date_to: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    epochs: Mapped[int] = mapped_column(Integer)
    learning_rate: Mapped[float] = mapped_column(Float)
    train_split: Mapped[float] = mapped_column(Float)

    status: Mapped[str] = mapped_column(String(16), index=True, default="pending")
    progress_epoch: Mapped[int] = mapped_column(Integer, default=0)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    claimed_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    loss_curve: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    rmse_curve: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    final_rmse: Mapped[float | None] = mapped_column(Float, nullable=True)
    final_rmse_ci_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    final_rmse_ci_high: Mapped[float | None] = mapped_column(Float, nullable=True)
    feature_importance: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    predictions: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    r_squared: Mapped[float | None] = mapped_column(Float, nullable=True)
    r_squared_ci_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    r_squared_ci_high: Mapped[float | None] = mapped_column(Float, nullable=True)
    dataset_stats: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=ecuador_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=ecuador_now_naive, onupdate=ecuador_now_naive)
