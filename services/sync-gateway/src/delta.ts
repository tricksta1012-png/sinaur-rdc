/**
 * Sync delta — retourne les enregistrements modifiés depuis `since`.
 * Stratégie : lecture directe DB pour la performance, sans passer par l'API.
 * Données renvoyées : strictement publiques ou liées à l'agent (scope géographique).
 */
import type { Sql } from 'postgres'

const DELTA_LIMIT = 200 // max enregistrements par type par sync

export async function buildDelta(
  sql: Sql,
  since: Date,
  scopePcodes: string[],
  types: string[],
) {
  const result: Record<string, unknown[]> = {}

  const inScope = scopePcodes.length > 0
    ? scopePcodes.map(p => `${p}%`).join(',')
    : null

  // Alertes CAP publiques
  if (types.includes('alerts') || types.includes('all')) {
    result.alerts = await sql`
      SELECT
        identifier, sent_at, status, msg_type, scope,
        info->>'urgency'   AS urgency,
        info->>'severity'  AS severity,
        info->>'certainty' AS certainty,
        info->>'headline'  AS headline,
        info->>'event'     AS event_name,
        info->>'areaCode'  AS area_pcode
      FROM cap_alerts
      WHERE sent_at > ${since}
        AND scope = 'Public'
      ORDER BY sent_at DESC
      LIMIT ${DELTA_LIMIT}
    `
  }

  // Événements catastrophes (filtrés par scope si disponible)
  if (types.includes('events') || types.includes('all')) {
    if (inScope) {
      result.events = await sql`
        SELECT id, title, hazard_type, severity, status, source,
               location_pcode, created_at, updated_at
        FROM disaster_events
        WHERE updated_at > ${since}
          AND is_public = TRUE
          AND (${scopePcodes} IS NOT NULL
               AND location_pcode LIKE ANY(${sql.array(scopePcodes.map(p => `${p}%`))}))
        ORDER BY updated_at DESC
        LIMIT ${DELTA_LIMIT}
      `
    } else {
      result.events = await sql`
        SELECT id, title, hazard_type, severity, status, source,
               location_pcode, created_at, updated_at
        FROM disaster_events
        WHERE updated_at > ${since} AND is_public = TRUE
        ORDER BY updated_at DESC
        LIMIT ${DELTA_LIMIT}
      `
    }
  }

  // Divisions administratives (seulement si sync initial ou très ancien)
  const daysSince = (Date.now() - since.getTime()) / 864e5
  if ((types.includes('divisions') || types.includes('all')) && daysSince > 30) {
    result.divisions = await sql`
      SELECT pcode, name_fr, name_local, level, parent_pcode
      FROM admin_divisions
      ORDER BY level, pcode
      LIMIT 2000
    `
  }

  // Prédictions IA récentes (publiques uniquement)
  if (types.includes('predictions') || types.includes('all')) {
    result.predictions = await sql`
      SELECT id, hazard_type, location_pcode, risk_score, risk_level,
             prediction_date, generated_at
      FROM risk_predictions
      WHERE generated_at > ${since}
        AND prediction_date >= CURRENT_DATE
      ORDER BY generated_at DESC
      LIMIT 50
    `
  }

  return result
}
