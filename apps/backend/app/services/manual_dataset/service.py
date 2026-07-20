from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

import httpx
import pandas as pd
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.core.time import ecuador_now_naive
from app.models.etl_run import EtlRun
from app.models.manual_dataset import ManualDataset
from app.models.measurement import DATA_ORIGIN_USER, Measurement
from app.models.source_file import SourceFile
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.analytics import AnalyticsDataRowResponse, AnalyticsQueryResponse
from app.schemas.auth import UserRole
from app.schemas.etl import (
    ManualDatasetColumnProfile,
    ManualDatasetFinalizeRequest,
    ManualDatasetMissingDataColumn,
    ManualDatasetMissingDataOverviewResponse,
    ManualDatasetOperation,
    ManualDatasetResponse,
    ManualDatasetRoleMapping,
    ManualDatasetSummary,
    ManualDatasetUpdateRequest,
)
from app.services.etl import EtlService
from app.services.etl.helpers import compute_sha256, normalize_station_code, normalize_variable_code
from app.services.manual_dataset.io import MANUAL_ALLOWED_SUFFIXES, ManualDatasetIOMixin
from app.services.manual_dataset.pipeline import ManualDatasetPipelineMixin


class ManualDatasetError(Exception):
    pass


# REMMAQ historical archives bundle the entire 2004-present history per
# variable; the request has to fully download before date filtering can even
# apply, so this isolated sync needs more headroom than the default ETL
# timeout (tuned for Data Manager's 1-3 variable imports). The cache lets a
# retry of the same variable skip a redundant multi-minute re-download.
_ML_SOURCE_REQUEST_TIMEOUT_SECONDS = 300
_ML_SOURCE_DOWNLOAD_CACHE_TTL_SECONDS = 6 * 60 * 60


@dataclass
class ManualDatasetEdaContext:
    dataset: ManualDataset
    dataframe: pd.DataFrame
    mapping: ManualDatasetRoleMapping
    summary: ManualDatasetSummary
    columns: list[ManualDatasetColumnProfile]


