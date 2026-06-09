"""
Anti-fraud schemas for SINAUR-RDC AI Prediction Service.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class Decision(str, Enum):
    AUTO_APPROVED = "AUTO_APPROVED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    AUTO_REJECTED = "AUTO_REJECTED"


class FraudFlag(BaseModel):
    rule_id: str
    description: str
    severity: str  # LOW, MEDIUM, HIGH, CRITICAL
    triggered: bool


class DeduplicationResult(BaseModel):
    dossier_id: str
    similarity_score: float
    match_fields: dict
    status: str


class FraudCheckResult(BaseModel):
    dossier_id: str
    confidence_score: float
    decision: Decision
    flags: list[FraudFlag]
    duplicates_found: list[DeduplicationResult]
    checked_at: datetime
    explanation: str
