# SQLite-backed tests for the shared ML Experiments dataset/feature-engineering module.
from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import EtlRun, Measurement, SourceFile, Station, Variable
from app.models.base import Base
from app.services.etl.helpers import compute_record_hash
from app.services.ml_experiments.dataset import MLExperimentError, build_ml_dataset


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


def _seed_hourly_measurements(
    db_session,
    *,
    station_code: str,
    variable_code: str,
    start: datetime,
    hours: int,
    skip_hours: set[int] = frozenset(),
) -> tuple[Station, Variable]:
    station = db_session.query(Station).filter_by(code=station_code).one_or_none()
    if station is None:
        station = Station(code=station_code, name=station_code)
        db_session.add(station)
        db_session.commit()
    variable = db_session.query(Variable).filter_by(code=variable_code).one_or_none()
    if variable is None:
        variable = Variable(code=variable_code, display_name=variable_code, category="other")
        db_session.add(variable)
        db_session.commit()
    run = EtlRun(trigger_type="manual", source="test", status="completed")
    db_session.add(run)
    db_session.commit()
    source = SourceFile(
        etl_run_id=run.id,
        source_type="manual",
        source_url=None,
        original_name=f"{variable_code}.csv",
        local_archive_path=f"{variable_code}.csv",
        checksum_sha256="a" * 64,
        status="completed",
        row_count=hours,
    )
    db_session.add(source)
    db_session.commit()
    for hour in range(hours):
        if hour in skip_hours:
            continue
        observed_at = start + timedelta(hours=hour)
        db_session.add(
            Measurement(
                station_id=station.id,
                variable_id=variable.id,
                observed_at=observed_at,
                value=10.0 + hour * 0.1,
                unit=None,
                source_file_id=source.id,
                record_hash=compute_record_hash(station.code, variable.code, observed_at),
            )
        )
    db_session.commit()
    return station, variable


def test_build_ml_dataset_interpolates_gaps_and_splits_chronologically(db_session) -> None:
    start = datetime(2025, 1, 1, 0, 0)
    _seed_hourly_measurements(
        db_session, station_code="A", variable_code="PM25", start=start, hours=72, skip_hours={10, 11, 30}
    )
    _seed_hourly_measurements(db_session, station_code="A", variable_code="TMP", start=start, hours=72)
    _seed_hourly_measurements(db_session, station_code="A", variable_code="HUM", start=start, hours=72)
    # VEL intentionally has zero data to exercise the constant-fallback + warning path.

    dataset = build_ml_dataset(
        db_session,
        target_variable_code="PM25",
        station_codes=["A"],
        date_from=None,
        date_to=None,
        train_split=0.8,
    )

    total_rows = len(dataset.train_df) + len(dataset.test_df)
    assert total_rows == 72
    assert dataset.train_df.index[-1] < dataset.test_df.index[0]
    assert not dataset.train_df[dataset.target_name].isna().any()
    assert not dataset.test_df[dataset.target_name].isna().any()
    assert dataset.feature_names == ["Temperature", "Humidity", "Wind Speed", "Hour of Day", "Day of Week"]
    assert any("Wind Speed" in warning for warning in dataset.warnings)
    assert dataset.train_df.loc[start, "Hour of Day"] == 0
    assert dataset.train_df.loc[start, "Day of Week"] == start.weekday()


def test_build_ml_dataset_raises_when_target_variable_has_no_data(db_session) -> None:
    with pytest.raises(MLExperimentError, match="No se encontraron mediciones"):
        build_ml_dataset(
            db_session,
            target_variable_code="PM25",
            station_codes=[],
            date_from=None,
            date_to=None,
            train_split=0.8,
        )


def test_build_ml_dataset_raises_when_not_enough_usable_rows(db_session) -> None:
    start = datetime(2025, 1, 1, 0, 0)
    _seed_hourly_measurements(db_session, station_code="A", variable_code="PM25", start=start, hours=5)

    with pytest.raises(MLExperimentError, match="al menos"):
        build_ml_dataset(
            db_session,
            target_variable_code="PM25",
            station_codes=["A"],
            date_from=None,
            date_to=None,
            train_split=0.8,
        )


def test_build_ml_dataset_falls_back_to_city_wide_when_station_has_no_data(db_session) -> None:
    start = datetime(2025, 1, 1, 0, 0)
    _seed_hourly_measurements(db_session, station_code="A", variable_code="PM25", start=start, hours=72)

    dataset = build_ml_dataset(
        db_session,
        target_variable_code="PM25",
        station_codes=["DOES-NOT-EXIST"],
        date_from=None,
        date_to=None,
        train_split=0.7,
    )

    assert len(dataset.train_df) + len(dataset.test_df) == 72
