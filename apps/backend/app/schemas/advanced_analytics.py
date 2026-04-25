from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.eda import TimeGranularity

AdvancedModel = Literal["arima", "sarima", "prophet"]


class AdvancedAnalyticsRequest(BaseModel):
    source_file_ids: list[int] = Field(default_factory=list)
    manual_dataset_id: str | None = None
    station_codes: list[str] = Field(default_factory=list)
    variable_codes: list[str] = Field(default_factory=list)
    date_from: date | None = None
    date_to: date | None = None
    view_from: datetime | None = None
    view_to: datetime | None = None
    granularity: TimeGranularity = "day"
    x_axis: str | None = None
    y_axis: str | None = None
    model: AdvancedModel = "arima"
    horizon: int = Field(default=30, ge=1, le=365)
    order: list[int] = Field(default_factory=lambda: [1, 1, 1], min_length=3, max_length=3)
    seasonal_order: list[int] | None = Field(default=None, min_length=4, max_length=4)


class AdvancedAnalyticsResponse(BaseModel):
    figure_json: dict[str, Any]
    stats: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
