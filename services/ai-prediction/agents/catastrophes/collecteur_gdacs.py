"""
CollecteurGDACS — flux temps réel catastrophes naturelles (GDACS).

GDACS = Global Disaster Alert and Coordination System (ONU + Commission européenne).
Secrétariat OCHA — cohérent avec les autres sources SINAUR.
Gratuit, sans clé API, GeoJSON exploitable directement.

Couvre : séismes, cyclones, inondations, volcans, sécheresses, feux, tsunamis.
Filtre : RDC (bbox élargie) + 9 pays voisins (une catastrophe frontalière peut affecter la RDC).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx
import structlog

logger = structlog.get_logger(__name__)

# ── Endpoints GDACS ───────────────────────────────────────────────────────────

GDACS_GEOJSON = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
GDACS_RSS     = "https://www.gdacs.org/xml/rss.xml"

HEADERS = {
    "User-Agent": "SINAUR-RDC/2.0 (plateforme catastrophes RDC; contact@sinaur-rdc.cd)",
    "Accept": "application/json",
}

# ── Types d'événements GDACS ──────────────────────────────────────────────────

TYPES_EVENEMENT: dict[str, str] = {
    'EQ': 'Séisme',
    'TC': 'Cyclone tropical',
    'FL': 'Inondation',
    'VO': 'Éruption volcanique',
    'DR': 'Sécheresse',
    'WF': 'Feu de forêt',
    'TS': 'Tsunami',
}

# Mapping GDACS type → hazard_type PostgreSQL enum
GDACS_TO_HAZARD: dict[str, str] = {
    'EQ': 'earthquake',
    'TC': 'other',          # cyclone → other (pas d'enum TC)
    'FL': 'flood',
    'VO': 'volcanic_eruption',
    'DR': 'drought',
    'WF': 'fire',
    'TS': 'flood',          # tsunami → flood (le plus proche)
}

# Mapping niveaux d'alerte GDACS → statuts SINAUR
GDACS_TO_STATUT: dict[str, str] = {
    'Green':  'VIGILANCE',
    'Orange': 'ALERTE',
    'Red':    'CRISE',
}

# ── Zone géographique d'intérêt ───────────────────────────────────────────────

# Bounding box élargie : RDC + marges (catastrophes frontalières)
BBOX_RDC = {'lat_min': -14.0, 'lat_max': 6.0, 'lon_min': 11.0, 'lon_max': 32.0}

PAYS_VOISINS = {
    'Democratic Republic of the Congo', 'Congo', 'Republic of the Congo',
    'Uganda', 'Rwanda', 'Burundi', 'Tanzania', 'Zambia', 'Angola',
    'South Sudan', 'Central African Republic',
}

# ── Surveillance renforcée (menaces permanentes) ──────────────────────────────

SURVEILLANCE_RENFORCEE: dict[str, dict] = {
    'nyiragongo': {
        'nom': 'Volcan Nyiragongo',
        'coordinates': [29.25, -1.52],
        'rayon_km': 30,
        'province_pcode': 'CD61',   # Nord-Kivu
        'population_menacee': 2_000_000,
        'note': 'Goma en zone de crise (M23 + épidémies). Éruption 2021 = déplacements massifs. '
                'Conjonction catastrophe + conflit + épidémie = risque multiplicateur.',
    },
    'mont_karisimbi': {
        'nom': 'Mont Karisimbi (Rwanda/RDC)',
        'coordinates': [29.45, -1.50],
        'rayon_km': 40,
        'province_pcode': 'CD61',
        'population_menacee': 500_000,
        'note': 'Volcan du Rift albertin, chevauchement Rwanda-RDC.',
    },
}


# ── Collecteur ────────────────────────────────────────────────────────────────

class CollecteurGDACS:

    async def recuperer_evenements(self) -> list[dict[str, Any]]:
        """Récupère et filtre les événements GDACS pertinents pour la RDC."""
        raw = await self._fetch_geojson()
        if not raw:
            # Fallback RSS si GeoJSON échoue
            raw = await self._fetch_rss_fallback()
        return raw

    async def _fetch_geojson(self) -> list[dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=60, headers=HEADERS) as client:
                resp = await client.get(
                    GDACS_GEOJSON,
                    params={
                        "alertlevel": "Orange,Red,Green",
                        "eventlist": "EQ,FL,VO,TC,DR,WF,TS",
                        "limit": 200,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            logger.warning("gdacs.fetch_geojson_error", error=str(exc))
            return []

        evenements: list[dict] = []
        for feature in data.get("features", []):
            props = feature.get("properties", {})
            geom  = feature.get("geometry", {})
            coords = geom.get("coordinates", [None, None])
            lon, lat = (coords[0] if coords else None), (coords[1] if coords else None)

            if not self._est_pertinent(lat, lon, props):
                continue

            evt = self._normaliser(props, lon, lat)
            if evt:
                evenements.append(evt)

        logger.info("gdacs.fetched", total=len(evenements))
        return evenements

    async def _fetch_rss_fallback(self) -> list[dict[str, Any]]:
        """Fallback : parse le flux RSS GDACS si l'API GeoJSON est indisponible."""
        try:
            import xml.etree.ElementTree as ET
            async with httpx.AsyncClient(timeout=30, headers=HEADERS) as client:
                resp = await client.get(GDACS_RSS)
                resp.raise_for_status()
                root = ET.fromstring(resp.text)
        except Exception as exc:
            logger.warning("gdacs.rss_fallback_error", error=str(exc))
            return []

        evenements: list[dict] = []
        ns = {
            'geo':   'http://www.w3.org/2003/01/geo/wgs84_pos#',
            'gdacs': 'http://www.gdacs.org',
        }
        for item in root.findall('.//item'):
            try:
                lat_el = item.find('geo:lat', ns)
                lon_el = item.find('geo:long', ns)
                lat = float(lat_el.text) if lat_el is not None else None
                lon = float(lon_el.text) if lon_el is not None else None
                country_el = item.find('gdacs:country', ns)
                country = country_el.text if country_el is not None else ''

                props = {
                    'eventtype':   (item.find('gdacs:eventtype', ns) or {}).get('text', ''),
                    'alertlevel':  (item.find('gdacs:alertlevel', ns) or {}).get('text', 'Green'),
                    'name':        (item.find('title') or {}).text or '',
                    'country':     country,
                    'eventid':     (item.find('gdacs:eventid', ns) or {}).get('text', ''),
                    'fromdate':    (item.find('gdacs:fromdate', ns) or {}).get('text', ''),
                    'severitydata': {},
                }
                if not self._est_pertinent(lat, lon, props):
                    continue
                evt = self._normaliser(props, lon, lat)
                if evt:
                    evenements.append(evt)
            except Exception:
                continue

        return evenements

    def _est_pertinent(self, lat: float | None, lon: float | None, props: dict) -> bool:
        if lat is not None and lon is not None:
            b = BBOX_RDC
            if b['lat_min'] <= lat <= b['lat_max'] and b['lon_min'] <= lon <= b['lon_max']:
                return True
        country = props.get('country', '')
        return any(v.lower() in country.lower() for v in PAYS_VOISINS)

    def _normaliser(self, props: dict, lon: float | None, lat: float | None) -> dict | None:
        type_code = props.get('eventtype', '')
        gdacs_id  = str(props.get('eventid', ''))
        if not gdacs_id or not type_code:
            return None

        sev_data = props.get('severitydata') or {}
        return {
            'gdacs_id':            gdacs_id,
            'type_code':           type_code,
            'type_label':          TYPES_EVENEMENT.get(type_code, 'Autre'),
            'hazard_type':         GDACS_TO_HAZARD.get(type_code, 'other'),
            'niveau_alerte_gdacs': props.get('alertlevel', 'Green'),
            'statut_sinaur':       GDACS_TO_STATUT.get(props.get('alertlevel', 'Green'), 'VIGILANCE'),
            'titre':               (props.get('name') or props.get('htmldescription') or '').strip()[:500],
            'pays':                props.get('country', ''),
            'severite':            sev_data.get('severity'),
            'population_affectee': sev_data.get('population'),
            'date_debut':          props.get('fromdate'),
            'date_maj':            props.get('todate') or props.get('fromdate'),
            'source_url':          (props.get('url') or {}).get('details') if isinstance(props.get('url'), dict) else props.get('url'),
            'lon':                 lon,
            'lat':                 lat,
        }

    def surveillance_renforcee_active(self, lon: float | None, lat: float | None, type_code: str) -> str | None:
        """Retourne la clé de surveillance renforcée si l'événement est dans un rayon critique."""
        if type_code not in ('VO', 'EQ') or lon is None or lat is None:
            return None
        for key, site in SURVEILLANCE_RENFORCEE.items():
            slat, slon = site['coordinates'][1], site['coordinates'][0]
            # Distance approx en degrés (0.9° ≈ 100km à l'équateur)
            dist_deg = ((lat - slat) ** 2 + (lon - slon) ** 2) ** 0.5
            rayon_deg = site['rayon_km'] / 111.0
            if dist_deg <= rayon_deg:
                return key
        return None


collecteur_gdacs = CollecteurGDACS()
