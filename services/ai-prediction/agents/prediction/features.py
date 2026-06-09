"""
Feature engineering for risk prediction — one feature dict per (p_code, horizon).
Uses in-memory caches seeded from veille agent events where possible.
"""
from __future__ import annotations

from datetime import datetime, timezone

import structlog

logger = structlog.get_logger(__name__)

# Static geo data for all 26 provinces
PROVINCE_GEO: dict[str, dict] = {
    "CD-NK": {
        "pente_moyenne": 12.5,
        "distance_cours_eau_km": 1.2,
        "altitude_m": 1500,
        "couverture_forestiere_pct": 45,
        "province": "Nord-Kivu",
        "population": 7_312_000,
        "idp_threshold": 500_000,
    },
    "CD-SK": {
        "pente_moyenne": 15.0,
        "distance_cours_eau_km": 0.8,
        "altitude_m": 1800,
        "couverture_forestiere_pct": 60,
        "province": "Sud-Kivu",
        "population": 6_201_000,
        "idp_threshold": 400_000,
    },
    "CD-MN": {
        "pente_moyenne": 8.0,
        "distance_cours_eau_km": 1.5,
        "altitude_m": 600,
        "couverture_forestiere_pct": 70,
        "province": "Maniema",
        "population": 2_173_000,
        "idp_threshold": 150_000,
    },
    "CD-HK": {
        "pente_moyenne": 5.0,
        "distance_cours_eau_km": 3.0,
        "altitude_m": 1200,
        "couverture_forestiere_pct": 35,
        "province": "Haut-Katanga",
        "population": 4_046_000,
        "idp_threshold": 200_000,
    },
    "CD-IT": {
        "pente_moyenne": 10.0,
        "distance_cours_eau_km": 1.0,
        "altitude_m": 800,
        "couverture_forestiere_pct": 65,
        "province": "Ituri",
        "population": 5_120_000,
        "idp_threshold": 350_000,
    },
    "CD-TP": {
        "pente_moyenne": 3.0,
        "distance_cours_eau_km": 0.5,
        "altitude_m": 450,
        "couverture_forestiere_pct": 80,
        "province": "Tshopo",
        "population": 3_749_000,
        "idp_threshold": 200_000,
    },
    "CD-BU": {
        "pente_moyenne": 2.5,
        "distance_cours_eau_km": 0.8,
        "altitude_m": 400,
        "couverture_forestiere_pct": 75,
        "province": "Bas-Uele",
        "population": 1_443_000,
        "idp_threshold": 100_000,
    },
    "CD-MO": {
        "pente_moyenne": 1.5,
        "distance_cours_eau_km": 0.3,
        "altitude_m": 350,
        "couverture_forestiere_pct": 72,
        "province": "Mongala",
        "population": 1_988_000,
        "idp_threshold": 100_000,
    },
    "CD-SA": {
        "pente_moyenne": 2.0,
        "distance_cours_eau_km": 0.4,
        "altitude_m": 380,
        "couverture_forestiere_pct": 68,
        "province": "Sud-Ubangi",
        "population": 2_289_000,
        "idp_threshold": 100_000,
    },
    "CD-NU": {
        "pente_moyenne": 2.2,
        "distance_cours_eau_km": 0.6,
        "altitude_m": 390,
        "couverture_forestiere_pct": 66,
        "province": "Nord-Ubangi",
        "population": 1_659_000,
        "idp_threshold": 80_000,
    },
    "CD-EQ": {
        "pente_moyenne": 1.0,
        "distance_cours_eau_km": 0.2,
        "altitude_m": 320,
        "couverture_forestiere_pct": 85,
        "province": "Équateur",
        "population": 1_530_000,
        "idp_threshold": 80_000,
    },
    "CD-HL": {
        "pente_moyenne": 6.0,
        "distance_cours_eau_km": 2.0,
        "altitude_m": 900,
        "couverture_forestiere_pct": 50,
        "province": "Haut-Lomami",
        "population": 2_765_000,
        "idp_threshold": 120_000,
    },
    "CD-TA": {
        "pente_moyenne": 7.5,
        "distance_cours_eau_km": 1.8,
        "altitude_m": 780,
        "couverture_forestiere_pct": 55,
        "province": "Tanganyika",
        "population": 2_506_000,
        "idp_threshold": 150_000,
    },
    "CD-LO": {
        "pente_moyenne": 4.5,
        "distance_cours_eau_km": 2.5,
        "altitude_m": 1100,
        "couverture_forestiere_pct": 30,
        "province": "Lualaba",
        "population": 1_887_000,
        "idp_threshold": 80_000,
    },
    "CD-HU": {
        "pente_moyenne": 9.0,
        "distance_cours_eau_km": 1.1,
        "altitude_m": 700,
        "couverture_forestiere_pct": 60,
        "province": "Haut-Uele",
        "population": 2_097_000,
        "idp_threshold": 120_000,
    },
    "CD-SU": {
        "pente_moyenne": 4.0,
        "distance_cours_eau_km": 0.9,
        "altitude_m": 500,
        "couverture_forestiere_pct": 55,
        "province": "Sankuru",
        "population": 2_067_000,
        "idp_threshold": 100_000,
    },
    "CD-KC": {
        "pente_moyenne": 3.5,
        "distance_cours_eau_km": 1.0,
        "altitude_m": 550,
        "couverture_forestiere_pct": 40,
        "province": "Kasaï",
        "population": 3_006_000,
        "idp_threshold": 150_000,
    },
    "CD-KC2": {
        "pente_moyenne": 3.8,
        "distance_cours_eau_km": 1.1,
        "altitude_m": 570,
        "couverture_forestiere_pct": 38,
        "province": "Kasaï-Central",
        "population": 4_201_000,
        "idp_threshold": 150_000,
    },
    "CD-MK": {
        "pente_moyenne": 5.5,
        "distance_cours_eau_km": 1.3,
        "altitude_m": 650,
        "couverture_forestiere_pct": 42,
        "province": "Kasaï-Oriental",
        "population": 4_447_000,
        "idp_threshold": 200_000,
    },
    "CD-LM": {
        "pente_moyenne": 4.2,
        "distance_cours_eau_km": 0.9,
        "altitude_m": 580,
        "couverture_forestiere_pct": 45,
        "province": "Lomami",
        "population": 2_761_000,
        "idp_threshold": 100_000,
    },
    "CD-KW": {
        "pente_moyenne": 2.8,
        "distance_cours_eau_km": 0.6,
        "altitude_m": 430,
        "couverture_forestiere_pct": 58,
        "province": "Kwilu",
        "population": 5_453_000,
        "idp_threshold": 200_000,
    },
    "CD-KO": {
        "pente_moyenne": 2.2,
        "distance_cours_eau_km": 0.7,
        "altitude_m": 400,
        "couverture_forestiere_pct": 50,
        "province": "Kwango",
        "population": 2_556_000,
        "idp_threshold": 100_000,
    },
    "CD-MN2": {
        "pente_moyenne": 1.2,
        "distance_cours_eau_km": 0.3,
        "altitude_m": 330,
        "couverture_forestiere_pct": 78,
        "province": "Mai-Ndombe",
        "population": 2_048_000,
        "idp_threshold": 80_000,
    },
    "CD-BC": {
        "pente_moyenne": 3.0,
        "distance_cours_eau_km": 1.0,
        "altitude_m": 200,
        "couverture_forestiere_pct": 35,
        "province": "Kongo Central",
        "population": 5_575_000,
        "idp_threshold": 150_000,
    },
    "CD-BN": {
        "pente_moyenne": 1.8,
        "distance_cours_eau_km": 0.4,
        "altitude_m": 350,
        "couverture_forestiere_pct": 62,
        "province": "Bandundu",
        "population": 2_084_000,
        "idp_threshold": 80_000,
    },
    "CD-KN": {
        "pente_moyenne": 2.0,
        "distance_cours_eau_km": 0.5,
        "altitude_m": 270,
        "couverture_forestiere_pct": 5,
        "province": "Kinshasa",
        "population": 17_071_000,
        "idp_threshold": 300_000,
    },
}

