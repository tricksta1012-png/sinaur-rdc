"""
ConnaissanceAgent — Moteur de connaissance évolutif SINAUR-RDC.

Cadence : toutes les 4 heures.
Scope : RESTRICTED (données opérationnelles).

Cycle de travail :
  1. Récupère les événements renseignement récents (intel_events)
  2. Pour chaque événement, extrait les entités via Claude
  3. Crée ou enrichit les entités dans kb_entite
  4. Établit ou renforce les relations dans kb_relation
  5. Journalise tout dans kb_apprentissage

Principe : le modèle IA reste STABLE, la connaissance grossit.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import text

from db import engine

logger = structlog.get_logger(__name__)

_STATUS: dict = {
    "last_run": None,
    "last_success": None,
    "runs_total": 0,
    "total_decouvertes": 0,
    "total_enrichissements": 0,
    "errors": [],
}


class ConnaissanceAgent:
    """Agent de connaissance évolutive. Cadence 4h."""

    def __init__(self) -> None:
        self._scheduler = AsyncIOScheduler(timezone="UTC")

    async def start(self) -> None:
        from agents.connaissance.prepopulation import prepopuler

        # Pré-remplir la base si vide
        try:
            n = await prepopuler()
            if n > 0:
                logger.info("connaissance_agent.prepopulation", entites=n)
        except Exception as exc:
            logger.warning("connaissance_agent.prepopulation_failed", error=str(exc))

        self._scheduler.add_job(
            self.run_cycle,
            "interval",
            hours=4,
            id="connaissance_cycle",
            name="Connaissance:enrichissement",
            next_run_time=datetime.now(timezone.utc),
            misfire_grace_time=600,
            coalesce=True,
        )
        self._scheduler.start()
        logger.info("connaissance_agent.started", interval_hours=4)

    async def stop(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
        logger.info("connaissance_agent.stopped")

    async def run_cycle(self) -> None:
        """Cycle principal : analyse les événements récents et enrichit la connaissance."""
        from agents.connaissance.decouvreur import analyser_texte

        _STATUS["runs_total"] += 1
        _STATUS["last_run"] = datetime.now(timezone.utc).isoformat()
        _STATUS["errors"] = []

        logger.info("connaissance_agent.cycle.start")

        # Récupérer les textes des 4 dernières heures depuis intel_events
        textes: list[tuple[str, str]] = []  # (texte, source_id)
        try:
            async with engine.connect() as conn:
                rows = await conn.execute(
                    text("""
                        SELECT title || ' ' || COALESCE(content, ''), source_id
                        FROM intel_events
                        WHERE date >= NOW() - INTERVAL '4 hours'
                        ORDER BY date DESC
                        LIMIT 50
                    """)
                )
                textes.extend([(r[0], r[1]) for r in rows.fetchall()])
        except Exception as exc:
            logger.warning("connaissance_agent.intel_events_failed", error=str(exc))
            _STATUS["errors"].append(str(exc))

        # Traiter par batch de 5 (éviter saturation API)
        decouvertes = 0
        enrichissements = 0

        for i in range(0, len(textes), 5):
            batch = textes[i:i + 5]
            tasks = [analyser_texte(texte, source) for texte, source in batch]
            try:
                resultats = await asyncio.gather(*tasks, return_exceptions=True)
                for res in resultats:
                    if isinstance(res, dict):
                        decouvertes    += res.get("decouvertes", 0)
                        enrichissements += res.get("enrichissements", 0)
                    elif isinstance(res, Exception):
                        logger.warning("connaissance_agent.analyse_error", error=str(res))
            except Exception as exc:
                logger.warning("connaissance_agent.batch_error", error=str(exc))

            # Pause courte entre batches
            if i + 5 < len(textes):
                await asyncio.sleep(2)

        _STATUS["total_decouvertes"]    += decouvertes
        _STATUS["total_enrichissements"] += enrichissements
        if not _STATUS["errors"]:
            _STATUS["last_success"] = _STATUS["last_run"]

        logger.info(
            "connaissance_agent.cycle.done",
            textes_analyses=len(textes),
            decouvertes=decouvertes,
            enrichissements=enrichissements,
        )

    def get_status(self) -> dict:
        return dict(_STATUS)


connaissance_agent = ConnaissanceAgent()
