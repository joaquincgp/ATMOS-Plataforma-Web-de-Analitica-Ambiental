# Unit tests intentionally exercise internal pure helpers.
# pylint: disable=protected-access

from pathlib import Path
from types import SimpleNamespace

import pytest

from app.schemas.auth import UserRole
from app.services.workspace_service import (
    WorkspaceError,
    _assert_workspace_access,
    _clean_workspace_name,
    _ensure_storage_dirs,
    _generate_schema_name,
    _quote_identifier,
    _sanitize_identifier,
    _slugify,
)


def test_workspace_string_helpers_create_safe_tokens() -> None:
    assert _slugify("  My Research Workspace! ") == "my-research-workspace"
    assert _slugify(" !!! ") == "workspace"
    assert _clean_workspace_name("  Quito   Air   Lab  ") == "Quito Air Lab"
    assert _sanitize_identifier("123 Bad-Identifier!") == "t_123_bad_identifier"
    assert _quote_identifier("ws_safe_1") == '"ws_safe_1"'


def test_quote_identifier_rejects_unsafe_identifiers() -> None:
    with pytest.raises(WorkspaceError):
        _quote_identifier("bad-name;drop")


def test_generate_schema_name_is_stable_and_safe() -> None:
    schema_name = _generate_schema_name("user-1234567890", "Quito PM Workspace")

    assert schema_name.startswith("ws_user123456_quito_pm_workspace")
    assert len(schema_name) <= 63


def test_assert_workspace_access_allows_admin_and_owner_only() -> None:
    workspace = SimpleNamespace(owner_user_id="owner-1")

    _assert_workspace_access(SimpleNamespace(id="admin-1", role=UserRole.admin.value), workspace)
    _assert_workspace_access(SimpleNamespace(id="owner-1", role=UserRole.researcher.value), workspace)

    with pytest.raises(WorkspaceError):
        _assert_workspace_access(SimpleNamespace(id="other-1", role=UserRole.researcher.value), workspace)


def test_ensure_storage_dirs_creates_expected_workspace_folders(tmp_path: Path) -> None:
    _ensure_storage_dirs(tmp_path)

    assert (tmp_path / "dashboards").is_dir()
    assert (tmp_path / "datasets").is_dir()
    assert (tmp_path / "models").is_dir()
    assert (tmp_path / "exports").is_dir()
    assert (tmp_path / "artifacts").is_dir()
