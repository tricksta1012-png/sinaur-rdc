"""
VeilleAgent — orchestrator for all data connectors.
Uses APScheduler to run each connector on its own interval.
"""
from __future__ import annotations

from datetime import datetime, timezone

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from agents.veille.connectors.acled import AcledConnector
from agents.veille.connectors.base import AbstractConnector
from agents.veille.connectors.fews_net import FewsNetConnector
from agents.veille.connectors.firms import FirmsConnector
from agents.veille.connectors.gdelt import GDELTConnector
from agents.veille.connectors.kivu_security_tracker import KivuSecurityTrackerConnector
from agents.veille.connectors.mettelsat import MettelSatConnector
from agents.veille.connectors.ocha_hdx import OchaHdxConnector
from agents.veille.connectors.ohchr import OHCHRConnector
from agents.veille.connectors.open_meteo import OpenMeteoConnector
from agents.veille.connectors.reliefweb import ReliefWebConnector
from agents.veille.connectors.reliefweb_conflict import ReliefWebConflictConnector
from agents.veille.connectors.telegram import TelegramConnector
from agents.veille.connectors.ucdp_ged import UCDPConnector
from agents.veille.deduplicator import Deduplicator
from config import settings
from schemas.events import CanonicalEvent

logger = structlog.get_logger(__name__)

# In-memory event store (keyed by fingerprint)
_EVENT_STORE: dict[str, CanonicalEvent] = {}

# Connector health tracker: source_id → dict
_CONNECTOR_HEALTH: dict[str, dict] = {}


