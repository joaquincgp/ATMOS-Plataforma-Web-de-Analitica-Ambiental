from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class DbInitResponse(BaseModel):
    status: str
    database: str
    timestamp: str


class EtlRunResponse(BaseModel):
    id: str
    trigger_type: str
    source: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    archives_discovered: int
    archives_processed: int
    records_inserted: int
    records_updated: int
    records_skipped: int
    details: dict[str, Any] = Field(default_factory=dict)


class EtlRunHistoryClearResponse(BaseModel):
    cleared: int


class EtlMetricsResponse(BaseModel):
    total_measurements: int
    total_stations: int
    total_variables: int
    latest_run_status: str


class EtlPreviewRowResponse(BaseModel):
    observed_at: datetime
    station_code: str
    variable_code: str
    value: float
    unit: str | None
    source_file_name: str


class EtlPreviewResponse(BaseModel):
    run_id: str | None
    rows: list[EtlPreviewRowResponse]


class ManualDatasetColumnProfile(BaseModel):
    name: str
    pandas_dtype: str
    inferred_kind: str
    null_count: int
    non_null_count: int
    unique_count: int
    sample_values: list[str] = Field(default_factory=list)


class ManualDatasetSummary(BaseModel):
    row_count: int
    column_count: int
    numeric_columns: list[str] = Field(default_factory=list)
    categorical_columns: list[str] = Field(default_factory=list)
    datetime_columns: list[str] = Field(default_factory=list)


class ManualDatasetRoleMapping(BaseModel):
    numeric_columns: list[str] = Field(default_factory=list)
    categorical_columns: list[str] = Field(default_factory=list)
    datetime_column: str | None = None
    date_column: str | None = None
    time_column: str | None = None
    station_code_column: str | None = None
    variable_code_column: str | None = None
    value_column: str | None = None
    unit_column: str | None = None
    normalized_datetime_column_name: str = "observed_at"


class ManualDatasetOperation(BaseModel):
    type: str
    columns: list[str] | None = None
    numeric_columns: list[str] | None = None
    categorical_columns: list[str] | None = None
    sample_pct: int | None = None
    id_vars: list[str] | None = None
    var_name: str | None = "variable"
    value_name: str | None = "value"
    date_column: str | None = None
    dayfirst: bool | None = True
    date_format: str | None = None
    fuzzy_parse: bool | None = True
    year_default: int | None = None


class ManualDatasetCreateFromUrlRequest(BaseModel):
    workspace_id: str
    source_url: str


class ManualDatasetCreateFromRemmaqRequest(BaseModel):
    workspace_id: str
    variable_codes: list[str] = Field(default_factory=list)
    max_archives: int | None = Field(default=None, ge=1, le=30)
    observed_from: date | None = None
    observed_to: date | None = None


class ManualDatasetUpdateRequest(BaseModel):
    operation_pipeline: list[ManualDatasetOperation] = Field(default_factory=list)
    mapping: ManualDatasetRoleMapping = Field(default_factory=ManualDatasetRoleMapping)


class ManualDatasetFinalizeRequest(BaseModel):
    operation_pipeline: list[ManualDatasetOperation] = Field(default_factory=list)
    mapping: ManualDatasetRoleMapping = Field(default_factory=ManualDatasetRoleMapping)
    dataset_name: str | None = None


class ManualDatasetResponse(BaseModel):
    id: str
    workspace_id: str
    owner_user_id: str
    name: str
    source_kind: str
    source_url: str | None
    original_file_name: str
    status: str
    dataset_kind: str | None
    storage_format: str
    row_count: int
    column_count: int
    operation_pipeline: list[ManualDatasetOperation] = Field(default_factory=list)
    mapping: ManualDatasetRoleMapping = Field(default_factory=ManualDatasetRoleMapping)
    summary: ManualDatasetSummary
    columns: list[ManualDatasetColumnProfile] = Field(default_factory=list)
    preview_rows: list[dict[str, Any]] = Field(default_factory=list)
    etl_run_id: str | None = None
    source_file_id: int | None = None
    created_at: datetime
    updated_at: datetime
    error_message: str | None = None
    created_for: str | None = None
    source_metadata: dict[str, Any] | None = None
