"""Kivu Morning Post — scraper RSS pour la veille sécuritaire Est-RDC.

Feed : https://kivumorningpost.com/feed/
Cadence : toutes les heures (mis à jour en continu par KMP).
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import httpx
import structlog

from ..schemas import IntelCategory, IntelEvent

logger = structlog.get_logger(__name__)

FEED_URL = "https://kivumorningpost.com/feed/"

# Provinces + territoires couverts par KMP
PCODE_MAP: dict[str, tuple[str, str]] = {
    # Provinces
    "nord-kivu":   ("CD61", "Nord-Kivu"),
    "nord kivu":   ("CD61", "Nord-Kivu"),
    "sud-kivu":    ("CD62", "Sud-Kivu"),
    "sud kivu":    ("CD62", "Sud-Kivu"),
    "ituri":       ("CD54", "Ituri"),
    "maniema":     ("CD63", "Maniema"),
    "tanganyika":  ("CD74", "Tanganyika"),
    "haut-katanga":("CD71", "Haut-Katanga"),
    "haut katanga":("CD71", "Haut-Katanga"),
    "kinshasa":    ("CD10", "Kinshasa"),
    "haut-uele":   ("CD53", "Haut-Uele"),
    "bas-uele":    ("CD52", "Bas-Uele"),
    # Villes / territoires fréquents dans KMP
    "goma":        ("CD61", "Nord-Kivu"),
    "masisi":      ("CD61", "Nord-Kivu"),
    "rutshuru":    ("CD61", "Nord-Kivu"),
    "beni":        ("CD61", "Nord-Kivu"),
    "butembo":     ("CD61", "Nord-Kivu"),
    "walikale":    ("CD61", "Nord-Kivu"),
    "lubero":      ("CD61", "Nord-Kivu"),
    "nyiragongo":  ("CD61", "Nord-Kivu"),
    "bukavu":      ("CD62", "Sud-Kivu"),
    "uvira":       ("CD62", "Sud-Kivu"),
    "fizi":        ("CD62", "Sud-Kivu"),
    "minembwe":    ("CD62", "Sud-Kivu"),
    "mwenga":      ("CD62", "Sud-Kivu"),
    "shabunda":    ("CD62", "Sud-Kivu"),
    "kalehe":      ("CD62", "Sud-Kivu"),
    "kabare":      ("CD62", "Sud-Kivu"),
    "lubumbashi":  ("CD71", "Haut-Katanga"),
    "kasumbalesa": ("CD71", "Haut-Katanga"),
    "bunia":       ("CD54", "Ituri"),
    "djugu":       ("CD54", "Ituri"),
    "irumu":       ("CD54", "Ituri"),
}

KEYWORDS_BY_CATEGORY: dict[IntelCategory, list[str]] = {
    IntelCategory.ACTIVITE_MILITAIRE: [
        "offensive", "opération militaire", "fardc", "combat", "affrontement",
        "bombardement", "frappe", "embuscade", "accrochage", "positions", "attaque",
        "m23", "afc", "adf", "fdlr", "maï-maï", "wazalendo", "apcls", "codeco",
        "twirwaneho", "rndf", "fnbdk", "fdnb", "offensif", "incursion", "repoussé",
        "mabomu", "hospitali", "vita",
    ],
    IntelCategory.DEPLACEMENT: [
        "déplacés", "fuite", "exode", "évacuation", "pdi", "retour",
        "réfugiés", "personnes déplacées", "ménages", "camp de déplacés",
        "mouvement de population", "déplacement massif",
    ],
    IntelCategory.INCIDENT_SECURITAIRE: [
        "enlèvement", "kidnapping", "assassinat", "massacre", "pillage",
        "violation", "civils tués", "exactions", "viols", "blessés par balles",
        "tués", "victimes civiles", "manifestation", "violence",
    ],
    IntelCategory.DOMMAGE_INFRASTRUCTURE: [
        "route coupée", "pont détruit", "hôpital attaqué", "école brûlée",
        "marché détruit", "infrastructure", "détruits", "incendié",
        "barricades", "courant électrique", "électricité coupée",
    ],
    IntelCategory.NEGOCIATION: [
        "cessez-le-feu", "accord", "négociation", "dialogue", "paix",
        "médiation", "processus de paix", "pourparlers", "trêve",
    ],
}

SECURITY_KEYWORDS = {kw for kws in KEYWORDS_BY_CATEGORY.values() for kw in kws}

NS = {
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc":      "http://purl.org/dc/elements/1.1/",
}


def _classify(text: str) -> IntelCategory:
    lower = text.lower()
    scores = {
        cat: sum(1 for kw in kws if kw in lower)
        for cat, kws in KEYWORDS_BY_CATEGORY.items()
    }
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else IntelCategory.AUTRE


def _extract_pcode(text: str) -> tuple[str | None, str | None]:
    lower = text.lower()
    for name, (code, label) in PCODE_MAP.items():
        if name in lower:
            return code, label
    return None, None


def _extract_actors(text: str) -> list[str]:
    known = [
        "M23", "AFC", "ADF", "FDLR", "CODECO", "Twirwaneho", "APCLS",
        "FARDC", "Wazalendo", "Maï-Maï", "FDNB", "FRPI", "RNDF",
    ]
    return [a for a in known if a.lower() in text.lower()]


def _is_relevant(text: str) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in SECURITY_KEYWORDS)


async def fetch_kmp_events() -> list[IntelEvent]:
    events: list[IntelEvent] = []
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(FEED_URL, headers={"User-Agent": "SINAUR-RDC/1.0"})
            resp.raise_for_status()
            root = ET.fromstring(resp.text)
            items = root.findall("channel/item")
            for item in items[:30]:
                title = (item.findtext("title") or "").strip()
                link  = (item.findtext("link") or "").strip()
                desc  = re.sub(r"<[^>]+>", "", item.findtext("description") or "")
                full  = re.sub(r"<[^>]+>", "", item.findtext("content:encoded", namespaces=NS) or desc)
                pub   = item.findtext("pubDate") or datetime.now(timezone.utc).isoformat()
                combined = f"{title} {full}"

                if not _is_relevant(combined):
                    continue

                pcode, province = _extract_pcode(combined)
                events.append(IntelEvent(
                    source_id="kivu_morning_post",
                    external_id=link or f"kmp-{hash(title)}",
                    title=title,
                    date=pub,
                    content=full[:1000],
                    url=link,
                    reliability=0.75,
                    category=_classify(combined),
                    p_code=pcode,
                    province=province,
                    actor_names=_extract_actors(combined),
                ))
    except Exception as exc:
        logger.warning("kmp_rss_fetch_failed", error=str(exc))
    return events
