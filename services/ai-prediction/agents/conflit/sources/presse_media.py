"""Presse & médias — connecteur RSS multi-sources pour la surveillance des conflits RDC.

Sources :
  Presse congolaise (8) : Congo Autrement, Journal de Kinshasa, Matin Infos,
    Dépêche.cd, Congo Indépendant, ACP Congo, ActuRDC, CapsudNet
  Médias internationaux (3) : France24 Afrique, BBC Africa, BBC Health
"""
from __future__ import annotations

import asyncio
import re
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import httpx
import structlog

logger = structlog.get_logger(__name__)

# ── Flux RSS ──────────────────────────────────────────────────────────────────

SOURCES = [
    # (source_id, name, url, reliability)
    ("congo_autrement",   "Congo Autrement",    "https://congo-autrement.com/feed",    0.70),
    ("journal_kinshasa",  "Journal de Kinshasa","https://journaldekinshasa.com/feed",  0.72),
    ("matin_infos",       "Matin Infos",        "https://matininfos.net/feed",          0.68),
    ("depeche_cd",        "Dépêche.cd",         "https://depeche.cd/feed",              0.70),
    ("congo_independant", "Congo Indépendant",  "https://congoindependant.com/feed",   0.73),
    ("acp_congo",         "ACP Congo",          "https://fr.acpcongo.com/feed",         0.82),
    ("actu_rdc",          "ActuRDC",            "https://acturdc.com/feed",             0.68),
    ("capsud",            "CapsudNet",          "https://capsud.net/feed",              0.65),
    ("france24_afrique",  "France24 Afrique",   "https://www.france24.com/fr/afrique/rss", 0.78),
    ("bbc_africa",        "BBC Africa",         "https://feeds.bbci.co.uk/news/world/africa/rss.xml", 0.80),
]

# ── Mots-clés conflits ────────────────────────────────────────────────────────

CONFLICT_STRONG = {
    "m23", "afc/m23", "adf", "fdlr", "maï-maï", "wazalendo", "codeco", "apcls",
    "fardc", "rndf", "fdnb", "twirwaneho", "frpi",
    "massacre", "civils tués", "enlèvement", "kidnapping", "exactions",
    "bombardement", "frappe aérienne", "frappe au sol", "embuscade",
    "état de siège", "couvre-feu", "putsch", "coup d'état",
    "cessez-le-feu", "crimes de guerre", "crime contre l'humanité",
    "route coupée", "pont détruit", "hôpital attaqué",
    "killed", "attack", "armed group", "rebel", "militia",
}

CONFLICT_SOFT = {
    "forces armées", "groupe armé", "milice", "rébellion",
    "combat", "affrontement", "offensive", "opération militaire",
    "accrochage", "attaque", "incursion", "tirs",
    "assassinat", "pillage", "répression", "insécurité",
    "réfugiés", "personnes déplacées", "évacuation",
    "accord de paix", "médiation", "négociation de paix",
    "fighting", "clashes", "troops", "ceasefire", "displacement",
}

DRC_KEYWORDS = {
    "congo", "rdc", "drc", "kinshasa", "kivu", "ituri", "katanga",
    "goma", "bukavu", "bunia", "beni", "butembo",
}

EXCLUDED_CATEGORIES = {
    "sport", "sports", "football", "loisirs", "loisir", "culture",
    "musique", "cinéma", "mode", "people", "business",
    "économie", "finance", "technologie", "tech", "lifestyle",
}

# ── Géo-mapping ───────────────────────────────────────────────────────────────

PCODE_MAP: dict[str, tuple[str, str]] = {
    "nord-kivu": ("CD61", "Nord-Kivu"), "nord kivu": ("CD61", "Nord-Kivu"),
    "sud-kivu":  ("CD62", "Sud-Kivu"),  "sud kivu":  ("CD62", "Sud-Kivu"),
    "ituri":     ("CD54", "Ituri"),
    "maniema":   ("CD63", "Maniema"),
    "tanganyika":("CD74", "Tanganyika"),
    "haut-katanga": ("CD71", "Haut-Katanga"),
    "kinshasa":  ("CD10", "Kinshasa"),
    "haut-uele": ("CD53", "Haut-Uele"),
    "bas-uele":  ("CD52", "Bas-Uele"),
    "goma":      ("CD61", "Nord-Kivu"),
    "masisi":    ("CD61", "Nord-Kivu"),
    "rutshuru":  ("CD61", "Nord-Kivu"),
    "beni":      ("CD61", "Nord-Kivu"),
    "butembo":   ("CD61", "Nord-Kivu"),
    "walikale":  ("CD61", "Nord-Kivu"),
    "lubero":    ("CD61", "Nord-Kivu"),
    "bukavu":    ("CD62", "Sud-Kivu"),
    "uvira":     ("CD62", "Sud-Kivu"),
    "fizi":      ("CD62", "Sud-Kivu"),
    "bunia":     ("CD54", "Ituri"),
    "djugu":     ("CD54", "Ituri"),
    "lubumbashi":("CD71", "Haut-Katanga"),
}

KNOWN_ACTORS = [
    "M23", "AFC", "ADF", "FDLR", "CODECO", "Twirwaneho", "APCLS",
    "FARDC", "Wazalendo", "Maï-Maï", "FDNB", "FRPI", "RNDF",
]


