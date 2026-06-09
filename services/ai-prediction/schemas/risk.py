"""
Risk assessment schemas for SINAUR-RDC AI Prediction Service.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class RiskType(str, Enum):
    FLOOD = "FLOOD"
    LANDSLIDE = "LANDSLIDE"
    DISPLACEMENT = "DISPLACEMENT"
    EPIDEMIC = "EPIDEMIC"


class RiskLevel(str, Enum):
    FAIBLE = "FAIBLE"
    MODERE = "MODERE"
    ELEVE = "ELEVE"
    CRITIQUE = "CRITIQUE"


class FactorContribution(BaseModel):
    name: str
    value: float | str | bool
    contribution: float  # positive = increases risk
    direction: str  # "+" or "-"


class RiskScore(BaseModel):
    p_code: str
    province: str
    risk_type: RiskType
    score: float  # 0-100
    level: RiskLevel
    horizon_days: int
    factors: list[FactorContribution]
    computed_at: datetime
    model_version: str
    confidence: float


class CAPAlert(BaseModel):
    alert_id: str
    p_code: str
    province: str
    risk_type: RiskType
    risk_level: RiskLevel
    score: float
    cap_xml: str
    status: str  # PENDING_VALIDATION, VALIDATED, REJECTED
    created_at: datetime


class RiskMapFeature(BaseModel):
    type: str = "Feature"
    geometry: dict
    properties: dict


class RiskMap(BaseModel):
    type: str = "FeatureCollection"
    features: list[RiskMapFeature]
    generated_at: datetime
    horizon_days: int
    risk_type: str | None = None
