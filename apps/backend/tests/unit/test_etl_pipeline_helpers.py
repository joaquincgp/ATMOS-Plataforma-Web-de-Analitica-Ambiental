# Unit tests intentionally exercise ETL helpers without external network or database calls.
# pylint: disable=protected-access

from datetime import UTC, date, datetime
from pathlib import Path
from types import SimpleNamespace

import httpx
import pandas as pd
import pytest

from app.services.etl.contracts import NormalizedMeasurementRow
from app.services.etl.pipeline import EtlService


class FakeDb:
    def __init__(self) -> None:
        self.added = []
        self.commits = 0
        self.rollbacks = 0

    def add(self, value) -> None:
        self.added.append(value)

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def refresh(self, _value) -> None:
        if getattr(_value, "id", None) is None:
            _value.id = 1

    def scalar(self, _statement):
        return None

    def get(self, _model, run_id):
        return getattr(self, "run", None) if getattr(getattr(self, "run", None), "id", None) == run_id else None


def _settings(tmp_path: Path) -> SimpleNamespace:
    return SimpleNamespace(
        database_url="sqlite://",
        etl_storage_dir=str(tmp_path),
        etl_request_timeout_seconds=1,
        etl_user_agent="test-agent",
        etl_row_chunk_size=100,
        etl_lookup_chunk_size=100,
        etl_sync_default_max_archives=4,
        remmaq_base_url="https://datosambiente.quito.gob.ec/",
    )


def _service(tmp_path: Path) -> EtlService:
    return EtlService(FakeDb(), settings=_settings(tmp_path))


def _run(run_id: str = "run-1") -> SimpleNamespace:
    return SimpleNamespace(
        id=run_id,
        status="running",
        details={},
        archives_discovered=0,
        archives_processed=0,
        records_inserted=0,
        records_updated=0,
        records_skipped=0,
        finished_at=None,
    )


def test_run_progress_and_date_range_helpers(tmp_path: Path) -> None:
    service = _service(tmp_path)
    run = SimpleNamespace(details={"existing": "value"})

    service._set_run_progress(run, stage="load", stage_label="Carga", progress_percent=140, rows=10)

    assert run.details["existing"] == "value"
    assert run.details["progress_percent"] == 100
    assert run.details["stage"] == "load"
    assert service._compute_progress_percent(archives_total=4, archives_completed=1, stage_fraction=0.5) == 38
    assert service._normalize_observed_range(date(2025, 1, 1), date(2025, 1, 2)) == (
        date(2025, 1, 1),
        date(2025, 1, 2),
    )
    with pytest.raises(ValueError, match="rango de fechas"):
        service._normalize_observed_range(date(2025, 1, 2), date(2025, 1, 1))

    from_dt, to_dt = service._date_to_datetime_range(date(2025, 1, 1), date(2025, 1, 2))
    assert from_dt == datetime(2025, 1, 1, tzinfo=UTC)
    assert to_dt.date() == date(2025, 1, 2)


def test_variable_selection_matching_and_categorization(tmp_path: Path) -> None:
    service = _service(tmp_path)

    assert "PM25" in service._normalize_variable_selection(None)
    assert service._normalize_variable_selection(["pm-2.5", "PM25", "co"]) == ["PM25", "CO"]
    with pytest.raises(ValueError, match="variables"):
        service._normalize_variable_selection(["unknown"])

    assert service._match_remmaq_variable(text="Particulas (pm2.5)", href="", full_url="") == "PM25"
    assert service._match_remmaq_variable(text="", href="/ozono.zip", full_url="https://example.test/ozono.zip") == "O3"
    assert service._match_remmaq_variable(text="", href="", full_url="") is None
    assert service._categorize_variable("PM25") == "pollutant"
    assert service._categorize_variable("TMP") == "meteorological"
    assert service._categorize_variable("OTHER") == "other"


