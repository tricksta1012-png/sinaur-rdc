"""
AnomalieStocks agent internal API endpoints.
"""
from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from agents.anomalie_stocks.agent import anomalie_stocks_agent

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/internal/anomalie-stocks", tags=["anomalie-stocks"])


class ResolveRequest(BaseModel):
    resolution: str
    note: str = ""


@router.get("/alerts")
async def list_alerts(
    statut: str | None = Query(default=None, description="Filtre par statut (OPEN/RESOLVED)"),
    province: str | None = Query(default=None, description="Filtre par province"),
) -> list[dict]:
    """Retourne les alertes d'anomalie stocks, filtrées par statut et/ou province."""
    try:
        return anomalie_stocks_agent.get_alerts(statut=statut, province=province)
    except Exception as exc:
        logger.error("anomalie_stocks_router.list_alerts_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/stats/{entrepot_id}")
async def get_stats(entrepot_id: str) -> dict:
    """Retourne les statistiques d'anomalie pour un entrepôt donné."""
    try:
        return anomalie_stocks_agent.get_stats(entrepot_id)
    except Exception as exc:
        logger.error(
            "anomalie_stocks_router.get_stats_error",
            entrepot_id=entrepot_id,
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str, body: ResolveRequest) -> dict:
    """Marque une alerte comme résolue."""
    try:
        result = anomalie_stocks_agent.resolve_alert(
            alert_id=alert_id,
            resolution=body.resolution,
            note=body.note,
        )
        if result.get("status") == "not_found":
            raise HTTPException(
                status_code=404,
                detail=f"Alert '{alert_id}' not found",
            )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "anomalie_stocks_router.resolve_error",
            alert_id=alert_id,
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/dashboard")
async def get_dashboard() -> dict:
    """Résumé global des anomalies de stocks."""
    try:
        return anomalie_stocks_agent.get_dashboard()
    except Exception as exc:
        logger.error("anomalie_stocks_router.dashboard_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
