"""
Open-Meteo weather connector — fetches 7-day forecasts for all 26 RDC provinces.
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx
import structlog

from agents.veille.connectors.base import AbstractConnector
from config import settings
from schemas.events import CanonicalEvent, EventType, RawEvent

logger = structlog.get_logger(__name__)

# (p_code, capital_name, lon, lat) for all 26 provinces
PROVINCE_CAPITALS: dict[str, tuple[str, float, float]] = {
    "CD-NK": ("Goma", 29.2327, -1.6753),
    "CD-SK": ("Bukavu", 28.8497, -2.4980),
    "CD-MN": ("Bunia", 30.2327, 1.5653),
    "CD-HK": ("Butembo", 29.2895, 0.1389),
    "CD-IT": ("Bunia", 30.2327, 1.5653),
    "CD-TP": ("Buta", 24.7327, 2.8153),
    "CD-BU": ("Gbadolite", 20.9827, 4.2830),
    "CD-MO": ("Lisala", 21.5035, 2.1472),
    "CD-SA": ("Gemena", 19.7712, 3.2577),
    "CD-NU": ("Bumba", 22.4688, 2.1918),
    "CD-SU": ("Kisangani", 25.1991, 0.5153),
    "CD-MA": ("Kamina", 25.0020, -8.7387),
    "CD-HU": ("Kalemi", 29.1938, -5.9343),
    "CD-TA": ("Kalemie", 29.1938, -5.9343),
    "CD-MK": ("Mbuji-Mayi", 23.5960, -6.1500),
    "CD-KC": ("Kananga", 22.4167, -5.8967),
    "CD-LO": ("Kolwezi", 25.4736, -10.7165),
    "CD-HK2": ("Lubumbashi", 27.4660, -11.6609),
    "CD-KE": ("Lubumbashi", 27.4660, -11.6609),
    "CD-KW": ("Kikwit", 18.8331, -5.0418),
    "CD-KO": ("Kenge", 16.9979, -4.8358),
    "CD-BC": ("Matadi", 13.4603, -5.8173),
    "CD-BN": ("Mbandaka", 18.2604, 0.0490),
    "CD-EQ": ("Mbandaka", 18.2604, 0.0490),
    "CD-KN": ("Kinshasa", 15.3222, -4.3217),
    "CD-KG": ("Kenge", 16.9979, -4.8358),
}


class OpenMeteoConnector(AbstractConnector):
    source_id = "open_meteo"
    fetch_interval_minutes = 180
    max_retries = 3
    circuit_breaker_threshold = 5

    async def fetch(self) -> list[RawEvent]:
        now = datetime.now(timezone.utc)
        events: list[RawEvent] = []

        async with httpx.AsyncClient(timeout=30.0) as client:
            for p_code, (capital, lon, lat) in PROVINCE_CAPITALS.items():
                url = (
                    f"{settings.open_meteo_base_url}/forecast"
                    f"?latitude={lat}&longitude={lon}"
                    f"&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,windspeed_10m_max"
                    f"&forecast_days=7&timezone=Africa%2FKinshasa"
                )
                try:
                    resp = await client.get(url)
                    resp.raise_for_status()
                    data = resp.json()
                except Exception as exc:
                    logger.warning(
                        "open_meteo.province_fetch_failed",
                        p_code=p_code,
                        error=str(exc),
                    )
                    continue

                events.append(
                    RawEvent(
                        source_id=self.source_id,
                        external_id=f"{p_code}_{now.strftime('%Y%m%d%H')}",
                        raw_data={
                            "p_code": p_code,
                            "capital": capital,
                            "lon": lon,
                            "lat": lat,
                            "forecast": data,
                        },
                        fetched_at=now,
                    )
                )

        logger.info("open_meteo.fetch", count=len(events))
        return events

    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        rd = raw.raw_data
        p_code: str = rd.get("p_code", "")
        capital: str = rd.get("capital", "")
        forecast: dict = rd.get("forecast", {})

        # Compute max precipitation from 7-day forecast
        daily = forecast.get("daily", {})
        precip_list: list[float] = [
            v for v in (daily.get("precipitation_sum") or []) if v is not None
        ]
        max_precip = max(precip_list) if precip_list else 0.0

        # Determine event type based on precipitation
        if max_precip > 80:
            event_type = EventType.INONDATION
            severity = 4
        elif max_precip > 40:
            event_type = EventType.INONDATION
            severity = 2
        else:
            event_type = EventType.AUTRE
            severity = 1

        return CanonicalEvent(
            source_id=raw.source_id,
            external_id=raw.external_id,
            glide_number=None,
            event_type=event_type,
            title=f"Prévision météo {capital} — précip max {max_precip:.1f}mm/j",
            description=f"Prévision 7 jours pour {capital} ({p_code}). Max précipitation: {max_precip:.1f}mm.",
            p_code=p_code,
            province=capital,
            coordinates=(rd.get("lon", 0.0), rd.get("lat", 0.0)),
            severity=severity,
            source_url=f"https://open-meteo.com",
            raw_data=raw.raw_data,
            fetched_at=raw.fetched_at,
            reliability_score=0.8,
        )
