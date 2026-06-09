/**
 * Connecteur GDACS (Global Disaster Alert and Coordination System).
 * Flux GeoRSS public : https://www.gdacs.org/xml/rss.xml
 * Filtre sur la RDC (Congo, DRC, CD) et insère dans disaster_events.
 */
import axios from 'axios'
import { XMLParser } from 'fast-xml-parser'
import { logger } from '../logger.js'
import { sql } from '../db.js'

const GDACS_RSS_URL = 'https://www.gdacs.org/xml/rss.xml'

const DRC_KEYWORDS = [
  'Congo', 'DRC', 'Democratic Republic', 'Kinshasa',
  'Nord-Kivu', 'Sud-Kivu', 'Ituri', 'Katanga', 'Kasai',
]

const ALERT_LEVEL_MAP: Record<string, string> = {
  Green:  'Minor',
  Orange: 'Moderate',
  Red:    'Severe',
}

const HAZARD_TYPE_MAP: Record<string, string> = {
  EQ:  'earthquake',
  FL:  'flood',
  TC:  'other',             // tropical_cyclone absent de l'enum
  VO:  'volcanic_eruption',
  WF:  'fire',              // wildfire → fire
  DR:  'drought',
  LS:  'landslide',
}

interface GdacsItem {
  title:              string
  description:        string
  link:               string
  pubDate:            string
  'gdacs:alertlevel'?: string
  'gdacs:eventtype'?: string
  'gdacs:country'?:   string
  'gdacs:iso3'?:      string
  'gdacs:glide'?:     string
  'gdacs:severity'?:  Record<string, string>
  'geo:Point'?:       { 'geo:lat': number; 'geo:long': number }
}

function isDRC(item: GdacsItem): boolean {
  const iso3    = item['gdacs:iso3'] ?? ''
  const country = item['gdacs:country'] ?? ''
  const title   = item.title ?? ''
  const desc    = item.description ?? ''

  if (iso3 === 'COD') return true
  return DRC_KEYWORDS.some(k =>
    country.includes(k) || title.includes(k) || desc.includes(k),
  )
}

export async function fetchGdacsAlerts(): Promise<number> {
  logger.info('Fetching GDACS RSS feed')

  let xml: string
  try {
    const res = await axios.get<string>(GDACS_RSS_URL, {
      timeout: 15_000,
      headers: { 'User-Agent': 'SINAUR-RDC-Ingestion/1.0' },
      responseType: 'text',
    })
    xml = res.data
  } catch (e: any) {
    logger.warn({ err: e.message }, 'GDACS fetch failed')
    return 0
  }

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
  let feed: any
  try {
    feed = parser.parse(xml)
  } catch (e: any) {
    logger.warn({ err: e.message }, 'GDACS XML parse failed')
    return 0
  }

  const items: GdacsItem[] = feed?.rss?.channel?.item ?? []
  const drcItems = items.filter(isDRC)

  logger.info({ total: items.length, drc: drcItems.length }, 'GDACS items filtered for DRC')

  let inserted = 0
  for (const item of drcItems) {
    try {
      const hazardType = HAZARD_TYPE_MAP[item['gdacs:eventtype'] ?? ''] ?? 'other'
      const severity   = ALERT_LEVEL_MAP[item['gdacs:alertlevel'] ?? ''] ?? 'Unknown'
      const lat        = item['geo:Point']?.['geo:lat']  ?? null
      const lng        = item['geo:Point']?.['geo:long'] ?? null
      const reportedAt = item.pubDate ? new Date(item.pubDate) : new Date()
      const glideRef   = typeof item['gdacs:glide'] === 'string' ? item['gdacs:glide'] : null

      // Éviter les doublons par lien source
      const [existing] = await sql`
        SELECT id FROM disaster_events WHERE source_url = ${item.link} LIMIT 1
      `
      if (existing) continue

      const locationPoint = lat !== null && lng !== null
        ? sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`
        : sql`NULL`

      await sql`
        INSERT INTO disaster_events (
          hazard_type, severity, title, description,
          location_point, source, source_url, source_ref,
          location_pcode, location_name, location_level,
          glide_number, start_date, status,
          tags
        ) VALUES (
          ${hazardType}::hazard_type,
          ${severity}::alert_severity,
          ${item.title.slice(0, 255)},
          ${item.description?.slice(0, 1000) ?? ''},
          ${locationPoint},
          'other'::event_source,
          ${item.link},
          ${'GDACS'},
          'COD',
          'République Démocratique du Congo',
          0,
          ${glideRef},
          ${reportedAt},
          'under_review',
          ARRAY['GDACS', ${hazardType}, ${item['gdacs:alertlevel'] ?? 'unknown'}]
        )
      `
      inserted++
    } catch (e: any) {
      logger.warn({ err: e.message, title: item.title }, 'GDACS item insert failed')
    }
  }

  logger.info({ inserted }, 'GDACS connector complete')
  return inserted
}
