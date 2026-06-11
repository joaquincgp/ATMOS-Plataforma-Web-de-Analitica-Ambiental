from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

ECUADOR_TIME_ZONE = ZoneInfo("America/Guayaquil")


def ecuador_now() -> datetime:
    return datetime.now(ECUADOR_TIME_ZONE)


def ecuador_now_naive() -> datetime:
    return ecuador_now().replace(tzinfo=None)


def ecuador_now_iso() -> str:
    return ecuador_now().isoformat()


def utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)
