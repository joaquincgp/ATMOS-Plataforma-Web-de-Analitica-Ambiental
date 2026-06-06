from datetime import datetime, timedelta
from types import SimpleNamespace

import bcrypt
import pytest
from jose import jwt

from app.schemas.auth import UserRole, UserStatus
from app.services import auth_service
from app.services.auth_service import (
    AuthError,
    create_access_token,
    decode_access_token,
    hash_password,
    logout_user,
    validate_session,
    verify_password,
)


def _user(**overrides):
    values = {
        "id": "user-1",
        "email": "user@example.com",
        "full_name": "User Example",
        "role": UserRole.researcher.value,
        "status": UserStatus.active.value,
        "is_active": True,
        "is_verified": True,
        "created_at": datetime(2025, 1, 1),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_hash_password_and_verify_password_roundtrip() -> None:
    password_hash = hash_password(" secure-pass ")

    assert password_hash.startswith("bcrypt_sha256$")
    assert verify_password("secure-pass", password_hash) is True
    assert verify_password("wrong-pass", password_hash) is False


def test_hash_password_validates_length() -> None:
    with pytest.raises(AuthError, match="at least 8"):
        hash_password("short")
    with pytest.raises(AuthError, match="at most 128"):
        hash_password("x" * 129)


def test_verify_password_supports_legacy_bcrypt_hashes_and_invalid_hashes() -> None:
    legacy_hash = bcrypt.hashpw(b"secret-pass", bcrypt.gensalt()).decode("utf-8")

    assert verify_password("secret-pass", legacy_hash) is True
    assert verify_password("secret-pass", "unsupported") is False


def test_access_token_roundtrip_and_decode_guards() -> None:
    token = create_access_token(_user())

    payload = decode_access_token(token)

    assert payload["sub"] == "user-1"
    assert payload["type"] == "access"

    refresh_like_token = jwt.encode(
        {
            "sub": "user-1",
            "type": "refresh",
            "exp": datetime.utcnow() + timedelta(minutes=5),
        },
        auth_service.settings.jwt_secret_key,
        algorithm=auth_service.settings.jwt_algorithm,
    )
    missing_subject_token = jwt.encode(
        {
            "type": "access",
            "exp": datetime.utcnow() + timedelta(minutes=5),
        },
        auth_service.settings.jwt_secret_key,
        algorithm=auth_service.settings.jwt_algorithm,
    )

    with pytest.raises(AuthError, match="Invalid token type"):
        decode_access_token(refresh_like_token)
    with pytest.raises(AuthError, match="Invalid token subject"):
        decode_access_token(missing_subject_token)
    with pytest.raises(AuthError, match="Invalid or expired token"):
        decode_access_token("not-a-token")


def test_validate_session_returns_authenticated_user(monkeypatch) -> None:
    user = _user()
    monkeypatch.setattr(auth_service, "get_user_from_access_token", lambda db, token: user)

    response = validate_session(db=None, token="access-token")

    assert response.authenticated is True
    assert response.user.email == "user@example.com"


def test_logout_user_revokes_token_and_commits() -> None:
    class FakeDb:
        executed = False
        committed = False

        def execute(self, _statement):
            self.executed = True

        def commit(self) -> None:
            self.committed = True

    db = FakeDb()

    response = logout_user(db, "refresh-token")

    assert response.message == "Logged out successfully."
    assert db.executed is True
    assert db.committed is True
