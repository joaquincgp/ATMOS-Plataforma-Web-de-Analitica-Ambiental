from datetime import UTC, datetime, timedelta, timezone

from app.services.etl.helpers import (
    compute_record_hash,
    compute_sha256,
    guess_unit,
    normalize_station_code,
    normalize_text,
    normalize_variable_code,
    parse_datetime,
)


def test_normalize_text_removes_accents_spaces_and_symbols() -> None:
    assert normalize_text("  Estacion Ñorte / PM  ") == "estacion_norte__pm"


def test_normalize_variable_code_removes_separators_and_keeps_contract_tokens() -> None:
    assert normalize_variable_code(" pm-2.5 ") == "PM25"
    assert normalize_variable_code("SO₂") == "SO2"


def test_normalize_station_code_uppercases_and_removes_spaces() -> None:
    assert normalize_station_code("  ui o norte ") == "UIONORTE"


def test_parse_datetime_returns_utc_datetime_for_strings_and_datetime_values() -> None:
    parsed = parse_datetime("2025-01-02T03:04:05-05:00")
    naive = parse_datetime(datetime(2025, 1, 2, 3, 4, 5))
    aware = parse_datetime(datetime(2025, 1, 2, 3, 4, 5, tzinfo=timezone(timedelta(hours=-5))))

    assert parsed == datetime(2025, 1, 2, 8, 4, 5, tzinfo=UTC)
    assert naive == datetime(2025, 1, 2, 3, 4, 5, tzinfo=UTC)
    assert aware == datetime(2025, 1, 2, 8, 4, 5, tzinfo=UTC)
    assert parse_datetime("not-a-date") is None
    assert parse_datetime(None) is None


def test_guess_unit_prefers_provided_unit_and_falls_back_to_variable_defaults() -> None:
    assert guess_unit("PM2.5", " ug/m3 ") == "ug/m3"
    assert guess_unit("co", None) == "mg/m3"
    assert guess_unit("unknown", None) is None


def test_hash_helpers_are_deterministic() -> None:
    observed_at = datetime(2025, 1, 1, tzinfo=UTC)

    assert compute_sha256(b"abc") == compute_sha256(b"abc")
    assert compute_record_hash("A", "PM25", observed_at) == compute_record_hash("A", "PM25", observed_at)
