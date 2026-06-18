# SQLite-backed tests for MLExperimentService validation and access control.
from __future__ import annotations

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import User, Variable, Workspace
from app.models.base import Base
from app.schemas.auth import UserRole, UserStatus
from app.schemas.ml_experiment import MLExperimentRunRequest
from app.services.ml_experiments.service import MLExperimentService, MLExperimentServiceError


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


def _make_user(db_session, *, role: UserRole, email: str) -> User:
    user = User(
        email=email,
        full_name="Test User",
        password_hash="hash",
        role=role.value,
        status=UserStatus.active.value,
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


def _make_workspace(db_session, *, owner: User, workspace_id: str) -> Workspace:
    workspace = Workspace(
        id=workspace_id,
        owner_user_id=owner.id,
        name="Workspace",
        slug=workspace_id,
        schema_name=f"ws_{workspace_id}",
        storage_path="/tmp/workspace",
        is_active=True,
    )
    db_session.add(workspace)
    db_session.commit()
    return workspace


def test_train_split_must_be_a_supported_ratio() -> None:
    with pytest.raises(ValidationError, match="train_split"):
        MLExperimentRunRequest(workspace_id="ws", target_variable="PM25", train_split=0.55)


def test_submit_run_rejects_unknown_workspace(db_session) -> None:
    owner = _make_user(db_session, role=UserRole.researcher, email="owner@example.com")
    db_session.add(Variable(code="PM25", display_name="PM2.5", category="pollutant"))
    db_session.commit()
    service = MLExperimentService(db_session)

    with pytest.raises(MLExperimentServiceError, match="Workspace"):
        service.submit_run(
            user=owner,
            payload=MLExperimentRunRequest(workspace_id="missing", target_variable="PM25"),
        )


def test_submit_run_rejects_unknown_target_variable(db_session) -> None:
    owner = _make_user(db_session, role=UserRole.researcher, email="owner2@example.com")
    workspace = _make_workspace(db_session, owner=owner, workspace_id="ws-1")
    service = MLExperimentService(db_session)

    with pytest.raises(MLExperimentServiceError, match="catálogo"):
        service.submit_run(
            user=owner,
            payload=MLExperimentRunRequest(workspace_id=workspace.id, target_variable="PM25"),
        )


def test_submit_run_and_access_control_between_owner_other_and_admin(db_session) -> None:
    owner = _make_user(db_session, role=UserRole.researcher, email="owner3@example.com")
    other = _make_user(db_session, role=UserRole.researcher, email="other@example.com")
    admin = _make_user(db_session, role=UserRole.admin, email="admin@example.com")
    workspace = _make_workspace(db_session, owner=owner, workspace_id="ws-2")
    db_session.add(Variable(code="PM25", display_name="PM2.5", category="pollutant"))
    db_session.commit()
    service = MLExperimentService(db_session)

    created = service.submit_run(
        user=owner,
        payload=MLExperimentRunRequest(workspace_id=workspace.id, target_variable="PM25"),
    )

    assert created.status == "pending"
    assert service.get_run(user=owner, run_id=created.id).id == created.id
    assert service.get_run(user=admin, run_id=created.id).id == created.id

    with pytest.raises(MLExperimentServiceError, match="acceso"):
        service.get_run(user=other, run_id=created.id)
    with pytest.raises(MLExperimentServiceError, match="acceso"):
        service.list_runs(user=other, workspace_id=workspace.id)

    assert len(service.list_runs(user=owner, workspace_id=workspace.id)) == 1
    assert len(service.list_runs(user=admin, workspace_id=workspace.id)) == 1


def test_get_run_raises_for_missing_run(db_session) -> None:
    owner = _make_user(db_session, role=UserRole.researcher, email="owner4@example.com")
    service = MLExperimentService(db_session)

    with pytest.raises(MLExperimentServiceError, match="no encontrado"):
        service.get_run(user=owner, run_id="missing-run")
