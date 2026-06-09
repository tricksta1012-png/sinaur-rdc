"""
Anti-fraud rule definitions for SINAUR-RDC beneficiary dossiers.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

import structlog

from schemas.fraud import FraudFlag

logger = structlog.get_logger(__name__)

# In-memory trackers (populated by AntiFraudAgent)
# phone → list of submission timestamps
PHONE_SUBMISSIONS: dict[str, list[datetime]] = {}
# agent_id → list of registration timestamps
AGENT_REGISTRATIONS: dict[str, list[datetime]] = {}
# sinistre_id → set of dossier_ids
SINISTRE_REGISTRATIONS: dict[str, set[str]] = {}
# dossier_id → set of sinistre_ids
DOSSIER_SINISTRES: dict[str, set[str]] = {}


@dataclass
class Rule:
    rule_id: str
    description: str
    severity: str  # LOW, MEDIUM, HIGH, CRITICAL

    def evaluate(self, dossier: dict, context: dict) -> FraudFlag:
        """
        Evaluate this rule against a dossier and its context.
        Subclasses override this, or provide a callable evaluator.
        Returns a FraudFlag with triggered=True/False.
        """
        raise NotImplementedError


@dataclass
class MultiSubmissionSpeedRule(Rule):
    rule_id: str = "MULTI_SUBMISSION_SPEED"
    description: str = "Plus de 3 dossiers depuis le même téléphone en 24h"
    severity: str = "HIGH"
    threshold: int = 3
    window_hours: int = 24

    def evaluate(self, dossier: dict, context: dict) -> FraudFlag:
        phone: str = dossier.get("telephone", "")
        now = datetime.now(timezone.utc)
        timestamps = PHONE_SUBMISSIONS.get(phone, [])
        recent = [
            t for t in timestamps
            if (now - t).total_seconds() <= self.window_hours * 3600
        ]
        triggered = len(recent) >= self.threshold
        if triggered:
            logger.warning(
                "rule.triggered",
                rule=self.rule_id,
                phone=phone,
                count=len(recent),
            )
        return FraudFlag(
            rule_id=self.rule_id,
            description=self.description,
            severity=self.severity,
            triggered=triggered,
        )


@dataclass
class MassRegistrationAgentRule(Rule):
    rule_id: str = "MASS_REGISTRATION_AGENT"
    description: str = "Agent ayant enregistré > 50 dossiers en 1h"
    severity: str = "CRITICAL"
    threshold: int = 50
    window_hours: int = 1

    def evaluate(self, dossier: dict, context: dict) -> FraudFlag:
        agent_id: str = dossier.get("agent_id", "")
        if not agent_id:
            return FraudFlag(
                rule_id=self.rule_id,
                description=self.description,
                severity=self.severity,
                triggered=False,
            )
        now = datetime.now(timezone.utc)
        timestamps = AGENT_REGISTRATIONS.get(agent_id, [])
        recent = [
            t for t in timestamps
            if (now - t).total_seconds() <= self.window_hours * 3600
        ]
        triggered = len(recent) > self.threshold
        if triggered:
            logger.warning(
                "rule.triggered",
                rule=self.rule_id,
                agent_id=agent_id,
                count=len(recent),
            )
        return FraudFlag(
            rule_id=self.rule_id,
            description=self.description,
            severity=self.severity,
            triggered=triggered,
        )


@dataclass
class LocationMismatchRule(Rule):
    rule_id: str = "LOCATION_MISMATCH"
    description: str = "P-code déclaré ≠ zone du sinistre"
    severity: str = "MEDIUM"

    def evaluate(self, dossier: dict, context: dict) -> FraudFlag:
        declared_pcode: str = dossier.get("p_code", "")
        sinistre_pcode: str = context.get("sinistre_p_code", "")
        triggered = bool(
            declared_pcode
            and sinistre_pcode
            and declared_pcode.upper() != sinistre_pcode.upper()
        )
        return FraudFlag(
            rule_id=self.rule_id,
            description=self.description,
            severity=self.severity,
            triggered=triggered,
        )


@dataclass
class OutsideDisasterZoneRule(Rule):
    rule_id: str = "OUTSIDE_DISASTER_ZONE"
    description: str = "Localisation > 50km de la zone sinistrée"
    severity: str = "HIGH"

    def evaluate(self, dossier: dict, context: dict) -> FraudFlag:
        distance_km: float | None = context.get("distance_to_disaster_km")
        triggered = distance_km is not None and distance_km > 50.0
        return FraudFlag(
            rule_id=self.rule_id,
            description=self.description,
            severity=self.severity,
            triggered=triggered,
        )


@dataclass
class AgeInconsistencyRule(Rule):
    rule_id: str = "AGE_INCONSISTENCY"
    description: str = "Date de naissance incohérente"
    severity: str = "HIGH"

    def evaluate(self, dossier: dict, context: dict) -> FraudFlag:
        dob_str: str = dossier.get("date_naissance", "")
        triggered = False
        if dob_str:
            try:
                dob = datetime.strptime(dob_str[:10], "%Y-%m-%d")
                now = datetime.now()
                age_years = (now - dob).days / 365.25
                # Age < 0 or > 120 is inconsistent
                triggered = age_years < 0 or age_years > 120
            except ValueError:
                triggered = True  # Unparseable date is suspicious
        return FraudFlag(
            rule_id=self.rule_id,
            description=self.description,
            severity=self.severity,
            triggered=triggered,
        )


@dataclass
class HouseholdSizeAnomalyRule(Rule):
    rule_id: str = "HOUSEHOLD_SIZE_ANOMALY"
    description: str = "Ménage > 25 personnes"
    severity: str = "MEDIUM"

    def evaluate(self, dossier: dict, context: dict) -> FraudFlag:
        size: int | None = dossier.get("taille_menage")
        triggered = size is not None and int(size) > 25
        return FraudFlag(
            rule_id=self.rule_id,
            description=self.description,
            severity=self.severity,
            triggered=triggered,
        )


@dataclass
class DoubleAidAttemptRule(Rule):
    rule_id: str = "DOUBLE_AID_ATTEMPT"
    description: str = "Déjà enregistré pour cette aide dans ce sinistre"
    severity: str = "CRITICAL"

    def evaluate(self, dossier: dict, context: dict) -> FraudFlag:
        dossier_id: str = dossier.get("dossier_id", "")
        sinistre_id: str = context.get("sinistre_id", "")
        existing_ids = SINISTRE_REGISTRATIONS.get(sinistre_id, set())
        triggered = bool(dossier_id and dossier_id in existing_ids)
        return FraudFlag(
            rule_id=self.rule_id,
            description=self.description,
            severity=self.severity,
            triggered=triggered,
        )


@dataclass
class CrossSinistreDuplicateRule(Rule):
    rule_id: str = "CROSS_SINISTRE_DUPLICATE"
    description: str = "Même identité dans 3 sinistres simultanés"
    severity: str = "HIGH"

    def evaluate(self, dossier: dict, context: dict) -> FraudFlag:
        dossier_id: str = dossier.get("dossier_id", "")
        sinistres = DOSSIER_SINISTRES.get(dossier_id, set())
        triggered = len(sinistres) >= 3
        return FraudFlag(
            rule_id=self.rule_id,
            description=self.description,
            severity=self.severity,
            triggered=triggered,
        )


# Registry of all rules in evaluation order
RULES: list[Rule] = [
    MultiSubmissionSpeedRule(),
    MassRegistrationAgentRule(),
    LocationMismatchRule(),
    OutsideDisasterZoneRule(),
    AgeInconsistencyRule(),
    HouseholdSizeAnomalyRule(),
    DoubleAidAttemptRule(),
    CrossSinistreDuplicateRule(),
]


def evaluate_all(dossier: dict, context: dict) -> list[FraudFlag]:
    """Evaluate all rules and return a list of FraudFlag results."""
    flags: list[FraudFlag] = []
    for rule in RULES:
        try:
            flag = rule.evaluate(dossier, context)
            flags.append(flag)
        except Exception as exc:
            logger.error(
                "rules.evaluation_error",
                rule_id=rule.rule_id,
                error=str(exc),
            )
            flags.append(
                FraudFlag(
                    rule_id=rule.rule_id,
                    description=rule.description,
                    severity=rule.severity,
                    triggered=False,
                )
            )
    return flags