def test_filename_detection_extraction_and_delimited_reading(tmp_path: Path) -> None:
    service = _service(tmp_path)
    response = httpx.Response(
        200,
        headers={"content-disposition": 'attachment; filename="measurements.csv"'},
        content=b"station,value\nA,10\n",
    )
    fallback_response = httpx.Response(200, headers={"content-type": "application/octet-stream"}, content=b"PK\x03\x04")

    assert service._resolve_filename(url="https://example.test/download", response=response) == "measurements.csv"
    assert service._resolve_filename(url="https://example.test/download", response=fallback_response).endswith(".zip")
    assert service._detect_binary_suffix(content=b"Rar!\x1a\x07data", content_type="") == ".rar"
    assert service._detect_binary_suffix(content=b"", content_type="application/vnd.ms-excel") == ".xlsx"

    csv_path = tmp_path / "input.csv"
    csv_path.write_text("station,value\nA,10\n", encoding="utf-8")
    extracted_dir = service._extract_input_file(csv_path, "abc123456789")
    assert (extracted_dir / "input.csv").exists()
    assert service._read_delimited_file(csv_path)["value"].tolist() == [10]

    unsupported_path = tmp_path / "input.json"
    unsupported_path.write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="Formato no soportado"):
        service._extract_input_file(unsupported_path, "abc123456789")


def test_archive_discovery_download_and_reader_error_paths(tmp_path: Path, monkeypatch) -> None:
    service = _service(tmp_path)

    class FakeClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback) -> None:
            return None

        def get(self, url):
            if url.endswith(".zip"):
                return httpx.Response(
                    200,
                    content=b"PK\x03\x04payload",
                    headers={"content-disposition": "filename*=UTF-8''pm25.zip"},
                    request=httpx.Request("GET", url),
                )
            html = """
            <a href="javascript:void(0)">skip</a>
            <a href="mailto:test@example.com">skip</a>
            <a href="ftp://example.test/file.zip">skip</a>
            <a href="https://external.test/pm25.zip">skip</a>
            <a href="/pm25.zip#frag">Particulas (pm2.5)</a>
            <a href="/pm25-duplicate.zip">Particulas (pm2.5)</a>
            <a href="/no-match.zip">Other</a>
            """
            return httpx.Response(200, text=html, request=httpx.Request("GET", url))

    monkeypatch.setattr("app.services.etl.pipeline.httpx.Client", FakeClient)

    discovered = service._discover_archive_urls(
        root_url="https://datosambiente.quito.gob.ec/",
        selected_variables=["PM25"],
        max_archives=5,
    )
    content, filename = service._download_binary("https://datosambiente.quito.gob.ec/pm25.zip")

    assert discovered == [
        {
            "url": "https://datosambiente.quito.gob.ec/pm25.zip",
            "label": "Particulas (pm2.5)",
            "variable_code": "PM25",
        }
    ]
    assert content.startswith(b"PK")
    assert filename == "pm25.zip"

    with pytest.raises(RuntimeError, match="No se encontraron"):
        service._discover_archive_urls(
            root_url="https://datosambiente.quito.gob.ec/",
            selected_variables=["CO"],
            max_archives=1,
        )

    bad_csv = tmp_path / "bad.csv"
    bad_csv.write_text("not,important", encoding="utf-8")
    monkeypatch.setattr(
        "app.services.etl.pipeline.pd.read_csv",
        lambda *args, **kwargs: (_ for _ in ()).throw(ValueError("bad")),
    )
    with pytest.raises(RuntimeError, match="No se pudo leer"):
        service._read_delimited_file(bad_csv)


def test_normalize_dataframe_supports_long_and_wide_layouts(tmp_path: Path) -> None:
    service = _service(tmp_path)
    long_frame = pd.DataFrame(
        {
            "Fecha": ["2025-01-01T00:00:00"],
            "Estacion": ["UIO"],
            "Variable": ["pm25"],
            "Valor": ["10.5"],
            "Unidad": ["ug/m3"],
        }
    )
    wide_frame = pd.DataFrame(
        {
            "Fecha": ["Fecha Unidad", "2025-01-01T00:00:00"],
            "Belisario": ["ug/m3", "20"],
            "Centro": ["ug/m3", "21"],
        }
    )

    long_rows = list(service._normalize_dataframe(dataframe=long_frame, workbook_name="manual.csv", sheet_name="data"))
    wide_rows = list(service._normalize_dataframe(dataframe=wide_frame, workbook_name="PM25.xlsx", sheet_name="data"))

    assert long_rows[0].station_code == "UIO"
    assert long_rows[0].variable_code == "PM25"
    assert long_rows[0].value == 10.5
    assert [row.station_code for row in wide_rows] == ["BELISARIO", "CENTRO"]
    assert {row.unit for row in wide_rows} == {"ug/m3"}


