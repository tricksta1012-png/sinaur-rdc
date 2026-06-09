"""
Anti-fraud agent internal API endpoints.
"""
from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agents.antifraud.agent import antifraud_agent
from schemas.fraud import FraudCheckResult

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/internal/antifraud", tags=["antifraud"])


class CheckRequest(BaseModel):
    dossier: dict
    context: dict = {}


class ResolveRequest(BaseModel):
    resolution: str  # CONFIRMED_DUPLICATE or FALSE_POSITIVE


@router.post("/check", response_model=FraudCheckResult)
async def check_dossier(request: CheckRequest) -> FraudCheckResult:
    """
    Submit a beneficiary dossier for fraud and duplicate checks.
    Returns a FraudCheckResult with decision, flags, and duplicates.
    """
    try:
        result = antifraud_agent.process_dossier(request.dossier, request.context)
        return result
    except Exception as exc:
        logger.error("antifraud_router.check_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/queue", response_model=list[FraudCheckResult])
async def get_review_queue() -> list[FraudCheckResult]:
    """Return dossiers awaiting human review."""
    return antifraud_agent.get_queue()


@router.get("/stats")
async def get_stats() -> dict:
    """Return aggregate fraud detection statistics."""
    return antifraud_agent.get_stats()


@router.get("/duplicates")
async def get_all_duplicates() -> list[dict]:
    """Return all dossiers where duplicates were detected."""
    return antifraud_agent.get_all_duplicates()


@router.post("/duplicates/{dossier_id}/resolve")
async def resolve_duplicate(dossier_id: str, request: ResolveRequest) -> dict:
    """Mark a duplicate as resolved (CONFIRMED_DUPLICATE or FALSE_POSITIVE)."""
    valid_resolutions = {"CONFIRMED_DUPLICATE", "FALSE_POSITIVE"}
    if request.resolution not in valid_resolutions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid resolution. Must be one of: {valid_resolutions}",
        )
    success = antifraud_agent.resolve_duplicate(dossier_id, request.resolution)
    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"Dossier '{dossier_id}' not found in registry",
        )
    return {
        "dossier_id": dossier_id,
        "resolution": request.resolution,
        "status": "resolved",
    }
