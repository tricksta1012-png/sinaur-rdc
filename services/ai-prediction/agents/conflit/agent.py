"""
ConflitAgent — Agent 9.

Surveillance des conflits armés et prédiction des déplacements de populations.
Cadence : toutes les 2 heures.

Sources :
  - Événements publiés par VeilleAgent (bus `veille.new_event`)
  - Données résiduelles ACLED via ReliefWeb (filtrées par type)

Sorties :
  - Store in-memory des ConflictEvent enrichis
  - Prédictions de déplacement par province
  - Publication bus `conflit.critical` → Agent 7 (logistique)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from agents import bus
from agents.conflit.sanitizer import access_level_for_role
from agents.conflit.schemas.conflict import (
    ArmedActor,
    ConflictEvent,
    DataClassification,
)
from agents.conflit.sources.acled import resolve_actor

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# In-memory stores
# ---------------------------------------------------------------------------

_EVENT_STORE: list[dict] = []       # ConflictEvent serialisés (RESTRICTED)
_PREDICTION_STORE: list[dict] = []  # Prédictions de déplacement par province

# Seuil au-delà duquel on publie une alerte critique sur le bus
_CRITICAL_DISPLACEMENT_THRESHOLD = 10_000  # personnes


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class ConflitAgent:
    """
    Agent 9 — Surveillance des conflits et prédiction déplacements.
    Cadence : 2 heures.
    """

    def __init__(self) -> None:
        self._scheduler = AsyncIOScheduler(timezone="UTC")

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        self._scheduler.add_job(
            self.run_analysis,
            "interval",
            hours=2,
            id="conflit_analysis",
            name="Conflit:analyse",
            misfire_grace_time=600,
            coalesce=True,
        )
        self._scheduler.start()

        import asyncio
        asyncio.get_event_loop().create_task(
            bus.subscribe("veille.new_event", self._handle_veille_event)
        )

        logger.info("conflit_agent.started", interval_hours=2)

    async def stop(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
        logger.info("conflit_agent.stopped")

    # ------------------------------------------------------------------
    # Bus handler
    # ------------------------------------------------------------------

    async def _handle_veille_event(self, payload: dict) -> None:
        """
        Reçoit les événements VeilleAgent et filtre les événements de type conflit.
        """
        hazard = str(payload.get("hazard_type") or payload.get("event_type") or "").lower()
        if "conflict" not in hazard and "conflit" not in hazard and "violence" not in hazard:
            return
        try:
            event = self._normalize_veille_event(payload)
            if event:
                _EVENT_STORE.append(event)
                logger.debug(
                    "conflit_agent.event_ingested",
                    event_id=event.get("external_id"),
                    province=event.get("province"),
                )
        except Exception as exc:
            logger.error("conflit_agent.ingest_error", error=str(exc))

    # ------------------------------------------------------------------
    # Core analysis
    # ------------------------------------------------------------------

    async def run_analysis(self) -> None:
        """
        Analyse les événements de conflit récents et calcule les prédictions
        de déplacement par province.
        """
        logger.info("conflit_agent.run_analysis.start")
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=30)

        # Filtrer les événements récents
        recent = [
            e for e in _EVENT_STORE
            if _parse_dt(e.get("event_date")) >= cutoff
        ]

        # Agréger par province
        by_province: dict[str, list[dict]] = {}
        for e in recent:
            p = e.get("province") or "Unknown"
            by_province.setdefault(p, []).append(e)

        predictions: list[dict] = []
        for province, events in by_province.items():
            pred = self._predict_displacement(province, events, now)
            if pred:
                predictions.append(pred)
                if pred.get("displaced_estimate_high", 0) >= _CRITICAL_DISPLACEMENT_THRESHOLD:
                    await bus.publish("conflit.critical", {
                        "province": province,
                        "displaced_low":  pred["displaced_estimate_low"],
                        "displaced_high": pred["displaced_estimate_high"],
                        "confidence":     pred["confidence"],
                        "horizon_days":   pred["horizon_days"],
                        "actors":         [a.get("nom_acled") for a in (pred.get("actors") or [])],
                    })

        _PREDICTION_STORE.clear()
        _PREDICTION_STORE.extend(predictions)

        logger.info(
            "conflit_agent.run_analysis.done",
            provinces_analysed=len(by_province),
            predictions=len(predictions),
        )

    # ------------------------------------------------------------------
    # Prediction logic
    # ------------------------------------------------------------------

    def _predict_displacement(
        self,
        province: str,
        events: list[dict],
        now: datetime,
    ) -> dict | None:
        if not events:
            return None

        # Résoudre les acteurs mentionnés dans les événements
        actor_names: list[str] = []
        for e in events:
            for name in e.get("actor_names", []):
                if name and name not in actor_names:
                    actor_names.append(name)

        resolved_actors = [resolve_actor(n, province) for n in actor_names]
        resolved_actors = [a for a in resolved_actors if a is not None]

        # Calculer le facteur d'amplification selon les acteurs documentés
        amp_factor = 1.0
        for actor in resolved_actors:
            from agents.conflit.data.armed_actors_rdc import ACTORS_BY_ACLED_NAME
            ref = ACTORS_BY_ACLED_NAME.get(actor.nom_acled or "")
            if ref:
                amp_factor = max(amp_factor, ref.get("facteur_amplification_deplacement", 1.0))

        # Estimation de base : 5 000 personnes par événement grave × facteur acteur
        n_severe = sum(1 for e in events if e.get("severity", 1) >= 3)
        base_estimate = n_severe * 5_000 * amp_factor

        return {
            "prediction_id":         str(uuid.uuid4()),
            "province":              province,
            "horizon_days":          7,
            "displaced_estimate_low":  int(base_estimate * 0.7),
            "displaced_estimate_high": int(base_estimate * 1.3),
            "confidence":            0.55 + min(0.20, len(events) * 0.02),
            "actors":                [a.model_dump(exclude={"classification"}) for a in resolved_actors],
            "events_count":          len(events),
            "generated_at":          now.isoformat(),
        }

    # ------------------------------------------------------------------
    # Normalisation
    # ------------------------------------------------------------------

    def _normalize_veille_event(self, payload: dict) -> dict | None:
        event_id = payload.get("id") or str(uuid.uuid4())
        province = payload.get("province") or payload.get("location") or "Unknown"
        return {
            "external_id":   event_id,
            "source":        payload.get("source", "veille"),
            "event_date":    payload.get("event_date") or datetime.now(timezone.utc).isoformat(),
            "event_type":    payload.get("hazard_type") or payload.get("event_type") or "conflict",
            "province":      province,
            "severity":      int(payload.get("severity") or 2),
            "displacement_risk": float(payload.get("displacement_risk") or 0.5),
            "territoire":    payload.get("territoire"),
            "p_code":        payload.get("p_code") or payload.get("location_pcode"),
            "coordinates":   payload.get("coordinates"),
            "fatalities_reported": payload.get("fatalities"),
            "raw_notes":     payload.get("notes") or payload.get("description"),
            "source_url":    payload.get("source_url"),
            "actor_names":   payload.get("actors") or [],
        }

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def get_events(self, province: str | None = None, since_days: int = 7) -> list[dict]:
        cutoff = datetime.now(timezone.utc) - timedelta(days=since_days)
        result = [
            e for e in _EVENT_STORE
            if _parse_dt(e.get("event_date")) >= cutoff
        ]
        if province:
            result = [e for e in result if e.get("province") == province]
        return result

    def get_predictions(self, province: str | None = None) -> list[dict]:
        if province:
            return [p for p in _PREDICTION_STORE if p.get("province") == province]
        return list(_PREDICTION_STORE)

    def get_public_risk_map(self) -> list[dict]:
        """Vue PUBLIC — niveau de tension par province uniquement, sans nom d'acteur."""
        summary: dict[str, dict] = {}
        for e in _EVENT_STORE:
            p = e.get("province") or "Unknown"
            if p not in summary:
                summary[p] = {"province": p, "event_count": 0, "max_severity": 1, "displacement_risk_max": 0.0}
            summary[p]["event_count"] += 1
            summary[p]["max_severity"] = max(summary[p]["max_severity"], e.get("severity", 1))
            summary[p]["displacement_risk_max"] = max(
                summary[p]["displacement_risk_max"],
                float(e.get("displacement_risk") or 0),
            )
        return list(summary.values())

    def get_status(self) -> dict:
        return {
            "agent": "conflit",
            "scheduler_running": self._scheduler.running,
            "events_stored": len(_EVENT_STORE),
            "predictions_stored": len(_PREDICTION_STORE),
        }


def _parse_dt(val: Any) -> datetime:
    if isinstance(val, datetime):
        return val.replace(tzinfo=timezone.utc) if val.tzinfo is None else val
    if isinstance(val, str):
        try:
            dt = datetime.fromisoformat(val)
            return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
        except ValueError:
            pass
    return datetime.min.replace(tzinfo=timezone.utc)


# Module-level singleton
conflit_agent = ConflitAgent()
