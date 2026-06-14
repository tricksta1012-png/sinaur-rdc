"""
GDACS conflict-proxy connector — DRC conflict and displacement events.

ReliefWeb v1 was decommissioned (410 Gone). This connector now uses GDACS
filtered to CE (Complex Emergency) and displacement event types for COD.
Conflict-specific data is supplemented by the renseignement agent (ACLED, OCHA).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import httpx
import structlog

from agents.veille.connectors.base import AbstractConnector
from agents.veille.normalizer import PROVINCE_PCODE_MAP
from schemas.events import CanonicalEvent, EventType, RawEvent

logger = structlog.get_logger(__name__)

_GDACS_BASE = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
_DRC_BBOX = "12.2,-13.5,31.3,5.4"

_ALERT_SEVERITY: dict[str, int] = {
    "Red": 4,
    "Orange": 3,
    "Green": 2,
}


class ReliefWebConflictConnector(AbstractConnector):
    source_id = "reliefweb_conflict"
    fetch_interval_minutes = 180
    max_retries = 3
    circuit_breaker_threshold = 5

    async def fetch(self) -> list[RawEvent]:
        today = datetime.now(timezone.utc).date()
        from_date = (today - timedelta(days=180)).isoformat()
        to_date = today.isoformat()

        params = {
            "bbox": _DRC_BBOX,
            "eventtype": "CE",  # Complex Emergency (covers conflict/displacement)
            "fromdate": from_date,
            "todate": to_date,
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(_GDACS_BASE, params=params)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "gdacs_conflict.http_error",
                status_code=exc.response.status_code,
                error=str(exc),
            )
            return []
        except Exception as exc:
            logger.error("gdacs_conflict.fetch_error", error=str(exc))
            return []

        now = datetime.now(timezone.utc)
        events: list[RawEvent] = []
        for feature in data.get("features", []):
            props = feature.get("properties", {})
            affected = props.get("affectedcountries", [])
            if not any(c.get("iso3") == "COD" for c in affected):
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

        logger.info("gdacs_conflict.fetch", count=len(events))
        return events

    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        props = raw.raw_data.get("properties", {})

        title: str = props.get("name") or props.get("eventname") or "GDACS Complex Emergency"
        description: str | None = props.get("htmldescription") or props.get("description")
        if description:
            description = re.sub(r"<[^>]+>", " ", description).strip() or None

        province: str | None = None
        p_code: str | None = None
        title_lower = title.lower()
        for prov_name, pcode in PROVINCE_PCODE_MAP.items():
            if prov_name.lower() in title_lower:
                province = prov_name
                p_code = pcode
                break

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
            event_type=EventType.CONFLIT,
            title=title,
            description=description,
            p_code=p_code,
            province=province,
            coordinates=None,
            severity=severity,
            source_url=source_url,
            raw_data=raw.raw_data,
            fetched_at=fetched_at,
            reliability_score=0.80,
        )
