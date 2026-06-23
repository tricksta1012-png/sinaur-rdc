"""
Catastrophes agent — endpoints internes.
Toutes les routes requièrent X-Internal-API-Key.
"""
from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException, Query

from agents.catastrophes.agent import agent_catastrophes
from agents.catastrophes.collecteur_gdacs import TYPES_EVENEMENT, SURVEILLANCE_RENFORCEE

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/internal/catastrophes", tags=["catastrophes"])


@router.get("/evenements")
async def get_evenements(
    niveau: str | None = Query(None, description="Green | Orange | Red"),
    type_code: str | None = Query(None, description="EQ | FL | VO | TC | DR | WF | TS"),
) -> dict:
    """Événements GDACS actifs, filtrables par niveau d'alerte et type."""
    NIVEAUX = {"Green", "Orange", "Red"}
    if niveau and niveau not in NIVEAUX:
        raise HTTPException(400, f"Niveau invalide. Valides : {sorted(NIVEAUX)}")
    if type_code and type_code not in TYPES_EVENEMENT:
        raise HTTPException(400, f"Type invalide. Valides : {sorted(TYPES_EVENEMENT)}")
    try:
        evts = agent_catastrophes.get_evenements(niveau=niveau, type_code=type_code)
        return {"total": len(evts), "evenements": evts}
    except Exception as exc:
        logger.error("catastrophes_router.evenements_error", error=str(exc))
        raise HTTPException(500, str(exc))


@router.get("/map")
async def get_map() -> dict:
    """GeoJSON FeatureCollection de tous les événements actifs."""
    try:
        return agent_catastrophes.get_geojson()
    except Exception as exc:
        logger.error("catastrophes_router.map_error", error=str(exc))
        raise HTTPException(500, str(exc))


@router.get("/crises")
async def get_crises_creees() -> dict:
    """Crises SINAUR créées automatiquement par l'agent GDACS."""
    try:
        crises = agent_catastrophes.get_crises_creees()
        return {"total": len(crises), "crises": crises}
    except Exception as exc:
        logger.error("catastrophes_router.crises_error", error=str(exc))
        raise HTTPException(500, str(exc))


@router.get("/status")
async def get_status() -> dict:
    """Statut opérationnel de l'agent et sites sous surveillance renforcée."""
    try:
        return {
            **agent_catastrophes.get_status(),
            "surveillance_renforcee": list(SURVEILLANCE_RENFORCEE.keys()),
            "types_surveilles": TYPES_EVENEMENT,
        }
    except Exception as exc:
        logger.error("catastrophes_router.status_error", error=str(exc))
        raise HTTPException(500, str(exc))
