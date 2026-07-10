import { sql } from './db.js'
import { logger } from './logger.js'

interface ScoringWeights {
  historique_violences:         number
  importance_economique:        number
  ressources_naturelles:        number
  importance_geographique:      number
  evolution_recente_incidents:  number
  signaux_declarations_publics: number
  vulnerabilite_populations:    number
}

interface RiskScore {
  pcode:                 string
  score:                 number
  level:                 'FAIBLE' | 'MOYEN' | 'ELEVE' | 'CRITIQUE'
  confidence:            'FAIBLE' | 'MODEREE' | 'FORTE'
  uncertaintyLow:        number
  uncertaintyHigh:       number
  topFactors:            Array<{ factor: string; contribution: number; direction: 'up' }>
  horizonDays:           number
  incidentCount:         number
  scoreHistorique:       number
  scoreEconomique:       number
  scoreRessources:       number
  scoreGeographique:     number
  scoreEvolution:        number
  scoreSignauxPublics:   number
  scoreVulnerabilite:    number
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  historique_violences:         0.25,
  importance_economique:        0.15,
  ressources_naturelles:        0.15,
  importance_geographique:      0.15,
  evolution_recente_incidents:  0.15,
  signaux_declarations_publics: 0.10,
  vulnerabilite_populations:    0.05,
}

function scoreToLevel(score: number): 'FAIBLE' | 'MOYEN' | 'ELEVE' | 'CRITIQUE' {
  if (score >= 75) return 'CRITIQUE'
  if (score >= 50) return 'ELEVE'
  if (score >= 25) return 'MOYEN'
  return 'FAIBLE'
}

function computeConfidence(count: number, reliability: number): 'FAIBLE' | 'MODEREE' | 'FORTE' {
  if (count >= 10 && reliability >= 0.80) return 'FORTE'
  if (count >= 3  || reliability >= 0.70) return 'MODEREE'
  return 'FAIBLE'
}

async function getActiveWeights(): Promise<ScoringWeights> {
  try {
    const [row] = await sql<{ weights: ScoringWeights }[]>`
      SELECT weights FROM scoring_weights_agent9 WHERE is_active = TRUE LIMIT 1
    `
    return (row?.weights as ScoringWeights) ?? DEFAULT_WEIGHTS
  } catch {
    return DEFAULT_WEIGHTS
  }
}

