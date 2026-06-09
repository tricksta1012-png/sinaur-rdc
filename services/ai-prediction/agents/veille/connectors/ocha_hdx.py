"""
OCHA HDX connector — fetches IDP displacement data for DRC.
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx
import structlog

from agents.veille.connectors.base import AbstractConnector
from agents.veille.normalizer import PROVINCE_PCODE_MAP
from schemas.events import CanonicalEvent, EventType, RawEvent

logger = structlog.get_logger(__name__)

_HDX_API_URL = "https://data.humdata.org/api/3/action/package_search"


class OchaHdxConnector(AbstractConnector):
    source_id = "ocha_hdx"
    fetch_interval_minutes = 1440  # daily
    max_retries = 3
    circuit_breaker_threshold = 5

    async def fetch(self) -> list[RawEvent]:
        now = datetime.now(timezone.utc)
        params = {"q": "displacement DRC", "rows": 5}

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(_HDX_API_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

        results = data.get("result", {}).get("results", [])
        events: list[RawEvent] = []

        for pkg in results:
            pkg_id = pkg.get("id", "")
            resources = pkg.get("resources", [])

            # Extract IDP figures from package metadata / resources
            idp_figures = _extract_idp_figures(pkg)

            events.append(
                RawEvent(
                    source_id=self.source_id,
                    external_id=f"hdx_{pkg_id}",
                    raw_data={
                        "package_id": pkg_id,
                        "title": pkg.get("title", ""),
                        "notes": pkg.get("notes", ""),
                        "idp_figures": idp_figures,
                        "resources_count": len(resources),
                        "organization": pkg.get("organization", {}).get("name", ""),
                    },
                    fetched_at=now,
                )
            )

        logger.info("ocha_hdx.fetch", packages=len(events))
        return events

    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        rd = raw.raw_data
        title: str = rd.get("title", "IDP Data DRC")
        idp_figures: dict = rd.get("idp_figures", {})

        # Try to identify province from title
        province: str | None = None
        p_code: str | None = None
        title_lower = title.lower()
        for prov_name, pcode in PROVINCE_PCODE_MAP.items():
            if prov_name.lower() in title_lower:
                province = prov_name
                p_code = pcode
                break

        total_idps = sum(idp_figures.values()) if idp_figures else 0

        severity = 1
        if total_idps > 500_000:
            severity = 4
        elif total_idps > 100_000:
            severity = 3
        elif total_idps > 50_000:
            severity = 2

        return CanonicalEvent(
            source_id=raw.source_id,
            external_id=raw.external_id,
            glide_number=None,
            event_type=EventType.DEPLACEMENT,
            title=title,
            description=rd.get("notes", "")[:500] if rd.get("notes") else None,
            p_code=p_code,
            province=province,
            coordinates=None,
            severity=severity,
            source_url=f"https://data.humdata.org/dataset/{rd.get('package_id', '')}",
            raw_data=raw.raw_data,
            fetched_at=raw.fetched_at,
            reliability_score=0.85,
        )


def _extract_idp_figures(pkg: dict) -> dict:
    """Extract IDP figure estimates from package metadata."""
    figures: dict[str, int] = {}

    # Try to extract numeric IDP counts from dataset notes
    notes: str = pkg.get("notes", "") or ""
    import re
    # Pattern: "X,XXX IDPs" or "X million IDPs"
    matches = re.findall(r"([\d,]+)\s*(?:million)?\s*IDPs?", notes, re.IGNORECASE)
    for i, match in enumerate(matches[:5]):
        clean = match.replace(",", "")
        try:
            figures[f"estimate_{i}"] = int(clean)
        except ValueError:
            pass

    return figures
