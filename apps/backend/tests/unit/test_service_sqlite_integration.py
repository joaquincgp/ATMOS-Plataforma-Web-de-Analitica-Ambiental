# SQLite-backed service tests cover real query/service behavior without PostgreSQL.
# pylint: disable=protected-access,redefined-outer-name

from datetime import UTC, datetime
from pathlib import Path

import httpx
import pandas as pd
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.models import (
    EtlRun,
    ManualDataset,
    Measurement,
    SourceFile,
    Station,
    User,
    Variable,
    Workspace,
)
from app.models.base import Base
from app.schemas.analytics import AnalyticsQueryRequest, SqlPreviewRequest
from app.schemas.auth import (
    AdminCreateUserRequest,
    AdminUpdateUserRequest,
    ForgotPasswordRequest,
    LoginRequest,
    RefreshTokenRequest,
    RegisterRequest,
    ResetPasswordRequest,
    UpdateProfileRequest,
    UserRole,
    UserStatus,
)
from app.schemas.etl import ManualDatasetFinalizeRequest, ManualDatasetRoleMapping, ManualDatasetUpdateRequest
from app.services import auth_service
from app.services.analytics_service import (
    get_filter_options,
    get_station_live_snapshot,
    preview_sql,
    query_data,
)
from app.services.auth_service import AuthError
from app.services.etl.helpers import compute_record_hash
from app.services.manual_dataset import ManualDatasetError, ManualDatasetService
from app.services.manual_dataset import service as manual_dataset_service_module


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


def _seed_measurements(db_session) -> tuple[SourceFile, SourceFile]:
    run = EtlRun(trigger_type="manual", source="test", status="completed")
    station_a = Station(code="A", name="Station A", latitude=1.0, longitude=2.0)
    station_b = Station(code="B", name="Station B", latitude=None, longitude=None)
    variable_pm25 = Variable(code="PM25", display_name="Fine particles", category="pollutant", default_unit="ug/m3")
    variable_pm10 = Variable(code="PM10", display_name="Coarse particles", category="pollutant", default_unit="ug/m3")
    db_session.add_all([run, station_a, station_b, variable_pm25, variable_pm10])
    db_session.commit()
    source_a = SourceFile(
        etl_run_id=run.id,
        source_type="manual",
        source_url=None,
        original_name="manual-a.csv",
        local_archive_path="a.csv",
        checksum_sha256="a" * 64,
        status="completed",
        row_count=3,
    )
    source_b = SourceFile(
        etl_run_id=run.id,
        source_type="automatic",
        source_url="https://example.test/b.zip",
        original_name="auto-b.zip",
        local_archive_path="b.zip",
        checksum_sha256="b" * 64,
        status="completed",
        row_count=1,
    )
    db_session.add_all([source_a, source_b])
    db_session.commit()
    rows = [
        (station_a, variable_pm25, datetime(2025, 1, 1, 0), 10.0, source_a),
        (station_a, variable_pm10, datetime(2025, 1, 1, 1), 20.0, source_a),
        (station_b, variable_pm25, datetime(2025, 1, 2, 0), 30.0, source_a),
        (station_a, variable_pm25, datetime(2025, 1, 3, 0), 40.0, source_b),
    ]
    for station, variable, observed_at, value, source in rows:
        db_session.add(
            Measurement(
                station_id=station.id,
                variable_id=variable.id,
                observed_at=observed_at,
                value=value,
                unit=variable.default_unit,
                source_file_id=source.id,
                record_hash=compute_record_hash(station.code, variable.code, observed_at.replace(tzinfo=UTC)),
            )
        )
    db_session.commit()
    return source_a, source_b


