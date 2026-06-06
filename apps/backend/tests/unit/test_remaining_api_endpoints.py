import asyncio
from datetime import datetime
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException, Request, UploadFile
from starlette.datastructures import Headers
from starlette.types import Scope

from app.api.v1.endpoints import auth, etl, workspaces
from app.main import handle_database_operational_error
from app.schemas.analytics import AnalyticsQueryResponse
from app.schemas.auth import (
    AdminCreateUserRequest,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    LogoutRequest,
    MessageResponse,
    RefreshTokenRequest,
    RegisterRequest,
    ResetPasswordRequest,
    SessionResponse,
    TokenPairResponse,
    UpdateProfileRequest,
    UserResponse,
    UserRole,
    UserStatus,
)
from app.schemas.etl import (
    ManualDatasetCreateFromRemmaqRequest,
    ManualDatasetCreateFromUrlRequest,
    ManualDatasetFinalizeRequest,
    ManualDatasetResponse,
    ManualDatasetSummary,
    ManualDatasetUpdateRequest,
)
from app.schemas.workspace import (
    DashboardResponse,
    DashboardSaveRequest,
    WorkspaceCreateRequest,
    WorkspaceResponse,
    WorkspaceUpdateRequest,
)
from app.services.auth_service import AuthError
from app.services.manual_dataset import ManualDatasetError
from app.services.workspace_service import WorkspaceError

# pylint: disable=protected-access


def _request() -> Request:
    scope: Scope = {
        "type": "http",
        "method": "POST",
        "path": "/",
        "headers": Headers({"user-agent": "pytest", "authorization": "Bearer token"}).raw,
        "client": ("127.0.0.1", 12345),
        "scheme": "http",
        "server": ("testserver", 80),
    }
    return Request(scope)


def _user_response() -> UserResponse:
    return UserResponse(
        id="user-1",
        email="user@example.com",
        full_name="User Example",
        role=UserRole.researcher,
        status=UserStatus.active,
        is_active=True,
        is_verified=True,
        created_at=datetime(2025, 1, 1),
    )


def _token_pair() -> TokenPairResponse:
    return TokenPairResponse(
        access_token="access",
        refresh_token="refresh-token",
        expires_in=3600,
        refresh_expires_in=86400,
        user=_user_response(),
    )


def test_auth_endpoints_delegate_and_map_errors(monkeypatch) -> None:
    user = _user_response()
    request = _request()

    monkeypatch.setattr(auth, "register_user", lambda db, payload: user)
    monkeypatch.setattr(auth, "admin_create_user", lambda db, payload: user)
    monkeypatch.setattr(auth, "login_user", lambda db, payload, user_agent, ip_address: _token_pair())
    monkeypatch.setattr(auth, "refresh_access_token", lambda db, payload, user_agent, ip_address: _token_pair())
    monkeypatch.setattr(auth, "logout_user", lambda db, refresh_token: MessageResponse(message="done"))
    monkeypatch.setattr(auth, "validate_session", lambda db, token: SessionResponse(authenticated=True, user=user))
    monkeypatch.setattr(auth, "forgot_password", lambda db, payload: ForgotPasswordResponse(message="ok"))
    monkeypatch.setattr(auth, "reset_password", lambda db, payload: MessageResponse(message="reset"))
    monkeypatch.setattr(auth, "update_profile", lambda db, current_user, payload: user)

    assert auth.register(RegisterRequest(email="user@example.com", full_name="User", password="password123")) is user
    assert auth.create_user_by_admin(
        AdminCreateUserRequest(email="user@example.com", full_name="User", password="password123"),
        _admin=SimpleNamespace(),
    ) is user
    assert auth.login(LoginRequest(email="user@example.com", password="password123"), request).access_token == "access"
    assert (
        auth.refresh_token(RefreshTokenRequest(refresh_token="refresh-token"), request).refresh_token
        == "refresh-token"
    )
    assert auth.logout(LogoutRequest(refresh_token="refresh-token"), _user=SimpleNamespace()).message == "done"
    assert auth.get_session(request, _user=SimpleNamespace()).authenticated is True
    assert auth.get_me(SimpleNamespace(**user.model_dump())).email == "user@example.com"
    assert auth.patch_profile(UpdateProfileRequest(full_name="Updated User"), user=SimpleNamespace()) is user
    assert auth.forgot_password_route(ForgotPasswordRequest(email="user@example.com")).message == "ok"
    reset_response = auth.reset_password_route(
        ResetPasswordRequest(token="reset-token-ok", new_password="password123")
    )
    assert reset_response.message == "reset"

    monkeypatch.setattr(auth, "register_user", lambda db, payload: (_ for _ in ()).throw(AuthError("bad register")))
    with pytest.raises(HTTPException) as exc:
        auth.register(RegisterRequest(email="user@example.com", full_name="User", password="password123"))
    assert exc.value.status_code == 400

    monkeypatch.setattr(
        auth,
        "login_user",
        lambda db, payload, user_agent, ip_address: (_ for _ in ()).throw(AuthError("bad login")),
    )
    with pytest.raises(HTTPException) as login_exc:
        auth.login(LoginRequest(email="user@example.com", password="password123"), request)
    assert login_exc.value.status_code == 401


