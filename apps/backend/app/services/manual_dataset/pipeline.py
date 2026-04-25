from __future__ import annotations

import json
from typing import Any

import pandas as pd

from app.schemas.etl import (
    ManualDatasetColumnProfile,
    ManualDatasetOperation,
    ManualDatasetRoleMapping,
    ManualDatasetSummary,
)
from app.services.etl.helpers import normalize_text

PREVIEW_LIMIT = 25
SAMPLE_VALUE_LIMIT = 5
NUMERIC_ROLE_HINTS = {"value", "measurement", "medicion", "valor", "concentracion"}
DATETIME_ROLE_HINTS = {"observed_at", "timestamp", "datetime", "date_time", "fecha_hora", "fechahora"}
DATE_ROLE_HINTS = {"date", "fecha"}
TIME_ROLE_HINTS = {"time", "hora"}
STATION_ROLE_HINTS = {"station", "station_code", "station_id", "estacion", "codigo_estacion", "cod_estacion"}
VARIABLE_ROLE_HINTS = {"variable", "variable_code", "pollutant", "contaminante", "parametro", "parameter"}


class ManualDatasetPipelineMixin:
    _DATE_FORMAT_PATTERNS = [
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%m-%d-%Y",
        "%m/%d/%Y",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d-%m-%Y %H:%M",
        "%b-%d",
        "%b %d",
        "%d-%b",
        "%d %b",
        "%b-%d-%Y",
        "%b %d %Y",
        "%d-%b-%Y",
        "%B %d %Y",
        "%d %B %Y",
        "%B-%d-%Y",
        "Q%q-%Y",
        "%Y-Q%q",
        "%b-%Y",
        "%b %Y",
        "%B %Y",
        "%Y-%m",
        "%m-%Y",
    ]

    def _resolve_observed_at_series(
        self,
        dataframe: pd.DataFrame,
        mapping: ManualDatasetRoleMapping,
    ) -> pd.Series | None:
        if mapping.datetime_column and mapping.datetime_column in dataframe.columns:
            return self._robust_parse_datetime(
                dataframe[mapping.datetime_column],
                dayfirst=True,
                fuzzy=True,
            )
        if mapping.date_column and mapping.date_column in dataframe.columns:
            if mapping.time_column and mapping.time_column in dataframe.columns:
                combined = dataframe[mapping.date_column].astype(str) + " " + dataframe[mapping.time_column].astype(str)
                return self._robust_parse_datetime(combined, dayfirst=True, fuzzy=True)
            return self._robust_parse_datetime(dataframe[mapping.date_column], dayfirst=True, fuzzy=True)
        return None

    def _robust_parse_datetime(
        self,
        series: pd.Series,
        *,
        dayfirst: bool = True,
        date_format: str | None = None,
        year_default: int | None = None,
        fuzzy: bool = True,
    ) -> pd.Series:
        from dateutil import parser as dateutil_parser

        if date_format:
            return pd.to_datetime(series, format=date_format, errors="coerce")

        result = pd.to_datetime(series, dayfirst=dayfirst, errors="coerce")
        if result.notna().mean() >= 0.7:
            return result

        for fmt in self._DATE_FORMAT_PATTERNS:
            try:
                candidate = pd.to_datetime(series, format=fmt, errors="coerce")
                if candidate.notna().mean() >= 0.6:
                    if year_default and "%Y" not in fmt and "%y" not in fmt:
                        candidate = candidate.apply(lambda ts: ts.replace(year=year_default) if pd.notna(ts) else ts)
                    return candidate
            except (ValueError, TypeError):
                continue

        if fuzzy:
            default_dt = pd.Timestamp(f"{year_default or pd.Timestamp.now().year}-01-01")

            def _parse_one(value: Any) -> pd.Timestamp | None:
                if pd.isna(value):
                    return None
                try:
                    return pd.Timestamp(
                        dateutil_parser.parse(
                            str(value),
                            dayfirst=dayfirst,
                            fuzzy=True,
                            default=default_dt.to_pydatetime(),
                        )
                    )
                except (ValueError, OverflowError):
                    return None

            return series.apply(_parse_one)

        return result

    def _sync_dataset_state(
        self,
        dataset,
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
            if operation.type == "select_columns":
                columns = [column for column in operation.columns or [] if column in working.columns]
                if columns:
                    working = working[columns].copy()
            elif operation.type == "cast_types":
                numeric_columns = [column for column in operation.numeric_columns or [] if column in working.columns]
                categorical_columns = [
                    column for column in operation.categorical_columns or [] if column in working.columns
                ]
                for column in numeric_columns:
                    working[column] = pd.to_numeric(working[column], errors="coerce")
                for column in categorical_columns:
                    working[column] = working[column].astype("string")
                    working[column] = working[column].replace({"nan": pd.NA})
            elif operation.type == "subsample":
                if operation.sample_pct is not None:
                    sample_pct = max(1, min(100, int(operation.sample_pct)))
                    if sample_pct < 100 and not working.empty:
                        working = working.sample(frac=sample_pct / 100, random_state=42)
            elif operation.type == "melt":
                id_vars = [column for column in operation.id_vars or [] if column in working.columns]
                if id_vars:
                    value_vars = [column for column in working.columns if column not in id_vars]
                    working = pd.melt(
                        working,
                        id_vars=id_vars,
                        value_vars=value_vars,
                        var_name=operation.var_name or "variable",
                        value_name=operation.value_name or "value",
                    )
            elif operation.type == "date_features":
                date_column = operation.date_column
                if date_column and date_column in working.columns:
                    parsed = self._robust_parse_datetime(
                        working[date_column], dayfirst=bool(operation.dayfirst), fuzzy=True
                    )
                    prefix = normalize_text(date_column) or "date"
                    title_prefix = "".join(token.capitalize() for token in prefix.split("_")) or "Date"
                    working[f"{title_prefix}Year"] = parsed.dt.year
                    working[f"{title_prefix}Month"] = parsed.dt.month
                    working[f"{title_prefix}Day"] = parsed.dt.day
                    working[f"{title_prefix}DayOfWeek"] = parsed.dt.dayofweek
                    working[f"{title_prefix}Hour"] = parsed.dt.hour
            elif operation.type == "cast_datetime":
                date_column = operation.date_column
                if date_column and date_column in working.columns:
                    working[date_column] = self._robust_parse_datetime(
                        working[date_column],
                        dayfirst=bool(operation.dayfirst),
                        date_format=operation.date_format,
                        year_default=operation.year_default,
                        fuzzy=bool(operation.fuzzy_parse),
                    )

        casted_numeric = [column for column in mapping.numeric_columns if column in working.columns]
        casted_categorical = [column for column in mapping.categorical_columns if column in working.columns]
        for column in casted_numeric:
            working[column] = pd.to_numeric(working[column], errors="coerce")
        for column in casted_categorical:
            working[column] = working[column].astype("string")
            working[column] = working[column].replace({"nan": pd.NA})

        return working.reset_index(drop=True)

    def _build_summary(self, dataframe: pd.DataFrame) -> ManualDatasetSummary:
        numeric_columns = list(dataframe.select_dtypes(include="number").columns)
        datetime_columns = list(dataframe.select_dtypes(include=["datetime", "datetimetz"]).columns)
        categorical_columns = [
            column for column in dataframe.columns if column not in numeric_columns and column not in datetime_columns
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
        return json.loads(preview.to_json(orient="records", date_format="iso"))

    def _suggest_mapping(self, dataframe: pd.DataFrame) -> ManualDatasetRoleMapping:
        numeric_columns = list(dataframe.select_dtypes(include="number").columns)
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
            unit_column=self._match_first(normalized_columns, {"unit", "unidad", "units"}),
        )

    def _guess_datetime_column(self, dataframe: pd.DataFrame) -> str | None:
        best_column: str | None = None
        best_score = 0.0
        for column in dataframe.columns:
            if pd.api.types.is_integer_dtype(dataframe[column]):
                continue
            sample = dataframe[column].dropna().head(25)
            if sample.empty:
                continue
            parsed = self._robust_parse_datetime(sample, dayfirst=True, fuzzy=False)
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
            return "numeric"
        if pd.api.types.is_datetime64_any_dtype(series):
            return "datetime"
        sample = series.dropna().head(25)
        if not sample.empty:
            parsed = self._robust_parse_datetime(sample, fuzzy=True, dayfirst=True)
            if float(parsed.notna().mean()) >= 0.7:
                return "datetime"
        return "categorical"

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
            parsed = self._robust_parse_datetime(dataframe[guessed], fuzzy=True, dayfirst=True)
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
        for candidate in ("variable", "Variable", "metric", "Metric"):
            if candidate in dataframe.columns and candidate != value_column:
                return candidate
        return None

    def _resolve_query_unit_column(self, dataframe: pd.DataFrame, mapping: ManualDatasetRoleMapping) -> str | None:
        if mapping.unit_column and mapping.unit_column in dataframe.columns:
            return mapping.unit_column
        for candidate in ("unit", "Unit", "units", "Units"):
            if candidate in dataframe.columns:
                return candidate
        return None

    def _coerce_unit_value(self, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        if not text or text.lower() == "nan":
            return None
        return text

    def _to_python_datetime(self, value: Any) -> Any:
        if hasattr(value, "to_pydatetime"):
            return value.to_pydatetime()
        return value

    def _to_utc_timestamp(self, value: Any) -> pd.Timestamp:
        timestamp = pd.Timestamp(value)
        if timestamp.tzinfo is None:
            return timestamp.tz_localize("UTC")
        return timestamp.tz_convert("UTC")

    def _stringify_sample(self, value: Any) -> str:
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        return str(value)
