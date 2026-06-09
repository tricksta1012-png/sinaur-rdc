"""
Abstract base class for all SINAUR-RDC risk models.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone

from schemas.risk import FactorContribution, RiskLevel, RiskScore, RiskType


def score_to_level(score: float) -> RiskLevel:
    """Convert a numeric score (0-100) to a RiskLevel enum."""
    if score >= 75:
        return RiskLevel.CRITIQUE
    if score >= 60:
        return RiskLevel.ELEVE
    if score >= 35:
        return RiskLevel.MODERE
    return RiskLevel.FAIBLE


class BaseRiskModel(ABC):
    risk_type: RiskType
    version: str = "1.0.0-rules"

    @abstractmethod
    def predict(self, features: dict) -> RiskScore:
        """
        Given a feature dict, return a RiskScore.
        The feature dict must contain all keys required by the model.
        """
        ...

    @abstractmethod
    def explain(self, features: dict) -> list[FactorContribution]:
        """
        Return a list of FactorContribution items explaining the score.
        """
        ...

    def _make_score(
        self,
        p_code: str,
        province: str,
        raw_score: float,
        factors: list[FactorContribution],
        horizon_days: int,
        confidence: float = 0.75,
    ) -> RiskScore:
        """Helper to build a RiskScore from a raw numeric score."""
        capped = min(100.0, max(0.0, raw_score))
        return RiskScore(
            p_code=p_code,
            province=province,
            risk_type=self.risk_type,
            score=capped,
            level=score_to_level(capped),
            horizon_days=horizon_days,
            factors=factors,
            computed_at=datetime.now(timezone.utc),
            model_version=self.version,
            confidence=confidence,
        )
