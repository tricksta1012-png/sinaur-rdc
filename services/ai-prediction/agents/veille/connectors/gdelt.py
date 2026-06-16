"""
GDELT DOC 2.0 connector — Détection temps quasi-réel (15 min) sur des milliers de médias.

Rôle dans SINAUR : SIGNAL PRÉCOCE uniquement.
  - Détecte les incidents AVANT les bases structurées (ACLED, UCDP)
  - Beaucoup de bruit → filtrage agressif + marqueur needs_corroboration=True
  - Un événement GDELT seul ne déclenche PAS d'alerte ; il devient fiable
    dès confirmation par ACLED, UCDP ou source institutionnelle.

API publique — pas de clé requise.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

import httpx
import structlog

from agents.veille.connectors.base import AbstractConnector
from schemas.events import CanonicalEvent, EventType, RawEvent

logger = structlog.get_logger(__name__)

_GDELT_DOC = "https://api.gdeltproject.org/api/v2/doc/doc"

# Mots-clés conflit ciblant la RDC
_QUERY = (
    'sourcecountry:CD ('
    'conflict OR attack OR "armed group" OR militia OR displacement OR '
    '"M23" OR "FDLR" OR "ADF" OR "CODECO" OR "Kivu" OR "Ituri" OR "MONUSCO"'
    ')'
)

# Provinces RDC reconnaissables dans les titres d'articles
_PROVINCE_KEYWORDS: list[tuple[str, str, str]] = [
    # (keyword_lower, province_name, p_code)
    ("nord-kivu",    "Nord-Kivu",       "CD61"),
    ("north kivu",   "Nord-Kivu",       "CD61"),
    ("goma",         "Nord-Kivu",       "CD61"),
    ("beni",         "Nord-Kivu",       "CD61"),
    ("rutshuru",     "Nord-Kivu",       "CD61"),
    ("masisi",       "Nord-Kivu",       "CD61"),
    ("sud-kivu",     "Sud-Kivu",        "CD62"),
    ("south kivu",   "Sud-Kivu",        "CD62"),
    ("bukavu",       "Sud-Kivu",        "CD62"),
    ("uvira",        "Sud-Kivu",        "CD62"),
    ("ituri",        "Ituri",           "CD54"),
    ("bunia",        "Ituri",           "CD54"),
    ("djugu",        "Ituri",           "CD54"),
    ("maniema",      "Maniema",         "CD63"),
    ("tanganyika",   "Tanganyika",      "CD74"),
    ("kalemie",      "Tanganyika",      "CD74"),
    ("haut-lomami",  "Haut-Lomami",     "CD73"),
    ("lomami",       "Lomami",          "CD81"),
    ("sankuru",      "Sankuru",         "CD85"),
    ("tshopo",       "Tshopo",          "CD51"),
    ("kasai",        "Kasaï",           "CD83"),
    ("katanga",      "Haut-Katanga",    "CD71"),
    ("lubumbashi",   "Haut-Katanga",    "CD71"),
    ("kinshasa",     "Kinshasa",        "CD10"),
    ("equateur",     "Équateur",        "CD41"),
    ("équateur",     "Équateur",        "CD41"),
]

# Mots-clés très génériques à exclure (réduire le bruit)
_NOISE_PATTERNS = re.compile(
    r'\b(weather|sport|football|election|economy|business|market|trade|oil|bank)\b',
    re.IGNORECASE,
)


def _extract_province(title: str) -> tuple[str, str] | None:
    """Extrait (province_name, p_code) depuis le titre d'un article."""
    title_lower = title.lower()
    for keyword, prov_name, p_code in _PROVINCE_KEYWORDS:
        if keyword in title_lower:
            return (prov_name, p_code)
    return None


class GDELTConnector(AbstractConnector):
    """
    GDELT DOC 2.0 — signal précoce conflit RDC.
    Fiabilité volontairement basse (0.70) — beaucoup de bruit.
    Tous les événements marqués needs_corroboration=True.
    """
    source_id = "gdelt"
    fetch_interval_minutes = 30
    max_retries = 2
    circuit_breaker_threshold = 5

    async def fetch(self) -> list[RawEvent]:
        params = {
            "query":      _QUERY,
            "mode":       "artlist",
            "format":     "json",
            "timespan":   "1d",
            "maxrecords": "250",
            "sort":       "DateDesc",
        }
        now = datetime.now(timezone.utc)

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(_GDELT_DOC, params=params)
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            logger.error("gdelt_connector.fetch_error", error=str(exc))
            return []

        articles = data.get("articles", [])
        events: list[RawEvent] = []
        for article in articles:
            title = article.get("title", "") or ""
            # Filtrage anti-bruit agressif
            if not title or _NOISE_PATTERNS.search(title):
                continue
            if not _extract_province(title):
                continue  # pas localisable en RDC → ignorer
            events.append(RawEvent(
                source_id=self.source_id,
                external_id=article.get("url", "")[:200],
                raw_data=article,
                fetched_at=now,
            ))

        logger.info("gdelt_connector.fetch", total_articles=len(articles), filtered=len(events))
        return events

    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        d = raw.raw_data
        now = datetime.now(timezone.utc)

        title   = d.get("title", "") or "Incident signalé (GDELT)"
        url     = d.get("url") or None
        date_str= d.get("seendate") or d.get("pubdate") or ""

        # Localisation
        loc = _extract_province(title)
        province = loc[0] if loc else None
        p_code   = loc[1] if loc else None

        # Date
        try:
            # GDELT format : "20241215T120000Z" ou ISO
            clean = re.sub(r"T\d{6}Z$", "", date_str).replace("T", " ")[:10]
            fetched_at = datetime.fromisoformat(clean).replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            fetched_at = now

        return CanonicalEvent(
            source_id=self.source_id,
            external_id=raw.external_id,
            event_type=EventType.CONFLIT,
            title=f"[GDELT·Signal] {title[:200]}",
            description=f"Source: {d.get('sourcecountry','')}, domaine: {d.get('domain','')}. "
                        "⚠ Signal précoce non confirmé — à corroborer avant décision.",
            p_code=p_code,
            province=province,
            coordinates=None,  # GDELT DOC ne fournit pas de coordonnées
            severity=2,        # conservateur par défaut
            source_url=url,
            raw_data=raw.raw_data,
            fetched_at=fetched_at,
            reliability_score=0.70,
            sources_list=["gdelt"],
            needs_corroboration=True,  # ⚠ SIGNAL PRÉCOCE — doit être confirmé
        )
