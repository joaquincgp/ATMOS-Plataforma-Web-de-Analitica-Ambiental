# Unit tests intentionally exercise internal pure helpers.
# pylint: disable=protected-access

from datetime import date, datetime
from decimal import Decimal

import pytest

from app.services.analytics_service import (
    _canonicalize_variable_code,
    _display_variable_name,
    _serialize_scalar,
    _validate_select_sql,
)


def test_variable_code_helpers_normalize_and_preserve_fallbacks() -> None:
    assert _canonicalize_variable_code(" pm-2.5 ") == "PM25"
    assert _canonicalize_variable_code(None) == ""
    assert _display_variable_name("PM25") == "PM25"
    assert _display_variable_name("PM25", "Fine particles") == "Fine particles"


def test_validate_select_sql_accepts_single_read_only_selects() -> None:
    assert _validate_select_sql(" SELECT * FROM measurements; ") == "SELECT * FROM measurements"


@pytest.mark.parametrize(
    "sql",
    [
        "",
        "DELETE FROM measurements",
        "SELECT * FROM a; SELECT * FROM b",
        "SELECT * FROM measurements -- comment",
        "SELECT * FROM measurements /* comment */",
    ],
)
def test_validate_select_sql_rejects_unsafe_or_unsupported_sql(sql: str) -> None:
    with pytest.raises(ValueError):
        _validate_select_sql(sql)


def test_serialize_scalar_returns_json_safe_values() -> None:
    assert _serialize_scalar(datetime(2025, 1, 2, 3, 4, 5)) == "2025-01-02T03:04:05"
    assert _serialize_scalar(date(2025, 1, 2)) == "2025-01-02"
    assert _serialize_scalar(Decimal("10.25")) == 10.25
    assert _serialize_scalar(b"ok") == "ok"
    assert _serialize_scalar("plain") == "plain"
