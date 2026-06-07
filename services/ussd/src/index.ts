/**
 * Service USSD SINAUR-RDC — gateway HTTP pour les carriers mobiles.
 *
 * Compatible Africa's Talking USSD format (form-urlencoded POST) :
 *   sessionId, phoneNumber, serviceCode, text, networkCode
 *
 * Répond : "CON <menu>" (continue) ou "END <message>" (fin session).
 *
 * Accès sans smartphone : *777*SINAUR# → signalement d'événements,
 * consultation alertes, abonnement SMS — en 5 langues nationales RDC.
 */
import Fastify from 'fastify'
import fastifyFormbody from '@fastify/formbody'
import pino from 'pino'
import postgres from 'postgres'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import { handleUSSD, LOCALE_MAP, type Locale } from './menus.js'

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'ussd' },
})

const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://sinaur:sinaur_secret@localhost:5432/sinaur_rdc', {
  transform: postgres.camel,
  max: 5,
})

const API_URL = process.env.API_BASE_URL ?? 'http://api:3000'

const fastify = Fastify({ logger: false })
await fastify.register(fastifyFormbody)

// ── Santé ────────────────────────────────────────────────────────────────────

fastify.get('/health', async () => ({ status: 'ok', service: 'sinaur-ussd' }))

// ── Endpoint USSD principal (Africa's Talking format) ────────────────────────

fastify.post('/ussd', async (request, reply) => {
  const body = request.body as Record<string, string>
  const sessionId   = body.sessionId   ?? `mock-${uuidv4()}`
  const phoneNumber = body.phoneNumber ?? 'unknown'
  const text        = body.text        ?? ''

  logger.info({ sessionId, phoneNumber, text: text.slice(0, 100) }, 'USSD request')

  try {
    // Récupérer / créer la session
    let session = await getOrCreateSession(sessionId, phoneNumber)

    // Récupérer les alertes récentes pour la zone du numéro si dispo
    const alertCount = await getRecentAlertCount()
    const lastAlert = await getLastAlertSummary()

    // Traiter le menu
    const response = handleUSSD(
      { sessionId, phoneNumber, locale: session.locale as Locale },
      text,
      alertCount,
      lastAlert,
    )

    // Appliquer changement de langue si demandé
    if (response.newLocale) {
      await updateSessionLocale(sessionId, response.newLocale)
      await persistPhoneLocale(phoneNumber, response.newLocale)
    }

    // Si rapport confirmé → créer événement via API interne
    if (response.reportData?.confirmed) {
      const ref = extractRef(response.message)
      await createUSSDReport(sessionId, phoneNumber, session.locale as Locale, response.reportData, ref)
    }

    // Si abonnement SMS → créer souscription
    if (response.subscriptionData) {
      await createSMSSubscription(phoneNumber, response.subscriptionData.pcode, session.locale as Locale)
    }

    // Fermer la session si END
    if (response.type === 'END') {
      await closeSession(sessionId)
    }

    // Répondre en texte brut (format carrier)
    return reply
      .header('Content-Type', 'text/plain')
      .send(`${response.type} ${response.message}`)
  } catch (err) {
    logger.error({ err, sessionId }, 'USSD handler error')
    return reply
      .header('Content-Type', 'text/plain')
      .send('END Erreur système. Appelez le 117.')
  }
})

// ── Webhook SMS entrant (signalement par SMS) ────────────────────────────────
// Format attendu : "SINAUR FLOOD CD01 Description libre"

