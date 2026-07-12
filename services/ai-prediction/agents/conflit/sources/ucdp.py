"""
Source UCDP GED — Uppsala Conflict Data Program.
API publique, aucune clé requise.

L'URL contient un numéro de version qui change chaque année (ex: 23.1, 24.1, 25.1).
Ce module sonde automatiquement les versions récentes jusqu'à en trouver une active.

Décalage typique : 1–3 mois (données académiques vérifiées).
Pour le temps réel, utiliser gdelt.py en complément.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import structlog

logger = structlog.get_logger(__name__)

_BASE        = "https://ucdpapi.pcr.uu.se/api/gedevents"
_COUNTRY_ID  = 490      # Code Gleditsch-Ward de la RDC
_PAGE_SIZE   = 200
_TIMEOUT     = 20.0
_MAX_PAGES   = 5
_RELIABILITY = 0.88

# Versions à sonder, de la plus récente à la plus ancienne
_VERSIONS_TO_TRY = ["25.1", "24.1", "23.1", "22.1"]

_VIOLENCE_TYPE: dict[int, str] = {
    1: "conflict",
    2: "conflict",
    3: "violence_civilians",
}

_ADM1_TO_PCODE: dict[str, tuple[str, str]] = {
    "north kivu":    ("CD61", "Nord-Kivu"),   "nord-kivu":     ("CD61", "Nord-Kivu"),
    "south kivu":    ("CD62", "Sud-Kivu"),    "sud-kivu":      ("CD62", "Sud-Kivu"),
    "ituri":         ("CD54", "Ituri"),       "maniema":       ("CD63", "Maniema"),
    "tanganyika":    ("CD74", "Tanganyika"),  "haut-katanga":  ("CD71", "Haut-Katanga"),
    "haut katanga":  ("CD71", "Haut-Katanga"),"lualaba":       ("CD72", "Lualaba"),
    "haut-lomami":   ("CD73", "Haut-Lomami"), "kinshasa":      ("CD10", "Kinshasa"),
    "kongo central": ("CD20", "Kongo-Central"),"kwango":       ("CD21", "Kwango"),
    "kwilu":         ("CD22", "Kwilu"),       "mai-ndombe":    ("CD23", "Maï-Ndombe"),
    "equateur":      ("CD41", "Équateur"),    "sud-ubangi":    ("CD42", "Sud-Ubangi"),
    "nord-ubangi":   ("CD43", "Nord-Ubangi"), "mongala":       ("CD44", "Mongala"),
    "tshuapa":       ("CD45", "Tshuapa"),     "tshopo":        ("CD51", "Tshopo"),
    "bas-uele":      ("CD52", "Bas-Uélé"),    "haut-uele":     ("CD53", "Haut-Uélé"),
    "lomami":        ("CD81", "Lomami"),      "kasai-oriental":("CD82", "Kasaï-Oriental"),
    "kasai":         ("CD83", "Kasaï"),       "kasai-central": ("CD84", "Kasaï-Central"),
    "sankuru":       ("CD85", "Sankuru"),
}


async def _probe_working_version(client: httpx.AsyncClient) -> str | None:
    """Sonde les versions UCDP jusqu'à trouver une URL active."""
    for version in _VERSIONS_TO_TRY:
        url = f"{_BASE}/{version}"
        try:
            resp = await client.get(url, params={"pagesize": 1, "Country": _COUNTRY_ID}, timeout=10.0)
            if resp.status_code == 200:
                logger.info("ucdp.version_found", version=version)
                return url
        except Exception:
            continue
    logger.warning("ucdp.no_working_version", tried=_VERSIONS_TO_TRY)
    return None


def _map_province(adm1: str | None) -> tuple[str | None, str | None]:
    if not adm1:
        return None, None
    return _ADM1_TO_PCODE.get(adm1.lower().strip(), (None, None))


def _severity(deaths: int) -> int:
    if deaths == 0: return 1
    if deaths < 5:  return 2
    if deaths < 20: return 3
    if deaths < 100:return 4
    return 5


def _disp_risk(vtype: int, sev: int, deaths: int) -> float:
    base = {3: 0.75, 1: 0.55}.get(vtype, 0.40)
    return round(min(base + (sev - 1) * 0.06 + min(deaths, 200) / 2000, 0.95), 3)


async def fetch_ucdp_events(since_days: int = 180) -> list[dict]:
    """Télécharge les événements UCDP GED pour la RDC. Retourne [] si l'API est inaccessible."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=since_days)).strftime("%Y-%m-%d")
    events: list[dict] = []
    seen: set[str] = set()

    async with httpx.AsyncClient(follow_redirects=True) as client:
        base_url = await _probe_working_version(client)
        if not base_url:
            return []

        for page in range(1, _MAX_PAGES + 1):
            try:
                resp = await client.get(
                    base_url,
                    params={"pagesize": _PAGE_SIZE, "page": page,
                            "Country": _COUNTRY_ID, "StartDate": cutoff},
                    timeout=_TIMEOUT,
                )
                resp.raise_for_status()
                payload = resp.json()
            except Exception as exc:
                logger.warning("ucdp.page_failed", page=page, error=str(exc))
                break

            results: list[dict] = payload.get("Result", [])
            if not results:
                break

            for r in results:
                eid = f"ucdp:{r.get('id') or uuid.uuid4()}"
                if eid in seen:
                    continue
                seen.add(eid)

                if int(r.get("where_prec") or 6) > 4:
                    continue

                try:
                    lon = float(r.get("longitude") or r.get("where_coordinates_lon") or 0)
                    lat = float(r.get("latitude")  or r.get("where_coordinates_lat") or 0)
                    coords: list[float] | None = [lon, lat] if (lon or lat) else None
                except (TypeError, ValueError):
                    coords = None

                p_code, province = _map_province(r.get("adm_1"))
                deaths = int(r.get("best") or 0)
                vtype  = int(r.get("type_of_violence") or 1)
                sev    = _severity(deaths)

                date_raw = r.get("date_start") or str(r.get("year", ""))
                try:
                    event_date = datetime.fromisoformat(date_raw).isoformat()
                except ValueError:
                    event_date = f"{date_raw[:4]}-01-01T00:00:00+00:00" if date_raw else datetime.now(timezone.utc).isoformat()

                actors = [s.strip() for s in [r.get("side_a"), r.get("side_b")] if s and s.lower() not in ("civilians", "unknown", "")]
                notes  = " — ".join(filter(None, [r.get("source_headline"), r.get("conflict_name")])) or None

                events.append({
                    "external_id":         eid,
                    "source":              "ucdp",
                    "event_date":          event_date,
                    "event_type":          _VIOLENCE_TYPE.get(vtype, "conflict"),
                    "province":            province or "RDC",
                    "p_code":              p_code,
                    "severity":            sev,
                    "displacement_risk":   _disp_risk(vtype, sev, deaths),
                    "territoire":          r.get("adm_2") or r.get("where_description"),
                    "coordinates":         coords,
                    "fatalities_reported": deaths or None,
                    "raw_notes":           notes,
                    "source_url":          None,
                    "actor_names":         actors,
                    "reliability":         _RELIABILITY,
                    "sources_count":       int(r.get("number_of_sources") or 1),
                })

            if page * _PAGE_SIZE >= int(payload.get("TotalCount", 0)):
                break

    logger.info("ucdp.done", events=len(events), since_days=since_days)
    return events
