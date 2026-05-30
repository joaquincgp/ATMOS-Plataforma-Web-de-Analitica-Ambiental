# Unit tests intentionally exercise internal file helpers.
# pylint: disable=protected-access

from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

from app.services.manual_dataset import ManualDatasetService
from app.services.manual_dataset.io import ManualDatasetIOMixin


class FailingManualIO(ManualDatasetIOMixin):
    @staticmethod
    def _manual_dataset_error(message: str) -> ValueError:
        return ValueError(message)


def test_read_dataframe_from_csv_and_txt_bytes() -> None:
    io = FailingManualIO()
    content = b"station,value\nA,10\nB,NA\n"

    csv_frame = io._read_dataframe_from_bytes(content, "data.csv")
    txt_frame = io._read_dataframe_from_bytes(content, "data.txt")

    assert csv_frame.shape == (2, 2)
    assert pd.isna(csv_frame.loc[1, "value"])
    assert txt_frame.loc[0, "station"] == "A"


def test_read_dataframe_from_bytes_rejects_unknown_suffix() -> None:
    io = FailingManualIO()

    with pytest.raises(ValueError, match="Formato no soportado"):
        io._read_dataframe_from_bytes(b"{}", "data.json")


def test_dataset_query_file_prefers_existing_processed_file(tmp_path: Path) -> None:
    service = ManualDatasetService(db=None)
    processed = tmp_path / "processed.csv"
    raw = tmp_path / "raw.csv"
    processed.write_text("value\n1\n", encoding="utf-8")
    raw.write_text("value\n2\n", encoding="utf-8")
    dataset = SimpleNamespace(
        processed_file_path=str(processed),
        raw_file_path=str(raw),
        original_file_name="data.csv",
    )

    frame = service._read_dataframe_for_query(dataset)

    assert frame["value"].tolist() == [1]
    assert service._dataset_query_file_exists(dataset) is True


def test_io_path_helpers_normalize_urls_and_remove_files(tmp_path: Path) -> None:
    service = ManualDatasetService(db=None)
    workspace = SimpleNamespace(storage_path=str(tmp_path))
    removable_file = tmp_path / "remove-me.csv"
    removable_dir = tmp_path / "datasets" / "manual" / "dataset-1"
    staging_dir = tmp_path / "datasets" / "manual" / "_staging"
    removable_file.write_text("x", encoding="utf-8")
    removable_dir.mkdir(parents=True)
    staging_dir.mkdir(parents=True)

    assert service._build_dataset_dir(workspace, "dataset-1") == removable_dir
    assert service._build_dataset_dir(workspace, None) == staging_dir
    assert service._normalize_raw_csv_url("https://github.com/org/repo/blob/main/data.csv") == (
        "https://raw.githubusercontent.com/org/repo/main/data.csv"
    )
    assert service._safe_filename("../bad/name.csv") == "name.csv"

    service._remove_file_path(str(removable_file))
    service._remove_dataset_dir(removable_dir)
    service._remove_dataset_dir(staging_dir)

    assert not removable_file.exists()
    assert not removable_dir.exists()
    assert staging_dir.exists()
