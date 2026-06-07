/**
 * Routes webhooks — notifications sortantes vers partenaires humanitaires.
 * Accès CRUD : system_admin uniquement.
 * Dispatch : appelé lors de la publication d'une alerte.
 */
import type { FastifyInstance } from 'fastify'
import { createHmac, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { sql } from '../db.js'
import { requireAuth, requireRole, writeAuditLog } from '../auth/jwt.js'
import pino from 'pino'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'api-webhooks' } })

const VALID_EVENTS = ['alert.published', 'alert.critical', 'crisis.created', 'event.created'] as const

const CreateWebhookSchema = z.object({
  agencyName: z.string().min(2).max(100),
  url:        z.string().url(),
  events:     z.array(z.enum(VALID_EVENTS)).min(1).default(['alert.published']),
})

const UpdateWebhookSchema = z.object({
  agencyName: z.string().min(2).max(100).optional(),
  url:        z.string().url().optional(),
  events:     z.array(z.enum(VALID_EVENTS)).optional(),
  isActive:   z.boolean().optional(),
})

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Liste des webhooks ─────────────────────────────────────────────────────
  fastify.get('/admin/webhooks', {
    preHandler: [requireAuth, requireRole('system_admin')],
  }, async () => {
    const rows = await sql`
      SELECT id, agency_name, url, events, is_active,
             last_fired_at, last_status, failure_count, created_at
      FROM webhooks
      ORDER BY created_at DESC
    `
    return { success: true, data: rows }
  })

  // ── Créer un webhook ───────────────────────────────────────────────────────
  fastify.post('/admin/webhooks', {
    preHandler: [requireAuth, requireRole('system_admin')],
  }, async (request, reply) => {
    const body   = CreateWebhookSchema.parse(request.body)
    const admin  = request.jwtUser
    const secret = randomBytes(32).toString('hex')

    const [wh] = await sql`
      INSERT INTO webhooks (agency_name, url, secret, events, created_by)
      VALUES (${body.agencyName}, ${body.url}, ${secret}, ${sql.array(body.events)}, ${admin.sub})
      RETURNING id, agency_name, url, events, is_active, created_at
    `

    await writeAuditLog(admin.sub, 'WEBHOOK_CREATED', 'webhooks', wh.id, request, {
      agencyName: body.agencyName, url: body.url,
    })

    // Retourner le secret UNE SEULE FOIS à la création (jamais ensuite)
    return reply.status(201).send({ success: true, data: { ...wh, secret } })
  })

  // ── Modifier un webhook ────────────────────────────────────────────────────
  fastify.patch('/admin/webhooks/:id', {
    preHandler: [requireAuth, requireRole('system_admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body   = UpdateWebhookSchema.parse(request.body)
    const admin  = request.jwtUser

    const [updated] = await sql`
      UPDATE webhooks SET
        agency_name = COALESCE(${body.agencyName ?? null}, agency_name),
        url         = COALESCE(${body.url         ?? null}, url),
        events      = COALESCE(${body.events ? sql.array(body.events) : null}, events),
        is_active   = COALESCE(${body.isActive    ?? null}, is_active)
      WHERE id = ${id}
      RETURNING id, agency_name, url, events, is_active, failure_count
    `
    if (!updated) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND' } })

    await writeAuditLog(admin.sub, 'WEBHOOK_UPDATED', 'webhooks', id, request, body)
    return { success: true, data: updated }
  })

  // ── Supprimer un webhook ───────────────────────────────────────────────────
  fastify.delete('/admin/webhooks/:id', {
    preHandler: [requireAuth, requireRole('system_admin')],
  }, async (request, reply) => {
    const { id }  = request.params as { id: string }
    const admin   = request.jwtUser

    const [deleted] = await sql`
      DELETE FROM webhooks WHERE id = ${id} RETURNING id, agency_name
    `
    if (!deleted) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND' } })

    await writeAuditLog(admin.sub, 'WEBHOOK_DELETED', 'webhooks', id, request, { agencyName: deleted.agencyName })
    return { success: true, data: { id } }
  })

  // ── Test d'un webhook ──────────────────────────────────────────────────────
  fastify.post('/admin/webhooks/:id/test', {
    preHandler: [requireAuth, requireRole('system_admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const [wh] = await sql`SELECT id, url, secret FROM webhooks WHERE id = ${id}`
    if (!wh) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND' } })

    const testPayload = {
      event:     'webhook.test',
      timestamp: new Date().toISOString(),
      data:      { message: 'Test de webhook SINAUR-RDC', webhookId: id },
    }

    const { ok, statusCode } = await dispatchWebhook(wh.url, wh.secret, 'webhook.test', testPayload)
    return { success: true, data: { ok, statusCode } }
  })
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export interface WebhookPayload {
  event:     string
  timestamp: string
  data:      Record<string, unknown>
}

async function dispatchWebhook(
  url: string,
  secret: string,
  event: string,
  payload: WebhookPayload,
): Promise<{ ok: boolean; statusCode: number | null }> {
  const body      = JSON.stringify(payload)
  const signature = createHmac('sha256', secret).update(body).digest('hex')
  const start     = Date.now()

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':       'application/json',
        'X-Sinaur-Event':     event,
        'X-Sinaur-Signature': `sha256=${signature}`,
        'User-Agent':         'SINAUR-RDC-Webhook/1.0',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    })
    return { ok: res.ok, statusCode: res.status }
  } catch (e: any) {
    logger.warn({ url, event, err: e.message }, 'Webhook delivery failed')
    return { ok: false, statusCode: null }
  } finally {
    void sql`
      INSERT INTO webhook_deliveries (webhook_id, event, payload, duration_ms)
      VALUES (
        (SELECT id FROM webhooks WHERE url = ${url} LIMIT 1),
        ${event}, ${JSON.stringify(payload)}::jsonb, ${Date.now() - start}
      )
    `.catch(() => {})
  }
}

/**
 * Diffuse un événement vers tous les webhooks actifs qui l'ont souscrit.
 * Appelé par les routes d'alertes / crises lors des transitions de statut.
 */
export async function broadcastWebhookEvent(
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const webhooks = await sql<{ id: string; url: string; secret: string }[]>`
    SELECT id, url, secret FROM webhooks
    WHERE is_active = true AND ${event} = ANY(events)
  `

  if (webhooks.length === 0) return

  const payload: WebhookPayload = { event, timestamp: new Date().toISOString(), data }

  const results = await Promise.allSettled(
    webhooks.map(wh => dispatchWebhook(wh.url, wh.secret, event, payload)),
  )

  // Mettre à jour last_fired_at et failure_count
  for (let i = 0; i < webhooks.length; i++) {
    const r = results[i]
    const wh = webhooks[i]
    if (r.status === 'fulfilled') {
      const { ok, statusCode } = r.value
      await sql`
        UPDATE webhooks SET
          last_fired_at = NOW(),
          last_status   = ${statusCode},
          failure_count = CASE WHEN ${ok} THEN 0 ELSE failure_count + 1 END,
          is_active     = CASE WHEN failure_count >= 10 THEN FALSE ELSE is_active END
        WHERE id = ${wh.id}
      `.catch(() => {})
    }
  }

  logger.info({ event, count: webhooks.length }, 'Webhook broadcast complete')
}
