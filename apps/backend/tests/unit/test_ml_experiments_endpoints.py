# Direct-call tests for the ml_experiments endpoint functions (bypassing FastAPI DI),
# mirroring the pattern used in tests/unit/test_remaining_api_endpoints.py.
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.endpoints.ml_experiments import (
    get_ml_experiment_run,
    list_ml_experiment_runs,
    submit_ml_experiment_run,
)
from app.models import User, Variable, Workspace
from app.models.base import Base
from app.schemas.auth import UserRole, UserStatus
from app.schemas.ml_experiment import MLExperimentRunRequest

# pylint: disable=protected-access


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


def test_submit_run_endpoint_returns_pending_detail(db_session) -> None:
    owner = _make_user(db_session, role=UserRole.researcher, email="endpoint-owner@example.com")
    workspace = _make_workspace(db_session, owner=owner, workspace_id="ws-endpoint")
    db_session.add(Variable(code="PM25", display_name="PM2.5", category="pollutant"))
    db_session.commit()

    detail = submit_ml_experiment_run(
        MLExperimentRunRequest(workspace_id=workspace.id, target_variable="PM25"),
        db=db_session,
        user=owner,
    )

    assert detail.status == "pending"
    assert detail.algorithm == "lstm"


def test_submit_run_endpoint_raises_400_for_unknown_workspace(db_session) -> None:
    owner = _make_user(db_session, role=UserRole.researcher, email="endpoint-owner2@example.com")

    with pytest.raises(HTTPException) as exc_info:
        submit_ml_experiment_run(
            MLExperimentRunRequest(workspace_id="missing", target_variable="PM25"),
            db=db_session,
            user=owner,
        )

    assert exc_info.value.status_code == 400


def test_get_run_endpoint_raises_404_for_missing_run(db_session) -> None:
    owner = _make_user(db_session, role=UserRole.researcher, email="endpoint-owner3@example.com")

    with pytest.raises(HTTPException) as exc_info:
        get_ml_experiment_run("missing-run", db=db_session, user=owner)

    assert exc_info.value.status_code == 404


def test_list_runs_endpoint_returns_only_workspace_runs(db_session) -> None:
    owner = _make_user(db_session, role=UserRole.researcher, email="endpoint-owner4@example.com")
    workspace = _make_workspace(db_session, owner=owner, workspace_id="ws-endpoint-list")
    db_session.add(Variable(code="PM25", display_name="PM2.5", category="pollutant"))
    db_session.commit()
    submit_ml_experiment_run(
        MLExperimentRunRequest(workspace_id=workspace.id, target_variable="PM25"),
        db=db_session,
        user=owner,
    )

    runs = list_ml_experiment_runs(workspace_id=workspace.id, limit=20, db=db_session, user=owner)

    assert len(runs) == 1
    assert runs[0].target_variable == "PM25"
