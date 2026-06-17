"""
ConflitAgent — Agent 9.

Surveillance des conflits armés et prédiction des déplacements de populations.
Cadence : toutes les 2 heures.

Sources :
  - disaster_events table (Neon Postgres) — bootstrap au démarrage
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
from agents.conflit.corroboration_engine import CorroborationEngine
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

_REDIS_CACHE_KEY = "conflit:events:v1"
_REDIS_TTL       = 86_400  # 24 h


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
        self._corroboration_engine = CorroborationEngine()

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
            next_run_time=datetime.now(timezone.utc),  # run immediately at startup
            misfire_grace_time=600,
            coalesce=True,
        )
        self._scheduler.start()

        import asyncio
        asyncio.get_event_loop().create_task(
            bus.subscribe("veille.new_event", self._handle_veille_event)
        )

        # Try Redis cache first — avoids cold-start latency and API dependency
        loaded = await self._load_from_redis()
        if not loaded:
            await self._bootstrap_from_db()

        logger.info("conflit_agent.started", interval_hours=2, events_loaded=len(_EVENT_STORE))

    async def stop(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
        logger.info("conflit_agent.stopped")

    # ------------------------------------------------------------------
    # Bootstrap
    # ------------------------------------------------------------------

    async def _load_from_redis(self) -> bool:
        """Return True and populate _EVENT_STORE if a valid cache entry exists in Redis."""
        try:
            import json
            from redis_client import get_redis
            cached = await get_redis().get(_REDIS_CACHE_KEY)
            if cached:
                events = json.loads(cached)
                if events:
                    _EVENT_STORE.extend(events)
                    logger.info("conflit_agent.redis_loaded", count=len(events))
                    print(f"[conflit] redis_loaded count={len(events)}", flush=True)
                    return True
        except Exception as exc:
            logger.warning("conflit_agent.redis_load_failed", error=str(exc))
            print(f"[conflit] redis_load_failed error={exc}", flush=True)
        return False

    async def _save_to_redis(self) -> None:
        """Persist current _EVENT_STORE to Redis with TTL."""
        try:
            import json
            from redis_client import get_redis
            await get_redis().setex(_REDIS_CACHE_KEY, _REDIS_TTL, json.dumps(_EVENT_STORE))
            logger.info("conflit_agent.redis_saved", count=len(_EVENT_STORE))
            print(f"[conflit] redis_saved count={len(_EVENT_STORE)}", flush=True)
        except Exception as exc:
            logger.warning("conflit_agent.redis_save_failed", error=str(exc))
            print(f"[conflit] redis_save_failed error={exc}", flush=True)

    async def _bootstrap_from_db(self) -> None:
        """
        Populate _EVENT_STORE by calling the Fastify API's /events endpoint.
        This avoids direct DB access and always reads from the same Neon database
        that the API service uses, regardless of the DATABASE_URL env var.
        """
        if _EVENT_STORE:
            return
        try:
            from config import settings
            import httpx

            severity_map = {"Extreme": 5, "Severe": 4, "Moderate": 3, "Minor": 2, "Unknown": 1}
            pcode_to_province = {
                "CD10": "Kinshasa", "CD20": "Kongo-Central", "CD21": "Kwango",
                "CD22": "Kwilu", "CD23": "Maï-Ndombe", "CD41": "Équateur",
                "CD42": "Sud-Ubangi", "CD43": "Nord-Ubangi", "CD44": "Mongala",
                "CD45": "Tshuapa", "CD51": "Tshopo", "CD52": "Bas-Uélé",
                "CD53": "Haut-Uélé", "CD54": "Ituri", "CD61": "Nord-Kivu",
                "CD62": "Sud-Kivu", "CD63": "Maniema", "CD71": "Haut-Katanga",
                "CD72": "Lualaba", "CD73": "Haut-Lomami", "CD74": "Tanganyika",
                "CD81": "Lomami", "CD82": "Kasaï-Oriental", "CD83": "Kasaï",
                "CD84": "Kasaï-Central", "CD85": "Sankuru",
            }

            api_url = settings.api_service_url.rstrip("/")
            rows_list: list[dict] = []

            async with httpx.AsyncClient(timeout=30.0) as client:
                for hazard_type in ["conflict", "mass_displacement"]:
                    page = 1
                    while True:
                        resp = await client.get(
                            f"{api_url}/events",
                            params={"hazardType": hazard_type, "limit": 100, "page": page},
                        )
                        resp.raise_for_status()
                        data = resp.json()
                        events = data.get("data", [])
                        if not events:
                            break
                        rows_list.extend(events)
                        pagination = data.get("pagination", {})
                        if page >= pagination.get("totalPages", 1):
                            break
                        page += 1

            print(f"[conflit] bootstrap API returned {len(rows_list)} rows", flush=True)

            for row in rows_list:
                if row.get("status") in ("rejected", "resolved"):
                    continue
                sev_str = str(row.get("severity") or "Unknown")
                sev = severity_map.get(sev_str, 1)
                p_code = row.get("locationPcode") or ""
                province = pcode_to_province.get(p_code, p_code or "Unknown")
                event_date = row.get("startDate") or row.get("createdAt") or datetime.now(timezone.utc).isoformat()
                _EVENT_STORE.append({
                    "external_id":         str(row.get("id") or uuid.uuid4()),
                    "source":              row.get("source", "api"),
                    "event_date":          event_date,
                    "event_type":          str(row.get("hazardType") or "conflict"),
                    "province":            province,
                    "p_code":              p_code,
                    "severity":            sev,
                    "displacement_risk":   0.65 if row.get("hazardType") == "mass_displacement" else 0.45,
                    "territoire":          row.get("locationName"),
                    "coordinates":         None,
                    "fatalities_reported": None,
                    "raw_notes":           row.get("description"),
                    "source_url":          None,
                    "actor_names":         [],
                })

            print(f"[conflit] bootstrap_done events_loaded={len(_EVENT_STORE)}", flush=True)
            logger.info("conflit_agent.bootstrap_done", events_loaded=len(_EVENT_STORE))
            await self._save_to_redis()
        except Exception as exc:
            import traceback
            print(f"[conflit] bootstrap_FAILED error={exc}", flush=True)
            print(traceback.format_exc(), flush=True)
            logger.warning("conflit_agent.bootstrap_failed", error=str(exc))

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
        de déplacement par province. Persiste les données brutes et corroborées en DB.
        """
        import asyncio
        from agents.conflit.persist import save_raw_events, upsert_corroborated

        logger.info("conflit_agent.run_analysis.start")

        # Re-bootstrap si le store est vide (normal au premier cycle ou après redémarrage)
        if not _EVENT_STORE:
            logger.info("conflit_agent.store_empty_retrying_bootstrap")
            await self._bootstrap_from_db()

        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=30)

        # Filtrer les événements récents
        recent = [
            e for e in _EVENT_STORE
            if _parse_dt(e.get("event_date")) >= cutoff
        ]

        # Persister les événements bruts et les clusters corroborés en parallèle
        corroborated = self._corroboration_engine.corroborate(recent)
        try:
            await asyncio.gather(
                save_raw_events(recent),
                upsert_corroborated(corroborated),
                return_exceptions=True,
            )
        except Exception as exc:
            logger.warning("conflit_agent.persist_failed", error=str(exc))

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
                # Alerte critique si déplacements estimés ≥ seuil ET confiance suffisante
                if (
                    pred.get("displaced_estimate_high", 0) >= _CRITICAL_DISPLACEMENT_THRESHOLD
                ):
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
            events_persisted=len(recent),
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
        # Appliquer la corroboration inter-sources
        return self._corroboration_engine.corroborate(result)

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