# RDC rainy seasons: March-May, September-November
RAINY_MONTHS = {3, 4, 5, 9, 10, 11}

# In-memory weather cache: p_code → {precipitation_7j_mm, temp_max, ...}
_WEATHER_CACHE: dict[str, dict] = {}

# In-memory event count cache: p_code → {nb_evenements_7j, nb_signalements_7j, ipc_level, idp_count}
_EVENT_CACHE: dict[str, dict] = {}


def update_weather_cache(p_code: str, data: dict) -> None:
    """Update the weather cache for a province (called by Open-Meteo connector)."""
    _WEATHER_CACHE[p_code] = data


def update_event_cache(p_code: str, data: dict) -> None:
    """Update the event cache for a province (called by veille agent)."""
    current = _EVENT_CACHE.get(p_code, {})
    current.update(data)
    _EVENT_CACHE[p_code] = current


class FeatureBuilder:
    """Builds the feature dictionary for a given (p_code, horizon_days)."""

    def build(self, p_code: str, horizon_days: int) -> dict:
        geo = PROVINCE_GEO.get(p_code, {})
        weather = _WEATHER_CACHE.get(p_code, {})
        events = _EVENT_CACHE.get(p_code, {})

        now = datetime.now(timezone.utc)
        saison_pluies = now.month in RAINY_MONTHS

        # Precipitation: use cache or default
        precipitation_7j_mm: float = weather.get("precipitation_7j_mm", 0.0)

        # IPC level (1-5)
        ipc_level: int = events.get("ipc_level", 1)

        # IDP count
        idp_count: int = events.get("idp_count", 0)
        idp_count_thousands: float = idp_count / 1000.0

        # Citizen report counts
        nb_signalements_citoyens_7j: int = events.get("nb_signalements_citoyens_7j", 0)
        nb_signalements_sanitaires_7j: int = events.get("nb_signalements_sanitaires_7j", 0)
        nb_evenements_meme_type_7j: int = events.get("nb_evenements_meme_type_7j", 0)

        # Geo features (static)
        pente_moyenne: float = geo.get("pente_moyenne", 5.0)
        distance_cours_eau_km: float = geo.get("distance_cours_eau_km", 5.0)
        altitude_m: float = geo.get("altitude_m", 500.0)
        couverture_forestiere_pct: float = geo.get("couverture_forestiere_pct", 50.0)
        population: int = geo.get("population", 1_000_000)
        idp_threshold: int = geo.get("idp_threshold", 100_000)

        logger.debug(
            "feature_builder.build",
            p_code=p_code,
            horizon_days=horizon_days,
            precipitation_7j_mm=precipitation_7j_mm,
            saison_pluies=saison_pluies,
        )

        return {
            # Geo
            "pente_moyenne": pente_moyenne,
            "distance_cours_eau_km": distance_cours_eau_km,
            "altitude_m": altitude_m,
            "couverture_forestiere_pct": couverture_forestiere_pct,
            "population": population,
            # Weather
            "precipitation_7j_mm": precipitation_7j_mm,
            "saison_pluies": saison_pluies,
            # Events
            "ipc_level": ipc_level,
            "idp_count": idp_count,
            "idp_count_thousands": idp_count_thousands,
            "idp_threshold": idp_threshold,
            "nb_signalements_citoyens_7j": nb_signalements_citoyens_7j,
            "nb_signalements_sanitaires_7j": nb_signalements_sanitaires_7j,
            "nb_evenements_meme_type_7j": nb_evenements_meme_type_7j,
            # Derived
            "horizon_days": horizon_days,
        }
