/**
 * Canal push FCM (Firebase Cloud Messaging) pour SINAUR-RDC.
 * Firebase est utilisé UNIQUEMENT pour les notifications push (§ architecture).
 */
import { logger } from '../logger.js'
import { config } from '../config.js'
import { sql } from '../db.js'

let adminApp: any = null

async function getFirebaseAdmin() {
  if (adminApp) return adminApp
  try {
    const { initializeApp, cert, getApps } = await import('firebase-admin/app')
    const { getMessaging } = await import('firebase-admin/messaging')

    if (getApps().length > 0) {
      adminApp = { messaging: getMessaging() }
      return adminApp
    }

    let credential: any
    if (config.firebaseServiceAccountPath) {
      const { readFileSync } = await import('fs')
      const serviceAccount = JSON.parse(
        readFileSync(config.firebaseServiceAccountPath, 'utf8')
      )
      credential = cert(serviceAccount)
    } else {
      // Application Default Credentials (Cloud Run / GCE)
      const { applicationDefault } = await import('firebase-admin/app')
      credential = applicationDefault()
    }

    const app = initializeApp({ credential, projectId: config.firebaseProjectId })
    adminApp = { messaging: getMessaging(app) }
    return adminApp
  } catch (e) {
    logger.warn({ err: e }, 'Firebase Admin init failed — push disabled')
    return null
  }
}

export interface PushPayload {
  alertId: string
  title: string
  body: string
  hazardType: string
  level: string
  pcode: string
  capXml?: string
}

/**
 * Envoie une notification push à tous les tokens FCM ciblés par le P-code.
 * Cible : utilisateurs dont geographic_scope_pcodes contient le pcode ou un préfixe.
 */
export async function sendPushAlert(payload: PushPayload): Promise<void> {
  const firebase = await getFirebaseAdmin()
  if (!firebase) {
    logger.warn('Push skipped: Firebase not initialized')
    return
  }

  // Tokens depuis sync_devices (appareils mobiles enregistrés)
  // Ciblage géographique : devices dont location_scope couvre le pcode de l'alerte
  const deviceTokenRows: { pushToken: string }[] = await sql`
    SELECT DISTINCT sd.push_token
    FROM sync_devices sd
    JOIN users u ON u.id = sd.user_id
    WHERE sd.push_token IS NOT NULL
      AND u.is_active = true
      AND u.deleted_at IS NULL
      AND (
        sd.location_scope IS NULL
        OR sd.location_scope = '{}'
        OR EXISTS (
          SELECT 1 FROM unnest(sd.location_scope) AS scope
          WHERE ${payload.pcode} LIKE scope || '%'
             OR scope LIKE ${payload.pcode} || '%'
        )
      )
    LIMIT 500
  `

  if (deviceTokenRows.length === 0) {
    logger.info({ pcode: payload.pcode }, 'No FCM tokens for zone — push skipped')
    return
  }

  const fcmTokens = deviceTokenRows.map(t => t.pushToken)

  const message = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: {
      alertId: payload.alertId,
      hazardType: payload.hazardType,
      level: payload.level,
      pcode: payload.pcode,
      type: 'SINAUR_ALERT',
    },
    android: {
      priority: payload.level === 'critical' || payload.level === 'high' ? 'high' as const : 'normal' as const,
      notification: {
        channelId: 'sinaur_alerts',
        priority: payload.level === 'critical' ? 'max' as const : 'high' as const,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: payload.level === 'critical' ? 'critical_alert.caf' : 'default',
          contentAvailable: true,
        },
      },
    },
    tokens: fcmTokens,
  }

  try {
    const response = await firebase.messaging.sendEachForMulticast(message)
    logger.info({
      alertId: payload.alertId,
      successCount: response.successCount,
      failureCount: response.failureCount,
      totalTokens: fcmTokens.length,
    }, 'Push notifications sent')

    // Enregistrer les livraisons
    await sql`
      INSERT INTO alert_deliveries (alert_id, channel, recipient_count, status, delivered_at)
      VALUES (${payload.alertId}::uuid, 'push', ${response.successCount}, 'delivered', NOW())
    `

    // Nettoyer les tokens invalides (404 → token révoqué sur sync_devices)
    const invalidTokens = response.responses
      .map((r, i) => ({ r, token: fcmTokens[i] }))
      .filter(({ r }) => !r.success && r.error?.code === 'messaging/registration-token-not-registered')
      .map(({ token }) => token)

    if (invalidTokens.length > 0) {
      await sql`
        UPDATE sync_devices SET push_token = NULL
        WHERE push_token = ANY(${invalidTokens})
      `
      logger.info({ count: invalidTokens.length }, 'Cleaned up invalid FCM tokens from sync_devices')
    }
  } catch (e) {
    logger.error({ err: e, alertId: payload.alertId }, 'FCM send failed')
  }
}

