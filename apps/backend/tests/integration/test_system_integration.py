"""System integration tests for ATMOS.

These tests exercise the platform end-to-end through the public HTTP surface:
each request travels the full stack — FastAPI routing, dependency injection,
JWT authentication/authorization, the service layer and a real (SQLite)
database — instead of calling functions in isolation. They complement the
unit suite by proving that the modules interoperate correctly once wired
together, which is exactly what an integration level is meant to verify.

The database is an in-memory SQLite instance shared across the request and the
seeding session via a StaticPool, and injected into the app by overriding the
`get_db_session` dependency. The app is driven without its lifespan context on
purpose, so the background ML worker and the snapshot refresh loop never start:
the tests observe only the request/response behavior under test.
"""
# pylint: disable=redefined-outer-name
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db_session
from app.main import app
from app.models import EtlRun, Measurement, SourceFile, Station, User, Variable, Workspace
from app.models.base import Base
from app.models.measurement import DATA_ORIGIN_USER
from app.schemas.auth import UserRole, UserStatus
from app.services.auth_service import create_access_token, hash_password
from app.services.etl.helpers import compute_record_hash


@pytest.fixture()
def session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    try:
        yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    finally:
        engine.dispose()


@pytest.fixture()
def client(session_factory):
    def _override_get_db_session():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db_session] = _override_get_db_session
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db_session, None)


def _seed_user(
    session_factory,
    *,
    role: UserRole,
    email: str,
    password: str = "Str0ngPass1",
) -> SimpleNamespace:
    db = session_factory()
    try:
        user = User(
            email=email,
            full_name="Integration User",
            password_hash=hash_password(password),
            role=role.value,
            status=UserStatus.active.value,
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        db.commit()
        token = create_access_token(user)
        return SimpleNamespace(
            id=user.id,
            email=email,
            password=password,
            token=token,
            headers={"Authorization": f"Bearer {token}"},
        )
    finally:
        db.close()


def _seed_measurements(session_factory, *, data_origin: str = DATA_ORIGIN_USER, source_type: str = "manual") -> None:
    db = session_factory()
    try:
        run = EtlRun(trigger_type="manual", source="integration", status="completed")
        station = Station(code="BELISARIO", name="Belisario", latitude=-0.18, longitude=-78.49)
        variable = Variable(code="PM25", display_name="PM2.5", category="pollutant", default_unit="ug/m3")
        db.add_all([run, station, variable])
        db.commit()
        source = SourceFile(
            etl_run_id=run.id,
            source_type=source_type,
            source_url=None,
            original_name="integration.csv",
            local_archive_path="integration.csv",
            checksum_sha256="c" * 64,
            status="completed",
            row_count=3,
        )
        db.add(source)
        db.commit()
        base = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
        for index, value in enumerate((12.0, 18.0, 25.0)):
            observed_at = base - timedelta(hours=index)
            db.add(
                Measurement(
                    station_id=station.id,
                    variable_id=variable.id,
                    observed_at=observed_at.replace(tzinfo=None),
                    value=value,
                    unit=variable.default_unit,
                    source_file_id=source.id,
                    record_hash=compute_record_hash("BELISARIO", "PM25", observed_at),
                    data_origin=data_origin,
                )
            )
        db.commit()
    finally:
        db.close()


def _seed_workspace(session_factory, *, owner_id: str, workspace_id: str = "ws-int") -> None:
    db = session_factory()
    try:
        db.add(
            Workspace(
                id=workspace_id,
                owner_user_id=owner_id,
                name="Integration Workspace",
                slug=workspace_id,
                schema_name=f"ws_{workspace_id}",
                storage_path="/tmp/ws-int",
                is_active=True,
            )
        )
        db.commit()
    finally:
        db.close()


# PI-01 — Platform health endpoint answers over the full HTTP stack.
def test_health_endpoint_reports_service_up(client) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


# PI-02 — Full authentication flow: valid credentials mint a token, the token
# authenticates a protected endpoint, and wrong credentials are rejected.
def test_authentication_flow_issues_and_validates_tokens(client, session_factory) -> None:
    researcher = _seed_user(session_factory, role=UserRole.researcher, email="researcher@udla.edu.ec")

    login = client.post(
        "/api/v1/auth/login",
        json={"email": researcher.email, "password": researcher.password},
    )
    assert login.status_code == 200
    access_token = login.json()["access_token"]
    assert access_token

    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access_token}"})
    assert me.status_code == 200
    assert me.json()["email"] == researcher.email

    wrong = client.post(
        "/api/v1/auth/login",
        json={"email": researcher.email, "password": "WrongPass123"},
    )
    assert wrong.status_code == 401