class VeilleAgent:
    """
    Orchestrates all data connectors with APScheduler.
    Each connector runs on its own fetch_interval_minutes schedule.
    """

    def __init__(self) -> None:
        self._scheduler = AsyncIOScheduler(timezone="UTC")
        self._deduplicator = Deduplicator()
        connectors: list[AbstractConnector] = [
            ReliefWebConnector(),
            OpenMeteoConnector(),
            FewsNetConnector(),
            OchaHdxConnector(),
            MettelSatConnector(),
            FirmsConnector(),
            ReliefWebConflictConnector(),
            # ── Sources conflit multi-sources ──
            UCDPConnector(),               # contrôle qualité, décès vérifiés (public)
            GDELTConnector(),              # signal précoce temps réel (public)
            KivuSecurityTrackerConnector(),# spécialisé Est RDC (public si API dispo)
            OHCHRConnector(),              # violations droits humains (public via ReliefWeb)
        ]
        # ACLED uniquement si credentials configurées
        if settings.acled_api_key:
            connectors.append(AcledConnector())
        # Telegram : web preview par défaut, Bot API si token configuré
        connectors.append(
            TelegramConnector(
                bot_token=settings.telegram_bot_token or None,
            )
        )
        self._connectors = connectors

    async def start(self) -> None:
        """Register all connector jobs and start the scheduler."""
        for connector in self._connectors:
            interval_minutes = connector.fetch_interval_minutes
            self._scheduler.add_job(
                self._run_connector,
                "interval",
                minutes=interval_minutes,
                args=[connector],
                id=f"veille_{connector.source_id}",
                name=f"Veille:{connector.source_id}",
                next_run_time=datetime.now(timezone.utc),  # run immediately at startup
                misfire_grace_time=300,
                coalesce=True,
            )
            logger.info(
                "veille_agent.job_registered",
                source=connector.source_id,
                interval_minutes=interval_minutes,
            )

        self._scheduler.start()
        logger.info("veille_agent.started", connector_count=len(self._connectors))

    async def stop(self) -> None:
        """Stop the scheduler gracefully."""
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
        logger.info("veille_agent.stopped")

    async def run_connector_by_id(self, source_id: str) -> dict:
        """Manually trigger a specific connector by source_id."""
        connector = next((c for c in self._connectors if c.source_id == source_id), None)
        if connector is None:
            raise ValueError(f"Unknown connector source_id: '{source_id}'")
        return await self._run_connector(connector)

    async def _run_connector(self, connector: AbstractConnector) -> dict:
        """
        Fetch, normalize, deduplicate, and store events for one connector.
        Updates the connector health dict.
        """
        source_id = connector.source_id
        started_at = datetime.now(timezone.utc)
        result = {
            "source_id": source_id,
            "started_at": started_at.isoformat(),
            "raw_count": 0,
            "canonical_count": 0,
            "new_count": 0,
            "error": None,
        }

        try:
            raw_events = await connector.fetch_with_retry()
            result["raw_count"] = len(raw_events)

            canonical: list[CanonicalEvent] = []
            for raw in raw_events:
                try:
                    event = await connector.normalize(raw)
                    canonical.append(event)
                except Exception as norm_exc:
                    logger.warning(
                        "veille_agent.normalize_error",
                        source=source_id,
                        external_id=raw.external_id,
                        error=str(norm_exc),
                    )

            result["canonical_count"] = len(canonical)

            # Deduplicate and store
            new_events = self._deduplicator.process(canonical)
            result["new_count"] = len(new_events)

            for event in new_events:
                from agents.veille.deduplicator import compute_fingerprint
                fp = compute_fingerprint(event)
                _EVENT_STORE[fp] = event

            # Persister en base via evenement_flux (ON CONFLICT DO NOTHING = dédup SQL)
            if canonical:
                try:
                    flux_n = await self._propagate_to_flux(canonical)
                    result["flux_count"] = flux_n
                except Exception as flux_exc:
                    logger.warning(
                        "veille_agent.flux_propagation_failed",
                        source=source_id,
                        error=str(flux_exc),
                    )

            self._feed_feature_cache(connector, canonical)

            _CONNECTOR_HEALTH[source_id] = {
                "healthy": True,
                "last_success": started_at.isoformat(),
                "last_raw_count": len(raw_events),
                "last_new_count": len(new_events),
                "consecutive_failures": connector._consecutive_failures,
                "circuit_open": connector._circuit_open,
            }

            logger.info(
                "veille_agent.connector_run_success",
                source=source_id,
                raw=len(raw_events),
                canonical=len(canonical),
                new=len(new_events),
            )

        except Exception as exc:
            result["error"] = str(exc)
            _CONNECTOR_HEALTH[source_id] = {
                "healthy": False,
                "last_error": str(exc),
                "last_error_at": started_at.isoformat(),
                "consecutive_failures": connector._consecutive_failures,
                "circuit_open": connector._circuit_open,
            }
            logger.error(
                "veille_agent.connector_run_failed",
                source=source_id,
                error=str(exc),
            )

        return result

    async def _propagate_to_flux(self, events: list[CanonicalEvent]) -> int:
        """Persiste les nouveaux événements dans evenement_flux (table pivot commune)."""
        from db import engine
        from sqlalchemy import text

        _TYPE_MAP = {
            "CONFLIT":     "CONFLIT",
            "EPIDEMIE":    "EPIDEMIE",
            "INONDATION":  "CATASTROPHE",
            "GLISSEMENT":  "CATASTROPHE",
            "VOLCAN":      "CATASTROPHE",
            "SECHERESSE":  "CATASTROPHE",
            "DEPLACEMENT": "HUMANITAIRE",
            "AUTRE":       "AUTRE",
        }

        def _gravite(severity: int) -> str:
            if severity >= 4: return "CRITIQUE"
            if severity >= 3: return "ELEVEE"
            return "NORMALE"

        def _statut(e: CanonicalEvent) -> str:
            if e.sources_count >= 3 or e.corroboration_score >= 0.6:
                return "CORROBORE"
            if e.sources_count >= 2 or e.corroboration_score >= 0.3:
                return "PROBABLE"
            return "A_CORROBORER"

        inserted = 0
        errors = 0
        async with engine.connect() as conn:
            for e in events:
                grav = _gravite(e.severity)
                stat = _statut(e)
                impacte = stat in ("CORROBORE", "PROBABLE") and grav in ("ELEVEE", "CRITIQUE")
                lat = e.coordinates[1] if e.coordinates else None
                lon = e.coordinates[0] if e.coordinates else None
                fiabilite = min(1.0, e.reliability_score + 0.1 * e.corroboration_score)
                type_ev = _TYPE_MAP.get(e.event_type.value, "AUTRE")

                try:
                    async with conn.begin_nested():
                        result = await conn.execute(text("""
                            INSERT INTO evenement_flux (
                                source_agent, type_evenement, titre, description,
                                province_pcode, lat, lon,
                                fiabilite, statut_verification, nb_sources,
                                gravite, impacte_statut,
                                source_url, source_externe_id, date_evenement
                            ) VALUES (
                                'VEILLE', :type_ev, :titre, :desc,
                                COALESCE(
                                  (SELECT pcode FROM admin_divisions WHERE level=1 AND pcode = :pcode LIMIT 1),
                                  CASE WHEN :lat IS NOT NULL AND :lon IS NOT NULL THEN
                                    (SELECT pcode FROM admin_divisions WHERE level=1
                                     AND ST_Within(ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), geometry) LIMIT 1)
                                  END
                                ),
                                :lat, :lon,
                                :fiabilite, :statut, :nb_sources,
                                :gravite, :impacte,
                                :url, :ext_id, :date_ev
                            )
                            ON CONFLICT (source_agent, source_externe_id)
                            WHERE source_externe_id IS NOT NULL
                            DO NOTHING
                        """), {
                            "type_ev":    type_ev,
                            "titre":      e.title[:500],
                            "desc":       e.description,
                            "pcode":      e.p_code,
                            "lat":        lat,
                            "lon":        lon,
                            "fiabilite":  round(fiabilite, 2),
                            "statut":     stat,
                            "nb_sources": e.sources_count,
                            "gravite":    grav,
                            "impacte":    impacte,
                            "url":        e.source_url,
                            "ext_id":     f"{e.source_id}:{e.external_id}",
                            "date_ev":    e.fetched_at,
                        })
                        inserted += result.rowcount
                except Exception as row_exc:
                    errors += 1
                    logger.debug(
                        "veille_agent.flux_row_skipped",
                        ext_id=e.external_id,
                        error=str(row_exc)[:120],
                    )

            await conn.commit()

        logger.info("veille_agent.flux_propagated", inserted=inserted, errors=errors)
        return inserted

    def _feed_feature_cache(
        self, connector: AbstractConnector, canonical: list[CanonicalEvent]
    ) -> None:
        """Push connector output into the prediction feature cache."""
        try:
            from agents.prediction.features import update_event_cache, update_weather_cache

            if connector.source_id == "open_meteo":
                for event in canonical:
                    if not event.p_code or not event.raw_data:
                        continue
                    daily = event.raw_data.get("forecast", {}).get("daily", {})
                    precip_list = [
                        v for v in (daily.get("precipitation_sum") or []) if v is not None
                    ]
                    update_weather_cache(event.p_code, {
                        "precipitation_7j_mm": sum(precip_list),
                    })
            else:
                counts: dict[str, int] = {}
                for event in canonical:
                    if event.p_code:
                        counts[event.p_code] = counts.get(event.p_code, 0) + 1
                for p_code, count in counts.items():
                    update_event_cache(p_code, {"nb_evenements_meme_type_7j": count})

            logger.debug(
                "veille_agent.feature_cache_fed",
                source=connector.source_id,
                events=len(canonical),
            )
        except Exception as exc:
            logger.warning(
                "veille_agent.feature_cache_failed",
                source=connector.source_id,
                error=str(exc),
            )

    def get_events(
        self,
        since: datetime | None = None,
        event_type: str | None = None,
        province: str | None = None,
    ) -> list[CanonicalEvent]:
        """Return stored events filtered by optional criteria."""
        events = list(_EVENT_STORE.values())

        if since is not None:
            # Make since offset-aware if naive
            if since.tzinfo is None:
                since = since.replace(tzinfo=timezone.utc)
            events = [
                e for e in events
                if (
                    e.fetched_at.replace(tzinfo=timezone.utc)
                    if e.fetched_at.tzinfo is None
                    else e.fetched_at
                ) >= since
            ]

        if event_type is not None:
            events = [e for e in events if e.event_type.value == event_type.upper()]

        if province is not None:
            province_lower = province.lower()
            events = [
                e for e in events
                if (e.province or "").lower() == province_lower
                or (e.p_code or "").lower() == province_lower
            ]

        return events

    def get_health(self) -> dict:
        """Return health status for all connectors."""
        connector_statuses = []
        for connector in self._connectors:
            health = _CONNECTOR_HEALTH.get(connector.source_id, {})
            connector_statuses.append({
                "source_id": connector.source_id,
                "fetch_interval_minutes": connector.fetch_interval_minutes,
                "circuit_open": connector._circuit_open,
                "consecutive_failures": connector._consecutive_failures,
                **health,
            })
        return {
            "agent": "veille",
            "scheduler_running": self._scheduler.running,
            "connectors": connector_statuses,
            "deduplicator": self._deduplicator.stats(),
            "event_store_size": len(_EVENT_STORE),
        }


# Module-level singleton
veille_agent = VeilleAgent()
