"""
Kivu Security Tracker (KST) connector — incidents armés Est RDC.

Projet Human Rights Watch + Groupe d'Étude sur le Congo (NYU).
Source la plus précise pour cartographier les groupes armés en
Nord-Kivu, Sud-Kivu et Ituri — exactement les zones critiques de SINAUR.

Données publiques : https://kivusecurity.org/data/
Le connecteur essaie l'API KST, puis un export GitHub si disponible.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import structlog

from agents.veille.connectors.base import AbstractConnector
from schemas.events import CanonicalEvent, EventType, RawEvent

logger = structlog.get_logger(__name__)

# Endpoints KST (ordre de priorité)
_KST_ENDPOINTS = [
    "https://kivusecurity.org/api/v1/incidents",
    "https://kivusecurity.org/api/incidents",
    "https://raw.githubusercontent.com/kivusecurity/data/main/incidents.json",
]

# Mapping type d'incident KST → sévérité
_SEVERITY_MAP: dict[str, int] = {
    "massacre":           5,
    "mass atrocity":      5,
    "combat":             4,
    "battle":             4,
    "armed clash":        4,
    "attack":             4,
    "ambush":             4,
    "abduction":          3,
    "kidnapping":         3,
    "looting":            3,
    "displacement":       3,
    "movement of troops": 2,
    "checkpoint":         2,
}

_KST_PROVINCES = {
    "nord-kivu": ("Nord-Kivu", "CD61"),
    "north kivu": ("Nord-Kivu", "CD61"),
    "sud-kivu": ("Sud-Kivu", "CD62"),
    "south kivu": ("Sud-Kivu", "CD62"),
    "ituri": ("Ituri", "CD54"),
    "maniema": ("Maniema", "CD63"),
    "tanganyika": ("Tanganyika", "CD74"),
}


def _since_30_days() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")


class KivuSecurityTrackerConnector(AbstractConnector):
    """
    KST — spécialisé Nord-Kivu, Sud-Kivu, Ituri.
    Identifie précisément les groupes armés et leurs zones de contrôle.
    """
    source_id = "kivu_security_tracker"
    fetch_interval_minutes = 720  # 2×/jour
    max_retries = 2
    circuit_breaker_threshold = 3

    async def fetch(self) -> list[RawEvent]:
        now = datetime.now(timezone.utc)
        params = {"from": _since_30_days(), "format": "json"}

        for endpoint in _KST_ENDPOINTS:
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.get(endpoint, params=params)
                    if resp.status_code == 200:
                        data = resp.json()
                        incidents = data if isinstance(data, list) else data.get("incidents", data.get("data", []))
                        events = [
                            RawEvent(
                                source_id=self.source_id,
                                external_id=str(inc.get("id", "") or inc.get("incident_id", "")),
                                raw_data=inc,
                                fetched_at=now,
                            )
                            for inc in incidents
                            if isinstance(inc, dict)
                        ]
                        logger.info("kst_connector.fetch", endpoint=endpoint, count=len(events))
                        return events
            except Exception as exc:
                logger.debug("kst_connector.endpoint_failed", endpoint=endpoint, error=str(exc))
                continue

        # Fallback : retourner liste vide (KST peut ne pas avoir d'API publique stable)
        logger.warning(
            "kst_connector.no_data",
            reason="Aucun endpoint KST accessible. Activer manuellement via kivusecurity.org/data/"
        )
        return []

    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        d = raw.raw_data
        now = datetime.now(timezone.utc)

        # Province
        prov_raw = (d.get("province") or d.get("admin1") or d.get("region") or "").lower()
        prov_tuple = next(
            (v for k, v in _KST_PROVINCES.items() if k in prov_raw),
            ("Est RDC", None),
        )
        province, p_code = prov_tuple

        # Coordonnées
        coords: tuple[float, float] | None = None
        try:
            lat = float(d.get("latitude") or d.get("lat") or 0)
            lon = float(d.get("longitude") or d.get("lng") or d.get("lon") or 0)
            if lat or lon:
                coords = (lon, lat)
        except (ValueError, TypeError):
            pass

        # Type et sévérité
        inc_type = (d.get("type") or d.get("incident_type") or d.get("category") or "").lower()
        severity = next(
            (s for kw, s in _SEVERITY_MAP.items() if kw in inc_type),
            3,  # default
        )

        # Acteurs (KST identifie précisément les groupes)
        perpetrator = d.get("perpetrator") or d.get("armed_group") or d.get("actor") or ""
        victims     = d.get("victims")     or d.get("target")     or ""
        fatalities  = int(d.get("deaths") or d.get("fatalities") or d.get("killed") or 0)

        # Date
        date_str = d.get("date") or d.get("event_date") or d.get("incident_date") or ""
        try:
            fetched_at = datetime.fromisoformat(date_str[:10]).replace(tzinfo=timezone.utc) if date_str else now
        except ValueError:
            fetched_at = now

        territoire = d.get("territory") or d.get("territoire") or d.get("admin2") or None
        loc_str = territoire or d.get("location") or d.get("village") or ""

        title = (
            f"[KST] {inc_type.title() or 'Incident'}"
            + (f" — {territoire or province}" if territoire or province else "")
            + (f" [{perpetrator}]" if perpetrator else "")
        )
        desc_parts = []
        if perpetrator:
            desc_parts.append(f"Auteur : {perpetrator}")
        if victims:
            desc_parts.append(f"Victimes : {victims}")
        if fatalities:
            desc_parts.append(f"Décès : {fatalities}")
        if loc_str:
            desc_parts.append(f"Lieu : {loc_str}")
        desc_parts.append("Source : Kivu Security Tracker (HRW + GEC/NYU)")

        return CanonicalEvent(
            source_id=self.source_id,
            external_id=raw.external_id or f"kst-{hash(title)}",
            event_type=EventType.CONFLIT,
            title=title[:500],
            description=". ".join(desc_parts),
            p_code=p_code,
            province=province,
            coordinates=coords,
            severity=severity,
            source_url="https://kivusecurity.org/map",
            raw_data=raw.raw_data,
            fetched_at=fetched_at,
            reliability_score=0.88,  # haute précision Est RDC
            sources_list=["kivu_security_tracker"],
        )