def test_auth_endpoints_map_remaining_auth_errors(monkeypatch) -> None:
    request = _request()

    monkeypatch.setattr(auth, "admin_create_user", lambda db, payload: (_ for _ in ()).throw(AuthError("bad admin")))
    with pytest.raises(HTTPException) as admin_exc:
        auth.create_user_by_admin(
            AdminCreateUserRequest(email="user@example.com", full_name="User", password="password123"),
            _admin=SimpleNamespace(),
        )
    assert admin_exc.value.status_code == 400

    monkeypatch.setattr(
        auth,
        "refresh_access_token",
        lambda db, payload, user_agent, ip_address: (_ for _ in ()).throw(AuthError("bad refresh")),
    )
    with pytest.raises(HTTPException) as refresh_exc:
        auth.refresh_token(RefreshTokenRequest(refresh_token="refresh-token"), request)
    assert refresh_exc.value.status_code == 401

    monkeypatch.setattr(auth, "validate_session", lambda db, token: (_ for _ in ()).throw(AuthError("bad session")))
    with pytest.raises(HTTPException) as session_exc:
        auth.get_session(request, _user=SimpleNamespace())
    assert session_exc.value.status_code == 401

    monkeypatch.setattr(auth, "update_profile", lambda db, user, payload: (_ for _ in ()).throw(AuthError("bad patch")))
    with pytest.raises(HTTPException) as profile_exc:
        auth.patch_profile(UpdateProfileRequest(full_name="Updated User"), user=SimpleNamespace())
    assert profile_exc.value.status_code == 400

    monkeypatch.setattr(auth, "reset_password", lambda db, payload: (_ for _ in ()).throw(AuthError("bad reset")))
    with pytest.raises(HTTPException) as reset_exc:
        auth.reset_password_route(ResetPasswordRequest(token="reset-token-ok", new_password="password123"))
    assert reset_exc.value.status_code == 400


def _run(run_id: str = "run-1") -> SimpleNamespace:
    return SimpleNamespace(
        id=run_id,
        trigger_type="manual",
        source="manual-upload",
        status="completed",
        started_at=datetime(2025, 1, 1),
        finished_at=None,
        archives_discovered=1,
        archives_processed=1,
        records_inserted=2,
        records_updated=0,
        records_skipped=0,
        details={},
    )


