from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class PublicAirQualityVariableOption(BaseModel):
    code: str
    name: str
    category: str
    unit: str | None = None


class PublicStationVariableObservation(BaseModel):
    variable_code: str
    variable_name: str
    category: str
    value: float
    unit: str | None = None
    observed_at: datetime


class PublicStationObservation(BaseModel):
    station_code: str
    station_name: str
    latitude: float
    longitude: float
    region: str | None = None
    latest_value: float
    mean_value: float
    min_value: float
    max_value: float
    sample_count: int
    unit: str | None = None
    latest_observed_at: datetime
    variables: list[PublicStationVariableObservation] = Field(default_factory=list)


class PublicTimeSeriesPoint(BaseModel):
    timestamp: datetime
    mean_value: float
    min_value: float
    max_value: float
    sample_count: int


class PublicMeteorologySummary(BaseModel):
    variable_code: str
    variable_name: str
    unit: str | None = None
    mean_value: float | None = None
    latest_value: float | None = None
    latest_observed_at: datetime | None = None
    sample_count: int = 0


class PublicVariableSummary(BaseModel):
    variable_code: str
    variable_name: str
    category: str
    unit: str | None = None
    mean_value: float | None = None
    min_value: float | None = None
    max_value: float | None = None
    latest_value: float | None = None
    latest_observed_at: datetime | None = None
    first_available_at: datetime | None = None
    latest_available_at: datetime | None = None
    latest_ingested_at: datetime | None = None
    total_sample_count: int = 0
    today_sample_count: int = 0
    sample_count: int = 0
    station_count: int = 0


class PublicSyncSummary(BaseModel):
    status: str = "unknown"
    latest_run_started_at: datetime | None = None
    latest_run_finished_at: datetime | None = None
    latest_source_downloaded_at: datetime | None = None
    latest_source_processed_at: datetime | None = None
    records_today: int = 0
    records_inserted: int = 0
    records_updated: int = 0
    records_skipped: int = 0
    archives_processed: int = 0


class PublicPeriodSummary(BaseModel):
    max_value: float | None = None
    avg_value: float | None = None
    rds: int = 0
    sample_count: int = 0
    station_count: int = 0
    unit: str | None = None
    date_from: datetime | None = None
    date_to: datetime | None = None


class PublicAirQualityResponse(BaseModel):
    variable_code: str
    variable_name: str
    unit: str | None = None
    date_from: datetime | None = None
    date_to: datetime | None = None
    generated_at: datetime
    latest_observed_at: datetime | None = None
    latest_ingested_at: datetime | None = None
    today_observation_count: int = 0
    station_count: int
    observation_count: int
    variables: list[PublicAirQualityVariableOption] = Field(default_factory=list)
    stations: list[PublicStationObservation] = Field(default_factory=list)
    time_series: list[PublicTimeSeriesPoint] = Field(default_factory=list)
    meteorology: list[PublicMeteorologySummary] = Field(default_factory=list)
    variable_summaries: list[PublicVariableSummary] = Field(default_factory=list)
    period_summary: PublicPeriodSummary = Field(default_factory=PublicPeriodSummary)
    sync: PublicSyncSummary = Field(default_factory=PublicSyncSummary)
    methodology_notes: list[str] = Field(default_factory=list)
