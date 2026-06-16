"""
UCDP GED (Uppsala Conflict Data Program — Georeferenced Event Dataset) connector.

Rôle dans SINAUR : CONTRÔLE QUALITÉ — décès vérifiés (low/best/high),
définitions strictes. Quand UCDP + ACLED concordent → fiabilité maximale.

API publique — pas de clé requise.
Version utilisée : 24.1 (dernière release annuelle disponible en 2025)
Country ID DRC : 490
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx
import structlog

from agents.veille.connectors.base import AbstractConnector
from agents.veille.normalizer import PROVINCE_PCODE_MAP
from schemas.events import CanonicalEvent, EventType, RawEvent

logger = structlog.get_logger(__name__)

_UCDP_BASE = "https://ucdpapi.pcr.uu.se/api/gedevents/24.1"

# UCDP type_of_violence → EventType
# 1 = State-based conflict, 2 = Non-state conflict, 3 = One-sided violence
_TYPE_MAP: dict[int, EventType] = {
    1: EventType.CONFLIT,
    2: EventType.CONFLIT,
    3: EventType.CONFLIT,
}

# UCDP province name → p_code (Est RDC prioritaire)
_UCDP_PROVINCE_MAP: dict[str, str] = {
    "north kivu": "CD61", "nord-kivu": "CD61",
    "south kivu": "CD62", "sud-kivu": "CD62",
    "ituri":      "CD54",
    "maniema":    "CD63",
    "tanganyika": "CD74",
    "haut-lomami": "CD73",
    "lomami":     "CD81",
    "sankuru":    "CD85",
    "tshopo":     "CD51",
    "haut-katanga": "CD71",
    "lualaba":    "CD72",
    "kasai oriental": "CD82", "kasai-oriental": "CD82",
    "kasai":      "CD83",
    "kasai central": "CD84",
    "bas-uele":   "CD52",
    "haut-uele":  "CD53",
    "equateur":   "CD41",
    "kinshasa":   "CD10",
}


def _last_365_days() -> str:
    from datetime import timedelta
    d = datetime.now(timezone.utc) - timedelta(days=365)
    return d.strftime("%Y-%m-%d")


class UCDPConnector(AbstractConnector):
    """
    UCDP Georeferenced Event Dataset.
    Sert à CONTRASTER ACLED : concordance des deux → fiabilité maximale.
    Fetch quotidien (UCDP publie des mises à jour hebdomadaires).
    """
    source_id = "ucdp_ged"
    fetch_interval_minutes = 1440  # quotidien
    max_retries = 3
    circuit_breaker_threshold = 3

    async def fetch(self) -> list[RawEvent]:
        params = {
            "Country": "490",           # DRC country_id
            "StartDate": _last_365_days(),
            "pagesize": 1000,
            "page": 1,
        }
        all_rows: list[dict] = []
        now = datetime.now(timezone.utc)

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                while True:
                    resp = await client.get(_UCDP_BASE, params=params)
                    resp.raise_for_status()
                    data = resp.json()
                    rows = data.get("Result", [])
                    if not rows:
                        break
                    all_rows.extend(rows)
                    total = data.get("TotalCount", 0)
                    if len(all_rows) >= total:
                        break
                    params["page"] += 1  # type: ignore[operator]
        except Exception as exc:
            logger.error("ucdp_connector.fetch_error", error=str(exc))
            return []

        events = [
            RawEvent(source_id=self.source_id, external_id=str(r.get("id", "")), raw_data=r, fetched_at=now)
            for r in all_rows
        ]
        logger.info("ucdp_connector.fetch", count=len(events))
        return events

    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        d = raw.raw_data
        now = datetime.now(timezone.utc)

        # Province
        adm1 = (d.get("adm_1") or "").lower().strip()
        p_code: str | None = None
        province: str | None = d.get("adm_1") or None

        for key, pcode in _UCDP_PROVINCE_MAP.items():
            if key in adm1:
                p_code = pcode
                break
        if not p_code:
            for prov_name, pcode in PROVINCE_PCODE_MAP.items():
                if prov_name.lower() in adm1 or adm1 in prov_name.lower():
                    p_code = pcode
                    province = prov_name
                    break

        # Coordonnées
        coords: tuple[float, float] | None = None
        try:
            lat = float(d.get("latitude") or 0)
            lon = float(d.get("longitude") or 0)
            if lat or lon:
                coords = (lon, lat)
        except (ValueError, TypeError):
            pass

        # Décès vérifiés (3 estimations UCDP)
        fat_low  = int(d.get("low")  or 0)
        fat_best = int(d.get("best") or 0)
        fat_high = int(d.get("high") or fat_best)

        # Sévérité basée sur best estimate
        severity = 2 if fat_best == 0 else 3 if fat_best < 5 else 4 if fat_best < 20 else 5

        # Acteurs
        side_a = d.get("side_a", "") or ""
        side_b = d.get("side_b", "") or ""
        actors_str = f"{side_a}" + (f" vs {side_b}" if side_b else "")

        type_viol = int(d.get("type_of_violence") or 1)
        event_type = _TYPE_MAP.get(type_viol, EventType.CONFLIT)

        # Date
        date_str = d.get("date_start") or d.get("date_end") or ""
        try:
            fetched_at = datetime.fromisoformat(date_str[:10]).replace(tzinfo=timezone.utc) if date_str else now
        except ValueError:
            fetched_at = now

        title = (
            f"[UCDP] Violence {'étatique' if type_viol == 1 else 'non-étatique' if type_viol == 2 else 'unilatérale'}"
            + (f" — {province}" if province else "")
            + (f" ({actors_str})" if actors_str.strip() else "")
        )
        desc = d.get("source_article") or d.get("source_original") or None
        if fat_best:
            fat_note = f"Décès vérifiés : {fat_best} (estimation basse {fat_low} / haute {fat_high})."
            desc = f"{fat_note} {desc}" if desc else fat_note

        return CanonicalEvent(
            source_id=self.source_id,
            external_id=raw.external_id,
            event_type=event_type,
            title=title[:500],
            description=desc,
            p_code=p_code,
            province=province,
            coordinates=coords,
            severity=severity,
            source_url="https://ucdp.uu.se/exploratory",
            raw_data=raw.raw_data,
            fetched_at=fetched_at,
            reliability_score=0.94,  # le plus rigoureux en termes de décès
            sources_list=["ucdp_ged"],
            fatalities_low=fat_low,
            fatalities_high=fat_high,
        )
