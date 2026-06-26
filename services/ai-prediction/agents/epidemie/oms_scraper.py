"""
OmsScraperAgent — surveillance épidémique officielle pour la RDC.

Sources interrogées toutes les 4 heures :
  1. WHO Disease Outbreak News RSS  — flambées actives mondiales + DRC
  2. ReliefWeb API (Health / COD)   — sitreps OMS, UNICEF, MSF, INSP
  3. OCHA HDX API                   — datasets santé DRC structurés

Maladies surveillées :
  EBOLA · CHOLERA · MPOX · ROUGEOLE · MENINGITE · PALUDISME

Sorties DB :
  epidemic_timeseries  — courbe cumulative (upsert par maladie + date_rapport)
  epidemic_zone        — zones actives avec chiffres mis à jour (upsert par maladie + p_code)
"""
from __future__ import annotations

import re
import json
import asyncio
import xml.etree.ElementTree as ET
from datetime import datetime, date, timezone
from typing import Any

import httpx
import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import text

from agents import bus
from db import engine

logger = structlog.get_logger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

HEADERS = {
    "User-Agent": "SINAUR-RDC/2.0 (plateforme humanitaire RDC; contact@sinaur-rdc.cd)",
    "Accept": "application/json, application/xml, text/html",
}

WHO_DON_RSS    = "https://www.who.int/rss-feeds/news-en.xml"
RELIEFWEB_API  = "https://api.reliefweb.int/v1/reports"
HDX_API        = "https://data.humdata.org/api/3/action/package_search"

CDC_RSS        = "https://tools.cdc.gov/api/v2/resources/media/403372.rss"
FRANCE24_RSS   = "https://www.france24.com/fr/afrique/rss"
BBC_HEALTH_RSS = "https://feeds.bbci.co.uk/news/health/rss.xml"
BBC_AFRICA_RSS = "https://feeds.bbci.co.uk/news/world/africa/rss.xml"
TELESUD_URL    = "https://www.telesud.com/"

# ── Disease mapping ───────────────────────────────────────────────────────────

# Keywords → internal maladie code
DISEASE_KEYWORDS: list[tuple[str, list[str]]] = [
    ("EBOLA",      ["ebola", "fièvre hémorragique", "ebv", "bundibugyo", "sudan", "zaire ebolavirus"]),
    ("CHOLERA",    ["cholera", "choléra", "vibrio cholerae", "diarrhée aqueuse", "acute watery diarrhoea"]),
    ("MPOX",       ["mpox", "monkeypox", "variole du singe", "variole singe"]),
    ("ROUGEOLE",   ["measles", "rougeole", "rubeola"]),
    ("MENINGITE",  ["meningitis", "méningite", "meningococcal"]),
    ("PALUDISME",  ["malaria", "paludisme", "plasmodium", "anopheles"]),
    ("FIEVRE_JAUNE", ["fièvre jaune", "yellow fever", "fievre jaune", "flavivirus"]),
]

# DRC country filters (ReliefWeb / WHO)
DRC_KEYWORDS = ["congo", "drc", "rdc", "democratic republic", "kinshasa", "ituri", "kivu", "katanga"]

# Souche detection
SOUCHE_MAP = {
    "EBOLA": {
        "bundibugyo": "Bundibugyo",
        "sudan":      "Sudan",
        "zaire":      "Zaire",
        "tai forest": "Taï Forest",
    }
}

# ── Number extraction patterns ────────────────────────────────────────────────

# Matches "515 confirmed cases", "515 cas confirmés", "515 cas"
_CAS_PATTERNS = [
    re.compile(r'(\d[\d\s,]*)\s+confirmed\s+cases?', re.I),
    re.compile(r'(\d[\d\s,]*)\s+cas\s+confirm[eé]s?', re.I),
    re.compile(r'total\s+(?:of\s+)?(\d[\d\s,]*)\s+cases?', re.I),
    re.compile(r'(\d[\d\s,]*)\s+cas\b', re.I),
]
_DECES_PATTERNS = [
    re.compile(r'(\d[\d\s,]*)\s+(?:confirmed\s+)?deaths?', re.I),
    re.compile(r'(\d[\d\s,]*)\s+d[eé]c[eè]s', re.I),
    re.compile(r'(\d[\d\s,]*)\s+mortalit[eé]s?', re.I),
]
_ZONES_PATTERNS = [
    re.compile(r'(\d+)\s+health\s+zones?', re.I),
    re.compile(r'(\d+)\s+zones?\s+de\s+sant[eé]', re.I),
    re.compile(r'(\d+)\s+areas?', re.I),
]
_SUSPECTS_PATTERNS = [
    re.compile(r'(\d[\d\s,]*)\s+suspected?\s+cases?', re.I),
    re.compile(r'(\d[\d\s,]*)\s+cas\s+suspects?', re.I),
]


