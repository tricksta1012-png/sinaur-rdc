"""
CAP 1.2 XML alert emitter for SINAUR-RDC.
"""
from __future__ import annotations

import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import structlog

from config import settings
from redis_client import QUEUE_ALERTS_PENDING, get_redis
from schemas.risk import RiskLevel, RiskScore

logger = structlog.get_logger(__name__)

# In-memory pending alerts: alert_id → {xml, risk_score, status, created_at}
PENDING_ALERTS: dict[str, dict] = {}

# CAP urgency / severity / certainty mappings
_LEVEL_TO_CAP: dict[RiskLevel, dict[str, str]] = {
    RiskLevel.FAIBLE: {
        "urgency": "Future",
        "severity": "Minor",
        "certainty": "Possible",
        "responseType": "Prepare",
    },
    RiskLevel.MODERE: {
        "urgency": "Expected",
        "severity": "Moderate",
        "certainty": "Likely",
        "responseType": "Prepare",
    },
    RiskLevel.ELEVE: {
        "urgency": "Immediate",
        "severity": "Severe",
        "certainty": "Likely",
        "responseType": "Execute",
    },
    RiskLevel.CRITIQUE: {
        "urgency": "Immediate",
        "severity": "Extreme",
        "certainty": "Observed",
        "responseType": "Evacuate",
    },
}


