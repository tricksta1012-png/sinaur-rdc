"""
Agent 3 — Détection de fraude & déduplication registre sinistrés.
Analyse les dossiers pour détecter faux positifs, doublons et campagnes organisées.
"""
from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from .auth import require_internal_key
from ..database import fetch_all, engine
from sqlalchemy import text

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/internal/antifraud", tags=["antifraud"], dependencies=[Depends(require_internal_key)])

FRAUD_SCORE_THRESHOLD_SUSPICIOUS = 40
FRAUD_SCORE_THRESHOLD_FRAUD = 70


class DossierInput(BaseModel):
    dossier_id: str
    nom_complet: str
    date_naissance: str
    taille_menage: int
    p_code: str
    telephone: str | None = None
    agent_id: str | None = None
    otp_verified: bool = False


class CheckContext(BaseModel):
    sinistre_id: str
    sinistre_p_code: str | None = None
    distance_to_disaster_km: float | None = None
    hierarchy_validated: bool = False


class CheckRequest(BaseModel):
    dossier: DossierInput
    context: CheckContext


def _normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", name.lower().strip())


def _name_hash(name: str) -> str:
    return hashlib.sha256(_normalize_name(name).encode()).hexdigest()[:16]


def _score_dossier(dossier: DossierInput, context: CheckContext, db_rows: list[dict]) -> dict[str, Any]:
    score = 0
    flags: list[str] = []

    # 1. Cohérence géographique
    if context.sinistre_p_code and not dossier.p_code.startswith(context.sinistre_p_code[:4]):
        score += 30
        flags.append("geographic_mismatch")

    if context.distance_to_disaster_km is not None and context.distance_to_disaster_km > 200:
        score += 25
        flags.append("far_from_disaster")

    # 2. Doublons par nom+date de naissance dans le même sinistre
    duplicates = [
        r for r in db_rows
        if r.get("name_hash") == _name_hash(dossier.nom_complet)
        and r.get("sinistre_id") == context.sinistre_id
        and r.get("dossier_id") != dossier.dossier_id
    ]
    if duplicates:
        score += 50
        flags.append("duplicate_name_dob")

    # 3. Fréquence d'un même agent (>20 dossiers/jour → suspect)
    if dossier.agent_id:
        agent_count = sum(1 for r in db_rows if r.get("agent_id") == dossier.agent_id)
        if agent_count > 30:
            score += 35
            flags.append("agent_high_volume")
        elif agent_count > 15:
            score += 15
            flags.append("agent_elevated_volume")

    # 4. Taille de ménage anormale
    if dossier.taille_menage > 20:
        score += 20
        flags.append("abnormal_household_size")

    # 5. OTP non vérifié (réduit le score de confiance)
    if not dossier.otp_verified and not context.hierarchy_validated:
        score += 10
        flags.append("no_otp_no_hierarchy")

    score = min(score, 100)
    if score >= FRAUD_SCORE_THRESHOLD_FRAUD:
        verdict = "fraudulent"
    elif score >= FRAUD_SCORE_THRESHOLD_SUSPICIOUS:
        verdict = "suspicious"
    else:
        verdict = "clean"

    return {"score": score, "verdict": verdict, "flags": flags}


@router.post("/check")
def check_dossier(req: CheckRequest):
    """Analyse un dossier sinistré et retourne un score de fraude 0–100."""
    recent = fetch_all(
        """
        SELECT beneficiary_id AS dossier_id, full_name, date_of_birth,
               household_size, p_code, registered_by_id AS agent_id,
               sinistre_id, created_at,
               encode(digest(lower(trim(full_name)), 'sha256'), 'hex') AS name_hash
        FROM registry_beneficiaries
        WHERE sinistre_id = :sinistre_id
          AND created_at >= NOW() - INTERVAL '7 days'
        LIMIT 500
        """,
        {"sinistre_id": req.context.sinistre_id},
    )

    result = _score_dossier(req.dossier, req.context, recent)
    logger.info(f"Antifraud check {req.dossier.dossier_id}: {result['verdict']} (score={result['score']})")
    return {
        "dossier_id": req.dossier.dossier_id,
        "score": result["score"],
        "verdict": result["verdict"],
        "flags": result["flags"],
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/queue")
def get_review_queue(limit: int = 50):
    """Dossiers en attente de revue humaine (score suspicious ou fraudulent)."""
    rows = fetch_all(
        """
        SELECT id, event_id, priority, notes, created_at
        FROM moderation_queue
        WHERE resolved_at IS NULL
        ORDER BY priority DESC, created_at ASC
        LIMIT :limit
        """,
        {"limit": min(limit, 200)},
    )
    return {"queue": rows, "count": len(rows), "fetched_at": datetime.now(timezone.utc).isoformat()}


@router.get("/stats")
def get_stats():
    """Statistiques de détection de fraude sur les 30 derniers jours."""
    events_stats = fetch_all(
        """
        SELECT COUNT(*) AS total_events,
               COUNT(*) FILTER (WHERE source = 'citizen') AS citizen_reports,
               COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
        FROM disaster_events
        WHERE created_at >= NOW() - INTERVAL '30 days'
          AND deleted_at IS NULL
        """,
        {},
    )
    moderation_stats = fetch_all(
        """
        SELECT COUNT(*) AS total_queued,
               COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved,
               COUNT(*) FILTER (WHERE resolved_at IS NULL) AS pending
        FROM moderation_queue
        WHERE created_at >= NOW() - INTERVAL '30 days'
        """,
        {},
    )
    ev = events_stats[0] if events_stats else {}
    mod = moderation_stats[0] if moderation_stats else {}

    total = int(ev.get("total_events") or 0)
    rejected = int(ev.get("rejected") or 0)
    rejection_rate = round(rejected / total * 100, 1) if total > 0 else 0

    return {
        "period_days": 30,
        "events": {
            "total": total,
            "citizen_reports": int(ev.get("citizen_reports") or 0),
            "rejected": rejected,
            "rejection_rate_pct": rejection_rate,
        },
        "moderation_queue": {
            "total_queued": int(mod.get("total_queued") or 0),
            "resolved": int(mod.get("resolved") or 0),
            "pending": int(mod.get("pending") or 0),
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