class FakeEtlService:
    def __init__(self, db):
        self.db = db

    def initialize_database(self):
        return {"status": "initialized", "database": "sqlite://", "timestamp": "2025-01-01T00:00:00Z"}

    def sync_remmaq(self, **_kwargs):
        return _run("sync")

    def create_remmaq_run(self, **_kwargs):
        return _run("queued"), ["PM25"], 1, False, None, None

    def ingest_manual_file(self, **_kwargs):
        return _run("upload")

    def create_manual_run(self, **_kwargs):
        return _run("queued-upload")

    def list_runs(self, limit):
        return [_run(f"run-{limit}")]

    def get_run(self, run_id):
        return _run(run_id) if run_id != "missing" else None

    def get_metrics(self):
        return {"total_measurements": 2, "total_stations": 1, "total_variables": 1, "latest_run_status": "completed"}

    def get_preview(self, **_kwargs):
        return {"run_id": "run-1", "rows": []}


def _manual_response() -> ManualDatasetResponse:
    return ManualDatasetResponse(
        id="dataset-1",
        workspace_id="workspace-1",
        owner_user_id="user-1",
        source_file_id=None,
        name="Dataset",
        original_file_name="dataset.csv",
        dataset_kind="generic",
        status="draft",
        source_kind="upload",
        source_url=None,
        storage_format="csv",
        row_count=2,
        column_count=2,
        operation_pipeline=[],
        mapping={},
        summary=ManualDatasetSummary(row_count=2, column_count=2),
        columns=[],
        preview_rows=[],
        etl_run_id=None,
        created_at=datetime(2025, 1, 1),
        updated_at=datetime(2025, 1, 1),
        error_message=None,
    )


class FakeManualDatasetService:
    def __init__(self, db):
        self.db = db

    def list_datasets(self, **_kwargs):
        return [_manual_response()]

    def create_from_upload(self, **_kwargs):
        return _manual_response()

    def create_from_url(self, **_kwargs):
        return _manual_response()

    def create_from_remmaq(self, **_kwargs):
        return _manual_response()

    def get_dataset(self, **_kwargs):
        return _manual_response()

    def get_analytics_rows(self, **_kwargs):
        return AnalyticsQueryResponse(rows=[], row_count=0, truncated=False)

    def update_dataset(self, **_kwargs):
        return _manual_response()

    def finalize_dataset(self, **_kwargs):
        return _manual_response()

    def delete_dataset(self, **_kwargs):
        return None


def test_etl_endpoints_delegate_and_validate_uploads(monkeypatch) -> None:
    monkeypatch.setattr(etl, "EtlService", FakeEtlService)
    monkeypatch.setattr(etl, "ManualDatasetService", FakeManualDatasetService)
    background_tasks = BackgroundTasks()
    upload = UploadFile(filename="data.csv", file=BytesIO(b"a,b\n1,2\n"))
    bad_upload = UploadFile(filename="data.json", file=BytesIO(b"{}"))

    assert etl.initialize_database().status == "initialized"
    assert etl.sync_remmaq().id == "sync"
    assert etl.start_sync_remmaq(background_tasks).id == "queued"
    assert asyncio.run(etl.upload_manual_file(upload)).id == "upload"
    assert asyncio.run(
        etl.start_upload_manual_file(background_tasks, UploadFile(filename="data.csv", file=BytesIO(b"x")))
    ).id == "queued-upload"
    assert etl.list_runs(limit=5)[0].id == "run-5"
    assert etl.get_run("run-1").id == "run-1"
    assert etl.get_metrics().total_measurements == 2
    assert etl.get_preview().run_id == "run-1"
    assert len(etl.list_manual_datasets(workspace_id="workspace-1", user=SimpleNamespace())) == 1
    assert asyncio.run(
        etl.upload_manual_dataset(
            workspace_id="workspace-1",
            file=UploadFile(filename="data.csv", file=BytesIO(b"x")),
            user=SimpleNamespace(),
        )
    ).id == "dataset-1"
    from_url = etl.create_manual_dataset_from_url(
        ManualDatasetCreateFromUrlRequest(
            workspace_id="workspace-1",
            source_url="https://example.test/data.csv",
        ),
        user=SimpleNamespace(),
    )
    from_remmaq = etl.create_manual_dataset_from_remmaq(
        ManualDatasetCreateFromRemmaqRequest(workspace_id="workspace-1"),
        user=SimpleNamespace(),
    )
    assert from_url.id == "dataset-1"
    assert from_remmaq.id == "dataset-1"
    assert etl.get_manual_dataset("dataset-1", user=SimpleNamespace()).id == "dataset-1"
    assert etl.get_manual_dataset_analytics_preview("dataset-1", user=SimpleNamespace()).row_count == 0
    preview = etl.preview_manual_dataset("dataset-1", ManualDatasetUpdateRequest(), user=SimpleNamespace())
    finalized = etl.finalize_manual_dataset("dataset-1", ManualDatasetFinalizeRequest(), user=SimpleNamespace())
    assert preview.id == "dataset-1"
    assert finalized.id == "dataset-1"
    assert etl.delete_manual_dataset("dataset-1", user=SimpleNamespace()) is None

    with pytest.raises(HTTPException) as missing:
        etl.get_run("missing")
    assert missing.value.status_code == 404

    with pytest.raises(HTTPException) as invalid_upload:
        asyncio.run(etl.upload_manual_file(bad_upload))
    assert invalid_upload.value.status_code == 400


