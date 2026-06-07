"""
Feature engineering pour les modèles de risque SINAUR-RDC.

Chaque feature est documentée pour garantir l'explicabilité des prédictions
(exigence non-négociable du spec §5).
"""
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from ..database import fetch_all


# Seuils climatiques utilisés comme features
FLOOD_PRECIP_THRESHOLD_MM = 60.0
DROUGHT_DRY_DAYS_THRESHOLD = 15


def load_historical_events(pcode: str, hazard_type: str, days_back: int = 365) -> pd.DataFrame:
    """Charge les événements historiques pour un pcode et type d'aléa."""
    rows = fetch_all(
        """
        SELECT start_date, severity, estimated_affected, source, confidence
        FROM disaster_events
        WHERE (location_pcode = :pcode OR :pcode = ANY(affected_pcodes))
          AND hazard_type = :hazard_type::hazard_type
          AND start_date >= NOW() - INTERVAL ':days days'
          AND deleted_at IS NULL
        ORDER BY start_date DESC
        """,
        {"pcode": pcode, "hazard_type": hazard_type, "days": days_back},
    )
    return pd.DataFrame(rows) if rows else pd.DataFrame()


def load_weather_signals(pcode: str) -> dict:
    """Charge les signaux météo récents pour un pcode depuis les événements ingérés."""
    rows = fetch_all(
        """
        SELECT raw_payload, start_date, hazard_type
        FROM canonical_events
        WHERE location_pcode = :pcode
          AND source = 'open_meteo'
          AND fetched_at >= NOW() - INTERVAL '7 days'
        ORDER BY fetched_at DESC
        LIMIT 1
        """,
        {"pcode": pcode},
    )
    if not rows:
        return {"max_precip_7d": 0, "dry_days": 0}

    payload = rows[0].get("raw_payload", {})
    daily = payload.get("daily", {}) if isinstance(payload, dict) else {}
    precip = daily.get("precipitation_sum", [])
    past = [v for v in precip[:7] if isinstance(v, (int, float)) and not np.isnan(v)]

    max_precip = float(max(past)) if past else 0.0
    dry_days = sum(1 for v in reversed(past) if v < 1.0)

    return {"max_precip_7d": max_precip, "dry_days": dry_days}


def build_features(pcode: str, hazard_type: str) -> dict:
    """
    Construit le vecteur de features pour (pcode, hazard_type).

    Features retournées (toutes documentées pour l'explicabilité) :
    - events_30d       : nombre d'événements du même type dans les 30 derniers jours
    - events_90d       : nombre d'événements dans les 90 derniers jours
    - max_severity_90d : sévérité max observée (encodée 0-4)
    - days_since_last  : jours depuis le dernier événement (999 si aucun)
    - max_precip_7d    : précipitations max sur 7j (mm) — signal météo direct
    - dry_days         : jours secs consécutifs — signal sécheresse
    - is_rainy_season  : 1 si mois en cours = saison des pluies RDC (mars-mai, oct-déc)
    - population_k     : population de la province (milliers) — proxy vulnérabilité
    """
    now = datetime.utcnow()
    hist = load_historical_events(pcode, hazard_type, 365)
    weather = load_weather_signals(pcode)

    severity_map = {"Minor": 1, "Moderate": 2, "Severe": 3, "Extreme": 4, "Unknown": 0}

    if not hist.empty and "start_date" in hist.columns:
        hist["start_date"] = pd.to_datetime(hist["start_date"], utc=True)
        hist_30d = hist[hist["start_date"] >= pd.Timestamp(now - timedelta(days=30), tz="UTC")]
        hist_90d = hist[hist["start_date"] >= pd.Timestamp(now - timedelta(days=90), tz="UTC")]
        events_30d = len(hist_30d)
        events_90d = len(hist_90d)
        max_severity_90d = max(
            (severity_map.get(str(r), 0) for r in hist_90d.get("severity", [])),
            default=0,
        )
        last_event = hist["start_date"].max()
        days_since_last = (pd.Timestamp(now, tz="UTC") - last_event).days if pd.notna(last_event) else 999
    else:
        events_30d = events_90d = max_severity_90d = 0
        days_since_last = 999

    month = now.month
    is_rainy_season = int(month in (3, 4, 5, 10, 11, 12))

    pop_data = fetch_all("SELECT population FROM admin_divisions WHERE pcode = :pcode LIMIT 1", {"pcode": pcode})
    population_k = (pop_data[0]["population"] or 0) / 1000 if pop_data else 0

    return {
        "events_30d": events_30d,
        "events_90d": events_90d,
        "max_severity_90d": max_severity_90d,
        "days_since_last": min(days_since_last, 999),
        "max_precip_7d": weather["max_precip_7d"],
        "dry_days": weather["dry_days"],
        "is_rainy_season": is_rainy_season,
        "population_k": min(population_k, 20_000),
    }


FEATURE_NAMES = [
    "events_30d", "events_90d", "max_severity_90d", "days_since_last",
    "max_precip_7d", "dry_days", "is_rainy_season", "population_k",
]

FEATURE_LABELS_FR = {
    "events_30d":       "Événements similaires (30j)",
    "events_90d":       "Événements similaires (90j)",
    "max_severity_90d": "Sévérité maximale observée (90j)",
    "days_since_last":  "Jours depuis le dernier événement",
    "max_precip_7d":    "Précipitations max (7j, mm)",
    "dry_days":         "Jours secs consécutifs",
    "is_rainy_season":  "Saison des pluies",
    "population_k":     "Population (milliers)",
}