def test_analytics_service_queries_filters_live_snapshot_and_sql_preview(db_session) -> None:
    source_a, _source_b = _seed_measurements(db_session)

    filters = get_filter_options(db_session)
    query = query_data(
        db_session,
        AnalyticsQueryRequest(
            source_file_ids=[source_a.id],
            station_codes=["A"],
            variable_codes=["pm-2.5"],
            limit=10,
        ),
    )
    live = get_station_live_snapshot(db_session, station_codes=["A"])
    sql = preview_sql(db_session, SqlPreviewRequest(sql="SELECT 1 AS value", limit=1))

    assert {source.name for source in filters.sources} == {"manual-a.csv", "auto-b.zip"}
    assert [row.value for row in query.rows] == [10.0]
    assert query.truncated is False
    assert live.total == 1
    assert live.stations[0].variables[0].variable_code == "PM10"
    assert sql.rows == [{"value": 1}]


def test_analytics_query_caps_rows_and_rejects_unsafe_sql(db_session) -> None:
    source_a, _source_b = _seed_measurements(db_session)

    response = query_data(db_session, AnalyticsQueryRequest(source_file_ids=[source_a.id], limit=1))

    assert response.row_count == 1
    assert response.truncated is True
    with pytest.raises(ValueError):
        preview_sql(db_session, SqlPreviewRequest(sql="DELETE FROM measurements", limit=1))


def test_auth_service_full_user_token_and_password_reset_flow(db_session, monkeypatch) -> None:
    monkeypatch.setattr(auth_service.settings, "environment", "development")
    user_email = "new.user@udla.edu.ec"
    registered = auth_service.register_user(
        db_session,
        RegisterRequest(
            email=user_email,
            full_name="New User",
            institution="UDLA",
            password="password123",
        ),
    )
    admin_created = auth_service.admin_create_user(
        db_session,
        AdminCreateUserRequest(
            email="admin.created@udla.edu.ec",
            full_name="Admin Created",
            password="password123",
            role=UserRole.admin,
            status=UserStatus.active,
        ),
    )
    user = db_session.get(User, registered.id)
    user.status = UserStatus.active.value
    user.is_verified = True
    db_session.commit()

    login = auth_service.login_user(
        db_session,
        LoginRequest(email=user_email, password="password123"),
        user_agent="pytest",
        ip_address="127.0.0.1",
    )
    session = auth_service.validate_session(db_session, login.access_token)
    refreshed = auth_service.refresh_access_token(
        db_session,
        RefreshTokenRequest(refresh_token=login.refresh_token),
        user_agent="pytest",
        ip_address="127.0.0.1",
    )
    forgot = auth_service.forgot_password(db_session, ForgotPasswordRequest(email=user_email))
    reset = auth_service.reset_password(
        db_session,
        ResetPasswordRequest(token=forgot.debug_reset_token, new_password="new-password123"),
    )
    updated = auth_service.update_profile(db_session, user, UpdateProfileRequest(full_name="Renamed User"))

    assert admin_created.role == UserRole.admin
    assert registered.institution == "UDLA"
    assert session.authenticated is True
    assert refreshed.refresh_token != login.refresh_token
    assert reset.message == "Password updated successfully."
    assert updated.full_name == "Renamed User"


def test_auth_service_rejects_duplicate_inactive_and_invalid_flows(db_session) -> None:
    user_email = "dupe@udla.edu.ec"
    auth_service.register_user(
        db_session,
        RegisterRequest(email=user_email, full_name="Dupe User", password="password123"),
    )

    with pytest.raises(AuthError):
        auth_service.register_user(
            db_session,
            RegisterRequest(email=user_email, full_name="Dupe User", password="password123"),
        )
    with pytest.raises(AuthError):
        auth_service.login_user(
            db_session,
            LoginRequest(email=user_email, password="wrong-pass"),
            user_agent=None,
            ip_address=None,
        )

    suspended = db_session.scalar(select(User).where(User.email == user_email))
    suspended.status = UserStatus.suspended.value
    suspended.is_active = False
    db_session.commit()
    with pytest.raises(AuthError, match="deactivated"):
        auth_service.login_user(
            db_session,
            LoginRequest(email=user_email, password="password123"),
            user_agent=None,
            ip_address=None,
        )
    with pytest.raises(AuthError):
        auth_service.refresh_access_token(
            db_session,
            RefreshTokenRequest(refresh_token="missing-token"),
            user_agent=None,
            ip_address=None,
        )