def _extract_int(patterns: list[re.Pattern], text: str) -> int | None:
    for pat in patterns:
        m = pat.search(text)
        if m:
            raw = m.group(1).replace(",", "").replace(" ", "")
            try:
                return int(raw)
            except ValueError:
                continue
    return None


def _detect_disease(text_lower: str) -> str | None:
    for maladie, keywords in DISEASE_KEYWORDS:
        if any(kw in text_lower for kw in keywords):
            return maladie
    return None


def _detect_souche(maladie: str, text_lower: str) -> str | None:
    mapping = SOUCHE_MAP.get(maladie, {})
    for kw, souche in mapping.items():
        if kw in text_lower:
            return souche
    return None


def _is_drc_relevant(text_lower: str) -> bool:
    return any(kw in text_lower for kw in DRC_KEYWORDS)


# ── In-memory status store ────────────────────────────────────────────────────

_SCRAPER_STATUS: dict[str, Any] = {
    "last_run": None,
    "last_success": None,
    "runs_total": 0,
    "zones_updated": 0,
    "timeseries_updated": 0,
    "errors": [],
    "last_results": {},
}


# ── Database helpers ──────────────────────────────────────────────────────────

async def _upsert_timeseries(
    maladie: str,
    souche: str | None,
    date_rapport: date,
    cas_confirmes: int,
    cas_suspects: int,
    deces_confirmes: int,
    source: str,
) -> bool:
    """Upsert a timeseries row. Returns True if updated/inserted."""
    async with engine.begin() as conn:
        # Check existing
        row = (await conn.execute(
            text("SELECT id, cas_confirmes_cumul FROM epidemic_timeseries WHERE maladie = :m AND date_rapport = :d"),
            {"m": maladie, "d": date_rapport},
        )).fetchone()

        if row:
            existing_cas = row[1]
            # Only update if numbers increased (monotonic epidemic curve)
            if cas_confirmes <= existing_cas:
                return False
            await conn.execute(
                text("""
                    UPDATE epidemic_timeseries
                    SET cas_confirmes_cumul   = :cas,
                        cas_suspects_cumul    = :suspects,
                        deces_confirmes_cumul = :deces,
                        source                = :src
                    WHERE maladie = :m AND date_rapport = :d
                """),
                {"cas": cas_confirmes, "suspects": cas_suspects, "deces": deces_confirmes,
                 "src": source, "m": maladie, "d": date_rapport},
            )
        else:
            await conn.execute(
                text("""
                    INSERT INTO epidemic_timeseries
                        (maladie, souche, date_rapport,
                         cas_confirmes_cumul, cas_suspects_cumul, deces_confirmes_cumul,
                         deces_suspects_cumul, nouvelles_zones, source)
                    VALUES
                        (:m, :souche, :d, :cas, :suspects, :deces, 0, 0, :src)
                """),
                {"m": maladie, "souche": souche, "d": date_rapport,
                 "cas": cas_confirmes, "suspects": cas_suspects,
                 "deces": deces_confirmes, "src": source},
            )
    return True


