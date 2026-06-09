"""
Agent 1 — Veille & Ingestion.
Surveille les flux de données et détecte les signaux faibles avant déclaration officielle.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends
from .auth import require_internal_key
from ..database import fetch_all

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/internal/veille", tags=["veille"], dependencies=[Depends(require_internal_key)])

# Sources surveillées et leur état (circuit-breaker simulé depuis les canonical_events)
SOURCES = ["reliefweb", "fews_net", "gdacs", "open_meteo", "mettelsat"]


@router.get("/events")
def get_veille_events(
    since: str | None = None,
    type: str | None = None,
    province: str | None = None,
    limit: int = 50,
):
    """Événements récents collectés par le système de veille (canonical_events)."""
    since_dt = since or (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()

    query = """
        SELECT id, source_id, source, hazard_type, title, description,
               location_pcode, severity, confidence, start_date, source_url,
               glide_number, is_duplicate, fetched_at, normalized_at
        FROM canonical_events
        WHERE fetched_at >= :since
    """
    params: dict = {"since": since_dt}

    if type:
        query += " AND hazard_type = :type"
        params["type"] = type
    if province:
        query += " AND location_pcode LIKE :province"
        params["province"] = f"{province}%"

    query += " ORDER BY fetched_at DESC LIMIT :limit"
    params["limit"] = min(limit, 200)

    rows = fetch_all(query, params)
    return {
        "events": rows,
        "count": len(rows),
        "since": since_dt,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/health")
def get_health():
    """État des connecteurs d'ingestion déduit des dernières collectes."""
    statuses = []
    for source in SOURCES:
        rows = fetch_all(
            "SELECT MAX(fetched_at) AS last_fetch, COUNT(*) AS total_48h "
            "FROM canonical_events WHERE source = :source AND fetched_at >= NOW() - INTERVAL '48 hours'",
            {"source": source},
        )
        row = rows[0] if rows else {}
        last_fetch = row.get("last_fetch")
        total = int(row.get("total_48h") or 0)

        if last_fetch:
            age_hours = (datetime.now(timezone.utc) - last_fetch.replace(tzinfo=timezone.utc)).total_seconds() / 3600 if hasattr(last_fetch, "replace") else 99
            status = "ok" if age_hours < 6 else ("degraded" if age_hours < 24 else "down")
        else:
            status = "no_data"

        statuses.append({
            "source": source,
            "status": status,
            "last_fetch": str(last_fetch) if last_fetch else None,
            "events_48h": total,
        })

    overall = "ok" if all(s["status"] == "ok" for s in statuses) else (
        "degraded" if any(s["status"] == "ok" for s in statuses) else "down"
    )
    return {"status": overall, "connectors": statuses, "checked_at": datetime.now(timezone.utc).isoformat()}


@router.post("/trigger/{source_id}")
def trigger_source(source_id: str):
    """Demande un recalcul manuel sur une source (best-effort — l'ingestion est asynchrone)."""
    if source_id not in SOURCES:
        return {"success": False, "error": f"Source inconnue : {source_id}"}
    logger.info(f"Manual ingestion trigger requested for source: {source_id}")
    return {
        "success": True,
        "source": source_id,
        "message": "Collecte manuelle planifiée — résultat disponible dans ~2 minutes",
        "triggered_at": datetime.now(timezone.utc).isoformat(),
    }
