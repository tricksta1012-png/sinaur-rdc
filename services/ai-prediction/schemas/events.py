"""
Event schemas for SINAUR-RDC AI Prediction Service.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class EventType(str, Enum):
    INONDATION = "INONDATION"
    GLISSEMENT = "GLISSEMENT"
    DEPLACEMENT = "DEPLACEMENT"
    EPIDEMIE = "EPIDEMIE"
    SECHERESSE = "SECHERESSE"
    VOLCAN = "VOLCAN"
    CONFLIT = "CONFLIT"
    AUTRE = "AUTRE"


class RawEvent(BaseModel):
    source_id: str
    external_id: str
    raw_data: dict
    fetched_at: datetime


class CanonicalEvent(BaseModel):
    source_id: str
    external_id: str
    glide_number: str | None = None
    event_type: EventType
    title: str
    description: str | None = None
    p_code: str | None = None
    province: str | None = None
    coordinates: tuple[float, float] | None = None  # (lon, lat)
    severity: int = 1  # 1-5
    source_url: str | None = None
    raw_data: dict = {}
    fetched_at: datetime
    reliability_score: float = 0.5  # 0.0-1.0

    # Corroboration inter-sources (rempli par Deduplicator + CorroborationEngine)
    sources_count: int = 1
    sources_list: list[str] = []
    corroboration_score: float = 0.0   # bonus calculé sur le croisement de sources
    needs_corroboration: bool = False  # True = signal précoce (GDELT) non encore confirmé

    # Décès vérifiés (UCDP fournit 3 estimations)
    fatalities_low: int | None = None
    fatalities_high: int | None = None