fastify.post('/sms', async (request, reply) => {
  const body = request.body as Record<string, string>
  const from    = body.from    ?? body.phoneNumber ?? 'unknown'
  const message = (body.text  ?? body.message ?? '').trim().toUpperCase()

  logger.info({ from, message: message.slice(0, 100) }, 'SMS received')

  if (!message.startsWith('SINAUR ')) {
    return reply.send('OK')
  }

  const parts = message.slice(7).split(' ')
  if (parts.length < 2) return reply.send('OK')

  const hazardRaw = parts[0].toLowerCase()
  const pcode     = parts[1].toUpperCase()
  const desc      = parts.slice(2).join(' ').toLowerCase() || undefined

  const HAZARD_SMS_MAP: Record<string, string> = {
    flood: 'flood', inondation: 'flood', mayi: 'flood',
    conflit: 'conflict', conflict: 'conflict', bitumba: 'conflict',
    epidemie: 'health_epidemic', epidemic: 'health_epidemic',
    deplacement: 'mass_displacement', displacement: 'mass_displacement',
    secheresse: 'drought', drought: 'drought',
    stop: '__stop__',
  }

  const hazardType = HAZARD_SMS_MAP[hazardRaw]
  if (!hazardType) return reply.send('OK')

  // SMS "STOP SINAUR" → désabonnement
  if (hazardRaw === 'stop') {
    await sql`UPDATE sms_alert_subscriptions SET active = FALSE, unsubscribed_at = NOW() WHERE phone_number = ${from}`
    return reply.send('OK')
  }

  try {
    const locale = await getPhoneLocale(from)
    await createUSSDReport(
      `sms-${uuidv4()}`, from, locale,
      { hazardType, locationInput: pcode, confirmed: true },
      'SMS-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      desc,
    )
    logger.info({ from, hazardType, pcode }, 'SMS report created')
  } catch (e) {
    logger.warn({ err: e, from }, 'SMS report creation failed')
  }

  return reply.send('OK')
})

// ── DB helpers ───────────────────────────────────────────────────────────────

async function getOrCreateSession(sessionId: string, phoneNumber: string) {
  const existing = await sql`
    SELECT session_id, locale FROM ussd_sessions
    WHERE session_id = ${sessionId} AND expires_at > NOW()
    LIMIT 1
  `
  if (existing.length > 0) {
    // Prolonger le TTL
    await sql`UPDATE ussd_sessions SET expires_at = NOW() + INTERVAL '5 minutes' WHERE session_id = ${sessionId}`
    return existing[0]
  }

  // Récupérer la langue préférée du numéro
  const phoneLocale = await getPhoneLocale(phoneNumber)

  await sql`
    INSERT INTO ussd_sessions (session_id, phone_number, locale, expires_at)
    VALUES (${sessionId}, ${phoneNumber}, ${phoneLocale}, NOW() + INTERVAL '5 minutes')
    ON CONFLICT (session_id) DO UPDATE SET expires_at = NOW() + INTERVAL '5 minutes'
  `
  return { sessionId, locale: phoneLocale }
}

async function updateSessionLocale(sessionId: string, locale: Locale) {
  await sql`UPDATE ussd_sessions SET locale = ${locale} WHERE session_id = ${sessionId}`
}

async function closeSession(sessionId: string) {
  await sql`UPDATE ussd_sessions SET completed_at = NOW() WHERE session_id = ${sessionId}`
}

async function persistPhoneLocale(phoneNumber: string, locale: Locale) {
  // Stocker la préférence langue dans la table des abonnements (si elle existe)
  await sql`
    INSERT INTO sms_alert_subscriptions (phone_number, location_pcode, locale)
    VALUES (${phoneNumber}, 'COD', ${locale})
    ON CONFLICT (phone_number, location_pcode) DO UPDATE SET locale = ${locale}
  `.catch(() => {}) // Silencieux si pcode COD n'existe pas encore
}

async function getPhoneLocale(phoneNumber: string): Promise<Locale> {
  const rows = await sql`
    SELECT locale FROM sms_alert_subscriptions
    WHERE phone_number = ${phoneNumber} AND active = TRUE
    ORDER BY subscribed_at DESC LIMIT 1
  `
  return (rows[0]?.locale as Locale) ?? 'fr'
}

