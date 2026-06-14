"""Radio Okapi RSS scraper for security events."""
from __future__ import annotations
import httpx
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
import re
import structlog
from ..schemas import IntelEvent, IntelCategory

logger = structlog.get_logger(__name__)

FEED_URLS = [
    "https://www.radiookapi.net/category/securite/feed",
    "https://www.radiookapi.net/category/droits-de-lhomme/feed",
    # Fallback: main feed filtered client-side by keyword
    "https://www.radiookapi.net/feed",
]

PCODE_MAP = {
    "nord-kivu": "CD61", "nord kivu": "CD61",
    "sud-kivu": "CD62", "sud kivu": "CD62",
    "ituri": "CD54", "maniema": "CD63",
    "tanganyika": "CD74", "haut-uélé": "CD53", "haut-uele": "CD53",
    "bas-uélé": "CD52", "bas-uele": "CD52",
    "tshopo": "CD51", "haut-katanga": "CD71", "haut katanga": "CD71",
    "kasaï": "CD83", "kasai": "CD83", "kinshasa": "CD10",
}

KEYWORDS_BY_CATEGORY = {
    IntelCategory.ACTIVITE_MILITAIRE: [
        "offensive", "opération militaire", "fardc", "combat", "affrontement",
        "bombardement", "frappe", "embuscade", "accrochage", "positions", "attaque",
        "m23", "adf", "fdlr", "maï-maï", "codeco", "twirwaneho",
    ],
    IntelCategory.DEPLACEMENT: [
        "déplacés", "fuite", "exode", "évacuation", "pdi", "retour",
        "réfugiés", "personnes déplacées", "ménages",
    ],
    IntelCategory.INCIDENT_SECURITAIRE: [
        "enlèvement", "kidnapping", "assassinat", "massacre", "pillage",
        "violation", "civils tués", "exactions", "viols",
    ],
    IntelCategory.DOMMAGE_INFRASTRUCTURE: [
        "route coupée", "pont détruit", "hôpital attaqué", "école brûlée",
        "marché détruit", "infrastructure", "détruits",
    ],
    IntelCategory.NEGOCIATION: [
        "cessez-le-feu", "accord", "négociation", "dialogue", "paix",
        "médiation", "processus de paix",
    ],
}


def _classify(text: str) -> IntelCategory:
    lower = text.lower()
    scores = {cat: sum(1 for kw in kws if kw in lower)
              for cat, kws in KEYWORDS_BY_CATEGORY.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else IntelCategory.AUTRE


def _extract_pcode(text: str) -> tuple[str | None, str | None]:
    lower = text.lower()
    for name, code in PCODE_MAP.items():
        if name in lower:
            return code, name.title()
    return None, None


def _extract_actors(text: str) -> list[str]:
    known = ["M23", "AFC", "ADF", "FDLR", "CODECO", "Twirwaneho",
             "FARDC", "Maï-Maï", "WNBF", "FRPI"]
    found = [a for a in known if a.lower() in text.lower()]
    return found


async def fetch_okapi_events() -> list[IntelEvent]:
    events: list[IntelEvent] = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        for url in FEED_URLS:
            try:
                resp = await client.get(url, headers={"User-Agent": "SINAUR-RDC/1.0"})
                resp.raise_for_status()
                root = ET.fromstring(resp.text)
                ns = ""
                items = root.findall(f"{ns}channel/{ns}item")
                for item in items[:20]:
                    title = (item.findtext("title") or "").strip()
                    link = (item.findtext("link") or "").strip()
                    desc = re.sub(r"<[^>]+>", "", item.findtext("description") or "")
                    pub_date = item.findtext("pubDate") or datetime.now(timezone.utc).isoformat()
                    combined = f"{title} {desc}"
                    p_code, province = _extract_pcode(combined)
                    events.append(IntelEvent(
                        source_id="radio_okapi",
                        external_id=link or f"okapi-{hash(title)}",
                        title=title,
                        date=pub_date,
                        content=desc[:800],
                        url=link,
                        reliability=0.78,
                        category=_classify(combined),
                        p_code=p_code,
                        province=province,
                        actor_names=_extract_actors(combined),
                    ))
            except Exception as exc:
                logger.debug("okapi_fetch_failed", url=url, error=str(exc))
    return events
