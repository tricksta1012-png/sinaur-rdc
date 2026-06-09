"""
Confidence scorer and decision engine for anti-fraud checks.
"""
from __future__ import annotations

import structlog

from schemas.fraud import Decision, DeduplicationResult, FraudFlag

logger = structlog.get_logger(__name__)

SEVERITY_PENALTIES: dict[str, float] = {
    "LOW": 5.0,
    "MEDIUM": 15.0,
    "HIGH": 25.0,
    "CRITICAL": 50.0,
}

BONUSES: dict[str, float] = {
    "otp_verified": 5.0,
    "hierarchy_validated": 10.0,
}


def compute_score(
    flags: list[FraudFlag],
    duplicates: list[DeduplicationResult],
    bonuses: dict[str, bool],
) -> tuple[float, Decision]:
    """
    Compute a confidence score (0-100) and a Decision.

    Score starts at 100 and is penalized by triggered flags.
    Bonuses (OTP verification, hierarchy validation) can restore points.

    Decision rules:
    - Any CRITICAL flag → AUTO_REJECTED regardless of score
    - score < 50 → AUTO_REJECTED
    - Any HIGH flag or score < 80 → NEEDS_REVIEW
    - Otherwise → AUTO_APPROVED
    """
    score = 100.0

    # Apply penalties for triggered flags
    for flag in flags:
        if flag.triggered:
            penalty = SEVERITY_PENALTIES.get(flag.severity, 0.0)
            score -= penalty
            logger.debug(
                "scorer.penalty_applied",
                rule_id=flag.rule_id,
                severity=flag.severity,
                penalty=penalty,
            )

    # Apply duplicate penalty — severity scales with similarity:
    # ≥ 0.95 (probable duplicate) → heavy penalty, forces NEEDS_REVIEW
    # 0.80–0.94 (possible duplicate) → moderate penalty
    for dup in duplicates:
        if dup.similarity_score >= 0.95:
            score -= 35.0   # equivalent of a HIGH flag → forces NEEDS_REVIEW
        else:
            score -= 15.0
        logger.debug(
            "scorer.duplicate_penalty",
            candidate_id=dup.dossier_id,
            similarity=round(dup.similarity_score, 3),
        )

    score = max(0.0, score)

    # Apply bonuses
    for bonus_key, bonus_value in BONUSES.items():
        if bonuses.get(bonus_key):
            score = min(100.0, score + bonus_value)
            logger.debug("scorer.bonus_applied", bonus=bonus_key, value=bonus_value)

    # Determine decision
    has_critical = any(f.triggered and f.severity == "CRITICAL" for f in flags)
    has_high = any(f.triggered and f.severity == "HIGH" for f in flags)
    # A high-similarity duplicate (≥ 0.95) is treated as a HIGH-severity finding
    has_probable_duplicate = any(d.similarity_score >= 0.95 for d in duplicates)

    if score < 50.0 or has_critical:
        decision = Decision.AUTO_REJECTED
    elif score < 80.0 or has_high or has_probable_duplicate:
        decision = Decision.NEEDS_REVIEW
    else:
        decision = Decision.AUTO_APPROVED

    logger.info(
        "scorer.result",
        score=round(score, 2),
        decision=decision.value,
        has_critical=has_critical,
        has_high=has_high,
    )

    return round(score, 2), decision


def build_explanation(
    flags: list[FraudFlag],
    duplicates: list[DeduplicationResult],
    score: float,
    decision: Decision,
) -> str:
    """Build a human-readable explanation of the fraud check result."""
    triggered_flags = [f for f in flags if f.triggered]
    parts: list[str] = []

    if not triggered_flags and not duplicates:
        parts.append("Aucune anomalie détectée.")
    else:
        if triggered_flags:
            flag_descriptions = "; ".join(
                f"[{f.severity}] {f.description}" for f in triggered_flags
            )
            parts.append(f"Anomalies: {flag_descriptions}.")
        if duplicates:
            dup_count = len(duplicates)
            best_sim = max(d.similarity_score for d in duplicates)
            parts.append(
                f"{dup_count} doublon(s) potentiel(s) détecté(s) "
                f"(similarité max: {best_sim:.1%})."
            )

    parts.append(f"Score de confiance: {score:.0f}/100. Décision: {decision.value}.")
    return " ".join(parts)


# Internal constant mirrored from dedup_engine
_SIMILARITY_THRESHOLD = 0.80
