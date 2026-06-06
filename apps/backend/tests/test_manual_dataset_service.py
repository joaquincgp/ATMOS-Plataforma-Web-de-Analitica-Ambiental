# Unit tests intentionally exercise internal persistence helpers without
# requiring the full service/database path.
# pylint: disable=protected-access

from types import SimpleNamespace

import pandas as pd
import pytest
from pandas.testing import assert_frame_equal

from app.schemas.etl import ManualDatasetRoleMapping
from app.services.manual_dataset import ManualDatasetError, ManualDatasetService


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


def test_manual_dataset_io_variants_and_error_paths(tmp_path, monkeypatch):
    service = ManualDatasetService(db=None)
    dataframe = pd.DataFrame({"station": ["UIO", "GYE"], "value": [10.5, 12.0]})

    csv_path = tmp_path / "manual.csv"
    txt_path = tmp_path / "manual.txt"
    xlsx_path = tmp_path / "manual.xlsx"
    dataframe.to_csv(csv_path, index=False)
    dataframe.to_csv(txt_path, index=False)
    dataframe.to_excel(xlsx_path, index=False)

    assert_frame_equal(service._read_dataframe(csv_path, "manual.csv"), dataframe, check_dtype=False)
    assert_frame_equal(service._read_dataframe(txt_path, "manual.txt"), dataframe, check_dtype=False)
    assert_frame_equal(service._read_dataframe(xlsx_path, "manual.xlsx"), dataframe, check_dtype=False)
    assert_frame_equal(
        service._read_dataframe_from_bytes(csv_path.read_bytes(), "manual.csv"),
        dataframe,
        check_dtype=False,
    )
    assert_frame_equal(
        service._read_dataframe_from_bytes(txt_path.read_bytes(), "manual.txt"),
        dataframe,
        check_dtype=False,
    )
    assert_frame_equal(
        service._read_dataframe_from_bytes(xlsx_path.read_bytes(), "manual.xlsx"),
        dataframe,
        check_dtype=False,
    )

    monkeypatch.setattr(
        pd.DataFrame,
        "to_parquet",
        lambda self, path, index=False: (_ for _ in ()).throw(ImportError("no parquet")),
    )
    fallback_path = service._write_processed_dataframe(dataframe, tmp_path / "fallback")
    dataset = SimpleNamespace(
        processed_file_path=str(fallback_path),
        raw_file_path=str(csv_path),
        original_file_name="manual.csv",
    )

    assert fallback_path.suffix == ".csv"
    assert service._dataset_query_file_exists(dataset) is True
    assert_frame_equal(service._read_dataframe_for_query(dataset), dataframe, check_dtype=False)
    raw_only_dataset = SimpleNamespace(
        processed_file_path=str(tmp_path / "missing-processed.csv"),
        raw_file_path=str(csv_path),
        original_file_name="manual.csv",
    )
    assert_frame_equal(service._read_dataframe_for_query(raw_only_dataset), dataframe, check_dtype=False)
    assert service._normalize_raw_csv_url(" https://github.com/org/repo/blob/main/data.csv ") == (
        "https://raw.githubusercontent.com/org/repo/main/data.csv"
    )
    assert service._safe_filename(r"folder\manual.csv") == "manual.csv"
    assert service._safe_filename("") == "manual-dataset.csv"
    assert service._build_dataset_dir(SimpleNamespace(storage_path=str(tmp_path)), "dataset-1").name == "dataset-1"
    assert service._build_dataset_dir(SimpleNamespace(storage_path=str(tmp_path)), None).name == "_staging"

    removable_file = tmp_path / "remove-me.csv"
    removable_file.write_text("x", encoding="utf-8")
    service._remove_file_path(str(removable_file))
    service._remove_file_path(None)
    assert not removable_file.exists()

    removable_dir = tmp_path / "datasets" / "manual" / "dataset-2"
    removable_dir.mkdir(parents=True)
    service._remove_dataset_dir(removable_dir)
    assert not removable_dir.exists()

    with pytest.raises(ManualDatasetError):
        service._read_dataframe(tmp_path / "missing.csv", "missing.csv")
    unsupported_path = tmp_path / "manual.json"
    unsupported_path.write_text("{}", encoding="utf-8")
    with pytest.raises(ManualDatasetError):
        service._read_dataframe(unsupported_path, "manual.json")
    with pytest.raises(ManualDatasetError):
        service._read_dataframe_from_bytes(b"value\n1\n", "manual.json")
    with pytest.raises(ManualDatasetError):
        service._read_dataframe_for_query(
            SimpleNamespace(processed_file_path=None, raw_file_path=None, original_file_name="manual.csv")
        )


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