def test_admin_user_management_lists_updates_and_deactivates(db_session, tmp_path: Path) -> None:
    admin = User(
        email="admin@example.com",
        full_name="Admin User",
        password_hash="hash",
        role=UserRole.admin.value,
        status=UserStatus.active.value,
        is_active=True,
        is_verified=True,
    )
    researcher = User(
        email="researcher@example.com",
        full_name="Researcher User",
        password_hash="hash",
        role=UserRole.researcher.value,
        status=UserStatus.active.value,
        is_active=True,
        is_verified=True,
    )
    db_session.add_all([admin, researcher])
    db_session.commit()
    db_session.add(
        Workspace(
            owner_user_id=researcher.id,
            name="Research Workspace",
            slug="research-workspace",
            schema_name="workspace_research",
            storage_path=str(tmp_path / "workspace"),
            is_active=True,
        )
    )
    db_session.add(
        Workspace(
            owner_user_id=researcher.id,
            name="Archived Workspace",
            slug="archived-workspace",
            schema_name="workspace_archived",
            storage_path=str(tmp_path / "workspace-archived"),
            is_active=False,
        )
    )
    db_session.commit()

    users = auth_service.list_admin_users(db_session, search="researcher")
    updated = auth_service.update_admin_user(
        db_session,
        target_user_id=researcher.id,
        payload=AdminUpdateUserRequest(role=UserRole.admin),
        acting_user=admin,
    )
    deactivated = auth_service.deactivate_admin_user(db_session, target_user_id=researcher.id, acting_user=admin)

    assert len(users) == 1
    assert users[0].workspace_count == 2
    assert updated.role == UserRole.admin
    assert deactivated.message == "User access deactivated."
    assert db_session.get(User, researcher.id).status == UserStatus.suspended.value

    with pytest.raises(AuthError, match="own admin role"):
        auth_service.update_admin_user(
            db_session,
            target_user_id=admin.id,
            payload=AdminUpdateUserRequest(role=UserRole.researcher),
            acting_user=admin,
        )