class ManualDatasetService(ManualDatasetIOMixin, ManualDatasetPipelineMixin):
    def __init__(self, db: Session):
        self.db = db

    def _manual_dataset_error(self, message: str) -> ManualDatasetError:
        return ManualDatasetError(message)

    def create_from_upload(
        self,
        *,
        workspace_id: str,
        user: User,
        filename: str,
        content: bytes,
    ) -> ManualDatasetResponse:
        suffix = Path(filename).suffix.lower()
        if suffix not in MANUAL_ALLOWED_SUFFIXES:
            raise ManualDatasetError("Carga manual solo soporta archivos CSV, XLSX, XLS o TXT.")

        workspace = self._get_workspace(workspace_id=workspace_id, user=user)
        dataframe = self._read_dataframe_from_bytes(content, filename)
        return self._create_draft_dataset(
            workspace=workspace,
            user=user,
            dataframe=dataframe,
            original_file_name=filename,
            raw_bytes=content,
            source_kind="upload",
            source_url=None,
            dataset_name=Path(filename).stem.strip() or "manual-dataset",
        )

    def create_from_url(
        self,
        *,
        workspace_id: str,
        user: User,
        source_url: str,
    ) -> ManualDatasetResponse:
        normalized_url = self._normalize_raw_csv_url(source_url)
        if not normalized_url.lower().split("?")[0].endswith(".csv"):
            raise ManualDatasetError("El link debe apuntar a un CSV raw y terminar en .csv.")

        try:
            response = httpx.get(normalized_url, timeout=30.0, follow_redirects=True)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ManualDatasetError(f"No se pudo descargar el CSV: {exc}") from exc

        filename = Path(normalized_url.split("?")[0]).name or "manual-dataset.csv"
        dataset = self.create_from_upload(
            workspace_id=workspace_id,
            user=user,
            filename=filename,
            content=response.content,
        )
        entity = self.db.get(ManualDataset, dataset.id)
        if entity is None:
            raise ManualDatasetError("No se pudo registrar el dataset descargado.")
        entity.source_kind = "github_raw"
        entity.source_url = normalized_url
        self.db.add(entity)
        self.db.commit()
        self.db.refresh(entity)
        return self._to_response(entity)

    def create_from_remmaq(
        self,
        *,
        workspace_id: str,
        user: User,
        variable_codes: list[str] | None,
        max_archives: int | None,
        observed_from: date | None,
        observed_to: date | None,
    ) -> ManualDatasetResponse:
        workspace = self._get_workspace(workspace_id=workspace_id, user=user)
        etl_service = EtlService(self.db)
        try:
            dataframe, archives = etl_service.extract_remmaq_dataframe(
                variable_codes=variable_codes,
                max_archives=max_archives,
                observed_from=observed_from,
                observed_to=observed_to,
            )
        except Exception as exc:  # noqa: BLE001
            raise ManualDatasetError(f"No se pudo preparar REMMAQ: {exc}") from exc

        selected_codes = sorted({str(row.get("variable_code", "")).strip() for row in archives})
        dataset_name = f"remmaq-{'-'.join(selected_codes).lower()}" if selected_codes else "remmaq-dataset"
        generated_filename = f"{dataset_name}.csv"
        raw_bytes = dataframe.to_csv(index=False).encode("utf-8")
        response = self._create_draft_dataset(
            workspace=workspace,
            user=user,
            dataframe=dataframe,
            original_file_name=generated_filename,
            raw_bytes=raw_bytes,
            source_kind="remmaq",
            source_url="https://datosambiente.quito.gob.ec/",
            dataset_name=dataset_name,
        )
        entity = self.db.get(ManualDataset, response.id)
        if entity is None:
            raise ManualDatasetError("No se pudo registrar el dataset REMMAQ.")
        entity.preview_rows = list(entity.preview_rows or [])
        self.db.add(entity)
        self.db.commit()
        self.db.refresh(entity)
        return self._to_response(entity)

    def create_ml_experiment_source_draft(
        self,
        *,
        workspace_id: str,
        user: User,
        target_variable_code: str,
        date_from: date | None,
        date_to: date | None,
    ) -> ManualDatasetResponse:
        workspace = self._get_workspace(workspace_id=workspace_id, user=user)
        dataset = ManualDataset(
            id=str(uuid.uuid4()),
            workspace_id=workspace.id,
            owner_user_id=user.id,
            name=f"REMMAQ {target_variable_code} (sincronizando...)",
            source_kind="remmaq",
            source_url="https://datosambiente.quito.gob.ec/",
            original_file_name=f"remmaq-{target_variable_code.lower()}.csv",
            raw_file_path="",
            checksum_sha256="pending",
            status="syncing",
            storage_format="csv",
            dataset_kind=None,
            created_for="ml_experiments",
            profile_summary={"row_count": 0, "column_count": 0},
            source_metadata={
                "target_variable_code": target_variable_code,
                "date_from": date_from.isoformat() if date_from else None,
                "date_to": date_to.isoformat() if date_to else None,
            },
        )
        self.db.add(dataset)
        self.db.commit()
        self.db.refresh(dataset)
        return self._to_response(dataset)

    def run_ml_experiment_source_sync(
        self,
        *,
        dataset_id: str,
        target_variable_code: str,
        date_from: date | None,
        date_to: date | None,
    ) -> None:
        dataset = self.db.get(ManualDataset, dataset_id)
        if dataset is None:
            return
        workspace = self.db.get(Workspace, dataset.workspace_id)
        if workspace is None:
            dataset.status = "failed"
            dataset.error_message = "Workspace no encontrado."
            self.db.add(dataset)
            self.db.commit()
            return

        def _report_progress(archives_done: int, archives_total: int, rows_collected: int) -> None:
            dataset.source_metadata = {
                **(dataset.source_metadata or {}),
                "archives_done": archives_done,
                "archives_total": archives_total,
                "rows_collected": rows_collected,
            }
            self.db.add(dataset)
            try:
                self.db.commit()
            except StaleDataError:
                # The source was deleted while syncing; nothing left to update.
                self.db.rollback()

        etl_service = EtlService(self.db)
        try:
            dataframe, _archives = etl_service.extract_remmaq_dataframe(
                variable_codes=[target_variable_code, "TMP", "HUM", "VEL"],
                max_archives=None,
                observed_from=date_from,
                observed_to=date_to,
                request_timeout_seconds=_ML_SOURCE_REQUEST_TIMEOUT_SECONDS,
                cache_ttl_seconds=_ML_SOURCE_DOWNLOAD_CACHE_TTL_SECONDS,
                progress_callback=_report_progress,
            )
        except Exception as exc:  # noqa: BLE001
            try:
                dataset.status = "failed"
                dataset.error_message = f"No se pudo sincronizar REMMAQ: {exc}"
                self.db.add(dataset)
                self.db.commit()
            except StaleDataError:
                self.db.rollback()
            return

        mapping = self._suggest_mapping(dataframe)
        transformed_df = self._apply_pipeline(dataframe.copy(), [], mapping)
        raw_bytes = dataframe.to_csv(index=False).encode("utf-8")

        final_dir = self._build_dataset_dir(workspace, dataset.id)
        final_dir.mkdir(parents=True, exist_ok=True)
        final_raw_path = final_dir / self._safe_filename(dataset.original_file_name)
        final_raw_path.write_bytes(raw_bytes)

        dataset.raw_file_path = str(final_raw_path.resolve())
        dataset.checksum_sha256 = compute_sha256(raw_bytes)
        self._sync_dataset_state(dataset, transformed_df, [], mapping)

        observed_at_parsed = pd.to_datetime(dataframe["observed_at"], errors="coerce")
        has_dates = bool(observed_at_parsed.notna().any())
        actual_date_from = observed_at_parsed.min().date().isoformat() if has_dates else None
        actual_date_to = observed_at_parsed.max().date().isoformat() if has_dates else None
        dataset.source_metadata = {
            "target_variable_code": target_variable_code,
            "variable_codes": sorted(dataframe["variable_code"].dropna().unique().tolist()),
            "station_codes": sorted(dataframe["station_code"].dropna().unique().tolist()),
            "date_from": actual_date_from,
            "date_to": actual_date_to,
            "extracted_at": ecuador_now_naive().isoformat(),
            "is_custom_name": False,
        }
        date_range_label = f" ({actual_date_from} a {actual_date_to})" if has_dates else ""
        dataset.name = f"REMMAQ {target_variable_code}{date_range_label}"
        dataset.status = "draft"
        dataset.error_message = None
        self.db.add(dataset)
        try:
            self.db.commit()
        except StaleDataError:
            # The source was deleted while syncing; discard the finished result.
            self.db.rollback()

    def list_ml_experiment_sources(self, *, workspace_id: str, user: User) -> list[ManualDatasetResponse]:
        workspace = self._get_workspace(workspace_id=workspace_id, user=user)
        datasets = list(
            self.db.scalars(
                select(ManualDataset)
                .where(ManualDataset.workspace_id == workspace.id)
                .where(ManualDataset.created_for == "ml_experiments")
                .order_by(ManualDataset.created_at.desc())
            ).all()
        )
        return [self._to_response(dataset) for dataset in datasets]

    def get_ml_experiment_source(self, *, dataset_id: str, user: User) -> ManualDatasetResponse:
        dataset = self._get_ml_experiment_source_entity(dataset_id=dataset_id, user=user)
        return self._to_response(dataset)

    def rename_ml_experiment_source(
        self,
        *,
        dataset_id: str,
        user: User,
        name: str,
    ) -> ManualDatasetResponse:
        dataset = self._get_ml_experiment_source_entity(dataset_id=dataset_id, user=user)
        if dataset.status == "syncing":
            raise ManualDatasetError("Espera a que termine la sincronización antes de renombrar la fuente.")

        cleaned_name = " ".join(name.split()).strip()
        if not cleaned_name:
            raise ManualDatasetError("El nombre de la fuente no puede estar vacío.")
        if len(cleaned_name) > 255:
            raise ManualDatasetError("El nombre de la fuente no puede superar 255 caracteres.")

        metadata = dict(dataset.source_metadata or {})
        if dataset.status == "draft" and not metadata.get("extracted_at"):
            metadata["extracted_at"] = dataset.updated_at.isoformat()
        metadata["is_custom_name"] = True
        dataset.name = cleaned_name
        dataset.source_metadata = metadata
        self.db.add(dataset)
        self.db.commit()
        self.db.refresh(dataset)
        return self._to_response(dataset)

    def delete_ml_experiment_source(self, *, dataset_id: str, user: User) -> None:
        self._get_ml_experiment_source_entity(dataset_id=dataset_id, user=user)
        self.delete_dataset(dataset_id=dataset_id, user=user)

    def _get_ml_experiment_source_entity(self, *, dataset_id: str, user: User) -> ManualDataset:
        dataset = self._get_dataset(dataset_id=dataset_id, user=user)
        if dataset.created_for != "ml_experiments":
            raise ManualDatasetError("Esta fuente no pertenece a ML Experiments.")
        return dataset

    def get_source_dataframe(self, *, dataset_id: str, user: User) -> pd.DataFrame:
        dataset = self._get_dataset(dataset_id=dataset_id, user=user)
        return self._read_dataframe_for_query(dataset)

    def get_dataset(self, *, dataset_id: str, user: User) -> ManualDatasetResponse:
        dataset = self._get_dataset(dataset_id=dataset_id, user=user)
        return self._to_response(dataset)

    def export_dataset_csv(self, *, dataset_id: str, user: User) -> tuple[bytes, str]:
        dataset = self._get_dataset(dataset_id=dataset_id, user=user)
        dataframe = self._read_dataframe_for_query(dataset)
        if dataset.source_kind == "remmaq":
            readable_columns = [
                "observed_at",
                "station_code",
                "variable_code",
                "value",
                "unit",
                "source_file_name",
                "source_url",
            ]
            ordered_columns = [column for column in readable_columns if column in dataframe.columns]
            ordered_columns.extend([column for column in dataframe.columns if column not in ordered_columns])
            dataframe = dataframe[ordered_columns].copy()
        csv_bytes = dataframe.to_csv(index=False).encode("utf-8-sig")
        filename_stem = self._safe_filename(dataset.name).rsplit(".", 1)[0] or "dataset"
        return csv_bytes, f"{filename_stem}.csv"

    def get_missing_data_overview(
        self,
        *,
        dataset_id: str,
        user: User,
    ) -> ManualDatasetMissingDataOverviewResponse:
        dataset = self._get_dataset(dataset_id=dataset_id, user=user)
        dataframe = self._read_dataframe_for_query(dataset).replace({None: pd.NA})
        return self._build_missing_data_overview(dataset=dataset, dataframe=dataframe)

    def create_missing_data_derivative(
        self,
        *,
        dataset_id: str,
        user: User,
        action: str,
        dataset_name: str | None = None,
    ) -> ManualDatasetResponse:
        source_dataset = self._get_dataset(dataset_id=dataset_id, user=user)
        workspace = self._get_workspace(workspace_id=source_dataset.workspace_id, user=user)
        dataframe = self._read_dataframe_for_query(source_dataset).replace({None: pd.NA})
        original_rows = int(len(dataframe))
        total_missing = int(dataframe.isna().sum().sum())
        if total_missing == 0:
            raise ManualDatasetError("Este dataset no tiene valores faltantes para limpiar.")

        if action == "remove_rows":
            cleaned_df = dataframe.dropna().reset_index(drop=True)
            dropped_rows = original_rows - int(len(cleaned_df))
            operation_label = "remove-missing-rows"
            default_name = f"{source_dataset.name} - rows without missing values"
            operation_metadata = {
                "action": action,
                "rows_before": original_rows,
                "rows_after": int(len(cleaned_df)),
                "rows_dropped": dropped_rows,
            }
        elif action == "impute_knn_mode":
            cleaned_df = self._impute_missing_values_knn_mode(dataframe).reset_index(drop=True)
            operation_label = "imputed-knn-mode"
            default_name = f"{source_dataset.name} - imputed missing values"
            operation_metadata = {
                "action": action,
                "rows_before": original_rows,
                "rows_after": int(len(cleaned_df)),
                "numeric_strategy": "knn",
                "categorical_strategy": "mode",
            }
        else:
            raise ManualDatasetError("Accion de limpieza no soportada.")

        cleaned_name = " ".join((dataset_name or default_name).split()).strip() or default_name
        self._validate_dataset_name_uniqueness(workspace_id=workspace.id, dataset_name=cleaned_name)

        derivative_id = str(uuid.uuid4())
        final_dir = self._build_dataset_dir(workspace, derivative_id)
        final_dir.mkdir(parents=True, exist_ok=True)
        original_stem = Path(source_dataset.original_file_name).stem or "manual-dataset"
        generated_filename = self._safe_filename(f"{original_stem}-{operation_label}.csv")
        raw_path = final_dir / generated_filename
        raw_bytes = cleaned_df.to_csv(index=False).encode("utf-8")
        raw_path.write_bytes(raw_bytes)
        processed_path = self._write_processed_dataframe(cleaned_df, final_dir / "processed")

        mapping = ManualDatasetRoleMapping.model_validate(source_dataset.mapping_config or {})
        mapping = self._coerce_mapping_to_dataframe(mapping, cleaned_df)
        operations = [ManualDatasetOperation.model_validate(item) for item in source_dataset.operation_pipeline or []]
        operations.append(ManualDatasetOperation(type=action))

        derivative = ManualDataset(
            id=derivative_id,
            workspace_id=workspace.id,
            owner_user_id=user.id,
            name=cleaned_name,
            source_kind=source_dataset.source_kind,
            source_url=source_dataset.source_url,
            original_file_name=generated_filename,
            raw_file_path=str(raw_path.resolve()),
            processed_file_path=str(processed_path.resolve()),
            checksum_sha256=compute_sha256(raw_bytes),
            status="finalized_generic",
            storage_format=processed_path.suffix.lstrip(".") or "csv",
            dataset_kind="generic",
            created_for=source_dataset.created_for,
            source_metadata={
                **(source_dataset.source_metadata or {}),
                "derived_from_dataset_id": source_dataset.id,
                "derived_from_dataset_name": source_dataset.name,
                "missing_data_operation": operation_metadata,
            },
        )
        self._sync_dataset_state(derivative, cleaned_df, operations, mapping)
        self.db.add(derivative)
        self.db.commit()
        self.db.refresh(derivative)
        return self._to_response(derivative)

    def list_datasets(self, *, workspace_id: str, user: User) -> list[ManualDatasetResponse]:
        workspace = self._get_workspace(workspace_id=workspace_id, user=user)
        datasets = list(
            self.db.scalars(
                select(ManualDataset)
                .where(ManualDataset.workspace_id == workspace.id)
                # Sources created from within ML Experiments' own isolated REMMAQ
                # sync are excluded here so the two feature areas never share or
                # mix data sources (see create_ml_experiment_source_draft).
                .where(ManualDataset.created_for.is_(None))
                .order_by(ManualDataset.updated_at.desc())
            ).all()
        )
        stale_datasets = [
            dataset
            for dataset in datasets
            if dataset.status.startswith("finalized") and not self._dataset_query_file_exists(dataset)
        ]
        for dataset in stale_datasets:
            dataset.status = "missing_files"
            dataset.error_message = (
                "El archivo fisico del dataset ya no existe. "
                "Vuelve a cargar y finalizar la fuente para usarla en Analytics."
            )
            self.db.add(dataset)
        if stale_datasets:
            self.db.commit()
        return [self._to_response(dataset) for dataset in datasets]

    def get_eda_context(self, *, dataset_id: str, user: User) -> ManualDatasetEdaContext:
        dataset = self._get_dataset(dataset_id=dataset_id, user=user)
        dataframe = self._read_dataframe_for_query(dataset)
        return ManualDatasetEdaContext(
            dataset=dataset,
            dataframe=dataframe,
            mapping=ManualDatasetRoleMapping.model_validate(dataset.mapping_config or {}),
            summary=ManualDatasetSummary.model_validate(dataset.profile_summary or {}),
            columns=[ManualDatasetColumnProfile.model_validate(item) for item in dataset.column_schema or []],
        )

    def update_dataset(
        self,
        *,
        dataset_id: str,
        user: User,
        payload: ManualDatasetUpdateRequest,
    ) -> ManualDatasetResponse:
        dataset = self._get_dataset(dataset_id=dataset_id, user=user)
        dataframe = self._read_dataframe(Path(dataset.raw_file_path), dataset.original_file_name)
        transformed_df = self._apply_pipeline(dataframe.copy(), payload.operation_pipeline, payload.mapping)
        self._sync_dataset_state(dataset, transformed_df, payload.operation_pipeline, payload.mapping)
        dataset.status = "draft"
        dataset.error_message = None
        self.db.add(dataset)
        self.db.commit()
        self.db.refresh(dataset)
        return self._to_response(dataset)

    def finalize_dataset(
        self,
        *,
        dataset_id: str,
        user: User,
        payload: ManualDatasetFinalizeRequest,
    ) -> ManualDatasetResponse:
        dataset = self._get_dataset(dataset_id=dataset_id, user=user)
        workspace = self._get_workspace(workspace_id=dataset.workspace_id, user=user)
        dataframe = self._read_dataframe(Path(dataset.raw_file_path), dataset.original_file_name)
        transformed_df = self._apply_pipeline(dataframe.copy(), payload.operation_pipeline, payload.mapping)
        self._sync_dataset_state(dataset, transformed_df, payload.operation_pipeline, payload.mapping)
        if payload.dataset_name:
            cleaned_name = " ".join(payload.dataset_name.split())
            if cleaned_name:
                dataset.name = cleaned_name
        self._validate_dataset_name_uniqueness(
            workspace_id=dataset.workspace_id,
            dataset_name=dataset.name,
            exclude_dataset_id=dataset.id,
        )

        final_dir = self._build_dataset_dir(workspace, dataset.id)
        final_dir.mkdir(parents=True, exist_ok=True)
        previous_processed_path = dataset.processed_file_path
        processed_path = self._write_processed_dataframe(transformed_df, final_dir / "processed")
        dataset.processed_file_path = str(processed_path.resolve())
        dataset.storage_format = processed_path.suffix.lstrip(".") or dataset.storage_format
        if previous_processed_path and Path(previous_processed_path).resolve() != processed_path.resolve():
            self._remove_file_path(previous_processed_path)

        dataset.status = "finalized_generic"
        dataset.dataset_kind = "generic"
        dataset.etl_run_id = None
        dataset.source_file_id = None
        dataset.error_message = None
        self.db.add(dataset)
        self.db.commit()
        self.db.refresh(dataset)
        return self._to_response(dataset)

    def delete_dataset(self, *, dataset_id: str, user: User) -> None:
        dataset = self._get_dataset(dataset_id=dataset_id, user=user)
        source_file = self.db.get(SourceFile, dataset.source_file_id) if dataset.source_file_id else None
        etl_run = self.db.get(EtlRun, dataset.etl_run_id) if dataset.etl_run_id else None

        if source_file is not None:
            self.db.execute(
                delete(Measurement).where(
                    Measurement.source_file_id == source_file.id,
                    Measurement.data_origin == DATA_ORIGIN_USER,
                )
            )
            self.db.delete(source_file)

        self.db.delete(dataset)
        self.db.commit()

        self._remove_file_path(dataset.raw_file_path)
        self._remove_file_path(dataset.processed_file_path)
        if source_file is not None:
            self._remove_file_path(source_file.local_archive_path)
            self._remove_file_path(source_file.extracted_path)

        dataset_dir = Path(dataset.raw_file_path).parent if dataset.raw_file_path else None
        self._remove_dataset_dir(dataset_dir)

        if etl_run is not None:
            remaining_source_files = self.db.scalar(
                select(func.count(SourceFile.id)).where(SourceFile.etl_run_id == etl_run.id)
            )
            remaining_datasets = self.db.scalar(
                select(func.count(ManualDataset.id)).where(ManualDataset.etl_run_id == etl_run.id)
            )
            if (remaining_source_files or 0) == 0 and (remaining_datasets or 0) == 0:
                self.db.delete(etl_run)
                self.db.commit()

    def get_analytics_rows(
        self,
        *,
        dataset_id: str,
        user: User,
        limit: int | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        station_codes: list[str] | None = None,
        variable_codes: list[str] | None = None,
        view_from: datetime | None = None,
        view_to: datetime | None = None,
    ) -> AnalyticsQueryResponse:
        dataset = self._get_dataset(dataset_id=dataset_id, user=user)
        dataframe = self._read_dataframe_for_query(dataset)
        mapping = ManualDatasetRoleMapping.model_validate(dataset.mapping_config or {})

        observed_at = self._resolve_query_observed_at_series(dataframe, mapping)
        value_column = self._resolve_query_value_column(dataframe, mapping)
        station_column = self._resolve_query_station_column(dataframe, mapping)
        variable_column = self._resolve_query_variable_column(dataframe, mapping, value_column)
        unit_column = self._resolve_query_unit_column(dataframe, mapping)

        if observed_at is None or value_column is None:
            raise ManualDatasetError("Este dataset necesita al menos fecha y valor para usarse en Analytics.")

        working = dataframe.copy()
        working["_observed_at"] = pd.to_datetime(observed_at, utc=True, errors="coerce")
        working["_value"] = pd.to_numeric(working[value_column], errors="coerce")
        working["_station_code"] = (
            working[station_column].astype(str).map(normalize_station_code) if station_column else "DATASET"
        )
        working["_variable_code"] = (
            working[variable_column].astype(str).map(normalize_variable_code)
            if variable_column
            else normalize_variable_code(dataset.name)
        )
        working["_unit"] = working[unit_column].astype(str) if unit_column else None
        working = working.dropna(subset=["_observed_at", "_value"])

        if date_from is not None:
            working = working[working["_observed_at"] >= self._to_utc_timestamp(date_from)]
        if date_to is not None:
            working = working[working["_observed_at"] < self._to_utc_timestamp(date_to) + pd.Timedelta(days=1)]
        if view_from is not None:
            working = working[working["_observed_at"] >= self._to_utc_timestamp(view_from)]
        if view_to is not None:
            working = working[working["_observed_at"] <= self._to_utc_timestamp(view_to)]
        if station_codes:
            normalized_stations = {normalize_station_code(code) for code in station_codes}
            working = working[working["_station_code"].isin(normalized_stations)]
        if variable_codes:
            normalized_variables = {normalize_variable_code(code) for code in variable_codes}
            working = working[working["_variable_code"].isin(normalized_variables)]

        working = working.sort_values("_observed_at")
        truncated = limit is not None and len(working) > limit
        if truncated:
            working = working.head(limit)

        selected_columns = ["_observed_at", "_station_code", "_variable_code", "_value"]
        if unit_column is not None:
            selected_columns.append("_unit")
        projected = working.loc[:, selected_columns].copy()

        rows: list[AnalyticsDataRowResponse] = []
        source_file_id = int(dataset.source_file_id or 0)
        if unit_column is not None:
            projected["_unit"] = projected["_unit"].map(self._coerce_unit_value)
            for observed_at, station_code, variable_code, value, unit in projected.itertuples(index=False, name=None):
                rows.append(
                    AnalyticsDataRowResponse(
                        observed_at=self._to_python_datetime(observed_at),
                        station_code=str(station_code),
                        station_name=str(station_code),
                        variable_code=str(variable_code),
                        variable_name=str(variable_code),
                        value=float(value),
                        unit=unit,
                        source_file_id=source_file_id,
                        source_file_name=dataset.name,
                        source_type="manual_dataset",
                    )
                )
        else:
            for observed_at, station_code, variable_code, value in projected.itertuples(index=False, name=None):
                rows.append(
                    AnalyticsDataRowResponse(
                        observed_at=self._to_python_datetime(observed_at),
                        station_code=str(station_code),
                        station_name=str(station_code),
                        variable_code=str(variable_code),
                        variable_name=str(variable_code),
                        value=float(value),
                        unit=None,
                        source_file_id=source_file_id,
                        source_file_name=dataset.name,
                        source_type="manual_dataset",
                    )
                )
        return AnalyticsQueryResponse(rows=rows, row_count=len(rows), truncated=truncated)

    def _create_draft_dataset(
        self,
        *,
        workspace: Workspace,
        user: User,
        dataframe: pd.DataFrame,
        original_file_name: str,
        raw_bytes: bytes,
        source_kind: str,
        source_url: str | None,
        dataset_name: str,
    ) -> ManualDatasetResponse:
        mapping = self._suggest_mapping(dataframe)
        transformed_df = self._apply_pipeline(dataframe.copy(), [], mapping)
        dataset = ManualDataset(
            id=str(uuid.uuid4()),
            workspace_id=workspace.id,
            owner_user_id=user.id,
            name=dataset_name,
            source_kind=source_kind,
            source_url=source_url,
            original_file_name=original_file_name,
            raw_file_path="",
            checksum_sha256=compute_sha256(raw_bytes),
            status="draft",
            storage_format=(Path(original_file_name).suffix.lower().lstrip(".") or "csv"),
            dataset_kind=None,
        )
        final_dir = self._build_dataset_dir(workspace, dataset.id)
        final_dir.mkdir(parents=True, exist_ok=True)
        final_raw_path = final_dir / self._safe_filename(original_file_name)
        final_raw_path.write_bytes(raw_bytes)
        dataset.raw_file_path = str(final_raw_path.resolve())
        self._sync_dataset_state(dataset, transformed_df, [], mapping)
        self.db.add(dataset)
        self.db.commit()
        self.db.refresh(dataset)
        return self._to_response(dataset)

    def _get_workspace(self, *, workspace_id: str, user: User) -> Workspace:
        workspace = self.db.scalar(select(Workspace).where(Workspace.id == workspace_id, Workspace.is_active.is_(True)))
        if workspace is None:
            raise ManualDatasetError("Workspace no encontrado.")
        if user.role != UserRole.admin.value and workspace.owner_user_id != user.id:
            raise ManualDatasetError("No tienes acceso a este workspace.")
        return workspace

    def _get_dataset(self, *, dataset_id: str, user: User) -> ManualDataset:
        dataset = self.db.scalar(select(ManualDataset).where(ManualDataset.id == dataset_id))
        if dataset is None:
            raise ManualDatasetError("Dataset manual no encontrado.")
        if user.role != UserRole.admin.value and dataset.owner_user_id != user.id:
            raise ManualDatasetError("No tienes acceso a este dataset manual.")
        return dataset

    def _validate_dataset_name_uniqueness(
        self,
        *,
        workspace_id: str,
        dataset_name: str,
        exclude_dataset_id: str | None = None,
    ) -> None:
        cleaned_name = " ".join(dataset_name.split()).strip()
        if not cleaned_name:
            raise ManualDatasetError("El dataset necesita un nombre válido.")

        statement = select(ManualDataset).where(
            ManualDataset.workspace_id == workspace_id,
            func.lower(ManualDataset.name) == cleaned_name.lower(),
            ManualDataset.status.in_(["finalized_measurements", "finalized_generic"]),
        )
        if exclude_dataset_id:
            statement = statement.where(ManualDataset.id != exclude_dataset_id)
        existing = self.db.scalar(statement.limit(1))
        if existing is not None:
            raise ManualDatasetError("Ya existe un dataset guardado con este nombre.")

    def _to_response(self, dataset: ManualDataset) -> ManualDatasetResponse:
        summary = ManualDatasetSummary.model_validate(dataset.profile_summary or {})
        columns = [ManualDatasetColumnProfile.model_validate(item) for item in dataset.column_schema or []]
        pipeline = [ManualDatasetOperation.model_validate(item) for item in dataset.operation_pipeline or []]
        mapping = ManualDatasetRoleMapping.model_validate(dataset.mapping_config or {})
        return ManualDatasetResponse(
            id=dataset.id,
            workspace_id=dataset.workspace_id,
            owner_user_id=dataset.owner_user_id,
            name=dataset.name,
            source_kind=dataset.source_kind,
            source_url=dataset.source_url,
            original_file_name=dataset.original_file_name,
            status=dataset.status,
            dataset_kind=dataset.dataset_kind,
            storage_format=dataset.storage_format,
            row_count=dataset.row_count,
            column_count=dataset.column_count,
            operation_pipeline=pipeline,
            mapping=mapping,
            summary=summary,
            columns=columns,
            preview_rows=list(dataset.preview_rows or []),
            etl_run_id=dataset.etl_run_id,
            source_file_id=dataset.source_file_id,
            created_at=dataset.created_at,
            updated_at=dataset.updated_at,
            error_message=dataset.error_message,
            created_for=dataset.created_for,
            source_metadata=dataset.source_metadata,
        )

    def _build_missing_data_overview(
        self,
        *,
        dataset: ManualDataset,
        dataframe: pd.DataFrame,
    ) -> ManualDatasetMissingDataOverviewResponse:
        missing_data = dataframe.isna().sum()
        denominator = max(1, len(dataframe))
        columns = [
            ManualDatasetMissingDataColumn(
                column=str(column),
                missing_values=int(missing_data[column]),
                percentage_missing=round(float(missing_data[column]) / denominator * 100, 2),
            )
            for column in dataframe.columns
        ]
        return ManualDatasetMissingDataOverviewResponse(
            dataset_id=dataset.id,
            dataset_name=dataset.name,
            row_count=int(len(dataframe)),
            column_count=int(len(dataframe.columns)),
            total_missing_values=int(missing_data.sum()),
            columns=columns,
        )

    def _impute_missing_values_knn_mode(self, dataframe: pd.DataFrame) -> pd.DataFrame:
        working = dataframe.copy()
        numeric_columns = list(working.select_dtypes(include="number").columns)
        categorical_columns = [
            column
            for column in working.columns
            if column not in numeric_columns and not pd.api.types.is_datetime64_any_dtype(working[column])
        ]

        if numeric_columns:
            imputed_numeric = self._knn_impute_numeric(working[numeric_columns])
        else:
            imputed_numeric = pd.DataFrame(index=working.index)

        for column in categorical_columns:
            mode = working[column].mode(dropna=True)
            if not mode.empty:
                working[column] = working[column].fillna(mode.iloc[0])

        return pd.concat([imputed_numeric, working[categorical_columns]], axis=1)

    def _knn_impute_numeric(self, numeric_df: pd.DataFrame, *, n_neighbors: int = 5) -> pd.DataFrame:
        if numeric_df.empty:
            return numeric_df.copy()

        from sklearn.impute import KNNImputer

        result = numeric_df.astype("float64").copy()
        imputer = KNNImputer(n_neighbors=n_neighbors, weights="uniform", metric="nan_euclidean")
        imputed_values = imputer.fit_transform(result)
        return pd.DataFrame(imputed_values, columns=list(result.columns), index=result.index)

    def _coerce_mapping_to_dataframe(
        self,
        mapping: ManualDatasetRoleMapping,
        dataframe: pd.DataFrame,
    ) -> ManualDatasetRoleMapping:
        columns = set(str(column) for column in dataframe.columns)

        def _column(value: str | None) -> str | None:
            return value if value in columns else None

        return ManualDatasetRoleMapping(
            numeric_columns=[column for column in mapping.numeric_columns if column in columns],
            categorical_columns=[column for column in mapping.categorical_columns if column in columns],
            datetime_column=_column(mapping.datetime_column),
            date_column=_column(mapping.date_column),
            time_column=_column(mapping.time_column),
            station_code_column=_column(mapping.station_code_column),
            variable_code_column=_column(mapping.variable_code_column),
            value_column=_column(mapping.value_column),
            unit_column=_column(mapping.unit_column),
            normalized_datetime_column_name=mapping.normalized_datetime_column_name,
        )