# PI-03 — Authorization is enforced: a protected endpoint rejects anonymous
# requests and accepts an authenticated researcher.
def test_protected_endpoint_requires_authentication(client, session_factory) -> None:
    anonymous = client.get("/api/v1/workspaces/")
    assert anonymous.status_code == 401

    researcher = _seed_user(session_factory, role=UserRole.researcher, email="ws-user@udla.edu.ec")
    authorized = client.get("/api/v1/workspaces/", headers=researcher.headers)
    assert authorized.status_code == 200
    assert isinstance(authorized.json(), list)


# PI-04 — Role-based access control: an admin-only endpoint forbids a
# researcher (403) and serves an admin (200).
def test_role_based_access_control_on_admin_endpoint(client, session_factory) -> None:
    researcher = _seed_user(session_factory, role=UserRole.researcher, email="not-admin@udla.edu.ec")
    admin = _seed_user(session_factory, role=UserRole.admin, email="admin@udla.edu.ec")

    forbidden = client.get("/api/v1/auth/admin/users", headers=researcher.headers)
    assert forbidden.status_code == 403

    allowed = client.get("/api/v1/auth/admin/users", headers=admin.headers)
    assert allowed.status_code == 200
    assert isinstance(allowed.json(), list)


# PI-05 — Workspace listing returns the caller's own workspace across the
# routing + service + DB chain.
def test_workspace_listing_returns_owned_workspace(client, session_factory) -> None:
    owner = _seed_user(session_factory, role=UserRole.researcher, email="owner@udla.edu.ec")
    _seed_workspace(session_factory, owner_id=owner.id)

    response = client.get("/api/v1/workspaces/", headers=owner.headers)
    assert response.status_code == 200
    names = [item["name"] for item in response.json()]
    assert "Integration Workspace" in names


# PI-06 — Public dashboard snapshot aggregates seeded public measurements and
# never performs network I/O in the request path.
def test_public_air_quality_snapshot_aggregates_seeded_data(client, session_factory) -> None:
    _seed_measurements(session_factory, source_type="public_dashboard")

    response = client.get(
        "/api/v1/public/air-quality",
        params={"variable_code": "PM25", "period": "72h", "force_sync": True},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["variable_code"] == "PM25"
    assert "stations" in payload and "variables" in payload
    assert payload["observation_count"] >= 1


# PI-07 — Analytics query traverses auth + service + DB and returns seeded rows.
def test_analytics_query_returns_seeded_measurements(client, session_factory) -> None:
    analyst = _seed_user(session_factory, role=UserRole.researcher, email="analyst@udla.edu.ec")
    _seed_measurements(session_factory, data_origin=DATA_ORIGIN_USER)

    response = client.post("/api/v1/analytics/query", json={}, headers=analyst.headers)
    assert response.status_code == 200
    payload = response.json()
    assert payload["row_count"] >= 1
    assert isinstance(payload["truncated"], bool)


# PI-08 — Station catalog is served from the database through the API to an
# authenticated researcher (the stations router is auth-gated).
def test_station_catalog_lists_seeded_stations(client, session_factory) -> None:
    researcher = _seed_user(session_factory, role=UserRole.researcher, email="stations-user@udla.edu.ec")
    _seed_measurements(session_factory, data_origin=DATA_ORIGIN_USER)

    response = client.get("/api/v1/stations/", headers=researcher.headers)
    assert response.status_code == 200
    payload = response.json()
    codes = [station["code"] for station in payload["items"]]
    assert "BELISARIO" in codes


# PI-09 — ML Experiments module exposes its registered algorithms to an
# authenticated researcher (auth + registry integration).
def test_ml_experiments_algorithms_available_to_researcher(client, session_factory) -> None:
    researcher = _seed_user(session_factory, role=UserRole.researcher, email="ml-user@udla.edu.ec")

    response = client.get("/api/v1/ml-experiments/algorithms", headers=researcher.headers)
    assert response.status_code == 200
    algorithms = response.json()["algorithms"]
    assert {"lstm", "gru", "transformer"}.issubset(set(algorithms))
