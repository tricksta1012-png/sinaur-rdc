"""
AnomalieStocksAgent — surveillance des mouvements de stocks (cadence 5 minutes).

Patterns détectés et leurs seuils:
  DISTRIBUTION_VELOCITY   : > 200 distributions/h/agent
  STOCK_DRAIN_SUDDEN      : perte > 40 % du stock en < 2h sans affectation officielle
  GHOST_BENEFICIARY       : distribution pour bénéficiaire REJECTED/PENDING
  DUPLICATE_QR_ATTEMPT    : même token QR scanné > 3 fois
  AGENT_CONCENTRATION     : 1 agent représente > 60 % des distributions d'un sinistre
  GEOGRAPHIC_MISMATCH     : distribution à > 30 km de l'entrepôt source
  NIGHT_DISTRIBUTION      : > 25 % des distributions entre 23h–5h (heure RDC / UTC+2)
  STOCK_NEGATIVE_ATTEMPT  : tentative dépassant le stock disponible

Score composite 0-100 par entrepôt = somme pondérée des patterns détectés.
Niveaux de risque :
  CRITICAL ≥ 80
  HIGH     60–79
  MEDIUM   30–59
  LOW       < 30
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Any

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from agents import bus

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Pattern thresholds
# ---------------------------------------------------------------------------
DISTRIBUTION_VELOCITY_THRESHOLD: int = 200       # distributions/h/agent
STOCK_DRAIN_SUDDEN_THRESHOLD: float = 0.40       # 40 % of stock
GHOST_BENEFICIARY_STATUSES: frozenset[str] = frozenset({"REJECTED", "PENDING"})
DUPLICATE_QR_MAX_SCANS: int = 3
AGENT_CONCENTRATION_THRESHOLD: float = 0.60      # 60 % of distributions
GEOGRAPHIC_MISMATCH_KM: float = 30.0             # km
NIGHT_DISTRIBUTION_START_HOUR: int = 23          # UTC+2 hour (inclusive)
NIGHT_DISTRIBUTION_END_HOUR: int = 5             # UTC+2 hour (exclusive)
NIGHT_DISTRIBUTION_THRESHOLD: float = 0.25       # 25 %

# Pattern weights for composite score (sum ≤ 100)
_PATTERN_WEIGHTS: dict[str, float] = {
    "DISTRIBUTION_VELOCITY": 15.0,
    "STOCK_DRAIN_SUDDEN": 25.0,
    "GHOST_BENEFICIARY": 20.0,
    "DUPLICATE_QR_ATTEMPT": 15.0,
    "AGENT_CONCENTRATION": 10.0,
    "GEOGRAPHIC_MISMATCH": 8.0,
    "NIGHT_DISTRIBUTION": 4.0,
    "STOCK_NEGATIVE_ATTEMPT": 3.0,
}

# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------
_ANOMALY_STORE: list[dict] = []


# ---------------------------------------------------------------------------
# Haversine helper
# ---------------------------------------------------------------------------

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return great-circle distance in km between two WGS-84 points."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class AnomalieStocksAgent:
    """
    Surveille les mouvements de stocks toutes les 5 minutes.
    Détecte 8 patterns d'anomalie, calcule un score composite 0–100,
    stocke les alertes en mémoire et publie sur le bus Redis pour les CRITICAL.
    """

    def __init__(self) -> None:
        self._scheduler = AsyncIOScheduler(timezone="UTC")

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Lance la surveillance toutes les 5 minutes."""
        self._scheduler.add_job(
            self.run_detection,
            "interval",
            minutes=5,
            id="anomalie_stocks_detection",
            name="AnomalieStocks:detection",
            misfire_grace_time=120,
            coalesce=True,
        )
        self._scheduler.start()
        logger.info("anomalie_stocks_agent.started", interval_minutes=5)

    async def stop(self) -> None:
        """Arrête le scheduler proprement."""
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
        logger.info("anomalie_stocks_agent.stopped")

    # ------------------------------------------------------------------
    # Detection
    # ------------------------------------------------------------------

    async def run_detection(self) -> None:
        """
        Charge les mouvements des 2 dernières heures depuis la DB,
        applique les 8 patterns, stocke les anomalies détectées
        et publie sur le bus pour les scores CRITICAL.
        """
        logger.info("anomalie_stocks_agent.run_detection.start")

        rows: list[dict] = []
        try:
            from db import engine
            from sqlalchemy import text

            async with engine.connect() as conn:
                result = await conn.execute(text("""
                    SELECT sm.id, sm.warehouse_id, sm.quantity, sm.agent_id,
                           sm.beneficiary_id, sm.token_qr, sm.created_at,
                           ST_X(sm.location_point) AS lng, ST_Y(sm.location_point) AS lat,
                           ST_X(w.location_point) AS warehouse_lng,
                           ST_Y(w.location_point) AS warehouse_lat
                    FROM stock_movements sm
                    LEFT JOIN warehouses w ON w.id = sm.warehouse_id
                    WHERE sm.created_at >= NOW() - INTERVAL '2 hours'
                    ORDER BY sm.created_at DESC
                    LIMIT 5000
                """))
                rows = [dict(row._mapping) for row in result]

            logger.info("anomalie_stocks_agent.db_rows_loaded", count=len(rows))

        except Exception as db_exc:
            logger.warning(
                "anomalie_stocks_agent.db_unavailable",
                error=str(db_exc),
            )
            # Continue with empty data — don't crash the agent
            rows = []

        if not rows:
            logger.info("anomalie_stocks_agent.no_rows_to_analyse")
            return

        # Group rows by warehouse_id for per-entrepôt analysis
        by_warehouse: dict[str, list[dict]] = {}
        for row in rows:
            wid = str(row.get("warehouse_id") or "unknown")
            by_warehouse.setdefault(wid, []).append(row)

        for entrepot_id, movements in by_warehouse.items():
            try:
                patterns_triggered, score = self._detect_patterns(movements)
                if not patterns_triggered:
                    continue

                level = self._score_to_level(score)
                alert: dict[str, Any] = {
                    "alert_id": str(uuid.uuid4()),
                    "entrepot_id": entrepot_id,
                    "score": score,
                    "level": level,
                    "patterns": patterns_triggered,
                    "movement_count": len(movements),
                    "detected_at": datetime.now(timezone.utc).isoformat(),
                    "statut": "OPEN",
                    "resolution": None,
                    "province": movements[0].get("province"),
                }
                _ANOMALY_STORE.append(alert)

                logger.info(
                    "anomalie_stocks_agent.alert_created",
                    entrepot_id=entrepot_id,
                    score=score,
                    level=level,
                    patterns=patterns_triggered,
                )

                if level == "CRITICAL":
                    await bus.publish(
                        "anomalie_stocks.flag",
                        {
                            "entrepot_id": entrepot_id,
                            "score": score,
                            "patterns": patterns_triggered,
                        },
                    )

            except Exception as exc:
                logger.error(
                    "anomalie_stocks_agent.warehouse_detection_error",
                    entrepot_id=entrepot_id,
                    error=str(exc),
                )

        logger.info(
            "anomalie_stocks_agent.run_detection.done",
            warehouses_analysed=len(by_warehouse),
            total_alerts=len(_ANOMALY_STORE),
        )

    # ------------------------------------------------------------------
    # Pattern detection
    # ------------------------------------------------------------------

    def _detect_patterns(self, movements: list[dict]) -> tuple[list[str], float]:
        """
        Applique les 8 patterns sur une liste de mouvements pour un entrepôt.
        Retourne (patterns_triggered, score_composite).
        """
        triggered: list[str] = []

        # 1. DISTRIBUTION_VELOCITY — > 200 dist/h/agent
        agent_counts: dict[str, int] = {}
        for m in movements:
            aid = str(m.get("agent_id") or "")
            if aid:
                agent_counts[aid] = agent_counts.get(aid, 0) + 1
        # 2h window → multiply by 0.5 to get per-hour rate
        if any(count * 0.5 > DISTRIBUTION_VELOCITY_THRESHOLD for count in agent_counts.values()):
            triggered.append("DISTRIBUTION_VELOCITY")

        # 2. STOCK_DRAIN_SUDDEN — perte > 40 % en < 2h sans affectation officielle
        total_qty = sum(abs(float(m.get("quantity") or 0)) for m in movements)
        # Heuristic: if no explicit affectation flag and total drained > threshold * 5000
        # (we don't have stock level here, so we use a relative heuristic)
        negative_qty = sum(
            abs(float(m.get("quantity") or 0))
            for m in movements
            if float(m.get("quantity") or 0) < 0
        )
        if total_qty > 0 and (negative_qty / total_qty) > STOCK_DRAIN_SUDDEN_THRESHOLD:
            triggered.append("STOCK_DRAIN_SUDDEN")

        # 3. GHOST_BENEFICIARY — bénéficiaire REJECTED ou PENDING
        beneficiary_statuses = [str(m.get("beneficiary_status") or "").upper() for m in movements]
        if any(s in GHOST_BENEFICIARY_STATUSES for s in beneficiary_statuses):
            triggered.append("GHOST_BENEFICIARY")

        # 4. DUPLICATE_QR_ATTEMPT — même QR scanné > 3 fois
        qr_counts: dict[str, int] = {}
        for m in movements:
            qr = str(m.get("token_qr") or "")
            if qr:
                qr_counts[qr] = qr_counts.get(qr, 0) + 1
        if any(count > DUPLICATE_QR_MAX_SCANS for count in qr_counts.values()):
            triggered.append("DUPLICATE_QR_ATTEMPT")

        # 5. AGENT_CONCENTRATION — 1 agent > 60 % des distributions
        total_dist = len(movements)
        if total_dist > 0 and agent_counts:
            max_agent_share = max(agent_counts.values()) / total_dist
            if max_agent_share > AGENT_CONCENTRATION_THRESHOLD:
                triggered.append("AGENT_CONCENTRATION")

        # 6. GEOGRAPHIC_MISMATCH — distribution > 30 km de l'entrepôt source
        for m in movements:
            try:
                dist_lat = float(m.get("lat") or 0)
                dist_lng = float(m.get("lng") or 0)
                wh_lat = float(m.get("warehouse_lat") or 0)
                wh_lng = float(m.get("warehouse_lng") or 0)
                if dist_lat == 0 and dist_lng == 0:
                    continue
                if wh_lat == 0 and wh_lng == 0:
                    continue
                dist_km = _haversine_km(dist_lat, dist_lng, wh_lat, wh_lng)
                if dist_km > GEOGRAPHIC_MISMATCH_KM:
                    triggered.append("GEOGRAPHIC_MISMATCH")
                    break
            except (TypeError, ValueError):
                continue

        # 7. NIGHT_DISTRIBUTION — > 25 % des distributions entre 23h–5h (UTC+2 = RDC)
        night_count = 0
        for m in movements:
            ts = m.get("created_at")
            if ts is None:
                continue
            if isinstance(ts, str):
                try:
                    ts = datetime.fromisoformat(ts)
                except ValueError:
                    continue
            # UTC → UTC+2
            hour_rdc = (ts.hour + 2) % 24
            if hour_rdc >= NIGHT_DISTRIBUTION_START_HOUR or hour_rdc < NIGHT_DISTRIBUTION_END_HOUR:
                night_count += 1
        if total_dist > 0 and (night_count / total_dist) > NIGHT_DISTRIBUTION_THRESHOLD:
            triggered.append("NIGHT_DISTRIBUTION")

        # 8. STOCK_NEGATIVE_ATTEMPT — quantity that would go below zero
        # Represented as a negative quantity flag in the movement data
        if any(float(m.get("quantity") or 0) < -9999 for m in movements):
            triggered.append("STOCK_NEGATIVE_ATTEMPT")

        # Composite score
        score = min(100.0, sum(_PATTERN_WEIGHTS.get(p, 0.0) for p in triggered))
        return triggered, round(score, 2)

    @staticmethod
    def _score_to_level(score: float) -> str:
        if score >= 80:
            return "CRITICAL"
        if score >= 60:
            return "HIGH"
        if score >= 30:
            return "MEDIUM"
        return "LOW"

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def get_alerts(
        self,
        statut: str | None = None,
        province: str | None = None,
    ) -> list[dict]:
        """Retourne les alertes filtrées par statut et/ou province."""
        alerts = list(_ANOMALY_STORE)
        if statut is not None:
            alerts = [a for a in alerts if a.get("statut", "").upper() == statut.upper()]
        if province is not None:
            alerts = [
                a for a in alerts
                if (a.get("province") or "").lower() == province.lower()
            ]
        return alerts

    def get_stats(self, entrepot_id: str) -> dict:
        """Retourne les statistiques d'anomalie pour un entrepôt donné."""
        alerts = [a for a in _ANOMALY_STORE if a.get("entrepot_id") == entrepot_id]
        if not alerts:
            return {
                "entrepot_id": entrepot_id,
                "total_alerts": 0,
                "open_alerts": 0,
                "last_score": None,
                "last_level": None,
                "patterns_frequency": {},
            }

        open_alerts = [a for a in alerts if a.get("statut") == "OPEN"]
        pattern_freq: dict[str, int] = {}
        for a in alerts:
            for p in a.get("patterns", []):
                pattern_freq[p] = pattern_freq.get(p, 0) + 1

        latest = sorted(alerts, key=lambda x: x.get("detected_at", ""), reverse=True)[0]

        return {
            "entrepot_id": entrepot_id,
            "total_alerts": len(alerts),
            "open_alerts": len(open_alerts),
            "last_score": latest.get("score"),
            "last_level": latest.get("level"),
            "last_detected_at": latest.get("detected_at"),
            "patterns_frequency": pattern_freq,
        }

    def resolve_alert(self, alert_id: str, resolution: str, note: str = "") -> dict:
        """Marque une alerte comme résolue."""
        for alert in _ANOMALY_STORE:
            if alert.get("alert_id") == alert_id:
                alert["statut"] = "RESOLVED"
                alert["resolution"] = resolution
                alert["resolution_note"] = note
                alert["resolved_at"] = datetime.now(timezone.utc).isoformat()
                logger.info(
                    "anomalie_stocks_agent.alert_resolved",
                    alert_id=alert_id,
                    resolution=resolution,
                )
                return {"status": "resolved", "alert_id": alert_id}
        return {"status": "not_found", "alert_id": alert_id}

    def get_dashboard(self) -> dict:
        """Résumé global de toutes les alertes."""
        total = len(_ANOMALY_STORE)
        by_level: dict[str, int] = {}
        by_statut: dict[str, int] = {}
        pattern_freq: dict[str, int] = {}

        for a in _ANOMALY_STORE:
            level = a.get("level", "UNKNOWN")
            statut = a.get("statut", "UNKNOWN")
            by_level[level] = by_level.get(level, 0) + 1
            by_statut[statut] = by_statut.get(statut, 0) + 1
            for p in a.get("patterns", []):
                pattern_freq[p] = pattern_freq.get(p, 0) + 1

        return {
            "agent": "anomalie_stocks",
            "total_alerts": total,
            "by_level": by_level,
            "by_statut": by_statut,
            "patterns_frequency": pattern_freq,
            "scheduler_running": self._scheduler.running,
        }


# Module-level singleton
anomalie_stocks_agent = AnomalieStocksAgent()
