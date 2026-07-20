from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

MLAlgorithm = Literal["lstm", "gru", "transformer"]
MLTargetVariable = Literal["PM25", "PM10", "NO2", "O3"]
MLRunStatus = Literal["pending", "running", "completed", "failed"]

_MIN_TRAIN_SPLIT = 0.5
_MAX_TRAIN_SPLIT = 0.95


class MLExperimentRunRequest(BaseModel):
    workspace_id: str
    algorithm: MLAlgorithm = "lstm"
    target_variable: MLTargetVariable
    station_codes: list[str] = Field(default_factory=list)
    date_from: date | None = None
    date_to: date | None = None
    # When set, training reads exclusively from this ML-Experiments-owned
    # source (see MLExperimentSourceResponse) instead of the shared REMMAQ
    # measurement pool. station_codes/date_from/date_to still apply on top,
    # scoped within that source's own data.
    manual_dataset_id: str | None = None
    epochs: int = Field(default=50, ge=1, le=100)
    learning_rate: float = Field(default=0.01, gt=0, le=1)
    train_split: float = Field(default=0.8)

    @field_validator("train_split")
    @classmethod
    def validate_train_split(cls, value: float) -> float:
        if not _MIN_TRAIN_SPLIT <= value <= _MAX_TRAIN_SPLIT:
            raise ValueError("train_split must be between 0.5 and 0.95.")
        return value


class MLAlgorithmsResponse(BaseModel):
    algorithms: list[str]


class MLModelSourceFile(BaseModel):
    key: str
    filename: str
    label: str
    content: str


class MLModelSourcesResponse(BaseModel):
    files: list[MLModelSourceFile]


class MLExperimentSourceSyncRequest(BaseModel):
    workspace_id: str
    target_variable_code: MLTargetVariable
    date_from: date | None = None
    date_to: date | None = None


class MLExperimentSourceRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        cleaned_name = " ".join(value.split()).strip()
        if not cleaned_name:
            raise ValueError("El nombre de la fuente no puede estar vacío.")
        return cleaned_name


class MLExperimentSourceResponse(BaseModel):
    id: str
    name: str
    status: str
    row_count: int
    created_at: datetime
    updated_at: datetime
    error_message: str | None = None
    source_metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = {"from_attributes": True}

    @field_validator("source_metadata", mode="before")
    @classmethod
    def default_null_metadata_to_empty(cls, value: Any) -> Any:
        return {} if value is None else value


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
    manual_dataset_id: str | None = None
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
    # 95% bootstrap confidence intervals for final_rmse / r_squared.
    final_rmse_ci_low: float | None = None
    final_rmse_ci_high: float | None = None
    r_squared_ci_low: float | None = None
    r_squared_ci_high: float | None = None

    @field_validator("loss_curve", "rmse_curve", "feature_importance", "predictions", mode="before")
    @classmethod
    def default_null_lists_to_empty(cls, value: Any) -> Any:
        return [] if value is None else value

    @field_validator("dataset_stats", mode="before")
    @classmethod
    def default_null_dataset_stats_to_empty(cls, value: Any) -> Any:
        return {} if value is None else value
