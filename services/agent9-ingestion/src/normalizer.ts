import type { AcledRawEvent } from './connectors/acled.js'
import type { UcdpRawEvent }  from './connectors/ucdp.js'
import { sql }    from './db.js'
import { logger } from './logger.js'

// ─── Structure normalisée commune aux deux sources ────────────────────────────

export interface NormalizedIncident {
  sourceId:          string
  sourceType:        'acled' | 'ucdp'
  sourceUrl:         string
  eventDate:         string
  lng:               number
  lat:               number
  pcode2:            string | null
  eventType:         string
  targetType:        string
  consequenceTypes:  string[]
  estimatedAffected: number | null
  fatalities:        number
  sourceReliability: number
  rawText:           string
}

// ─── Résolution pcode par coordonnées GPS (PostGIS) ──────────────────────────

async function resolvePcode(lat: number, lng: number): Promise<string | null> {
  try {
    const rows = await sql<{ pcode: string }[]>`
      SELECT pcode
      FROM admin_divisions
      WHERE level = 2
        AND geometry IS NOT NULL
        AND ST_Contains(
          geometry,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
        )
      LIMIT 1
    `
    return rows[0]?.pcode ?? null
  } catch {
    return null
  }
}

// ─── Détection du type de cible depuis un texte libre ────────────────────────

const TARGET_KEYWORDS: Array<{ keywords: string[]; target: string }> = [
  { keywords: ['hospital','hôpital','clinic','santé','health center'], target: 'infra_sante' },
  { keywords: ['school','école','ecole','université'],                  target: 'ecole' },
  { keywords: ['camp','idp','déplacé','displaced','refugee'],           target: 'camp_idp' },
  { keywords: ['market','marché','marche'],                             target: 'marche' },
  { keywords: ['church','mosque','lieu de culte','prayer'],             target: 'lieu_culte' },
  { keywords: ['government','administration','bureau'],                 target: 'infra_admin' },
]

function detectTargetType(text: string): string {
  const lower = text.toLowerCase()
  for (const { keywords, target } of TARGET_KEYWORDS) {
    if (keywords.some(k => lower.includes(k))) return target
  }
  return 'civils'
}

// ═══════════════════════════════════════════════════════════════════════════════
// NORMALIZER UCDP
// Source fiable : données peer-reviewed Uppsala University / PRIO — sans clé API
// type_of_violence: 1=conflit armé état, 2=conflit non-étatique, 3=violence unilatérale
// ═══════════════════════════════════════════════════════════════════════════════

const UCDP_RELIABILITY = 0.94

// Précision géographique UCDP : 1=point exact, 2=village, 3=district → OK
// 4=province, 5=pays → trop imprécis, on rejette
const UCDP_MAX_GEO_PRECISION = 3

function ucdpEventType(raw: UcdpRawEvent): string {
  // Violence unilatérale (type 3) = directement contre civils
  if (raw.type_of_violence === 3) return 'violence_civils'
  // Conflits armés avec victimes civiles documentées
  if (raw.deaths_civilians > 0)   return 'violence_civils'
  // Conflits avec victimes non précisées — impact civil possible
  return 'autre'
}

