# SQLite-backed public air quality tests cover the read-only public map payload.
# pylint: disable=redefined-outer-name

from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import EtlRun, Measurement, SourceFile, Station, Variable
from app.models.base import Base
from app.services.etl.helpers import compute_record_hash
from app.services.etl.pipeline import REMMAQ_VARIABLE_CODES
from app.services.public_air_quality_service import get_public_air_quality_snapshot, prepare_public_remmaq_sync


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


def _seed_public_measurements(db_session) -> None:
    run = EtlRun(trigger_type="automatic", source="REMMAQ", status="completed")
    belisario = Station(code="BEL", name="Belisario", latitude=-0.184719, longitude=-78.495986)
    cotocollao = Station(code="COT", name="Cotocollao", latitude=-0.107777, longitude=-78.497222)
    pm25 = Variable(code="PM25", display_name="PM2.5", category="pollutant", default_unit="ug/m3")
    wind = Variable(code="VEL", display_name="Wind speed", category="meteorological", default_unit="m/s")
    temperature = Variable(code="TMP", display_name="Temperature", category="meteorological", default_unit="C")
    db_session.add_all([run, belisario, cotocollao, pm25, wind, temperature])
    db_session.commit()

    source = SourceFile(
        etl_run_id=run.id,
        source_type="public_dashboard",
        source_url="https://datosambiente.quito.gob.ec/",
        original_name="pm25.zip",
        local_archive_path="pm25.zip",
        checksum_sha256="e" * 64,
        status="completed",
        row_count=6,
    )
    db_session.add(source)
    db_session.commit()

    rows = [
        (belisario, pm25, datetime(2026, 1, 1, 10), 12.0),
        (belisario, pm25, datetime(2026, 1, 1, 11), 18.0),
        (cotocollao, pm25, datetime(2026, 1, 1, 11), 8.0),
        (belisario, wind, datetime(2026, 1, 1, 11), 3.0),
        (cotocollao, wind, datetime(2026, 1, 1, 11), 4.0),
        (belisario, temperature, datetime(2026, 1, 1, 11), 15.0),
    ]
    for station, variable, observed_at, value in rows:
        db_session.add(
            Measurement(
                station_id=station.id,
                variable_id=variable.id,
                observed_at=observed_at,
                value=value,
                unit=variable.default_unit,
                source_file_id=source.id,
                record_hash=compute_record_hash(station.code, variable.code, observed_at.replace(tzinfo=UTC)),
            )
        )
    db_session.commit()


def test_public_air_quality_snapshot_returns_empty_payload_without_measurements(db_session) -> None:
    response = get_public_air_quality_snapshot(db_session, variable_code="PM25")

    assert response.station_count == 0
    assert response.observation_count == 0
    assert response.stations == []
    assert response.methodology_notes


def test_public_air_quality_snapshot_aggregates_station_series_and_meteorology(db_session) -> None:
    _seed_public_measurements(db_session)

    response = get_public_air_quality_snapshot(db_session, variable_code="pm-2.5", period="72h")

    assert response.variable_code == "PM25"
    assert response.station_count == 2
    assert response.observation_count == 3
    assert [station.station_code for station in response.stations] == ["BEL", "COT"]
    assert response.stations[0].mean_value == 15.0
    assert response.stations[0].latest_value == 18.0
    assert {item.variable_code for item in response.stations[0].variables} == {"PM25", "TMP", "VEL"}
    assert response.time_series
    assert {item.variable_code for item in response.meteorology} == {"TMP", "VEL"}


def test_public_air_quality_snapshot_infers_remmaq_variable_from_clean_sheet_source(db_session) -> None:
    run = EtlRun(trigger_type="automatic", source="REMMAQ", status="completed")
    station = Station(code="BEL", name="Belisario", latitude=-0.184719, longitude=-78.495986)
    clean_sheet = Variable(code="LIMPIO", display_name="LIMPIO", category="other", default_unit="ug/m3")
    db_session.add_all([run, station, clean_sheet])
    db_session.commit()

    source = SourceFile(
        etl_run_id=run.id,
        source_type="public_dashboard",
        source_url="https://datosambiente.quito.gob.ec/datos/PM2.5.rar",
        original_name="PM2.5.rar",
        local_archive_path="PM2.5.rar",
        checksum_sha256="f" * 64,
        status="completed",
        row_count=2,
    )
    db_session.add(source)
    db_session.commit()

    for observed_at, value in [(datetime(2026, 1, 1, 10), 10.0), (datetime(2026, 1, 1, 11), 20.0)]:
        db_session.add(
            Measurement(
                station_id=station.id,
                variable_id=clean_sheet.id,
                observed_at=observed_at,
                value=value,
                unit="ug/m3",
                source_file_id=source.id,
                record_hash=compute_record_hash(station.code, "LIMPIO", observed_at.replace(tzinfo=UTC)),
            )
        )
    db_session.commit()

    response = get_public_air_quality_snapshot(db_session, variable_code="PM25", period="72h")
    pm25_summary = next(item for item in response.variable_summaries if item.variable_code == "PM25")

    assert response.variable_code == "PM25"
    assert response.station_count == 1
    assert response.observation_count == 2
    assert response.stations[0].latest_value == 20.0
    assert pm25_summary.sample_count == 2
    assert all(option.code != "LIMPIO" for option in response.variables)


