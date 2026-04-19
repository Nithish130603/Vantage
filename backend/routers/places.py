"""
GET /places/autocomplete

Autocomplete proxy using Photon (komoot.io) — built on OpenStreetMap data.
No API key required. Restricted to Australia bounding box.
Returns [{description, place_id}] — same shape as the former Google proxy.
"""

from __future__ import annotations

import logging

import requests
from fastapi import APIRouter, Query

log = logging.getLogger("vantage")
router = APIRouter()

_PHOTON_URL = "https://photon.komoot.io/api/"

# Australia bounding box: lon_min, lat_min, lon_max, lat_max
_AU_BBOX = "112.921114,-43.658266,153.638740,-9.880882"

# Full state name → abbreviation
_STATE_ABBR: dict[str, str] = {
    "New South Wales": "NSW",
    "Victoria": "VIC",
    "Queensland": "QLD",
    "Western Australia": "WA",
    "South Australia": "SA",
    "Tasmania": "TAS",
    "Australian Capital Territory": "ACT",
    "Northern Territory": "NT",
}


def _format_address(props: dict) -> str:
    """Build a readable address string from a Photon feature's properties."""
    parts: list[str] = []

    # Street-level address line
    house  = props.get("housenumber", "").strip()
    street = props.get("street", "").strip()
    name   = props.get("name", "").strip()

    if house and street:
        parts.append(f"{house} {street}")
    elif street:
        parts.append(street)
    elif name:
        parts.append(name)

    # Suburb / locality
    suburb = (
        props.get("locality")
        or props.get("district")
        or props.get("city")
        or ""
    ).strip()

    # For suburb-only results the name IS the suburb; avoid duplication
    if suburb and suburb != (parts[0] if parts else ""):
        parts.append(suburb)
    elif not parts and suburb:
        parts.append(suburb)

    # State abbreviation + postcode
    raw_state = props.get("state", "").strip()
    state_str = _STATE_ABBR.get(raw_state, raw_state)
    postcode  = props.get("postcode", "").strip()
    if state_str or postcode:
        parts.append(f"{state_str} {postcode}".strip())

    return ", ".join(p for p in parts if p)


@router.get("/places/autocomplete")
def places_autocomplete(
    q: str = Query(..., min_length=2),
    limit: int = Query(6, ge=1, le=10),
):
    """
    Real-time address autocomplete via Photon (OpenStreetMap).
    Returns up to `limit` suggestions as [{description, place_id}].
    """
    try:
        resp = requests.get(
            _PHOTON_URL,
            params={
                "q":     q,
                "limit": limit,
                "lang":  "en",
                "bbox":  _AU_BBOX,
            },
            headers={"User-Agent": "Vantage/1.0 (hackathon project)"},
            timeout=4,
        )
        data = resp.json()
    except Exception as exc:
        log.warning(f"Photon request failed: {exc}")
        return []

    results = []
    seen: set[str] = set()

    for feature in data.get("features", []):
        props = feature.get("properties", {})

        # Skip non-Australian results (bbox isn't always strict)
        country = props.get("country", "")
        if country and country not in ("Australia", "AU"):
            continue

        description = _format_address(props)
        if not description:
            continue

        # Deduplicate near-identical labels
        key = description.lower()
        if key in seen:
            continue
        seen.add(key)

        osm_type = props.get("osm_type", "N")
        osm_id   = props.get("osm_id", "")
        place_id = f"{osm_type}{osm_id}"

        results.append({"description": description, "place_id": place_id})

    return results
