"""
Logistique agent internal API endpoints.
"""
from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from agents.logistique.agent import logistique_agent

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/internal/logistique", tags=["logistique"])


class AcceptRequest(BaseModel):
    accepted_by: str


class RejectRequest(BaseModel):
    rejected_by: str
    reason: str


@router.post("/optimize")
async def optimize() -> list[dict]:
    """
    Déclenche manuellement un cycle d'optimisation logistique.
    Retourne les nouvelles recommandations générées (SUGGÉRÉES, non auto-appliquées).
    """
    try:
        return await logistique_agent.run_optimization()
    except Exception as exc:
        logger.error("logistique_router.optimize_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/recommendations")
async def list_recommendations(
    status: str | None = Query(
        default=None,
        description="Filtre par statut : PENDING, ACCEPTED, REJECTED",
    ),
) -> list[dict]:
    """Retourne les recommandations d'allocation stockées en mémoire."""
    try:
        return logistique_agent.get_recommendations(status=status)
    except Exception as exc:
        logger.error("logistique_router.list_recommendations_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/recommendations/{rec_id}/accept")
async def accept_recommendation(rec_id: str, body: AcceptRequest) -> dict:
    """
    Marque une recommandation comme ACCEPTED.
    La ressource n'est PAS déplacée automatiquement — une action manuelle est requise.
    """
    try:
        result = logistique_agent.accept_recommendation(
            rec_id=rec_id,
            accepted_by=body.accepted_by,
        )
        if result is None:
            raise HTTPException(
                status_code=404,
                detail=f"Recommandation '{rec_id}' introuvable.",
            )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "logistique_router.accept_error",
            rec_id=rec_id,
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/recommendations/{rec_id}/reject")
async def reject_recommendation(rec_id: str, body: RejectRequest) -> dict:
    """Marque une recommandation comme REJECTED avec un motif."""
    try:
        result = logistique_agent.reject_recommendation(
            rec_id=rec_id,
            rejected_by=body.rejected_by,
            reason=body.reason,
        )
        if result is None:
            raise HTTPException(
                status_code=404,
                detail=f"Recommandation '{rec_id}' introuvable.",
            )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "logistique_router.reject_error",
            rec_id=rec_id,
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/routes")
async def get_routes() -> dict:
    """
    Retourne un GeoJSON FeatureCollection des routes entrepôt → sinistre
    pour toutes les recommandations PENDING.
    """
    try:
        return logistique_agent.get_routes_geojson()
    except Exception as exc:
        logger.error("logistique_router.routes_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