def test_manual_dataset_service_update_finalize_delete_and_analytics_rows(db_session, tmp_path: Path) -> None:
    user = User(
        email="owner@example.com",
        full_name="Owner",
        password_hash="hash",
        role=UserRole.researcher.value,
        status=UserStatus.active.value,
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    workspace_dir = tmp_path / "workspace"
    dataset_dir = workspace_dir / "datasets" / "manual" / "dataset-1"
    dataset_dir.mkdir(parents=True)
    raw_path = dataset_dir / "raw.csv"
    pd.DataFrame(
        {
            "observed_at": pd.date_range("2025-01-01", periods=3, freq="D"),
            "station": ["A", "A", "B"],
            "variable": ["PM25", "PM25", "PM10"],
            "value": [10.0, 11.0, 20.0],
            "unit": ["ug/m3", "ug/m3", "ug/m3"],
        }
    ).to_csv(raw_path, index=False)
    workspace = Workspace(
        id="workspace-1",
        owner_user_id=user.id,
        name="Workspace",
        slug="workspace",
        schema_name="ws_workspace",
        storage_path=str(workspace_dir),
        is_active=True,
    )
    dataset = ManualDataset(
        id="dataset-1",
        workspace_id=workspace.id,
        owner_user_id=user.id,
        name="Dataset",
        source_kind="upload",
        source_url=None,
        original_file_name="raw.csv",
        raw_file_path=str(raw_path),
        checksum_sha256="c" * 64,
        status="draft",
        storage_format="csv",
        dataset_kind="generic",
        row_count=0,
        column_count=0,
        mapping_config={},
        profile_summary={},
        column_schema=[],
        preview_rows=[],
        operation_pipeline=[],
    )
    db_session.add_all([workspace, dataset])
    db_session.commit()
    service = ManualDatasetService(db_session)
    mapping = ManualDatasetRoleMapping(
        datetime_column="observed_at",
        station_code_column="station",
        variable_code_column="variable",
        value_column="value",
        unit_column="unit",
    )

    updated = service.update_dataset(
        dataset_id=dataset.id,
        user=user,
        payload=ManualDatasetUpdateRequest(mapping=mapping),
    )
    finalized = service.finalize_dataset(
        dataset_id=dataset.id,
        user=user,
        payload=ManualDatasetFinalizeRequest(mapping=mapping, dataset_name="Final Dataset"),
    )
    listed = service.list_datasets(workspace_id=workspace.id, user=user)
    analytics = service.get_analytics_rows(dataset_id=dataset.id, user=user, limit=2)
    context = service.get_eda_context(dataset_id=dataset.id, user=user)
    service.delete_dataset(dataset_id=dataset.id, user=user)

    assert updated.row_count == 3
    assert finalized.name == "Final Dataset"
    assert len(listed) == 1
    assert analytics.truncated is True
    assert context.dataframe.shape[0] == 3
    assert db_session.get(ManualDataset, dataset.id) is None


def test_manual_dataset_service_rejects_missing_dataset_and_duplicate_names(db_session, tmp_path: Path) -> None:
    user = User(
        email="owner2@example.com",
        full_name="Owner",
        password_hash="hash",
        role=UserRole.researcher.value,
        status=UserStatus.active.value,
        is_active=True,
        is_verified=True,
    )
    workspace = Workspace(
        id="workspace-2",
        owner_user_id="pending",
        name="Workspace",
        slug="workspace-2",
        schema_name="ws_workspace_2",
        storage_path=str(tmp_path),
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    workspace.owner_user_id = user.id
    db_session.add(workspace)
    db_session.commit()
    service = ManualDatasetService(db_session)

    with pytest.raises(ManualDatasetError):
        service.get_dataset(dataset_id="missing", user=user)


def test_manual_dataset_service_create_from_upload_url_and_remmaq(db_session, tmp_path: Path, monkeypatch) -> None:
    user = User(
        email="manual-create@example.com",
        full_name="Owner",
        password_hash="hash",
        role=UserRole.researcher.value,
        status=UserStatus.active.value,
        is_active=True,
        is_verified=True,
    )
    workspace = Workspace(
        id="workspace-create",
        owner_user_id="pending",
        name="Workspace",
        slug="workspace-create",
        schema_name="ws_workspace_create",
        storage_path=str(tmp_path),
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    workspace.owner_user_id = user.id
    db_session.add(workspace)
    db_session.commit()
    service = ManualDatasetService(db_session)
    csv_content = b"observed_at,station,variable,value\n2025-01-01,A,PM25,10\n"

    uploaded = service.create_from_upload(
        workspace_id=workspace.id,
        user=user,
        filename="upload.csv",
        content=csv_content,
    )
    monkeypatch.setattr(
        manual_dataset_service_module.httpx,
        "get",
        lambda *_args, **_kwargs: httpx.Response(
            200,
            content=csv_content,
            request=httpx.Request("GET", "https://raw.githubusercontent.com/org/repo/main/manual.csv"),
        ),
    )
    from_url = service.create_from_url(
        workspace_id=workspace.id,
        user=user,
        source_url="https://raw.githubusercontent.com/org/repo/main/manual.csv",
    )

    class FakeEtlService:
        def __init__(self, _db) -> None:
            pass

        def extract_remmaq_dataframe(self, **_kwargs):
            return (
                pd.DataFrame(
                    {
                        "observed_at": ["2025-01-01"],
                        "station_code": ["A"],
                        "variable_code": ["PM25"],
                        "value": [10.0],
                    }
                ),
                [{"variable_code": "PM25"}],
            )

    monkeypatch.setattr(manual_dataset_service_module, "EtlService", FakeEtlService)
    from_remmaq = service.create_from_remmaq(
        workspace_id=workspace.id,
        user=user,
        variable_codes=["PM25"],
        max_archives=1,
        observed_from=None,
        observed_to=None,
    )

    assert uploaded.source_kind == "upload"
    assert from_url.source_kind == "github_raw"
    assert from_remmaq.source_kind == "remmaq"

    with pytest.raises(ManualDatasetError, match="CSV"):
        service.create_from_upload(workspace_id=workspace.id, user=user, filename="bad.json", content=b"{}")
    with pytest.raises(ManualDatasetError, match="raw"):
        service.create_from_url(workspace_id=workspace.id, user=user, source_url="https://example.test/data.txt")


def test_manual_dataset_service_access_stale_and_delete_etl_cleanup(db_session, tmp_path: Path) -> None:
    owner = User(
        email="manual-owner@example.com",
        full_name="Owner",
        password_hash="hash",
        role=UserRole.researcher.value,
        status=UserStatus.active.value,
        is_active=True,
        is_verified=True,
    )
    other = User(
        email="manual-other@example.com",
        full_name="Other",
        password_hash="hash",
        role=UserRole.researcher.value,
        status=UserStatus.active.value,
        is_active=True,
        is_verified=True,
    )
    db_session.add_all([owner, other])
    db_session.commit()
    workspace = Workspace(
        id="workspace-stale",
        owner_user_id=owner.id,
        name="Workspace",
        slug="workspace-stale",
        schema_name="ws_workspace_stale",
        storage_path=str(tmp_path),
        is_active=True,
    )
    etl_run = EtlRun(trigger_type="manual", source="test", status="completed")
    db_session.add_all([workspace, etl_run])
    db_session.commit()
    source = SourceFile(
        etl_run_id=etl_run.id,
        source_type="manual",
        source_url=None,
        original_name="source.csv",
        local_archive_path=str(tmp_path / "source.csv"),
        extracted_path=str(tmp_path / "extracted"),
        checksum_sha256="e" * 64,
        status="completed",
    )
    dataset = ManualDataset(
        id="dataset-stale",
        workspace_id=workspace.id,
        owner_user_id=owner.id,
        name="Dataset",
        source_kind="upload",
        source_url=None,
        original_file_name="raw.csv",
        raw_file_path=str(tmp_path / "missing.csv"),
        processed_file_path=str(tmp_path / "missing-processed.csv"),
        checksum_sha256="f" * 64,
        status="finalized_generic",
        storage_format="csv",
        dataset_kind="generic",
        row_count=0,
        column_count=0,
        mapping_config={},
        profile_summary={"row_count": 0, "column_count": 0},
        column_schema=[],
        preview_rows=[],
        operation_pipeline=[],
        etl_run_id=etl_run.id,
    )
    db_session.add(source)
    db_session.commit()
    dataset.source_file_id = source.id
    db_session.add(dataset)
    db_session.commit()
    service = ManualDatasetService(db_session)

    stale = service.list_datasets(workspace_id=workspace.id, user=owner)

    assert stale[0].status == "missing_files"
    with pytest.raises(ManualDatasetError, match="workspace"):
        service.list_datasets(workspace_id=workspace.id, user=other)
    with pytest.raises(ManualDatasetError, match="dataset"):
        service.get_dataset(dataset_id=dataset.id, user=other)

    service.delete_dataset(dataset_id=dataset.id, user=owner)

    assert db_session.get(ManualDataset, dataset.id) is None
    assert db_session.get(SourceFile, source.id) is None
    assert db_session.get(EtlRun, etl_run.id) is None