async function computeScoreForPcode(
  pcode: string,
  horizonDays: number,
  weights: ScoringWeights,
  globalMax: { count: number; fatalities: number },
): Promise<RiskScore | null> {
  const now      = new Date()
  const dateFrom = new Date(now.getTime() - horizonDays * 86_400_000).toISOString().slice(0, 10)
  const datePrev = new Date(now.getTime() - horizonDays * 2 * 86_400_000).toISOString().slice(0, 10)
  const sigFrom  = new Date(now.getTime() - horizonDays * 86_400_000)

  // ── Score historique ──────────────────────────────────────────────────────
  const [hist] = await sql<{ cnt: string; fat: string; rel: string }[]>`
    SELECT
      COUNT(*)::text                               AS cnt,
      COALESCE(SUM(fatalities), 0)::text           AS fat,
      COALESCE(AVG(source_reliability), 0.5)::text AS rel
    FROM violence_incidents
    WHERE pcode_2 = ${pcode}
      AND event_date >= ${dateFrom}::date
  `

  const incidentCount  = parseInt(hist?.cnt ?? '0', 10)
  const totalFat       = parseInt(hist?.fat  ?? '0', 10)
  const avgReliability = parseFloat(hist?.rel ?? '0.5')

  const maxCount = Math.max(globalMax.count, 1)
  const maxFat   = Math.max(globalMax.fatalities, 1)

  const scoreHistorique = Math.min(100,
    (incidentCount / maxCount * 0.6 + totalFat / maxFat * 0.4) * avgReliability * 100
  )

  // ── Score évolution ───────────────────────────────────────────────────────
  const [prev] = await sql<{ cnt: string }[]>`
    SELECT COUNT(*)::text AS cnt
    FROM violence_incidents
    WHERE pcode_2 = ${pcode}
      AND event_date >= ${datePrev}::date
      AND event_date <  ${dateFrom}::date
  `
  const prevCount = parseInt(prev?.cnt ?? '0', 10)

  let scoreEvolution: number
  if (prevCount > 0) {
    scoreEvolution = Math.min(100, Math.max(0, (incidentCount / prevCount - 1) * 50 + 50))
  } else if (incidentCount > 0) {
    scoreEvolution = 75
  } else {
    scoreEvolution = 0
  }

  // ── Vulnérabilité structurelle ────────────────────────────────────────────
  const [vuln] = await sql`
    SELECT
      score_composite  AS vuln,
      score_economique AS eco,
      score_ressources AS res,
      score_geographique AS geo
    FROM zone_vulnerability
    WHERE pcode = ${pcode}
  `

  const scoreVulnerabilite = parseFloat(vuln?.vuln ?? '0')
  const scoreEconomique    = parseFloat(vuln?.eco  ?? '0')
  const scoreRessources    = parseFloat(vuln?.res  ?? '0')
  const scoreGeographique  = parseFloat(vuln?.geo  ?? '0')

  // ── Signaux publics ───────────────────────────────────────────────────────
  const [sigs] = await sql<{ hostile: string; tension: string }[]>`
    SELECT
      COUNT(*) FILTER (WHERE signal_type = 'DECLARATION_HOSTILE')::text AS hostile,
      COUNT(*) FILTER (WHERE signal_type = 'TENSION_MONTANTE')::text    AS tension
    FROM public_signals
    WHERE ${pcode} = ANY(pcodes_mentioned)
      AND published_at >= ${sigFrom}
  `
  const scoreSignauxPublics = Math.min(100,
    parseInt(sigs?.hostile ?? '0', 10) * 30 +
    parseInt(sigs?.tension ?? '0', 10) * 15
  )

  // ── Score composite ───────────────────────────────────────────────────────
  const score = Math.min(100, Math.max(0,
    weights.historique_violences         * scoreHistorique      +
    weights.importance_economique        * scoreEconomique       +
    weights.ressources_naturelles        * scoreRessources       +
    weights.importance_geographique      * scoreGeographique     +
    weights.evolution_recente_incidents  * scoreEvolution        +
    weights.signaux_declarations_publics * scoreSignauxPublics   +
    weights.vulnerabilite_populations    * scoreVulnerabilite,
  ))

  // ── Top 3 facteurs ────────────────────────────────────────────────────────
  const topFactors = [
    { factor: 'historique_violences',         contribution: weights.historique_violences         * scoreHistorique },
    { factor: 'evolution_recente_incidents',  contribution: weights.evolution_recente_incidents  * scoreEvolution },
    { factor: 'importance_economique',        contribution: weights.importance_economique        * scoreEconomique },
    { factor: 'ressources_naturelles',        contribution: weights.ressources_naturelles        * scoreRessources },
    { factor: 'importance_geographique',      contribution: weights.importance_geographique      * scoreGeographique },
    { factor: 'signaux_declarations_publics', contribution: weights.signaux_declarations_publics * scoreSignauxPublics },
    { factor: 'vulnerabilite_populations',    contribution: weights.vulnerabilite_populations    * scoreVulnerabilite },
  ]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map(f => ({ factor: f.factor, contribution: parseFloat(f.contribution.toFixed(2)), direction: 'up' as const }))

  const margin        = incidentCount >= 10 ? 0.05 : incidentCount >= 3 ? 0.10 : 0.20
  const uncertaintyLow  = parseFloat(Math.max(0,   score * (1 - margin)).toFixed(2))
  const uncertaintyHigh = parseFloat(Math.min(100, score * (1 + margin)).toFixed(2))

  return {
    pcode,
    score:              parseFloat(score.toFixed(2)),
    level:              scoreToLevel(score),
    confidence:         computeConfidence(incidentCount, avgReliability),
    uncertaintyLow,
    uncertaintyHigh,
    topFactors,
    horizonDays,
    incidentCount,
    scoreHistorique:      parseFloat(scoreHistorique.toFixed(2)),
    scoreEconomique:      parseFloat(scoreEconomique.toFixed(2)),
    scoreRessources:      parseFloat(scoreRessources.toFixed(2)),
    scoreGeographique:    parseFloat(scoreGeographique.toFixed(2)),
    scoreEvolution:       parseFloat(scoreEvolution.toFixed(2)),
    scoreSignauxPublics:  parseFloat(scoreSignauxPublics.toFixed(2)),
    scoreVulnerabilite:   parseFloat(scoreVulnerabilite.toFixed(2)),
  }
}

