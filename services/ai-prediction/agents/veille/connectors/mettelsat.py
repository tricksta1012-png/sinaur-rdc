"""
Mettelsat satellite imagery connector — placeholder with realistic mock data.
Simulates satellite-derived rainfall anomaly and land cover change detection.
"""
from __future__ import annotations

import random
from datetime import datetime, timezone

import structlog

from agents.veille.connectors.base import AbstractConnector
from schemas.events import CanonicalEvent, EventType, RawEvent

logger = structlog.get_logger(__name__)

# Provinces with historically high satellite-detected rainfall anomalies
_HIGH_RISK_PROVINCES = [
    ("CD-NK", "Nord-Kivu", 29.2327, -1.6753),
    ("CD-SK", "Sud-Kivu", 28.8497, -2.4980),
    ("CD-IT", "Ituri", 30.2327, 1.5653),
    ("CD-MN", "Maniema", 26.9200, -3.1200),
    ("CD-TP", "Tshopo", 25.2000, 0.5200),
]


class MettelSatConnector(AbstractConnector):
    source_id = "mettelsat"
    fetch_interval_minutes = 720  # 12 hours
    max_retries = 3
    circuit_breaker_threshold = 5

    def __init__(self, seed: int | None = None) -> None:
        super().__init__()
        self._rng = random.Random(seed)

    async def fetch(self) -> list[RawEvent]:
        """
        Return mock satellite analysis results.
        In production, this would call the Mettelsat API endpoint for:
        - NDVI (vegetation index) anomalies
        - Precipitation estimates from satellite (IMERG/TAMSAT)
        - Flood inundation mapping (Sentinel-1 SAR)
        """
        now = datetime.now(timezone.utc)
        events: list[RawEvent] = []

        for p_code, province, lon, lat in _HIGH_RISK_PROVINCES:
            # Simulate realistic satellite-derived rainfall anomaly (mm/day vs climatology)
            rainfall_anomaly_mm = self._rng.gauss(mu=5.0, sigma=15.0)
            ndvi_anomaly = self._rng.gauss(mu=0.0, sigma=0.05)
            flood_extent_km2 = max(0.0, self._rng.gauss(mu=20.0, sigma=30.0))
            cloud_cover_pct = self._rng.uniform(30, 90)

            events.append(
                RawEvent(
                    source_id=self.source_id,
                    external_id=f"mettelsat_{p_code}_{now.strftime('%Y%m%d%H')}",
                    raw_data={
                        "p_code": p_code,
                        "province": province,
                        "lon": lon,
                        "lat": lat,
                        "rainfall_anomaly_mm_per_day": round(rainfall_anomaly_mm, 2),
                        "ndvi_anomaly": round(ndvi_anomaly, 4),
                        "flood_extent_km2": round(flood_extent_km2, 1),
                        "cloud_cover_pct": round(cloud_cover_pct, 1),
                        "data_quality": "MOCK",
                        "satellite": "Sentinel-1/IMERG",
                        "analysis_timestamp": now.isoformat(),
                    },
                    fetched_at=now,
                )
            )

        logger.info("mettelsat.fetch_mock", count=len(events))
        return events

    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        rd = raw.raw_data
        rainfall_anomaly: float = rd.get("rainfall_anomaly_mm_per_day", 0.0)
        flood_extent: float = rd.get("flood_extent_km2", 0.0)
        p_code: str = rd.get("p_code", "")
        province: str = rd.get("province", "")

        # Determine event type and severity from anomaly
        if rainfall_anomaly > 20 or flood_extent > 50:
            event_type = EventType.INONDATION
            severity = 4 if rainfall_anomaly > 30 else 3
        elif rainfall_anomaly < -15:
            event_type = EventType.SECHERESSE
            severity = 3
        else:
            event_type = EventType.AUTRE
            severity = 1

        return CanonicalEvent(
            source_id=raw.source_id,
            external_id=raw.external_id,
            glide_number=None,
            event_type=event_type,
            title=(
                f"Mettelsat: Anomalie précip {rainfall_anomaly:+.1f}mm/j — {province}"
                if rainfall_anomaly != 0 else
                f"Mettelsat: Analyse satellitaire — {province}"
            ),
            description=(
                f"Anomalie de précipitations {rainfall_anomaly:+.1f}mm/j. "
                f"Superficie inondée estimée: {flood_extent:.1f}km². "
                f"Couverture nuageuse: {rd.get('cloud_cover_pct', 0):.0f}%."
            ),
            p_code=p_code,
            province=province,
            coordinates=(rd.get("lon", 0.0), rd.get("lat", 0.0)),
            severity=severity,
            source_url="https://mettelsat.cd",
            raw_data=raw.raw_data,
            fetched_at=raw.fetched_at,
            reliability_score=0.7,  # lower due to mock/experimental nature
        )
