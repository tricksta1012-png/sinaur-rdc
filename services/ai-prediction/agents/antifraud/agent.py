"""
AntiFraudAgent — processes dossiers for duplicate detection and rule-based fraud scoring.
"""
from __future__ import annotations

from datetime import datetime, timezone

import structlog

from agents.antifraud.dedup_engine import DedupEngine
from agents.antifraud.rules import (
    AGENT_REGISTRATIONS,
    DOSSIER_SINISTRES,
    PHONE_SUBMISSIONS,
    SINISTRE_REGISTRATIONS,
    evaluate_all,
)
from agents.antifraud.scorer import build_explanation, compute_score
from schemas.fraud import Decision, FraudCheckResult

logger = structlog.get_logger(__name__)

# In-memory review queue for NEEDS_REVIEW decisions
REVIEW_QUEUE: list[FraudCheckResult] = []

# All processed results (for stats)
_ALL_RESULTS: list[FraudCheckResult] = []


class AntiFraudAgent:
    """
    Processes incoming dossiers:
    1. Deduplication via DedupEngine (Jaro-Winkler fuzzy matching)
    2. Rule evaluation (8 anti-fraud rules)
    3. Confidence scoring and decision (AUTO_APPROVED / NEEDS_REVIEW / AUTO_REJECTED)
    """

    def __init__(self) -> None:
        self._dedup = DedupEngine()

    def process_dossier(self, dossier: dict, context: dict | None = None) -> FraudCheckResult:
        """
        Process a single dossier and return a FraudCheckResult.

        Dossier fields expected:
          - dossier_id: str
          - nom_complet: str
          - date_naissance: str (YYYY-MM-DD)
          - taille_menage: int
          - p_code: str
          - telephone: str
          - agent_id: str (optional)

        Context fields expected:
          - sinistre_id: str
          - sinistre_p_code: str
          - distance_to_disaster_km: float (optional)
        """
        if context is None:
            context = {}

        dossier_id: str = dossier.get("dossier_id", f"dossier_{datetime.now(timezone.utc).timestamp()}")
        dossier["dossier_id"] = dossier_id

        # Track phone/agent rate before evaluation (window-based, not per-dossier)
        self._track_phone_submission(dossier)
        self._track_agent_registration(dossier)
        # NOTE: sinistre registration happens AFTER evaluation so the first
        # legitimate submission of a dossier doesn't trigger DOUBLE_AID_ATTEMPT.

        # Step 1: Find duplicates
        duplicates = self._dedup.find_duplicates(dossier)

        # Step 2: Add to registry for future dedup
        self._dedup.add_record(dossier)

        # Step 3: Evaluate rules (sinistre not yet registered → first sub = clean)
        flags = evaluate_all(dossier, context)

        # Step 4 (pre-score): register this dossier in the sinistre so the NEXT
        # identical submission correctly triggers DOUBLE_AID_ATTEMPT.
        self._track_sinistre_registration(dossier, context)

        # Step 5: Compute score and decision
        bonuses = {
            "otp_verified": bool(dossier.get("otp_verified")),
            "hierarchy_validated": bool(context.get("hierarchy_validated")),
        }
        score, decision = compute_score(flags, duplicates, bonuses)
        explanation = build_explanation(flags, duplicates, score, decision)

        result = FraudCheckResult(
            dossier_id=dossier_id,
            confidence_score=score,
            decision=decision,
            flags=flags,
            duplicates_found=duplicates,
            checked_at=datetime.now(timezone.utc),
            explanation=explanation,
        )

        _ALL_RESULTS.append(result)

        # Add to review queue if human action needed
        if decision == Decision.NEEDS_REVIEW:
            REVIEW_QUEUE.append(result)
            logger.info(
                "antifraud_agent.needs_review",
                dossier_id=dossier_id,
                score=score,
            )

        logger.info(
            "antifraud_agent.processed",
            dossier_id=dossier_id,
            decision=decision.value,
            score=score,
            duplicates=len(duplicates),
            flags_triggered=sum(1 for f in flags if f.triggered),
        )

        return result

    def _track_phone_submission(self, dossier: dict) -> None:
        """Track phone-based submission rate for MULTI_SUBMISSION_SPEED rule."""
        phone: str = dossier.get("telephone", "")
        if phone:
            if phone not in PHONE_SUBMISSIONS:
                PHONE_SUBMISSIONS[phone] = []
            PHONE_SUBMISSIONS[phone].append(datetime.now(timezone.utc))

    def _track_agent_registration(self, dossier: dict) -> None:
        """Track agent registration rate for MASS_REGISTRATION_AGENT rule."""
        agent_id: str = dossier.get("agent_id", "")
        if agent_id:
            if agent_id not in AGENT_REGISTRATIONS:
                AGENT_REGISTRATIONS[agent_id] = []
            AGENT_REGISTRATIONS[agent_id].append(datetime.now(timezone.utc))

    def _track_sinistre_registration(self, dossier: dict, context: dict) -> None:
        """Track sinistre enrollments for DOUBLE_AID_ATTEMPT and CROSS_SINISTRE_DUPLICATE."""
        dossier_id: str = dossier.get("dossier_id", "")
        sinistre_id: str = context.get("sinistre_id", "")

        if sinistre_id and dossier_id:
            if sinistre_id not in SINISTRE_REGISTRATIONS:
                SINISTRE_REGISTRATIONS[sinistre_id] = set()
            SINISTRE_REGISTRATIONS[sinistre_id].add(dossier_id)

            if dossier_id not in DOSSIER_SINISTRES:
                DOSSIER_SINISTRES[dossier_id] = set()
            DOSSIER_SINISTRES[dossier_id].add(sinistre_id)

    def get_queue(self) -> list[FraudCheckResult]:
        """Return the current human review queue."""
        return [r for r in REVIEW_QUEUE if r.decision == Decision.NEEDS_REVIEW]

    def get_stats(self) -> dict:
        """Return aggregate statistics."""
        total = len(_ALL_RESULTS)
        by_decision: dict[str, int] = {}
        for r in _ALL_RESULTS:
            by_decision[r.decision.value] = by_decision.get(r.decision.value, 0) + 1

        avg_score = (
            sum(r.confidence_score for r in _ALL_RESULTS) / total if total > 0 else 0.0
        )

        return {
            "total_processed": total,
            "by_decision": by_decision,
            "review_queue_size": len(REVIEW_QUEUE),
            "average_confidence_score": round(avg_score, 2),
            "dedup_stats": self._dedup.stats(),
        }

    def get_all_duplicates(self) -> list[dict]:
        """Return all results that had at least one duplicate found."""
        return [
            {
                "dossier_id": r.dossier_id,
                "duplicates": [d.model_dump() for d in r.duplicates_found],
                "decision": r.decision.value,
                "score": r.confidence_score,
            }
            for r in _ALL_RESULTS
            if r.duplicates_found
        ]

    def resolve_duplicate(self, dossier_id: str, resolution: str) -> bool:
        """Mark a dossier's duplicate status as resolved."""
        return self._dedup.resolve(dossier_id, resolution)


# Module-level singleton
antifraud_agent = AntiFraudAgent()