def test_row_loading_filters_range_and_reports_progress(tmp_path: Path) -> None:
    service = _service(tmp_path)
    calls = []
    rows = [
        NormalizedMeasurementRow("A", datetime(2025, 1, 1, tzinfo=UTC), "PM25", 1.0, "ug/m3", "s", 1, "w"),
        NormalizedMeasurementRow("A", datetime(2025, 1, 2, tzinfo=UTC), "PM25", 2.0, "ug/m3", "s", 2, "w"),
        NormalizedMeasurementRow("A", datetime(2025, 1, 3, tzinfo=UTC), "PM25", 3.0, "ug/m3", "s", 3, "w"),
    ]

    service._load_rows_chunk = lambda chunk, source_file_id: (len(chunk), 0, 0)

    inserted, updated, skipped = service._load_rows(
        rows,
        source_file_id=1,
        observed_from=datetime(2025, 1, 2, tzinfo=UTC),
        observed_to=datetime(2025, 1, 2, tzinfo=UTC),
        progress_callback=lambda i, u, s: calls.append((i, u, s)),
    )

    assert (inserted, updated, skipped) == (1, 0, 2)
    assert calls == [(1, 0, 2)]


def test_create_runs_and_sync_orchestration_cover_success_and_failure(tmp_path: Path) -> None:
    service = _service(tmp_path)
    created_run = _run("created")
    service._create_run = lambda trigger_type, source: created_run

    remmaq_run, variables, max_archives, force, observed_from, observed_to = service.create_remmaq_run(
        variable_codes=["PM25"],
        max_archives=None,
        force_reprocess=True,
        observed_from=date(2025, 1, 1),
        observed_to=date(2025, 1, 2),
    )
    manual_run = service.create_manual_run(filename="manual.csv")

    assert remmaq_run is created_run
    assert variables == ["PM25"]
    assert max_archives == 1
    assert force is True
    assert observed_from == date(2025, 1, 1)
    assert observed_to == date(2025, 1, 2)
    assert manual_run.details["filename"] == "manual.csv"

    service.db.run = _run("sync")
    processed = []
    service._discover_archive_urls = lambda **_kwargs: [
        {"url": "https://example.test/pm25.zip", "label": "PM25", "variable_code": "PM25"}
    ]
    service._delete_existing_measurements_for_variable_codes = lambda *args, **kwargs: 3
    service._download_binary = lambda url: (b"content", "pm25.csv")
    service._process_binary = lambda **kwargs: processed.append(kwargs["original_name"])

    result = service.run_remmaq_sync(
        run_id="sync",
        selected_variables=["PM25"],
        max_archives=1,
        force_reprocess=True,
        observed_from=date(2025, 1, 1),
        observed_to=date(2025, 1, 2),
    )

    assert result.status == "completed"
    assert processed == ["pm25.csv"]

    service.db.run = _run("fail")
    service._discover_archive_urls = lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("no archives"))
    with pytest.raises(RuntimeError, match="no archives"):
        service.run_remmaq_sync(
            run_id="fail",
            selected_variables=["PM25"],
            max_archives=1,
            force_reprocess=False,
            observed_from=None,
            observed_to=None,
        )
    assert service.db.run.status == "failed"