async def _upsert_zone(
    maladie: str,
    souche: str | None,
    zone_sante: str,
    territoire: str,
    province: str,
    p_code: str,
    lon: float,
    lat: float,
    cas_confirmes: int,
    cas_suspects: int,
    deces_confirmes: int,
    source: str,
) -> bool:
    """Upsert a zone row by (maladie, p_code). Returns True if changed."""
    async with engine.begin() as conn:
        row = (await conn.execute(
            text("SELECT id, cas_confirmes FROM epidemic_zone WHERE maladie = :m AND p_code = :p"),
            {"m": maladie, "p": p_code},
        )).fetchone()

        if row:
            if cas_confirmes <= row[1]:
                return False
            await conn.execute(
                text("""
                    UPDATE epidemic_zone
                    SET cas_confirmes        = :cas,
                        cas_suspects         = :suspects,
                        deces_confirmes      = :deces,
                        derniere_mise_a_jour = NOW(),
                        source               = :src
                    WHERE maladie = :m AND p_code = :p
                """),
                {"cas": cas_confirmes, "suspects": cas_suspects, "deces": deces_confirmes,
                 "src": source, "m": maladie, "p": p_code},
            )
        else:
            await conn.execute(
                text("""
                    INSERT INTO epidemic_zone
                        (maladie, souche, zone_sante, territoire, province, p_code,
                         coordinates, cas_confirmes, cas_suspects, deces_confirmes,
                         deces_suspects, statut, date_premier_cas,
                         derniere_mise_a_jour, groupes_armes_actifs, acces_humanitaire, source)
                    VALUES
                        (:m, :souche, :zone, :territoire, :province, :p,
                         ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
                         :cas, :suspects, :deces,
                         0, 'ACTIF', CURRENT_DATE,
                         NOW(), '{}', 'BON', :src)
                """),
                {"m": maladie, "souche": souche, "zone": zone_sante,
                 "territoire": territoire, "province": province, "p": p_code,
                 "lon": lon, "lat": lat,
                 "cas": cas_confirmes, "suspects": cas_suspects, "deces": deces_confirmes,
                 "src": source},
            )
    return True


# ── Source 1: WHO DON RSS ─────────────────────────────────────────────────────

async def _fetch_who_don(client: httpx.AsyncClient) -> list[dict]:
    """
    Parse the WHO Disease Outbreak News RSS feed.
    Filters for DRC-relevant outbreaks and extracts metadata.
    """
    results = []
    try:
        r = await client.get(WHO_DON_RSS, timeout=30)
        r.raise_for_status()
        root = ET.fromstring(r.content)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        items = root.findall(".//item") or root.findall(".//atom:entry", ns)

        for item in items[:30]:
            title = (item.findtext("title") or "").strip()
            desc  = (item.findtext("description") or item.findtext("summary") or "").strip()
            link  = (item.findtext("link") or "").strip()
            pub   = item.findtext("pubDate") or item.findtext("updated") or ""

            combined = f"{title} {desc}".lower()
            if not _is_drc_relevant(combined):
                continue

            maladie = _detect_disease(combined)
            if not maladie:
                continue

            souche = _detect_souche(maladie, combined)
            cas     = _extract_int(_CAS_PATTERNS, desc)
            deces   = _extract_int(_DECES_PATTERNS, desc)
            suspects = _extract_int(_SUSPECTS_PATTERNS, desc)

            results.append({
                "source": "WHO-DON",
                "maladie": maladie,
                "souche": souche,
                "titre": title,
                "cas_confirmes": cas or 0,
                "cas_suspects": suspects or 0,
                "deces_confirmes": deces or 0,
                "url": link,
                "pub_date": pub,
            })
            logger.info("oms_scraper.who_don.match", maladie=maladie, titre=title[:80], cas=cas, deces=deces)

    except Exception as exc:
        logger.warning("oms_scraper.who_don.error", error=str(exc))

    return results


# ── Source 2: ReliefWeb Health Reports ───────────────────────────────────────

