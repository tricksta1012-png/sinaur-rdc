"""
RenseignementAgent — Agent 10.
Surveillance renseignement militaire & sécuritaire RDC.
Cadence : 2 heures. Scope : RESTRICTED.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from .schemas import IntelBulletin, IntelEvent, ProvinceAssessment
from .sources.radio_okapi import fetch_okapi_events
from .sources.acled_deep import fetch_acled_deep
from .analyzers.threat_assessment import assess_provinces

logger = structlog.get_logger(__name__)

_EVENT_STORE: list[dict] = []
_ASSESSMENT_STORE: list[dict] = []
_BULLETIN_STORE: list[dict] = []

_REDIS_KEY_EVENTS = "renseignement:events:v1"
_REDIS_KEY_ASSESSMENTS = "renseignement:assessments:v1"
_REDIS_TTL = 86_400


class RenseignementAgent:
    """Agent 10 — Renseignement militaire & sécuritaire. Cadence 2h."""

    def __init__(self) -> None:
        self._scheduler = AsyncIOScheduler(timezone="UTC")

    async def start(self) -> None:
        self._scheduler.add_job(
            self.run_analysis, "interval", hours=2,
            id="renseignement_analysis", name="Renseignement:analyse",
            next_run_time=datetime.now(timezone.utc),
            misfire_grace_time=600, coalesce=True,
        )
        self._scheduler.start()
        logger.info("renseignement_agent.started")

    async def stop(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
        logger.info("renseignement_agent.stopped")

    async def run_analysis(self) -> None:
        logger.info("renseignement_agent.run_analysis.start")
        events: list[IntelEvent] = []

        try:
            okapi = await fetch_okapi_events()
            events.extend(okapi)
            logger.info("renseignement_agent.okapi_fetched", count=len(okapi))
        except Exception as exc:
            logger.warning("renseignement_agent.okapi_failed", error=str(exc))

        try:
            acled = await fetch_acled_deep(days=14)
            events.extend(acled)
            logger.info("renseignement_agent.acled_fetched", count=len(acled))
        except Exception as exc:
            logger.warning("renseignement_agent.acled_failed", error=str(exc))

        if not events:
            logger.warning("renseignement_agent.no_events")
            return

        _EVENT_STORE.clear()
        _EVENT_STORE.extend([e.model_dump() for e in events])

        assessments = assess_provinces(events)
        _ASSESSMENT_STORE.clear()
        _ASSESSMENT_STORE.extend([a.model_dump() for a in assessments])

        bulletin = self._generate_bulletin(events, assessments)
        _BULLETIN_STORE.clear()
        _BULLETIN_STORE.append(bulletin.model_dump())

        await self._save_to_redis()
        logger.info("renseignement_agent.run_analysis.done",
                    events=len(events), assessments=len(assessments))

    def _generate_bulletin(
        self, events: list[IntelEvent], assessments: list[ProvinceAssessment]
    ) -> IntelBulletin:
        from datetime import timedelta
        now = datetime.now(timezone.utc)
        critical = [a for a in assessments if a.threat_level >= 4]
        high = [a for a in assessments if a.threat_level == 3]

        summary_parts = []
        if critical:
            provs = ", ".join(a.province for a in critical[:3])
            summary_parts.append(f"{len(critical)} province(s) en situation CRITIQUE ou SÉVÈRE : {provs}.")
        if high:
            summary_parts.append(f"{len(high)} province(s) à niveau ÉLEVÉ.")
        summary_parts.append(f"{len(events)} événements analysés sur 14 jours.")

        return IntelBulletin(
            bulletin_id=str(uuid.uuid4()),
            generated_at=now.isoformat(),
            period_start=(now - timedelta(days=14)).isoformat(),
            period_end=now.isoformat(),
            critical_count=len(critical),
            high_count=len(high),
            summary=" ".join(summary_parts),
            province_assessments=assessments,
            key_events=events[:10],
        )

    async def _save_to_redis(self) -> None:
        try:
            import json
            from redis_client import get_redis
            r = get_redis()
            await r.setex(_REDIS_KEY_EVENTS, _REDIS_TTL, json.dumps(_EVENT_STORE))
            await r.setex(_REDIS_KEY_ASSESSMENTS, _REDIS_TTL, json.dumps(_ASSESSMENT_STORE))
        except Exception as exc:
            logger.warning("renseignement_agent.redis_save_failed", error=str(exc))

    def get_events(self, category: str | None = None, p_code: str | None = None) -> list[dict]:
        result = list(_EVENT_STORE)
        if category:
            result = [e for e in result if e.get("category") == category]
        if p_code:
            result = [e for e in result if e.get("p_code") == p_code]
        return result

    def get_assessments(self) -> list[dict]:
        return list(_ASSESSMENT_STORE)

    def get_bulletin(self) -> dict | None:
        return _BULLETIN_STORE[0] if _BULLETIN_STORE else None

    def get_status(self) -> dict:
        return {
            "agent": "renseignement",
            "scheduler_running": self._scheduler.running,
            "events_stored": len(_EVENT_STORE),
            "assessments_stored": len(_ASSESSMENT_STORE),
            "has_bulletin": bool(_BULLETIN_STORE),
        }


renseignement_agent = RenseignementAgent()
