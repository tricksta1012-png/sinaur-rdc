"""Presse congolaise — connecteur RSS multi-sources pour la veille sécuritaire RDC.

Sources actives (flux RSS vérifiés) :
  - Congo Autrement       https://congo-autrement.com/feed
  - Journal de Kinshasa   https://journaldekinshasa.com/feed
  - Matin Infos           https://matininfos.net/feed
  - Dépêche.cd            https://depeche.cd/feed
  - Congo Indépendant     https://congoindependant.com/feed
  - ACP Congo (officiel)  https://fr.acpcongo.com/feed
  - ActuRDC               https://acturdc.com/feed
  - CapsudNet             https://capsud.net/feed

Sources sans RSS (Next.js) ignorées : congosynthese.com, ouragan.cd, sangoyacongo.com
Radio Okapi géré séparément dans radio_okapi.py.
"""
from __future__ import annotations

import asyncio
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
import structlog

from ..schemas import IntelCategory, IntelEvent
from .kivu_morning_post import (
    PCODE_MAP,
    _classify,
    _extract_actors,
    _extract_pcode,
)

logger = structlog.get_logger(__name__)

# ── Mots-clés de filtrage ─────────────────────────────────────────────────────
# Tier 1 : un seul match suffit (termes très spécifiques à la sécurité RDC)
STRONG_KEYWORDS = {
    "m23", "afc/m23", "adf", "fdlr", "maï-maï", "wazalendo", "codeco", "apcls",
    "fardc", "rndf", "fdnb", "twirwaneho", "frpi",
    "massacre", "civils tués", "enlèvement", "kidnapping", "exactions",
    "blessés par balles", "tués par balles", "viols", "viol collectif",
    "bombardement", "frappe aérienne", "frappe au sol", "embuscade",
    "état de siège", "couvre-feu", "état d'urgence", "putsch", "coup d'état",
    "cessez-le-feu", "crimes de guerre", "crime contre l'humanité",
    "ebola", "mpox", "choléra", "épidémie mortelle",
    "crise humanitaire", "famine", "déplacés internes",
    "route coupée", "pont détruit", "hôpital attaqué",
}

# Tier 2 : 2 matches minimum (termes plus génériques)
SOFT_KEYWORDS = {
    "forces armées", "groupe armé", "milice", "rébellion", "armée",
    "combat", "affrontement", "offensive", "opération militaire",
    "accrochage", "attaque", "incursion", "tirs",
    "assassinat", "pillage", "répression", "insécurité",
    "réfugiés", "personnes déplacées", "évacuation", "déplacés",
    "accord de paix", "médiation", "sanctions", "négociation de paix",
    "aide humanitaire", "accès humanitaire",
}

SECURITY_KEYWORDS = STRONG_KEYWORDS | SOFT_KEYWORDS

# ── Catalogue des sources ─────────────────────────────────────────────────────

@dataclass
class RssSource:
    source_id: str
    name: str
    feed_url: str
    reliability: float
    max_items: int = 25


SOURCES: list[RssSource] = [
    RssSource("congo_autrement",    "Congo Autrement",    "https://congo-autrement.com/feed",     0.70),
    RssSource("journal_kinshasa",   "Journal de Kinshasa","https://journaldekinshasa.com/feed",   0.72),
    RssSource("matin_infos",        "Matin Infos",        "https://matininfos.net/feed",           0.68),
    RssSource("depeche_cd",         "Dépêche.cd",         "https://depeche.cd/feed",               0.70),
    RssSource("congo_independant",  "Congo Indépendant",  "https://congoindependant.com/feed",     0.73),
    RssSource("acp_congo",          "ACP Congo",          "https://fr.acpcongo.com/feed",          0.82),
    RssSource("actu_rdc",           "ActuRDC",            "https://acturdc.com/feed",              0.68),
    RssSource("capsud",             "CapsudNet",          "https://capsud.net/feed",               0.65),
]

NS_CONTENT = {"content": "http://purl.org/rss/1.0/modules/content/"}


# Catégories WordPress à exclure systématiquement
EXCLUDED_CATEGORIES = {
    "sport", "sports", "football", "loisirs", "loisir", "culture",
    "musique", "cinéma", "mode", "people", "people & stars",
    "business", "économie", "finance", "technologie", "tech",
    "international", "monde", "lifestyle",
}


def _is_relevant(text: str, categories: set[str]) -> bool:
    # Exclure les rubriques hors sécurité
    if categories & EXCLUDED_CATEGORIES:
        return False
    lower = text.lower()
    # Un seul mot-clé fort suffit
    if any(kw in lower for kw in STRONG_KEYWORDS):
        return True
    # Deux mots-clés mous minimum pour éviter les faux positifs
    soft_matches = sum(1 for kw in SOFT_KEYWORDS if kw in lower)
    return soft_matches >= 2


def _parse_feed(xml_text: str, source: RssSource) -> list[IntelEvent]:
    events: list[IntelEvent] = []
    try:
        root = ET.fromstring(xml_text)
        items = root.findall("channel/item")
        for item in items[: source.max_items]:
            title = (item.findtext("title") or "").strip()
            link  = (item.findtext("link") or "").strip()
            desc  = re.sub(r"<[^>]+>", "", item.findtext("description") or "")
            full  = re.sub(
                r"<[^>]+>",
                "",
                item.findtext("content:encoded", namespaces=NS_CONTENT) or desc,
            )
            pub = item.findtext("pubDate") or datetime.now(timezone.utc).isoformat()
            combined = f"{title} {full}"
            categories = {
                (c.text or "").strip().lower()
                for c in item.findall("category")
            }

            if not _is_relevant(combined, categories):
                continue

            pcode, province = _extract_pcode(combined)
            events.append(
                IntelEvent(
                    source_id=source.source_id,
                    external_id=link or f"{source.source_id}-{hash(title)}",
                    title=title,
                    date=pub,
                    content=full[:1000],
                    url=link,
                    reliability=source.reliability,
                    category=_classify(combined),
                    p_code=pcode,
                    province=province,
                    actor_names=_extract_actors(combined),
                )
            )
    except ET.ParseError as exc:
        logger.warning("presse_rdc.parse_error", source=source.source_id, error=str(exc))
    return events


async def _fetch_one(
    client: httpx.AsyncClient, source: RssSource
) -> list[IntelEvent]:
    try:
        resp = await client.get(
            source.feed_url,
            headers={"User-Agent": "SINAUR-RDC/1.0"},
            timeout=15.0,
            follow_redirects=True,
        )
        resp.raise_for_status()
        events = _parse_feed(resp.text, source)
        logger.info(
            "presse_rdc.fetched",
            source=source.source_id,
            total_items=resp.text.count("<item>"),
            security_events=len(events),
        )
        return events
    except Exception as exc:
        logger.warning("presse_rdc.fetch_failed", source=source.source_id, error=str(exc))
        return []


async def fetch_presse_rdc_events() -> list[IntelEvent]:
    """Collecte en parallèle tous les flux RSS de la presse congolaise."""
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(
            *[_fetch_one(client, src) for src in SOURCES],
            return_exceptions=False,
        )
    events: list[IntelEvent] = []
    for batch in results:
        events.extend(batch)
    logger.info("presse_rdc.total", count=len(events), sources=len(SOURCES))
    return events