async def _fetch_reliefweb(client: httpx.AsyncClient) -> list[dict]:
    """
    Fetch latest DRC health situation reports from ReliefWeb API.
    Parses body text for case/death counts.
    """
    results = []
    try:
        payload = {
            "appname": "sinaur-rdc",
            "filter": {
                "operator": "AND",
                "conditions": [
                    {"field": "country.iso3", "value": "COD"},
                    {"field": "primary_type.name", "value": "Epidemic"},
                ],
            },
            "fields": {
                "include": ["title", "body", "date.created", "source.name"],
            },
            "sort": ["date.created:desc"],
            "limit": 20,
        }
        r = await client.post(RELIEFWEB_API, json=payload, timeout=30)
        r.raise_for_status()
        data = r.json()
        items = data.get("data", [])

        for item in items:
            fields = item.get("fields", {})
            title  = fields.get("title", "")
            body   = fields.get("body", "") or ""
            src    = (fields.get("source") or [{}])[0].get("name", "ReliefWeb")
            pub    = (fields.get("date") or {}).get("created", "")

            combined = f"{title} {body}".lower()
            maladie = _detect_disease(combined)
            if not maladie:
                continue
            if not _is_drc_relevant(combined):
                continue

            souche   = _detect_souche(maladie, combined)
            cas      = _extract_int(_CAS_PATTERNS, body)
            deces    = _extract_int(_DECES_PATTERNS, body)
            suspects = _extract_int(_SUSPECTS_PATTERNS, body)
            zones_n  = _extract_int(_ZONES_PATTERNS, body)

            results.append({
                "source": f"ReliefWeb/{src}",
                "maladie": maladie,
                "souche": souche,
                "titre": title,
                "cas_confirmes": cas or 0,
                "cas_suspects": suspects or 0,
                "deces_confirmes": deces or 0,
                "zones_count": zones_n,
                "pub_date": pub,
            })
            logger.info("oms_scraper.reliefweb.match",
                        maladie=maladie, titre=title[:80], cas=cas, deces=deces, zones=zones_n)

    except Exception as exc:
        logger.warning("oms_scraper.reliefweb.error", error=str(exc))

    return results


# ── Source 3: OCHA HDX ───────────────────────────────────────────────────────

async def _fetch_hdx(client: httpx.AsyncClient) -> list[dict]:
    """
    Search OCHA HDX for DRC health datasets (cholera, measles, etc.).
    Extracts latest counts from dataset metadata/descriptions.
    """
    results = []
    disease_queries = [
        ("CHOLERA",   "cholera DRC Congo"),
        ("ROUGEOLE",  "measles rougeole DRC Congo"),
        ("MPOX",      "mpox monkeypox DRC Congo"),
    ]
    try:
        for maladie, q in disease_queries:
            r = await client.get(
                HDX_API,
                params={"q": q, "rows": 5, "fq": "organization:who OR organization:unicef"},
                timeout=20,
            )
            r.raise_for_status()
            data = r.json()
            for pkg in (data.get("result") or {}).get("results", []):
                notes = (pkg.get("notes") or "")
                title = (pkg.get("title") or "")
                combined = f"{title} {notes}".lower()

                if not _is_drc_relevant(combined):
                    continue

                cas    = _extract_int(_CAS_PATTERNS, notes)
                deces  = _extract_int(_DECES_PATTERNS, notes)
                suspects = _extract_int(_SUSPECTS_PATTERNS, notes)
                if not cas:
                    continue

                results.append({
                    "source": "OCHA-HDX",
                    "maladie": maladie,
                    "souche": None,
                    "titre": title,
                    "cas_confirmes": cas,
                    "cas_suspects": suspects or 0,
                    "deces_confirmes": deces or 0,
                    "pub_date": pkg.get("metadata_modified", ""),
                })
                logger.info("oms_scraper.hdx.match", maladie=maladie, titre=title[:80], cas=cas)
                break  # one result per disease is enough

            await asyncio.sleep(1)

    except Exception as exc:
        logger.warning("oms_scraper.hdx.error", error=str(exc))

    return results


# ── Source 4: CDC Global Outbreak RSS ────────────────────────────────────────

