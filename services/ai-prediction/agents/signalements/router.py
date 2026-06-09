"""
Signalements agent internal API endpoints.
"""
from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from agents.signalements.agent import signalements_agent

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/internal/signalements", tags=["signalements"])


class SignalementRequest(BaseModel):
    text: str
    source: str = "inconnu"
    channel: str = "inconnu"
    metadata: dict = {}
    province: str = ""
    lat: float | None = None
    lon: float | None = None


@router.post("/process")
async def process_signalement(request: SignalementRequest) -> dict:
    """
    Soumet un signalement citoyen pour classification et priorisation.
    Retourne la classe détectée, le score de fiabilité et la priorité.
    """
    try:
        signalement = request.model_dump()
        result = signalements_agent.process(signalement)
        # Vérification async des clusters après chaque signalement
        try:
            await signalements_agent._check_and_publish_clusters()
        except Exception as bus_exc:
            logger.warning(
                "signalements_router.bus_error",
                error=str(bus_exc),
            )
        return result
    except Exception as exc:
        logger.error("signalements_router.process_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/clusters")
async def get_clusters() -> list[dict]:
    """
    Retourne les clusters géo-temporels actifs détectés dans la fenêtre 6h.
    Un cluster représente plusieurs signalements convergents sur la même zone.
    """
    try:
        return signalements_agent.get_clusters()
    except Exception as exc:
        logger.error("signalements_router.clusters_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/priority")
async def get_priority_queue(
    min_score: float = Query(default=0.0, description="Score minimal de priorisation (0.0–1.0)"),
) -> list[dict]:
    """
    Retourne la file de priorisation des signalements, triée par score décroissant.
    Filtrer par min_score pour n'obtenir que les signalements au-dessus du seuil.
    """
    try:
        return signalements_agent.get_priority_queue(min_score=min_score)
    except Exception as exc:
        logger.error("signalements_router.priority_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/stats")
async def get_stats() -> dict:
    """
    Retourne les statistiques agrégées des signalements traités
    (total, répartition par classe, par priorité, moyennes).
    """
    try:
        return signalements_agent.get_stats()
    except Exception as exc:
        logger.error("signalements_router.stats_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
