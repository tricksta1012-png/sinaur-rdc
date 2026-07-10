import { sql }    from './db.js'
import { logger } from './logger.js'

// Calcule les agrégats comportementaux par territoire et fenêtre temporelle.
// Alimente behavioral_aggregates — utilisé pour les tendances et la carte de chaleur.

export async function runAggregatesCycle(): Promise<{ updated: number }> {
  logger.info('Cycle d\'agrégats comportementaux démarré')
  const now    = new Date()
  let updated  = 0

  for (const horizonDays of [7, 30, 90] as const) {
    const dateTo   = now.toISOString().slice(0, 10)
    const dateFrom = new Date(now.getTime() - horizonDays * 86_400_000).toISOString().slice(0, 10)
    const datePrev = new Date(now.getTime() - horizonDays * 2 * 86_400_000).toISOString().slice(0, 10)

    const rows = await sql<{
      pcode:           string
      incidentCount:   string
      intensityMedian: string | null
      prevCount:       string
      areaKm2:         string | null
      dominantTargets: string[]
    }[]>`
      WITH current_period AS (
        SELECT
          pcode_2                                                        AS pcode,
          COUNT(*)                                                       AS incident_count,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fatalities)       AS intensity_median
        FROM violence_incidents
        WHERE event_date >= ${dateFrom}::date
          AND event_date <= ${dateTo}::date
          AND pcode_2 IS NOT NULL
        GROUP BY pcode_2
      ),
      prev_period AS (
        SELECT pcode_2 AS pcode, COUNT(*) AS prev_count
        FROM violence_incidents
        WHERE event_date >= ${datePrev}::date
          AND event_date < ${dateFrom}::date
          AND pcode_2 IS NOT NULL
        GROUP BY pcode_2
      ),
      top_targets AS (
        SELECT
          pcode_2 AS pcode,
          (array_agg(target_type ORDER BY cnt DESC))[1:3] AS dominant_targets
        FROM (
          SELECT pcode_2, target_type, COUNT(*) AS cnt
          FROM violence_incidents
          WHERE event_date >= ${dateFrom}::date
            AND pcode_2 IS NOT NULL
            AND target_type IS NOT NULL
          GROUP BY pcode_2, target_type
        ) sub
        GROUP BY pcode_2
      )
      SELECT
        c.pcode,
        c.incident_count::text                              AS incident_count,
        c.intensity_median::text                            AS intensity_median,
        COALESCE(p.prev_count, 0)::text                    AS prev_count,
        (ST_Area(geography(ad.geometry)) / 1e6)::text      AS area_km2,
        COALESCE(t.dominant_targets, '{}'::text[])         AS dominant_targets
      FROM current_period c
      LEFT JOIN prev_period p     ON p.pcode = c.pcode
      LEFT JOIN admin_divisions ad ON ad.pcode = c.pcode AND ad.level = 2
      LEFT JOIN top_targets t     ON t.pcode = c.pcode
    `

    for (const r of rows) {
      const incCount  = parseInt(r.incidentCount, 10)
      const prevCount = parseInt(r.prevCount, 10)
      const areaKm2   = r.areaKm2 ? parseFloat(r.areaKm2) : null
      const density   = areaKm2 && areaKm2 > 0
        ? parseFloat((incCount / areaKm2).toFixed(4))
        : null
      const median    = r.intensityMedian ? parseFloat(parseFloat(r.intensityMedian).toFixed(2)) : null
      const trendPct  = prevCount > 0
        ? parseFloat(((incCount - prevCount) / prevCount * 100).toFixed(2))
        : null

      try {
        await sql`
          INSERT INTO behavioral_aggregates (
            pcode, period_start, period_end,
            incident_count, incident_density,
            dominant_targets, dominant_period,
            intensity_median, trend_pct_change,
            computed_at
          ) VALUES (
            ${r.pcode}, ${dateFrom}::date, ${dateTo}::date,
            ${incCount}, ${density},
            ${r.dominantTargets}, 'INDETERMINE',
            ${median}, ${trendPct},
            NOW()
          )
          ON CONFLICT (pcode, period_start, period_end) DO UPDATE SET
            incident_count   = EXCLUDED.incident_count,
            incident_density = EXCLUDED.incident_density,
            dominant_targets = EXCLUDED.dominant_targets,
            intensity_median = EXCLUDED.intensity_median,
            trend_pct_change = EXCLUDED.trend_pct_change,
            computed_at      = NOW()
        `
        updated++
      } catch (err) {
        logger.warn({ err, pcode: r.pcode, horizonDays }, 'Erreur upsert behavioral_aggregates')
      }
    }

    logger.info({ horizonDays, territories: rows.length }, 'Agrégats comportementaux calculés')
  }

  logger.info({ updated }, 'Cycle d\'agrégats terminé')
  return { updated }
}
