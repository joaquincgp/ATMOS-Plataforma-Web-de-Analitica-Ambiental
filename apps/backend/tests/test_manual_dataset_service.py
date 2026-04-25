from types import SimpleNamespace

import pandas as pd
from pandas.testing import assert_frame_equal

from app.schemas.etl import ManualDatasetRoleMapping
from app.services.manual_dataset import ManualDatasetService


def test_write_processed_dataframe_roundtrip(tmp_path):
    service = ManualDatasetService(db=None)
    dataframe = pd.DataFrame(
        {
            "station": ["UIO", "GYE"],
            "value": [10.5, 12.0],
        }
    )

    processed_path = service._write_processed_dataframe(dataframe, tmp_path / "processed")

    assert processed_path.exists()
    assert processed_path.suffix in {".parquet", ".csv"}

    reloaded = service._read_dataframe(processed_path, "manual-dataset.csv")
    assert_frame_equal(reloaded, dataframe, check_dtype=False)


def test_get_analytics_rows_marks_truncated_when_limit_is_applied():
    service = ManualDatasetService(db=None)
    dataframe = pd.DataFrame(
        {
            "observed_at": pd.date_range("2024-01-01", periods=4, freq="D"),
            "station": ["UIO", "UIO", "UIO", "UIO"],
            "variable": ["pm25", "pm25", "pm25", "pm25"],
            "value": [10.0, 11.0, 12.0, 13.0],
            "unit": ["ug/m3", "ug/m3", "ug/m3", "ug/m3"],
        }
    )
    mapping = ManualDatasetRoleMapping(
        datetime_column="observed_at",
        station_code_column="station",
        variable_code_column="variable",
        value_column="value",
        unit_column="unit",
    )
    dataset = SimpleNamespace(
        source_file_id=None,
        name="demo-dataset",
        mapping_config=mapping.model_dump(),
        processed_file_path=None,
        raw_file_path="unused.csv",
        original_file_name="unused.csv",
    )

    service._get_dataset = lambda *, dataset_id, user: dataset
    service._read_dataframe_for_query = lambda current_dataset: dataframe

    response = service.get_analytics_rows(
        dataset_id="dataset-1",
        user=SimpleNamespace(id="user-1"),
        limit=2,
    )

    assert response.truncated is True
    assert response.row_count == 2
    assert len(response.rows) == 2
    assert response.rows[0].station_code == "UIO"


def test_get_analytics_rows_filters_visible_window_before_building_rows():
    service = ManualDatasetService(db=None)
    dataframe = pd.DataFrame(
        {
            "observed_at": pd.date_range("2024-01-01", periods=4, freq="D", tz="UTC"),
            "station": ["UIO", "UIO", "UIO", "UIO"],
            "variable": ["pm25", "pm25", "pm25", "pm25"],
            "value": [10.0, 11.0, 12.0, 13.0],
        }
    )
    mapping = ManualDatasetRoleMapping(
        datetime_column="observed_at",
        station_code_column="station",
        variable_code_column="variable",
        value_column="value",
    )
    dataset = SimpleNamespace(
        source_file_id=None,
        name="demo-dataset",
        mapping_config=mapping.model_dump(),
        processed_file_path=None,
        raw_file_path="unused.csv",
        original_file_name="unused.csv",
    )

    service._get_dataset = lambda *, dataset_id, user: dataset
    service._read_dataframe_for_query = lambda current_dataset: dataframe

    response = service.get_analytics_rows(
        dataset_id="dataset-1",
        user=SimpleNamespace(id="user-1"),
        view_from=pd.Timestamp("2024-01-02T00:00:00Z").to_pydatetime(),
        view_to=pd.Timestamp("2024-01-03T23:59:59Z").to_pydatetime(),
    )

    assert response.truncated is False
    assert response.row_count == 2
    assert [row.value for row in response.rows] == [11.0, 12.0]
