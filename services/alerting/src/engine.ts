/**
 * Moteur d'alerting SINAUR-RDC.
 *
 * Cycle :
 *  1. Interroger le service AI pour les scores de risque à jour
 *  2. Pour chaque score dépassant le seuil → créer une alerte CAP 1.2
 *  3. Diffuser via push (FCM) + SMS (file)
 *  4. Les alertes "critical" sont créées avec status='pending_validation'
 *     → validation humaine obligatoire avant diffusion publique (§5 spec)
 */
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import { logger } from './logger.js'
import { config } from './config.js'
import { sql } from './db.js'
import {
  buildCAPAlert, riskLevelToCAP,
  HAZARD_CATEGORY_MAP, HAZARD_LABEL_FR,
  type CAPAlertInput,
} from './cap/builder.js'
import { sendPushAlert } from './channels/push.js'
import { enqueueSmsAlert, processSmsQueue } from './channels/sms.js'

interface RiskScore {
  pcode: string
  hazardType: string
  horizon: string
  score: number
  level: string
  uncertainty: number
}

async function fetchRiskScores(): Promise<RiskScore[]> {
  try {
    const res = await axios.get(`${config.aiBaseUrl}/predictions/risk-map`, {
      params: { horizon: '30d' },
      timeout: 15_000,
    })
    return (res.data as any[]).filter(r => r.score >= config.autoAlertScoreThreshold)
  } catch (e: any) {
    logger.warn({ err: e.message }, 'Could not fetch risk scores from AI service')
    return []
  }
}

async function getProvinceName(pcode: string): Promise<string> {
  const rows = await sql<{ nameFr: string }[]>`
    SELECT name_fr FROM admin_divisions WHERE pcode = ${pcode} LIMIT 1
  `
  return rows[0]?.nameFr ?? pcode
}

async function alertAlreadyExists(pcode: string, hazardType: string): Promise<boolean> {
  // Éviter de créer plusieurs alertes pour la même situation dans les 24h
  const rows = await sql`
    SELECT id FROM cap_alerts
    WHERE info->>'areaDesc' LIKE ${'%' + pcode + '%'}
      AND info->>'event' LIKE ${'%' + (HAZARD_LABEL_FR[hazardType] ?? hazardType) + '%'}
      AND status NOT IN ('expired', 'cancelled')
      AND sent_at >= NOW() - INTERVAL '24 hours'
    LIMIT 1
  `
  return rows.length > 0
}

