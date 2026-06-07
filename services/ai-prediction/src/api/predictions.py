"""
Endpoints REST du service de prédiction IA SINAUR-RDC.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from ..models.risk_model import (
    predict_all_hazards, get_model, HAZARD_TYPES,
)
from ..database import fetch_all, engine
from sqlalchemy import text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/predictions", tags=["predictions"])

# P-codes des 26 provinces RDC
ALL_PROVINCE_PCODES = [f"CD{i:02d}" for i in range(1, 27)] + ["COD"]


class ProvinceRiskResponse(BaseModel):
    pcode: str
    predictions: list[dict[str, Any]]
    generated_at: str


class NationalRiskResponse(BaseModel):
    total_provinces: int
    top_risks: list[dict[str, Any]]
    critical_count: int
    high_count: int
    generated_at: str


class RiskMapItem(BaseModel):
    pcode: str
    hazard_type: str
    horizon: str
    score: int
    level: str
    uncertainty: float
    updated_at: str


@router.get("/health")
def health():
    return {"status": "ok", "service": "ai-prediction", "models_loaded": list(HAZARD_TYPES)}


@router.post("/province/{pcode}", response_model=ProvinceRiskResponse)
def predict_province(pcode: str, background_tasks: BackgroundTasks):
    """
    Calcule les scores de risque pour tous les aléas et horizons pour une province.
    Stocke les résultats en base en arrière-plan.
    """
    pcode = pcode.upper()
    predictions = predict_all_hazards(pcode)
    if not predictions:
        raise HTTPException(status_code=404, detail=f"Aucune prédiction disponible pour {pcode}")

    background_tasks.add_task(_persist_predictions, predictions)

    return ProvinceRiskResponse(
        pcode=pcode,
        predictions=predictions,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/national", response_model=NationalRiskResponse)
def predict_national(background_tasks: BackgroundTasks):
    """
    Calcule les scores pour toutes les provinces, retourne les 20 risques les plus élevés.
    """
    all_results: list[dict[str, Any]] = []
    for pcode in ALL_PROVINCE_PCODES:
        try:
            preds = predict_all_hazards(pcode)
            all_results.extend(preds)
        except Exception as e:
            logger.warning(f"predict_national: failed for {pcode}: {e}")

    if all_results:
        background_tasks.add_task(_persist_predictions, all_results)

    all_results.sort(key=lambda x: x["score"], reverse=True)
    top_risks = all_results[:20]
    critical_count = sum(1 for r in all_results if r["level"] == "critical")
    high_count = sum(1 for r in all_results if r["level"] == "high")

    return NationalRiskResponse(
        total_provinces=len(ALL_PROVINCE_PCODES),
        top_risks=top_risks,
        critical_count=critical_count,
        high_count=high_count,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/trigger-refresh")
async def trigger_refresh(background_tasks: BackgroundTasks):
    """
    Déclenche un recalcul complet de toutes les prédictions (tâche en arrière-plan).
    """
    background_tasks.add_task(_full_refresh)
    return {"status": "refresh_scheduled", "provinces": len(ALL_PROVINCE_PCODES)}


@router.get("/risk-map", response_model=list[RiskMapItem])
def get_risk_map(horizon: str = "30d"):
    """
    Retourne les scores de risque courants depuis la vue matérialisée (DB).
    Utilisé par la carte côté frontend.
    """
    if horizon not in ("7d", "30d", "90d"):
        raise HTTPException(status_code=400, detail="horizon doit être 7d, 30d ou 90d")

    rows = fetch_all(
        """
        SELECT pcode, hazard_type, horizon, score, level, uncertainty,
               updated_at
        FROM current_risk_scores
        WHERE horizon = :horizon
          AND score > 10
        ORDER BY score DESC
        LIMIT 500
        """,
        {"horizon": horizon},
    )
    if not rows:
        # Pas encore de données en DB → calcul à la volée pour 7 premières provinces
        fallback = []
        for pcode in ALL_PROVINCE_PCODES[:7]:
            try:
                preds = predict_all_hazards(pcode)
                fallback.extend([p for p in preds if p["horizon"] == horizon])
            except Exception:
                pass
        rows = [
            {
                "pcode": p["pcode"],
                "hazard_type": p["hazard_type"],
                "horizon": p["horizon"],
                "score": p["score"],
                "level": p["level"],
                "uncertainty": p["uncertainty"],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            for p in fallback
        ]

    return [
        RiskMapItem(
            pcode=r["pcode"],
            hazard_type=r["hazard_type"],
            horizon=r["horizon"],
            score=int(r["score"]),
            level=r["level"],
            uncertainty=float(r.get("uncertainty", 0.5)),
            updated_at=str(r.get("updated_at", datetime.now(timezone.utc).isoformat())),
        )
        for r in rows
    ]


@router.get("/province/{pcode}/hazard/{hazard_type}")
def predict_single(pcode: str, hazard_type: str, horizon: str = "30d"):
    """Prédiction pour un aléa spécifique avec tous les détails d'explicabilité."""
    if hazard_type not in HAZARD_TYPES:
        raise HTTPException(status_code=400, detail=f"Type d'aléa inconnu: {hazard_type}")
    if horizon not in ("7d", "30d", "90d"):
        raise HTTPException(status_code=400, detail="horizon doit être 7d, 30d ou 90d")

    try:
        model = get_model(hazard_type)
        result = model.predict(pcode.upper(), horizon)
        return result
    except Exception as e:
        logger.error(f"predict_single error {pcode}/{hazard_type}/{horizon}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _persist_predictions(predictions: list[dict[str, Any]]) -> None:
    """Stocke les prédictions dans risk_predictions et rafraîchit la vue matérialisée."""
    if not predictions:
        return
    try:
        with engine.begin() as conn:
            for p in predictions:
                conn.execute(
                    text("""
                        INSERT INTO risk_predictions
                          (pcode, hazard_type, horizon, score, level, uncertainty,
                           contributing_factors, model_version, features_snapshot)
                        VALUES
                          (:pcode, :hazard_type::hazard_type, :horizon, :score, :level,
                           :uncertainty, :contributing_factors::jsonb,
                           :model_version, :features_snapshot::jsonb)
                    """),
                    {
                        "pcode": p["pcode"],
                        "hazard_type": p["hazard_type"],
                        "horizon": p["horizon"],
                        "score": p["score"],
                        "level": p["level"],
                        "uncertainty": p["uncertainty"],
                        "contributing_factors": __import__("json").dumps(p.get("contributing_factors", [])),
                        "model_version": p.get("model_version", "unknown"),
                        "features_snapshot": __import__("json").dumps(p.get("features_snapshot", {})),
                    },
                )
            # Rafraîchir la vue matérialisée
            conn.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY current_risk_scores"))
        logger.info(f"Persisted {len(predictions)} predictions")
    except Exception as e:
        logger.warning(f"Could not persist predictions: {e}")


def _full_refresh() -> None:
    """Recalcule et stocke toutes les prédictions pour toutes les provinces."""
    logger.info("Starting full prediction refresh")
    all_preds: list[dict[str, Any]] = []
    for pcode in ALL_PROVINCE_PCODES:
        try:
            preds = predict_all_hazards(pcode)
            all_preds.extend(preds)
        except Exception as e:
            logger.warning(f"full_refresh: {pcode} failed: {e}")
    _persist_predictions(all_preds)
    logger.info(f"Full refresh complete: {len(all_preds)} predictions stored")
