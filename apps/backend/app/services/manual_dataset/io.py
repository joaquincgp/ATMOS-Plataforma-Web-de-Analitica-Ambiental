from __future__ import annotations

import shutil
from io import BytesIO
from pathlib import Path

import pandas as pd

from app.models.manual_dataset import ManualDataset

NA_VALUES = ["", "NA", "N/A", "na", "n/a", "NaN", "nan", "NULL", "null", "missing", "-", "--"]
MANUAL_ALLOWED_SUFFIXES = {".csv", ".xlsx", ".xls", ".txt"}


class ManualDatasetIOMixin:
    def _read_dataframe_from_bytes(self, content: bytes, original_name: str) -> pd.DataFrame:
        suffix = Path(original_name).suffix.lower()
        buffer = BytesIO(content)
        if suffix == ".csv":
            return pd.read_csv(buffer, na_values=NA_VALUES, keep_default_na=True)
        if suffix == ".txt":
            return pd.read_csv(buffer, sep=None, engine="python", na_values=NA_VALUES, keep_default_na=True)
        if suffix in {".xlsx", ".xls"}:
            return pd.read_excel(buffer, na_values=NA_VALUES, keep_default_na=True)
        raise self._manual_dataset_error(f"Formato no soportado para inspección manual: {suffix or original_name}")

    def _read_dataframe(self, file_path: Path, original_name: str) -> pd.DataFrame:
        if not file_path.exists():
            raise self._manual_dataset_error(
                "El archivo fisico del dataset ya no existe en almacenamiento. "
                "Vuelve a cargar y finalizar la fuente antes de generar graficos."
            )
        suffix = file_path.suffix.lower() or Path(original_name).suffix.lower()
        if suffix == ".parquet":
            return pd.read_parquet(file_path)
        if suffix == ".csv":
            return pd.read_csv(file_path, na_values=NA_VALUES, keep_default_na=True)
        if suffix == ".txt":
            return pd.read_csv(file_path, sep=None, engine="python", na_values=NA_VALUES, keep_default_na=True)
        if suffix in {".xlsx", ".xls"}:
            return pd.read_excel(file_path, na_values=NA_VALUES, keep_default_na=True)
        raise self._manual_dataset_error(f"Formato no soportado para inspección manual: {suffix or original_name}")

    def _read_dataframe_for_query(self, dataset: ManualDataset) -> pd.DataFrame:
        if dataset.processed_file_path:
            processed_path = Path(dataset.processed_file_path)
            if processed_path.exists():
                return self._read_dataframe(processed_path, dataset.original_file_name)
        raw_path = Path(dataset.raw_file_path) if dataset.raw_file_path else None
        if raw_path and raw_path.exists():
            return self._read_dataframe(raw_path, dataset.original_file_name)
        raise self._manual_dataset_error(
            "El dataset seleccionado ya no tiene archivo fisico asociado. "
            "Selecciona la version recien cargada o vuelve a cargar la fuente."
        )

    def _dataset_query_file_exists(self, dataset: ManualDataset) -> bool:
        if dataset.processed_file_path and Path(dataset.processed_file_path).exists():
            return True
        return bool(dataset.raw_file_path and Path(dataset.raw_file_path).exists())

    def _write_processed_dataframe(self, dataframe: pd.DataFrame, target_base_path: Path) -> Path:
        parquet_path = target_base_path.with_suffix(".parquet")
        try:
            dataframe.to_parquet(parquet_path, index=False)
            self._remove_file_path(str(target_base_path.with_suffix(".csv")))
            return parquet_path
        except (ImportError, ModuleNotFoundError, ValueError):
            csv_path = target_base_path.with_suffix(".csv")
            dataframe.to_csv(csv_path, index=False)
            self._remove_file_path(str(parquet_path))
            return csv_path

    def _build_dataset_dir(self, workspace, dataset_id: str | None) -> Path:
        workspace_root = Path(workspace.storage_path)
        base_dir = workspace_root / "datasets" / "manual"
        if dataset_id:
            return base_dir / dataset_id
        return base_dir / "_staging"

    def _normalize_raw_csv_url(self, value: str) -> str:
        cleaned = value.strip()
        if "github.com" in cleaned and "raw.githubusercontent.com" not in cleaned:
            cleaned = cleaned.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/")
        return cleaned

    def _safe_filename(self, filename: str) -> str:
        safe = Path(filename).name.replace("/", "_").replace("\\", "_")
        return safe or "manual-dataset.csv"

    def _remove_dataset_dir(self, directory: Path | None) -> None:
        if directory is None or not directory.exists() or directory.name == "_staging":
            return
        shutil.rmtree(directory, ignore_errors=True)

    def _remove_file_path(self, file_path: str | None) -> None:
        if not file_path:
            return
        path = Path(file_path)
        if path.exists() and path.is_file():
            path.unlink(missing_ok=True)
