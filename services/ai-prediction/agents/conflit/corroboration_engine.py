"""
CorroborationEngine — Croisement multi-sources des événements de conflit.

Principe : regrouper les événements qui décrivent le MÊME incident
(même province + même fenêtre temporelle + même type), puis calculer
un score de confiance combiné et consolider les données des sources.

Score de confiance final :
  base_score          = meilleure fiabilité source du cluster
  +corroboration_bonus = f(nombre de sources distinctes)
  +academic_concordance= ACLED + UCDP concordent (+0.10)
  +institutional_bonus = source ONU confirme (+0.10)
  +kst_bonus           = KST confirme pour Est RDC (+0.08)
  -contradiction       = divergence de chiffres victimes (-0.05 par tranche)

Clustering géospatial : si deux événements ont des coordonnées à ≤ 15 km l'un
de l'autre ET sont dans la même fenêtre temporelle, ils sont regroupés même s'ils
sont dans des territoires différents (geopy requis, fallback sans si absent).
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

try:
    from geopy.distance import geodesic as _geodesic
    _GEOPY_AVAILABLE = True
except ImportError:
    _GEOPY_AVAILABLE = False
    logger.warning("corroboration_engine.geopy_unavailable", hint="pip install geopy==2.4.1")

# ── Constantes ───────────────────────────────────────────────────────────────

_CORROBORATION_BONUS: dict[int, float] = {1: 0.0, 2: 0.12, 3: 0.20, 4: 0.26}

_INSTITUTIONAL_SOURCES = frozenset({"ocha_drc", "ocha_hdx", "unhcr", "iom_dtm", "monusco", "ohchr", "reliefweb"})

_ACADEMIC_SOURCES = frozenset({"acled", "ucdp_ged"})

# Fenêtre temporelle : deux événements dans la même province + 48h = même incident
_CLUSTER_WINDOW_HOURS = 48

# Rayon géospatial (km) en-deça duquel deux événements avec coordonnées sont
# considérés comme le même incident (même province + même type + même fenêtre 48h)
_GEO_CLUSTER_RADIUS_KM = 15.0


# ── Modèle de données ─────────────────────────────────────────────────────────

class CorroboratedEvent:
    """Un événement enrichi avec les métadonnées de corroboration."""

    __slots__ = (
        "event_dict",
        "confidence_score",
        "sources_count",
        "sources_list",
        "corroboration_detail",
        "contradictions",
        "needs_corroboration",
    )

    def __init__(
        self,
        event_dict: dict,
        confidence_score: float,
        sources_count: int,
        sources_list: list[str],
        corroboration_detail: str,
        contradictions: list[str],
        needs_corroboration: bool,
    ) -> None:
        self.event_dict          = event_dict
        self.confidence_score    = confidence_score
        self.sources_count       = sources_count
        self.sources_list        = sources_list
        self.corroboration_detail= corroboration_detail
        self.contradictions      = contradictions
        self.needs_corroboration = needs_corroboration

    def to_dict(self) -> dict:
        d = dict(self.event_dict)
        d["sources_count"]        = self.sources_count
        d["sources_list"]         = self.sources_list
        d["corroboration_score"]  = round(self.confidence_score, 3)
        d["corroboration_detail"] = self.corroboration_detail
        d["contradictions"]       = self.contradictions
        d["needs_corroboration"]  = self.needs_corroboration
        return d


# ── Moteur principal ──────────────────────────────────────────────────────────

class CorroborationEngine:

    def corroborate(self, events: list[dict]) -> list[dict]:
        """
        Entrée  : liste de dicts événements (depuis ConflitAgent._EVENT_STORE)
        Sortie  : même liste enrichie avec les métadonnées de corroboration
        """
        clusters = self._cluster(events)
        result: list[dict] = []

        for cluster in clusters:
            corr = self._score_cluster(cluster)
            result.append(corr.to_dict())

        logger.info(
            "corroboration_engine.done",
            events_in=len(events),
            clusters=len(clusters),
            multi_source=sum(1 for c in clusters if len({e.get("source") for e in c}) > 1),
        )
        return result

    # ── Clustering ────────────────────────────────────────────────────────────

    def _cluster(self, events: list[dict]) -> list[list[dict]]:
        """
        Regroupe les événements par (province, type_normalisé, fenêtre 48h).
        """
        assigned: dict[int, int] = {}  # event_index → cluster_index
        clusters: list[list[dict]] = []

        for i, ev in enumerate(events):
            placed = False
            for ci, cluster in enumerate(clusters):
                if self._same_incident(ev, cluster[0]):
                    cluster.append(ev)
                    assigned[i] = ci
                    placed = True
                    break
            if not placed:
                clusters.append([ev])
                assigned[i] = len(clusters) - 1

        return clusters

    def _same_incident(self, a: dict, b: dict) -> bool:
        """Deux événements décrivent-ils le même incident ?"""
        # Même province (ou P-code)
        if (a.get("province") or a.get("p_code")) != (b.get("province") or b.get("p_code")):
            return False
        # Même type normalisé
        if _normalize_type(a.get("event_type", "")) != _normalize_type(b.get("event_type", "")):
            return False
        # Fenêtre temporelle ≤ 48h
        ta = _parse_dt(a.get("event_date"))
        tb = _parse_dt(b.get("event_date"))
        if abs((ta - tb).total_seconds()) > _CLUSTER_WINDOW_HOURS * 3600:
            return False
        # Vérification géospatiale : si les deux événements ont des coordonnées,
        # ils doivent être à ≤ 15 km l'un de l'autre pour former le même cluster.
        if not _within_geo_radius(a, b):
            return False
        return True

    # ── Scoring ───────────────────────────────────────────────────────────────

    def _score_cluster(self, cluster: list[dict]) -> CorroboratedEvent:
        sources = [str(e.get("source") or e.get("source_id") or "") for e in cluster]
        unique_sources = list(dict.fromkeys(sources))  # preserve order, deduplicate
        n = len(unique_sources)

        base_score = max(
            float(e.get("reliability_score") or e.get("source_reliability") or 0.5)
            for e in cluster
        )

        # Bonus nombre de sources
        corr_bonus = _CORROBORATION_BONUS.get(min(n, 4), 0.26)

        # Bonus ACLED + UCDP concordent
        src_set = set(unique_sources)
        academic_bonus = 0.10 if _ACADEMIC_SOURCES.issubset(src_set) else 0.0

        # Bonus source institutionnelle ONU
        inst_bonus = 0.10 if src_set & _INSTITUTIONAL_SOURCES else 0.0

        # Bonus KST (spécialisé Est RDC)
        kst_bonus = 0.08 if "kivu_security_tracker" in src_set else 0.0

        # Pénalité contradictions chiffres victimes
        contradiction_penalty, contradictions = self._check_contradictions(cluster)

        final = min(1.0, max(0.0,
            base_score + corr_bonus + academic_bonus + inst_bonus + kst_bonus - contradiction_penalty
        ))

        # Événement représentatif = celui de la source la plus fiable
        representative = max(
            cluster,
            key=lambda e: float(e.get("reliability_score") or e.get("source_reliability") or 0),
        )

        # Consolider les données
        consolidated = self._consolidate(cluster, representative)

        # Libellé de corroboration
        level = (
            "Maximale" if n >= 4 else
            "Élevée"   if n >= 3 else
            "Confirmée" if n >= 2 else
            "À vérifier"
        )
        detail = (
            f"Fiabilité {level} — {n} source{'s' if n > 1 else ''} : {', '.join(unique_sources)}"
            + (f" | ACLED+UCDP concordent" if academic_bonus else "")
            + (f" | Source ONU confirmée" if inst_bonus else "")
        )

        # Un événement GDELT seul reste à confirmer
        needs_corrob = (
            unique_sources == ["gdelt"] or
            (n == 1 and bool(representative.get("needs_corroboration")))
        )

        return CorroboratedEvent(
            event_dict=consolidated,
            confidence_score=final,
            sources_count=n,
            sources_list=unique_sources,
            corroboration_detail=detail,
            contradictions=contradictions,
            needs_corroboration=needs_corrob,
        )

    # ── Consolidation ─────────────────────────────────────────────────────────

    def _consolidate(self, cluster: list[dict], representative: dict) -> dict:
        """
        Consolide les données du cluster en préférant les sources les plus fiables.
        - Décès : préférer UCDP (best estimate)
        - Acteurs : préférer ACLED (plus détaillé)
        - Coordonnées : préférer KST en Est RDC, sinon ACLED
        - Date : la plus ancienne (premier signalement)
        """
        result = dict(representative)

        # Décès : UCDP si disponible
        ucdp = next((e for e in cluster if e.get("source") == "ucdp_ged"), None)
        if ucdp and ucdp.get("fatalities_reported") is not None:
            result["fatalities_reported"] = ucdp["fatalities_reported"]
            result["fatalities_low"]  = ucdp.get("fatalities_low")
            result["fatalities_high"] = ucdp.get("fatalities_high")

        # Acteurs : ACLED si disponible
        acled = next((e for e in cluster if e.get("source") == "acled"), None)
        if acled and acled.get("actor_names"):
            result["actor_names"] = acled["actor_names"]

        # Coordonnées : KST > ACLED > autre
        kst = next((e for e in cluster if e.get("source") == "kivu_security_tracker"), None)
        if kst and kst.get("coordinates"):
            result["coordinates"] = kst["coordinates"]
        elif acled and acled.get("coordinates"):
            result["coordinates"] = acled["coordinates"]

        # Date : le premier signalement
        dates = [_parse_dt(e.get("event_date")) for e in cluster]
        result["event_date"] = min(dates).isoformat()

        return result

    # ── Contradictions ────────────────────────────────────────────────────────

    def _check_contradictions(self, cluster: list[dict]) -> tuple[float, list[str]]:
        """Détecte les divergences significatives dans les chiffres de victimes."""
        fats = [
            int(e["fatalities_reported"])
            for e in cluster
            if e.get("fatalities_reported") is not None
        ]
        if len(fats) < 2:
            return 0.0, []

        mn, mx = min(fats), max(fats)
        if mx == 0:
            return 0.0, []

        ratio = (mx - mn) / max(mx, 1)
        if ratio < 0.5:
            return 0.0, []  # divergence < 50% → acceptable

        contradictions = [f"Victimes : {mn}–{mx} selon les sources (divergence {round(ratio*100)}%)"]
        penalty = 0.05 * min(3, int(ratio / 0.5))  # max -0.15
        return penalty, contradictions


# ── Helpers ───────────────────────────────────────────────────────────────────

def _within_geo_radius(a: dict, b: dict) -> bool:
    """
    Retourne True si les deux événements sont à ≤ _GEO_CLUSTER_RADIUS_KM l'un de l'autre.
    Si l'un des deux n'a pas de coordonnées, ou si geopy est absent, on ne bloque pas le clustering.
    coordinates sont stockées en [lng, lat] (format GeoJSON).
    """
    if not _GEOPY_AVAILABLE:
        return True
    ca = a.get("coordinates")
    cb = b.get("coordinates")
    if not ca or not cb:
        return True
    try:
        # geodesic prend (lat, lng)
        dist_km = _geodesic((ca[1], ca[0]), (cb[1], cb[0])).kilometers
        return dist_km <= _GEO_CLUSTER_RADIUS_KM
    except Exception:
        return True


def _normalize_type(t: str) -> str:
    t = t.lower()
    if any(k in t for k in ("conflict", "conflit", "battle", "combat", "attack", "violence")):
        return "conflict"
    if any(k in t for k in ("displacement", "deplacement")):
        return "displacement"
    return t or "other"


def _parse_dt(val: Any) -> datetime:
    if isinstance(val, datetime):
        return val.replace(tzinfo=timezone.utc) if val.tzinfo is None else val
    if isinstance(val, str):
        try:
            dt = datetime.fromisoformat(val[:19])
            return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
        except ValueError:
            pass
    return datetime.min.replace(tzinfo=timezone.utc)
