from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.station import Station
from app.schemas.station import StationListResponse, StationSummary


def list_stations(db: Session) -> StationListResponse:
    stations = db.scalars(select(Station).order_by(Station.code.asc())).all()
    items = [
        StationSummary(
            id=station.id,
            code=station.code,
            name=station.name,
            latitude=station.latitude or 0.0,
            longitude=station.longitude or 0.0,
            is_active=station.is_active,
        )
        for station in stations
    ]
    return StationListResponse(items=items, total=len(items))
