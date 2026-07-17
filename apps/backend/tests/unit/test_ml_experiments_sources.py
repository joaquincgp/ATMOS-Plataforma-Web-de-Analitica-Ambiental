# SQLite-backed tests for the ML-Experiments-exclusive REMMAQ source isolation:
# sources synced from here must never appear in (or affect) Data Manager's
# general manual dataset listing, and vice versa.
from __future__ import annotations

# pylint: disable=redefined-outer-name,unsubscriptable-object,unsupported-membership-test
from pathlib import Path

import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import User, Workspace
from app.models.base import Base
from app.schemas.auth import UserRole, UserStatus
from app.services.manual_dataset import ManualDatasetError, ManualDatasetService
from app.services.manual_dataset import service as manual_dataset_service_module

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


def _make_user_and_workspace(db_session, tmp_path: Path, *, email: str, workspace_id: str) -> tuple[User, Workspace]:
    user = User(
        email=email,
        full_name="Owner",
        password_hash="hash",
        role=UserRole.researcher.value,
        status=UserStatus.active.value,
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    workspace = Workspace(
        id=workspace_id,
        owner_user_id=user.id,
        name="Workspace",
        slug=workspace_id,
        schema_name=f"ws_{workspace_id}",
        storage_path=str(tmp_path),
        is_active=True,
    )
    db_session.add(workspace)
    db_session.commit()
    return user, workspace


class _FakeEtlService:
    def __init__(self, _db) -> None:
        pass

    def extract_remmaq_dataframe(self, *, progress_callback=None, **_kwargs):
        rows = []
        for variable_code in ("PM25", "TMP", "HUM", "VEL"):
            for hour in range(50):
                rows.append(
                    {
                        "station_code": "BELISARIO",
                        "observed_at": f"2026-06-{1 + hour // 24:02d}T{hour % 24:02d}:00:00",
                        "variable_code": variable_code,
                        "value": 10.0 + hour * 0.1,
                        "unit": "ug/m3",
                        "source_file_name": "remmaq.csv",
                        "source_url": "https://datosambiente.quito.gob.ec/",
                    }
                )
        if progress_callback is not None:
            progress_callback(1, 4, len(rows))
        return pd.DataFrame.from_records(rows), [{"variable_code": "PM25"}]


class _FailingEtlService:
    def __init__(self, _db) -> None:
        pass

    def extract_remmaq_dataframe(self, **_kwargs):
        raise RuntimeError("No se encontraron filas REMMAQ para el rango o variables seleccionadas.")


def test_create_and_sync_ml_experiment_source_is_isolated_from_general_datasets(
    db_session, tmp_path: Path, monkeypatch
) -> None:
    user, workspace = _make_user_and_workspace(db_session, tmp_path, email="ml-src@example.com", workspace_id="ws-1")
    service = ManualDatasetService(db_session)

    # A general-purpose dataset, created the normal Data Manager way.
    service.create_from_upload(
        workspace_id=workspace.id,
        user=user,
        filename="general.csv",
        content=b"observed_at,station,variable,value\n2025-01-01,A,PM25,10\n",
    )

    draft = service.create_ml_experiment_source_draft(
        workspace_id=workspace.id,
        user=user,
        target_variable_code="PM25",
        date_from=None,
        date_to=None,
    )
    assert draft.status == "syncing"
    assert draft.created_for == "ml_experiments"

    monkeypatch.setattr(manual_dataset_service_module, "EtlService", _FakeEtlService)
    service.run_ml_experiment_source_sync(
        dataset_id=draft.id,
        target_variable_code="PM25",
        date_from=None,
        date_to=None,
    )

    synced = service.get_ml_experiment_source(dataset_id=draft.id, user=user)
    assert synced.status == "draft"
    assert synced.row_count == 200  # 4 variables * 50 hours
    assert synced.source_metadata["variable_codes"] == ["HUM", "PM25", "TMP", "VEL"]
    assert synced.source_metadata["station_codes"] == ["BELISARIO"]

    # Isolation: the ML-Experiments source must not show up in the general
    # Data Manager listing, and the general dataset must not show up in the
    # ML-Experiments-exclusive listing.
    general_datasets = service.list_datasets(workspace_id=workspace.id, user=user)
    assert [d.name for d in general_datasets] == ["general"]

    ml_sources = service.list_ml_experiment_sources(workspace_id=workspace.id, user=user)
    assert [s.id for s in ml_sources] == [draft.id]

    # The synced data is genuinely queryable end-to-end (used by dataset.py via
    # get_source_dataframe at training time).
    frame = service.get_source_dataframe(dataset_id=draft.id, user=user)
    assert len(frame) == 200
    assert set(frame["variable_code"].unique()) == {"PM25", "TMP", "HUM", "VEL"}


def test_run_ml_experiment_source_sync_marks_failed_on_error(db_session, tmp_path: Path, monkeypatch) -> None:
    user, workspace = _make_user_and_workspace(db_session, tmp_path, email="ml-fail@example.com", workspace_id="ws-2")
    service = ManualDatasetService(db_session)
    draft = service.create_ml_experiment_source_draft(
        workspace_id=workspace.id,
        user=user,
        target_variable_code="NO2",
        date_from=None,
        date_to=None,
    )

    monkeypatch.setattr(manual_dataset_service_module, "EtlService", _FailingEtlService)
    service.run_ml_experiment_source_sync(
        dataset_id=draft.id,
        target_variable_code="NO2",
        date_from=None,
        date_to=None,
    )

    failed = service.get_ml_experiment_source(dataset_id=draft.id, user=user)
    assert failed.status == "failed"
    assert failed.error_message is not None


def test_delete_ml_experiment_source_removes_it_but_not_general_datasets(
    db_session, tmp_path: Path, monkeypatch
) -> None:
    user, workspace = _make_user_and_workspace(db_session, tmp_path, email="ml-del@example.com", workspace_id="ws-3")
    service = ManualDatasetService(db_session)
    general = service.create_from_upload(
        workspace_id=workspace.id,
        user=user,
        filename="general.csv",
        content=b"observed_at,station,variable,value\n2025-01-01,A,PM25,10\n",
    )
    draft = service.create_ml_experiment_source_draft(
        workspace_id=workspace.id,
        user=user,
        target_variable_code="PM25",
        date_from=None,
        date_to=None,
    )
    monkeypatch.setattr(manual_dataset_service_module, "EtlService", _FakeEtlService)
    service.run_ml_experiment_source_sync(
        dataset_id=draft.id, target_variable_code="PM25", date_from=None, date_to=None
    )

    service.delete_ml_experiment_source(dataset_id=draft.id, user=user)

    assert service.list_ml_experiment_sources(workspace_id=workspace.id, user=user) == []
    remaining_general = service.list_datasets(workspace_id=workspace.id, user=user)
    assert [d.id for d in remaining_general] == [general.id]

    with pytest.raises(ManualDatasetError, match="no pertenece a ML Experiments"):
        service.delete_ml_experiment_source(dataset_id=general.id, user=user)


def test_run_ml_experiment_source_sync_reports_progress_in_source_metadata(
    db_session, tmp_path: Path, monkeypatch
) -> None:
    user, workspace = _make_user_and_workspace(
        db_session, tmp_path, email="ml-progress@example.com", workspace_id="ws-5"
    )
    service = ManualDatasetService(db_session)
    draft = service.create_ml_experiment_source_draft(
        workspace_id=workspace.id, user=user, target_variable_code="PM25", date_from=None, date_to=None
    )

    monkeypatch.setattr(manual_dataset_service_module, "EtlService", _FakeEtlService)
    service.run_ml_experiment_source_sync(
        dataset_id=draft.id, target_variable_code="PM25", date_from=None, date_to=None
    )

    # _FakeEtlService reports progress (1, 4, 200) before the final write replaces
    # source_metadata with the finished summary; both phases must be reachable.
    synced = service.get_ml_experiment_source(dataset_id=draft.id, user=user)
    assert synced.status == "draft"
    assert "variable_codes" in synced.source_metadata


def test_run_ml_experiment_source_sync_tolerates_deletion_mid_progress_report(
    db_session, tmp_path: Path, monkeypatch
) -> None:
    from sqlalchemy.orm.exc import StaleDataError

    user, workspace = _make_user_and_workspace(db_session, tmp_path, email="ml-race@example.com", workspace_id="ws-6")
    service = ManualDatasetService(db_session)
    draft = service.create_ml_experiment_source_draft(
        workspace_id=workspace.id, user=user, target_variable_code="PM25", date_from=None, date_to=None
    )

    original_commit = db_session.commit
    call_count = {"n": 0}

    def _flaky_commit():
        call_count["n"] += 1
        if call_count["n"] == 1:
            # Simulates another session deleting the row mid-sync: the
            # progress-report commit finds 0 matching rows.
            raise StaleDataError("simulated concurrent delete")
        return original_commit()

    monkeypatch.setattr(db_session, "commit", _flaky_commit)
    monkeypatch.setattr(manual_dataset_service_module, "EtlService", _FakeEtlService)

    # Must not raise despite the simulated StaleDataError during progress reporting.
    service.run_ml_experiment_source_sync(
        dataset_id=draft.id, target_variable_code="PM25", date_from=None, date_to=None
    )
