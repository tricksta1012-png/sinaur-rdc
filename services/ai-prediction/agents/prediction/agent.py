"""
PredictionAgent — orchestrates risk scoring across all 26 provinces × 4 risk types.
"""
from __future__ import annotations

from datetime import datetime, timezone

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler

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


class PredictionAgent:
    """
    Computes risk scores for all 26 provinces × 4 risk types every 6 hours.
    Emits CAP alerts when scores cross thresholds.
    """

    def __init__(self) -> None:
        self._scheduler = AsyncIOScheduler(timezone="UTC")

    async def start(self) -> None:
        """Register prediction job and start scheduler."""
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
