from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

EdaSection = Literal[
    "rolling",
    "anomaly",
    "profiles",
    "seasonality",
    "decomposition",
    "autocorr",
    "pacf",
    "forecast",
    "changepoints",
    "trend",
    "correlation",
    "summary",
]
TimeGranularity = Literal["hour", "day", "week", "month", "quarter", "year"]
TimeAggregationMode = Literal["mean", "sum"]
EdaChartType = Literal[
    "line",
    "bar",
    "scatter",
    "heatmap",
    "histogram",
    "kde",
    "box",
    "violin",
    "regression",
    "pairplot",
    "missing",
    "ridge",
]
AggregationMode = Literal["mean", "median", "sum", "min", "max", "std"]
ProfileMode = Literal["hour", "weekday", "month", "quarter", "year"]
HeatmapProfileMode = Literal["month", "hour", "weekday", "week"]


class EdaSecondaryFigure(BaseModel):
    key: str
    title: str
    description: str | None = None
    figure_json: dict[str, Any]


class EdaPlotRequest(BaseModel):
    section: EdaSection
    source_file_ids: list[int] = Field(default_factory=list)
    manual_dataset_id: str | None = None
    station_codes: list[str] = Field(default_factory=list)
    variable_codes: list[str] = Field(default_factory=list)
    date_from: date | None = None
    date_to: date | None = None
    view_from: datetime | None = None
    view_to: datetime | None = None
    limit: int = Field(default=50000, ge=1, le=500000)
    granularity: TimeGranularity = "day"
    chart_type: EdaChartType | None = None
    rolling_window: int = Field(default=0, ge=0, le=120)
    time_aggregation: TimeAggregationMode = "mean"
    decomposition_window: int = Field(default=21, ge=2, le=120)
    forecast_horizon: int = Field(default=30, ge=1, le=365)
    changepoint_window: int = Field(default=7, ge=2, le=30)
    changepoint_sensitivity: float = Field(default=2.0, ge=0.5, le=6.0)
    profile_mode: ProfileMode = "hour"
    profile_aggregation: AggregationMode = "mean"
    profile_heatmap_mode: HeatmapProfileMode = "month"
    trend_deseasonalized: bool = False
    pair_variable_x: str | None = None
    pair_variable_y: str | None = None
    x_axis: str | None = None
    y_axis: str | None = None
    hue: str | None = None
    facet_row: str | None = None
    facet_col: str | None = None
    category_order: list[str] = Field(default_factory=list)
    time_is_here: bool = False
    show_std_band: bool = False
    cumulative: bool = False
    normalize_density: bool = False
    swarm_overlay: bool = False


class EdaPlotResponse(BaseModel):
    figure_json: dict[str, Any]
    secondary_figures: list[EdaSecondaryFigure] = Field(default_factory=list)
    stats: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
