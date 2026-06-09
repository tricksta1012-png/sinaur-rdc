"""
ReliefWeb API connector — fetches DRC disaster data.
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx
import structlog

from agents.veille.connectors.base import AbstractConnector
from agents.veille.normalizer import RELIEFWEB_TYPE_MAP, PROVINCE_PCODE_MAP
from config import settings
from schemas.events import CanonicalEvent, EventType, RawEvent

logger = structlog.get_logger(__name__)

_RELIEFWEB_BASE = "https://api.reliefweb.int/v1"


class ReliefWebConnector(AbstractConnector):
    source_id = "reliefweb"
    fetch_interval_minutes = 60
    max_retries = 3
    circuit_breaker_threshold = 5

    async def fetch(self) -> list[RawEvent]:
        url = (
            f"{_RELIEFWEB_BASE}/disasters"
            f"?appname={settings.reliefweb_app_name}"
            f"&filter[field]=primary_country.iso3"
            f"&filter[value]=COD"
            f"&limit=50"
            f"&sort[]=date:desc"
        )
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        now = datetime.now(timezone.utc)
        events: list[RawEvent] = []
        for item in data.get("data", []):
            events.append(
                RawEvent(
                    source_id=self.source_id,
                    external_id=str(item.get("id", "")),
                    raw_data=item,
                    fetched_at=now,
                )
            )
        logger.info("reliefweb.fetch", count=len(events))
        return events

    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        fields = raw.raw_data.get("fields", raw.raw_data)
        type_name: str = ""
        types = fields.get("type", [])
        if isinstance(types, list) and types:
            type_name = types[0].get("name", "") if isinstance(types[0], dict) else str(types[0])
        elif isinstance(types, dict):
            type_name = types.get("name", "")

        event_type = RELIEFWEB_TYPE_MAP.get(type_name, EventType.AUTRE)

        title: str = fields.get("name", fields.get("title", "Unnamed disaster"))

        # Extract province/location
        countries = fields.get("primary_country", {})
        if isinstance(countries, list) and countries:
            countries = countries[0]
        province: str | None = None
        p_code: str | None = None

        # Try to match province from title or description
        title_lower = title.lower()
        for prov_name, pcode in PROVINCE_PCODE_MAP.items():
            if prov_name.lower() in title_lower:
                province = prov_name
                p_code = pcode
                break

        # Date parsing
        date_str: str = fields.get("date", {}).get("created", "") if isinstance(fields.get("date"), dict) else ""
        try:
            fetched_at = datetime.fromisoformat(date_str.replace("Z", "+00:00")) if date_str else raw.fetched_at
        except ValueError:
            fetched_at = raw.fetched_at

        glide: str | None = fields.get("glide", None)

        return CanonicalEvent(
            source_id=raw.source_id,
            external_id=raw.external_id,
            glide_number=glide,
            event_type=event_type,
            title=title,
            description=fields.get("description", None),
            p_code=p_code,
            province=province,
            coordinates=None,
            severity=_map_status_to_severity(fields.get("status", "")),
            source_url=f"https://reliefweb.int/disaster/{raw.external_id}",
            raw_data=raw.raw_data,
            fetched_at=fetched_at,
            reliability_score=0.9,
        )


def _map_status_to_severity(status: str) -> int:
    mapping = {
        "alert": 4,
        "ongoing": 3,
        "past": 2,
        "": 1,
    }
    return mapping.get(status.lower(), 1)
