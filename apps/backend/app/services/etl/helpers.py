from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import re
import unicodedata

import pandas as pd


DEFAULT_VARIABLE_UNITS = {
    "PM25": "ug/m3",
    "PM2.5": "ug/m3",
    "PM10": "ug/m3",
    "NO2": "ug/m3",
    "SO2": "ug/m3",
    "O3": "ug/m3",
    "CO": "mg/m3",
    "TMP": "C",
    "TEMP": "C",
    "TEMPERATURA": "C",
    "HUM": "%",
    "HUMEDAD": "%",
    "VEL": "m/s",
    "VIENTO": "m/s",
    "PRE": "hPa",
    "PRESION": "hPa",
    "IUV": "index",
    "RS": "W/m2",
    "LLU": "mm",
}


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    normalized = re.sub(r"\s+", "_", normalized.strip().lower())
    normalized = re.sub(r"[^a-z0-9_]+", "", normalized)
    return normalized


def normalize_variable_code(value: str) -> str:
    code = value.strip().upper()
    code = code.replace(" ", "")
    code = code.replace("μ", "u")
    code = code.replace("µ", "u")
    if code in {"PM2.5", "PM2_5", "PM2-5"}:
        return "PM25"
    return code


def parse_datetime(value: object) -> datetime | None:
    if value is None:
        return None

    if isinstance(value, datetime):
        dt = value
    else:
        dt = pd.to_datetime(value, errors="coerce")
        if pd.isna(dt):
            return None
        dt = dt.to_pydatetime()

    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def guess_unit(variable_code: str, provided_unit: str | None) -> str | None:
    if provided_unit and provided_unit.strip():
        return provided_unit.strip()
    return DEFAULT_VARIABLE_UNITS.get(normalize_variable_code(variable_code))


def compute_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def compute_record_hash(station_code: str, variable_code: str, observed_at: datetime) -> str:
    payload = f"{station_code}|{variable_code}|{observed_at.isoformat()}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()
