"""
Source GDELT v2 DOC API — Global Database of Events, Language and Tone.
API publique, aucune clé requise, mise à jour toutes les 15 minutes.

Couvre la presse mondiale (100+ langues). Requête filtrée sur RDC + mots-clés conflit.
Retourne des articles de presse dont on extrait province, acteurs, sévérité.

URL confirmée : https://api.gdeltproject.org/api/v2/doc/doc
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import structlog

logger = structlog.get_logger(__name__)

_API_URL   = "https://api.gdeltproject.org/api/v2/doc/doc"
_TIMEOUT   = 25.0
_MAX_REC   = 250   # max autorisé par l'API

# Requêtes GDELT : on split en deux pour couvrir FR + EN
_QUERIES = [
    # Anglais — actualité RDC conflit
    'Congo DRC armed conflict militia attack "North Kivu" OR "South Kivu" OR "Ituri" OR "ADF" OR "M23"',
    # Français — presse francophone non couverte par les RSS existants
    '"Congo" "groupe armé" OR "milice" OR "affrontement" OR "attaque" OR "déplacés"',
]

# Fenêtre temporelle GDELT (format : NdayNhour — ex: "1month" ou "1week")
_TIMESPAN = "1month"

# Fiabilité relative (articles bruts, qualité variable)
_RELIABILITY = 0.62

# ── Mapping province ──────────────────────────────────────────────────────────
_PCODE_MAP: dict[str, tuple[str, str]] = {
    "north kivu":    ("CD61", "Nord-Kivu"),   "nord-kivu":   ("CD61", "Nord-Kivu"),
    "nord kivu":     ("CD61", "Nord-Kivu"),   "goma":        ("CD61", "Nord-Kivu"),
    "rutshuru":      ("CD61", "Nord-Kivu"),   "masisi":      ("CD61", "Nord-Kivu"),
    "beni":          ("CD61", "Nord-Kivu"),   "butembo":     ("CD61", "Nord-Kivu"),
    "walikale":      ("CD61", "Nord-Kivu"),   "lubero":      ("CD61", "Nord-Kivu"),
    "south kivu":    ("CD62", "Sud-Kivu"),    "sud-kivu":    ("CD62", "Sud-Kivu"),
    "bukavu":        ("CD62", "Sud-Kivu"),    "uvira":       ("CD62", "Sud-Kivu"),
    "fizi":          ("CD62", "Sud-Kivu"),    "shabunda":    ("CD62", "Sud-Kivu"),
    "ituri":         ("CD54", "Ituri"),       "bunia":       ("CD54", "Ituri"),
    "djugu":         ("CD54", "Ituri"),       "irumu":       ("CD54", "Ituri"),
    "maniema":       ("CD63", "Maniema"),     "kindu":       ("CD63", "Maniema"),
    "tanganyika":    ("CD74", "Tanganyika"),  "kalemie":     ("CD74", "Tanganyika"),
    "haut-katanga":  ("CD71", "Haut-Katanga"),"lubumbashi":  ("CD71", "Haut-Katanga"),
    "lualaba":       ("CD72", "Lualaba"),     "kolwezi":     ("CD72", "Lualaba"),
    "kinshasa":      ("CD10", "Kinshasa"),    "maluku":      ("CD10", "Kinshasa"),
    "kongo central": ("CD20", "Kongo-Central"),"kongo-central":("CD20","Kongo-Central"),
    "kwilu":         ("CD22", "Kwilu"),       "bandundu":    ("CD22", "Kwilu"),
    "mai-ndombe":    ("CD23", "Maï-Ndombe"),  "kwamouth":    ("CD23", "Maï-Ndombe"),
    "kasai":         ("CD83", "Kasaï"),       "tshopo":      ("CD51", "Tshopo"),
    "kisangani":     ("CD51", "Tshopo"),      "sankuru":     ("CD85", "Sankuru"),
}

_KNOWN_ACTORS = [
    "M23", "ADF", "FDLR", "CODECO", "Wazalendo", "Maï-Maï",
    "Twirwaneho", "APCLS", "FARDC", "RNDF", "Mobondo",
]

_CONFLICT_STRONG = {
    "killed", "massacre", "attack", "armed", "militia", "rebel", "combat",
    "affrontement", "massacre", "tués", "attaque", "milice", "armés",
    "ceasefire", "cessez-le-feu", "offensive", "frappe", "bombardement",
    "abduction", "enlèvement", "kidnapping", "civils",
}

_CONFLICT_SOFT = {
    "conflict", "fighting", "clashes", "troops", "displacement", "refugees",
    "conflit", "combats", "déplacés", "réfugiés", "insécurité", "forces",
}

_DRC_KEYWORDS = {
    "congo", "drc", "rdc", "democratic republic",
    "kivu", "ituri", "katanga", "kinshasa",
}


def _is_relevant(text: str) -> bool:
    lower = text.lower()
    if not any(kw in lower for kw in _DRC_KEYWORDS):
        return False
    if any(kw in lower for kw in _CONFLICT_STRONG):
        return True
    return sum(1 for kw in _CONFLICT_SOFT if kw in lower) >= 2


def _extract_province(text: str) -> tuple[str | None, str | None]:
    lower = text.lower()
    for kw, (pcode, name) in _PCODE_MAP.items():
        if kw in lower:
            return pcode, name
    return None, None


def _extract_actors(text: str) -> list[str]:
    return [a for a in _KNOWN_ACTORS if a.lower() in text.lower()]


def _severity(text: str) -> int:
    lower = text.lower()
    if any(w in lower for w in ["massacre", "bombardement", "frappe aérienne", "crimes de guerre"]):
        return 4
    if any(w in lower for w in ["killed", "tués", "attaque", "attack", "offensive", "combat"]):
        return 3
    if any(w in lower for w in ["clashes", "affrontement", "incursion", "tirs"]):
        return 2
    return 1


def _parse_gdelt_date(raw: str | None) -> str:
    """Parse GDELT seendate format : 20250711T120000Z"""
    if not raw:
        return datetime.now(timezone.utc).isoformat()
    try:
        return datetime.strptime(raw, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).isoformat()
    except ValueError:
        try:
            return datetime.fromisoformat(raw).isoformat()
        except ValueError:
            return datetime.now(timezone.utc).isoformat()


async def _query_gdelt(client: httpx.AsyncClient, query: str) -> list[dict]:
    """Lance une requête vers l'API GDELT DOC v2 et retourne les articles."""
    try:
        resp = await client.get(
            _API_URL,
            params={
                "query":      query,
                "mode":       "artlist",
                "format":     "json",
                "maxrecords": _MAX_REC,
                "sort":       "DateDesc",
                "timespan":   _TIMESPAN,
            },
            timeout=_TIMEOUT,
        )
        if resp.status_code != 200:
            logger.warning("gdelt.bad_status", status=resp.status_code, query=query[:60])
            return []
        data = resp.json()
        return data.get("articles", []) or []
    except Exception as exc:
        logger.warning("gdelt.query_failed", error=str(exc), query=query[:60])
        return []


