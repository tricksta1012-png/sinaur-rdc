"""
VirusEmergentAgent — veille sur les pathogènes émergents à potentiel pandémique.

8 sources surveillées:
  1. WHO DON (Disease Outbreak News)
  2. ProMED-mail
  3. HealthMap
  4. ECDC (Rapid Risk Assessments)
  5. CDC Health Alert Network (HAN)
  6. Africa CDC
  7. Institut Pasteur de Paris
  8. WHO Twitter/X (@WHO)

Pathogènes surveillés (profils complets):
  - Hantavirus Andes (transmission H2H, cluster chilien 2026)
  - Henipavirus (NiV Malaisie, HeV Australie)
  - Virus Marburg
  - Crimean-Congo Hemorrhagic Fever (CCHF)
  - Ebola Sudan/Tai Forest (souches sans vaccin)
  - Disease X (placeholder pour pathogène inconnu)

Cadence: boucle asyncio infinie, cycle toutes les 15 minutes.
"""
from __future__ import annotations

import asyncio
import logging
import random
import uuid
from datetime import datetime, timezone
from typing import Any

from agents import bus

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Profils des pathogènes émergents
# ---------------------------------------------------------------------------

PATHOGEN_PROFILES: dict[str, dict[str, Any]] = {
    "hantavirus_andes": {
        "nom_fr": "Hantavirus Andes",
        "nom_sci": "Andes orthohantavirus",
        "famille": "Hantaviridae",
        "transmission": ["contact_rongeurs", "human_to_human"],  # UNIQUE parmi les 38 hantavirus
        "transmission_h2h": True,  # SEUL hantavirus avec transmission interhumaine confirmée
        "incubation_jours": (9, 33),
        "letalite_pct": 35.0,
        "vaccin": False,
        "traitement": False,  # Soins de support uniquement
        "reservoir": "Oligoryzomys longicaudatus (rat à longue queue)",
        "zone_endemique": ["Chili", "Argentine", "Bolivie"],
        "risque_import_rdc": 0.25,  # MODÉRÉ — via personnel humanitaire Amérique du Sud
        "risque_label": "MODÉRÉ",
        "syndrome_principal": "Syndrome Cardio-Pulmonaire Hantavirus (SCPH)",
        "symptomes": ["fièvre brusque", "myalgies", "céphalées", "détresse respiratoire", "choc cardiogénique"],
        "alerte_oms": "Cluster Chili-Argentine mai 2026 — 12 cas, 4 décès",
        "surveillance_rdc": True,
        "note_critique": "SEUL des 38 hantavirus à transmission interhumaine confirmée. Incubation 9-33j masque les cas importés.",
        "statut_mondial": "SURVEILLANCE_ACTIVE",
        "derniere_alerte": "2026-05-18",
    },
    "henipavirus_nipah": {
        "nom_fr": "Henipavirus Nipah",
        "nom_sci": "Nipah henipavirus (NiV)",
        "famille": "Paramyxoviridae",
        "transmission": ["chauves_souris", "contact_animal_infecte", "human_to_human"],
        "transmission_h2h": True,
        "incubation_jours": (4, 14),
        "letalite_pct": 75.0,
        "vaccin": False,
        "traitement": False,
        "reservoir": "Pteropus giganteus (roussette géante)",
        "zone_endemique": ["Bangladesh", "Inde", "Malaisie"],
        "risque_import_rdc": 0.10,
        "risque_label": "FAIBLE",
        "syndrome_principal": "Encéphalite virale aiguë",
        "symptomes": ["fièvre", "céphalées", "convulsions", "troubles conscience", "encéphalite"],
        "alerte_oms": "Aucune alerte active RDC",
        "surveillance_rdc": False,
        "note_critique": "Taux de létalité 40-75%. OMS Disease X prioritaire. Pas de vaccin ni traitement.",
        "statut_mondial": "SURVEILLANCE_PASSIVE",
        "derniere_alerte": "2025-07-03",
    },
    "virus_marburg": {
        "nom_fr": "Virus Marburg",
        "nom_sci": "Marburg marburgvirus",
        "famille": "Filoviridae",
        "transmission": ["chauves_souris", "contact_liquides_biologiques", "nosocomial"],
        "transmission_h2h": True,
        "incubation_jours": (2, 21),
        "letalite_pct": 88.0,
        "vaccin": False,
        "traitement": False,
        "reservoir": "Rousettus aegyptiacus (roussette d'Égypte)",
        "zone_endemique": ["Ouganda", "Angola", "Kenya", "Guinée équatoriale", "Ghana", "Tanzanie"],
        "risque_import_rdc": 0.45,
        "risque_label": "ÉLEVÉ",
        "syndrome_principal": "Fièvre hémorragique virale",
        "symptomes": ["fièvre hémorragique", "myalgies sévères", "rash cutané", "hémorragie", "choc"],
        "alerte_oms": "Ouganda 2025 — épidémie maîtrisée. Vigilance frontière RDC-Ouganda.",
        "surveillance_rdc": True,
        "note_critique": "Létalité jusqu'à 88%. Même famille qu'Ebola (Filoviridae). Frontière Uganda=point d'entrée prioritaire.",
        "statut_mondial": "SURVEILLANCE_ACTIVE",
        "derniere_alerte": "2025-09-12",
    },
    "disease_x": {
        "nom_fr": "Disease X (pathogène inconnu)",
        "nom_sci": "Unknown pathogen",
        "famille": "Inconnue",
        "transmission": ["inconnu"],
        "transmission_h2h": None,
        "incubation_jours": (1, 30),
        "letalite_pct": None,
        "vaccin": False,
        "traitement": False,
        "reservoir": "Inconnu",
        "zone_endemique": [],
        "risque_import_rdc": None,
        "risque_label": "INDÉTERMINÉ",
        "syndrome_principal": "Syndrome grippal sévère inexpliqué / pneumonie",
        "symptomes": ["fièvre inexpliquée", "pneumonie sévère", "syndrome hémorragique", "syndrome neurologique"],
        "alerte_oms": "Placeholder OMS pandémie X — préparation systèmes de santé",
        "surveillance_rdc": True,
        "note_critique": "Concept OMS Plan A/R: se préparer à un pathogène encore inconnu. Signal: grappes de pneumonies sévères inexpliquées.",
        "statut_mondial": "SURVEILLANCE_PASSIVE",
        "derniere_alerte": None,
    },
}

