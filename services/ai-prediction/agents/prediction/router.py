"""
Prediction agent internal API endpoints.
"""
from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException, Query

from agents.prediction.agent import prediction_agent
from agents.prediction.cap_emitter import (
    PENDING_ALERTS,
    get_pending_alerts,
    reject_alert,
    validate_alert,
)
from agents.prediction.models.registry import registry
from agents.prediction.risk_map import build_risk_map
from schemas.risk import RiskMap, RiskScore, RiskType

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/internal/prediction", tags=["prediction"])


@router.get("/risks", response_model=list[RiskScore])
async def list_risks(
    horizon: int = Query(default=7, description="Prediction horizon in days"),
    province: str | None = Query(default=None, description="P-code filter (e.g. CD-NK)"),
    type: str | None = Query(default=None, description="RiskType filter (e.g. FLOOD)"),
) -> list[RiskScore]:
    """Return current risk scores with optional filters."""
    risk_type: RiskType | None = None
    if type is not None:
        try:
            risk_type = RiskType(type.upper())
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown risk type '{type}'. Valid: {[rt.value for rt in RiskType]}",
            )
    return prediction_agent.get_scores(horizon=horizon, p_code=province, risk_type=risk_type)


@router.get("/map/{horizon}", response_model=RiskMap)
async def get_risk_map(
    horizon: int,
    type: str | None = Query(default=None, description="Optional RiskType filter"),
) -> RiskMap:
    """Return GeoJSON risk map for a given horizon."""
    risk_type: RiskType | None = None
    if type is not None:
        try:
            risk_type = RiskType(type.upper())
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown risk type '{type}'",
            )

    scores = prediction_agent.get_scores(horizon=horizon, risk_type=risk_type)
    return build_risk_map(scores, horizon_days=horizon, risk_type=risk_type)


@router.get("/alerts/pending")
async def list_pending_alerts() -> list[dict]:
    """Return all alerts awaiting human validation."""
    return get_pending_alerts()


@router.post("/alerts/{alert_id}/validate")
async def validate_alert_endpoint(alert_id: str) -> dict:
    """Mark an alert as validated (human decision)."""
    if alert_id not in PENDING_ALERTS:
        raise HTTPException(status_code=404, detail=f"Alert '{alert_id}' not found")
    success = validate_alert(alert_id)
    if not success:
        raise HTTPException(status_code=400, detail="Could not validate alert")
    return {"status": "VALIDATED", "alert_id": alert_id}


@router.post("/alerts/{alert_id}/reject")
async def reject_alert_endpoint(alert_id: str) -> dict:
    """Mark an alert as rejected (human decision)."""
    if alert_id not in PENDING_ALERTS:
        raise HTTPException(status_code=404, detail=f"Alert '{alert_id}' not found")
    success = reject_alert(alert_id)
    if not success:
        raise HTTPException(status_code=400, detail="Could not reject alert")
    return {"status": "REJECTED", "alert_id": alert_id}


@router.get("/history/{p_code}", response_model=list[RiskScore])
async def get_history(p_code: str) -> list[RiskScore]:
    """Return all stored risk scores for a given province (all types and horizons)."""
    scores = prediction_agent.get_history(p_code.upper())
    if not scores:
        raise HTTPException(
            status_code=404,
            detail=f"No scores found for province '{p_code}'",
        )
    return sorted(scores, key=lambda s: s.score, reverse=True)


@router.get("/models")
async def list_models() -> list[dict]:
    """List registered risk models and their versions."""
    return registry.list_versions()