export async function normalizeUcdpEvent(
  raw: UcdpRawEvent,
): Promise<NormalizedIncident | null> {
  // Rejeter si précision géographique insuffisante (province/pays)
  if (raw.where_prec > UCDP_MAX_GEO_PRECISION) return null

  const eventType = ucdpEventType(raw)
  if (eventType === 'autre') return null

  if (isNaN(raw.latitude) || isNaN(raw.longitude)) return null

  const pcode2 = await resolvePcode(raw.latitude, raw.longitude)
  const fatalities = raw.deaths_civilians > 0 ? raw.deaths_civilians : raw.best

  const consequenceTypes: string[] = []
  if (fatalities > 0) consequenceTypes.push('VICTIMES')

  const text = [raw.source_headline, raw.source_original, raw.where_description]
    .filter(Boolean).join(' ')

  if (/displace|déplac|fuit|fuite/i.test(text))         consequenceTypes.push('DEPLACEMENT')
  if (/destruct|pillage|loot|brûl|incendi/i.test(text)) consequenceTypes.push('DESTRUCTION')
  if (/kidna|enlev|abduct/i.test(text))                  consequenceTypes.push('ENLEVEMENT')

  return {
    sourceId:          String(raw.id),
    sourceType:        'ucdp',
    sourceUrl:         `https://ucdp.uu.se/event/${raw.id}`,
    eventDate:         raw.date_start.slice(0, 10),
    lng:               raw.longitude,
    lat:               raw.latitude,
    pcode2,
    eventType,
    targetType:        detectTargetType(text),
    consequenceTypes,
    estimatedAffected: null,
    fatalities,
    sourceReliability: UCDP_RELIABILITY,
    rawText:           text.slice(0, 2000),
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NORMALIZER ACLED (disponible dès que la clé est obtenue)
// ═══════════════════════════════════════════════════════════════════════════════

const ACLED_RELIABILITY = 0.90

const ACLED_EVENT_TYPE_MAP: Record<string, string> = {
  'Violence against civilians': 'violence_civils',
  'Riots':                      'violence_civils',
  'Explosions/Remote violence': 'destruction_infra',
  'Battles':                    'autre',
  'Strategic developments':     'menace_publique',
  'Protests':                   'autre',
}

const ACLED_SUB_EVENT_MAP: Record<string, string> = {
  'Attack':                         'violence_civils',
  'Abduction/forced disappearance': 'violence_civils',
  'Sexual violence':                'violence_civils',
  'Mob violence':                   'violence_civils',
  'Looting/property destruction':   'pillage',
  'Forced displacement':            'deplacement',
  'Non-violent transfer of territory': 'menace_publique',
}

const ACLED_EXCLUDED_SUB_EVENTS = new Set([
  'Peaceful protest','Excessive force against protesters',
  'Protest with intervention','Government regains territory',
  'Non-violent transfer of territory','Headquarters or base established','Other',
])

export async function normalizeAcledEvent(
  raw: AcledRawEvent,
): Promise<NormalizedIncident | null> {
  if (ACLED_EXCLUDED_SUB_EVENTS.has(raw.sub_event_type)) return null

  const eventType = ACLED_SUB_EVENT_MAP[raw.sub_event_type]
    ?? ACLED_EVENT_TYPE_MAP[raw.event_type]
    ?? null
  if (!eventType || eventType === 'autre') return null

  const lat = parseFloat(raw.latitude)
  const lng = parseFloat(raw.longitude)
  if (isNaN(lat) || isNaN(lng)) {
    logger.warn({ eventId: raw.event_id_cnty }, 'Coordonnées invalides — ignoré')
    return null
  }

  const pcode2     = await resolvePcode(lat, lng)
  const fatalities = parseInt(raw.fatalities, 10) || 0

  const consequenceTypes: string[] = []
  if (fatalities > 0)                                    consequenceTypes.push('VICTIMES')
  if (/displace|déplac/i.test(raw.notes))               consequenceTypes.push('DEPLACEMENT')
  if (/destruct|loot|pillage|brûl/i.test(raw.notes))    consequenceTypes.push('DESTRUCTION')
  if (/kidna|enlev|abduct/i.test(raw.notes))             consequenceTypes.push('ENLEVEMENT')

  return {
    sourceId:          raw.event_id_cnty,
    sourceType:        'acled',
    sourceUrl:         `https://acleddata.com/data-export-tool/?filter_country=DRC&filter_id=${raw.event_id_cnty}`,
    eventDate:         raw.event_date,
    lng, lat, pcode2,
    eventType,
    targetType:        detectTargetType(raw.notes),
    consequenceTypes,
    estimatedAffected: null,
    fatalities,
    sourceReliability: ACLED_RELIABILITY,
    rawText:           raw.notes.slice(0, 2000),
  }
}

// ─── Insertion en base (UPSERT idempotent) ───────────────────────────────────

export async function upsertIncidents(incidents: NormalizedIncident[]): Promise<number> {
  if (incidents.length === 0) return 0
  let inserted = 0

  for (const inc of incidents) {
    try {
      const result = await sql`
        INSERT INTO violence_incidents (
          source_id, source_type, source_url, event_date,
          location, pcode_2,
          event_type, target_type, consequence_types,
          estimated_affected, fatalities, source_reliability, raw_text
        ) VALUES (
          ${inc.sourceId}, ${inc.sourceType}, ${inc.sourceUrl}, ${inc.eventDate},
          ST_SetSRID(ST_MakePoint(${inc.lng}, ${inc.lat}), 4326),
          ${inc.pcode2},
          ${inc.eventType}, ${inc.targetType}, ${inc.consequenceTypes},
          ${inc.estimatedAffected}, ${inc.fatalities}, ${inc.sourceReliability}, ${inc.rawText}
        )
        ON CONFLICT (source_type, source_id) DO UPDATE SET
          fatalities        = EXCLUDED.fatalities,
          raw_text          = EXCLUDED.raw_text,
          pcode_2           = COALESCE(violence_incidents.pcode_2, EXCLUDED.pcode_2),
          consequence_types = EXCLUDED.consequence_types,
          ingested_at       = NOW()
      `
      if (result.count > 0) inserted++
    } catch (err) {
      logger.warn({ err, sourceId: inc.sourceId }, 'Échec upsert — ignoré')
    }
  }

  return inserted
}
