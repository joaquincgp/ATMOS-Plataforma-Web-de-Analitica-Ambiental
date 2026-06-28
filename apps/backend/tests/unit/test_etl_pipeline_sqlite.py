# SQLite-backed ETL tests cover row loading, metrics and REMMAQ extraction without network calls.
# pylint: disable=protected-access,redefined-outer-name

from datetime import UTC, date, datetime
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import EtlRun, Measurement, SourceFile, Station, Variable
from app.models.base import Base
from app.services.etl.contracts import NormalizedMeasurementRow
from app.services.etl.pipeline import EtlService


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


def _settings(tmp_path: Path) -> SimpleNamespace:
    return SimpleNamespace(
        database_url="sqlite://",
        etl_storage_dir=str(tmp_path),
        etl_request_timeout_seconds=1,
        etl_user_agent="test-agent",
        etl_row_chunk_size=2,
        etl_lookup_chunk_size=2,
        etl_sync_default_max_archives=4,
        remmaq_base_url="https://datosambiente.quito.gob.ec/",
    )


def _source_file(db_session) -> SourceFile:
    run = EtlRun(trigger_type="manual", source="pytest", status="running")
    db_session.add(run)
    db_session.commit()
    source = SourceFile(
        etl_run_id=run.id,
        source_type="manual",
        source_url=None,
        original_name="manual.csv",
        local_archive_path="manual.csv",
        checksum_sha256="d" * 64,
        status="processing",
    )
    db_session.add(source)
    db_session.commit()
    return source


def _row(station: str, observed_at: datetime, variable: str, value: float | None) -> NormalizedMeasurementRow:
    return NormalizedMeasurementRow(
        station_code=station,
        observed_at=observed_at,
        variable_code=variable,
        value=value,
        unit="ug/m3",
        source_sheet="sheet",
        source_row_number=1,
        source_workbook="book.csv",
    )


def test_load_rows_chunk_inserts_updates_skips_and_reuses_cached_entities(db_session, tmp_path) -> None:
    service = EtlService(db_session, settings=_settings(tmp_path))
    source = _source_file(db_session)
    observed = datetime(2025, 1, 1, tzinfo=UTC)

    inserted, updated, skipped = service._load_rows_chunk(
        [
            _row("Station A", observed, "pm-2.5", 10.0),
            _row("Station A", observed, "PM25", 11.0),
            _row("Station B", observed, "PM10", None),
        ],
        source.id,
    )
    second_inserted, second_updated, second_skipped = service._load_rows_chunk(
        [_row("Station A", observed, "PM25", 12.0), _row("Station A", observed, "PM25", 12.0)],
        source.id,
    )
    third_inserted, third_updated, third_skipped = service._load_rows_chunk(
        [_row("Station A", observed, "PM25", 12.0)],
        source.id,
    )

    assert (inserted, updated, skipped) == (1, 0, 2)
    assert (second_inserted, second_updated, second_skipped) == (0, 1, 1)
    assert (third_inserted, third_updated, third_skipped) == (0, 0, 1)
    assert db_session.query(Measurement).count() == 1


def test_ingest_normalized_rows_metrics_preview_and_failure_path(db_session, tmp_path) -> None:
    service = EtlService(db_session, settings=_settings(tmp_path))
    rows = [
        _row("A", datetime(2025, 1, 1, tzinfo=UTC), "PM25", 10.0),
        _row("B", datetime(2025, 1, 2, tzinfo=UTC), "PM10", 20.0),
    ]

    run = service.ingest_normalized_rows(filename="manual.csv", content=b"a,b\n", rows=rows)
    metrics = service.get_metrics()
    preview = service.get_preview(run_id=run.id, limit=1)
    latest_preview = service.get_preview(limit=5)

    assert run.status == "completed"
    assert metrics["total_measurements"] == 2
    assert preview["run_id"] == run.id
    assert len(preview["rows"]) == 1
    assert latest_preview["rows"]

    failing_service = EtlService(db_session, settings=_settings(tmp_path))
    failing_service._load_rows = lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("load failed"))
    with pytest.raises(RuntimeError, match="load failed"):
        failing_service.ingest_normalized_rows(filename="bad.csv", content=b"x\n", rows=rows)