def test_manual_ingestion_and_process_binary_paths(tmp_path: Path) -> None:
    service = _service(tmp_path)
    service.db.run = _run("manual")
    processed = []
    service._process_binary = lambda **kwargs: processed.append(kwargs["source_type"])

    result = service.run_manual_ingestion(
        run_id="manual",
        filename="manual.csv",
        content=b"station,value\nA,1\n",
        force_reprocess=False,
    )

    assert result.status == "completed"
    assert processed == ["manual"]

    process_service = _service(tmp_path)
    etl_run = _run("process")
    extracted_path = tmp_path / "extracted" / "abc"
    extracted_path.mkdir(parents=True)
    process_service._find_reusable_source_file = lambda **_kwargs: None
    process_service._extract_input_file = lambda input_path, checksum: extracted_path
    process_service._extract_rows_from_directory = lambda path: [
        NormalizedMeasurementRow("A", datetime(2025, 1, 1, tzinfo=UTC), "PM25", 1.0, "ug/m3", "s", 1, "w")
    ]
    process_service._load_rows = lambda rows, source_file_id, **_kwargs: (1, 0, 0)
    process_service._count_measurements_for_source_file = lambda source_file_id: 1

    process_service._process_binary(
        etl_run=etl_run,
        content=b"station,value\nA,1\n",
        original_name="manual.csv",
        source_type="manual",
        source_url=None,
        force_reprocess=False,
        archive_index=1,
        archives_total=1,
        selected_variables=[],
        current_variable="MANUAL",
    )

    assert etl_run.archives_processed == 1
    assert etl_run.records_inserted == 1


def test_public_etl_entrypoints_and_binary_short_circuit_paths(tmp_path: Path, monkeypatch) -> None:
    service = _service(tmp_path)
    monkeypatch.setattr("app.services.etl.pipeline.init_db", lambda: None)

    class ScalarRows:
        def all(self):
            return [_run("listed")]

    class ScalarResult:
        def all(self):
            return ScalarRows().all()

    service.db.scalars = lambda _statement: ScalarResult()
    initialized = service.initialize_database()
    listed = service.list_runs(limit=1)

    assert initialized["status"] == "initialized"
    assert listed[0].id == "listed"

    created_run = _run("sync-public")
    service.create_remmaq_run = lambda **_kwargs: (created_run, ["PM25"], 1, True, None, None)
    service.run_remmaq_sync = lambda **_kwargs: created_run
    assert service.sync_remmaq(variable_codes=["PM25"], force_reprocess=True) is created_run

    manual_run = _run("manual-public")
    service.create_manual_run = lambda filename: manual_run
    service.run_manual_ingestion = lambda **_kwargs: manual_run
    assert service.ingest_manual_file(filename="manual.csv", content=b"a,b\n1,2\n") is manual_run
    with pytest.raises(ValueError, match="Formato de carga manual"):
        service.ingest_manual_file(filename="manual.json", content=b"{}")

    existing = SimpleNamespace(row_count=5)
    skip_service = _service(tmp_path)
    skip_service.db.scalar = lambda _statement: existing
    etl_run = _run("skip")
    skip_service._process_binary(
        etl_run=etl_run,
        content=b"already processed",
        original_name="manual.csv",
        source_type="manual",
        source_url=None,
        force_reprocess=False,
        archive_index=1,
        archives_total=1,
        selected_variables=[],
        current_variable="MANUAL",
    )

    assert etl_run.records_skipped == 5
    assert etl_run.archives_processed == 1


def test_input_extraction_zip_excel_and_empty_sources(tmp_path: Path, monkeypatch) -> None:
    service = _service(tmp_path)

    import zipfile

    zip_path = tmp_path / "archive.zip"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr("data.csv", "Fecha,Estacion,Variable,Valor\n2025-01-01,A,PM25,10\n")
    zip_extracted = service._extract_input_file(zip_path, "zipchecksum")

    xlsx_path = tmp_path / "manual.xlsx"
    pd.DataFrame({"Fecha": ["2025-01-01"], "Estacion": ["A"], "Variable": ["PM25"], "Valor": [10]}).to_excel(
        xlsx_path,
        index=False,
    )
    xlsx_extracted = service._extract_input_file(xlsx_path, "xlsxchecksum")
    empty_csv = tmp_path / "empty.csv"
    empty_csv.write_text("", encoding="utf-8")
    monkeypatch.setattr("app.services.etl.pipeline.pd.read_csv", lambda *args, **kwargs: pd.DataFrame())

    assert (zip_extracted / "data.csv").exists()
    assert (xlsx_extracted / "manual.xlsx").exists()
    assert not list(service._extract_rows_from_delimited(empty_csv))

    monkeypatch.setattr(
        "app.services.etl.pipeline.pd.read_excel",
        lambda *args, **kwargs: (_ for _ in ()).throw(ValueError("bad workbook")),
    )
    with pytest.raises(RuntimeError, match="No se pudo leer"):
        list(service._extract_rows_from_workbook(xlsx_path))
