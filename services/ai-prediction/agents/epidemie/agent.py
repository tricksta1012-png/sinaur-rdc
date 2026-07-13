"""
EpidemieAgent — surveillance épidémique avec clustering DBSCAN-like.

Surveille 5 maladies : choléra, mpox, rougeole, méningite, Ebola.
Cadence : toutes les 30 minutes.

POLITIQUE DE VALIDATION:
  Toutes les alertes nécessitent une validation humaine SAUF Ebola.
  EXCEPTION DOCUMENTÉE: Ebola — alerte sans validation humaine requise.
  Justification : risque vital, protocole OMS, temps de réaction critique < 2h.
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from agents import bus

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Disease profiles
# ---------------------------------------------------------------------------

DISEASE_PROFILES: dict[str, dict[str, Any]] = {
    "cholera": {
        "keywords_fr": ["choléra", "diarrhée aqueuse", "vomissements", "déshydratation"],
        "keywords_sw": ["homa ya tumbo", "kuhara", "kutapika"],
        "keywords_ln": ["boloko ya mai", "vomissement"],
        "incubation_days": (1, 5),
        "cluster_radius_km": 5.0,
        "cluster_min_cases": 3,
        "temporal_window_days": 7,
        "endemic_provinces": ["CD-KA", "CD-KW", "CD-MN", "CD-HK", "CD-SK"],
        "peak_months": [3, 4, 10, 11],  # saison des pluies
        "r0_typical": 2.5,
    },
    "mpox": {
        "keywords_fr": ["mpox", "variole du singe", "éruption cutanée", "pustules"],
        "keywords_sw": ["ndui ya tumbili", "upele"],
        "keywords_ln": ["maladi ya nkɔkɔ"],
        "incubation_days": (5, 21),
        "cluster_radius_km": 15.0,
        "cluster_min_cases": 2,
        "temporal_window_days": 21,
        "endemic_provinces": ["CD-EQ", "CD-NK", "CD-SK", "CD-IT"],
        "peak_months": [1, 2, 3, 10, 11, 12],
        "r0_typical": 1.3,
    },
    "rougeole": {
        "keywords_fr": ["rougeole", "éruption rouge", "fièvre éruption"],
        "keywords_sw": ["surua"],
        "keywords_ln": ["bokɔlɔ"],
        "incubation_days": (10, 14),
        "cluster_radius_km": 20.0,
        "cluster_min_cases": 5,
        "temporal_window_days": 21,
        "endemic_provinces": ["CD-KN", "CD-KL", "CD-LM", "CD-HL"],
        "peak_months": [1, 2, 3, 7, 8],
        "r0_typical": 15.0,
    },
    "meningite": {
        "keywords_fr": ["méningite", "raideur nuque", "céphalée sévère", "photophobie"],
        "keywords_sw": ["ugonjwa wa ubongo"],
        "keywords_ln": ["bokɔlɔ ya moto"],
        "incubation_days": (2, 10),
        "cluster_radius_km": 10.0,
        "cluster_min_cases": 3,
        "temporal_window_days": 14,
        "endemic_provinces": ["CD-KA", "CD-HK", "CD-IT"],
        "peak_months": [12, 1, 2, 3],
        "r0_typical": 1.8,
    },
    "ebola": {
        "keywords_fr": ["ebola", "hémorragie", "saignements", "fièvre hémorragique"],
        "keywords_sw": ["ugonjwa wa ebola", "kutoka damu"],
        "keywords_ln": ["ebola"],
        "incubation_days": (2, 21),
        "cluster_radius_km": 5.0,
        "cluster_min_cases": 1,  # 1 cas = CRITIQUE
        "temporal_window_days": 21,
        "endemic_provinces": ["CD-NK", "CD-EQ", "CD-IT"],
        "peak_months": list(range(1, 13)),  # toute l'année
        "r0_typical": 1.9,
    },
    "fievre_jaune": {
        "keywords_fr": ["fièvre jaune", "ictère", "hépatite virale fièvre"],
        "keywords_sw": ["homa ya manjano"],
        "keywords_ln": ["fièvre jaune"],
        "incubation_days": (3, 6),
        "cluster_radius_km": 20.0,
        "cluster_min_cases": 2,
        "temporal_window_days": 14,
        "endemic_provinces": ["CD-EQ", "CD-NK", "CD-IT", "CD-MN"],
        "peak_months": [3, 4, 5, 10, 11],  # saison des pluies
        "r0_typical": 2.5,
    },
    "paludisme": {
        "keywords_fr": ["paludisme", "malaria", "plasmodium", "fièvre palustres"],
        "keywords_sw": ["malaria", "homa ya mbu"],
        "keywords_ln": ["fivre ya mbu"],
        "incubation_days": (7, 30),
        "cluster_radius_km": 30.0,
        "cluster_min_cases": 20,   # seuil haut — endémique, cherche les pics
        "temporal_window_days": 30,
        "endemic_provinces": list(range(1, 27)),  # toutes les 26 provinces
        "peak_months": [3, 4, 5, 11, 12],
        "r0_typical": 100.0,  # très élevé en contexte endémique
    },
}

# ---------------------------------------------------------------------------
# In-memory stores
# ---------------------------------------------------------------------------

_CLUSTER_STORE: list[dict] = []
_ALERT_STORE: list[dict] = []

# ---------------------------------------------------------------------------
# Signalement store — populated by the signalements agent (Agent 8) via bus,
# or directly by this agent when the signalements module is available.
#
# Schema attendu de chaque signalement :
#   {
#     "id": str,
#     "lat": float,
#     "lng": float,
#     "province": str,          # P-code ex. "CD-NK"
#     "description": str,       # texte libre
#     "symptoms": list[str],    # liste de symptômes normalisés
#     "created_at": str,        # ISO 8601
#     "source": str,            # "app" | "sms" | "veille"
#   }
# ---------------------------------------------------------------------------

_SIGNALEMENT_STORE: list[dict] = []


def ingest_signalement(signal: dict) -> None:
    """
    Ajoute un signalement au store local de l'agent épidémie.
    Appelé par le handler Redis (topic signalements.new) ou directement.
    """
    _SIGNALEMENT_STORE.append(signal)


# ---------------------------------------------------------------------------
# Haversine helper
# ---------------------------------------------------------------------------

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Retourne la distance orthodromique en km (WGS-84)."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.asin(math.sqrt(max(0.0, min(1.0, a))))


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class EpidemieAgent:
    """
    Surveillance épidémique par clustering géo-temporel (DBSCAN-like).
    Cadence : 30 minutes.
    """

    def __init__(self) -> None:
        self._scheduler = AsyncIOScheduler(timezone="UTC")

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Lance la surveillance toutes les 30 minutes."""
        self._scheduler.add_job(
            self.run_surveillance,
            "interval",
            minutes=30,
            id="epidemie_surveillance",
            name="Epidemie:surveillance",
            misfire_grace_time=300,
            coalesce=True,
        )
        self._scheduler.start()

        # Subscribe to signalements.new topic on the bus
        import asyncio
        asyncio.get_event_loop().create_task(
            bus.subscribe("signalements.new", self._handle_signalement_event)
        )

        logger.info("epidemie_agent.started", interval_minutes=30)

    async def stop(self) -> None:
        """Arrête le scheduler proprement."""
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
        logger.info("epidemie_agent.stopped")

    # ------------------------------------------------------------------
    # Bus handler
    # ------------------------------------------------------------------

    async def _handle_signalement_event(self, payload: dict) -> None:
        """Reçoit un nouveau signalement via le bus et le stocke localement."""
        try:
            ingest_signalement(payload)
            logger.debug("epidemie_agent.signalement_ingested", signal_id=payload.get("id"))
        except Exception as exc:
            logger.error("epidemie_agent.signalement_ingest_error", error=str(exc))

    # ------------------------------------------------------------------
    # Core surveillance
    # ------------------------------------------------------------------

    async def run_surveillance(self) -> None:
        """
        Lit les signalements récents depuis _SIGNALEMENT_STORE,
        détecte les clusters par maladie, calcule les scores et crée des alertes.
        """
        logger.info("epidemie_agent.run_surveillance.start")

        now = datetime.now(timezone.utc)

        for disease_id, profile in DISEASE_PROFILES.items():
            try:
                window_days: int = profile["temporal_window_days"]
                cutoff = now - timedelta(days=window_days)

                # Filter signalements relevant to this disease within temporal window
                relevant: list[dict] = []
                keywords_all: list[str] = (
                    profile.get("keywords_fr", [])
                    + profile.get("keywords_sw", [])
                    + profile.get("keywords_ln", [])
                )
                keywords_lower = [k.lower() for k in keywords_all]

                for sig in _SIGNALEMENT_STORE:
                    ts = sig.get("created_at")
                    if ts is None:
                        continue
                    if isinstance(ts, str):
                        try:
                            ts_dt = datetime.fromisoformat(ts)
                        except ValueError:
                            continue
                    else:
                        ts_dt = ts

                    if ts_dt.tzinfo is None:
                        ts_dt = ts_dt.replace(tzinfo=timezone.utc)

                    if ts_dt < cutoff:
                        continue

                    # Keyword match against description + symptoms
                    text_blob = " ".join([
                        (sig.get("description") or ""),
                        " ".join(sig.get("symptoms") or []),
                    ]).lower()

                    if any(kw in text_blob for kw in keywords_lower):
                        relevant.append(sig)

                if not relevant:
                    continue

                clusters = self._detect_clusters(relevant, disease_id, profile)

                for cluster in clusters:
                    score = self._compute_alert_score(cluster, profile, now)
                    cluster["score"] = score
                    cluster["alert_level"] = self._score_to_level(score, disease_id)

                    # Deduplicate: don't re-add identical cluster (same disease + centroid)
                    is_new = not any(
                        c.get("disease_id") == disease_id
                        and abs(c.get("centroid_lat", 999) - cluster["centroid_lat"]) < 0.01
                        and abs(c.get("centroid_lng", 999) - cluster["centroid_lng"]) < 0.01
                        for c in _CLUSTER_STORE
                    )
                    if is_new:
                        _CLUSTER_STORE.append(cluster)
                        logger.info(
                            "epidemie_agent.cluster_detected",
                            disease=disease_id,
                            size=cluster["size"],
                            score=score,
                            level=cluster["alert_level"],
                        )

                    if cluster["alert_level"] in ("HIGH", "CRITICAL"):
                        await self._create_alert(cluster, disease_id, profile)

            except Exception as exc:
                logger.error(
                    "epidemie_agent.disease_surveillance_error",
                    disease=disease_id,
                    error=str(exc),
                )

        logger.info(
            "epidemie_agent.run_surveillance.done",
            total_clusters=len(_CLUSTER_STORE),
            total_alerts=len(_ALERT_STORE),
        )

    # ------------------------------------------------------------------
    # Clustering (DBSCAN-like, single-pass greedy)
    # ------------------------------------------------------------------

    def _detect_clusters(
        self,
        signals: list[dict],
        disease_id: str,
        profile: dict[str, Any],
    ) -> list[dict]:
        """
        Détecte les clusters géo-spatiaux parmi les signalements filtrés.

        Algorithme : DBSCAN simplifié, greedy, O(n²).
        - radius  = profile["cluster_radius_km"]
        - min_pts = profile["cluster_min_cases"]
        """
        radius_km: float = profile["cluster_radius_km"]
        min_cases: int = profile["cluster_min_cases"]

        # Extract valid geo-points
        pts: list[dict] = []
        for sig in signals:
            try:
                lat = float(sig.get("lat") or 0)
                lng = float(sig.get("lng") or 0)
                if lat == 0 and lng == 0:
                    continue
                pts.append({**sig, "_lat": lat, "_lng": lng})
            except (TypeError, ValueError):
                continue

        if not pts:
            return []

        visited: set[int] = set()
        clusters: list[dict] = []

        for i, pt in enumerate(pts):
            if i in visited:
                continue
            # Find all neighbours within radius
            neighbours: list[int] = []
            for j, other in enumerate(pts):
                if j == i:
                    continue
                d = _haversine_km(pt["_lat"], pt["_lng"], other["_lat"], other["_lng"])
                if d <= radius_km:
                    neighbours.append(j)

            cluster_size = 1 + len(neighbours)
            if cluster_size < min_cases:
                continue

            # Mark all points in this cluster as visited
            visited.add(i)
            visited.update(neighbours)

            member_indices = [i] + neighbours
            members = [pts[idx] for idx in member_indices]

            # Centroid
            centroid_lat = sum(m["_lat"] for m in members) / len(members)
            centroid_lng = sum(m["_lng"] for m in members) / len(members)

            # Province (majority vote)
            province_votes: dict[str, int] = {}
            for m in members:
                p = str(m.get("province") or "")
                if p:
                    province_votes[p] = province_votes.get(p, 0) + 1
            province = max(province_votes, key=province_votes.get) if province_votes else None

            # Date range
            dates = []
            for m in members:
                ts = m.get("created_at")
                if ts and isinstance(ts, str):
                    try:
                        dates.append(datetime.fromisoformat(ts))
                    except ValueError:
                        pass
            first_case_at = min(dates).isoformat() if dates else None
            last_case_at = max(dates).isoformat() if dates else None

            cluster: dict[str, Any] = {
                "cluster_id": str(uuid.uuid4()),
                "disease_id": disease_id,
                "size": len(members),
                "centroid_lat": round(centroid_lat, 5),
                "centroid_lng": round(centroid_lng, 5),
                "radius_km": radius_km,
                "province": province,
                "first_case_at": first_case_at,
                "last_case_at": last_case_at,
                "detected_at": datetime.now(timezone.utc).isoformat(),
                "signal_ids": [m.get("id") for m in members if m.get("id")],
                "score": 0.0,
                "alert_level": "LOW",
            }
            clusters.append(cluster)

        return clusters

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------

    def _compute_alert_score(
        self,
        cluster: dict[str, Any],
        profile: dict[str, Any],
        now: datetime,
    ) -> float:
        """
        Score = base_size_score × saisonnalité × endémicité × vitesse.
        Retourne un float 0–100.
        """
        # Base: proportion of cluster size vs min_cases threshold (capped at 5×)
        min_cases: int = profile["cluster_min_cases"]
        size: int = cluster.get("size", 1)
        base_score = min(100.0, (size / max(min_cases, 1)) * 20.0)

        # Seasonality factor
        peak_months: list[int] = profile.get("peak_months", [])
        seasonal_factor = 1.4 if now.month in peak_months else 1.0

        # Endemicity factor
        endemic_provinces: list[str] = profile.get("endemic_provinces", [])
        province: str | None = cluster.get("province")
        endemic_factor = 1.3 if province and province in endemic_provinces else 1.0

        # Velocity factor: cases over time span
        velocity_factor = 1.0
        first_str = cluster.get("first_case_at")
        last_str = cluster.get("last_case_at")
        if first_str and last_str:
            try:
                first_dt = datetime.fromisoformat(first_str)
                last_dt = datetime.fromisoformat(last_str)
                span_hours = max(1.0, (last_dt - first_dt).total_seconds() / 3600)
                cases_per_hour = size / span_hours
                velocity_factor = min(2.0, 1.0 + cases_per_hour / 10.0)
            except (ValueError, TypeError):
                pass

        raw_score = base_score * seasonal_factor * endemic_factor * velocity_factor
        return round(min(100.0, raw_score), 2)

    @staticmethod
    def _score_to_level(score: float, disease_id: str) -> str:
        """
        Convertit le score en niveau d'alerte.
        Pour Ebola, tout cluster = CRITICAL (même 1 cas).
        """
        if disease_id == "ebola":
            # EXCEPTION DOCUMENTÉE: Ebola — alerte sans validation humaine requise.
            # Justification : risque vital, protocole OMS, temps de réaction critique < 2h.
            return "CRITICAL"
        if score >= 80:
            return "CRITICAL"
        if score >= 60:
            return "HIGH"
        if score >= 30:
            return "MEDIUM"
        return "LOW"

    # ------------------------------------------------------------------
    # Alert creation
    # ------------------------------------------------------------------

    async def _create_alert(
        self,
        cluster: dict[str, Any],
        disease_id: str,
        profile: dict[str, Any],
    ) -> None:
        """Crée une alerte CAP Health et la stocke; publie sur le bus."""
        is_ebola = disease_id == "ebola"

        # EXCEPTION DOCUMENTÉE: Ebola — alerte sans validation humaine requise.
        # Justification : risque vital, protocole OMS, temps de réaction critique < 2h.
        validation_required = not is_ebola

        alert: dict[str, Any] = {
            "alert_id": str(uuid.uuid4()),
            "disease_id": disease_id,
            "cluster_id": cluster["cluster_id"],
            "alert_level": cluster["alert_level"],
            "score": cluster["score"],
            "size": cluster["size"],
            "province": cluster["province"],
            "centroid_lat": cluster["centroid_lat"],
            "centroid_lng": cluster["centroid_lng"],
            "first_case_at": cluster["first_case_at"],
            "last_case_at": cluster["last_case_at"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "validation_required": validation_required,
            "validated": not validation_required,
            "cap_status": "ACTUAL",
            "cap_msg_type": "ALERT",
            "cap_category": "Health",
            "r0_typical": profile.get("r0_typical"),
        }

        _ALERT_STORE.append(alert)

        logger.info(
            "epidemie_agent.alert_created",
            disease=disease_id,
            alert_id=alert["alert_id"],
            level=cluster["alert_level"],
            validation_required=validation_required,
        )

        # Propager vers evenement_flux (flux commun — bandeau alerte + carte)
        try:
            await self._propagate_to_flux(alert, disease_id)
        except Exception as exc:
            logger.warning("epidemie_agent.flux_propagation_failed", error=str(exc))

        # Publish to bus
        await bus.publish("epidemie.alert", {
            "alert_id": alert["alert_id"],
            "disease_id": disease_id,
            "level": cluster["alert_level"],
            "province": cluster["province"],
            "validation_required": validation_required,
        })

        # For Ebola also send CAP alert immediately
        if is_ebola:
            await bus.publish("cap.alert", {
                "source": "epidemie_agent",
                "disease": "ebola",
                "alert_id": alert["alert_id"],
                "level": "CRITICAL",
                "auto_validated": True,
                "reason": "Protocole OMS: alerte Ebola sans validation humaine < 2h",
            })

    # ── Flux commun ────────────────────────────────────────────────────────────

    async def _propagate_to_flux(self, alert: dict, disease_id: str) -> None:
        """Écrit l'alerte épidémique dans evenement_flux."""
        from db import engine
        from sqlalchemy import text
        from flux.gravite import calculer_score, score_to_gravite

        ampleur   = int(alert.get("size", 1))
        raw_score = float(alert.get("score", 0.5))
        fiabilite = min(1.0, raw_score / 100.0)
        score     = calculer_score("EPIDEMIE", ampleur, fiabilite)
        gravite   = score_to_gravite(score)
        impacte   = alert.get("alert_level") in ("HIGH", "CRITICAL")
        statut    = "PROBABLE" if impacte else "A_CORROBORER"

        province  = alert.get("province") or "RDC"
        titre     = f"{disease_id.upper()} — {province} ({ampleur} cas)"
        ext_id    = f"epidemie:{alert['alert_id']}"

        async with engine.connect() as conn:
            async with conn.begin():
                await conn.execute(text("""
                    INSERT INTO evenement_flux (
                        source_agent, type_evenement, titre,
                        lat, lon,
                        fiabilite, statut_verification,
                        gravite, gravite_score, ampleur, impacte_statut,
                        source_externe_id, date_evenement
                    ) VALUES (
                        'EPIDEMIE', 'EPIDEMIE', :titre,
                        :lat, :lon,
                        :fiab, :statut,
                        :gravite, :score, :ampleur, :impacte,
                        :ext_id, NOW()
                    )
                    ON CONFLICT (source_agent, source_externe_id)
                    WHERE source_externe_id IS NOT NULL
                    DO UPDATE SET
                        gravite        = EXCLUDED.gravite,
                        gravite_score  = EXCLUDED.gravite_score,
                        ampleur        = EXCLUDED.ampleur,
                        impacte_statut = EXCLUDED.impacte_statut,
                        maj_le         = NOW()
                """), {
                    "titre":   titre,
                    "lat":     alert.get("centroid_lat"),
                    "lon":     alert.get("centroid_lng"),
                    "fiab":    round(fiabilite, 2),
                    "statut":  statut,
                    "gravite": gravite,
                    "score":   score,
                    "ampleur": ampleur,
                    "impacte": impacte,
                    "ext_id":  ext_id,
                })

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def get_clusters(self) -> list[dict]:
        """Retourne tous les clusters actifs."""
        return list(_CLUSTER_STORE)

    def get_alerts(self) -> list[dict]:
        """Retourne toutes les alertes CAP Health."""
        return list(_ALERT_STORE)

    def get_history(self, disease_id: str) -> list[dict]:
        """Retourne les clusters des 90 derniers jours pour une maladie donnée."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=90)
        result: list[dict] = []
        for c in _CLUSTER_STORE:
            if c.get("disease_id") != disease_id:
                continue
            ts_str = c.get("detected_at")
            if ts_str:
                try:
                    ts = datetime.fromisoformat(ts_str)
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    if ts >= cutoff:
                        result.append(c)
                except ValueError:
                    result.append(c)
            else:
                result.append(c)
        return result

    def get_dashboard(self) -> dict:
        """Résumé global de la surveillance épidémique."""
        by_disease: dict[str, dict] = {}
        for disease_id in DISEASE_PROFILES:
            clusters = [c for c in _CLUSTER_STORE if c.get("disease_id") == disease_id]
            alerts = [a for a in _ALERT_STORE if a.get("disease_id") == disease_id]
            by_disease[disease_id] = {
                "cluster_count": len(clusters),
                "alert_count": len(alerts),
                "critical_alerts": sum(
                    1 for a in alerts if a.get("alert_level") == "CRITICAL"
                ),
            }

        return {
            "agent": "epidemie",
            "scheduler_running": self._scheduler.running,
            "total_clusters": len(_CLUSTER_STORE),
            "total_alerts": len(_ALERT_STORE),
            "signalement_store_size": len(_SIGNALEMENT_STORE),
            "by_disease": by_disease,
            "diseases_monitored": list(DISEASE_PROFILES.keys()),
        }


# Module-level singleton
epidemie_agent = EpidemieAgent()
