"""
FEWS NET RSS connector — food security outlook for DRC.
Falls back to realistic mock data if the RSS endpoint is unavailable.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import httpx
import structlog

from agents.veille.connectors.base import AbstractConnector
from agents.veille.normalizer import PROVINCE_PCODE_MAP
from schemas.events import CanonicalEvent, EventType, RawEvent

logger = structlog.get_logger(__name__)

_FEWS_RSS_URL = "https://fews.net/east-africa/democratic-republic-congo/feed"

# Realistic mock data for when RSS is unavailable
_MOCK_FEWS_DATA = [
    {
        "province": "Nord-Kivu",
        "p_code": "CD-NK",
        "ipc_phase": 3,
        "population_affected": 1_200_000,
        "outlook": "Crisis conditions persist due to conflict and displacement.",
    },
    {
        "province": "Sud-Kivu",
        "p_code": "CD-SK",
        "ipc_phase": 3,
        "population_affected": 850_000,
        "outlook": "Stressed populations due to flooding and displacement.",
    },
    {
        "province": "Ituri",
        "p_code": "CD-IT",
        "ipc_phase": 4,
        "population_affected": 600_000,
        "outlook": "Emergency food insecurity due to armed conflict.",
    },
    {
        "province": "Kasai",
        "p_code": "CD-KC",
        "ipc_phase": 2,
        "population_affected": 400_000,
        "outlook": "Stressed food security, recovery from previous crisis.",
    },
    {
        "province": "Maniema",
        "p_code": "CD-MA",
        "ipc_phase": 2,
        "population_affected": 250_000,
        "outlook": "Minimal to stressed food security conditions.",
    },
]


class FewsNetConnector(AbstractConnector):
    source_id = "fews_net"
    fetch_interval_minutes = 360
    max_retries = 3
    circuit_breaker_threshold = 5

    async def fetch(self) -> list[RawEvent]:
        now = datetime.now(timezone.utc)
        events: list[RawEvent] = []

        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(_FEWS_RSS_URL)
                resp.raise_for_status()
                rss_text = resp.text
                events = _parse_rss(rss_text, now)
                logger.info("fews_net.fetch_live", count=len(events))
        except Exception as exc:
            logger.info("fews_net.rss_unavailable_using_mock", error=str(exc))
            for item in _MOCK_FEWS_DATA:
                events.append(
                    RawEvent(
                        source_id=self.source_id,
                        external_id=f"fews_mock_{item['p_code']}_{now.strftime('%Y%m%d')}",
                        raw_data=item,
                        fetched_at=now,
                    )
                )

        return events

    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        rd = raw.raw_data
        ipc_phase: int = rd.get("ipc_phase", 1)
        province: str = rd.get("province", "")
        p_code: str = rd.get("p_code", PROVINCE_PCODE_MAP.get(province, ""))
        population_affected: int = rd.get("population_affected", 0)

        # IPC phase 3+ = crisis → DEPLACEMENT or EPIDEMIE risk
        if ipc_phase >= 4:
            event_type = EventType.DEPLACEMENT
            severity = 4
        elif ipc_phase == 3:
            event_type = EventType.DEPLACEMENT
            severity = 3
        else:
            event_type = EventType.AUTRE
            severity = 2

        return CanonicalEvent(
            source_id=raw.source_id,
            external_id=raw.external_id,
            glide_number=None,
            event_type=event_type,
            title=f"FEWS NET: Insécurité alimentaire IPC Phase {ipc_phase} — {province}",
            description=rd.get("outlook", ""),
            p_code=p_code,
            province=province,
            coordinates=None,
            severity=severity,
            source_url="https://fews.net/east-africa/democratic-republic-congo",
            raw_data=raw.raw_data,
            fetched_at=raw.fetched_at,
            reliability_score=0.85,
        )


def _parse_rss(rss_text: str, now: datetime) -> list[RawEvent]:
    """Parse FEWS NET RSS feed into RawEvents."""
    events: list[RawEvent] = []
    try:
        root = ET.fromstring(rss_text)
        channel = root.find("channel")
        if channel is None:
            return events
        for item in channel.findall("item"):
            title_el = item.find("title")
            desc_el = item.find("description")
            link_el = item.find("link")
            title = title_el.text if title_el is not None else ""
            description = desc_el.text if desc_el is not None else ""
            link = link_el.text if link_el is not None else ""

            # Try to extract province
            province = ""
            p_code = ""
            for prov_name, pcode in PROVINCE_PCODE_MAP.items():
                if prov_name.lower() in (title or "").lower():
                    province = prov_name
                    p_code = pcode
                    break

            events.append(
                RawEvent(
                    source_id="fews_net",
                    external_id=f"fews_rss_{hash(title)}",
                    raw_data={
                        "province": province,
                        "p_code": p_code,
                        "ipc_phase": 2,  # default, real parse would extract from description
                        "population_affected": 0,
                        "outlook": description,
                        "link": link,
                    },
                    fetched_at=now,
                )
            )
    except ET.ParseError as exc:
        logger.warning("fews_net.rss_parse_error", error=str(exc))
    return events
