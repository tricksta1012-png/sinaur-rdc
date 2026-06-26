"""
PredictionAgent — orchestrates risk scoring across all 26 provinces × 4 risk types.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import text

from agents.prediction.cap_emitter import emit_cap_alert
from agents.prediction.features import PROVINCE_GEO, FeatureBuilder
from agents.prediction.models.registry import registry
from schemas.risk import RiskLevel, RiskScore, RiskType

logger = structlog.get_logger(__name__)

# In-memory risk score store: (p_code, risk_type, horizon_days) → RiskScore
_RISK_STORE: dict[tuple[str, str, int], RiskScore] = {}

# Alert threshold: emit CAP if score crosses this
_ALERT_THRESHOLD_SCORE = 60.0

_ALL_PCODES = list(PROVINCE_GEO.keys())
_ALL_RISK_TYPES = [RiskType.FLOOD, RiskType.LANDSLIDE, RiskType.DISPLACEMENT, RiskType.EPIDEMIC]
_HORIZONS = [7]  # primary horizon in days; extend with [7, 14, 30] for future

_feature_builder = FeatureBuilder()

# COD-AB p_code (DB FK) ← prediction p_code (CD-NK style)
_PRED_TO_CODAB: dict[str, str] = {
    "CD-NK": "CD61", "CD-SK": "CD62", "CD-MN": "CD63",
    "CD-HK": "CD71", "CD-IT": "CD54", "CD-TP": "CD51",
    "CD-BU": "CD52", "CD-MO": "CD44", "CD-SA": "CD42",
    "CD-NU": "CD43", "CD-EQ": "CD41", "CD-HL": "CD73",
    "CD-TA": "CD74", "CD-LO": "CD72", "CD-HU": "CD53",
    "CD-SU": "CD85", "CD-KC": "CD83", "CD-KC2": "CD84",
    "CD-MK": "CD82", "CD-LM": "CD81", "CD-KW": "CD22",
    "CD-KO": "CD21", "CD-MN2": "CD23", "CD-BC": "CD20",
    "CD-KN": "CD10",
}
_CODAB_TO_PRED: dict[str, str] = {v: k for k, v in _PRED_TO_CODAB.items()}

_RISK_TYPE_TO_HAZARD: dict[str, str] = {
    RiskType.FLOOD.value:        "flood",
    RiskType.LANDSLIDE.value:    "landslide",
    RiskType.DISPLACEMENT.value: "mass_displacement",
    RiskType.EPIDEMIC.value:     "health_epidemic",
}
_HAZARD_TO_RISK_TYPE: dict[str, str] = {v: k for k, v in _RISK_TYPE_TO_HAZARD.items()}

_LEVEL_TO_DB: dict[str, str] = {
    RiskLevel.FAIBLE.value:   "low",
    RiskLevel.MODERE.value:   "medium",
    RiskLevel.ELEVE.value:    "high",
    RiskLevel.CRITIQUE.value: "critical",
}
_DB_TO_LEVEL: dict[str, str] = {v: k for k, v in _LEVEL_TO_DB.items()}


class PredictionAgent:
    """
    Computes risk scores for all 26 provinces × 4 risk types every 6 hours.
    Emits CAP alerts when scores cross thresholds.
    """

    def __init__(self) -> None:
        self._scheduler = AsyncIOScheduler(timezone="UTC")

    async def start(self) -> None:
        """Register prediction job and start scheduler."""
        await self._load_from_db()
        self._scheduler.add_job(
            self._run_all_predictions,
            "interval",
            hours=6,
            id="prediction_full_run",
            name="PredictionAgent:full_run",
            next_run_time=datetime.now(timezone.utc),
            misfire_grace_time=600,
            coalesce=True,
        )
        self._scheduler.start()
        logger.info("prediction_agent.started")

    async def stop(self) -> None:
        """Stop the scheduler."""
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
        logger.info("prediction_agent.stopped")

    async def _run_all_predictions(self) -> None:
        """Compute RiskScores for all provinces × risk types × horizons."""
        computed = 0
        alerts_emitted = 0

        for p_code in _ALL_PCODES:
            geo = PROVINCE_GEO.get(p_code, {})
            province = geo.get("province", p_code)

            for horizon_days in _HORIZONS:
                features = _feature_builder.build(p_code, horizon_days)
                features["p_code"] = p_code
                features["province"] = province

                for risk_type in _ALL_RISK_TYPES:
                    try:
                        model = registry.get(risk_type)
                        risk_score = model.predict(features)
                        key = (p_code, risk_type.value, horizon_days)
                        previous = _RISK_STORE.get(key)
                        _RISK_STORE[key] = risk_score
                        computed += 1

                        # Emit CAP alert on threshold crossing
                        if risk_score.score >= _ALERT_THRESHOLD_SCORE:
                            if previous is None or previous.score < _ALERT_THRESHOLD_SCORE:
                                emit_cap_alert(risk_score)
                                alerts_emitted += 1
                                logger.warning(
                                    "prediction_agent.threshold_crossed",
                                    p_code=p_code,
                                    risk_type=risk_type.value,
                                    score=risk_score.score,
                                    level=risk_score.level.value,
                                )

                    except Exception as exc:
                        logger.error(
                            "prediction_agent.predict_failed",
                            p_code=p_code,
                            risk_type=risk_type.value,
                            error=str(exc),
                        )

        logger.info(
            "prediction_agent.run_complete",
            computed=computed,
            alerts_emitted=alerts_emitted,
            provinces=len(_ALL_PCODES),
        )
        await self._persist_scores()

    async def _persist_scores(self) -> None:
        """Upsert current risk scores to DB and refresh the materialized view."""
        if not _RISK_STORE:
            return
        try:
            from db import engine
            async with engine.begin() as conn:
                for (p_code, risk_type_val, horizon_days), score in _RISK_STORE.items():
                    codab = _PRED_TO_CODAB.get(p_code)
                    hazard = _RISK_TYPE_TO_HAZARD.get(risk_type_val)
                    if not codab or not hazard:
                        continue
                    now = datetime.now(timezone.utc)
                    await conn.execute(
                        text("""
                            INSERT INTO risk_predictions
                                (pcode, hazard_type, horizon, score, level, model_version,
                                 predicted_at, valid_from, valid_until,
                                 contributing_factors, uncertainty)
                            VALUES
                                (:pcode, CAST(:hazard AS hazard_type),
                                 CAST(:horizon AS risk_horizon),
                                 :score, :level, :model_version,
                                 :predicted_at, :valid_from, :valid_until,
                                 CAST(:factors AS jsonb), :uncertainty)
                        """),
                        {
                            "pcode":         codab,
                            "hazard":        hazard,
                            "horizon":       f"{horizon_days}d",
                            "score":         int(score.score),
                            "level":         _LEVEL_TO_DB.get(score.level.value, "low"),
                            "model_version": score.model_version,
                            "predicted_at":  score.computed_at,
                            "valid_from":    now,
                            "valid_until":   now + timedelta(days=horizon_days),
                            "factors":       json.dumps([f.model_dump() for f in score.factors]),
                            "uncertainty":   max(0.0, min(1.0, 1.0 - score.confidence)),
                        },
                    )
                await conn.execute(
                    text("REFRESH MATERIALIZED VIEW CONCURRENTLY current_risk_scores")
                )
            logger.info("prediction_agent.db_persisted", scores=len(_RISK_STORE))
        except Exception as exc:
            logger.error("prediction_agent.db_persist_failed", error=str(exc))

    async def _load_from_db(self) -> None:
        """Restore _RISK_STORE from current_risk_scores on startup."""
        try:
            from db import engine
            async with engine.connect() as conn:
                rows = await conn.execute(text("""
                    SELECT pcode, hazard_type, horizon, score, level,
                           uncertainty, contributing_factors, predicted_at
                    FROM current_risk_scores
                """))
                for row in rows:
                    pred_code = _CODAB_TO_PRED.get(row.pcode)
                    risk_type_val = _HAZARD_TO_RISK_TYPE.get(row.hazard_type)
                    if not pred_code or not risk_type_val:
                        continue
                    horizon_days = int(str(row.horizon).replace("d", ""))
                    level_val = _DB_TO_LEVEL.get(row.level, RiskLevel.FAIBLE.value)
                    geo = PROVINCE_GEO.get(pred_code, {})
                    _RISK_STORE[(pred_code, risk_type_val, horizon_days)] = RiskScore(
                        p_code=pred_code,
                        province=geo.get("province", pred_code),
                        risk_type=RiskType(risk_type_val),
                        score=float(row.score),
                        level=RiskLevel(level_val),
                        horizon_days=horizon_days,
                        factors=[],
                        computed_at=row.predicted_at,
                        model_version="restored",
                        confidence=max(0.0, min(1.0, 1.0 - float(row.uncertainty))),
                    )
            logger.info("prediction_agent.db_loaded", scores=len(_RISK_STORE))
        except Exception as exc:
            logger.warning("prediction_agent.db_load_failed", error=str(exc))

    def get_scores(
        self,
        horizon: int = 7,
        p_code: str | None = None,
        risk_type: RiskType | None = None,
    ) -> list[RiskScore]:
        """Return stored RiskScores with optional filters."""
        results = []
        for (pc, rt, h), score in _RISK_STORE.items():
            if h != horizon:
                continue
            if p_code is not None and pc != p_code.upper():
                continue
            if risk_type is not None and rt != risk_type.value:
                continue
            results.append(score)
        return sorted(results, key=lambda s: s.score, reverse=True)

    def get_history(self, p_code: str) -> list[RiskScore]:
        """Return all stored scores for a given p_code (all horizons and types)."""
        return [
            score
            for (pc, _, _), score in _RISK_STORE.items()
            if pc == p_code.upper()
        ]


# Module-level singleton
prediction_agent = PredictionAgent()
