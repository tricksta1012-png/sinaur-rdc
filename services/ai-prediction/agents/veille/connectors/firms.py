"""
NASA FIRMS fire hotspot connector — VIIRS SNPP NRT data for DRC.
"""
from __future__ import annotations

import csv
import io
import math
from datetime import datetime, timezone

import httpx
import structlog

from agents.veille.connectors.base import AbstractConnector
from config import settings
from schemas.events import CanonicalEvent, EventType, RawEvent

logger = structlog.get_logger(__name__)

# DRC bounding box
_DRC_WEST = 11.8
_DRC_SOUTH = -13.5
_DRC_EAST = 31.3
_DRC_NORTH = 5.4

_FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"

# Approximate bounding boxes for DRC provinces: (west, south, east, north, pcode, name)
_PROVINCE_BBOXES = [
    (28.0,  -1.5,  31.3,   2.0,  "CD-IT",  "Ituri"),
    (27.0,  -3.5,  29.5,  -0.5,  "CD-NK",  "Nord-Kivu"),
    (26.5,  -5.5,  29.5,  -1.5,  "CD-SK",  "Sud-Kivu"),
    (26.5,  -5.0,  29.0,  -2.5,  "CD-MN",  "Maniema"),
    (26.0,  -8.0,  29.5,  -4.0,  "CD-TA",  "Tanganyika"),
    (26.0, -11.5,  29.5,  -7.0,  "CD-HK",  "Haut-Katanga"),
    (23.0, -10.0,  26.5,  -7.0,  "CD-HL",  "Haut-Lomami"),
    (25.0,  -8.5,  27.5,  -5.5,  "CD-LO",  "Lualaba"),
    (26.5,   0.5,  31.3,   5.4,  "CD-HU",  "Haut-Uele"),
    (24.0,   0.5,  28.5,   3.5,  "CD-BU",  "Bas-Uele"),
    (22.0,   0.0,  26.0,   2.5,  "CD-TP",  "Tshopo"),
    (18.5,   0.5,  23.0,   4.5,  "CD-MO",  "Mongala"),
    (17.5,   2.5,  21.5,   5.4,  "CD-NU",  "Nord-Ubangi"),
    (17.0,   1.0,  19.5,   4.0,  "CD-SA",  "Sud-Ubangi"),
    (17.0,  -2.0,  24.0,   2.0,  "CD-EQ",  "Équateur"),
    (22.5,  -5.5,  26.5,  -2.0,  "CD-SU",  "Sankuru"),
    (20.5,  -7.5,  24.0,  -4.0,  "CD-KC",  "Kasaï"),
    (21.0,  -7.0,  23.5,  -4.5,  "CD-KC2", "Kasaï-Central"),
    (23.0,  -7.5,  26.5,  -4.0,  "CD-MK",  "Kasaï-Oriental"),
    (23.5,  -8.0,  26.5,  -5.5,  "CD-LM",  "Lomami"),
    (16.5,  -5.5,  20.5,  -2.0,  "CD-KW",  "Kwilu"),
    (16.0,  -7.0,  18.5,  -3.5,  "CD-KO",  "Kwango"),
    (16.0,  -4.5,  18.5,  -1.5,  "CD-MN2", "Mai-Ndombe"),
    (12.5,  -5.5,  17.0,  -3.5,  "CD-BC",  "Kongo Central"),
    (15.5,  -2.0,  17.0,   0.5,  "CD-KN",  "Kinshasa"),
]


def _map_coords_to_province(lat: float, lon: float) -> tuple[str, str]:
    """Return (pcode, province_name) for the given coordinates using bbox lookup."""
    for west, south, east, north, pcode, name in _PROVINCE_BBOXES:
        if west <= lon <= east and south <= lat <= north:
            return pcode, name
    return "COD", "République Démocratique du Congo"


def _frp_to_severity(frp: float) -> int:
    """Map Fire Radiative Power (MW) to SINAUR severity (1-5)."""
    if frp < 50:
        return 2   # Minor
    if frp < 200:
        return 3   # Moderate
    if frp < 500:
        return 4   # Severe
    return 5       # Extreme


def _cluster_key(lat: float, lon: float, precision: float = 0.5) -> tuple[int, int]:
    """Round coordinates to grid cells for clustering."""
    return (int(math.floor(lat / precision)), int(math.floor(lon / precision)))


