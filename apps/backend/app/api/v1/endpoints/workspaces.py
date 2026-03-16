from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db_session, require_roles
from app.models.user import User
from app.schemas.auth import UserRole
from app.schemas.workspace import DashboardResponse, DashboardSaveRequest, WorkspaceCreateRequest, WorkspaceResponse
from app.services.workspace_service import (
    WorkspaceError,
    create_workspace,
    get_workspace,
    list_dashboards,
    list_workspaces,
    save_dashboard,
)

router = APIRouter()


@router.get("/", response_model=list[WorkspaceResponse])
def get_user_workspaces(
    db: Session = Depends(get_db_session),
    user: User = Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> list[WorkspaceResponse]:
    return list_workspaces(db, user)


@router.post("/", response_model=WorkspaceResponse, status_code=status.HTTP_201_CREATED)
def create_user_workspace(
    payload: WorkspaceCreateRequest,
    db: Session = Depends(get_db_session),
    user: User = Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> WorkspaceResponse:
    try:
        return create_workspace(db, user, payload)
    except WorkspaceError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/{workspace_id}", response_model=WorkspaceResponse)
def get_workspace_details(
    workspace_id: str,
    db: Session = Depends(get_db_session),
    user: User = Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> WorkspaceResponse:
    try:
        return get_workspace(db, user, workspace_id)
    except WorkspaceError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/{workspace_id}/dashboards", response_model=list[DashboardResponse])
def get_workspace_dashboards(
    workspace_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db_session),
    user: User = Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> list[DashboardResponse]:
    try:
        return list_dashboards(db, user, workspace_id, limit=limit)
    except WorkspaceError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{workspace_id}/dashboards", response_model=DashboardResponse)
def save_workspace_dashboard(
    workspace_id: str,
    payload: DashboardSaveRequest,
    db: Session = Depends(get_db_session),
    user: User = Depends(require_roles(UserRole.admin, UserRole.researcher)),
) -> DashboardResponse:
    try:
        return save_dashboard(db, user, workspace_id, payload)
    except WorkspaceError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
