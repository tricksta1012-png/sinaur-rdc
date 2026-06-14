from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel

class IntelCategory(str, Enum):
    ACTIVITE_MILITAIRE = "ACTIVITE_MILITAIRE"
    DEPLACEMENT = "DEPLACEMENT"
    INCIDENT_SECURITAIRE = "INCIDENT_SECURITAIRE"
    DOMMAGE_INFRASTRUCTURE = "DOMMAGE_INFRASTRUCTURE"
    NEGOCIATION = "NEGOCIATION"
    AUTRE = "AUTRE"

class ThreatLevel(int, Enum):
    STABLE = 1
    VIGILANCE = 2
    ELEVE = 3
    SEVERE = 4
    CRITIQUE = 5

class IntelEvent(BaseModel):
    source_id: str
    external_id: str
    title: str
    date: str
    content: str
    url: Optional[str] = None
    reliability: float = 0.7
    category: IntelCategory = IntelCategory.AUTRE
    p_code: Optional[str] = None
    province: Optional[str] = None
    territoire: Optional[str] = None
    actor_names: list[str] = []

class ActorActivity(BaseModel):
    nom: str
    province: str
    incident_count_30d: int
    trend: str  # "EN_HAUSSE" | "STABLE" | "EN_BAISSE"
    threat_to_civilians: int  # 1-5
    last_activity_date: Optional[str] = None

class ProvinceAssessment(BaseModel):
    province: str
    p_code: str
    threat_level: ThreatLevel
    threat_label: str
    justification: str
    humanitarian_access: str
    recommended_actions: list[str]
    safe_corridors: list[str]
    active_actors: list[str]
    sources: list[str]
    confidence: float
    computed_at: str

class InfrastructureDamage(BaseModel):
    infra_type: str
    damage_level: str
    localisation: str
    p_code: Optional[str]
    date: str
    source: str
    description: str
    humanitarian_impact: str

class IntelBulletin(BaseModel):
    bulletin_id: str
    generated_at: str
    period_start: str
    period_end: str
    critical_count: int
    high_count: int
    summary: str
    province_assessments: list[ProvinceAssessment]
    key_events: list[IntelEvent]