def test_etl_endpoints_convert_service_errors(monkeypatch) -> None:
    class FailingEtlService(FakeEtlService):
        def sync_remmaq(self, **_kwargs):
            raise ValueError("bad sync")

    class FailingManualService(FakeManualDatasetService):
        def list_datasets(self, **_kwargs):
            raise ManualDatasetError("bad manual")

    monkeypatch.setattr(etl, "EtlService", FailingEtlService)
    with pytest.raises(HTTPException) as sync_exc:
        etl.sync_remmaq()
    assert sync_exc.value.status_code == 400

    monkeypatch.setattr(etl, "ManualDatasetService", FailingManualService)
    with pytest.raises(HTTPException) as manual_exc:
        etl.list_manual_datasets(workspace_id="workspace-1", user=SimpleNamespace())
    assert manual_exc.value.status_code == 400


def test_etl_endpoints_convert_remaining_manual_and_queue_errors(monkeypatch) -> None:
    class FailingCreateRunService(FakeEtlService):
        def create_remmaq_run(self, **_kwargs):
            raise ValueError("bad queue")

        def ingest_manual_file(self, **_kwargs):
            raise ValueError("bad upload")

    class FailingManualService(FakeManualDatasetService):
        def create_from_upload(self, **_kwargs):
            raise ManualDatasetError("bad manual upload")

        def create_from_url(self, **_kwargs):
            raise ManualDatasetError("bad url")

        def create_from_remmaq(self, **_kwargs):
            raise ManualDatasetError("bad remmaq")

        def get_dataset(self, **_kwargs):
            raise ManualDatasetError("missing")

        def get_analytics_rows(self, **_kwargs):
            raise ManualDatasetError("bad analytics")

        def update_dataset(self, **_kwargs):
            raise ManualDatasetError("bad preview")

        def finalize_dataset(self, **_kwargs):
            raise ManualDatasetError("bad finalize")

        def delete_dataset(self, **_kwargs):
            raise ManualDatasetError("bad delete")

    monkeypatch.setattr(etl, "EtlService", FailingCreateRunService)
    with pytest.raises(HTTPException) as queue_exc:
        etl.start_sync_remmaq(BackgroundTasks())
    assert queue_exc.value.status_code == 400

    with pytest.raises(HTTPException) as upload_exc:
        asyncio.run(etl.upload_manual_file(UploadFile(filename="data.csv", file=BytesIO(b"x"))))
    assert upload_exc.value.status_code == 400

    with pytest.raises(HTTPException) as start_upload_exc:
        asyncio.run(
            etl.start_upload_manual_file(
                BackgroundTasks(),
                UploadFile(filename="data.json", file=BytesIO(b"{}")),
            )
        )
    assert start_upload_exc.value.status_code == 400

    monkeypatch.setattr(etl, "ManualDatasetService", FailingManualService)
    with pytest.raises(HTTPException) as manual_upload_exc:
        asyncio.run(
            etl.upload_manual_dataset(
                workspace_id="workspace-1",
                file=UploadFile(filename="data.csv", file=BytesIO(b"x")),
                user=SimpleNamespace(),
            )
        )
    assert manual_upload_exc.value.status_code == 400

    manual_calls = [
        lambda: etl.create_manual_dataset_from_url(
            ManualDatasetCreateFromUrlRequest(
                workspace_id="workspace-1",
                source_url="https://example.test/data.csv",
            ),
            user=SimpleNamespace(),
        ),
        lambda: etl.create_manual_dataset_from_remmaq(
            ManualDatasetCreateFromRemmaqRequest(workspace_id="workspace-1"),
            user=SimpleNamespace(),
        ),
        lambda: etl.get_manual_dataset("dataset-1", user=SimpleNamespace()),
        lambda: etl.get_manual_dataset_analytics_preview("dataset-1", user=SimpleNamespace()),
        lambda: etl.preview_manual_dataset("dataset-1", ManualDatasetUpdateRequest(), user=SimpleNamespace()),
        lambda: etl.finalize_manual_dataset("dataset-1", ManualDatasetFinalizeRequest(), user=SimpleNamespace()),
        lambda: etl.delete_manual_dataset("dataset-1", user=SimpleNamespace()),
    ]
    expected_status_codes = [400, 400, 404, 400, 400, 400, 400]
    for call, expected_status in zip(manual_calls, expected_status_codes, strict=True):
        with pytest.raises(HTTPException) as exc:
            call()
        assert exc.value.status_code == expected_status


