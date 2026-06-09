"""
Model version registry for SINAUR-RDC risk models.
"""
from __future__ import annotations

import structlog

from agents.prediction.models.base import BaseRiskModel
from schemas.risk import RiskType

logger = structlog.get_logger(__name__)


class ModelRegistry:
    """Registry for risk model instances, keyed by RiskType."""

    def __init__(self) -> None:
        self._models: dict[RiskType, BaseRiskModel] = {}

    def register(self, model: BaseRiskModel) -> None:
        """Register a model instance for its risk_type."""
        self._models[model.risk_type] = model
        logger.info(
            "model_registry.registered",
            risk_type=model.risk_type.value,
            version=model.version,
        )

    def get(self, risk_type: RiskType) -> BaseRiskModel:
        """Get a registered model by risk type. Raises KeyError if not found."""
        if risk_type not in self._models:
            raise KeyError(f"No model registered for risk type: {risk_type}")
        return self._models[risk_type]

    def list_versions(self) -> list[dict]:
        """Return a list of registered model metadata."""
        return [
            {
                "risk_type": rt.value,
                "version": model.version,
                "class": type(model).__name__,
            }
            for rt, model in self._models.items()
        ]

    def all_risk_types(self) -> list[RiskType]:
        """Return all registered risk types."""
        return list(self._models.keys())


# Module-level registry singleton — auto-populated at import
registry = ModelRegistry()


def _auto_register() -> None:
    from agents.prediction.models.displacement import DisplacementRiskModel
    from agents.prediction.models.epidemic import EpidemicRiskModel
    from agents.prediction.models.flood import FloodRiskModel
    from agents.prediction.models.landslide import LandslideRiskModel

    registry.register(FloodRiskModel())
    registry.register(LandslideRiskModel())
    registry.register(DisplacementRiskModel())
    registry.register(EpidemicRiskModel())
    logger.info("model_registry.auto_registered", count=len(registry.list_versions()))


_auto_register()