export interface StockLowPayload {
  stockId: string
  resourceName: string
  unit: string
  quantityAvailable: number
  minimumThreshold: number
  depotId: string
  depotName: string
  pcode: string
}

const STOCK_ROLES = ['system_admin', 'national_decision_maker', 'provincial_coordinator', 'humanitarian_partner']

/**
 * Notifie les acteurs humanitaires (par rôle + scope géographique) qu'un stock est passé sous le seuil.
 */
export async function sendPushStockAlert(payload: StockLowPayload): Promise<void> {
  const firebase = await getFirebaseAdmin()
  if (!firebase) {
    logger.warn('Stock push skipped: Firebase not initialized')
    return
  }

  const tokenRows: { pushToken: string }[] = await sql`
    SELECT DISTINCT sd.push_token
    FROM sync_devices sd
    JOIN users u ON u.id = sd.user_id
    WHERE sd.push_token IS NOT NULL
      AND u.is_active = true
      AND u.deleted_at IS NULL
      AND u.role = ANY(${STOCK_ROLES})
      AND (
        u.scope IS NULL
        OR u.scope = '{}'
        OR EXISTS (
          SELECT 1 FROM unnest(u.scope) AS s
          WHERE ${payload.pcode} LIKE s || '%'
             OR s LIKE ${payload.pcode} || '%'
        )
      )
    LIMIT 500
  `

  if (tokenRows.length === 0) {
    logger.info({ pcode: payload.pcode, depotId: payload.depotId }, 'No FCM tokens for stock alert — skipped')
    return
  }

  const tokens = tokenRows.map(t => t.pushToken)
  const gap = payload.quantityAvailable - payload.minimumThreshold

  const message = {
    notification: {
      title: `⚠️ Stock critique — ${payload.depotName}`,
      body: `${payload.resourceName} : ${payload.quantityAvailable} ${payload.unit} (seuil : ${payload.minimumThreshold}, écart : ${gap})`,
    },
    data: {
      type: 'SINAUR_STOCK_LOW',
      stockId: payload.stockId,
      depotId: payload.depotId,
      pcode: payload.pcode,
      resourceName: payload.resourceName,
      quantityAvailable: String(payload.quantityAvailable),
      minimumThreshold: String(payload.minimumThreshold),
    },
    android: {
      priority: 'high' as const,
      notification: { channelId: 'sinaur_alerts', priority: 'high' as const },
    },
    apns: {
      payload: { aps: { sound: 'default', contentAvailable: true } },
    },
    tokens,
  }

  try {
    const response = await firebase.messaging.sendEachForMulticast(message)
    logger.info({
      depotId: payload.depotId,
      resourceName: payload.resourceName,
      successCount: response.successCount,
      failureCount: response.failureCount,
    }, 'Stock low push notifications sent')

    const invalidTokens = response.responses
      .map((r: any, i: number) => ({ r, token: tokens[i] }))
      .filter(({ r }: any) => !r.success && r.error?.code === 'messaging/registration-token-not-registered')
      .map(({ token }: any) => token)

    if (invalidTokens.length > 0) {
      await sql`UPDATE sync_devices SET push_token = NULL WHERE push_token = ANY(${invalidTokens})`
    }
  } catch (e) {
    logger.error({ err: e, depotId: payload.depotId }, 'Stock FCM send failed')
  }
}