def test_etl_background_tasks_close_sessions_and_database_error_handler(monkeypatch) -> None:
    closed: list[bool] = []
    calls: list[tuple[str, str]] = []

    class FakeSession:
        def close(self) -> None:
            closed.append(True)

    class BackgroundEtlService:
        def __init__(self, db):
            self.db = db

        def run_remmaq_sync(self, **kwargs):
            calls.append(("remmaq", kwargs["run_id"]))

        def run_manual_ingestion(self, **kwargs):
            calls.append(("manual", kwargs["filename"]))

    def fake_session_local() -> FakeSession:
        return FakeSession()

    monkeypatch.setattr(etl, "SessionLocal", fake_session_local)
    monkeypatch.setattr(etl, "EtlService", BackgroundEtlService)

    etl._run_remmaq_sync_background(
        run_id="run-1",
        selected_variables=["PM25"],
        max_archives=1,
        force_reprocess=False,
        observed_from=None,
        observed_to=None,
    )
    etl._run_manual_ingestion_background(
        run_id="run-2",
        filename="manual.csv",
        content=b"a,b\n1,2\n",
        force_reprocess=True,
    )
    response = asyncio.run(handle_database_operational_error(_request(), Exception("db down")))

    assert calls == [("remmaq", "run-1"), ("manual", "manual.csv")]
    assert closed == [True, True]
    assert response.status_code == 503


def _workspace_response() -> WorkspaceResponse:
    return WorkspaceResponse(
        id="workspace-1",
        owner_user_id="user-1",
        name="Workspace",
        slug="workspace",
        schema_name="ws_user_workspace",
        storage_path="/tmp/workspace",
        description=None,
        is_active=True,
        created_at=datetime(2025, 1, 1),
        updated_at=datetime(2025, 1, 1),
    )


def _dashboard_response() -> DashboardResponse:
    return DashboardResponse(
        id="dash-1",
        name="Dashboard",
        description=None,
        blocks=[],
        filters={},
        created_by="user-1",
        created_at=datetime(2025, 1, 1),
        updated_at=datetime(2025, 1, 1),
    )


