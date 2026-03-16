from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import re
import shutil
import uuid

from sqlalchemy import asc, desc, func, select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.auth import UserRole
from app.schemas.workspace import (
    DashboardResponse,
    DashboardSaveRequest,
    WorkspaceCreateRequest,
    WorkspaceResponse,
    WorkspaceUpdateRequest,
)

settings = get_settings()
SLUG_PATTERN = re.compile(r"[^a-z0-9]+")
IDENTIFIER_PATTERN = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


class WorkspaceError(Exception):
    pass


def _workspace_to_response(workspace: Workspace) -> WorkspaceResponse:
    return WorkspaceResponse.model_validate(workspace)


def _slugify(value: str) -> str:
    lowered = value.strip().lower()
    lowered = SLUG_PATTERN.sub("-", lowered).strip("-")
    return lowered or "workspace"


def _clean_workspace_name(value: str) -> str:
    return " ".join(value.strip().split())


def _sanitize_identifier(value: str) -> str:
    token = re.sub(r"[^a-z0-9_]", "_", value.lower())
    token = re.sub(r"_+", "_", token).strip("_")
    if not token:
        token = "tenant"
    if token[0].isdigit():
        token = f"t_{token}"
    return token[:63]


def _quote_identifier(identifier: str) -> str:
    if not IDENTIFIER_PATTERN.match(identifier):
        raise WorkspaceError("Invalid workspace schema identifier.")
    return f'"{identifier}"'


def _generate_unique_workspace_slug(db: Session, base_slug: str) -> str:
    candidate = base_slug[:120]
    attempt = 1
    while True:
        exists = db.scalar(select(Workspace.id).where(Workspace.slug == candidate))
        if exists is None:
            return candidate
        attempt += 1
        suffix = f"-{attempt}"
        candidate = f"{base_slug[: max(1, 120 - len(suffix))]}{suffix}"


def _generate_schema_name(user_id: str, slug: str) -> str:
    user_token = _sanitize_identifier(user_id.replace("-", ""))[:10]
    slug_token = _sanitize_identifier(slug)[:36]
    schema_name = _sanitize_identifier(f"ws_{user_token}_{slug_token}")
    if not IDENTIFIER_PATTERN.match(schema_name):
        raise WorkspaceError("Could not derive a safe schema name.")
    return schema_name


def _ensure_storage_dirs(storage_path: Path) -> None:
    storage_path.mkdir(parents=True, exist_ok=True)
    for folder in ("dashboards", "datasets", "models", "exports", "artifacts"):
        (storage_path / folder).mkdir(parents=True, exist_ok=True)


def _create_workspace_schema(db: Session, schema_name: str) -> None:
    quoted_schema = _quote_identifier(schema_name)
    db.execute(text(f"CREATE SCHEMA IF NOT EXISTS {quoted_schema}"))
    db.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS {quoted_schema}.dashboards (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT NULL,
                blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
                filters JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                created_by VARCHAR(36) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS {quoted_schema}.ml_artifacts (
                id VARCHAR(36) PRIMARY KEY,
                artifact_type VARCHAR(64) NOT NULL,
                artifact_name VARCHAR(255) NOT NULL,
                storage_path TEXT NOT NULL,
                metadata JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                created_by VARCHAR(36) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )
    )


def _assert_workspace_access(user: User, workspace: Workspace) -> None:
    if user.role == UserRole.admin.value:
        return
    if workspace.owner_user_id != user.id:
        raise WorkspaceError("You do not have access to this workspace.")


def _get_workspace_entity(db: Session, workspace_id: str) -> Workspace:
    workspace = db.scalar(
        select(Workspace).where(Workspace.id == workspace_id, Workspace.is_active.is_(True))
    )
    if workspace is None:
        raise WorkspaceError("Workspace not found.")
    return workspace


def _validate_workspace_name_uniqueness(
    db: Session,
    *,
    user_id: str,
    workspace_name: str,
    exclude_workspace_id: str | None = None,
) -> None:
    normalized_name = _clean_workspace_name(workspace_name).lower()
    statement = (
        select(Workspace.id)
        .where(
            Workspace.owner_user_id == user_id,
            Workspace.is_active.is_(True),
            func.lower(Workspace.name) == normalized_name,
        )
        .limit(1)
    )
    existing_id = db.scalar(statement)
    if existing_id is None:
        return
    if exclude_workspace_id is not None and str(existing_id) == exclude_workspace_id:
        return
    raise WorkspaceError("A workspace with this name already exists.")


def create_workspace(db: Session, user: User, payload: WorkspaceCreateRequest) -> WorkspaceResponse:
    if user.role not in {UserRole.admin.value, UserRole.researcher.value}:
        raise WorkspaceError("Only admin or researcher users can create workspaces.")

    cleaned_name = _clean_workspace_name(payload.name)
    _validate_workspace_name_uniqueness(db, user_id=user.id, workspace_name=cleaned_name)

    base_slug = _slugify(cleaned_name)
    slug = _generate_unique_workspace_slug(db, base_slug)
    schema_name = _generate_schema_name(user.id, slug)

    storage_root = Path(settings.workspace_storage_dir)
    storage_path = storage_root / user.id / slug
    _ensure_storage_dirs(storage_path)

    workspace = Workspace(
        owner_user_id=user.id,
        name=cleaned_name,
        slug=slug,
        schema_name=schema_name,
        storage_path=str(storage_path.resolve()),
        description=payload.description,
        is_active=True,
    )
    db.add(workspace)
    db.flush()

    _create_workspace_schema(db, schema_name)

    db.commit()
    db.refresh(workspace)
    return _workspace_to_response(workspace)


