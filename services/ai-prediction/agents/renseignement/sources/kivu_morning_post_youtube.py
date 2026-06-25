"""Kivu Morning Post — chaîne YouTube via flux Atom public.

Feed  : https://www.youtube.com/feeds/videos.xml?channel_id=UCqYLowgloaK5BjaWwe7nk3Q
Chaîne: https://www.youtube.com/@kivumorningpost
Pas de clé API requise — flux RSS natif YouTube.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import httpx
import structlog

from ..schemas import IntelCategory, IntelEvent
from .kivu_morning_post import (
    KEYWORDS_BY_CATEGORY,
    PCODE_MAP,
    SECURITY_KEYWORDS,
    _classify,
    _extract_actors,
    _extract_pcode,
)

logger = structlog.get_logger(__name__)

YOUTUBE_FEED = (
    "https://www.youtube.com/feeds/videos.xml"
    "?channel_id=UCqYLowgloaK5BjaWwe7nk3Q"
)

NS_ATOM  = "http://www.w3.org/2005/Atom"
NS_MEDIA = "http://search.yahoo.com/mrss/"
NS_YT    = "http://www.youtube.com/xml/schemas/2015"


def _yt(tag: str) -> str:
    return f"{{{NS_YT}}}{tag}"

def _media(tag: str) -> str:
    return f"{{{NS_MEDIA}}}{tag}"

def _atom(tag: str) -> str:
    return f"{{{NS_ATOM}}}{tag}"


async def fetch_kmp_youtube_events() -> list[IntelEvent]:
    events: list[IntelEvent] = []
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(YOUTUBE_FEED, headers={"User-Agent": "SINAUR-RDC/1.0"})
            resp.raise_for_status()
            root = ET.fromstring(resp.text)
            entries = root.findall(_atom("entry"))
            for entry in entries[:20]:
                title = (entry.findtext(_atom("title")) or "").strip()
                link_el = entry.find(_atom("link"))
                url = link_el.get("href", "") if link_el is not None else ""
                video_id = (entry.findtext(_yt("videoId")) or "").strip()
                pub = entry.findtext(_atom("published")) or datetime.now(timezone.utc).isoformat()

                # Description depuis media:group/media:description
                media_group = entry.find(_media("group"))
                description = ""
                if media_group is not None:
                    desc_el = media_group.find(_media("description"))
                    if desc_el is not None and desc_el.text:
                        description = desc_el.text.strip()

                combined = f"{title} {description}"

                if not any(kw in combined.lower() for kw in SECURITY_KEYWORDS):
                    continue

                pcode, province = _extract_pcode(combined)
                events.append(IntelEvent(
                    source_id="kivu_morning_post_youtube",
                    external_id=video_id or url or f"kmpy-{hash(title)}",
                    title=f"[YT] {title}",
                    date=pub,
                    content=description[:1000],
                    url=url,
                    reliability=0.65,  # vidéo = moins structuré qu'un article
                    category=_classify(combined),
                    p_code=pcode,
                    province=province,
                    actor_names=_extract_actors(combined),
                ))
    except Exception as exc:
        logger.warning("kmp_youtube_fetch_failed", error=str(exc))
    return events