def test_workspace_endpoints_delegate_and_map_errors(monkeypatch) -> None:
    workspace = _workspace_response()
    dashboard = _dashboard_response()

    monkeypatch.setattr(workspaces, "list_workspaces", lambda db, user: [workspace])
    monkeypatch.setattr(workspaces, "create_workspace", lambda db, user, payload: workspace)
    monkeypatch.setattr(workspaces, "get_workspace", lambda db, user, workspace_id: workspace)
    monkeypatch.setattr(workspaces, "update_workspace", lambda db, user, workspace_id, payload: workspace)
    monkeypatch.setattr(workspaces, "delete_workspace", lambda db, user, workspace_id: None)
    monkeypatch.setattr(workspaces, "list_dashboards", lambda db, user, workspace_id, limit: [dashboard])
    monkeypatch.setattr(workspaces, "save_dashboard", lambda db, user, workspace_id, payload: dashboard)

    assert workspaces.get_user_workspaces(user=SimpleNamespace()) == [workspace]
    created_workspace = workspaces.create_user_workspace(
        WorkspaceCreateRequest(name="Workspace"),
        user=SimpleNamespace(),
    )
    assert created_workspace is workspace
    assert workspaces.get_workspace_details("workspace-1", user=SimpleNamespace()) is workspace
    patched_workspace = workspaces.patch_workspace(
        "workspace-1",
        WorkspaceUpdateRequest(name="Updated"),
        user=SimpleNamespace(),
    )
    assert patched_workspace is workspace
    assert workspaces.remove_workspace("workspace-1", user=SimpleNamespace()) == {
        "message": "Workspace deleted successfully."
    }
    assert workspaces.get_workspace_dashboards("workspace-1", user=SimpleNamespace()) == [dashboard]
    saved_dashboard = workspaces.save_workspace_dashboard(
        "workspace-1",
        DashboardSaveRequest(name="Dashboard"),
        user=SimpleNamespace(),
    )
    assert saved_dashboard is dashboard

    monkeypatch.setattr(
        workspaces,
        "get_workspace",
        lambda db, user, workspace_id: (_ for _ in ()).throw(WorkspaceError("missing")),
    )
    with pytest.raises(HTTPException) as missing:
        workspaces.get_workspace_details("workspace-1", user=SimpleNamespace())
    assert missing.value.status_code == 404

    monkeypatch.setattr(
        workspaces,
        "create_workspace",
        lambda db, user, payload: (_ for _ in ()).throw(WorkspaceError("bad")),
    )
    with pytest.raises(HTTPException) as bad:
        workspaces.create_user_workspace(WorkspaceCreateRequest(name="Workspace"), user=SimpleNamespace())
    assert bad.value.status_code == 400


def test_workspace_endpoints_map_remaining_errors(monkeypatch) -> None:
    failing_functions = {
        "update_workspace": lambda db, user, workspace_id, payload: (_ for _ in ()).throw(WorkspaceError("bad patch")),
        "delete_workspace": lambda db, user, workspace_id: (_ for _ in ()).throw(WorkspaceError("bad delete")),
        "list_dashboards": lambda db, user, workspace_id, limit: (_ for _ in ()).throw(WorkspaceError("missing")),
        "save_dashboard": lambda db, user, workspace_id, payload: (_ for _ in ()).throw(WorkspaceError("bad save")),
    }
    for name, replacement in failing_functions.items():
        monkeypatch.setattr(workspaces, name, replacement)

    calls = [
        lambda: workspaces.patch_workspace(
            "workspace-1",
            WorkspaceUpdateRequest(name="Updated"),
            user=SimpleNamespace(),
        ),
        lambda: workspaces.remove_workspace("workspace-1", user=SimpleNamespace()),
        lambda: workspaces.get_workspace_dashboards("workspace-1", user=SimpleNamespace()),
        lambda: workspaces.save_workspace_dashboard(
            "workspace-1",
            DashboardSaveRequest(name="Dashboard"),
            user=SimpleNamespace(),
        ),
    ]
    expected_status_codes = [400, 400, 404, 400]
    for call, expected_status in zip(calls, expected_status_codes, strict=True):
        with pytest.raises(HTTPException) as exc:
            call()
        assert exc.value.status_code == expected_status