def test_extract_remmaq_dataframe_filters_rows_and_reports_empty_ranges(db_session, tmp_path, monkeypatch) -> None:
    service = EtlService(db_session, settings=_settings(tmp_path))
    extracted_dir = tmp_path / "extracted"
    extracted_dir.mkdir()
    rows = [
        _row("station a", datetime(2025, 1, 1, tzinfo=UTC), "pm-2.5", 10.0),
        _row("station b", datetime(2025, 2, 1, tzinfo=UTC), "pm10", 20.0),
    ]
    monkeypatch.setattr(
        service,
        "_discover_archive_urls",
        lambda **_kwargs: [{"url": "https://datosambiente.quito.gob.ec/pm25.zip", "variable_code": "PM25"}],
    )
    monkeypatch.setattr(
        service, "_download_binary", lambda _url, **_kwargs: (b"station,value\nA,1\n", "pm25.csv")
    )
    monkeypatch.setattr(service, "_extract_input_file", lambda _path, _checksum: extracted_dir)
    monkeypatch.setattr(service, "_extract_rows_from_directory", lambda _path, **_kwargs: rows)

    frame, archives = service.extract_remmaq_dataframe(
        variable_codes=["PM25"],
        max_archives=None,
        observed_from=date(2025, 1, 1),
        observed_to=date(2025, 1, 15),
    )

    assert frame["station_code"].tolist() == ["STATIONA"]
    assert archives[0]["variable_code"] == "PM25"

    with pytest.raises(RuntimeError, match="No se encontraron"):
        service.extract_remmaq_dataframe(
            variable_codes=["PM25"],
            max_archives=None,
            observed_from=date(2024, 1, 1),
            observed_to=date(2024, 1, 2),
        )


def test_extract_remmaq_dataframe_invokes_progress_callback_per_archive(db_session, tmp_path, monkeypatch) -> None:
    service = EtlService(db_session, settings=_settings(tmp_path))
    extracted_dir = tmp_path / "extracted"
    extracted_dir.mkdir()
    rows = [_row("A", datetime(2025, 1, 1, tzinfo=UTC), "PM25", 10.0)]
    monkeypatch.setattr(
        service,
        "_discover_archive_urls",
        lambda **_kwargs: [
            {"url": "https://datosambiente.quito.gob.ec/pm25.zip", "variable_code": "PM25"},
            {"url": "https://datosambiente.quito.gob.ec/tmp.zip", "variable_code": "TMP"},
        ],
    )
    monkeypatch.setattr(service, "_download_binary", lambda _url, **_kwargs: (b"x", "f.csv"))
    monkeypatch.setattr(service, "_extract_input_file", lambda _path, _checksum: extracted_dir)
    monkeypatch.setattr(service, "_extract_rows_from_directory", lambda _path, **_kwargs: rows)

    progress_calls: list[tuple[int, int, int]] = []
    service.extract_remmaq_dataframe(
        variable_codes=["PM25", "TMP"],
        max_archives=None,
        progress_callback=lambda done, total, rows_so_far: progress_calls.append((done, total, rows_so_far)),
    )

    assert progress_calls == [(1, 2, 1), (2, 2, 2)]


def test_download_binary_cache_skips_second_network_call(db_session, tmp_path, monkeypatch) -> None:
    service = EtlService(db_session, settings=_settings(tmp_path))
    call_count = {"n": 0}

    class _FakeResponse:
        content = b"archive-bytes"
        headers: dict[str, str] = {}

        def raise_for_status(self) -> None:
            return None

    class _FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def get(self, _url):
            call_count["n"] += 1
            return _FakeResponse()

    monkeypatch.setattr("app.services.etl.pipeline.httpx.Client", lambda **_kwargs: _FakeClient())

    first = service._download_binary("https://datosambiente.quito.gob.ec/pm25.zip", cache_ttl_seconds=3600)
    second = service._download_binary("https://datosambiente.quito.gob.ec/pm25.zip", cache_ttl_seconds=3600)

    assert call_count["n"] == 1
    assert first == second == (b"archive-bytes", "pm25.zip")


