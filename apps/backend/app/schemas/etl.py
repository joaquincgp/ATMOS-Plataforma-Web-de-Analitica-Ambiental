from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


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
