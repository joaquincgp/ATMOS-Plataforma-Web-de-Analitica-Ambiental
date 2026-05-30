from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.api import deps
from app.schemas.auth import UserRole
from app.services.auth_service import AuthError


def test_get_db_session_yields_from_configured_database_generator(monkeypatch) -> None:
    sentinel = object()

    def fake_get_db():
        yield sentinel

    monkeypatch.setattr(deps, "get_db", fake_get_db)

    generator = deps.get_db_session()
    assert next(generator) is sentinel

    with pytest.raises(StopIteration):
        next(generator)


def test_get_current_user_requires_bearer_credentials(monkeypatch) -> None:
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="token")
    user = SimpleNamespace(id="user-1", role=UserRole.researcher.value)
    monkeypatch.setattr(deps, "get_user_from_access_token", lambda db, token: user)

    assert deps.get_current_user(credentials=credentials, db=None) is user

    with pytest.raises(HTTPException) as missing_credentials:
        deps.get_current_user(credentials=None, db=None)
    assert missing_credentials.value.status_code == 401

    with pytest.raises(HTTPException) as bad_scheme:
        deps.get_current_user(
            credentials=HTTPAuthorizationCredentials(scheme="Basic", credentials="token"),
            db=None,
        )
    assert bad_scheme.value.status_code == 401

    monkeypatch.setattr(
        deps,
        "get_user_from_access_token",
        lambda db, token: (_ for _ in ()).throw(AuthError("invalid token")),
    )
    with pytest.raises(HTTPException) as invalid_token:
        deps.get_current_user(credentials=credentials, db=None)
    assert invalid_token.value.status_code == 401


def test_require_roles_allows_matching_roles_and_rejects_others() -> None:
    dependency = deps.require_roles(UserRole.admin)

    admin = SimpleNamespace(role=UserRole.admin.value)
    researcher = SimpleNamespace(role=UserRole.researcher.value)

    assert dependency(admin) is admin
    with pytest.raises(HTTPException) as forbidden:
        dependency(researcher)
    assert forbidden.value.status_code == 403