def test_extractors_read_directory_workbooks_and_delimited_files(db_session, tmp_path) -> None:
    service = EtlService(db_session, settings=_settings(tmp_path))
    csv_path = tmp_path / "manual.csv"
    xlsx_path = tmp_path / "manual.xlsx"
    csv_path.write_text("Fecha,Estacion,Variable,Valor\n2025-01-01,A,PM25,10\n", encoding="utf-8")
    pd.DataFrame({"Fecha": ["2025-01-01"], "Estacion": ["B"], "Variable": ["PM10"], "Valor": [20]}).to_excel(
        xlsx_path,
        index=False,
    )

    delimited_rows = list(service._extract_rows_from_delimited(csv_path))
    workbook_rows = list(service._extract_rows_from_workbook(xlsx_path))
    directory_rows = list(service._extract_rows_from_directory(tmp_path))

    assert delimited_rows[0].station_code == "A"
    assert workbook_rows[0].station_code == "B"
    assert {row.variable_code for row in directory_rows} == {"PM25", "PM10"}


def test_delete_existing_measurements_and_reusable_source_file_paths(db_session, tmp_path) -> None:
    service = EtlService(db_session, settings=_settings(tmp_path))
    run = EtlRun(trigger_type="automatic", source="remmaq", status="completed")
    station = Station(code="A", name="A")
    variable = Variable(code="PM25", display_name="PM25", category="pollutant", default_unit=None)
    db_session.add_all([run, station, variable])
    db_session.commit()
    source = SourceFile(
        etl_run_id=run.id,
        source_type="automatic",
        source_url="https://example.test/pm25.zip",
        original_name="pm25.zip",
        local_archive_path="pm25.zip",
        checksum_sha256="a" * 64,
        status="completed",
    )
    db_session.add(source)
    db_session.commit()
    db_session.add(
        Measurement(
            station_id=station.id,
            variable_id=variable.id,
            observed_at=datetime(2025, 1, 1),
            value=10.0,
            unit="ug/m3",
            source_file_id=source.id,
            record_hash="hash",
        )
    )
    db_session.commit()

    reusable = service._find_reusable_source_file(source_type="automatic", original_name="pm25.zip")
    deleted = service._delete_existing_measurements_for_variable_codes(
        ["PM25"],
        observed_from=datetime(2025, 1, 1, tzinfo=UTC),
        observed_to=datetime(2025, 1, 1, tzinfo=UTC),
    )
    none_deleted = service._delete_existing_measurements_for_variable_codes([])

    assert reusable.id == source.id
    assert deleted == 1
    assert none_deleted == 0
    assert service._find_reusable_source_file(source_type="manual", original_name="pm25.zip") is None


def test_get_or_create_station_variable_and_load_chunk_rollback(db_session, tmp_path, monkeypatch) -> None:
    service = EtlService(db_session, settings=_settings(tmp_path))
    station = Station(code="EXISTING", name="Existing")
    variable = Variable(code="CO", display_name="CO", category="pollutant", default_unit=None)
    db_session.add_all([station, variable])
    db_session.commit()

    assert service._get_or_create_station("existing").id == station.id
    assert service._get_or_create_station("new station").code == "NEWSTATION"
    assert service._get_or_create_variable("co", "ppm").default_unit == "ppm"
    assert service._get_or_create_variable("custom", None).category == "other"

    source = _source_file(db_session)
    failing_service = EtlService(db_session, settings=_settings(tmp_path))
    monkeypatch.setattr(
        failing_service,
        "_load_existing_measurements",
        lambda _keys, **_: (_ for _ in ()).throw(RuntimeError("lookup failed")),
    )

    with pytest.raises(RuntimeError, match="lookup failed"):
        failing_service._load_rows_chunk(
            [_row("A", datetime(2025, 1, 1, tzinfo=UTC), "PM25", 10.0)],
            source.id,
        )
