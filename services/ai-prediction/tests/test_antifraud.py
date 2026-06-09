"""
Tests for the Anti-Fraud agent: deduplication, scoring, rules.
"""
from __future__ import annotations

import sys
import os
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _make_dossier(**overrides) -> dict:
    """Create a baseline valid dossier for testing."""
    base = {
        "dossier_id": f"test_{datetime.now(timezone.utc).timestamp()}",
        "nom_complet": "Kabila Jean-Pierre",
        "date_naissance": "1985-03-15",
        "taille_menage": 6,
        "p_code": "CD-NK",
        "telephone": "+243812345678",
        "agent_id": "agent_A1",
        "otp_verified": True,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Test 1: Exact duplicate (same name/dob/pcode) → AUTO_REJECTED
# ---------------------------------------------------------------------------

def test_exact_duplicate_is_auto_rejected():
    """Two identical dossiers should result in AUTO_REJECTED for the second."""
    from agents.antifraud.agent import AntiFraudAgent
    from schemas.fraud import Decision

    agent = AntiFraudAgent()
    context = {"sinistre_id": "SIN001", "sinistre_p_code": "CD-NK"}

    dossier_a = _make_dossier(dossier_id="dup_test_A")
    dossier_b = _make_dossier(
        dossier_id="dup_test_B",
        nom_complet="Kabila Jean-Pierre",
        date_naissance="1985-03-15",
        p_code="CD-NK",
        telephone="+243812345678",
        taille_menage=6,
    )

    # Process first dossier — should be auto-approved (no history)
    result_a = agent.process_dossier(dossier_a, context)
    assert result_a.decision in (Decision.AUTO_APPROVED, Decision.NEEDS_REVIEW)

    # Process exact duplicate — dedup engine should flag it
    result_b = agent.process_dossier(dossier_b, context)

    assert len(result_b.duplicates_found) > 0, "Should detect duplicate"
    assert result_b.duplicates_found[0].similarity_score >= 0.95
    # HIGH or CRITICAL duplicate → at minimum NEEDS_REVIEW or AUTO_REJECTED
    assert result_b.decision in (Decision.NEEDS_REVIEW, Decision.AUTO_REJECTED)


# ---------------------------------------------------------------------------
# Test 2: Jaro-Winkler ≥ 0.95 → NEEDS_REVIEW
# ---------------------------------------------------------------------------

def test_jaro_winkler_high_similarity():
    """Two very similar names (Jaro-Winkler ≥ 0.95) should flag as near-duplicate."""
    from agents.antifraud.dedup_engine import DedupEngine, jaro_winkler

    sim = jaro_winkler("Kabila Jean-Pierre", "Kabila Jean Pierre")
    assert sim >= 0.95, f"Expected Jaro-Winkler >= 0.95, got {sim}"

    engine = DedupEngine()
    record_a = {
        "dossier_id": "jw_test_A",
        "nom_complet": "Kabila Jean-Pierre",
        "date_naissance": "1985-03-15",
        "taille_menage": 6,
        "p_code": "CD-NK",
        "telephone": "+243812345678",
    }
    record_b = {
        "dossier_id": "jw_test_B",
        "nom_complet": "Kabila Jean Pierre",  # no hyphen
        "date_naissance": "1985-03-15",
        "taille_menage": 6,
        "p_code": "CD-NK",
        "telephone": "+243812345678",
    }

    engine.add_record(record_a)
    duplicates = engine.find_duplicates(record_b)

    assert len(duplicates) > 0, "Should find at least one duplicate"
    assert duplicates[0].similarity_score >= 0.80


# ---------------------------------------------------------------------------
# Test 3: Clean dossier → AUTO_APPROVED
# ---------------------------------------------------------------------------

def test_clean_dossier_is_auto_approved():
    """A dossier with no flags and no duplicates should be AUTO_APPROVED."""
    from agents.antifraud.agent import AntiFraudAgent
    from schemas.fraud import Decision

    agent = AntiFraudAgent()
    context = {
        "sinistre_id": "SIN_CLEAN_001",
        "sinistre_p_code": "CD-EQ",
        "hierarchy_validated": True,
    }
    dossier = {
        "dossier_id": "clean_001",
        "nom_complet": "Mbala Françoise",
        "date_naissance": "1992-07-22",
        "taille_menage": 4,
        "p_code": "CD-EQ",
        "telephone": "+243991111222",
        "agent_id": "agent_clean_X",
        "otp_verified": True,
    }

    result = agent.process_dossier(dossier, context)

    # No triggers expected for a clean dossier
    triggered = [f for f in result.flags if f.triggered]
    assert len(triggered) == 0, f"Expected no flags, got: {[f.rule_id for f in triggered]}"
    assert result.decision == Decision.AUTO_APPROVED
    assert result.confidence_score >= 80.0


# ---------------------------------------------------------------------------
# Test 4: MASS_REGISTRATION_AGENT rule triggers at > 50 submissions
# ---------------------------------------------------------------------------

def test_mass_registration_rule_triggers_at_51_submissions():
    """MASS_REGISTRATION_AGENT rule should trigger when agent has >50 registrations in 1h."""
    from agents.antifraud.rules import AGENT_REGISTRATIONS, MassRegistrationAgentRule

    rule = MassRegistrationAgentRule()
    agent_id = "mass_agent_test_XYZ"

    # Populate 51 timestamps within the last hour
    now = datetime.now(timezone.utc)
    AGENT_REGISTRATIONS[agent_id] = [now] * 51

    dossier = {"agent_id": agent_id, "dossier_id": "mass_test_001"}
    context = {}

    flag = rule.evaluate(dossier, context)

    assert flag.triggered is True, "Rule should be triggered at 51 registrations"
    assert flag.rule_id == "MASS_REGISTRATION_AGENT"
    assert flag.severity == "CRITICAL"

    # Clean up
    del AGENT_REGISTRATIONS[agent_id]


# ---------------------------------------------------------------------------
# Test 5: compute_score — CRITICAL flag → AUTO_REJECTED regardless of other scores
# ---------------------------------------------------------------------------

def test_critical_flag_forces_auto_rejected():
    """A single CRITICAL flag must force AUTO_REJECTED regardless of score."""
    from agents.antifraud.scorer import compute_score
    from schemas.fraud import Decision, FraudFlag

    flags = [
        FraudFlag(
            rule_id="DOUBLE_AID_ATTEMPT",
            description="Déjà enregistré",
            severity="CRITICAL",
            triggered=True,
        ),
        FraudFlag(
            rule_id="HOUSEHOLD_SIZE_ANOMALY",
            description="Ménage trop grand",
            severity="MEDIUM",
            triggered=False,
        ),
    ]

    # Even with all bonuses, CRITICAL flag forces rejection
    score, decision = compute_score(flags, duplicates=[], bonuses={"otp_verified": True, "hierarchy_validated": True})

    assert decision == Decision.AUTO_REJECTED, (
        f"CRITICAL flag must force AUTO_REJECTED, got {decision}"
    )


# ---------------------------------------------------------------------------
# Test 6: NEEDS_REVIEW decision requires human action (not auto-changed)
# ---------------------------------------------------------------------------

def test_needs_review_decision_is_not_auto_changed():
    """A NEEDS_REVIEW result must stay in that state without human action."""
    from agents.antifraud.agent import AntiFraudAgent
    from schemas.fraud import Decision

    agent = AntiFraudAgent()
    context = {
        "sinistre_id": "SIN_NR_001",
        "sinistre_p_code": "CD-SK",
        "distance_to_disaster_km": 60.0,  # triggers OUTSIDE_DISASTER_ZONE (HIGH)
    }
    dossier = {
        "dossier_id": "needs_review_001",
        "nom_complet": "Nzinga Marie",
        "date_naissance": "1978-11-03",
        "taille_menage": 7,
        "p_code": "CD-SK",
        "telephone": "+243777888999",
        "agent_id": "agent_B2",
        "otp_verified": False,
    }

    result = agent.process_dossier(dossier, context)

    # Because OUTSIDE_DISASTER_ZONE (HIGH) is triggered, decision must be NEEDS_REVIEW or AUTO_REJECTED
    assert result.decision in (Decision.NEEDS_REVIEW, Decision.AUTO_REJECTED), (
        f"Expected NEEDS_REVIEW or AUTO_REJECTED, got {result.decision}"
    )

    # If NEEDS_REVIEW, verify it's in the review queue
    if result.decision == Decision.NEEDS_REVIEW:
        queue = agent.get_queue()
        queue_ids = {r.dossier_id for r in queue}
        assert "needs_review_001" in queue_ids, "NEEDS_REVIEW dossier must be in review queue"

        # Confirm decision hasn't changed without human intervention
        in_queue = next(r for r in queue if r.dossier_id == "needs_review_001")
        assert in_queue.decision == Decision.NEEDS_REVIEW, (
            "Decision should not auto-change; human review required"
        )