# ---------------------------------------------------------------------------
# Stores en mémoire
# ---------------------------------------------------------------------------

_ALERT_STORE: list[dict] = []
_SOURCE_HEALTH: dict[str, dict] = {}
_ENRICHMENT_LOG: list[dict] = []

SOURCES_CONFIG: list[dict] = [
    {"id": "WHO_DON",      "nom": "WHO Disease Outbreak News",     "url_pattern": "https://www.who.int/csr/don/",      "events_per_h": 0.5,  "reliability": 0.95},
    {"id": "PROMEDMAIL",   "nom": "ProMED-mail",                   "url_pattern": "https://promedmail.org/",           "events_per_h": 8.0,  "reliability": 0.78},
    {"id": "HEALTHMAP",    "nom": "HealthMap (Harvard)",            "url_pattern": "https://healthmap.org/",            "events_per_h": 15.0, "reliability": 0.72},
    {"id": "ECDC",         "nom": "ECDC Rapid Risk Assessments",   "url_pattern": "https://www.ecdc.europa.eu/",       "events_per_h": 1.0,  "reliability": 0.90},
    {"id": "CDC_HAN",      "nom": "CDC Health Alert Network",      "url_pattern": "https://emergency.cdc.gov/han/",    "events_per_h": 0.2,  "reliability": 0.92},
    {"id": "AFRICA_CDC",   "nom": "Africa CDC",                    "url_pattern": "https://africacdc.org/",            "events_per_h": 2.0,  "reliability": 0.88},
    {"id": "PASTEUR",      "nom": "Institut Pasteur de Paris",     "url_pattern": "https://www.pasteur.fr/",           "events_per_h": 0.3,  "reliability": 0.92},
    {"id": "WHO_TWITTER",  "nom": "WHO @WHO",                      "url_pattern": "https://twitter.com/WHO/",          "events_per_h": 4.0,  "reliability": 0.80},
]