def test_public_air_quality_variable_summaries_use_each_variable_latest_relative_window(db_session) -> None:
    run = EtlRun(trigger_type="automatic", source="REMMAQ", status="completed")
    station = Station(code="BEL", name="Belisario", latitude=-0.184719, longitude=-78.495986)
    clean_sheet = Variable(code="LIMPIO", display_name="LIMPIO", category="other", default_unit="ug/m3")
    db_session.add_all([run, station, clean_sheet])
    db_session.commit()

    pm25_source = SourceFile(
        etl_run_id=run.id,
        source_type="public_dashboard",
        source_url="https://datosambiente.quito.gob.ec/datos/PM2.5.rar",
        original_name="PM2.5.rar",
        local_archive_path="PM2.5.rar",
        checksum_sha256="a" * 64,
        status="completed",
        row_count=1,
    )
    co_source = SourceFile(
        etl_run_id=run.id,
        source_type="public_dashboard",
        source_url="https://datosambiente.quito.gob.ec/datos/CO.rar",
        original_name="CO.rar",
        local_archive_path="CO.rar",
        checksum_sha256="b" * 64,
        status="completed",
        row_count=1,
    )
    db_session.add_all([pm25_source, co_source])
    db_session.commit()

    rows = [
        (pm25_source, datetime(2026, 1, 3, 11), 20.0),
        (co_source, datetime(2026, 1, 1, 11), 0.7),
    ]
    for source, observed_at, value in rows:
        db_session.add(
            Measurement(
                station_id=station.id,
                variable_id=clean_sheet.id,
                observed_at=observed_at,
                value=value,
                unit="ug/m3",
                source_file_id=source.id,
                record_hash=compute_record_hash(station.code, "LIMPIO", observed_at.replace(tzinfo=UTC)),
            )
        )
    db_session.commit()

    response = get_public_air_quality_snapshot(db_session, variable_code="PM25", hours=24)
    summaries = {item.variable_code: item for item in response.variable_summaries}

    assert response.variable_code == "PM25"
    assert response.observation_count == 1
    assert summaries["PM25"].sample_count == 1
    assert summaries["CO"].sample_count == 1
    assert summaries["CO"].latest_available_at == datetime(2026, 1, 1, 11)


def test_public_air_quality_snapshot_filters_period_summary_by_station(db_session) -> None:
    _seed_public_measurements(db_session)

    response = get_public_air_quality_snapshot(
        db_session,
        variable_code="PM25",
        period="72h",
        station_code="BEL",
    )

    assert response.station_count == 1
    assert response.observation_count == 2
    assert response.period_summary.avg_value == 15.0
    assert response.period_summary.max_value == 18.0
    assert response.period_summary.rds == 2


def test_prepare_public_remmaq_sync_queues_all_supported_variables_and_throttles(db_session) -> None:
    prepared = prepare_public_remmaq_sync(db_session, now=datetime(2026, 1, 1, 12, tzinfo=UTC))

    assert prepared is not None
    run_id, selected_variables, max_archives, force_reprocess, observed_from, observed_to = prepared
    run = db_session.get(EtlRun, run_id)

    assert selected_variables == list(REMMAQ_VARIABLE_CODES)
    assert max_archives == len(REMMAQ_VARIABLE_CODES)
    assert force_reprocess is False
    assert observed_from is not None
    assert observed_from.isoformat() == "2024-07-10"
    assert observed_to is None
    assert run.details["public_dashboard_sync"] is True
    assert run.details["public_dashboard_policy"] == "all_remmaq_variables_1_hour_throttle_recent_window"
    assert run.details["selected_variables"] == list(REMMAQ_VARIABLE_CODES)

    run.status = "completed"
    db_session.add(run)
    db_session.commit()

    throttled = prepare_public_remmaq_sync(db_session, now=datetime(2026, 1, 1, 12, 59, tzinfo=UTC))

    assert throttled is None
