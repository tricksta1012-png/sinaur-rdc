"""
Veille agent internal API endpoints.
"""
from __future__ import annotations

from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query

from agents.veille.agent import veille_agent
from schemas.events import CanonicalEvent

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/internal/veille", tags=["veille"])


@router.get("/events", response_model=list[CanonicalEvent])
async def list_events(
    since: datetime | None = Query(default=None, description="ISO 8601 datetime filter"),
    type: str | None = Query(default=None, description="EventType filter (e.g. INONDATION)"),
    province: str | None = Query(default=None, description="Province name or P-code filter"),
) -> list[CanonicalEvent]:
    """Return stored canonical events with optional filters."""
    return veille_agent.get_events(since=since, event_type=type, province=province)


@router.get("/health")
async def get_health() -> dict:
    """Return health status of all data connectors."""
    return veille_agent.get_health()


@router.post("/trigger/{source_id}")
async def trigger_connector(source_id: str) -> dict:
    """Manually trigger a connector fetch cycle."""
    try:
        result = await veille_agent.run_connector_by_id(source_id)
        return {"status": "ok", "result": result}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.error("veille_router.trigger_error", source_id=source_id, error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
