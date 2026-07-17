# Direct-call tests for the ml_experiments endpoint functions (bypassing FastAPI DI),
# mirroring the pattern used in tests/unit/test_remaining_api_endpoints.py.
from __future__ import annotations

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.endpoints.ml_experiments import (
    clear_ml_experiment_run_history,
    delete_ml_experiment_run,
    delete_ml_experiment_source,
    get_available_ml_algorithms,
    get_ml_experiment_run,
    get_ml_experiment_source,
    get_ml_model_sources,
    list_ml_experiment_runs,
    list_ml_experiment_sources,
    submit_ml_experiment_run,
    sync_ml_experiment_source,
)
from app.models import User, Variable, Workspace
from app.models.base import Base
from app.schemas.auth import UserRole, UserStatus
from app.schemas.ml_experiment import MLExperimentRunRequest, MLExperimentSourceSyncRequest

# pylint: disable=protected-access,redefined-outer-name


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


def test_get_available_ml_algorithms_returns_registered_runners() -> None:
    response = get_available_ml_algorithms()

    assert response.algorithms == ["gru", "lstm", "transformer"]


def test_get_ml_model_sources_returns_real_training_files() -> None:
    response = get_ml_model_sources()

    keys = [f.key for f in response.files]
    assert keys == ["dataset", "lstm", "gru", "transformer"]
    for f in response.files:
        assert f.filename == f"{f.key}.py"
        assert f.label
        assert "class " in f.content or "def " in f.content


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


def test_delete_run_endpoint_removes_run(db_session) -> None:
    owner = _make_user(db_session, role=UserRole.researcher, email="endpoint-owner5@example.com")
    workspace = _make_workspace(db_session, owner=owner, workspace_id="ws-endpoint-delete")
    db_session.add(Variable(code="PM25", display_name="PM2.5", category="pollutant"))
    db_session.commit()
    created = submit_ml_experiment_run(
        MLExperimentRunRequest(workspace_id=workspace.id, target_variable="PM25"), db=db_session, user=owner
    )

    delete_ml_experiment_run(created.id, db=db_session, user=owner)

    with pytest.raises(HTTPException) as exc_info:
        get_ml_experiment_run(created.id, db=db_session, user=owner)
    assert exc_info.value.status_code == 404


def test_clear_run_history_endpoint_returns_cleared_count(db_session) -> None:
    owner = _make_user(db_session, role=UserRole.researcher, email="endpoint-owner6@example.com")
    workspace = _make_workspace(db_session, owner=owner, workspace_id="ws-endpoint-clear")
    db_session.add(Variable(code="PM25", display_name="PM2.5", category="pollutant"))
    db_session.commit()
    submit_ml_experiment_run(
        MLExperimentRunRequest(workspace_id=workspace.id, target_variable="PM25"), db=db_session, user=owner
    )
    submit_ml_experiment_run(
        MLExperimentRunRequest(workspace_id=workspace.id, target_variable="PM25"), db=db_session, user=owner
    )

    result = clear_ml_experiment_run_history(workspace_id=workspace.id, db=db_session, user=owner)

    assert result == {"cleared": 2}
    assert list_ml_experiment_runs(workspace_id=workspace.id, limit=20, db=db_session, user=owner) == []


def test_sync_ml_experiment_source_endpoint_creates_syncing_draft(db_session, tmp_path) -> None:
    owner = _make_user(db_session, role=UserRole.researcher, email="endpoint-owner7@example.com")
    workspace = Workspace(
        id="ws-endpoint-sync",
        owner_user_id=owner.id,
        name="Workspace",
        slug="ws-endpoint-sync",
        schema_name="ws_endpoint_sync",
        storage_path=str(tmp_path),
        is_active=True,
    )
    db_session.add(workspace)
    db_session.commit()

    draft = sync_ml_experiment_source(
        MLExperimentSourceSyncRequest(workspace_id=workspace.id, target_variable_code="PM25"),
        BackgroundTasks(),
        db=db_session,
        user=owner,
    )

    assert draft.status == "syncing"
    assert draft.created_for == "ml_experiments"

    sources = list_ml_experiment_sources(workspace_id=workspace.id, db=db_session, user=owner)
    assert [s.id for s in sources] == [draft.id]

    fetched = get_ml_experiment_source(draft.id, db=db_session, user=owner)
    assert fetched.id == draft.id

    delete_ml_experiment_source(draft.id, db=db_session, user=owner)
    assert list_ml_experiment_sources(workspace_id=workspace.id, db=db_session, user=owner) == []


def test_get_ml_experiment_source_endpoint_raises_404_for_missing_source(db_session) -> None:
    owner = _make_user(db_session, role=UserRole.researcher, email="endpoint-owner8@example.com")

    with pytest.raises(HTTPException) as exc_info:
        get_ml_experiment_source("missing-source", db=db_session, user=owner)

    assert exc_info.value.status_code == 404
