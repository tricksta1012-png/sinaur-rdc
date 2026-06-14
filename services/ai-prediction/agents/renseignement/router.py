"""FastAPI router — Agent 10 Renseignement. Access: RESTRICTED."""
from __future__ import annotations
from fastapi import APIRouter, Query
from .agent import renseignement_agent

router = APIRouter(prefix="/internal/renseignement", tags=["renseignement"])


@router.get("/status")
async def get_status() -> dict:
    return renseignement_agent.get_status()


@router.get("/threat-assessment")
async def get_threat_assessment() -> dict:
    return {"assessments": renseignement_agent.get_assessments()}


@router.get("/events")
async def get_events(
    category: str | None = Query(None),
    p_code: str | None = Query(None),
) -> dict:
    return {"events": renseignement_agent.get_events(category=category, p_code=p_code)}


@router.get("/bulletin/latest")
async def get_latest_bulletin() -> dict:
    bulletin = renseignement_agent.get_bulletin()
    return {"bulletin": bulletin}


@router.get("/military-activity")
async def get_military_activity(p_code: str | None = Query(None)) -> dict:
    events = renseignement_agent.get_events(category="ACTIVITE_MILITAIRE", p_code=p_code)
    return {"events": events, "count": len(events)}


@router.get("/security-incidents")
async def get_security_incidents(p_code: str | None = Query(None)) -> dict:
    events = renseignement_agent.get_events(category="INCIDENT_SECURITAIRE", p_code=p_code)
    return {"events": events, "count": len(events)}


@router.get("/infrastructure-damage")
async def get_infrastructure_damage(p_code: str | None = Query(None)) -> dict:
    events = renseignement_agent.get_events(category="DOMMAGE_INFRASTRUCTURE", p_code=p_code)
    return {"events": events, "count": len(events)}


@router.post("/search")
async def search_intel(body: dict) -> dict:
    query = (body.get("query") or "").lower()
    p_code = body.get("province")
    category = body.get("type")
    events = renseignement_agent.get_events(category=category, p_code=p_code)
    if query:
        events = [e for e in events
                  if query in (e.get("title") or "").lower()
                  or query in (e.get("content") or "").lower()]
    return {"events": events[:50], "count": len(events)}
