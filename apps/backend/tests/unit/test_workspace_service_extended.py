# Unit tests cover workspace service behavior while replacing PostgreSQL-only schema calls.
# pylint: disable=redefined-outer-name

from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import User, Workspace
from app.models.base import Base
from app.schemas.auth import UserRole, UserStatus
from app.schemas.workspace import DashboardSaveRequest, WorkspaceCreateRequest, WorkspaceUpdateRequest
from app.services import workspace_service
from app.services.workspace_service import WorkspaceError


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _user(db_session, *, email: str, role: UserRole = UserRole.researcher) -> User:
    user = User(
        email=email,
        full_name=email,
        password_hash="hash",
        role=role.value,
        status=UserStatus.active.value,
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


def test_workspace_crud_with_sqlite_and_schema_stub(db_session, tmp_path, monkeypatch) -> None:
    user = _user(db_session, email="owner@example.com")
    monkeypatch.setattr(workspace_service.settings, "workspace_storage_dir", str(tmp_path))
    monkeypatch.setattr(workspace_service, "_create_workspace_schema", lambda db, schema_name: None)

    created = workspace_service.create_workspace(
        db_session,
        user,
        WorkspaceCreateRequest(name="  Quito   Lab  ", description="Initial"),
    )
    listed = workspace_service.list_workspaces(db_session, user)
    fetched = workspace_service.get_workspace(db_session, user, created.id)
    updated = workspace_service.update_workspace(
        db_session,
        user,
        created.id,
        WorkspaceUpdateRequest(name="Quito Lab Updated", description="Updated"),
    )
    unchanged = workspace_service.update_workspace(db_session, user, created.id, WorkspaceUpdateRequest())

    assert created.slug == "quito-lab"
    assert created.owner_full_name == "owner@example.com"
    assert created.owner_email == "owner@example.com"
    assert len(listed) == 1
    assert listed[0].owner_full_name == "owner@example.com"
    assert fetched.id == created.id
    assert fetched.owner_email == "owner@example.com"
    assert updated.name == "Quito Lab Updated"
    assert unchanged.description == "Updated"
    assert (tmp_path / user.id / "quito-lab" / "dashboards").is_dir()


def test_admin_workspace_listing_includes_each_owner_identity(db_session) -> None:
    admin = _user(db_session, email="admin@example.com", role=UserRole.admin)
    first_owner = _user(db_session, email="first@example.com")
    second_owner = _user(db_session, email="second@example.com")
    first_owner.full_name = "First Owner"
    second_owner.full_name = "Second Owner"
    db_session.add_all(
        [
            Workspace(
                owner_user_id=first_owner.id,
                name="First workspace",
                slug="first-workspace",
                schema_name="ws_first_workspace",
                storage_path="first",
                is_active=True,
            ),
            Workspace(
                owner_user_id=second_owner.id,
                name="Second workspace",
                slug="second-workspace",
                schema_name="ws_second_workspace",
                storage_path="second",
                is_active=True,
            ),
        ]
    )
    db_session.commit()

    listed = workspace_service.list_workspaces(db_session, admin)

    owners_by_workspace = {
        workspace.name: (workspace.owner_full_name, workspace.owner_email) for workspace in listed
    }
    assert owners_by_workspace == {
        "First workspace": ("First Owner", "first@example.com"),
        "Second workspace": ("Second Owner", "second@example.com"),
    }


def test_workspace_rejects_roles_duplicates_and_missing_access(db_session, tmp_path, monkeypatch) -> None:
    owner = _user(db_session, email="owner2@example.com")
    other = _user(db_session, email="other@example.com")
    generic = _user(db_session, email="generic@example.com", role=UserRole.generic)
    monkeypatch.setattr(workspace_service.settings, "workspace_storage_dir", str(tmp_path))
    monkeypatch.setattr(workspace_service, "_create_workspace_schema", lambda db, schema_name: None)
    created = workspace_service.create_workspace(db_session, owner, WorkspaceCreateRequest(name="Air Lab"))

    with pytest.raises(WorkspaceError, match="Only admin"):
        workspace_service.create_workspace(db_session, generic, WorkspaceCreateRequest(name="Denied Lab"))
    with pytest.raises(WorkspaceError, match="already exists"):
        workspace_service.create_workspace(db_session, owner, WorkspaceCreateRequest(name="air lab"))
    with pytest.raises(WorkspaceError, match="not found"):
        workspace_service.get_workspace(db_session, owner, "missing")
    with pytest.raises(WorkspaceError, match="access"):
        workspace_service.get_workspace(db_session, other, created.id)


def test_delete_workspace_marks_inactive_and_removes_storage(db_session, tmp_path, monkeypatch) -> None:
    user = _user(db_session, email="delete-owner@example.com")
    storage_path = tmp_path / "workspace"
    storage_path.mkdir()
    workspace = Workspace(
        owner_user_id=user.id,
        name="Delete Me",
        slug="delete-me",
        schema_name="ws_delete_me",
        storage_path=str(storage_path),
        is_active=True,
    )
    db_session.add(workspace)
    db_session.commit()

    original_execute = db_session.execute

    def fake_execute(statement, *args, **kwargs):
        if str(statement).startswith("DROP SCHEMA"):
            return SimpleNamespace()
        return original_execute(statement, *args, **kwargs)

    monkeypatch.setattr(db_session, "execute", fake_execute)

    workspace_service.delete_workspace(db_session, user, workspace.id)

    db_session.expire_all()
    assert db_session.get(Workspace, workspace.id).is_active is False
    assert not storage_path.exists()


class _DashboardResult:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def one(self):
        return self.rows[0]

    def all(self):
        return self.rows


def test_dashboard_save_and_list_map_database_rows(monkeypatch) -> None:
    now = datetime(2025, 1, 1)
    row = {
        "id": "dashboard-1",
        "name": "Summary",
        "description": "Daily",
        "blocks": [{"type": "chart"}],
        "filters": {"station": "A"},
        "created_by": "user-1",
        "created_at": now,
        "updated_at": now,
    }
    workspace = SimpleNamespace(id="workspace-1", owner_user_id="user-1", schema_name="ws_safe")
    db = SimpleNamespace(
        scalar=lambda _statement: workspace,
        execute=lambda *_args, **_kwargs: _DashboardResult([row]),
        commit=lambda: None,
    )
    user = SimpleNamespace(id="user-1", role=UserRole.researcher.value)
    monkeypatch.setattr(workspace_service.uuid, "uuid4", lambda: "dashboard-1")

    saved = workspace_service.save_dashboard(
        db,
        user,
        "workspace-1",
        DashboardSaveRequest(name="Summary", description="Daily", blocks=[{"type": "chart"}], filters={"station": "A"}),
    )
    listed = workspace_service.list_dashboards(db, user, "workspace-1", limit=999)

    assert saved.id == "dashboard-1"
    assert listed[0].blocks == [{"type": "chart"}]
