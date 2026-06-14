"""
TruthFilter — validation multi-sources et scoring de fiabilité.

Algorithme:
  score_final = best_source_score
              + corroboration_bonus (0.10 par source supplémentaire, max 0.30)
              + institutional_bonus (0.10 si OMS/ONU/INSP)
              - contradiction_penalty (0.20 par source contradictoire)

Seuils de création automatique:
  EBOLA / VIRUS_EMERGENT  : 0.70  (urgence vitale — pas le temps d'attendre)
  INONDATION / CONFLIT    : 0.80
  SECHERESSE / AUTRE      : 0.90
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# Fiabilité par source (0.0 – 1.0)
SOURCE_RELIABILITY: dict[str, float] = {
    # Institutions internationales
    "OMS": 0.95,
    "WHO": 0.95,
    "OCHA": 0.92,
    "UNICEF": 0.90,
    "WFP": 0.90,
    "UNHCR": 0.90,
    "MSF": 0.88,
    # Sources institutionnelles RDC
    "INSP": 0.92,
    "MINISANTE": 0.88,
    "ORAF": 0.85,
    # Sources médias / alertes
    "RELIEFWEB": 0.80,
    "GDACS": 0.82,
    "FEWS_NET": 0.85,
    "PROMEDMAIL": 0.78,
    "HEALTHMAP": 0.72,
    "ECDC": 0.90,
    "CDC": 0.90,
    "AFRICA_CDC": 0.88,
    "PASTEUR": 0.90,
    "RADIO_OKAPI": 0.70,
    "ACLED": 0.82,
    # Signalements citoyens (moins fiables seuls)
    "APP_CITIZEN": 0.45,
    "SMS_USSD": 0.40,
    "RESEAUX_SOCIAUX": 0.30,
}

INSTITUTIONAL_SOURCES = {"OMS", "WHO", "OCHA", "UNICEF", "WFP", "UNHCR", "INSP", "MINISANTE", "ECDC", "CDC", "AFRICA_CDC", "PASTEUR"}

AUTO_CREATE_THRESHOLDS: dict[str, float] = {
    "EBOLA":           0.70,
    "VIRUS_EMERGENT":  0.70,
    "INONDATION":      0.80,
    "CONFLIT":         0.80,
    "SECHERESSE":      0.90,
    "DEPLACEMENT":     0.82,
    "DEFAULT":         0.85,
}


@dataclass
class SourceReport:
    source_id: str
    hazard_type: str
    location: str
    severity: str
    timestamp: datetime
    raw_data: dict[str, Any] = field(default_factory=dict)
    contradicts: list[str] = field(default_factory=list)


@dataclass
class FilterResult:
    score: float
    sources_used: list[str]
    best_source: str
    corroboration_count: int
    institutional_bonus: bool
    contradiction_count: int
    auto_create: bool
    hazard_type: str
    details: dict[str, Any] = field(default_factory=dict)


class TruthFilter:
    """
    Valide et scorifie un ensemble de rapports multi-sources pour décider
    si une crise doit être créée automatiquement.
    """

    def evaluate(self, reports: list[SourceReport], hazard_type: str) -> FilterResult:
        if not reports:
            return FilterResult(
                score=0.0, sources_used=[], best_source="", corroboration_count=0,
                institutional_bonus=False, contradiction_count=0, auto_create=False,
                hazard_type=hazard_type,
            )

        # Score de la meilleure source
        scored = sorted(reports, key=lambda r: SOURCE_RELIABILITY.get(r.source_id.upper(), 0.30), reverse=True)
        best = scored[0]
        best_score = SOURCE_RELIABILITY.get(best.source_id.upper(), 0.30)

        # Bonus de corroboration
        corroboration_count = len(scored) - 1
        corroboration_bonus = min(0.30, corroboration_count * 0.10)

        # Bonus institutionnel
        institutional_bonus = any(r.source_id.upper() in INSTITUTIONAL_SOURCES for r in reports)
        inst_bonus_value = 0.10 if institutional_bonus else 0.0

        # Pénalité de contradiction
        contradiction_count = sum(len(r.contradicts) for r in reports)
        contradiction_penalty = min(0.40, contradiction_count * 0.20)

        score = best_score + corroboration_bonus + inst_bonus_value - contradiction_penalty
        score = max(0.0, min(1.0, round(score, 4)))

        threshold = AUTO_CREATE_THRESHOLDS.get(hazard_type.upper(), AUTO_CREATE_THRESHOLDS["DEFAULT"])
        auto_create = score >= threshold

        logger.info(
            "truth_filter.evaluated",
            hazard_type=hazard_type,
            score=score,
            threshold=threshold,
            auto_create=auto_create,
            sources=[r.source_id for r in reports],
        )

        return FilterResult(
            score=score,
            sources_used=[r.source_id for r in reports],
            best_source=best.source_id,
            corroboration_count=corroboration_count,
            institutional_bonus=institutional_bonus,
            contradiction_count=contradiction_count,
            auto_create=auto_create,
            hazard_type=hazard_type,
            details={
                "best_score": best_score,
                "corroboration_bonus": corroboration_bonus,
                "institutional_bonus_value": inst_bonus_value,
                "contradiction_penalty": contradiction_penalty,
                "threshold": threshold,
            },
        )


# Module-level singleton
truth_filter = TruthFilter()
