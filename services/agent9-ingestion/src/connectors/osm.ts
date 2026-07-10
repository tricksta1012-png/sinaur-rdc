import axios from 'axios'
import { logger } from '../logger.js'

// Overpass API — données OpenStreetMap, accès public sans clé
// Bounding box RDC : south=-13.5, west=12.2, north=5.4, east=31.7
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const DRC_BBOX     = '-13.5,12.2,5.4,31.7'

export interface OsmPoint { lat: number; lng: number }

async function overpassQuery(query: string, description: string): Promise<OsmPoint[]> {
  logger.info(`OSM Overpass: ${description}`)
  const res = await axios.post<{ elements: unknown[] }>(
    OVERPASS_URL,
    `data=${encodeURIComponent(query)}`,
    {
      timeout: 300_000,
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'User-Agent':    'SINAUR-RDC/1.0 (humanitarian-protection-system)',
      },
      maxContentLength: 50 * 1024 * 1024, // 50 MB
    },
  )

  const elements = res.data?.elements ?? []
  const points = (elements as Record<string, unknown>[]).flatMap(el => {
    if (el['type'] === 'node' && typeof el['lat'] === 'number') {
      return [{ lat: el['lat'] as number, lng: el['lon'] as number }]
    }
    const center = el['center'] as Record<string, number> | undefined
    if (center && typeof center['lat'] === 'number') {
      return [{ lat: center['lat'] as number, lng: center['lon'] as number }]
    }
    return []
  })

  logger.info({ count: points.length }, `OSM ${description} récupérés`)
  return points
}

// ─── Structures de santé ──────────────────────────────────────────────────────
// hospitals, clinics, health posts, dispensaries, pharmacies
export async function fetchHealthFacilities(): Promise<OsmPoint[]> {
  return overpassQuery(`
    [out:json][timeout:300];
    (
      node["amenity"~"hospital|clinic|health_post|dispensary|pharmacy"](${DRC_BBOX});
      way["amenity"~"hospital|clinic|health_post|dispensary|pharmacy"](${DRC_BBOX});
    );
    out center;
  `, 'structures de santé RDC')
}

// ─── Établissements scolaires ─────────────────────────────────────────────────
export async function fetchSchools(): Promise<OsmPoint[]> {
  return overpassQuery(`
    [out:json][timeout:300];
    (
      node["amenity"~"school|college|university|kindergarten"](${DRC_BBOX});
      way["amenity"~"school|college|university|kindergarten"](${DRC_BBOX});
    );
    out center;
  `, 'établissements scolaires RDC')
}

// ─── Sites miniers ────────────────────────────────────────────────────────────
// quarries + mineshafts : proxy pour les ressources naturelles extractives
export async function fetchMines(): Promise<OsmPoint[]> {
  return overpassQuery(`
    [out:json][timeout:180];
    (
      node["landuse"="quarry"](${DRC_BBOX});
      way["landuse"="quarry"](${DRC_BBOX});
      node["man_made"~"mineshaft|mine|adit"](${DRC_BBOX});
    );
    out center;
  `, 'sites miniers RDC')
}