async def _fetch_cdc(client: httpx.AsyncClient) -> list[dict]:
    """CDC Global Disease Outbreak News RSS — filtre DRC + maladies cibles."""
    results = []
    try:
        r = await client.get(CDC_RSS, timeout=20)
        r.raise_for_status()
        root = ET.fromstring(r.content)
        for item in root.findall(".//item")[:30]:
            title   = (item.findtext("title") or "").strip()
            desc    = re.sub(r"<[^>]+>", "", item.findtext("description") or "")
            link    = (item.findtext("link") or "").strip()
            pub     = item.findtext("pubDate") or ""
            combined = f"{title} {desc}".lower()

            if not _is_drc_relevant(combined):
                continue
            maladie = _detect_disease(combined)
            if not maladie:
                continue

            souche   = _detect_souche(maladie, combined)
            cas      = _extract_int(_CAS_PATTERNS, desc)
            deces    = _extract_int(_DECES_PATTERNS, desc)
            suspects = _extract_int(_SUSPECTS_PATTERNS, desc)

            results.append({
                "source": "CDC",
                "maladie": maladie,
                "souche": souche,
                "titre": title,
                "cas_confirmes": cas or 0,
                "cas_suspects": suspects or 0,
                "deces_confirmes": deces or 0,
                "url": link,
                "pub_date": pub,
            })
            logger.info("oms_scraper.cdc.match", maladie=maladie, titre=title[:80])
    except Exception as exc:
        logger.warning("oms_scraper.cdc.error", error=str(exc))
    return results


# ── Source 5: France24 Afrique RSS ───────────────────────────────────────────

async def _fetch_france24(client: httpx.AsyncClient) -> list[dict]:
    """France24 section Afrique — filtre DRC + maladies."""
    results = []
    try:
        r = await client.get(FRANCE24_RSS, timeout=20)
        r.raise_for_status()
        root = ET.fromstring(r.content)
        for item in root.findall(".//item")[:40]:
            title   = (item.findtext("title") or "").strip()
            desc    = re.sub(r"<[^>]+>", "", item.findtext("description") or "")
            link    = (item.findtext("link") or "").strip()
            pub     = item.findtext("pubDate") or ""
            combined = f"{title} {desc}".lower()

            if not _is_drc_relevant(combined):
                continue
            maladie = _detect_disease(combined)
            if not maladie:
                continue

            souche   = _detect_souche(maladie, combined)
            cas      = _extract_int(_CAS_PATTERNS, desc)
            deces    = _extract_int(_DECES_PATTERNS, desc)
            suspects = _extract_int(_SUSPECTS_PATTERNS, desc)

            results.append({
                "source": "France24",
                "maladie": maladie,
                "souche": souche,
                "titre": title,
                "cas_confirmes": cas or 0,
                "cas_suspects": suspects or 0,
                "deces_confirmes": deces or 0,
                "url": link,
                "pub_date": pub,
            })
            logger.info("oms_scraper.france24.match", maladie=maladie, titre=title[:80])
    except Exception as exc:
        logger.warning("oms_scraper.france24.error", error=str(exc))
    return results


# ── Source 6: BBC Health + Africa RSS ────────────────────────────────────────

async def _fetch_bbc(client: httpx.AsyncClient) -> list[dict]:
    """BBC Health & Africa feeds — filtre DRC + maladies."""
    results = []
    for feed_url, feed_label in [(BBC_HEALTH_RSS, "BBC-Health"), (BBC_AFRICA_RSS, "BBC-Africa")]:
        try:
            r = await client.get(feed_url, timeout=20)
            r.raise_for_status()
            root = ET.fromstring(r.content)
            for item in root.findall(".//item")[:30]:
                title   = (item.findtext("title") or "").strip()
                desc    = re.sub(r"<[^>]+>", "", item.findtext("description") or "")
                link    = (item.findtext("link") or "").strip()
                pub     = item.findtext("pubDate") or ""
                combined = f"{title} {desc}".lower()

                if not _is_drc_relevant(combined):
                    continue
                maladie = _detect_disease(combined)
                if not maladie:
                    continue

                souche   = _detect_souche(maladie, combined)
                cas      = _extract_int(_CAS_PATTERNS, desc)
                deces    = _extract_int(_DECES_PATTERNS, desc)
                suspects = _extract_int(_SUSPECTS_PATTERNS, desc)

                results.append({
                    "source": feed_label,
                    "maladie": maladie,
                    "souche": souche,
                    "titre": title,
                    "cas_confirmes": cas or 0,
                    "cas_suspects": suspects or 0,
                    "deces_confirmes": deces or 0,
                    "url": link,
                    "pub_date": pub,
                })
                logger.info("oms_scraper.bbc.match", feed=feed_label, maladie=maladie, titre=title[:80])
        except Exception as exc:
            logger.warning("oms_scraper.bbc.error", feed=feed_label, error=str(exc))
    return results


