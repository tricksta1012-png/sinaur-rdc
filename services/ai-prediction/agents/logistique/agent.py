"""
LogistiqueAgent — optimisation greedy de l'allocation des ressources
entre entrepôts et sinistres actifs.

IMPORTANT : Les recommandations sont SUGGÉRÉES UNIQUEMENT, jamais auto-appliquées.
Un opérateur humain doit accepter ou rejeter chaque recommandation via l'API.

Algorithme de scoring greedy (par paire entrepôt × sinistre) :
  urgence_sinistre        × 0.40
  taux_couverture_inverse × 0.30
  proximité_inverse       × 0.20
  disponibilité_stock     × 0.10

Cadence : toutes les heures via APScheduler.
Store en mémoire : _RECOMMENDATIONS (max 200 entrées, FIFO).
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Any

import structlog

try:
    import httpx as _httpx_lib  # optional — used for OSRM
    _HTTPX_AVAILABLE = True
except ImportError:
    _HTTPX_AVAILABLE = False

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from agents import bus
from config import settings

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# In-memory store — max 200 recommandations (FIFO)
# ---------------------------------------------------------------------------
_RECOMMENDATIONS: list[dict] = []
_MAX_REC = 200

# ---------------------------------------------------------------------------
# Poids du score composite (somme = 1.0)
# ---------------------------------------------------------------------------
_W_URGENCE = 0.40
_W_COUVERTURE = 0.30
_W_PROXIMITE = 0.20
_W_STOCK = 0.10

# Severité → score urgence normalisé
_SEVERITY_SCORE: dict[str, float] = {
    "extreme": 1.0,
    "severe": 0.75,
    "moderate": 0.50,
    "minor": 0.25,
}


# ---------------------------------------------------------------------------
# Helpers distance
# ---------------------------------------------------------------------------

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Retourne la distance orthodromique (haversine) en km entre deux points WGS-84."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return R * 2 * math.asin(math.sqrt(a))


def _get_distance_km(warehouse: dict, disaster: dict) -> float:
    """
    Retourne la distance routière (OSRM) ou, si indisponible, la distance
    haversine × 1.4 (facteur de tortuosité moyen).

    L'URL OSRM est lue depuis settings.osrm_base_url (défaut : http://localhost:5000).
    Tout échec OSRM est silencieux — fallback immédiat vers haversine.
    """
    w_lat = float(warehouse.get("lat") or 0)
    w_lng = float(warehouse.get("lng") or 0)
    d_lat = float(disaster.get("lat") or 0)
    d_lng = float(disaster.get("lng") or 0)

    if _HTTPX_AVAILABLE:
        try:
            osrm_base = getattr(settings, "osrm_base_url", "http://localhost:5000")
            url = (
                f"{osrm_base}/route/v1/driving/"
                f"{w_lng},{w_lat};{d_lng},{d_lat}"
                "?overview=false"
            )
            import httpx
            with httpx.Client(timeout=3.0) as client:
                resp = client.get(url)
            if resp.status_code == 200:
                body = resp.json()
                routes = body.get("routes") or []
                if routes:
                    distance_m = float(routes[0].get("distance", 0))
                    return distance_m / 1000.0
        except Exception:
            # Fallback silencieux
            pass

    return _haversine_km(w_lat, w_lng, d_lat, d_lng) * 1.4


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class LogistiqueAgent:
    """
    Optimise l'allocation greedy des ressources toutes les heures.
    Les recommandations ne sont jamais auto-appliquées.
    """

    def __init__(self) -> None:
        self._scheduler = AsyncIOScheduler(timezone="UTC")

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Lance l'optimisation toutes les heures."""
        self._scheduler.add_job(
            self.run_optimization,
            "interval",
            hours=1,
            id="logistique_optimization",
            name="Logistique:optimization",
            misfire_grace_time=300,
            coalesce=True,
        )
        self._scheduler.start()
        logger.info("logistique_agent.started", interval_hours=1)

    async def stop(self) -> None:
        """Arrête le scheduler proprement."""
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
        logger.info("logistique_agent.stopped")

    # ------------------------------------------------------------------
    # Optimisation principale
    # ------------------------------------------------------------------

    async def run_optimization(self) -> list[dict]:
        """
        Charge les sinistres actifs et les entrepôts disponibles depuis la DB,
        applique l'algorithme greedy et génère des recommandations.

        Retourne la liste des recommandations créées lors de ce cycle.
        Les tables inexistantes sont ignorées silencieusement (log warning).
        """
        logger.info("logistique_agent.run_optimization.start")

        disasters: list[dict] = []
        warehouses: list[dict] = []

        try:
            from db import engine
            from sqlalchemy import text

            async with engine.connect() as conn:
                # Sinistres actifs avec demande non couverte
                result = await conn.execute(text("""
                    SELECT e.id, e.location_pcode, e.hazard_type, e.severity,
                           ST_X(e.location_point) AS lng, ST_Y(e.location_point) AS lat,
                           e.estimated_affected
                    FROM disaster_events e
                    WHERE e.status = 'active' AND e.deleted_at IS NULL
                    LIMIT 50
                """))
                disasters = [dict(row._mapping) for row in result]
                logger.info("logistique_agent.disasters_loaded", count=len(disasters))

                # Entrepôts avec stock disponible
                result2 = await conn.execute(text("""
                    SELECT w.id, w.name, w.province_pcode,
                           ST_X(w.location_point) AS lng, ST_Y(w.location_point) AS lat,
                           w.capacity_units, w.available_units
                    FROM warehouses w
                    WHERE w.available_units > 0
                    LIMIT 100
                """))
                warehouses = [dict(row._mapping) for row in result2]
                logger.info("logistique_agent.warehouses_loaded", count=len(warehouses))

        except Exception as db_exc:
            err = str(db_exc)
            # Tables inexistantes → warning non bloquant
            if "does not exist" in err or "relation" in err.lower():
                logger.warning(
                    "logistique_agent.db_tables_missing",
                    error=err,
                )
            else:
                logger.warning(
                    "logistique_agent.db_unavailable",
                    error=err,
                )
            return []

        if not disasters or not warehouses:
            logger.info(
                "logistique_agent.nothing_to_optimize",
                disasters=len(disasters),
                warehouses=len(warehouses),
            )
            return []

        new_recommendations = self._greedy_optimize(disasters, warehouses)

        # Stocker dans le registre mémoire (FIFO max 200)
        global _RECOMMENDATIONS
        _RECOMMENDATIONS.extend(new_recommendations)
        if len(_RECOMMENDATIONS) > _MAX_REC:
            _RECOMMENDATIONS = _RECOMMENDATIONS[-_MAX_REC:]

        logger.info(
            "logistique_agent.run_optimization.done",
            new_recommendations=len(new_recommendations),
            total_in_store=len(_RECOMMENDATIONS),
        )

        # Publier sur le bus pour les recommandations urgentes
        urgent = [r for r in new_recommendations if r.get("priority") == "urgent"]
        if urgent:
            await bus.publish(
                "prediction.critical",
                {
                    "recommendations_count": len(urgent),
                    "priority": "urgent",
                },
            )
            logger.info(
                "logistique_agent.urgent_published",
                count=len(urgent),
            )

        return new_recommendations

    # ------------------------------------------------------------------
    # Algorithme greedy
    # ------------------------------------------------------------------

    def _greedy_optimize(
        self,
        disasters: list[dict],
        warehouses: list[dict],
    ) -> list[dict]:
        """
        Algorithme greedy :
        1. Construire toutes les paires (entrepôt, sinistre).
        2. Scorer chaque paire.
        3. Affecter en priorité les meilleures paires (highest score first),
           en décrémentant le stock disponible à chaque affectation.
        4. Retourner la liste des recommandations.
        """
        # État mutable du stock disponible par entrepôt (copie de travail)
        stock: dict[str, float] = {
            str(w["id"]): float(w.get("available_units") or 0)
            for w in warehouses
        }

        # Demande non couverte par sinistre (proxy : estimated_affected)
        demand: dict[str, float] = {
            str(d["id"]): float(d.get("estimated_affected") or 1)
            for d in disasters
        }

        # Index rapide
        w_index = {str(w["id"]): w for w in warehouses}
        d_index = {str(d["id"]): d for d in disasters}

        # Normalisation distances pour le score de proximité
        distances: dict[tuple[str, str], float] = {}
        for d in disasters:
            for w in warehouses:
                distances[(str(w["id"]), str(d["id"]))] = _get_distance_km(w, d)

        max_distance = max(distances.values()) if distances else 1.0
        if max_distance == 0:
            max_distance = 1.0

        # Construire et scorer toutes les paires
        pairs: list[tuple[float, str, str]] = []
        for d in disasters:
            d_id = str(d["id"])
            for w in warehouses:
                w_id = str(w["id"])
                score = self._score_pair(
                    warehouse=w,
                    disaster=d,
                    distance_km=distances[(w_id, d_id)],
                    max_distance=max_distance,
                )
                pairs.append((score, w_id, d_id))

        # Trier par score décroissant
        pairs.sort(key=lambda x: x[0], reverse=True)

        recommendations: list[dict] = []

        for score, w_id, d_id in pairs:
            available = stock.get(w_id, 0)
            remaining_demand = demand.get(d_id, 0)

            if available <= 0 or remaining_demand <= 0:
                continue

            # Quantité suggérée = min(stock dispo, demande restante)
            qty = min(available, remaining_demand)

            w = w_index[w_id]
            d = d_index[d_id]

            severity = str(d.get("severity") or "").lower()
            priority = "urgent" if severity in ("extreme", "severe") else "normal"

            rec: dict[str, Any] = {
                "rec_id": str(uuid.uuid4()),
                "status": "PENDING",
                "warehouse_id": w_id,
                "warehouse_name": w.get("name") or w_id,
                "warehouse_lng": float(w.get("lng") or 0),
                "warehouse_lat": float(w.get("lat") or 0),
                "disaster_id": d_id,
                "disaster_hazard_type": d.get("hazard_type"),
                "disaster_severity": d.get("severity"),
                "disaster_lng": float(d.get("lng") or 0),
                "disaster_lat": float(d.get("lat") or 0),
                "disaster_pcode": d.get("location_pcode"),
                "suggested_quantity": round(qty, 2),
                "score": round(score, 4),
                "priority": priority,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "accepted_by": None,
                "rejected_by": None,
                "rejection_reason": None,
                "decided_at": None,
            }
            recommendations.append(rec)

            # Décrémenter stock et demande
            stock[w_id] = available - qty
            demand[d_id] = remaining_demand - qty

        return recommendations

    def _score_pair(
        self,
        warehouse: dict,
        disaster: dict,
        distance_km: float,
        max_distance: float,
    ) -> float:
        """
        Score composite normalisé [0, 1] pour une paire (entrepôt, sinistre).

        score = urgence × 0.40
              + couverture_inverse × 0.30
              + proximité_normalisée × 0.20
              + disponibilité_stock_normalisée × 0.10
        """
        # Urgence sinistre
        severity = str(disaster.get("severity") or "").lower()
        urgence = _SEVERITY_SCORE.get(severity, 0.25)

        # Taux de couverture inverse
        # (plus la demande non couverte est grande, plus la priorité est haute)
        affected = float(disaster.get("estimated_affected") or 1)
        capacity = float(warehouse.get("capacity_units") or 1)
        couverture = min(1.0, affected / max(capacity, 1.0))

        # Proximité (1 = très proche, 0 = très loin)
        proximite = 1.0 - min(1.0, distance_km / max_distance)

        # Disponibilité stock normalisée
        available = float(warehouse.get("available_units") or 0)
        cap = float(warehouse.get("capacity_units") or 1)
        dispo = min(1.0, available / max(cap, 1.0))

        return (
            _W_URGENCE * urgence
            + _W_COUVERTURE * couverture
            + _W_PROXIMITE * proximite
            + _W_STOCK * dispo
        )

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def get_recommendations(self, status: str | None = None) -> list[dict]:
        """
        Retourne les recommandations en mémoire.
        Si status est fourni, filtre sur rec["status"] (PENDING, ACCEPTED, REJECTED).
        """
        recs = list(_RECOMMENDATIONS)
        if status is not None:
            recs = [r for r in recs if r.get("status", "").upper() == status.upper()]
        return recs

    def accept_recommendation(self, rec_id: str, accepted_by: str) -> dict | None:
        """
        Marque une recommandation comme ACCEPTED.
        Retourne le dict mis à jour, ou None si introuvable.
        La recommandation n'est pas appliquée automatiquement.
        """
        for rec in _RECOMMENDATIONS:
            if rec.get("rec_id") == rec_id:
                rec["status"] = "ACCEPTED"
                rec["accepted_by"] = accepted_by
                rec["decided_at"] = datetime.now(timezone.utc).isoformat()
                logger.info(
                    "logistique_agent.recommendation_accepted",
                    rec_id=rec_id,
                    accepted_by=accepted_by,
                )
                return rec
        return None

    def reject_recommendation(
        self, rec_id: str, rejected_by: str, reason: str
    ) -> dict | None:
        """
        Marque une recommandation comme REJECTED.
        Retourne le dict mis à jour, ou None si introuvable.
        """
        for rec in _RECOMMENDATIONS:
            if rec.get("rec_id") == rec_id:
                rec["status"] = "REJECTED"
                rec["rejected_by"] = rejected_by
                rec["rejection_reason"] = reason
                rec["decided_at"] = datetime.now(timezone.utc).isoformat()
                logger.info(
                    "logistique_agent.recommendation_rejected",
                    rec_id=rec_id,
                    rejected_by=rejected_by,
                    reason=reason,
                )
                return rec
        return None

    def get_routes_geojson(self) -> dict:
        """
        Construit un GeoJSON FeatureCollection des lignes entrepôt → sinistre
        pour toutes les recommandations au statut PENDING.

        Chaque Feature contient les propriétés : rec_id, warehouse_id,
        disaster_id, score, priority, suggested_quantity.
        """
        pending = [r for r in _RECOMMENDATIONS if r.get("status") == "PENDING"]
        features = []
        for rec in pending:
            w_lng = rec.get("warehouse_lng")
            w_lat = rec.get("warehouse_lat")
            d_lng = rec.get("disaster_lng")
            d_lat = rec.get("disaster_lat")

            # Ignorer les entrées sans coordonnées valides
            if not all(isinstance(v, (int, float)) and v != 0
                       for v in [w_lng, w_lat, d_lng, d_lat]):
                continue

            features.append({
                "type": "Feature",
                "properties": {
                    "rec_id": rec.get("rec_id"),
                    "warehouse_id": rec.get("warehouse_id"),
                    "warehouse_name": rec.get("warehouse_name"),
                    "disaster_id": rec.get("disaster_id"),
                    "score": rec.get("score"),
                    "priority": rec.get("priority"),
                    "suggested_quantity": rec.get("suggested_quantity"),
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [w_lng, w_lat],
                        [d_lng, d_lat],
                    ],
                },
            })

        return {
            "type": "FeatureCollection",
            "features": features,
        }


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------
logistique_agent = LogistiqueAgent()