def _is_relevant(text: str, categories: set[str]) -> bool:
    if categories & EXCLUDED_CATEGORIES:
        return False
    lower = text.lower()
    if not any(kw in lower for kw in DRC_KEYWORDS):
        return False
    if any(kw in lower for kw in CONFLICT_STRONG):
        return True
    return sum(1 for kw in CONFLICT_SOFT if kw in lower) >= 2


def _extract_pcode(text: str) -> tuple[str | None, str | None]:
    lower = text.lower()
    for name, (code, label) in PCODE_MAP.items():
        if name in lower:
            return code, label
    return None, None


def _extract_actors(text: str) -> list[str]:
    return [a for a in KNOWN_ACTORS if a.lower() in text.lower()]


def _severity_from_text(text: str) -> int:
    lower = text.lower()
    if any(kw in lower for kw in ["massacre", "crimes de guerre", "bombardement", "frappe aérienne"]):
        return 4
    if any(kw in lower for kw in ["combat", "affrontement", "offensive", "embuscade", "attaque"]):
        return 3
    if any(kw in lower for kw in ["insécurité", "tirs", "accrochage", "incursion"]):
        return 2
    return 1


async def _fetch_one(
    client: httpx.AsyncClient,
    source_id: str,
    name: str,
    url: str,
    reliability: float,
) -> list[dict]:
    events: list[dict] = []
    try:
        resp = await client.get(url, headers={"User-Agent": "SINAUR-RDC/1.0"},
                                timeout=15.0, follow_redirects=True)
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
        items = root.findall("channel/item") or root.findall(".//item")

        for item in items[:30]:
            title = (item.findtext("title") or "").strip()
            desc  = re.sub(r"<[^>]+>", "", item.findtext("description") or "")
            link  = (item.findtext("link") or "").strip()
            pub   = item.findtext("pubDate") or datetime.now(timezone.utc).isoformat()
            categories = {(c.text or "").strip().lower() for c in item.findall("category")}
            combined = f"{title} {desc}"

            if not _is_relevant(combined, categories):
                continue

            p_code, province = _extract_pcode(combined)
            severity = _severity_from_text(combined)

            events.append({
                "external_id":       link or f"{source_id}-{hash(title)}",
                "source":            source_id,
                "event_date":        pub,
                "event_type":        "conflict",
                "province":          province,
                "p_code":            p_code,
                "severity":          severity,
                "displacement_risk": 0.55 + (severity - 1) * 0.10,
                "territoire":        None,
                "coordinates":       None,
                "fatalities_reported": None,
                "raw_notes":         desc[:500],
                "source_url":        link,
                "actor_names":       _extract_actors(combined),
                "reliability":       reliability,
            })

        logger.info("conflit.presse_media.fetched",
                    source=source_id, conflict_events=len(events))
    except Exception as exc:
        logger.warning("conflit.presse_media.failed", source=source_id, error=str(exc))
    return events


async def _fetch_telesud(client: httpx.AsyncClient) -> list[dict]:
    """Global Africa Telesud — scraping HTML de la page d'accueil (pas de RSS)."""
    events: list[dict] = []
    try:
        r = await client.get(
            "https://www.telesud.com/",
            headers={"User-Agent": "SINAUR-RDC/1.0"},
            timeout=20.0,
            follow_redirects=True,
        )
        r.raise_for_status()
        from lxml import html as lxml_html
        tree = lxml_html.fromstring(r.content)
        seen: set[str] = set()
        for a_tag in tree.xpath("//a[contains(@href, '/emissions/') or contains(@href, '/actualite')]"):
            href = (a_tag.get("href") or "").strip()
            if not href or href in seen:
                continue
            seen.add(href)
            h3_nodes = a_tag.xpath(".//h3")
            title = (h3_nodes[0].text_content() if h3_nodes else a_tag.text_content()).strip()
            if not title or len(title) < 15:
                continue
            url = f"https://www.telesud.com{href}" if href.startswith("/") else href
            combined = title.lower()
            if not _is_relevant(combined, set()):
                continue
            p_code, province = _extract_pcode(combined)
            severity = _severity_from_text(combined)
            events.append({
                "external_id":        url,
                "source":             "telesud",
                "event_date":         datetime.now(timezone.utc).isoformat(),
                "event_type":         "conflict",
                "province":           province,
                "p_code":             p_code,
                "severity":           severity,
                "displacement_risk":  0.55 + (severity - 1) * 0.10,
                "territoire":         None,
                "coordinates":        None,
                "fatalities_reported": None,
                "raw_notes":          title[:500],
                "source_url":         url,
                "actor_names":        _extract_actors(combined),
                "reliability":        0.67,
            })
        logger.info("conflit.telesud.fetched", conflict_events=len(events))
    except Exception as exc:
        logger.warning("conflit.telesud.failed", error=str(exc))
    return events


async def fetch_presse_media_events() -> list[dict]:
    """Collecte en parallèle les conflits depuis la presse congolaise, médias internationaux et Telesud."""
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(
            *[_fetch_one(client, sid, name, url, rel) for sid, name, url, rel in SOURCES],
            _fetch_telesud(client),
            return_exceptions=False,
        )
    events: list[dict] = []
    for batch in results:
        events.extend(batch)
    logger.info("conflit.presse_media.total", count=len(events), sources=len(SOURCES) + 1)
    return events