# ── Source 7: Telesud (HTML scraper) ─────────────────────────────────────────

async def _fetch_telesud_sante(client: httpx.AsyncClient) -> list[dict]:
    """Global Africa Telesud — page d'accueil, filtre DRC + maladies (pas de RSS)."""
    results = []
    try:
        r = await client.get(TELESUD_URL, timeout=20)
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
            combined = title.lower()
            if not _is_drc_relevant(combined):
                continue
            maladie = _detect_disease(combined)
            if not maladie:
                continue
            souche = _detect_souche(maladie, combined)
            results.append({
                "source": "Telesud",
                "maladie": maladie,
                "souche": souche,
                "titre": title,
                "cas_confirmes": 0,
                "cas_suspects": 0,
                "deces_confirmes": 0,
                "pub_date": datetime.now(timezone.utc).isoformat(),
            })
            logger.info("oms_scraper.telesud.match", maladie=maladie, titre=title[:80])
    except Exception as exc:
        logger.warning("oms_scraper.telesud.error", error=str(exc))
    return results


# ── Consolidation ─────────────────────────────────────────────────────────────

def _best_report(reports: list[dict]) -> dict | None:
    """
    Among multiple reports for the same disease, pick the one with highest cas_confirmes.
    Prefers WHO-DON > ReliefWeb > HDX when equal.
    """
    if not reports:
        return None
    source_priority = {"WHO-DON": 0, "ReliefWeb": 1, "CDC": 2, "OCHA-HDX": 3,
                       "France24": 4, "BBC-Health": 5, "BBC-Africa": 5}
    def _key(r: dict) -> tuple:
        src = r["source"]
        src_prio = next((v for k, v in source_priority.items() if src.startswith(k)), 6)
        return (-r.get("cas_confirmes", 0), src_prio)
    return sorted(reports, key=_key)[0]


# ── Province/zone mapping for national-level reports ─────────────────────────
# When a report only gives national totals, distribute across known active zones
# by updating epidemic_zone.source without changing individual zone counts.
# (Zone-level breakdown requires manual sitrep entry or field reporting.)

NATIONAL_ZONE: dict[str, dict] = {
    "EBOLA":    {"zone_sante": "RDC National", "territoire": "National", "province": "RDC",
                 "p_code": "CD-NAT-EBOLA", "lon": 24.5, "lat": -3.0},
    "CHOLERA":  {"zone_sante": "RDC National", "territoire": "National", "province": "RDC",
                 "p_code": "CD-NAT-CHOLERA", "lon": 24.5, "lat": -3.0},
    "MPOX":     {"zone_sante": "RDC National", "territoire": "National", "province": "RDC",
                 "p_code": "CD-NAT-MPOX", "lon": 24.5, "lat": -3.0},
    "ROUGEOLE": {"zone_sante": "RDC National", "territoire": "National", "province": "RDC",
                 "p_code": "CD-NAT-ROUGEOLE", "lon": 24.5, "lat": -3.0},
    "MENINGITE":{"zone_sante": "RDC National", "territoire": "National", "province": "RDC",
                 "p_code": "CD-NAT-MENING", "lon": 24.5, "lat": -3.0},
    "PALUDISME":{"zone_sante": "RDC National", "territoire": "National", "province": "RDC",
                 "p_code": "CD-NAT-PALU", "lon": 24.5, "lat": -3.0},
}


# ── Agent class ───────────────────────────────────────────────────────────────

