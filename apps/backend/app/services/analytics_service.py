from __future__ import annotations

from datetime import date, datetime, time, timedelta
from decimal import Decimal
import re
from typing import Any

from sqlalchemy import desc, func, select, text
from sqlalchemy.orm import Session

from app.models.measurement import Measurement
from app.models.source_file import SourceFile
from app.models.station import Station
from app.models.variable import Variable
from app.schemas.analytics import (
    AnalyticsDataRowResponse,
    AnalyticsFilterOptionsResponse,
    AnalyticsQueryRequest,
    AnalyticsQueryResponse,
    AnalyticsSourceOption,
    AnalyticsStationOption,
    AnalyticsVariableOption,
    SqlPreviewRequest,
    SqlPreviewResponse,
)

FORBIDDEN_SQL_PATTERN = re.compile(
    r"\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|copy|call|do|merge)\b",
    flags=re.IGNORECASE,
)


def get_filter_options(db: Session) -> AnalyticsFilterOptionsResponse:
    measurement_count = func.count(Measurement.id).label("measurement_count")
    source_rows = db.execute(
        select(
            SourceFile.id,
            SourceFile.original_name,
            SourceFile.source_type,
            SourceFile.etl_run_id,
            SourceFile.downloaded_at,
            measurement_count,
        )
        .join(Measurement, Measurement.source_file_id == SourceFile.id)
        .where(SourceFile.status == "completed")
        .group_by(
            SourceFile.id,
            SourceFile.original_name,
            SourceFile.source_type,
            SourceFile.etl_run_id,
            SourceFile.downloaded_at,
        )
        .having(func.count(Measurement.id) > 0)
        .order_by(desc(SourceFile.downloaded_at), desc(measurement_count), desc(SourceFile.id))
        .limit(300)
    ).all()

    station_rows = db.execute(select(Station.code, Station.name).order_by(Station.code.asc())).all()
    variable_rows = db.execute(select(Variable.code, Variable.display_name).order_by(Variable.code.asc())).all()

    min_observed_at, max_observed_at = db.execute(
        select(func.min(Measurement.observed_at), func.max(Measurement.observed_at))
    ).one()

    return AnalyticsFilterOptionsResponse(
        sources=[
            AnalyticsSourceOption(
                id=row.id,
                name=row.original_name,
                source_type=row.source_type,
                etl_run_id=row.etl_run_id,
                downloaded_at=row.downloaded_at,
                row_count=int(row.measurement_count),
            )
            for row in source_rows
        ],
        stations=[AnalyticsStationOption(code=row.code, name=row.name) for row in station_rows],
        variables=[AnalyticsVariableOption(code=row.code, name=row.display_name) for row in variable_rows],
        min_observed_at=min_observed_at,
        max_observed_at=max_observed_at,
    )


def query_data(db: Session, payload: AnalyticsQueryRequest) -> AnalyticsQueryResponse:
    statement = (
        select(
            Measurement.observed_at,
            Measurement.value,
            Measurement.unit,
            Station.code.label("station_code"),
            Station.name.label("station_name"),
            Variable.code.label("variable_code"),
            Variable.display_name.label("variable_name"),
            SourceFile.id.label("source_file_id"),
            SourceFile.original_name.label("source_file_name"),
            SourceFile.source_type.label("source_type"),
        )
        .join(Station, Station.id == Measurement.station_id)
        .join(Variable, Variable.id == Measurement.variable_id)
        .join(SourceFile, SourceFile.id == Measurement.source_file_id)
    )

    if payload.source_file_ids:
        statement = statement.where(SourceFile.id.in_(payload.source_file_ids))
    if payload.station_codes:
        statement = statement.where(Station.code.in_(payload.station_codes))
    if payload.variable_codes:
        statement = statement.where(Variable.code.in_(payload.variable_codes))
    if payload.date_from is not None:
        start_dt = datetime.combine(payload.date_from, time.min)
        statement = statement.where(Measurement.observed_at >= start_dt)
    if payload.date_to is not None:
        end_dt = datetime.combine(payload.date_to + timedelta(days=1), time.min)
        statement = statement.where(Measurement.observed_at < end_dt)

    result_rows = db.execute(
        statement.order_by(Measurement.observed_at.asc()).limit(payload.limit + 1)
    ).all()

    truncated = len(result_rows) > payload.limit
    capped_rows = result_rows[: payload.limit]

    return AnalyticsQueryResponse(
        rows=[
            AnalyticsDataRowResponse(
                observed_at=row.observed_at,
                station_code=row.station_code,
                station_name=row.station_name,
                variable_code=row.variable_code,
                variable_name=row.variable_name,
                value=float(row.value),
                unit=row.unit,
                source_file_id=row.source_file_id,
                source_file_name=row.source_file_name,
                source_type=row.source_type,
            )
            for row in capped_rows
        ],
        row_count=len(capped_rows),
        truncated=truncated,
    )


def preview_sql(db: Session, payload: SqlPreviewRequest) -> SqlPreviewResponse:
    sql_clean = _validate_select_sql(payload.sql)
    statement = text(f"SELECT * FROM ({sql_clean}) AS sql_preview LIMIT :limit_plus_one")
    mappings = db.execute(statement, {"limit_plus_one": payload.limit + 1}).mappings().all()

    truncated = len(mappings) > payload.limit
    rows_limited = mappings[: payload.limit]
    columns = list(rows_limited[0].keys()) if rows_limited else []

    return SqlPreviewResponse(
        columns=columns,
        rows=[{key: _serialize_scalar(value) for key, value in row.items()} for row in rows_limited],
        row_count=len(rows_limited),
        truncated=truncated,
    )


def _validate_select_sql(raw_sql: str) -> str:
    sql_candidate = raw_sql.strip()
    if not sql_candidate:
        raise ValueError("Provide a SQL query.")

    if sql_candidate.endswith(";"):
        sql_candidate = sql_candidate[:-1].strip()

    if ";" in sql_candidate:
        raise ValueError("Only one SQL statement is allowed.")

    lowered = sql_candidate.lower()
    if not lowered.startswith("select "):
        raise ValueError("Only SELECT queries are allowed.")

    if "--" in sql_candidate or "/*" in sql_candidate or "*/" in sql_candidate:
        raise ValueError("SQL comments are not allowed in preview mode.")

    if FORBIDDEN_SQL_PATTERN.search(sql_candidate):
        raise ValueError("Only read-only SELECT queries are allowed.")

    return sql_candidate


def _serialize_scalar(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value
