from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(slots=True)
class NormalizedMeasurementRow:
    station_code: str
    observed_at: datetime
    variable_code: str
    value: float
    unit: str | None
    source_sheet: str
    source_row_number: int
    source_workbook: str
