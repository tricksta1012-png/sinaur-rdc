"""
GeoJSON risk map aggregation for the SINAUR-RDC prediction agent.
"""
from __future__ import annotations

from datetime import datetime, timezone

import structlog

from agents.prediction.features import PROVINCE_GEO
from agents.veille.connectors.open_meteo import PROVINCE_CAPITALS
from schemas.risk import RiskMap, RiskMapFeature, RiskScore, RiskType

logger = structlog.get_logger(__name__)

# Province centroid coordinates (lon, lat) — fallback when not in PROVINCE_CAPITALS
_PROVINCE_CENTROIDS: dict[str, tuple[float, float]] = {
    "CD-NK": (29.23, -1.68),
    "CD-SK": (28.85, -2.49),
    "CD-MN": (26.92, -3.12),
    "CD-HK": (27.47, -11.66),
    "CD-IT": (30.23, 1.57),
    "CD-TP": (25.20, 0.52),
    "CD-BU": (24.73, 2.82),
    "CD-MO": (21.50, 2.15),
    "CD-SA": (19.77, 3.26),
    "CD-NU": (21.50, 4.00),
    "CD-EQ": (18.26, 0.05),
    "CD-HL": (25.90, -9.50),
    "CD-TA": (29.19, -5.93),
    "CD-LO": (25.47, -10.72),
    "CD-HU": (28.60, 3.50),
    "CD-SU": (23.60, -3.50),
    "CD-KC": (22.42, -5.90),
    "CD-KC2": (21.90, -5.50),
    "CD-MK": (23.60, -6.15),
    "CD-LM": (24.50, -6.80),
    "CD-KW": (18.83, -5.04),
    "CD-KO": (17.00, -4.84),
    "CD-MN2": (18.50, -2.50),
    "CD-BC": (13.46, -5.82),
    "CD-BN": (17.80, -3.30),
    "CD-KN": (15.32, -4.32),
}


def _get_centroid(p_code: str) -> tuple[float, float]:
    """Return (lon, lat) centroid for a province p_code."""
    if p_code in PROVINCE_CAPITALS:
        _, lon, lat = PROVINCE_CAPITALS[p_code]
        return (lon, lat)
    return _PROVINCE_CENTROIDS.get(p_code, (25.0, -4.0))


def build_risk_map(
    risk_scores: list[RiskScore],
    horizon_days: int,
    risk_type: RiskType | None = None,
) -> RiskMap:
    """
    Build a GeoJSON FeatureCollection from a list of RiskScores.

    Each province becomes a Point Feature with score/level in properties.
    Optional risk_type filter selects only one hazard type.
    """
    features: list[RiskMapFeature] = []

    # Filter by risk type if requested
    filtered = (
        [rs for rs in risk_scores if rs.risk_type == risk_type]
        if risk_type is not None
        else risk_scores
    )

    # For each province, take the highest score if multiple risk types present
    best_by_province: dict[str, RiskScore] = {}
    for rs in filtered:
        existing = best_by_province.get(rs.p_code)
        if existing is None or rs.score > existing.score:
            best_by_province[rs.p_code] = rs

    for p_code, rs in best_by_province.items():
        lon, lat = _get_centroid(p_code)
        geo_info = PROVINCE_GEO.get(p_code, {})

        feature = RiskMapFeature(
            type="Feature",
            geometry={
                "type": "Point",
                "coordinates": [lon, lat],
            },
            properties={
                "p_code": p_code,
                "province": rs.province,
                "score": round(rs.score, 1),
                "level": rs.level.value,
                "risk_type": rs.risk_type.value,
                "horizon_days": rs.horizon_days,
                "model_version": rs.model_version,
                "confidence": round(rs.confidence, 2),
                "population": geo_info.get("population", 0),
                "computed_at": rs.computed_at.isoformat(),
            },
        )
        features.append(feature)

    # Sort by score descending
    features.sort(key=lambda f: f.properties.get("score", 0), reverse=True)

    logger.info(
        "risk_map.built",
        feature_count=len(features),
        horizon_days=horizon_days,
        risk_type=risk_type.value if risk_type else "all",
    )

    return RiskMap(
        type="FeatureCollection",
        features=features,
        generated_at=datetime.now(timezone.utc),
        horizon_days=horizon_days,
        risk_type=risk_type.value if risk_type else None,
    )
