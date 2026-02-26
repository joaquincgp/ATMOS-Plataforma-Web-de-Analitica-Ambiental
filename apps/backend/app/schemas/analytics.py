from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class AnalyticsSourceOption(BaseModel):
    id: int
    name: str
    source_type: str
    etl_run_id: str
    downloaded_at: datetime | None
    row_count: int


class AnalyticsStationOption(BaseModel):
    code: str
    name: str


class AnalyticsVariableOption(BaseModel):
    code: str
    name: str


class AnalyticsFilterOptionsResponse(BaseModel):
    sources: list[AnalyticsSourceOption]
    stations: list[AnalyticsStationOption]
    variables: list[AnalyticsVariableOption]
    min_observed_at: datetime | None
    max_observed_at: datetime | None


class AnalyticsQueryRequest(BaseModel):
    source_file_ids: list[int] = Field(default_factory=list)
    station_codes: list[str] = Field(default_factory=list)
    variable_codes: list[str] = Field(default_factory=list)
    date_from: date | None = None
    date_to: date | None = None
    limit: int = Field(default=5000, ge=100, le=20000)


class AnalyticsDataRowResponse(BaseModel):
    observed_at: datetime
    station_code: str
    station_name: str
    variable_code: str
    variable_name: str
    value: float
    unit: str | None
    source_file_id: int
    source_file_name: str
    source_type: str


class AnalyticsQueryResponse(BaseModel):
    rows: list[AnalyticsDataRowResponse]
    row_count: int
    truncated: bool


class SqlPreviewRequest(BaseModel):
    sql: str
    limit: int = Field(default=120, ge=1, le=500)


class SqlPreviewResponse(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    truncated: bool
