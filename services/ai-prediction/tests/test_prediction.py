"""
Tests for the Prediction agent: features, models, CAP emitter.
"""
from __future__ import annotations

import sys
import os
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ---------------------------------------------------------------------------
# Test 1: FeatureBuilder returns dict with all required keys
# ---------------------------------------------------------------------------

def test_feature_builder_returns_required_keys():
    """FeatureBuilder.build() returns all required feature keys."""
    from agents.prediction.features import FeatureBuilder

    builder = FeatureBuilder()
    features = builder.build("CD-NK", horizon_days=7)

    required_keys = [
        "pente_moyenne",
        "distance_cours_eau_km",
        "altitude_m",
        "couverture_forestiere_pct",
        "population",
        "precipitation_7j_mm",
        "saison_pluies",
        "ipc_level",
        "idp_count",
        "idp_count_thousands",
        "idp_threshold",
        "nb_signalements_citoyens_7j",
        "nb_signalements_sanitaires_7j",
        "nb_evenements_meme_type_7j",
        "horizon_days",
    ]

    for key in required_keys:
        assert key in features, f"Missing required feature key: '{key}'"

    assert features["horizon_days"] == 7
    assert features["altitude_m"] == 1500  # CD-NK geo data
    assert isinstance(features["saison_pluies"], bool)


# ---------------------------------------------------------------------------
# Test 2: FloodRiskModel — heavy precipitation → CRITIQUE
# ---------------------------------------------------------------------------

def test_flood_model_heavy_precip_is_critique():
    """FloodRiskModel with precipitation_7j_mm=120 should return CRITIQUE."""
    from agents.prediction.models.flood import FloodRiskModel
    from schemas.risk import RiskLevel

    model = FloodRiskModel()
    features = {
        "p_code": "CD-NK",
        "province": "Nord-Kivu",
        "precipitation_7j_mm": 120.0,
        "distance_cours_eau_km": 1.0,
        "saison_pluies": True,
        "idp_count_thousands": 5.0,
        "horizon_days": 7,
    }
    result = model.predict(features)

    assert result.score >= 75, f"Expected CRITIQUE score (>=75), got {result.score}"
    assert result.level == RiskLevel.CRITIQUE
    assert result.risk_type.value == "FLOOD"
    assert len(result.factors) > 0


# ---------------------------------------------------------------------------
# Test 3: LandslideRiskModel — high precipitation + steep slope → ELEVE or CRITIQUE
# ---------------------------------------------------------------------------

def test_landslide_model_high_precip_steep_slope():
    """LandslideRiskModel with precip=80 and slope=20 should be ELEVE or CRITIQUE."""
    from agents.prediction.models.landslide import LandslideRiskModel
    from schemas.risk import RiskLevel

    model = LandslideRiskModel()
    features = {
        "p_code": "CD-SK",
        "province": "Sud-Kivu",
        "precipitation_7j_mm": 80.0,
        "pente_moyenne": 20.0,
        "altitude_m": 1800.0,
        "couverture_forestiere_pct": 25.0,  # deforestation risk
        "saison_pluies": True,
        "horizon_days": 7,
    }
    result = model.predict(features)

    assert result.level in (RiskLevel.ELEVE, RiskLevel.CRITIQUE), (
        f"Expected ELEVE or CRITIQUE, got {result.level} (score={result.score})"
    )
    assert result.score >= 60


# ---------------------------------------------------------------------------
# Test 4: RiskScore.factors list is non-empty and total contribution ≤ score
# ---------------------------------------------------------------------------

def test_flood_risk_score_factors_nonzero_and_bounded():
    """FloodRiskModel factors list must be non-empty and contributions bounded."""
    from agents.prediction.models.flood import FloodRiskModel

    model = FloodRiskModel()
    features = {
        "p_code": "CD-MK",
        "province": "Kasaï-Oriental",
        "precipitation_7j_mm": 50.0,
        "distance_cours_eau_km": 1.5,
        "saison_pluies": False,
        "idp_count_thousands": 2.0,
        "horizon_days": 7,
    }
    result = model.predict(features)

    assert len(result.factors) > 0, "Factors list must not be empty"

    positive_contributions = sum(
        f.contribution for f in result.factors if f.contribution > 0
    )
    # Total positive contributions should roughly equal the raw score
    # (before capping at 100)
    assert positive_contributions >= result.score - 1, (
        "Positive factor contributions should account for the score"
    )