class OmsScraperAgent:
    """
    Scrapes WHO, ReliefWeb, and HDX every 4 hours.
    Updates epidemic_timeseries and epidemic_zone in the DB.
    """

    def __init__(self) -> None:
        self._scheduler = AsyncIOScheduler(timezone="UTC")

    async def start(self) -> None:
        self._scheduler.add_job(
            self.run,
            "interval",
            hours=4,
            id="oms_scraper_run",
            name="OmsScraper:run",
            next_run_time=datetime.now(timezone.utc),
            misfire_grace_time=600,
            coalesce=True,
        )
        self._scheduler.start()
        logger.info("oms_scraper_agent.started", interval_hours=4)

    async def stop(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
        logger.info("oms_scraper_agent.stopped")

    async def run(self) -> None:
        """Main scrape cycle."""
        _SCRAPER_STATUS["runs_total"] += 1
        _SCRAPER_STATUS["last_run"] = datetime.now(timezone.utc).isoformat()
        _SCRAPER_STATUS["errors"] = []

        logger.info("oms_scraper.run.start")

        zones_updated = 0
        ts_updated    = 0
        by_disease: dict[str, dict] = {}

        async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
            # Gather reports from all sources in parallel
            who_reports, rw_reports, hdx_reports, cdc_reports, f24_reports, bbc_reports, tsd_reports = (
                await asyncio.gather(
                    _fetch_who_don(client),
                    _fetch_reliefweb(client),
                    _fetch_hdx(client),
                    _fetch_cdc(client),
                    _fetch_france24(client),
                    _fetch_bbc(client),
                    _fetch_telesud_sante(client),
                    return_exceptions=False,
                )
            )

        all_reports = who_reports + rw_reports + hdx_reports + cdc_reports + f24_reports + bbc_reports + tsd_reports

        # Group by disease
        by_maladie: dict[str, list[dict]] = {}
        for r in all_reports:
            by_maladie.setdefault(r["maladie"], []).append(r)

        today = date.today()

        for maladie, reports in by_maladie.items():
            best = _best_report(reports)
            if not best or best["cas_confirmes"] == 0:
                continue

            cas      = best["cas_confirmes"]
            suspects = best["cas_suspects"]
            deces    = best["deces_confirmes"]
            souche   = best.get("souche")
            source   = best["source"]

            by_disease[maladie] = {"cas": cas, "deces": deces, "source": source}

            # 1. Upsert timeseries
            try:
                ts_ok = await _upsert_timeseries(
                    maladie=maladie, souche=souche,
                    date_rapport=today,
                    cas_confirmes=cas, cas_suspects=suspects,
                    deces_confirmes=deces, source=source,
                )
                if ts_ok:
                    ts_updated += 1
            except Exception as exc:
                logger.warning("oms_scraper.timeseries_upsert_failed", maladie=maladie, error=str(exc))
                _SCRAPER_STATUS["errors"].append(f"{maladie}/ts: {exc}")

            # 2. Upsert national zone aggregate (only if no sub-zone data)
            nat = NATIONAL_ZONE.get(maladie)
            if nat:
                try:
                    z_ok = await _upsert_zone(
                        maladie=maladie, souche=souche,
                        zone_sante=nat["zone_sante"], territoire=nat["territoire"],
                        province=nat["province"], p_code=nat["p_code"],
                        lon=nat["lon"], lat=nat["lat"],
                        cas_confirmes=cas, cas_suspects=suspects,
                        deces_confirmes=deces, source=source,
                    )
                    if z_ok:
                        zones_updated += 1
                        # Notify bus if significant increase
                        await bus.publish("epidemie.alert", {
                            "maladie": maladie,
                            "cas_confirmes": cas,
                            "deces_confirmes": deces,
                            "source": source,
                            "auto": True,
                        })
                except Exception as exc:
                    logger.warning("oms_scraper.zone_upsert_failed", maladie=maladie, error=str(exc))
                    _SCRAPER_STATUS["errors"].append(f"{maladie}/zone: {exc}")

        _SCRAPER_STATUS["zones_updated"]     += zones_updated
        _SCRAPER_STATUS["timeseries_updated"] += ts_updated
        _SCRAPER_STATUS["last_results"]       = by_disease
        if not _SCRAPER_STATUS["errors"]:
            _SCRAPER_STATUS["last_success"] = _SCRAPER_STATUS["last_run"]

        logger.info(
            "oms_scraper.run.done",
            reports_total=len(all_reports),
            diseases_found=len(by_maladie),
            timeseries_updated=ts_updated,
            zones_updated=zones_updated,
        )

    def get_status(self) -> dict:
        return dict(_SCRAPER_STATUS)


# Singleton
oms_scraper_agent = OmsScraperAgent()