async def fetch_gdelt_events(since_days: int = 30) -> list[dict]:
    """
    Interroge GDELT DOC API v2 pour les articles conflits RDC.
    Retourne une liste de dicts au format interne ConflitAgent.
    """
    events: list[dict] = []
    seen_urls: set[str] = set()

    async with httpx.AsyncClient(follow_redirects=True) as client:
        for query in _QUERIES:
            articles = await _query_gdelt(client, query)
            logger.info("gdelt.articles_fetched", count=len(articles), query=query[:60])

            for art in articles:
                url  = art.get("url", "")
                if not url:
                    continue
                if url in seen_urls:
                    continue
                seen_urls.add(url)

                title = art.get("title", "") or ""
                text  = f"{title} {art.get('domain', '')}"

                if not _is_relevant(text):
                    continue

                p_code, province = _extract_province(text)
                actors   = _extract_actors(text)
                sev      = _severity(text)
                dr       = 0.45 + (sev - 1) * 0.08

                # ID déterministe depuis l'URL
                ext_id = "gdelt:" + hashlib.md5(url.encode()).hexdigest()[:16]

                events.append({
                    "external_id":         ext_id,
                    "source":              "gdelt",
                    "event_date":          _parse_gdelt_date(art.get("seendate")),
                    "event_type":          "conflict",
                    "province":            province or "RDC",
                    "p_code":              p_code,
                    "severity":            sev,
                    "displacement_risk":   round(min(dr, 0.90), 3),
                    "territoire":          None,
                    "coordinates":         None,
                    "fatalities_reported": None,
                    "raw_notes":           title[:300] if title else None,
                    "source_url":          url,
                    "actor_names":         actors,
                    "reliability":         _RELIABILITY,
                    "sources_count":       1,
                })

    logger.info("gdelt.done", events=len(events))
    return events
