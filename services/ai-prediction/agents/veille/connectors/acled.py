"""
ACLED (Armed Conflict Location & Event Data) connector — DRC conflict events.

Disabled unless both ACLED_API_KEY and ACLED_ACCESS_EMAIL are configured.
Register for free access at https://acleddata.com/register/
ISO country code for DRC: 180
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

_ACLED_BASE = "https://api.acleddata.com/acled/read"

# ACLED event type → SINAUR EventType
_ACLED_TYPE_MAP: dict[str, EventType] = {
    "Battles": EventType.CONFLIT,
    "Violence against civilians": EventType.CONFLIT,
    "Explosions/Remote violence": EventType.CONFLIT,
    "Riots": EventType.CONFLIT,
    "Protests": EventType.AUTRE,
    "Strategic developments": EventType.CONFLIT,
}

_ACLED_FIELDS = (
    "event_id_cnty|event_date|event_type|sub_event_type|actor1|actor2"
    "|admin1|admin2|location|latitude|longitude|fatalities|notes"
)


class AcledConnector(AbstractConnector):
    source_id = "acled"
    fetch_interval_minutes = 60
    max_retries = 3
    circuit_breaker_threshold = 5

    async def fetch(self) -> list[RawEvent]:
        if not settings.acled_api_key or not settings.acled_access_email:
            logger.info(
                "acled_connector.disabled",
                reason="No API credentials configured. "
                       "Register at https://acleddata.com/register/ and set "
                       "ACLED_API_KEY and ACLED_ACCESS_EMAIL environment variables.",
            )
            return []

        params = {
            "key": settings.acled_api_key,
            "email": settings.acled_access_email,
            "iso": "180",  # Democratic Republic of Congo
            "limit": "500",
            "fields": _ACLED_FIELDS,
        }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.get(_ACLED_BASE, params=params)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "acled_connector.http_error",
                status_code=exc.response.status_code,
                error=str(exc),
            )
            return []
        except Exception as exc:
            logger.error("acled_connector.fetch_error", error=str(exc))
            return []

        now = datetime.now(timezone.utc)
        events: list[RawEvent] = []

        rows = data.get("data", [])
        for row in rows:
            try:
                events.append(
                    RawEvent(
                        source_id=self.source_id,
                        external_id=str(row.get("event_id_cnty", "")),
                        raw_data=row,
                        fetched_at=now,
                    )
                )
            except Exception as row_exc:
                logger.debug("acled_connector.row_error", error=str(row_exc))
                continue

        logger.info("acled_connector.fetch", count=len(events))
        return events

    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        data = raw.raw_data

        event_type_str: str = data.get("event_type", "")
        event_type = _ACLED_TYPE_MAP.get(event_type_str, EventType.CONFLIT)

        admin1: str = data.get("admin1", "") or ""
        location: str = data.get("location", "") or ""
        actor1: str = data.get("actor1", "") or ""
        actor2: str = data.get("actor2", "") or ""
        sub_type: str = data.get("sub_event_type", "") or ""
        fatalities: int = int(data.get("fatalities") or 0)
        notes: str = data.get("notes", "") or ""

        # Province matching
        province: str | None = None
        p_code: str | None = None
        admin1_lower = admin1.lower()
        for prov_name, pcode in PROVINCE_PCODE_MAP.items():
            if prov_name.lower() in admin1_lower or admin1_lower in prov_name.lower():
                province = prov_name
                p_code = pcode
                break

        # Coordinates
        coordinates: tuple[float, float] | None = None
        try:
            lat = float(data.get("latitude") or 0)
            lon = float(data.get("longitude") or 0)
            if lat != 0 or lon != 0:
                coordinates = (lon, lat)
        except (ValueError, TypeError):
            pass

        # Severity based on fatalities
        if fatalities == 0:
            severity = 2
        elif fatalities < 5:
            severity = 3
        elif fatalities < 20:
            severity = 4
        else:
            severity = 5

        actors_part = ""
        if actor1 or actor2:
            actors_part = f" — Acteurs : {actor1}" + (f" vs {actor2}" if actor2 else "")

        title = (
            f"{event_type_str or 'Conflit'} : {sub_type or event_type_str}"
            + (f" à {location}" if location else "")
            + (f", {admin1}" if admin1 else "")
            + actors_part
        )

        description = notes or None
        if fatalities:
            fat_note = f"Victimes signalées : {fatalities}."
            description = f"{fat_note} {description}" if description else fat_note

        # Date
        date_str: str = data.get("event_date", "")
        try:
            fetched_at = (
                datetime.fromisoformat(date_str)
                if date_str
                else raw.fetched_at
            )
            if fetched_at.tzinfo is None:
                fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        except ValueError:
            fetched_at = raw.fetched_at

        return CanonicalEvent(
            source_id=raw.source_id,
            external_id=raw.external_id,
            event_type=event_type,
            title=title[:500],  # cap to avoid oversized titles
            description=description,
            p_code=p_code,
            province=province or admin1 or None,
            coordinates=coordinates,
            severity=severity,
            source_url=f"https://acleddata.com/data-export-tool/",
            raw_data=raw.raw_data,
            fetched_at=fetched_at,
            reliability_score=0.90,
        )
