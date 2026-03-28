from __future__ import annotations

import json
import shutil
from collections.abc import Iterable
from datetime import date
from pathlib import Path
from typing import Any

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
from app.services.etl.contracts import NormalizedMeasurementRow
from app.services.etl.helpers import compute_sha256, normalize_station_code, normalize_text, normalize_variable_code

NA_VALUES = ['', 'NA', 'N/A', 'na', 'n/a', 'NaN', 'nan', 'NULL', 'null', 'missing', '-', '--']
PREVIEW_LIMIT = 25
SAMPLE_VALUE_LIMIT = 5
MANUAL_ALLOWED_SUFFIXES = {'.csv', '.xlsx', '.xls', '.txt'}

NUMERIC_ROLE_HINTS = {'value', 'measurement', 'medicion', 'valor', 'concentracion'}
DATETIME_ROLE_HINTS = {'observed_at', 'timestamp', 'datetime', 'date_time', 'fecha_hora', 'fechahora'}
DATE_ROLE_HINTS = {'date', 'fecha'}
TIME_ROLE_HINTS = {'time', 'hora'}
STATION_ROLE_HINTS = {'station', 'station_code', 'station_id', 'estacion', 'codigo_estacion', 'cod_estacion'}
VARIABLE_ROLE_HINTS = {'variable', 'variable_code', 'pollutant', 'contaminante', 'parametro', 'parameter'}


class ManualDatasetError(Exception):
    pass