async function getRecentAlertCount(): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS count FROM cap_alerts
    WHERE status = 'actual' AND sent_at >= NOW() - INTERVAL '48 hours'
  `
  return rows[0]?.count ?? 0
}

async function getLastAlertSummary(): Promise<string> {
  const rows = await sql`
    SELECT info->>'headline' AS headline FROM cap_alerts
    WHERE status = 'actual' ORDER BY sent_at DESC LIMIT 1
  `
  return rows[0]?.headline?.slice(0, 50) ?? 'Aucune alerte récente'
}

async function createUSSDReport(
  sessionId: string,
  phoneNumber: string,
  locale: Locale,
  data: { hazardType: string; locationInput: string; confirmed: boolean },
  ref: string,
  description?: string,
) {
  // Résoudre le pcode depuis le texte libre
  const pcode = data.locationInput.match(/^CD\d{2}$/i)
    ? data.locationInput.toUpperCase()
    : await resolvePcode(data.locationInput)

  const [report] = await sql`
    INSERT INTO ussd_reports (session_id, phone_number, hazard_type, location_pcode, location_free, description, locale, source_ref)
    VALUES (
      ${sessionId}, ${phoneNumber},
      ${data.hazardType}::hazard_type,
      ${pcode ?? null},
      ${pcode ? null : data.locationInput},
      ${description ?? null},
      ${locale},
      ${ref}
    )
    RETURNING id
  `

  // Créer aussi un événement via l'API interne (si pcode résolu)
  if (pcode) {
    try {
      await axios.post(`${API_URL}/events`, {
        title: `[USSD] ${data.hazardType} — ${pcode}`,
        description: description ?? 'Signalement via USSD',
        hazardType: data.hazardType,
        severity: 'Unknown',
        source: 'citizen',
        locationPcode: pcode,
        locationName: data.locationInput,
        locationLevel: 1,
        clientCreatedAt: new Date().toISOString(),
      }, { timeout: 5000, headers: { 'X-Internal-Service': 'ussd' } })
    } catch (e: any) {
      logger.warn({ err: e.message, ref }, 'Could not push USSD report to API')
    }
  }

  return report
}

async function createSMSSubscription(phoneNumber: string, pcode: string, locale: Locale) {
  await sql`
    INSERT INTO sms_alert_subscriptions (phone_number, location_pcode, locale)
    VALUES (${phoneNumber}, ${pcode}, ${locale})
    ON CONFLICT (phone_number, location_pcode) DO UPDATE SET active = TRUE, locale = ${locale}
  `.catch(e => logger.warn({ err: e.message }, 'SMS subscription failed'))
}

async function resolvePcode(locationText: string): Promise<string | null> {
  const rows = await sql`
    SELECT pcode FROM admin_divisions
    WHERE name_fr ILIKE ${locationText + '%'} OR name_local ILIKE ${locationText + '%'}
    ORDER BY level ASC LIMIT 1
  `
  return rows[0]?.pcode ?? null
}

function extractRef(message: string): string {
  const match = message.match(/USSD-[A-Z0-9]{6}/)
  return match?.[0] ?? 'USSD-UNKNOWN'
}

// ── Nettoyage sessions expirées (appelé toutes les 5min) ─────────────────────

setInterval(async () => {
  try {
    const { count } = await sql`
      DELETE FROM ussd_sessions WHERE expires_at < NOW() AND completed_at IS NULL
      RETURNING count(*)
    `.then(rows => rows[0] ?? { count: 0 })
    if (count > 0) logger.info({ count }, 'Expired USSD sessions cleaned')
  } catch {}
}, 5 * 60 * 1000)

// ── Démarrage ────────────────────────────────────────────────────────────────

async function start() {
  try {
    await fastify.listen({ port: 3002, host: '0.0.0.0' })
    logger.info('SINAUR-RDC USSD service listening on :3002')
  } catch (err) {
    logger.fatal({ err }, 'Failed to start USSD service')
    process.exit(1)
  }
}

process.on('SIGTERM', async () => { await sql.end(); process.exit(0) })
process.on('SIGINT',  async () => { await sql.end(); process.exit(0) })

start()
