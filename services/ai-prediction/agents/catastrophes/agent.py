"""
AgentCatastrophes — surveillance des catastrophes naturelles via GDACS.

Cycle toutes les 30 minutes :
  1. Récupère les événements GDACS (RDC + pays voisins)
  2. Stocke dans catastrophe_naturelle (upsert par gdacs_id)
  3. Rattache aux provinces RDC via PostGIS (ST_Contains)
  4. Pour Orange/Red sur sol RDC → crée une crise SINAUR (pending_validation)
  5. Surveillance renforcée Nyiragongo : priorité maximale si activité volcanique

Table : catastrophe_naturelle (créée par migration 029)
Bus   : catastrophe.alerte (publié pour les événements graves)
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Any

import httpx
import structlog
from sqlalchemy import text

from agents import bus
from agents.catastrophes.collecteur_gdacs import collecteur_gdacs, SURVEILLANCE_RENFORCEE
from db import engine

logger = structlog.get_logger(__name__)

SINAUR_API_URL   = os.getenv("SINAUR_API_URL", "http://api:3000")
AGENT_API_KEY    = os.getenv("AGENT_INTERNAL_API_KEY", "")
FETCH_INTERVAL_S = 30 * 60  # 30 minutes

# ── In-memory store ────────────────────────────────────────────────────────────

_EVENEMENTS: list[dict] = []      # événements actifs (mis à jour à chaque cycle)
_CRISES_CREEES: list[dict] = []   # crises SINAUR créées par l'agent

_STATUS: dict[str, Any] = {
    "last_run": None,
    "runs_total": 0,
    "evenements_actifs": 0,
    "crises_creees": 0,
    "erreurs": [],
}


# ── Helpers DB ────────────────────────────────────────────────────────────────

async def _rattacher_province(lon: float, lat: float) -> str | None:
    """Trouve la province RDC (level=1) contenant ce point via PostGIS."""
    try:
        async with engine.connect() as conn:
            row = (await conn.execute(
                text("""
                    SELECT pcode FROM admin_divisions
                    WHERE level = 1 AND geometry IS NOT NULL
                      AND ST_Contains(geometry::geometry,
                            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
                    LIMIT 1
                """),
                {"lon": lon, "lat": lat},
            )).fetchone()
            return row[0] if row else None
    except Exception as exc:
        logger.warning("catastrophes.rattacher_province_error", error=str(exc))
        return None


async def _upsert_catastrophe(evt: dict, province_pcode: str | None) -> None:
    """Insère ou met à jour un événement GDACS dans catastrophe_naturelle."""
    async with engine.begin() as conn:
        await conn.execute(
            text("""
                INSERT INTO catastrophe_naturelle (
                    gdacs_id, type_code, type_label, hazard_type, titre, pays,
                    province_pcode, niveau_alerte_gdacs, statut_sinaur,
                    severite, population_affectee, coordinates,
                    date_debut, date_maj, source_url
                )
                VALUES (
                    :gdacs_id, :type_code, :type_label, :hazard_type, :titre, :pays,
                    :province_pcode, :niveau_gdacs, :statut_sinaur,
                    :severite, :population,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
                    :date_debut, :date_maj, :source_url
                )
                ON CONFLICT (gdacs_id) DO UPDATE SET
                    niveau_alerte_gdacs  = EXCLUDED.niveau_alerte_gdacs,
                    statut_sinaur        = EXCLUDED.statut_sinaur,
                    severite             = EXCLUDED.severite,
                    population_affectee  = EXCLUDED.population_affectee,
                    date_maj             = EXCLUDED.date_maj,
                    province_pcode       = COALESCE(EXCLUDED.province_pcode, catastrophe_naturelle.province_pcode)
            """),
            {
                "gdacs_id":      evt["gdacs_id"],
                "type_code":     evt["type_code"],
                "type_label":    evt["type_label"],
                "hazard_type":   evt["hazard_type"],
                "titre":         evt["titre"],
                "pays":          evt["pays"],
                "province_pcode":province_pcode,
                "niveau_gdacs":  evt["niveau_alerte_gdacs"],
                "statut_sinaur": evt["statut_sinaur"],
                "severite":      evt.get("severite"),
                "population":    evt.get("population_affectee"),
                "lon":           evt.get("lon"),
                "lat":           evt.get("lat"),
                "date_debut":    evt.get("date_debut"),
                "date_maj":      evt.get("date_maj"),
                "source_url":    evt.get("source_url"),
            },
        )


async def _creer_crise_sinaur(evt: dict, province_pcode: str, surveillance_key: str | None) -> None:
    """Crée une crise SINAUR via l'API (pending_validation=True) pour Orange/Red sur sol RDC."""
    # Niveau urgence : Red=5 (max), Orange=4, surveillance renforcée → +1
    niveau = 5 if evt["niveau_alerte_gdacs"] == "Red" else 4
    if surveillance_key:
        niveau = 5  # Zone critique → toujours max

    icone = {"EQ": "🌍", "FL": "🌊", "VO": "🌋", "TC": "🌀", "DR": "☀️", "WF": "🔥"}.get(evt["type_code"], "⚠️")
    titre = f"{icone} {evt['type_label']} — {evt['titre']}"[:255]

    if surveillance_key:
        site = SURVEILLANCE_RENFORCEE[surveillance_key]
        titre = f"🔴 SURVEILLANCE RENFORCÉE — {site['nom']}: {titre}"[:255]

    glide = f"GDACS-{evt['gdacs_id']}-{evt['type_code']}-COD"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{SINAUR_API_URL}/crises",
                json={
                    "glideNumber":      glide,
                    "title":            titre,
                    "hazardType":       evt["hazard_type"],
                    "locationPcode":    province_pcode,
                    "affectedCount":    evt.get("population_affectee"),
                    "description":      f"Source : GDACS (alerte {evt['niveau_alerte_gdacs']}). {evt.get('source_url', '')}",
                    "pendingValidation":True,
                    "confidenceScore":  0.90,
                    "sourcesDetection": [{"source": "GDACS", "gdacs_id": evt["gdacs_id"]}],
                },
                headers={"X-Agent-Key": AGENT_API_KEY},
            )
            if resp.status_code in (200, 201):
                crise_data = resp.json().get("data", {})
                _CRISES_CREEES.append({**evt, "crise_id": crise_data.get("id"), "province": province_pcode})
                _STATUS["crises_creees"] += 1
                logger.info("catastrophes.crise_creee", gdacs_id=evt["gdacs_id"], province=province_pcode)
                await bus.publish("catastrophe.alerte", {
                    **evt, "province_pcode": province_pcode, "surveillance_key": surveillance_key
                })
            else:
                logger.warning("catastrophes.crise_api_error", status=resp.status_code, body=resp.text[:200])
    except Exception as exc:
        logger.warning("catastrophes.crise_exception", error=str(exc))