function buildRecommendedActions(rs: RiskScore): Array<{ code: string; priority: number; description: string }> {
  const actions: Array<{ code: string; priority: number; description: string }> = []

  actions.push(rs.level === 'CRITIQUE'
    ? { code: 'ALERTE_URGENTE',          priority: 1, description: 'Alerter immédiatement les autorités de protection civile et les acteurs humanitaires présents dans la zone' }
    : { code: 'ALERTE_PROTECTION_CIVILE', priority: 1, description: 'Informer les autorités de protection civile et les acteurs humanitaires présents dans la zone' }
  )

  if (rs.scoreHistorique > 60) {
    actions.push({ code: 'SUIVI_RAPPROCHE', priority: 2, description: 'Renforcer le suivi des incidents dans cette zone pour les 7 prochains jours' })
  }
  if (rs.scoreEvolution > 70) {
    actions.push({ code: 'ALERTE_TENDANCE', priority: 2, description: 'Aggravation significative détectée — surveiller les flux de déplacés et l\'accès humanitaire' })
  }

  return actions
}

// ── Point d'entrée du cycle de scoring ───────────────────────────────────────

export async function runScoringCycle(): Promise<{ zones: number; scored: number; alertsCreated: number }> {
  logger.info('Cycle de scoring Agent 9 démarré')

  const weights = await getActiveWeights()

  const activePcodes = await sql<{ pcode2: string }[]>`
    SELECT DISTINCT pcode_2
    FROM violence_incidents
    WHERE pcode_2 IS NOT NULL
      AND event_date >= NOW() - INTERVAL '90 days'
  `

  if (activePcodes.length === 0) {
    logger.info('Aucune zone active — scoring ignoré')
    return { zones: 0, scored: 0, alertsCreated: 0 }
  }

  const [globalMaxRow] = await sql<{ maxcount: string; maxfat: string }[]>`
    SELECT
      MAX(cnt)::text AS maxcount,
      MAX(fat)::text AS maxfat
    FROM (
      SELECT pcode_2, COUNT(*) AS cnt, COALESCE(SUM(fatalities), 0) AS fat
      FROM violence_incidents
      WHERE pcode_2 IS NOT NULL AND event_date >= NOW() - INTERVAL '90 days'
      GROUP BY pcode_2
    ) sub
  `
  const globalMax = {
    count:      parseInt(globalMaxRow?.maxcount ?? '1', 10),
    fatalities: parseInt(globalMaxRow?.maxfat   ?? '1', 10),
  }

  let scored = 0
  let alertsCreated = 0

  for (const row of activePcodes) {
    const pcode = row.pcode2
    for (const horizonDays of [7, 30, 90] as const) {
      try {
        const rs = await computeScoreForPcode(pcode, horizonDays, weights, globalMax)
        if (!rs) continue

        const [inserted] = await sql<{ id: string; level: string }[]>`
          INSERT INTO risk_scores_agent9 (
            pcode, score, level, confidence,
            uncertainty_low, uncertainty_high,
            top_factors, horizon_days, model_version,
            score_historique, score_economique, score_ressources,
            score_geographique, score_evolution, score_signaux_publics, score_vulnerabilite,
            requires_validation
          ) VALUES (
            ${pcode}, ${rs.score}, ${rs.level}, ${rs.confidence},
            ${rs.uncertaintyLow}, ${rs.uncertaintyHigh},
            ${rs.topFactors}, ${horizonDays}, '1.0.0',
            ${rs.scoreHistorique}, ${rs.scoreEconomique}, ${rs.scoreRessources},
            ${rs.scoreGeographique}, ${rs.scoreEvolution}, ${rs.scoreSignauxPublics},
            ${rs.scoreVulnerabilite}, TRUE
          )
          RETURNING id, level
        `
        scored++

        if (inserted && (inserted.level === 'ELEVE' || inserted.level === 'CRITIQUE')) {
          const oneDayAgo = new Date(Date.now() - 86_400_000)
          const [existing] = await sql`
            SELECT a.id FROM agent9_alerts a
            JOIN risk_scores_agent9 rs ON rs.id = a.risk_score_id
            WHERE a.pcode = ${pcode}
              AND a.statut = 'PENDING_VALIDATION'
              AND rs.horizon_days = ${horizonDays}
              AND a.created_at >= ${oneDayAgo}
            LIMIT 1
          `
          if (!existing) {
            await sql`
              INSERT INTO agent9_alerts (risk_score_id, pcode, level, statut, recommended_actions)
              VALUES (${inserted.id}, ${pcode}, ${rs.level}, 'PENDING_VALIDATION', ${buildRecommendedActions(rs)})
            `
            alertsCreated++
          }
        }
      } catch (err) {
        logger.warn({ err, pcode, horizonDays }, 'Erreur scoring pcode')
      }
    }
  }

  logger.info({ zones: activePcodes.length, scored, alertsCreated }, 'Cycle de scoring terminé')
  return { zones: activePcodes.length, scored, alertsCreated }
}