def emit_cap_alert(risk_score: RiskScore, province_info: dict | None = None) -> str:
    """
    Generate a CAP 1.2 XML alert string for a given RiskScore.

    Sets status = PENDING_VALIDATION in PENDING_ALERTS dict.
    Pushes alert_id to Redis queue 'sinaur:alerts:pending'.

    Returns the CAP XML string.
    """
    alert_id = str(uuid.uuid4())
    sent_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    cap_meta = _LEVEL_TO_CAP.get(risk_score.level, _LEVEL_TO_CAP[RiskLevel.MODERE])

    # Build CAP XML
    root = ET.Element("alert")
    root.set("xmlns", "urn:oasis:names:tc:emergency:cap:1.2")

    ET.SubElement(root, "identifier").text = f"sinaur-{alert_id}"
    ET.SubElement(root, "sender").text = settings.cap_sender_id
    ET.SubElement(root, "sent").text = sent_time
    ET.SubElement(root, "status").text = (
        "Test" if not settings.alert_validation_required else "Actual"
    )
    ET.SubElement(root, "msgType").text = "Alert"
    ET.SubElement(root, "scope").text = "Restricted"
    ET.SubElement(root, "restriction").text = "SINAUR-RDC Internal"
    ET.SubElement(root, "note").text = (
        f"Alerte générée automatiquement. Validation humaine requise. "
        f"Score: {risk_score.score:.1f}/100"
    )

    # Info element
    info = ET.SubElement(root, "info")
    ET.SubElement(info, "language").text = "fr-CD"
    ET.SubElement(info, "category").text = _risk_type_to_cap_category(risk_score.risk_type.value)
    ET.SubElement(info, "event").text = (
        f"Risque {risk_score.risk_type.value} — {risk_score.province}"
    )
    ET.SubElement(info, "responseType").text = cap_meta["responseType"]
    ET.SubElement(info, "urgency").text = cap_meta["urgency"]
    ET.SubElement(info, "severity").text = cap_meta["severity"]
    ET.SubElement(info, "certainty").text = cap_meta["certainty"]
    ET.SubElement(info, "onset").text = sent_time
    ET.SubElement(info, "expires").text = (
        datetime.now(timezone.utc)
        .replace(hour=23, minute=59, second=59)
        .strftime("%Y-%m-%dT%H:%M:%S+00:00")
    )
    ET.SubElement(info, "senderName").text = "SINAUR-RDC — Système National d'Alerte"
    ET.SubElement(info, "headline").text = (
        f"[{risk_score.level.value}] Risque {risk_score.risk_type.value} "
        f"élevé — {risk_score.province}"
    )
    ET.SubElement(info, "description").text = (
        f"Score de risque: {risk_score.score:.1f}/100 "
        f"(niveau: {risk_score.level.value}). "
        f"Horizon: {risk_score.horizon_days} jours. "
        f"Province: {risk_score.province} ({risk_score.p_code}). "
        f"Modèle: {risk_score.model_version}. "
        f"Confiance: {risk_score.confidence:.0%}."
    )
    ET.SubElement(info, "instruction").text = (
        f"Activer le protocole de réponse niveau {risk_score.level.value}. "
        "Contacter le coordinateur SINAUR-RDC provincial."
    )
    ET.SubElement(info, "web").text = "https://sinaur-rdc.cd/alerts"
    ET.SubElement(info, "contact").text = "sinaur-operations@sinaur-rdc.cd"

    # Area element
    area = ET.SubElement(info, "area")
    ET.SubElement(area, "areaDesc").text = risk_score.province
    geocode = ET.SubElement(area, "geocode")
    ET.SubElement(geocode, "valueName").text = "P-CODE"
    ET.SubElement(geocode, "value").text = risk_score.p_code

    # Factor parameters
    for factor in risk_score.factors[:5]:
        param = ET.SubElement(info, "parameter")
        ET.SubElement(param, "valueName").text = factor.name
        ET.SubElement(param, "value").text = f"{factor.value} (contribution: {factor.contribution:+.1f})"

    cap_xml = ET.tostring(root, encoding="unicode", xml_declaration=False)
    cap_xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + cap_xml

    # Store in memory
    PENDING_ALERTS[alert_id] = {
        "alert_id": alert_id,
        "xml": cap_xml,
        "risk_score": risk_score.model_dump(),
        "status": "PENDING_VALIDATION",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    # Push to Redis queue (non-blocking — fire and forget)
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(_push_to_redis(alert_id))
    except RuntimeError:
        pass  # No event loop in test context

    logger.info(
        "cap_emitter.alert_created",
        alert_id=alert_id,
        p_code=risk_score.p_code,
        level=risk_score.level.value,
        score=risk_score.score,
    )

    return cap_xml


async def _push_to_redis(alert_id: str) -> None:
    """Push alert_id to Redis queue for downstream processing."""
    try:
        redis = get_redis()
        await redis.lpush(QUEUE_ALERTS_PENDING, alert_id)
        logger.info("cap_emitter.redis_push_ok", alert_id=alert_id)
    except Exception as exc:
        logger.warning("cap_emitter.redis_push_failed", alert_id=alert_id, error=str(exc))


def _risk_type_to_cap_category(risk_type: str) -> str:
    mapping = {
        "FLOOD": "Met",
        "LANDSLIDE": "Geo",
        "DISPLACEMENT": "Safety",
        "EPIDEMIC": "Health",
    }
    return mapping.get(risk_type, "Other")


def get_pending_alerts() -> list[dict]:
    """Return all alerts with status PENDING_VALIDATION."""
    return [a for a in PENDING_ALERTS.values() if a["status"] == "PENDING_VALIDATION"]


def validate_alert(alert_id: str) -> bool:
    """Mark an alert as VALIDATED."""
    if alert_id not in PENDING_ALERTS:
        return False
    PENDING_ALERTS[alert_id]["status"] = "VALIDATED"
    PENDING_ALERTS[alert_id]["validated_at"] = datetime.now(timezone.utc).isoformat()
    logger.info("cap_emitter.alert_validated", alert_id=alert_id)
    return True


def reject_alert(alert_id: str) -> bool:
    """Mark an alert as REJECTED."""
    if alert_id not in PENDING_ALERTS:
        return False
    PENDING_ALERTS[alert_id]["status"] = "REJECTED"
    PENDING_ALERTS[alert_id]["rejected_at"] = datetime.now(timezone.utc).isoformat()
    logger.info("cap_emitter.alert_rejected", alert_id=alert_id)
    return True
