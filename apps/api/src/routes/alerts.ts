/**
 * Routes de gestion des alertes CAP 1.2 — SINAUR-RDC.
 * Validation humaine obligatoire pour alertes critiques (spec §5).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from '../db.js'
import { requireAuth, requireRole, writeAuditLog } from '../auth/jwt.js'
import { broadcastAlert } from '../websocket/broadcast.js'
import { broadcastWebhookEvent } from './webhooks.js'

const CreateAlertSchema = z.object({
  hazardType: z.string(),
  level: z.enum(['low', 'medium', 'high', 'critical']),
  headline: z.string().min(10).max(200),
  description: z.string().min(20).max(2000),
  instruction: z.string().min(10).max(1000),
  pcode: z.string().regex(/^(CD\d{2}|COD)$/),
  expiresAt: z.string().datetime().optional(),
  aiAlertId: z.string().uuid().optional(),
})

const UpdateAlertSchema = z.object({
  status: z.enum(['actual', 'cancelled', 'expired']).optional(),
  instruction: z.string().min(10).max(1000).optional(),
})

export async function alertRoutes(fastify: FastifyInstance) {
  // Lister les alertes actives (filtrées par scope)
  fastify.get('/alerts', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.jwtUser
    const query = request.query as Record<string, string>
    const page = Math.max(1, parseInt(query.page ?? '1'))
    const limit = Math.min(100, parseInt(query.limit ?? '20'))
    const offset = (page - 1) * limit
    const status = query.status ?? 'actual'

    const isAdmin = user.role === 'system_admin' || user.role === 'national_decision_maker'

    const rows = await sql`
      SELECT
        id, identifier, sender, status, msg_type, scope,
        info, sent_at, validated_at, validated_by
      FROM cap_alerts
      WHERE status = ${status}
        ${isAdmin ? sql`` : sql`AND (info->>'pcode' = ANY(${user.scope}::text[]) OR ${user.scope}::text[] = '{}')`}
        ${query.pcode ? sql`AND info->>'pcode' = ${query.pcode}` : sql``}
      ORDER BY sent_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM cap_alerts WHERE status = ${status}
    `

    return reply.send({
      success: true,
      data: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  })

  // Détail d'une alerte avec deliveries
  fastify.get('/alerts/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const rows = await sql`
      SELECT
        ca.*,
        u.display_name AS validated_by_name,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'channel', ad.channel,
              'recipientCount', ad.recipient_count,
              'status', ad.status,
              'deliveredAt', ad.delivered_at
            )
          ) FILTER (WHERE ad.id IS NOT NULL),
          '[]'
        ) AS deliveries
      FROM cap_alerts ca
      LEFT JOIN users u ON ca.validated_by = u.id
      LEFT JOIN alert_deliveries ad ON ad.alert_id = ca.id
      WHERE ca.id = ${id}::uuid
      GROUP BY ca.id, u.display_name
    `
    if (rows.length === 0) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Alerte introuvable' } })
    }
    return reply.send({ success: true, data: rows[0] })
  })

  // Créer une alerte manuelle
  fastify.post('/alerts', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'provincial_coordinator')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const body = CreateAlertSchema.parse(request.body)
    const isCritical = body.level === 'critical'
    const alertStatus = isCritical ? 'pending_validation' : 'actual'
    const expiresAt = body.expiresAt ?? new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

    const [row] = await sql`
      INSERT INTO cap_alerts (
        identifier, sender, status, msg_type, scope, info, sent_at
      ) VALUES (
        ${'SINAUR-RDC-MANUAL-' + Date.now()},
        ${user.email ?? 'system'},
        ${alertStatus},
        'Alert',
        ${isCritical ? 'Restricted' : 'Public'},
        ${JSON.stringify({
          event: body.hazardType,
          headline: body.headline,
          description: body.description,
          instruction: body.instruction,
          pcode: body.pcode,
          hazardType: body.hazardType,
          level: body.level,
          expiresAt,
          aiAlertId: body.aiAlertId ?? null,
        })}::jsonb,
        NOW()
      )
      RETURNING id, identifier, status, info, sent_at
    `

    await writeAuditLog(user.sub, 'create_alert', 'cap_alerts', row.id, request, { level: body.level, pcode: body.pcode })

    if (!isCritical) broadcastAlert(row)

    return reply.status(201).send({
      success: true,
      data: row,
      message: isCritical
        ? 'Alerte créée. Validation humaine requise avant diffusion (niveau critique).'
        : 'Alerte créée et diffusée.',
    })
  })

  // Valider une alerte critique (decision_maker uniquement)
  fastify.patch('/alerts/:id/validate', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id } = request.params as { id: string }
    const body = z.object({
      action: z.enum(['approve', 'reject']),
      comment: z.string().max(500).optional(),
    }).parse(request.body)

    const rows = await sql`SELECT id, info, status FROM cap_alerts WHERE id = ${id}::uuid LIMIT 1`
    if (rows.length === 0) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Alerte introuvable' } })
    }
    if (rows[0].status !== 'pending_validation') {
      return reply.status(409).send({ success: false, error: { code: 'CONFLICT', message: 'Alerte non en attente de validation' } })
    }

    const newStatus = body.action === 'approve' ? 'actual' : 'cancelled'

    const [updated] = await sql`
      UPDATE cap_alerts
      SET status = ${newStatus},
          validated_by = ${user.sub}::uuid,
          validated_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING id, status, info, validated_at
    `

    await writeAuditLog(user.sub, `alert_${body.action}`, 'cap_alerts', id, request, { comment: body.comment })

    if (body.action === 'approve') {
      broadcastAlert(updated)
      // Notifier les partenaires humanitaires via webhooks
      void broadcastWebhookEvent('alert.published', {
        alertId:   id,
        severity:  updated.info?.severity ?? 'Unknown',
        headline:  updated.info?.headline ?? '',
        pcode:     updated.info?.pcode    ?? '',
        validatedAt: updated.validatedAt,
      })
      try {
        const { default: axios } = await import('axios')
        await axios.post(
          `${process.env.ALERTING_SERVICE_URL ?? 'http://alerting:3001'}/dispatch/${id}`,
          {},
          { timeout: 5000 },
        )
      } catch (e) {
        fastify.log.warn({ alertId: id, err: e }, 'Could not trigger alerting dispatch')
      }
    }

    return reply.send({
      success: true,
      data: updated,
      message: body.action === 'approve' ? 'Alerte validée et diffusée.' : 'Alerte rejetée.',
    })
  })

  // Annuler / mettre à jour une alerte
  fastify.patch('/alerts/:id', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'provincial_coordinator')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id } = request.params as { id: string }
    const body = UpdateAlertSchema.parse(request.body)

    const rows = await sql`SELECT id, status FROM cap_alerts WHERE id = ${id}::uuid LIMIT 1`
    if (rows.length === 0) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Alerte introuvable' } })
    }

    const [updated] = await sql`
      UPDATE cap_alerts
      SET
        status = COALESCE(${body.status ?? null}, status),
        info = CASE WHEN ${body.instruction ?? null} IS NOT NULL
                    THEN info || ${JSON.stringify({ instruction: body.instruction })}::jsonb
                    ELSE info END
      WHERE id = ${id}::uuid
      RETURNING id, status, info, sent_at
    `

    await writeAuditLog(user.sub, 'update_alert', 'cap_alerts', id, request, body)

    return reply.send({ success: true, data: updated })
  })

  // Alertes en attente de validation
  fastify.get('/alerts/pending-validation', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker')],
  }, async (_request, reply) => {
    const rows = await sql`
      SELECT id, identifier, info, sent_at
      FROM cap_alerts
      WHERE status = 'pending_validation'
      ORDER BY sent_at ASC
    `
    return reply.send({ success: true, data: rows, count: rows.length })
  })
}
