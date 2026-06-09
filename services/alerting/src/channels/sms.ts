/**
 * Canal SMS pour les alertes officielles SINAUR-RDC.
 * Utilise la file sms_queue déjà présente en DB (insérée via apps/api).
 * Traite les SMS en attente et les envoie via le gateway configuré.
 */
import { logger } from '../logger.js'
import { config } from '../config.js'
import { sql } from '../db.js'
import axios from 'axios'

export interface SmsMessage {
  id: string
  phoneNumber: string
  message: string
  alertId?: string
}

async function sendViaSmsGateway(phone: string, message: string): Promise<boolean> {
  if (!config.smsGatewayUrl) {
    logger.debug({ phone }, 'SMS gateway not configured — SMS logged only')
    logger.info({ phone, message: message.slice(0, 50) }, 'SMS (dry-run)')
    return true
  }

  try {
    await axios.post(
      config.smsGatewayUrl,
      { to: phone, message },
      {
        headers: { Authorization: `Bearer ${config.smsGatewayApiKey}` },
        timeout: 10_000,
      },
    )
    return true
  } catch (e: any) {
    logger.warn({ phone, err: e.message }, 'SMS gateway request failed')
    return false
  }
}

/**
 * Traite les SMS en attente dans la file sms_queue.
 * Appelé périodiquement par le scheduler.
 */
export async function processSmsQueue(): Promise<void> {
  const pending = await sql<{ id: string; toPhone: string; message: string; attempts: number }[]>`
    SELECT id, to_phone, message, attempts
    FROM sms_queue
    WHERE status = 'pending'
      AND attempts < 3
      AND scheduled_at <= NOW()
    ORDER BY created_at ASC
    LIMIT 50
  `

  if (pending.length === 0) return

  logger.info({ count: pending.length }, 'Processing SMS queue')

  for (const sms of pending) {
    const ok = await sendViaSmsGateway(sms.toPhone, sms.message)

    if (ok) {
      await sql`
        UPDATE sms_queue
        SET status = 'sent', sent_at = NOW()
        WHERE id = ${sms.id}
      `
    } else {
      await sql`
        UPDATE sms_queue
        SET attempts = attempts + 1,
            last_error = 'SMS gateway failed',
            status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'pending' END
        WHERE id = ${sms.id}
      `
    }
  }
}

/**
 * Enfile un SMS d'alerte officielle pour les gestionnaires de la zone concernée.
 */
export async function enqueueSmsAlert(
  headline: string,
  instruction: string,
  pcode: string,
  alertId: string,
): Promise<void> {
  // Récupérer les numéros de téléphone des gestionnaires de la zone
  const recipients = await sql<{ phone: string }[]>`
    SELECT phone
    FROM users
    WHERE phone IS NOT NULL
      AND is_active = true
      AND role IN ('national_decision_maker', 'provincial_coordinator', 'field_agent')
      AND (
        geographic_scope_pcodes IS NULL
        OR geographic_scope_pcodes = '{}'
        OR EXISTS (
          SELECT 1 FROM unnest(geographic_scope_pcodes) AS scope
          WHERE ${pcode} LIKE scope || '%'
          OR scope LIKE ${pcode} || '%'
        )
      )
    LIMIT 100
  `

  if (recipients.length === 0) return

  const message = `[SINAUR-RDC] ${headline}\n${instruction}\nRéf: ${alertId.slice(0, 8)}`
  const truncated = message.slice(0, 160)

  for (const { phone } of recipients) {
    await sql`
      INSERT INTO sms_queue (to_phone, message, status)
      VALUES (${phone}, ${truncated}, 'pending')
    `
  }

  logger.info({ pcode, alertId, count: recipients.length }, 'SMS alert enqueued')
}