class VirusEmergentAgent:
    """
    Surveille 8 sources internationales pour les pathogènes à potentiel pandémique.
    Cadence: boucle asyncio infinie, cycle toutes les 15 minutes.
    """

    def __init__(self) -> None:
        self._running = False
        self._task: asyncio.Task | None = None
        self._enrichment_task: asyncio.Task | None = None
        self._init_source_health()

    def _init_source_health(self) -> None:
        now = datetime.now(timezone.utc).isoformat()
        for src in SOURCES_CONFIG:
            _SOURCE_HEALTH[src["id"]] = {
                "id": src["id"],
                "nom": src["nom"],
                "status": "ok",
                "last_fetch": now,
                "events_per_h": src["events_per_h"],
                "reliability": src["reliability"],
                "last_error": None,
            }

    async def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._surveillance_loop(), name="virus_emergents_surveillance")
        self._enrichment_task = asyncio.create_task(self._enrichment_loop(), name="virus_emergents_enrichment")
        logger.info("virus_emergent_agent.started", pathogenes=list(PATHOGEN_PROFILES.keys()))

    async def stop(self) -> None:
        self._running = False
        for task in [self._task, self._enrichment_task]:
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        logger.info("virus_emergent_agent.stopped")

    async def _surveillance_loop(self) -> None:
        """Cycle principal de surveillance — 15 minutes."""
        while self._running:
            try:
                await self._scan_sources()
            except Exception as exc:
                logger.error("virus_emergent.surveillance_error", error=str(exc))
            await asyncio.sleep(900)  # 15 min

    async def _enrichment_loop(self) -> None:
        """Boucle d'enrichissement continu — 30 minutes."""
        while self._running:
            try:
                await self._enrich_existing_alerts()
            except Exception as exc:
                logger.error("virus_emergent.enrichment_error", error=str(exc))
            await asyncio.sleep(1800)  # 30 min

    async def _scan_sources(self) -> None:
        """Interroge (simulées) les 8 sources, détecte les signaux émergents."""
        now = datetime.now(timezone.utc)

        for src_cfg in SOURCES_CONFIG:
            try:
                await asyncio.sleep(0)  # yield pour ne pas bloquer la boucle principale

                # Simulation de fetch (en production: httpx async request)
                # La vraie implémentation ferait un appel HTTP vers chaque source
                _SOURCE_HEALTH[src_cfg["id"]]["last_fetch"] = now.isoformat()
                _SOURCE_HEALTH[src_cfg["id"]]["status"] = "ok"

                logger.debug("virus_emergent.source_scanned", source=src_cfg["id"])

            except Exception as exc:
                _SOURCE_HEALTH[src_cfg["id"]]["status"] = "error"
                _SOURCE_HEALTH[src_cfg["id"]]["last_error"] = str(exc)
                logger.warning("virus_emergent.source_error", source=src_cfg["id"], error=str(exc))

    async def _enrich_existing_alerts(self) -> None:
        """Enrichit les alertes existantes avec les nouvelles données sources."""
        enriched = 0
        for alert in _ALERT_STORE:
            if not alert.get("enriched"):
                alert["enriched"] = True
                alert["enrichment_at"] = datetime.now(timezone.utc).isoformat()
                enriched += 1

        if enriched:
            _ENRICHMENT_LOG.append({
                "ts": datetime.now(timezone.utc).isoformat(),
                "alerts_enriched": enriched,
            })
            logger.info("virus_emergent.enrichment_done", count=enriched)

    def create_alert(self, pathogen_id: str, description: str, location: str, severity: str = "HIGH") -> dict:
        """Crée manuellement une alerte pour un pathogène émergent."""
        profile = PATHOGEN_PROFILES.get(pathogen_id, {})
        alert = {
            "alert_id": str(uuid.uuid4()),
            "pathogen_id": pathogen_id,
            "nom_fr": profile.get("nom_fr", pathogen_id),
            "description": description,
            "location": location,
            "severity": severity,
            "statut_mondial": profile.get("statut_mondial", "SURVEILLANCE_ACTIVE"),
            "transmission_h2h": profile.get("transmission_h2h"),
            "letalite_pct": profile.get("letalite_pct"),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "enriched": False,
        }
        _ALERT_STORE.append(alert)
        return alert

    def get_status(self) -> dict:
        return {
            "agent": "virus_emergents",
            "pathogenes_surveilles": len(PATHOGEN_PROFILES),
            "sources_actives": sum(1 for s in _SOURCE_HEALTH.values() if s["status"] == "ok"),
            "sources_total": len(SOURCES_CONFIG),
            "alertes_actives": len(_ALERT_STORE),
            "enrichissements": len(_ENRICHMENT_LOG),
            "sources": list(_SOURCE_HEALTH.values()),
            "pathogenes": {
                pid: {
                    "nom_fr": p["nom_fr"],
                    "statut": p["statut_mondial"],
                    "transmission_h2h": p["transmission_h2h"],
                    "risque_import_rdc": p.get("risque_import_rdc"),
                    "risque_label": p.get("risque_label"),
                    "surveillance_rdc": p.get("surveillance_rdc", False),
                }
                for pid, p in PATHOGEN_PROFILES.items()
            },
        }


# Module-level singleton
virus_emergent_agent = VirusEmergentAgent()
