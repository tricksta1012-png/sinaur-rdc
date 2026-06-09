"""
Epidemie agent internal API endpoints.
"""
from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException

from agents.epidemie.agent import epidemie_agent

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/internal/epidemie", tags=["epidemie"])


@router.get("/clusters")
async def get_clusters() -> list[dict]:
    """Retourne tous les clusters épidémiques actifs."""
    try:
        return epidemie_agent.get_clusters()
    except Exception as exc:
        logger.error("epidemie_router.clusters_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/map")
async def get_map() -> dict:
    """
    Retourne un GeoJSON FeatureCollection de tous les clusters actifs.
    Chaque cluster est représenté par un Point avec les propriétés :
    disease, size, score, alert_level.
    """
    try:
        clusters = epidemie_agent.get_clusters()
        features: list[dict] = []

        for cluster in clusters:
            lat = cluster.get("centroid_lat")
            lng = cluster.get("centroid_lng")
            if lat is None or lng is None:
                continue

            feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [lng, lat],
                },
                "properties": {
                    "cluster_id": cluster.get("cluster_id"),
                    "disease": cluster.get("disease_id"),
                    "size": cluster.get("size"),
                    "score": cluster.get("score"),
                    "alert_level": cluster.get("alert_level"),
                    "province": cluster.get("province"),
                    "detected_at": cluster.get("detected_at"),
                    "first_case_at": cluster.get("first_case_at"),
                    "last_case_at": cluster.get("last_case_at"),
                },
            }
            features.append(feature)

        return {
            "type": "FeatureCollection",
            "features": features,
            "metadata": {
                "total_clusters": len(features),
            },
        }
    except Exception as exc:
        logger.error("epidemie_router.map_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/alerts")
async def get_alerts() -> list[dict]:
    """Retourne toutes les alertes CAP Health générées."""
    try:
        return epidemie_agent.get_alerts()
    except Exception as exc:
        logger.error("epidemie_router.alerts_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/history/{disease_id}")
async def get_history(disease_id: str) -> list[dict]:
    """Retourne l'historique des clusters sur 90 jours pour une maladie donnée."""
    from agents.epidemie.agent import DISEASE_PROFILES

    if disease_id not in DISEASE_PROFILES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown disease_id '{disease_id}'. Valid: {list(DISEASE_PROFILES.keys())}",
        )
    try:
        return epidemie_agent.get_history(disease_id)
    except Exception as exc:
        logger.error(
            "epidemie_router.history_error",
            disease_id=disease_id,
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/dashboard")
async def get_dashboard() -> dict:
    """Résumé global de la surveillance épidémique."""
    try:
        return epidemie_agent.get_dashboard()
    except Exception as exc:
        logger.error("epidemie_router.dashboard_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
