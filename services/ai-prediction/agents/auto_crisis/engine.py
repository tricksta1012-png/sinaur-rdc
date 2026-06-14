"""
AutoCrisisEngine — création automatique de crises humanitaires.

Cycle:
  1. Récupère les rapports multi-sources des agents Veille + VirusEmergents
  2. Passe chaque groupe de rapports dans TruthFilter
  3. Si score ≥ seuil → crée la crise via l'API SINAUR (/crises, pending_validation=True)
  4. Publie sur le bus Redis (topic: auto_crisis.created) pour notification temps réel

Cadence: boucle asyncio infinie, cycle toutes les 5 minutes.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx

from agents.truth_filter.filter import SourceReport, truth_filter

logger = logging.getLogger(__name__)

# Stats en mémoire pour le dashboard
_STATS: dict[str, Any] = {
    "received_today": 0,
    "validated": 0,
    "auto_created": 0,
    "pending_human": 0,
    "rejected": 0,
    "last_run": None,
}

_CREATED_CRISES: list[dict] = []

# Queue des rapports en attente de traitement
_PENDING_REPORTS: list[dict] = []

SINAUR_API_URL = os.getenv("SINAUR_API_URL", "http://api:3000")
AGENT_API_KEY = os.getenv("AGENT_INTERNAL_API_KEY", "")


def ingest_report(report: dict) -> None:
    """Ajoute un rapport à la queue de traitement."""
    _PENDING_REPORTS.append(report)
    _STATS["received_today"] = _STATS.get("received_today", 0) + 1


async def _create_crisis_via_api(crisis_data: dict) -> dict | None:
    """POST /crises avec pending_validation=True via l'API interne."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{SINAUR_API_URL}/crises",
                json={**crisis_data, "pendingValidation": True},
                headers={"X-Agent-Key": AGENT_API_KEY},
            )
            if resp.status_code == 201:
                data = resp.json().get("data", {})
                logger.info("auto_crisis.created", crisis_id=data.get("id"), title=crisis_data.get("title"))
                return data
            logger.warning("auto_crisis.api_error", status=resp.status_code, body=resp.text[:200])
    except Exception as exc:
        logger.error("auto_crisis.api_exception", error=str(exc))
    return None


class AutoCrisisEngine:
    """
    Moteur de création automatique de crises à partir des rapports multi-sources.
    """

    def __init__(self) -> None:
        self._running = False
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._loop(), name="auto_crisis_engine")
        logger.info("auto_crisis_engine.started", cycle_minutes=5)

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("auto_crisis_engine.stopped")

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._process_pending_reports()
                _STATS["last_run"] = datetime.now(timezone.utc).isoformat()
            except Exception as exc:
                logger.error("auto_crisis_engine.loop_error", error=str(exc))
            await asyncio.sleep(300)  # 5 min

    async def _process_pending_reports(self) -> None:
        if not _PENDING_REPORTS:
            return

        # Groupe par (hazard_type + location) pour corroboration
        groups: dict[str, list[dict]] = {}
        for rpt in list(_PENDING_REPORTS):
            key = f"{rpt.get('hazard_type', 'OTHER')}::{rpt.get('location', '')}"
            groups.setdefault(key, []).append(rpt)

        _PENDING_REPORTS.clear()

        for group_key, reports in groups.items():
            hazard_type = group_key.split("::")[0]

            source_reports = [
                SourceReport(
                    source_id=r.get("source", "UNKNOWN"),
                    hazard_type=hazard_type,
                    location=r.get("location", ""),
                    severity=r.get("severity", "Unknown"),
                    timestamp=datetime.now(timezone.utc),
                    raw_data=r,
                )
                for r in reports
            ]

            result = truth_filter.evaluate(source_reports, hazard_type)
            _STATS["received_today"] = _STATS.get("received_today", 0) + len(reports)

            if result.auto_create:
                primary = reports[0]
                crisis_data = {
                    "title":         primary.get("title", f"[AUTO] Alerte {hazard_type}"),
                    "hazardType":    hazard_type.lower().replace("_", ""),
                    "severity":      primary.get("severity", "Severe"),
                    "locationPcode": primary.get("location_pcode"),
                    "affectedCount": primary.get("affected_count"),
                    "description":   primary.get("description"),
                    "confidenceScore": result.score,
                    "sourcesDetection": [{"source": r.source_id, "score": SOURCE_RELIABILITY_SNAPSHOT.get(r.source_id.upper(), 0.5)} for r in source_reports],
                    "truthFilterData": {
                        "score": result.score,
                        "best_source": result.best_source,
                        "corroboration_count": result.corroboration_count,
                        "institutional_bonus": result.institutional_bonus,
                        "contradiction_count": result.contradiction_count,
                        "threshold": result.details.get("threshold"),
                    },
                }

                created = await _create_crisis_via_api(crisis_data)
                if created:
                    _CREATED_CRISES.append(created)
                    _STATS["auto_created"] = _STATS.get("auto_created", 0) + 1
                    _STATS["pending_human"] = _STATS.get("pending_human", 0) + 1

                    try:
                        from agents import bus
                        await bus.publish("auto_crisis.created", {
                            "crisis_id": created.get("id"),
                            "title": created.get("title"),
                            "hazard_type": hazard_type,
                            "confidence_score": result.score,
                        })
                    except Exception as exc:
                        logger.warning("auto_crisis.bus_publish_error", error=str(exc))
            else:
                logger.info(
                    "auto_crisis.below_threshold",
                    hazard_type=hazard_type,
                    score=result.score,
                    threshold=result.details.get("threshold"),
                )

    def get_stats(self) -> dict:
        return {**_STATS, "total_created": len(_CREATED_CRISES)}


# Import needed at runtime to avoid circular imports
try:
    from agents.truth_filter.filter import SOURCE_RELIABILITY as SOURCE_RELIABILITY_SNAPSHOT
except ImportError:
    SOURCE_RELIABILITY_SNAPSHOT: dict = {}

auto_crisis_engine = AutoCrisisEngine()