def list_workspaces(db: Session, user: User) -> list[WorkspaceResponse]:
    statement = select(Workspace).where(Workspace.is_active.is_(True))
    if user.role != UserRole.admin.value:
        statement = statement.where(Workspace.owner_user_id == user.id)

    workspaces = db.scalars(statement.order_by(desc(Workspace.updated_at), asc(Workspace.name))).all()
    return [_workspace_to_response(item) for item in workspaces]


def get_workspace(db: Session, user: User, workspace_id: str) -> WorkspaceResponse:
    workspace = _get_workspace_entity(db, workspace_id)
    _assert_workspace_access(user, workspace)
    return _workspace_to_response(workspace)


def update_workspace(
    db: Session,
    user: User,
    workspace_id: str,
    payload: WorkspaceUpdateRequest,
) -> WorkspaceResponse:
    workspace = _get_workspace_entity(db, workspace_id)
    _assert_workspace_access(user, workspace)

    updated = False

    if payload.name is not None:
        cleaned_name = _clean_workspace_name(payload.name)
        _validate_workspace_name_uniqueness(
            db,
            user_id=workspace.owner_user_id,
            workspace_name=cleaned_name,
            exclude_workspace_id=workspace.id,
        )
        if workspace.name != cleaned_name:
            workspace.name = cleaned_name
            updated = True

    if payload.description is not None and workspace.description != payload.description:
        workspace.description = payload.description
        updated = True

    if updated:
        workspace.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(workspace)

    return _workspace_to_response(workspace)


def delete_workspace(db: Session, user: User, workspace_id: str) -> None:
    workspace = _get_workspace_entity(db, workspace_id)
    _assert_workspace_access(user, workspace)

    quoted_schema = _quote_identifier(workspace.schema_name)
    db.execute(text(f"DROP SCHEMA IF EXISTS {quoted_schema} CASCADE"))

    if workspace.storage_path:
        shutil.rmtree(workspace.storage_path, ignore_errors=True)

    workspace.is_active = False
    workspace.updated_at = datetime.utcnow()
    db.commit()


def save_dashboard(db: Session, user: User, workspace_id: str, payload: DashboardSaveRequest) -> DashboardResponse:
    workspace = _get_workspace_entity(db, workspace_id)
    _assert_workspace_access(user, workspace)

    dashboard_id = payload.dashboard_id or str(uuid.uuid4())
    now = datetime.utcnow()
    quoted_schema = _quote_identifier(workspace.schema_name)

    row = db.execute(
        text(
            f"""
            INSERT INTO {quoted_schema}.dashboards (
                id,
                name,
                description,
                blocks,
                filters,
                created_by,
                created_at,
                updated_at
            )
            VALUES (
                :id,
                :name,
                :description,
                CAST(:blocks AS jsonb),
                CAST(:filters AS jsonb),
                :created_by,
                :created_at,
                :updated_at
            )
            ON CONFLICT (id)
            DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                blocks = EXCLUDED.blocks,
                filters = EXCLUDED.filters,
                updated_at = EXCLUDED.updated_at
            RETURNING id, name, description, blocks, filters, created_by, created_at, updated_at
            """
        ),
        {
            "id": dashboard_id,
            "name": payload.name,
            "description": payload.description,
            "blocks": json.dumps(payload.blocks),
            "filters": json.dumps(payload.filters),
            "created_by": user.id,
            "created_at": now,
            "updated_at": now,
        },
    ).mappings().one()
    db.commit()

    return DashboardResponse(
        id=str(row["id"]),
        name=str(row["name"]),
        description=row["description"],
        blocks=list(row["blocks"] or []),
        filters=dict(row["filters"] or {}),
        created_by=str(row["created_by"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def list_dashboards(
    db: Session,
    user: User,
    workspace_id: str,
    *,
    limit: int = 100,
) -> list[DashboardResponse]:
    workspace = _get_workspace_entity(db, workspace_id)
    _assert_workspace_access(user, workspace)

    quoted_schema = _quote_identifier(workspace.schema_name)
    rows = db.execute(
        text(
            f"""
            SELECT id, name, description, blocks, filters, created_by, created_at, updated_at
            FROM {quoted_schema}.dashboards
            ORDER BY updated_at DESC
            LIMIT :limit
            """
        ),
        {"limit": max(1, min(500, limit))},
    ).mappings().all()

    return [
        DashboardResponse(
            id=str(row["id"]),
            name=str(row["name"]),
            description=row["description"],
            blocks=list(row["blocks"] or []),
            filters=dict(row["filters"] or {}),
            created_by=str(row["created_by"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
        for row in rows
    ]
