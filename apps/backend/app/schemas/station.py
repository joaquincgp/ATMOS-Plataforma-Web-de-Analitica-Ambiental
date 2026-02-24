from pydantic import BaseModel


class StationSummary(BaseModel):
    id: int
    code: str
    name: str
    latitude: float
    longitude: float
    is_active: bool


class StationListResponse(BaseModel):
    items: list[StationSummary]
    total: int
