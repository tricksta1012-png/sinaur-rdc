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
from agents.veille.connectors.mettelsat import MettelSatConnector
from agents.veille.connectors.ocha_hdx import OchaHdxConnector
from agents.veille.connectors.open_meteo import OpenMeteoConnector
from agents.veille.connectors.reliefweb import ReliefWebConnector
from agents.veille.connectors.reliefweb_conflict import ReliefWebConflictConnector
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
        ]
        # ACLED only enabled when credentials are configured
        if settings.acled_api_key:
            connectors.append(AcledConnector())
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
