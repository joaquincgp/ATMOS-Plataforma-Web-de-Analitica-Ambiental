import pytest
from pydantic import ValidationError

from app.schemas.auth import LoginRequest, UserRole, UserStatus


def test_auth_email_validator_normalizes_whitespace_and_case() -> None:
    request = LoginRequest(email=" USER@Example.COM ", password="valid-pass")

    assert request.email == "user@example.com"


def test_auth_email_validator_rejects_invalid_email() -> None:
    with pytest.raises(ValidationError, match="Invalid email format"):
        LoginRequest(email="not-an-email", password="valid-pass")


def test_auth_enums_keep_api_contract_values_lowercase() -> None:
    assert UserRole.admin.value == "admin"
    assert UserRole.researcher.value == "researcher"
    assert UserStatus.pending_validation.value == "pending_validation"
