"""
GDACS connector — replaces the defunct ReliefWeb v1 API.

ReliefWeb v1 was decommissioned (410 Gone); v2 requires a manually
approved appname. GDACS (Global Disaster Alert & Coordination System,
UN-backed) provides equivalent coverage, is open without auth, and
returns structured GeoJSON with GLIDE numbers.
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx
import structlog

from agents.veille.connectors.base import AbstractConnector
from agents.veille.normalizer import PROVINCE_PCODE_MAP
from config import settings
from schemas.events import CanonicalEvent, EventType, RawEvent

logger = structlog.get_logger(__name__)

_GDACS_BASE = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"

# DRC bounding box (lon_min, lat_min, lon_max, lat_max)
_DRC_BBOX = "12.2,-13.5,31.3,5.4"

# GDACS event type codes → SINAUR EventType
_GDACS_TYPE_MAP: dict[str, EventType] = {
    "FL": EventType.INONDATION,
    "DR": EventType.SECHERESSE,
    "EP": EventType.EPIDEMIE,
    "VO": EventType.VOLCAN,
    "EQ": EventType.AUTRE,
    "TC": EventType.AUTRE,
    "TS": EventType.AUTRE,
    "WF": EventType.AUTRE,
}

# GDACS alert level → severity int
_ALERT_SEVERITY: dict[str, int] = {
    "Red": 4,
    "Orange": 3,
    "Green": 2,
}


class ReliefWebConnector(AbstractConnector):
    """GDACS connector (class name kept for registry compatibility)."""

    source_id = "reliefweb"
    fetch_interval_minutes = 60
    max_retries = 3
    circuit_breaker_threshold = 5

    async def fetch(self) -> list[RawEvent]:
        from datetime import timedelta
        today = datetime.now(timezone.utc).date()
        from_date = (today - timedelta(days=90)).isoformat()
        to_date = today.isoformat()

        params = {
            "bbox": _DRC_BBOX,
            "fromdate": from_date,
            "todate": to_date,
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(_GDACS_BASE, params=params)
            resp.raise_for_status()
            data = resp.json()

        now = datetime.now(timezone.utc)
        events: list[RawEvent] = []
        for feature in data.get("features", []):
            props = feature.get("properties", {})
            # Keep only events affecting COD
            affected = props.get("affectedcountries", [])
            if not any(c.get("iso3") == "COD" for c in affected):
                # Fallback: check iso3 field directly
                if props.get("iso3") != "COD":
                    continue
            events.append(
                RawEvent(
                    source_id=self.source_id,
                    external_id=str(props.get("eventid", "")),
                    raw_data=feature,
                    fetched_at=now,
                )
            )
        logger.info("gdacs.fetch", count=len(events))
        return events

    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        props = raw.raw_data.get("properties", {})

        event_type = _GDACS_TYPE_MAP.get(props.get("eventtype", ""), EventType.AUTRE)
        title: str = props.get("name") or props.get("eventname") or "GDACS event"
        description: str | None = props.get("htmldescription") or props.get("description")

        # Province from title
        province: str | None = None
        p_code: str | None = None
        title_lower = title.lower()
        for prov_name, pcode in PROVINCE_PCODE_MAP.items():
            if prov_name.lower() in title_lower:
                province = prov_name
                p_code = pcode
                break

        # Date
        date_str: str = props.get("fromdate", "")
        try:
            fetched_at = datetime.fromisoformat(date_str.replace("Z", "+00:00")) if date_str else raw.fetched_at
        except ValueError:
            fetched_at = raw.fetched_at

        glide: str | None = props.get("glide") or None
        alert_level: str = props.get("alertlevel", "")
        severity = _ALERT_SEVERITY.get(alert_level, 1)
        source_url = props.get("url", {}).get("report") or f"https://www.gdacs.org/report.aspx?eventid={raw.external_id}"

        return CanonicalEvent(
            source_id=raw.source_id,
            external_id=raw.external_id,
            glide_number=glide,
            event_type=event_type,
            title=title,
            description=description,
            p_code=p_code,
            province=province,
            coordinates=None,
            severity=severity,
            source_url=source_url,
            raw_data=raw.raw_data,
            fetched_at=fetched_at,
            reliability_score=0.88,
        )
