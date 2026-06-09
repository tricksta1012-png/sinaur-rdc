"""
Endpoints internes /internal/prediction — consommés par apps/api via aiClient.
Pont vers les modèles existants + gestion des alertes CAP nécessitant validation humaine.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from .auth import require_internal_key
from ..models.risk_model import predict_all_hazards, HAZARD_TYPES
from ..database import fetch_all, engine
from sqlalchemy import text

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/internal/prediction", tags=["internal-prediction"], dependencies=[Depends(require_internal_key)])

ALL_PROVINCE_PCODES = [f"CD{i:02d}" for i in range(1, 27)] + ["COD"]


# ── Scores de risque ─────────────────────────────────────────────────────────

@router.get("/risks")
def get_risks(horizon: int = 7, province: str | None = None, type: str | None = None):
    horizon_key = f"{horizon}d" if horizon in (7, 30, 90) else "30d"
    query = """
        SELECT pcode, hazard_type, horizon, score, level, uncertainty, updated_at
        FROM current_risk_scores
        WHERE horizon = :horizon AND score > 10
    """
    params: dict[str, Any] = {"horizon": horizon_key}
    if province:
        query += " AND pcode = :province"
        params["province"] = province.upper()
    if type:
        query += " AND hazard_type = :type"
        params["type"] = type
    query += " ORDER BY score DESC LIMIT 200"

    rows = fetch_all(query, params)
    if not rows and not province:
        # Fallback calcul à la volée pour les 5 premières provinces
        rows = _compute_fallback(horizon_key)

    return {"data": rows, "horizon": horizon_key, "count": len(rows)}


@router.get("/map/{horizon}")
def get_risk_map(horizon: int):
    if horizon not in (7, 30, 90):
        raise HTTPException(400, detail="horizon doit être 7, 30 ou 90")
    horizon_key = f"{horizon}d"
    rows = fetch_all(
        "SELECT pcode, hazard_type, horizon, score, level, uncertainty, updated_at "
        "FROM current_risk_scores WHERE horizon = :h AND score > 10 ORDER BY score DESC LIMIT 500",
        {"h": horizon_key},
    )
    if not rows:
        rows = _compute_fallback(horizon_key)
    return rows


@router.get("/alerts/pending")
def get_pending_alerts():
    rows = fetch_all(
        """
        SELECT id, identifier, headline, event, severity, urgency, certainty,
               description, instruction, area_desc, sent, status, msg_type,
               requires_validation, created_at
        FROM alerts
        WHERE requires_validation = TRUE AND status = 'actual'
        ORDER BY created_at DESC
        LIMIT 50
        """,
        {},
    )
    return {"data": rows, "count": len(rows)}


@router.post("/alerts/{alert_id}/validate")
def validate_alert(alert_id: str, body: dict):
    try:
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE alerts SET requires_validation = FALSE, status = 'actual' WHERE id = :id"),
                {"id": alert_id},
            )
        return {"success": True, "alert_id": alert_id, "validated_by": body.get("validated_by")}
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@router.post("/alerts/{alert_id}/reject")
def reject_alert(alert_id: str, body: dict):
    try:
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE alerts SET status = 'cancelled', requires_validation = FALSE WHERE id = :id"),
                {"id": alert_id},
            )
        return {"success": True, "alert_id": alert_id, "rejected_by": body.get("rejected_by"), "reason": body.get("reason")}
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@router.get("/history/{pcode}")
def get_history(pcode: str):
    rows = fetch_all(
        """
        SELECT pcode, hazard_type, horizon, score, level, uncertainty, created_at
        FROM risk_predictions
        WHERE pcode = :pcode
        ORDER BY created_at DESC
        LIMIT 200
        """,
        {"pcode": pcode.upper()},
    )
    return {"pcode": pcode.upper(), "history": rows, "count": len(rows)}


@router.get("/models")
def list_models():
    return {
        "models": [
            {"hazard_type": h, "version": "1.0.0", "algorithm": "GradientBoosting", "status": "active"}
            for h in HAZARD_TYPES
        ],
        "total": len(HAZARD_TYPES),
    }


@router.post("/refresh")
def refresh_all(background_tasks: BackgroundTasks):
    background_tasks.add_task(_full_refresh)
    return {"status": "refresh_scheduled", "provinces": len(ALL_PROVINCE_PCODES)}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _compute_fallback(horizon_key: str) -> list[dict]:
    results = []
    for pcode in ALL_PROVINCE_PCODES[:5]:
        try:
            preds = predict_all_hazards(pcode)
            results.extend([
                {**p, "updated_at": datetime.now(timezone.utc).isoformat()}
                for p in preds if p["horizon"] == horizon_key
            ])
        except Exception:
            pass
    return results


def _full_refresh():
    from .predictions import _persist_predictions
    logger.info("Full refresh triggered via /internal")
    all_preds: list[dict] = []
    for pcode in ALL_PROVINCE_PCODES:
        try:
            all_preds.extend(predict_all_hazards(pcode))
        except Exception as e:
            logger.warning(f"full_refresh {pcode}: {e}")
    _persist_predictions(all_preds)
    logger.info(f"Full refresh done: {len(all_preds)} predictions")
