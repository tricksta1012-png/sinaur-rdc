"""
OHCHR (Haut-Commissariat ONU aux droits de l'homme) connector — DRC.

Rôle dans SINAUR : violations documentées, exactions, violence contre civils.
Fiabilité 0.92 — terrain ONU, vérification indépendante.

Sources :
  - ReliefWeb (rapports OHCHR DRC via tag "human rights")
  - Flux RSS OHCHR DRC si disponible
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import structlog

from agents.veille.connectors.base import AbstractConnector
from schemas.events import CanonicalEvent, EventType, RawEvent

logger = structlog.get_logger(__name__)

_RELIEFWEB_BASE = "https://api.reliefweb.int/v2/reports"

# Mots-clés violations droits humains
_HR_KEYWORDS = {
    "massacre", "atrocity", "civilians killed", "civilian casualties",
    "human rights", "droits de l'homme", "violation", "extrajudicial",
    "sexual violence", "rape", "torture", "abduction", "forced displacement",
    "arbitrary detention", "summary execution",
}

# Provinces identifiables
_PROVINCE_KW: list[tuple[str, str, str]] = [
    ("nord-kivu", "Nord-Kivu", "CD61"), ("north kivu", "Nord-Kivu", "CD61"),
    ("goma",      "Nord-Kivu", "CD61"), ("rutshuru",   "Nord-Kivu", "CD61"),
    ("sud-kivu",  "Sud-Kivu",  "CD62"), ("south kivu", "Sud-Kivu",  "CD62"),
    ("bukavu",    "Sud-Kivu",  "CD62"),
    ("ituri",     "Ituri",     "CD54"), ("bunia",      "Ituri",     "CD54"),
    ("maniema",   "Maniema",   "CD63"),
    ("tanganyika","Tanganyika","CD74"),
    ("kasai",     "Kasaï",     "CD83"),
    ("katanga",   "Haut-Katanga","CD71"),
    ("kinshasa",  "Kinshasa",  "CD10"),
]


def _extract_location(text: str) -> tuple[str, str] | None:
    t = text.lower()
    for kw, name, pcode in _PROVINCE_KW:
        if kw in t:
            return (name, pcode)
    return None


def _is_relevant(title: str, desc: str = "") -> bool:
    combined = (title + " " + desc).lower()
    return any(kw in combined for kw in _HR_KEYWORDS)


class OHCHRConnector(AbstractConnector):
    """
    OHCHR rapports DRC — violations documentées terrain ONU.
    Fetch 4x/jour via ReliefWeb (source la plus structurée pour rapports OHCHR).
    """
    source_id = "ohchr"
    fetch_interval_minutes = 360  # 4×/jour
    max_retries = 3
    circuit_breaker_threshold = 5

    async def fetch(self) -> list[RawEvent]:
        since = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%dT00:00:00+00:00")
        now   = datetime.now(timezone.utc)

        payload = {
            "filter": {
                "operator": "AND",
                "conditions": [
                    {"field": "source.name", "value": "OHCHR"},
                    {"field": "country.iso3", "value": "COD"},
                    {"field": "date.created", "value": {"from": since}, "operator": ">="},
                ],
            },
            "fields": {"include": ["title", "date", "body", "url", "source"]},
            "limit": 50,
            "sort": ["date.created:desc"],
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    _RELIEFWEB_BASE,
                    json=payload,
                    params={"appname": "sinaur-rdc"},
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            logger.error("ohchr_connector.fetch_error", error=str(exc))
            return []

        items = data.get("data", [])
        events: list[RawEvent] = []
        for item in items:
            fields = item.get("fields", {})
            title  = fields.get("title", "") or ""
            body   = (fields.get("body", "") or "")[:500]
            if not _is_relevant(title, body):
                continue
            events.append(RawEvent(
                source_id=self.source_id,
                external_id=str(item.get("id", "")),
                raw_data={"title": title, "body": body, "date": fields.get("date", {}), "url": fields.get("url", "")},
                fetched_at=now,
            ))

        logger.info("ohchr_connector.fetch", total=len(items), filtered=len(events))
        return events

    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        d   = raw.raw_data
        now = datetime.now(timezone.utc)

        title = d.get("title", "") or "[OHCHR] Rapport droits humains DRC"
        body  = d.get("body",  "") or ""
        url   = d.get("url",   "") or "https://www.ohchr.org/en/countries/democratic-republic-congo"

        loc = _extract_location(title + " " + body)
        province = loc[0] if loc else "RDC"
        p_code   = loc[1] if loc else None

        date_obj = d.get("date", {})
        date_str = date_obj.get("created") or date_obj.get("changed") or "" if isinstance(date_obj, dict) else ""
        try:
            fetched_at = datetime.fromisoformat(date_str[:10]).replace(tzinfo=timezone.utc) if date_str else now
        except ValueError:
            fetched_at = now

        desc = (body[:400] + "…" if len(body) > 400 else body) or None
        if desc:
            desc += " | Source : OHCHR — Haut-Commissariat ONU aux droits de l'homme."

        return CanonicalEvent(
            source_id=self.source_id,
            external_id=raw.external_id,
            event_type=EventType.CONFLIT,
            title=f"[OHCHR] {title[:200]}",
            description=desc,
            p_code=p_code,
            province=province,
            coordinates=None,
            severity=4,  # violations droits humains = par défaut sévère
            source_url=url,
            raw_data=raw.raw_data,
            fetched_at=fetched_at,
            reliability_score=0.92,
            sources_list=["ohchr"],
        )
