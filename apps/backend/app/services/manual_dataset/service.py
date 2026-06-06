from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

import httpx
import pandas as pd
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models.etl_run import EtlRun
from app.models.manual_dataset import ManualDataset
from app.models.measurement import Measurement
from app.models.source_file import SourceFile
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.analytics import AnalyticsDataRowResponse, AnalyticsQueryResponse
from app.schemas.auth import UserRole
from app.schemas.etl import (
    ManualDatasetColumnProfile,
    ManualDatasetFinalizeRequest,
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

    def get_dataset(self, *, dataset_id: str, user: User) -> ManualDatasetResponse:
        dataset = self._get_dataset(dataset_id=dataset_id, user=user)
        return self._to_response(dataset)

    def list_datasets(self, *, workspace_id: str, user: User) -> list[ManualDatasetResponse]:
        workspace = self._get_workspace(workspace_id=workspace_id, user=user)
        datasets = list(
            self.db.scalars(
                select(ManualDataset)
                .where(ManualDataset.workspace_id == workspace.id)
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
            self.db.execute(delete(Measurement).where(Measurement.source_file_id == source_file.id))
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
        )
