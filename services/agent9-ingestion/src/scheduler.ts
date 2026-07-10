import cron from 'node-cron'
import { config } from './config.js'
import { logger } from './logger.js'
import { fetchAllUcdpEvents }  from './connectors/ucdp.js'
import { fetchAllAcledEvents } from './connectors/acled.js'
import { normalizeUcdpEvent, normalizeAcledEvent, upsertIncidents } from './normalizer.js'
import { runScoringCycle }       from './scorer.js'
import { runVulnerabilityCycle } from './vulnerability.js'

export interface IngestionResult {
  source:     string
  fetched:    number
  skipped:    number
  inserted:   number
  durationMs: number
}

// ─── UCDP (sans clé — actif par défaut) ──────────────────────────────────────

export async function runUcdpIngestion(): Promise<IngestionResult> {
  const t0 = Date.now()
  const dateTo   = new Date()
  const dateFrom = new Date(Date.now() - config.ACLED_LOOKBACK_HOURS * 3_600_000)

  const raw        = await fetchAllUcdpEvents(dateFrom, dateTo)
  const normalized = await Promise.all(raw.map(r => normalizeUcdpEvent(r)))
  const valid      = normalized.filter((n): n is NonNullable<typeof n> => n !== null)
  const inserted   = await upsertIncidents(valid)

  return {
    source: 'ucdp', fetched: raw.length,
    skipped: raw.length - valid.length, inserted,
    durationMs: Date.now() - t0,
  }
}

// ─── ACLED (avec clé — activé automatiquement si ACLED_API_KEY est défini) ───

export async function runAcledIngestion(): Promise<IngestionResult> {
  const t0 = Date.now()
  const dateTo   = new Date()
  const dateFrom = new Date(Date.now() - config.ACLED_LOOKBACK_HOURS * 3_600_000)

  const raw        = await fetchAllAcledEvents(dateFrom, dateTo)
  const normalized = await Promise.all(raw.map(r => normalizeAcledEvent(r)))
  const valid      = normalized.filter((n): n is NonNullable<typeof n> => n !== null)
  const inserted   = await upsertIncidents(valid)

  return {
    source: 'acled', fetched: raw.length,
    skipped: raw.length - valid.length, inserted,
    durationMs: Date.now() - t0,
  }
}

// ─── Cycle principal : UCDP toujours + ACLED si clé disponible ───────────────

export async function runCycle(): Promise<void> {
  logger.info('Cycle d\'ingestion Agent 9 démarré')

  // UCDP — toujours actif (sans clé)
  try {
    const result = await runUcdpIngestion()
    logger.info(result, 'Ingestion UCDP terminée')
  } catch (err) {
    logger.error({ err }, 'Erreur ingestion UCDP')
  }

  // ACLED — activé uniquement si la clé est configurée
  if (config.ACLED_API_KEY) {
    try {
      const result = await runAcledIngestion()
      logger.info(result, 'Ingestion ACLED terminée')
    } catch (err) {
      logger.error({ err }, 'Erreur ingestion ACLED')
    }
  } else {
    logger.info('ACLED_API_KEY non défini — source ACLED ignorée')
  }

  // Scoring — toujours après ingestion
  try {
    const result = await runScoringCycle()
    logger.info(result, 'Scoring Agent 9 terminé')
  } catch (err) {
    logger.error({ err }, 'Erreur cycle de scoring')
  }
}

export function startScheduler(): void {
  void runCycle()

  // Vulnérabilité structurelle : une fois par semaine (dim. 02h00)
  // Exécution immédiate au démarrage pour initialiser zone_vulnerability
  void runVulnerabilityCycle()
  cron.schedule('0 2 * * 0', () => { void runVulnerabilityCycle() })

  const hours    = config.INGESTION_INTERVAL_HOURS
  const cronExpr = `0 */${hours} * * *`
  logger.info({ cronExpr }, 'Scheduler Agent 9 démarré (UCDP actif, ACLED si clé, vulnérabilité hebdo)')
  cron.schedule(cronExpr, () => { void runCycle() })
}
