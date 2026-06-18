from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

MLAlgorithm = Literal["lstm", "gru", "timesfm", "chronos", "moirai"]
MLTargetVariable = Literal["PM25", "PM10", "NO2", "O3"]
MLRunStatus = Literal["pending", "running", "completed", "failed"]

_VALID_TRAIN_SPLITS = (0.7, 0.8, 0.9)


class MLExperimentRunRequest(BaseModel):
    workspace_id: str
    algorithm: MLAlgorithm = "lstm"
    target_variable: MLTargetVariable
    station_codes: list[str] = Field(default_factory=list)
    date_from: date | None = None
    date_to: date | None = None
    epochs: int = Field(default=50, ge=1, le=100)
    learning_rate: float = Field(default=0.01, gt=0, le=1)
    train_split: float = Field(default=0.8)

    @field_validator("train_split")
    @classmethod
    def validate_train_split(cls, value: float) -> float:
        if not any(abs(value - candidate) < 1e-9 for candidate in _VALID_TRAIN_SPLITS):
            raise ValueError("train_split must be one of 0.7, 0.8, or 0.9.")
        return value


class MLLossPoint(BaseModel):
    epoch: int
    train_loss: float
    val_loss: float


class MLRmsePoint(BaseModel):
    epoch: int
    rmse: float


class MLFeatureImportance(BaseModel):
    feature: str
    importance: float


class MLPredictionPoint(BaseModel):
    actual: float
    predicted: float


class MLExperimentRunSummary(BaseModel):
    id: str
    algorithm: str
    target_variable: str = Field(validation_alias="target_variable_code")
    status: MLRunStatus
    epochs: int
    learning_rate: float
    train_split: float
    final_rmse: float | None = None
    r_squared: float | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error_message: str | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class MLExperimentRunDetail(MLExperimentRunSummary):
    progress_epoch: int = 0
    loss_curve: list[MLLossPoint] = Field(default_factory=list)
    rmse_curve: list[MLRmsePoint] = Field(default_factory=list)
    feature_importance: list[MLFeatureImportance] = Field(default_factory=list)
    predictions: list[MLPredictionPoint] = Field(default_factory=list)
    dataset_stats: dict[str, Any] = Field(default_factory=dict)

    @field_validator("loss_curve", "rmse_curve", "feature_importance", "predictions", mode="before")
    @classmethod
    def default_null_lists_to_empty(cls, value: Any) -> Any:
        return [] if value is None else value

    @field_validator("dataset_stats", mode="before")
    @classmethod
    def default_null_dataset_stats_to_empty(cls, value: Any) -> Any:
        return {} if value is None else value
