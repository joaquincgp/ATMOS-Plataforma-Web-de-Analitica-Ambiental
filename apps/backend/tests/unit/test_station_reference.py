# Unit tests intentionally exercise internal pure helpers.
# pylint: disable=protected-access

from types import SimpleNamespace

from app.services.station_reference import (
    _normalize_station_token,
    resolve_station_reference,
    sync_station_reference_metadata,
)


def test_normalize_station_token_handles_empty_accents_and_separators() -> None:
    assert _normalize_station_token(None) == ""
    assert _normalize_station_token(" San Antonio ") == "sanantonio"


def test_resolve_station_reference_matches_code_name_and_aliases() -> None:
    assert resolve_station_reference("CAR", None).name == "Carapungo"
    assert resolve_station_reference(None, "El Camal").name == "El Camal"
    assert resolve_station_reference("unknown", None) is None


def test_sync_station_reference_metadata_updates_matching_stations() -> None:
    station = SimpleNamespace(
        code="CAR",
        name="Unknown station",
        latitude=None,
        longitude=None,
    )

    class FakeScalars:
        def all(self) -> list[SimpleNamespace]:
            return [station]

    class FakeDb:
        committed = False

        def scalars(self, _statement):
            return FakeScalars()

        def commit(self) -> None:
            self.committed = True

    db = FakeDb()

    assert sync_station_reference_metadata(db) == 1
    assert station.name == "Carapungo"
    assert station.latitude == -0.095472
    assert station.longitude == -78.449809
    assert db.committed is True
