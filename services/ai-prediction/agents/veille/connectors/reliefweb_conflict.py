"""
ReliefWeb conflict-specific connector — DRC conflict and violence reports.

Separate from the main ReliefWeb connector to target reports tagged with
"Conflict and Violence" theme for COD.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

import httpx
import structlog

from agents.veille.connectors.base import AbstractConnector
from agents.veille.normalizer import PROVINCE_PCODE_MAP
from config import settings
from schemas.events import CanonicalEvent, EventType, RawEvent

logger = structlog.get_logger(__name__)

_RELIEFWEB_BASE = "https://api.reliefweb.int/v1"


class ReliefWebConflictConnector(AbstractConnector):
    source_id = "reliefweb_conflict"
    fetch_interval_minutes = 180  # every 3 hours
    max_retries = 3
    circuit_breaker_threshold = 5

    async def fetch(self) -> list[RawEvent]:
        url = f"{_RELIEFWEB_BASE}/reports?appname={settings.reliefweb_app_name}"
        payload = {
            "filter": {
                "operator": "AND",
                "conditions": [
                    {
                        "field": "primary_country.iso3",
                        "value": "COD",
                    },
                    {
                        "field": "theme.name",
                        "value": ["Conflict and Violence"],
                        "operator": "OR",
                    },
                ],
            },
            "fields": {
                "include": [
                    "id",
                    "title",
                    "body",
                    "body-html",
                    "date",
                    "source",
                    "url",
                    "primary_country",
                    "theme",
                    "status",
                ],
            },
            "limit": 30,
            "sort": ["date.created:desc"],
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "reliefweb_conflict.http_error",
                status_code=exc.response.status_code,
                error=str(exc),
            )
            return []
        except Exception as exc:
            logger.error("reliefweb_conflict.fetch_error", error=str(exc))
            return []

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

        logger.info("reliefweb_conflict.fetch", count=len(events))
        return events

    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        fields = raw.raw_data.get("fields", raw.raw_data)

        title: str = fields.get("title", fields.get("name", "Unnamed conflict report"))

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
        date_obj = fields.get("date", {})
        date_str: str = date_obj.get("created", "") if isinstance(date_obj, dict) else ""
        try:
            fetched_at = (
                datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                if date_str
                else raw.fetched_at
            )
        except ValueError:
            fetched_at = raw.fetched_at

        # Description from body-html
        body_html: str = fields.get("body-html", fields.get("body", "")) or ""
        description = re.sub(r"<[^>]+>", " ", body_html).strip() or None

        # Source URL
        source_url: str | None = fields.get("url")
        if not source_url:
            source_url = f"https://reliefweb.int/report/{raw.external_id}"

        # Status → severity
        status_val = fields.get("status", "")
        if isinstance(status_val, list) and status_val:
            status_val = (
                status_val[0].get("name", "")
                if isinstance(status_val[0], dict)
                else str(status_val[0])
            )

        return CanonicalEvent(
            source_id=raw.source_id,
            external_id=raw.external_id,
            event_type=EventType.CONFLIT,
            title=title,
            description=description,
            p_code=p_code,
            province=province,
            coordinates=None,
            severity=_status_to_severity(str(status_val)),
            source_url=source_url,
            raw_data=raw.raw_data,
            fetched_at=fetched_at,
            reliability_score=0.80,
        )


def _status_to_severity(status: str) -> int:
    mapping = {
        "alert": 4,
        "ongoing": 3,
        "past": 2,
        "": 1,
    }
    return mapping.get(status.lower(), 1)
