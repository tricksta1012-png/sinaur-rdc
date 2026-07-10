import axios from 'axios'
import { logger } from '../logger.js'

// UCDP Georeferenced Event Dataset (GED) — Candidate Events (mise à jour continue)
// Docs : https://ucdp.uu.se/apidocs/
// Aucune clé requise — données publiques Uppsala University / PRIO
const UCDP_BASE = 'https://ucdpapi.pcr.uu.se/api'
const UCDP_VERSION = 'candidate'   // "candidate" = données courantes non encore validées
const DRC_COUNTRY_ID = '490'       // Code COW (Correlates of War) pour la RDC

export interface UcdpRawEvent {
  id:                 number
  conflict_name:      string
  year:               number
  date_start:         string   // YYYY-MM-DD
  date_end:           string
  country:            string
  country_id:         string
  region:             string
  latitude:           number
  longitude:          number
  where_prec:         number   // 1=exact, 2=village, 3=district, 4=province, 5=pays
  where_description:  string
  deaths_a:           number
  deaths_b:           number
  deaths_civilians:   number
  deaths_unknown:     number
  best:               number   // estimation totale (utilisé comme fatalities)
  high:               number
  low:                number
  source_headline:    string
  source_original:    string
  type_of_violence:   number   // 1=conflit armé, 2=violence organisée, 3=violence unilatérale
}

interface UcdpApiResponse {
  Result:       UcdpRawEvent[]
  TotalCount:   number
  pagesize:     number
  page:         number
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function fetchUcdpEvents(
  dateFrom: Date,
  dateTo:   Date,
  page = 1,
): Promise<{ events: UcdpRawEvent[]; total: number }> {
  const params = new URLSearchParams({
    pagesize:   '1000',
    page:       String(page),
    Country:    DRC_COUNTRY_ID,
    StartDate:  isoDate(dateFrom),
    EndDate:    isoDate(dateTo),
  })

  const url = `${UCDP_BASE}/gedevents/${UCDP_VERSION}?${params}`
  logger.info({ dateFrom: isoDate(dateFrom), dateTo: isoDate(dateTo), page }, 'Fetching UCDP')

  const res = await axios.get<UcdpApiResponse>(url, {
    timeout: 30_000,
    headers: { 'User-Agent': 'SINAUR-RDC/1.0 (humanitarian-protection-system)' },
  })

  const events = res.data.Result ?? []
  const total  = res.data.TotalCount ?? events.length
  logger.info({ count: events.length, total, page }, 'UCDP page fetched')
  return { events, total }
}

export async function fetchAllUcdpEvents(dateFrom: Date, dateTo: Date): Promise<UcdpRawEvent[]> {
  const all: UcdpRawEvent[] = []
  let page = 1

  while (true) {
    const { events, total } = await fetchUcdpEvents(dateFrom, dateTo, page)
    all.push(...events)
    if (all.length >= total || events.length < 1000) break
    page++
  }

  logger.info({ total: all.length }, 'UCDP fetch complet')
  return all
}