# ── Agent ────────────────────────────────────────────────────────────────────

class AgentCatastrophes:
    """Surveille GDACS et alimente SINAUR en catastrophes naturelles."""

    def __init__(self) -> None:
        self._running = False
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.get_event_loop().create_task(self._boucle())
        logger.info("agent_catastrophes.started")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()

    async def _boucle(self) -> None:
        while self._running:
            await self._cycle()
            await asyncio.sleep(FETCH_INTERVAL_S)

    async def _cycle(self) -> None:
        _STATUS["last_run"] = datetime.now(timezone.utc).isoformat()
        _STATUS["runs_total"] += 1

        evenements = await collecteur_gdacs.recuperer_evenements()
        _EVENEMENTS.clear()
        _EVENEMENTS.extend(evenements)
        _STATUS["evenements_actifs"] = len(evenements)

        for evt in evenements:
            lon, lat = evt.get("lon"), evt.get("lat")
            province_pcode = await _rattacher_province(lon, lat) if (lon and lat) else None

            await _upsert_catastrophe(evt, province_pcode)

            # Créer une crise SINAUR si Orange/Red ET sur sol RDC
            if evt["niveau_alerte_gdacs"] in ("Orange", "Red") and province_pcode:
                surveillance_key = collecteur_gdacs.surveillance_renforcee_active(lon, lat, evt["type_code"])
                await _creer_crise_sinaur(evt, province_pcode, surveillance_key)

    def get_evenements(
        self,
        niveau: str | None = None,
        type_code: str | None = None,
    ) -> list[dict]:
        evts = list(_EVENEMENTS)
        if niveau:
            evts = [e for e in evts if e.get("niveau_alerte_gdacs") == niveau]
        if type_code:
            evts = [e for e in evts if e.get("type_code") == type_code]
        return evts

    def get_geojson(self) -> dict:
        features = []
        for evt in _EVENEMENTS:
            lon, lat = evt.get("lon"), evt.get("lat")
            if lon is None or lat is None:
                continue
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {k: v for k, v in evt.items() if k not in ("lon", "lat")},
            })
        return {
            "type": "FeatureCollection",
            "features": features,
            "metadata": {"total": len(features)},
        }

    def get_status(self) -> dict:
        return dict(_STATUS)

    def get_crises_creees(self) -> list[dict]:
        return list(_CRISES_CREEES)


agent_catastrophes = AgentCatastrophes()