class ManualDatasetService:
    def __init__(self, db: Session):
        self.db = db

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
            raise ManualDatasetError('Carga manual solo soporta archivos CSV, XLSX, XLS o TXT.')

        workspace = self._get_workspace(workspace_id=workspace_id, user=user)
        dataset_dir = self._build_dataset_dir(workspace, None)
        dataset_dir.mkdir(parents=True, exist_ok=True)
        raw_file_path = dataset_dir / self._safe_filename(filename)
        raw_file_path.write_bytes(content)
        dataframe = self._read_dataframe(raw_file_path, filename)
        return self._create_draft_dataset(
            workspace=workspace,
            user=user,
            dataframe=dataframe,
            original_file_name=filename,
            raw_bytes=content,
            source_kind='upload',
            source_url=None,
            dataset_name=Path(filename).stem.strip() or 'manual-dataset',
        )

    def create_from_url(
        self,
        *,
        workspace_id: str,
        user: User,
        source_url: str,
    ) -> ManualDatasetResponse:
        normalized_url = self._normalize_raw_csv_url(source_url)
        if not normalized_url.lower().split('?')[0].endswith('.csv'):
            raise ManualDatasetError('El link debe apuntar a un CSV raw y terminar en .csv.')

        try:
            response = httpx.get(normalized_url, timeout=30.0, follow_redirects=True)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ManualDatasetError(f'No se pudo descargar el CSV: {exc}') from exc

        filename = Path(normalized_url.split('?')[0]).name or 'manual-dataset.csv'
        dataset = self.create_from_upload(
            workspace_id=workspace_id,
            user=user,
            filename=filename,
            content=response.content,
        )
        entity = self.db.get(ManualDataset, dataset.id)
        if entity is None:
            raise ManualDatasetError('No se pudo registrar el dataset descargado.')
        entity.source_kind = 'github_raw'
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
            raise ManualDatasetError(f'No se pudo preparar REMMAQ: {exc}') from exc

        selected_codes = sorted({str(row.get("variable_code", "")).strip() for row in archives})
        dataset_name = f"remmaq-{'-'.join(selected_codes).lower()}" if selected_codes else 'remmaq-dataset'
        generated_filename = f'{dataset_name}.csv'
        raw_bytes = dataframe.to_csv(index=False).encode('utf-8')
        response = self._create_draft_dataset(
            workspace=workspace,
            user=user,
            dataframe=dataframe,
            original_file_name=generated_filename,
            raw_bytes=raw_bytes,
            source_kind='remmaq',
            source_url='https://datosambiente.quito.gob.ec/',
            dataset_name=dataset_name,
        )
        entity = self.db.get(ManualDataset, response.id)
        if entity is None:
            raise ManualDatasetError('No se pudo registrar el dataset REMMAQ.')
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
        return [self._to_response(dataset) for dataset in datasets]

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
        dataset.status = 'draft'
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
            cleaned_name = ' '.join(payload.dataset_name.split())
            if cleaned_name:
                dataset.name = cleaned_name
        self._validate_dataset_name_uniqueness(
            workspace_id=dataset.workspace_id,
            dataset_name=dataset.name,
            exclude_dataset_id=dataset.id,
        )

        final_dir = self._build_dataset_dir(workspace, dataset.id)
        final_dir.mkdir(parents=True, exist_ok=True)
        processed_path = final_dir / 'processed.csv'
        transformed_df.to_csv(processed_path, index=False)
        dataset.processed_file_path = str(processed_path.resolve())

        if self._can_normalize_to_measurements(transformed_df, payload.mapping):
            run, source_file_id = self._persist_measurements(
                dataset=dataset,
                transformed_df=transformed_df,
                mapping=payload.mapping,
                processed_path=processed_path,
            )
            dataset.status = 'finalized_measurements'
            dataset.dataset_kind = 'measurements'
            dataset.etl_run_id = run.id
            dataset.source_file_id = source_file_id
        else:
            dataset.status = 'finalized_generic'
            dataset.dataset_kind = 'generic'
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

    def _persist_measurements(
        self,
        *,
        dataset: ManualDataset,
        transformed_df: pd.DataFrame,
        mapping: ManualDatasetRoleMapping,
        processed_path: Path,
    ):
        etl_service = EtlService(self.db)
        rows = list(self._build_normalized_rows(transformed_df, mapping, dataset.original_file_name))
        if not rows:
            raise ManualDatasetError('No se pudieron construir mediciones válidas con el mapeo seleccionado.')
        source_type = 'automatic' if dataset.source_kind == 'remmaq' else 'manual'
        run = etl_service.ingest_normalized_rows(
            filename=processed_path.name,
            content=processed_path.read_bytes(),
            rows=rows,
            source_type=source_type,
            source_url=dataset.source_url,
        )
        source_file_id = self.db.scalar(
            select(SourceFile.id).where(SourceFile.etl_run_id == run.id).order_by(SourceFile.id.desc()).limit(1)
        )
        return run, source_file_id

    def get_analytics_rows(
        self,
        *,
        dataset_id: str,
        user: User,
        limit: int = 5000,
        date_from: date | None = None,
        date_to: date | None = None,
        station_codes: list[str] | None = None,
        variable_codes: list[str] | None = None,
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
            raise ManualDatasetError('Este dataset necesita al menos fecha y valor para usarse en Analytics.')

        working = dataframe.copy()
        working['_observed_at'] = observed_at
        working['_value'] = pd.to_numeric(working[value_column], errors='coerce')
        working['_station_code'] = (
            working[station_column].astype(str).map(normalize_station_code)
            if station_column
            else 'DATASET'
        )
        working['_variable_code'] = (
            working[variable_column].astype(str).map(normalize_variable_code)
            if variable_column
            else normalize_variable_code(dataset.name)
        )
        working['_unit'] = working[unit_column].astype(str) if unit_column else None
        working = working.dropna(subset=['_observed_at', '_value'])

        if date_from is not None:
            working = working[working['_observed_at'] >= pd.Timestamp(date_from)]
        if date_to is not None:
            working = working[working['_observed_at'] < pd.Timestamp(date_to) + pd.Timedelta(days=1)]
        if station_codes:
            normalized_stations = {normalize_station_code(code) for code in station_codes}
            working = working[working['_station_code'].isin(normalized_stations)]
        if variable_codes:
            normalized_variables = {normalize_variable_code(code) for code in variable_codes}
            working = working[working['_variable_code'].isin(normalized_variables)]

        working = working.sort_values('_observed_at').head(max(100, min(limit, 5000)))
        rows = [
            AnalyticsDataRowResponse(
                observed_at=row['_observed_at'].to_pydatetime(),
                station_code=str(row['_station_code']),
                station_name=str(row['_station_code']),
                variable_code=str(row['_variable_code']),
                variable_name=str(row['_variable_code']),
                value=float(row['_value']),
                unit=None if unit_column is None else self._coerce_unit_value(row['_unit']),
                source_file_id=int(dataset.source_file_id or 0),
                source_file_name=dataset.name,
                source_type='manual_dataset',
            )
            for _, row in working.iterrows()
        ]
        return AnalyticsQueryResponse(rows=rows, row_count=len(rows), truncated=False)

    def _build_normalized_rows(
        self,
        dataframe: pd.DataFrame,
        mapping: ManualDatasetRoleMapping,
        source_workbook: str,
    ) -> Iterable[NormalizedMeasurementRow]:
        station_column = mapping.station_code_column
        variable_column = mapping.variable_code_column
        value_column = mapping.value_column
        unit_column = mapping.unit_column

        if not station_column or not variable_column or not value_column:
            return []

        observed_at_series = self._resolve_observed_at_series(dataframe, mapping)
        if observed_at_series is None:
            return []

        prepared = dataframe.copy()
        prepared['_observed_at'] = observed_at_series
        prepared[value_column] = pd.to_numeric(prepared[value_column], errors='coerce')
        prepared = prepared.dropna(subset=['_observed_at', value_column])
        if prepared.empty:
            return []

        rows: list[NormalizedMeasurementRow] = []
        for index, row in prepared.iterrows():
            station_value = row.get(station_column)
            variable_value = row.get(variable_column)
            if station_value is None or variable_value is None:
                continue
            station_code = normalize_station_code(str(station_value))
            variable_code = normalize_variable_code(str(variable_value))
            if not station_code or not variable_code:
                continue
            unit = None
            if unit_column and unit_column in prepared.columns:
                raw_unit = row.get(unit_column)
                if raw_unit is not None and str(raw_unit).strip() and str(raw_unit).lower() != 'nan':
                    unit = str(raw_unit).strip()
            rows.append(
                NormalizedMeasurementRow(
                    station_code=station_code,
                    observed_at=row['_observed_at'],
                    variable_code=variable_code,
                    value=float(row[value_column]),
                    unit=unit,
                    source_sheet='manual_dataset',
                    source_row_number=int(index) + 2,
                    source_workbook=source_workbook,
                )
            )
        return rows

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
        dataset_dir = self._build_dataset_dir(workspace, None)
        dataset_dir.mkdir(parents=True, exist_ok=True)
        raw_file_path = dataset_dir / self._safe_filename(original_file_name)
        raw_file_path.write_bytes(raw_bytes)

        mapping = self._suggest_mapping(dataframe)
        transformed_df = self._apply_pipeline(dataframe.copy(), [], mapping)
        dataset = ManualDataset(
            workspace_id=workspace.id,
            owner_user_id=user.id,
            name=dataset_name,
            source_kind=source_kind,
            source_url=source_url,
            original_file_name=original_file_name,
            raw_file_path=str(raw_file_path.resolve()),
            checksum_sha256=compute_sha256(raw_bytes),
            status='draft',
            dataset_kind=None,
        )
        self._sync_dataset_state(dataset, transformed_df, [], mapping)
        self.db.add(dataset)
        self.db.commit()
        self.db.refresh(dataset)

        final_dir = self._build_dataset_dir(workspace, dataset.id)
        final_dir.mkdir(parents=True, exist_ok=True)
        final_raw_path = final_dir / self._safe_filename(original_file_name)
        final_raw_path.write_bytes(raw_bytes)
        dataset.raw_file_path = str(final_raw_path.resolve())
        self.db.add(dataset)
        self.db.commit()
        self.db.refresh(dataset)
        return self._to_response(dataset)

    def _can_normalize_to_measurements(self, dataframe: pd.DataFrame, mapping: ManualDatasetRoleMapping) -> bool:
        required = [mapping.station_code_column, mapping.variable_code_column, mapping.value_column]
        if any(not value for value in required):
            return False
        observed_at_series = self._resolve_observed_at_series(dataframe, mapping)
        return observed_at_series is not None and int(observed_at_series.notna().sum()) > 0

    def _resolve_observed_at_series(
        self,
        dataframe: pd.DataFrame,
        mapping: ManualDatasetRoleMapping,
    ) -> pd.Series | None:
        if mapping.datetime_column and mapping.datetime_column in dataframe.columns:
            parsed = pd.to_datetime(dataframe[mapping.datetime_column], errors='coerce')
            return parsed
        if mapping.date_column and mapping.date_column in dataframe.columns:
            if mapping.time_column and mapping.time_column in dataframe.columns:
                combined = dataframe[mapping.date_column].astype(str) + ' ' + dataframe[mapping.time_column].astype(str)
                return pd.to_datetime(combined, errors='coerce')
            return pd.to_datetime(dataframe[mapping.date_column], errors='coerce')
        return None

    def _sync_dataset_state(
        self,
        dataset: ManualDataset,
        dataframe: pd.DataFrame,
        operation_pipeline: list[ManualDatasetOperation],
        mapping: ManualDatasetRoleMapping,
    ) -> None:
        summary = self._build_summary(dataframe)
        columns = self._profile_dataframe(dataframe)
        preview = self._preview_rows(dataframe)
        dataset.row_count = int(summary.row_count)
        dataset.column_count = int(summary.column_count)
        dataset.operation_pipeline = [operation.model_dump() for operation in operation_pipeline]
        dataset.mapping_config = mapping.model_dump()
        dataset.profile_summary = summary.model_dump()
        dataset.column_schema = [column.model_dump() for column in columns]
        dataset.preview_rows = preview

    def _apply_pipeline(
        self,
        dataframe: pd.DataFrame,
        operation_pipeline: list[ManualDatasetOperation],
        mapping: ManualDatasetRoleMapping,
    ) -> pd.DataFrame:
        working = dataframe.copy()
        for operation in operation_pipeline:
            if operation.type == 'select_columns':
                columns = [column for column in operation.columns or [] if column in working.columns]
                if columns:
                    working = working[columns].copy()
            elif operation.type == 'cast_types':
                numeric_columns = [column for column in operation.numeric_columns or [] if column in working.columns]
                categorical_columns = [
                    column for column in operation.categorical_columns or [] if column in working.columns
                ]
                for column in numeric_columns:
                    working[column] = pd.to_numeric(working[column], errors='coerce')
                for column in categorical_columns:
                    working[column] = working[column].astype('string')
                    working[column] = working[column].replace({'nan': pd.NA})
            elif operation.type == 'subsample':
                if operation.sample_pct is not None:
                    sample_pct = max(1, min(100, int(operation.sample_pct)))
                    if sample_pct < 100 and not working.empty:
                        working = working.sample(frac=sample_pct / 100, random_state=42)
            elif operation.type == 'melt':
                id_vars = [column for column in operation.id_vars or [] if column in working.columns]
                if id_vars:
                    value_vars = [column for column in working.columns if column not in id_vars]
                    working = pd.melt(
                        working,
                        id_vars=id_vars,
                        value_vars=value_vars,
                        var_name=operation.var_name or 'variable',
                        value_name=operation.value_name or 'value',
                    )
            elif operation.type == 'date_features':
                date_column = operation.date_column
                if date_column and date_column in working.columns:
                    parsed = pd.to_datetime(working[date_column], errors='coerce', dayfirst=bool(operation.dayfirst))
                    prefix = normalize_text(date_column) or 'date'
                    title_prefix = ''.join(token.capitalize() for token in prefix.split('_')) or 'Date'
                    working[f'{title_prefix}Year'] = parsed.dt.year
                    working[f'{title_prefix}Month'] = parsed.dt.month
                    working[f'{title_prefix}Day'] = parsed.dt.day
                    working[f'{title_prefix}DayOfWeek'] = parsed.dt.dayofweek
                    working[f'{title_prefix}Hour'] = parsed.dt.hour

        casted_numeric = [column for column in mapping.numeric_columns if column in working.columns]
        casted_categorical = [column for column in mapping.categorical_columns if column in working.columns]
        for column in casted_numeric:
            working[column] = pd.to_numeric(working[column], errors='coerce')
        for column in casted_categorical:
            working[column] = working[column].astype('string')
            working[column] = working[column].replace({'nan': pd.NA})

        return working.reset_index(drop=True)

    def _build_summary(self, dataframe: pd.DataFrame) -> ManualDatasetSummary:
        numeric_columns = list(dataframe.select_dtypes(include='number').columns)
        datetime_columns = list(dataframe.select_dtypes(include=['datetime', 'datetimetz']).columns)
        categorical_columns = [
            column
            for column in dataframe.columns
            if column not in numeric_columns and column not in datetime_columns
        ]
        return ManualDatasetSummary(
            row_count=int(len(dataframe)),
            column_count=int(len(dataframe.columns)),
            numeric_columns=numeric_columns,
            categorical_columns=categorical_columns,
            datetime_columns=datetime_columns,
        )

    def _profile_dataframe(self, dataframe: pd.DataFrame) -> list[ManualDatasetColumnProfile]:
        profiles: list[ManualDatasetColumnProfile] = []
        total_rows = len(dataframe)
        for column in dataframe.columns:
            series = dataframe[column]
            sample_values = [
                self._stringify_sample(value) for value in series.dropna().head(SAMPLE_VALUE_LIMIT).tolist()
            ]
            profiles.append(
                ManualDatasetColumnProfile(
                    name=str(column),
                    pandas_dtype=str(series.dtype),
                    inferred_kind=self._infer_column_kind(series),
                    null_count=int(series.isna().sum()),
                    non_null_count=int(total_rows - int(series.isna().sum())),
                    unique_count=int(series.nunique(dropna=True)),
                    sample_values=sample_values,
                )
            )
        return profiles

    def _preview_rows(self, dataframe: pd.DataFrame) -> list[dict[str, Any]]:
        preview = dataframe.head(PREVIEW_LIMIT).copy()
        preview = preview.where(pd.notna(preview), None)
        return json.loads(preview.to_json(orient='records', date_format='iso'))

    def _suggest_mapping(self, dataframe: pd.DataFrame) -> ManualDatasetRoleMapping:
        numeric_columns = list(dataframe.select_dtypes(include='number').columns)
        categorical_columns = [column for column in dataframe.columns if column not in numeric_columns]
        normalized_columns = {normalize_text(str(column)): str(column) for column in dataframe.columns}

        datetime_column = self._match_first(normalized_columns, DATETIME_ROLE_HINTS)
        if datetime_column is None:
            datetime_column = self._guess_datetime_column(dataframe)

        date_column = self._match_first(normalized_columns, DATE_ROLE_HINTS)
        time_column = self._match_first(normalized_columns, TIME_ROLE_HINTS)
        station_code_column = self._match_first(normalized_columns, STATION_ROLE_HINTS)
        variable_code_column = self._match_first(normalized_columns, VARIABLE_ROLE_HINTS)
        value_column = self._match_first(normalized_columns, NUMERIC_ROLE_HINTS)
        if value_column is None and numeric_columns:
            value_column = numeric_columns[0]

        return ManualDatasetRoleMapping(
            numeric_columns=numeric_columns,
            categorical_columns=[column for column in categorical_columns if column != datetime_column],
            datetime_column=datetime_column,
            date_column=date_column,
            time_column=time_column,
            station_code_column=station_code_column,
            variable_code_column=variable_code_column,
            value_column=value_column,
            unit_column=self._match_first(normalized_columns, {'unit', 'unidad', 'units'}),
        )

    def _guess_datetime_column(self, dataframe: pd.DataFrame) -> str | None:
        best_column: str | None = None
        best_score = 0.0
        for column in dataframe.columns:
            sample = dataframe[column].dropna().head(25)
            if sample.empty:
                continue
            parsed = pd.to_datetime(sample, errors='coerce')
            score = float(parsed.notna().mean())
            if score > best_score:
                best_score = score
                best_column = str(column)
        if best_score >= 0.5:
            return best_column
        return None

    def _match_first(self, normalized_columns: dict[str, str], candidates: set[str]) -> str | None:
        for candidate in candidates:
            match = normalized_columns.get(candidate)
            if match is not None:
                return match
        return None

    def _infer_column_kind(self, series: pd.Series) -> str:
        if pd.api.types.is_numeric_dtype(series):
            return 'numeric'
        if pd.api.types.is_datetime64_any_dtype(series):
            return 'datetime'
        sample = series.dropna().head(25)
        if not sample.empty:
            parsed = pd.to_datetime(sample, errors='coerce')
            if float(parsed.notna().mean()) >= 0.7:
                return 'datetime'
        return 'categorical'

    def _read_dataframe(self, file_path: Path, original_name: str) -> pd.DataFrame:
        suffix = file_path.suffix.lower() or Path(original_name).suffix.lower()
        if suffix == '.csv':
            return pd.read_csv(file_path, na_values=NA_VALUES, keep_default_na=True)
        if suffix == '.txt':
            return pd.read_csv(file_path, sep=None, engine='python', na_values=NA_VALUES, keep_default_na=True)
        if suffix in {'.xlsx', '.xls'}:
            return pd.read_excel(file_path, na_values=NA_VALUES, keep_default_na=True)
        raise ManualDatasetError(f'Formato no soportado para inspección manual: {suffix or original_name}')

    def _read_dataframe_for_query(self, dataset: ManualDataset) -> pd.DataFrame:
        if dataset.processed_file_path:
            return self._read_dataframe(Path(dataset.processed_file_path), dataset.original_file_name)
        return self._read_dataframe(Path(dataset.raw_file_path), dataset.original_file_name)

    def _resolve_query_observed_at_series(
        self,
        dataframe: pd.DataFrame,
        mapping: ManualDatasetRoleMapping,
    ) -> pd.Series | None:
        resolved = self._resolve_observed_at_series(dataframe, mapping)
        if resolved is not None and int(resolved.notna().sum()) > 0:
            return resolved
        guessed = self._guess_datetime_column(dataframe)
        if guessed and guessed in dataframe.columns:
            parsed = pd.to_datetime(dataframe[guessed], errors='coerce')
            if int(parsed.notna().sum()) > 0:
                return parsed
        return None

    def _resolve_query_value_column(self, dataframe: pd.DataFrame, mapping: ManualDatasetRoleMapping) -> str | None:
        if mapping.value_column and mapping.value_column in dataframe.columns:
            return mapping.value_column
        numeric_columns = [column for column in dataframe.columns if pd.api.types.is_numeric_dtype(dataframe[column])]
        return str(numeric_columns[0]) if numeric_columns else None

    def _resolve_query_station_column(self, dataframe: pd.DataFrame, mapping: ManualDatasetRoleMapping) -> str | None:
        if mapping.station_code_column and mapping.station_code_column in dataframe.columns:
            return mapping.station_code_column
        return None

    def _resolve_query_variable_column(
        self,
        dataframe: pd.DataFrame,
        mapping: ManualDatasetRoleMapping,
        value_column: str | None,
    ) -> str | None:
        if mapping.variable_code_column and mapping.variable_code_column in dataframe.columns:
            return mapping.variable_code_column
        for candidate in ('variable', 'Variable', 'metric', 'Metric'):
            if candidate in dataframe.columns and candidate != value_column:
                return candidate
        return None

    def _resolve_query_unit_column(self, dataframe: pd.DataFrame, mapping: ManualDatasetRoleMapping) -> str | None:
        if mapping.unit_column and mapping.unit_column in dataframe.columns:
            return mapping.unit_column
        for candidate in ('unit', 'Unit', 'units', 'Units'):
            if candidate in dataframe.columns:
                return candidate
        return None

    def _coerce_unit_value(self, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        if not text or text.lower() == 'nan':
            return None
        return text

    def _get_workspace(self, *, workspace_id: str, user: User) -> Workspace:
        workspace = self.db.scalar(select(Workspace).where(Workspace.id == workspace_id, Workspace.is_active.is_(True)))
        if workspace is None:
            raise ManualDatasetError('Workspace no encontrado.')
        if user.role != UserRole.admin.value and workspace.owner_user_id != user.id:
            raise ManualDatasetError('No tienes acceso a este workspace.')
        return workspace

    def _get_dataset(self, *, dataset_id: str, user: User) -> ManualDataset:
        dataset = self.db.scalar(select(ManualDataset).where(ManualDataset.id == dataset_id))
        if dataset is None:
            raise ManualDatasetError('Dataset manual no encontrado.')
        if user.role != UserRole.admin.value and dataset.owner_user_id != user.id:
            raise ManualDatasetError('No tienes acceso a este dataset manual.')
        return dataset

    def _validate_dataset_name_uniqueness(
        self,
        *,
        workspace_id: str,
        dataset_name: str,
        exclude_dataset_id: str | None = None,
    ) -> None:
        cleaned_name = ' '.join(dataset_name.split()).strip()
        if not cleaned_name:
            raise ManualDatasetError('El dataset necesita un nombre válido.')

        statement = select(ManualDataset).where(
            ManualDataset.workspace_id == workspace_id,
            func.lower(ManualDataset.name) == cleaned_name.lower(),
            ManualDataset.status.in_(['finalized_measurements', 'finalized_generic']),
        )
        if exclude_dataset_id:
            statement = statement.where(ManualDataset.id != exclude_dataset_id)
        existing = self.db.scalar(statement.limit(1))
        if existing is not None:
            raise ManualDatasetError('Ya existe un dataset guardado con este nombre.')

    def _build_dataset_dir(self, workspace: Workspace, dataset_id: str | None) -> Path:
        workspace_root = Path(workspace.storage_path)
        base_dir = workspace_root / 'datasets' / 'manual'
        if dataset_id:
            return base_dir / dataset_id
        return base_dir / '_staging'

    def _normalize_raw_csv_url(self, value: str) -> str:
        cleaned = value.strip()
        if 'github.com' in cleaned and 'raw.githubusercontent.com' not in cleaned:
            cleaned = cleaned.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')
        return cleaned

    def _safe_filename(self, filename: str) -> str:
        safe = Path(filename).name.replace('/', '_').replace('\\', '_')
        return safe or 'manual-dataset.csv'

    def _remove_dataset_dir(self, directory: Path | None) -> None:
        if directory is None:
            return
        if not directory.exists():
            return
        if directory.name == '_staging':
            return
        shutil.rmtree(directory, ignore_errors=True)

    def _remove_file_path(self, file_path: str | None) -> None:
        if not file_path:
            return
        path = Path(file_path)
        if path.exists() and path.is_file():
            path.unlink(missing_ok=True)

    def _stringify_sample(self, value: Any) -> str:
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        return str(value)

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
