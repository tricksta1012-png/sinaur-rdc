/**
 * Routes API pour les données USSD/SMS — consultation et export.
 * Les rapports sont créés par le service USSD (:3002) ; ces routes
 * permettent au dashboard de les consulter et de gérer les abonnements.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { writeAuditLog } from '../middleware/audit.js'

export async function ussdRoutes(fastify: FastifyInstance) {

  // ── Rapports USSD ─────────────────────────────────────────────────────────

  fastify.get('/ussd/reports', {
    preHandler: [requireAuth, requireRole('admin', 'territory_admin', 'humanitarian_partner')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const q = request.query as Record<string, string>

    const page  = Math.max(1, parseInt(q.page ?? '1'))
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '20')))
    const offset = (page - 1) * limit

    const rows = await sql`
      SELECT
        r.id,
        r.hazard_type,
        r.location_pcode,
        r.location_free,
        r.source_ref,
        r.locale,
        r.created_at,
        d.name_fr AS location_name,
        r.disaster_event_id
      FROM ussd_reports r
      LEFT JOIN admin_divisions d ON d.pcode = r.location_pcode
      ORDER BY r.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM ussd_reports`

    await writeAuditLog(user.sub, 'list', 'ussd_reports', null, request, { page, limit })

    return { success: true, data: rows, meta: { total, page, limit } }
  })

  fastify.get('/ussd/reports/:id', {
    preHandler: [requireAuth, requireRole('admin', 'territory_admin', 'humanitarian_partner')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id } = request.params as { id: string }

    const [report] = await sql`
      SELECT
        r.*,
        d.name_fr AS location_name,
        d.level   AS location_level
      FROM ussd_reports r
      LEFT JOIN admin_divisions d ON d.pcode = r.location_pcode
      WHERE r.id = ${id}
    `

    if (!report) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND' } })

    await writeAuditLog(user.sub, 'read', 'ussd_reports', id, request, {})

    return { success: true, data: report }
  })

  // ── Abonnements SMS ───────────────────────────────────────────────────────

  fastify.get('/ussd/subscriptions', {
    preHandler: [requireAuth, requireRole('admin', 'territory_admin')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const q = request.query as Record<string, string>

    const page  = Math.max(1, parseInt(q.page ?? '1'))
    const limit = Math.min(200, Math.max(1, parseInt(q.limit ?? '50')))
    const offset = (page - 1) * limit

    const rows = await sql`
      SELECT
        s.id,
        s.phone_number,
        s.location_pcode,
        s.locale,
        s.active,
        s.subscribed_at,
        s.unsubscribed_at,
        d.name_fr AS location_name
      FROM sms_alert_subscriptions s
      LEFT JOIN admin_divisions d ON d.pcode = s.location_pcode
      ORDER BY s.subscribed_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM sms_alert_subscriptions`

    await writeAuditLog(user.sub, 'list', 'sms_alert_subscriptions', null, request, { page })

    return { success: true, data: rows, meta: { total, page, limit } }
  })

  // Statistiques USSD pour le dashboard
  fastify.get('/ussd/stats', {
    preHandler: [requireAuth],
  }, async (request) => {
    const [reports, sessions, subs] = await Promise.all([
      sql`SELECT COUNT(*)::int AS total FROM ussd_reports`,
      sql`SELECT COUNT(*)::int AS total FROM ussd_sessions`,
      sql`SELECT COUNT(*)::int AS total FROM sms_alert_subscriptions WHERE active = TRUE`,
    ])

    const byHazard = await sql`
      SELECT hazard_type, COUNT(*)::int AS count
      FROM ussd_reports
      GROUP BY hazard_type
      ORDER BY count DESC
    `

    const byLocale = await sql`
      SELECT locale, COUNT(*)::int AS count
      FROM ussd_reports
      GROUP BY locale
      ORDER BY count DESC
    `

    return {
      success: true,
      data: {
        totalReports: reports[0].total,
        totalSessions: sessions[0].total,
        activeSubscriptions: subs[0].total,
        byHazard,
        byLocale,
      },
    }
  })
}
