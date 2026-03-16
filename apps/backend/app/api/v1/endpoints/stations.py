from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db_session, require_roles
from app.schemas.auth import UserRole
from app.schemas.station import StationListResponse
from app.services.station_service import list_stations

router = APIRouter(dependencies=[Depends(require_roles(UserRole.admin, UserRole.researcher))])


@router.get("/", response_model=StationListResponse)
def get_stations(db: Session = Depends(get_db_session)) -> StationListResponse:
    return list_stations(db)
