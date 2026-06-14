"""Router interne pour les statistiques de l'AutoCrisisEngine."""
from fastapi import APIRouter

router = APIRouter(prefix="/internal/auto_crisis", tags=["auto_crisis"])


@router.get("/stats")
async def get_auto_crisis_stats():
    from agents.auto_crisis.engine import auto_crisis_engine
    return auto_crisis_engine.get_stats()


@router.post("/ingest")
async def ingest_report(payload: dict):
    """Endpoint interne pour injecter un rapport depuis un autre agent."""
    from agents.auto_crisis.engine import ingest_report
    ingest_report(payload)
    return {"accepted": True}
