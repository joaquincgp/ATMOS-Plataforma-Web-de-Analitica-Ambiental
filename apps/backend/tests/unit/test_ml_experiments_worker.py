# SQLite-backed tests for the ML Experiments background worker's claim/dispatch logic.
#
# NOTE: SQLite has no real row-level locking, so this only verifies the worker's
# claim *ordering* and dispatch/persist logic, not concurrent-claim safety under
# `FOR UPDATE SKIP LOCKED`. That guarantee is verified manually against real
# PostgreSQL (Docker Compose) per the project's verification checklist.
from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import EtlRun, Measurement, MLExperimentRun, SourceFile, Station, User, Variable, Workspace
from app.models.base import Base
from app.schemas.auth import UserRole, UserStatus
from app.services.etl.helpers import compute_record_hash
from app.services.ml_experiments import worker as worker_module


@pytest.fixture()
def session_factory(monkeypatch):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    test_session_local = sessionmaker(bind=engine)
    monkeypatch.setattr(worker_module, "SessionLocal", test_session_local)
    try:
        yield test_session_local
    finally:
        engine.dispose()


def _seed_workspace(session_factory) -> tuple[str, str]:
    session = session_factory()
    owner = User(
        email=f"owner-{id(session)}@example.com",
        full_name="Owner",
        password_hash="hash",
        role=UserRole.researcher.value,
        status=UserStatus.active.value,
        is_active=True,
        is_verified=True,
    )
    session.add(owner)
    session.commit()
    workspace = Workspace(
        id=f"ws-{owner.id}",
        owner_user_id=owner.id,
        name="Workspace",
        slug=f"ws-{owner.id}",
        schema_name=f"ws_{owner.id.replace('-', '')}",
        storage_path="/tmp/workspace",
        is_active=True,
    )
    session.add(workspace)
    session.commit()
    owner_id, workspace_id = owner.id, workspace.id
    session.close()
    return owner_id, workspace_id


def _seed_remmaq_measurements(session_factory, *, station_code: str = "A", hours: int = 96) -> None:
    session = session_factory()
    start = datetime(2025, 1, 1)
    station = Station(code=station_code, name=station_code)
    variables = [
        Variable(code="PM25", display_name="PM2.5", category="pollutant"),
        Variable(code="TMP", display_name="Temperature", category="meteorological"),
        Variable(code="HUM", display_name="Humidity", category="meteorological"),
        Variable(code="VEL", display_name="Wind Speed", category="meteorological"),
    ]
    session.add(station)
    session.add_all(variables)
    session.commit()
    run = EtlRun(trigger_type="manual", source="test", status="completed")
    session.add(run)
    session.commit()
    source = SourceFile(
        etl_run_id=run.id,
        source_type="manual",
        source_url=None,
        original_name="seed.csv",
        local_archive_path="seed.csv",
        checksum_sha256="a" * 64,
        status="completed",
        row_count=hours,
    )
    session.add(source)
    session.commit()
    for variable in variables:
        for hour in range(hours):
            observed_at = start + timedelta(hours=hour)
            session.add(
                Measurement(
                    station_id=station.id,
                    variable_id=variable.id,
                    observed_at=observed_at,
                    value=10.0 + hour * 0.1,
                    unit=None,
                    source_file_id=source.id,
                    record_hash=compute_record_hash(station.code, variable.code, observed_at),
                )
            )
    session.commit()
    session.close()


def _make_run(session_factory, *, owner_id: str, workspace_id: str, run_id: str, algorithm: str = "lstm") -> None:
    session = session_factory()
    session.add(
        MLExperimentRun(
            id=run_id,
            workspace_id=workspace_id,
            owner_user_id=owner_id,
            algorithm=algorithm,
            target_variable_code="PM25",
            station_codes=["A"],
            epochs=2,
            learning_rate=0.01,
            train_split=0.8,
            status="pending",
        )
    )
    session.commit()
    session.close()


def test_claim_next_job_picks_oldest_pending_and_marks_running(session_factory) -> None:
    owner_id, workspace_id = _seed_workspace(session_factory)
    _make_run(session_factory, owner_id=owner_id, workspace_id=workspace_id, run_id="run-older")
    _make_run(session_factory, owner_id=owner_id, workspace_id=workspace_id, run_id="run-newer")

    session = session_factory()
    older = session.get(MLExperimentRun, "run-older")
    older.created_at = datetime(2020, 1, 1)
    session.commit()
    session.close()

    assert worker_module._claim_next_job() == "run-older"
    assert worker_module._claim_next_job() == "run-newer"
    assert worker_module._claim_next_job() is None

    check_session = session_factory()
    refreshed = check_session.get(MLExperimentRun, "run-older")
    assert refreshed.status == "running"
    assert refreshed.claimed_at is not None
    assert refreshed.claimed_by is not None


def test_execute_job_completes_and_persists_results(session_factory) -> None:
    owner_id, workspace_id = _seed_workspace(session_factory)
    _seed_remmaq_measurements(session_factory)
    _make_run(session_factory, owner_id=owner_id, workspace_id=workspace_id, run_id="run-complete")

    worker_module._execute_job("run-complete")

    session = session_factory()
    refreshed = session.get(MLExperimentRun, "run-complete")
    assert refreshed.status == "completed"
    assert refreshed.final_rmse is not None
    assert len(refreshed.loss_curve) == 2
    assert len(refreshed.feature_importance) == 5
    assert refreshed.dataset_stats["train_rows"] > 0


def test_execute_job_marks_failed_on_dataset_error(session_factory) -> None:
    owner_id, workspace_id = _seed_workspace(session_factory)
    # No measurements seeded at all -> build_ml_dataset raises MLExperimentError.
    _make_run(session_factory, owner_id=owner_id, workspace_id=workspace_id, run_id="run-failed")

    worker_module._execute_job("run-failed")

    session = session_factory()
    refreshed = session.get(MLExperimentRun, "run-failed")
    assert refreshed.status == "failed"
    assert "No se encontraron mediciones" in refreshed.error_message


def test_execute_job_marks_failed_for_unimplemented_algorithm(session_factory) -> None:
    owner_id, workspace_id = _seed_workspace(session_factory)
    _seed_remmaq_measurements(session_factory)
    _make_run(
        session_factory, owner_id=owner_id, workspace_id=workspace_id, run_id="run-unimplemented", algorithm="gru"
    )

    worker_module._execute_job("run-unimplemented")

    session = session_factory()
    refreshed = session.get(MLExperimentRun, "run-unimplemented")
    assert refreshed.status == "failed"
    assert "no está implementado" in refreshed.error_message