class FirmsConnector(AbstractConnector):
    source_id = "firms_nasa"
    fetch_interval_minutes = 120  # every 2 hours

    async def fetch(self) -> list[RawEvent]:
        map_key = settings.firms_map_key
        url = (
            f"{_FIRMS_BASE}/{map_key}/VIIRS_SNPP_NRT"
            f"/{_DRC_WEST},{_DRC_SOUTH},{_DRC_EAST},{_DRC_NORTH}/2"
        )
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.get(url)
                # Rate-limited (429) or server error — return empty gracefully
                if resp.status_code == 429:
                    logger.warning(
                        "firms_connector.rate_limited",
                        map_key=map_key,
                        hint="DEMO_KEY has strict rate limits; set FIRMS_MAP_KEY to a real key",
                    )
                    return []
                if resp.status_code >= 400:
                    logger.warning(
                        "firms_connector.http_error",
                        status_code=resp.status_code,
                        url=url,
                    )
                    return []

                text_body = resp.text
        except Exception as exc:
            logger.error("firms_connector.fetch_error", error=str(exc))
            return []

        now = datetime.now(timezone.utc)
        events: list[RawEvent] = []

        try:
            reader = csv.DictReader(io.StringIO(text_body))
            for row in reader:
                try:
                    confidence_raw = str(row.get("confidence", "0")).strip()
                    # Confidence can be numeric (0-100) or categorical (l/n/h)
                    if confidence_raw.lstrip("-").isdigit():
                        confidence = int(confidence_raw)
                    elif confidence_raw.lower() in ("h", "high"):
                        confidence = 80
                    elif confidence_raw.lower() in ("n", "nominal"):
                        confidence = 50
                    elif confidence_raw.lower() in ("l", "low"):
                        confidence = 30
                    else:
                        confidence = 0

                    if confidence < 50:
                        continue

                    events.append(
                        RawEvent(
                            source_id=self.source_id,
                            external_id=(
                                f"firms_{row.get('acq_date', '')}_{row.get('acq_time', '')}"
                                f"_{row.get('latitude', '')}_{row.get('longitude', '')}"
                            ),
                            raw_data=dict(row),
                            fetched_at=now,
                        )
                    )
                except Exception as row_exc:
                    logger.debug("firms_connector.row_parse_error", error=str(row_exc))
                    continue
        except Exception as csv_exc:
            logger.error("firms_connector.csv_parse_error", error=str(csv_exc))
            return []

        logger.info("firms_connector.fetch", total_hotspots=len(events))

        # Group by 0.5-degree cluster and emit one RawEvent per cluster
        clusters: dict[tuple, RawEvent] = {}
        cluster_frp: dict[tuple, list[float]] = {}

        for raw in events:
            try:
                lat = float(raw.raw_data.get("latitude", 0))
                lon = float(raw.raw_data.get("longitude", 0))
                key = _cluster_key(lat, lon)
                frp_val = float(raw.raw_data.get("frp", 0) or 0)

                if key not in clusters:
                    clusters[key] = raw
                    cluster_frp[key] = [frp_val]
                else:
                    # Keep the hotspot with highest FRP as representative
                    existing_frp = float(clusters[key].raw_data.get("frp", 0) or 0)
                    if frp_val > existing_frp:
                        clusters[key] = raw
                    cluster_frp[key].append(frp_val)
            except Exception:
                continue

        # Annotate cluster representatives with aggregated FRP
        clustered: list[RawEvent] = []
        for key, raw in clusters.items():
            frp_list = cluster_frp[key]
            total_frp = sum(frp_list)
            enriched_data = dict(raw.raw_data)
            enriched_data["_cluster_count"] = len(frp_list)
            enriched_data["_cluster_total_frp"] = total_frp
            clustered.append(
                RawEvent(
                    source_id=raw.source_id,
                    external_id=raw.external_id,
                    raw_data=enriched_data,
                    fetched_at=raw.fetched_at,
                )
            )

        logger.info(
            "firms_connector.clustered",
            hotspots=len(events),
            clusters=len(clustered),
        )
        return clustered

    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        data = raw.raw_data
        lat = float(data.get("latitude", 0))
        lon = float(data.get("longitude", 0))
        frp = float(data.get("_cluster_total_frp") or data.get("frp") or 0)
        cluster_count = int(data.get("_cluster_count", 1))

        pcode, province = _map_coords_to_province(lat, lon)
        severity = _frp_to_severity(frp)

        acq_date = data.get("acq_date", "")
        acq_time = str(data.get("acq_time", "")).zfill(4)
        try:
            if acq_date and acq_time:
                date_str = f"{acq_date}T{acq_time[:2]}:{acq_time[2:]}:00+00:00"
                fetched_at = datetime.fromisoformat(date_str)
            else:
                fetched_at = raw.fetched_at
        except ValueError:
            fetched_at = raw.fetched_at

        severity_labels = {2: "Minor", 3: "Moderate", 4: "Severe", 5: "Extreme"}
        label = severity_labels.get(severity, "Minor")

        if cluster_count > 1:
            title = (
                f"Foyer d'incendie — {province} "
                f"({cluster_count} points, FRP cumulé {frp:.0f} MW)"
            )
        else:
            title = f"Feu de forêt/végétation détecté — {province} (FRP {frp:.0f} MW)"

        return CanonicalEvent(
            source_id=raw.source_id,
            external_id=raw.external_id,
            event_type=EventType.AUTRE,
            title=title,
            description=(
                f"Hotspot incendie NASA FIRMS VIIRS — {label}. "
                f"Coordonnées approximatives : lat={lat:.3f}, lon={lon:.3f}. "
                f"FRP={frp:.1f} MW, {cluster_count} point(s) dans la cellule 0.5°."
            ),
            p_code=pcode,
            province=province,
            coordinates=(lon, lat),
            severity=severity,
            source_url=(
                f"https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@{lon:.2f},{lat:.2f},8z"
            ),
            raw_data=data,
            fetched_at=fetched_at,
            reliability_score=0.75,
        )
