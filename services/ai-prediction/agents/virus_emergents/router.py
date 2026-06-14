"""Routes internes pour la veille virale émergente."""
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/internal/virus_emergents", tags=["virus_emergents"])


@router.get("/status")
async def get_status():
    from agents.virus_emergents.agent import virus_emergent_agent
    return virus_emergent_agent.get_status()


@router.get("/pathogenes")
async def list_pathogenes():
    from agents.virus_emergents.agent import PATHOGEN_PROFILES
    return {"pathogenes": PATHOGEN_PROFILES}


@router.get("/pathogenes/{pathogen_id}")
async def get_pathogene(pathogen_id: str):
    from agents.virus_emergents.agent import PATHOGEN_PROFILES
    p = PATHOGEN_PROFILES.get(pathogen_id)
    if not p:
        raise HTTPException(status_code=404, detail="Pathogène inconnu")
    return p


@router.get("/alerts")
async def list_alerts():
    from agents.virus_emergents.agent import _ALERT_STORE
    return {"alerts": _ALERT_STORE, "count": len(_ALERT_STORE)}
