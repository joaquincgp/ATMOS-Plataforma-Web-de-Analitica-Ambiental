from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.station import Station
from app.services.etl.helpers import normalize_text


@dataclass(frozen=True)
class StationReference:
    name: str
    latitude: float
    longitude: float
    region: str
    aliases: tuple[str, ...]


STATION_REFERENCES: tuple[StationReference, ...] = (
    StationReference(
        name="San Antonio",
        latitude=-0.009222,
        longitude=-78.448001,
        region="Quito",
        aliases=("sanantonio", "san_antonio"),
    ),
    StationReference(
        name="Carapungo",
        latitude=-0.095472,
        longitude=-78.449809,
        region="Quito",
        aliases=("carapungo", "car"),
    ),
    StationReference(
        name="Cotocollao",
        latitude=-0.107777,
        longitude=-78.497222,
        region="Quito",
        aliases=("cotocollao", "cot"),
    ),
    StationReference(
        name="Belisario",
        latitude=-0.184719,
        longitude=-78.495986,
        region="Quito",
        aliases=("belisario", "bel"),
    ),
    StationReference(
        name="Tumbaco",
        latitude=-0.214933,
        longitude=-78.403253,
        region="Quito",
        aliases=("tumbaco", "tum"),
    ),
    StationReference(
        name="Centro",
        latitude=-0.221393,
        longitude=-78.514005,
        region="Quito",
        aliases=("centro", "cen"),
    ),
    StationReference(
        name="El Camal",
        latitude=-0.25,
        longitude=-78.51,
        region="Quito",
        aliases=("elcamal", "el_camal", "camal", "cam"),
    ),
    StationReference(
        name="Los Chillos",
        latitude=-0.297062,
        longitude=-78.455248,
        region="Quito",
        aliases=("loschillos", "los_chillos", "chillos", "chi"),
    ),
    StationReference(
        name="Guamani",
        latitude=-0.333949,
        longitude=-78.553416,
        region="Quito",
        aliases=("guamani", "gua"),
    ),
)


def _normalize_station_token(value: str | None) -> str:
    if not value:
        return ""
    return normalize_text(value).replace("_", "")


def resolve_station_reference(code: str | None, name: str | None) -> StationReference | None:
    normalized_tokens = {
        token
        for token in (_normalize_station_token(code), _normalize_station_token(name))
        if token
    }
    if not normalized_tokens:
        return None

    for reference in STATION_REFERENCES:
        aliases = {_normalize_station_token(alias) for alias in reference.aliases}
        aliases.add(_normalize_station_token(reference.name))
        if normalized_tokens & aliases:
            return reference
    return None


def sync_station_reference_metadata(db: Session) -> int:
    stations = db.scalars(select(Station)).all()
    updated_count = 0

    for station in stations:
        reference = resolve_station_reference(station.code, station.name)
        if reference is None:
            continue

        changed = False
        if station.latitude is None or abs(station.latitude - reference.latitude) > 1e-9:
            station.latitude = reference.latitude
            changed = True
        if station.longitude is None or abs(station.longitude - reference.longitude) > 1e-9:
            station.longitude = reference.longitude
            changed = True

        current_name = (station.name or "").strip()
        current_name_normalized = _normalize_station_token(current_name)
        code_normalized = _normalize_station_token(station.code)
        if not current_name or current_name_normalized in {"unknownstation", code_normalized}:
            station.name = reference.name
            changed = True

        if changed:
            updated_count += 1

    if updated_count > 0:
        db.commit()

    return updated_count
