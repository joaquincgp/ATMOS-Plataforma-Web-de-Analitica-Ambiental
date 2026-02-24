from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db_session
from app.schemas.station import StationListResponse
from app.services.station_service import list_stations

router = APIRouter()


@router.get("/", response_model=StationListResponse)
def get_stations(db: Session = Depends(get_db_session)) -> StationListResponse:
    return list_stations(db)