async function createAndDispatchAlert(score: RiskScore): Promise<void> {
  const hazardLabel = HAZARD_LABEL_FR[score.hazardType] ?? score.hazardType
  const provinceName = await getProvinceName(score.pcode)
  const cap = riskLevelToCAP(score.level)

  const isCritical = score.level === 'critical'
  // §5 spec : validation humaine obligatoire pour les alertes critiques
  const alertStatus = isCritical ? 'pending_validation' : 'actual'

  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  const alertId = uuidv4()

  const headline = `Risque ${score.level.toUpperCase()} — ${hazardLabel} — ${provinceName}`
  const description =
    `Score de risque IA : ${score.score}/100 (horizon ${score.horizon}).\n` +
    `Niveau : ${score.level}. Incertitude : ${Math.round(score.uncertainty * 100)}%.\n` +
    `Province concernée : ${provinceName} (${score.pcode}).`
  const instruction = isCritical
    ? 'ALERTE CRITIQUE — En attente de validation par autorité compétente. Préparer les équipes d\'intervention.'
    : `Surveiller la situation. Préparer les plans de contingence pour ${hazardLabel.toLowerCase()}.`

  const capInput: CAPAlertInput = {
    identifier: `SINAUR-RDC-${alertId}`,
    sender: 'sinaur-rdc@dgssrdc.gov.cd',
    status: isCritical ? 'System' : 'Actual',
    msgType: 'Alert',
    scope: isCritical ? 'Restricted' : 'Public',
    info: {
      category: HAZARD_CATEGORY_MAP[score.hazardType] ?? 'Other',
      event: hazardLabel,
      urgency: cap.urgency,
      severity: cap.severity,
      certainty: cap.certainty,
      expires: expiresAt,
      headline,
      description,
      instruction,
      area: {
        areaDesc: `${provinceName}, République Démocratique du Congo`,
        geocodes: [{ valueName: 'PCODE', value: score.pcode }],
      },
      parameters: {
        'AI_SCORE': String(score.score),
        'AI_HORIZON': score.horizon,
        'AI_UNCERTAINTY': String(Math.round(score.uncertainty * 100)),
        'HAZARD_TYPE': score.hazardType,
        'VALIDATION_REQUIRED': String(isCritical),
      },
    },
  }

  const capXml = buildCAPAlert(capInput)

  // Stocker l'alerte en base
  await sql`
    INSERT INTO cap_alerts (id, identifier, sender, status, msg_type, scope, info, cap_xml, sent_at)
    VALUES (
      ${alertId}::uuid,
      ${`SINAUR-RDC-${alertId}`},
      'sinaur-rdc@dgssrdc.gov.cd',
      ${alertStatus},
      'Alert',
      ${isCritical ? 'Restricted' : 'Public'},
      ${JSON.stringify({
        event: hazardLabel,
        headline,
        description,
        instruction,
        areaDesc: `${provinceName}, République Démocratique du Congo`,
        pcode: score.pcode,
        hazardType: score.hazardType,
        aiScore: score.score,
        aiHorizon: score.horizon,
        level: score.level,
      })}::jsonb,
      ${capXml},
      NOW()
    )
  `

  logger.info({ alertId, pcode: score.pcode, hazardType: score.hazardType, level: score.level, isCritical }, 'Alert created')

  // Les alertes critiques attendent la validation humaine → pas de diffusion immédiate
  if (isCritical) {
    logger.warn({ alertId, pcode: score.pcode }, 'Critical alert pending human validation — not dispatched')
    return
  }

  // Diffusion push + SMS pour les alertes non-critiques
  await Promise.all([
    sendPushAlert({
      alertId,
      title: `Alerte ${hazardLabel}`,
      body: `${headline} — Score: ${score.score}/100`,
      hazardType: score.hazardType,
      level: score.level,
      pcode: score.pcode,
      capXml,
    }),
    enqueueSmsAlert(headline, instruction, score.pcode, alertId),
  ])
}

/**
 * Cycle principal du moteur d'alerting.
 * Appelé par le scheduler toutes les heures.
 */
export async function runAlertingCycle(): Promise<void> {
  logger.info('Starting alerting cycle')

  const scores = await fetchRiskScores()
  logger.info({ count: scores.length }, 'Risk scores above threshold')

  let created = 0
  let skipped = 0

  for (const score of scores) {
    try {
      const exists = await alertAlreadyExists(score.pcode, score.hazardType)
      if (exists) {
        skipped++
        continue
      }
      await createAndDispatchAlert(score)
      created++
    } catch (e) {
      logger.error({ err: e, pcode: score.pcode, hazardType: score.hazardType }, 'Alert creation failed')
    }
  }

  // Traiter la file SMS en attente
  await processSmsQueue()

  logger.info({ created, skipped }, 'Alerting cycle complete')
}

/**
 * Diffuse une alerte critique après validation humaine.
 * Appelé depuis l'API backend (PATCH /alerts/:id/validate).
 */
export async function dispatchValidatedAlert(alertId: string): Promise<void> {
  const rows = await sql<{
    id: string; info: any; capXml: string
  }[]>`
    SELECT id, info, cap_xml FROM cap_alerts
    WHERE id = ${alertId}::uuid AND status = 'pending_validation'
    LIMIT 1
  `
  if (rows.length === 0) {
    throw new Error(`Alert ${alertId} not found or not pending validation`)
  }

  const alert = rows[0]
  const info = alert.info

  await sql`
    UPDATE cap_alerts SET status = 'actual', validated_at = NOW() WHERE id = ${alertId}::uuid
  `

  await Promise.all([
    sendPushAlert({
      alertId,
      title: `ALERTE CRITIQUE — ${info.event ?? 'Aléa'}`,
      body: info.headline ?? `Alerte validée pour ${info.pcode}`,
      hazardType: info.hazardType ?? 'unknown',
      level: 'critical',
      pcode: info.pcode ?? 'COD',
      capXml: alert.capXml,
    }),
    enqueueSmsAlert(
      info.headline ?? 'Alerte critique validée',
      'ACTION IMMÉDIATE REQUISE. Alerter les équipes terrain.',
      info.pcode ?? 'COD',
      alertId,
    ),
  ])

  logger.info({ alertId }, 'Validated critical alert dispatched')
}