# ---------------------------------------------------------------------------
# Test 5: CAP XML is valid XML with required CAP 1.2 elements
# ---------------------------------------------------------------------------

def test_cap_xml_is_valid_with_required_elements():
    """emit_cap_alert() returns valid CAP 1.2 XML."""
    from agents.prediction.cap_emitter import emit_cap_alert
    from agents.prediction.features import FeatureBuilder
    from agents.prediction.models.flood import FloodRiskModel
    from schemas.risk import RiskLevel, RiskScore, RiskType, FactorContribution

    risk_score = RiskScore(
        p_code="CD-NK",
        province="Nord-Kivu",
        risk_type=RiskType.FLOOD,
        score=85.0,
        level=RiskLevel.CRITIQUE,
        horizon_days=7,
        factors=[
            FactorContribution(
                name="precipitation_7j_mm",
                value=120.0,
                contribution=40.0,
                direction="+",
            )
        ],
        computed_at=datetime.now(timezone.utc),
        model_version="1.0.0-rules",
        confidence=0.8,
    )

    cap_xml = emit_cap_alert(risk_score)

    # Validate it parses as XML
    assert cap_xml.startswith("<?xml"), "CAP XML must start with XML declaration"
    root = ET.fromstring(cap_xml.split("\n", 1)[1])  # skip XML declaration

    # Check required CAP 1.2 top-level elements
    ns = "urn:oasis:names:tc:emergency:cap:1.2"

    def tag(name: str) -> str:
        return f"{{{ns}}}{name}"

    assert root.tag == tag("alert"), f"Root must be <alert>, got {root.tag}"
    assert root.find(tag("identifier")) is not None
    assert root.find(tag("sender")) is not None
    assert root.find(tag("sent")) is not None
    assert root.find(tag("status")) is not None
    assert root.find(tag("msgType")) is not None

    info = root.find(tag("info"))
    assert info is not None, "<info> element must be present"
    assert info.find(tag("event")) is not None
    assert info.find(tag("urgency")) is not None
    assert info.find(tag("severity")) is not None
    assert info.find(tag("certainty")) is not None


# ---------------------------------------------------------------------------
# Test 6: Pending alert has status=PENDING_VALIDATION
# ---------------------------------------------------------------------------

def test_pending_alert_has_correct_status():
    """After emit_cap_alert(), the alert must have status PENDING_VALIDATION."""
    from agents.prediction.cap_emitter import PENDING_ALERTS, emit_cap_alert
    from schemas.risk import RiskLevel, RiskScore, RiskType, FactorContribution

    initial_count = len(PENDING_ALERTS)

    risk_score = RiskScore(
        p_code="CD-IT",
        province="Ituri",
        risk_type=RiskType.DISPLACEMENT,
        score=75.0,
        level=RiskLevel.CRITIQUE,
        horizon_days=7,
        factors=[
            FactorContribution(
                name="idp_count",
                value=400000,
                contribution=35.0,
                direction="+",
            )
        ],
        computed_at=datetime.now(timezone.utc),
        model_version="1.0.0-rules",
        confidence=0.7,
    )

    emit_cap_alert(risk_score)

    assert len(PENDING_ALERTS) == initial_count + 1, "Should have added one alert"

    # Find the newly added alert
    new_alerts = [
        a for a in PENDING_ALERTS.values()
        if a["status"] == "PENDING_VALIDATION"
           and a["risk_score"]["p_code"] == "CD-IT"
    ]
    assert len(new_alerts) >= 1, "New alert should have PENDING_VALIDATION status"
    assert new_alerts[-1]["xml"].startswith("<?xml")
