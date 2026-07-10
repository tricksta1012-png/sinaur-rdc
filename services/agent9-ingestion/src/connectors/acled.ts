import axios from 'axios'
import { config } from '../config.js'
import { logger } from '../logger.js'

export interface AcledRawEvent {
  event_id_cnty:  string
  event_date:     string   // YYYY-MM-DD
  event_type:     string
  sub_event_type: string
  actor1:         string
  actor2:         string
  admin1:         string   // Province (ex: "North Kivu")
  admin2:         string   // Territoire
  admin3:         string   // Secteur / Groupement
  location:       string   // Localité
  latitude:       string
  longitude:      string
  geo_precision:  string   // 1=point exact, 2=chef-lieu district, 3=chef-lieu province
  source:         string
  notes:          string
  fatalities:     string
  timestamp:      string
}

interface AcledApiResponse {
  success:  boolean
  count:    number
  data:     AcledRawEvent[]
  messages?: unknown
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function fetchAcledEvents(
  dateFrom: Date,
  dateTo: Date,
  page = 1,
): Promise<AcledRawEvent[]> {
  const params = new URLSearchParams({
    key:              config.ACLED_API_KEY,
    email:            config.ACLED_EMAIL,
    country:          'Democratic Republic of Congo',
    event_date_where: 'BETWEEN',
    event_date:       `${isoDate(dateFrom)}|${isoDate(dateTo)}`,
    limit:            '1000',
    page:             String(page),
    fields:           [
      'event_id_cnty','event_date','event_type','sub_event_type',
      'actor1','actor2','admin1','admin2','admin3','location',
      'latitude','longitude','geo_precision','source','notes','fatalities','timestamp',
    ].join('|'),
  })

  // Filtre provincial optionnel — vide = toute la RDC
  if (config.ACLED_PILOT_PROVINCE) {
    params.set('admin1', config.ACLED_PILOT_PROVINCE)
  }

  const scope = config.ACLED_PILOT_PROVINCE || 'RDC entière'
  const url = `https://api.acleddata.com/acled/read?${params}`
  logger.info({ dateFrom: isoDate(dateFrom), dateTo: isoDate(dateTo), page, scope }, 'Fetching ACLED')

  const res = await axios.get<AcledApiResponse>(url, {
    timeout: 30_000,
    headers: { 'User-Agent': 'SINAUR-RDC/1.0 (humanitarian-protection-system)' },
  })

  if (!res.data.success) {
    throw new Error(`ACLED API returned success=false: ${JSON.stringify(res.data.messages ?? '')}`)
  }

  logger.info({ count: res.data.count, page }, 'ACLED page fetched')
  return res.data.data ?? []
}

// Récupère toutes les pages si > 1000 événements
export async function fetchAllAcledEvents(dateFrom: Date, dateTo: Date): Promise<AcledRawEvent[]> {
  const all: AcledRawEvent[] = []
  let page = 1

  while (true) {
    const batch = await fetchAcledEvents(dateFrom, dateTo, page)
    all.push(...batch)
    if (batch.length < 1000) break
    page++
  }

  logger.info({ total: all.length }, 'ACLED fetch complete')
  return all
}
