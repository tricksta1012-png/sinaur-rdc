"""ACLED deep connector — full field extraction for DRC."""
from __future__ import annotations
import os
import httpx
import structlog
from ..schemas import IntelEvent, IntelCategory

logger = structlog.get_logger(__name__)

ACLED_API = "https://api.acleddata.com/acled/read"

# All relevant sub-event types for military activity
MILITARY_SUB_EVENTS = [
    "Armed clash", "Government regains territory",
    "Non-state actor overtakes territory", "Air/drone strike",
    "Shelling/artillery/missile attack", "Remote explosive/landmine/IED",
    "Abduction/forced disappearance", "Attack", "Looting/property destruction",
]


def _sub_event_to_category(sub: str) -> IntelCategory:
    if any(w in sub for w in ["overtakes", "regains", "clash", "strike", "Shelling", "IED"]):
        return IntelCategory.ACTIVITE_MILITAIRE
    if "Abduction" in sub:
        return IntelCategory.INCIDENT_SECURITAIRE
    if "Looting" in sub:
        return IntelCategory.DOMMAGE_INFRASTRUCTURE
    return IntelCategory.ACTIVITE_MILITAIRE


async def fetch_acled_deep(days: int = 14) -> list[IntelEvent]:
    api_key = os.getenv("ACLED_API_KEY", "")
    email = os.getenv("ACLED_EMAIL", "")
    if not api_key or not email:
        logger.info("acled_deep.no_credentials", hint="Set ACLED_API_KEY and ACLED_EMAIL env vars")
        return []

    params = {
        "key": api_key,
        "email": email,
        "country": "Democratic Republic of Congo",
        "limit": 200,
        "fields": ",".join([
            "event_id_cnty", "event_date", "event_type", "sub_event_type",
            "actor1", "assoc_actor_1", "actor2", "assoc_actor_2",
            "admin1", "admin2", "admin3", "location", "latitude", "longitude",
            "source", "notes", "fatalities", "civilian_targeting",
        ]),
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(ACLED_API, params=params)
            resp.raise_for_status()
            data = resp.json().get("data", [])
    except Exception as exc:
        logger.warning("acled_deep.fetch_failed", error=str(exc))
        return []

    events: list[IntelEvent] = []
    for row in data:
        actors = [a for a in [row.get("actor1"), row.get("actor2")] if a]
        events.append(IntelEvent(
            source_id="acled",
            external_id=str(row.get("event_id_cnty", "")),
            title=f"{row.get('sub_event_type','')} — {row.get('location','')}",
            date=row.get("event_date", ""),
            content=row.get("notes", "")[:800],
            url=None,
            reliability=0.92,
            category=_sub_event_to_category(row.get("sub_event_type", "")),
            p_code=None,
            province=row.get("admin1", ""),
            territoire=row.get("admin2", ""),
            actor_names=actors,
        ))
    return events
