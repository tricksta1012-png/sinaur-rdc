/**
 * Gestion des crises humanitaires — numéros GLIDE, SitReps.
 * Accès : admin, national_decision_maker, territory_admin, humanitarian_partner.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from '../db.js'
import { requireAuth, requireRole, writeAuditLog } from '../auth/jwt.js'
import { broadcast } from '../websocket/broadcast.js'

const GLIDE_CODES: Record<string, string> = {
  flood:            'FL',
  conflict:         'CE',
  health_epidemic:  'EP',
  mass_displacement:'CE',
  drought:          'DR',
  other:            'OT',
}

async function generateGlideNumber(hazardType: string): Promise<string> {
  const year = new Date().getFullYear()
  const code = GLIDE_CODES[hazardType] ?? 'OT'
  const [{ seq }] = await sql`
    SELECT COUNT(*) + 1 AS seq FROM crisis_events
    WHERE EXTRACT(YEAR FROM start_date) = ${year}
  `
  return `${code}-${year}-${String(Number(seq)).padStart(6, '0')}-COD`
}

const CreateCrisisSchema = z.object({
  title:          z.string().min(3).max(200),
  hazardType:     z.string(),
  severity:       z.string().default('Unknown'),
  startDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  locationPcode:  z.string().optional(),
  affectedCount:  z.number().int().min(0).optional(),
  displacedCount: z.number().int().min(0).optional(),
  deathsCount:    z.number().int().min(0).optional(),
  description:    z.string().max(2000).optional(),
  responseLead:   z.string().max(200).optional(),
})

const UpdateCrisisSchema = z.object({
  title:          z.string().min(3).max(200).optional(),
  status:         z.enum(['active', 'contained', 'closed']).optional(),
  severity:       z.string().optional(),
  endDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  affectedCount:  z.number().int().min(0).optional(),
  displacedCount: z.number().int().min(0).optional(),
  deathsCount:    z.number().int().min(0).optional(),
  description:    z.string().max(2000).optional(),
  responseLead:   z.string().max(200).optional(),
})

const CreateSitRepSchema = z.object({
  title:       z.string().min(3).max(300),
  periodFrom:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodTo:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  content: z.object({
    overview:    z.string().optional(),
    needs:       z.string().optional(),
    response:    z.string().optional(),
    figures:     z.object({
      affected:    z.number().optional(),
      displaced:   z.number().optional(),
      injured:     z.number().optional(),
      deaths:      z.number().optional(),
    }).optional(),
    priorities:  z.string().optional(),
    funding:     z.string().optional(),
  }).default({}),
})

export async function crisisRoutes(fastify: FastifyInstance) {

  // ── Liste des crises ────────────────────────────────────────────────────

  fastify.get('/crises', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'territory_admin', 'humanitarian_partner')],
  }, async (request) => {
    const q = request.query as Record<string, string>
    const status = q.status ?? null
    const page   = Math.max(1, parseInt(q.page ?? '1'))
    const limit  = Math.min(100, Math.max(1, parseInt(q.limit ?? '20')))
    const offset = (page - 1) * limit

    const rows = await sql`
      SELECT
        c.id, c.glide_number, c.title, c.hazard_type, c.status, c.severity,
        c.start_date, c.end_date, c.affected_count, c.displaced_count, c.deaths_count,
        c.response_lead, c.created_at,
        d.name_fr AS location_name,
        COUNT(t.id) FILTER (WHERE t.status != 'done')::int AS open_tasks,
        COUNT(s.id)::int AS sitrep_count
      FROM crisis_events c
      LEFT JOIN admin_divisions d    ON d.pcode = c.location_pcode
      LEFT JOIN coordination_tasks t ON t.crisis_event_id = c.id
      LEFT JOIN situation_reports  s ON s.crisis_event_id = c.id
      WHERE (${status}::text IS NULL OR c.status = ${status})
      GROUP BY c.id, d.name_fr
      ORDER BY c.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM crisis_events
      WHERE (${status}::text IS NULL OR status = ${status})
    `

    return { success: true, data: rows, meta: { total, page, limit } }
  })

  // ── Créer une crise ─────────────────────────────────────────────────────

  fastify.post('/crises', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'territory_admin')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const body = CreateCrisisSchema.parse(request.body)
    const glideNumber = await generateGlideNumber(body.hazardType)

    const [crisis] = await sql`
      INSERT INTO crisis_events (
        glide_number, title, hazard_type, severity, start_date,
        location_pcode, affected_count, displaced_count, deaths_count,
        description, response_lead, created_by
      ) VALUES (
        ${glideNumber},
        ${body.title},
        ${body.hazardType}::hazard_type,
        ${body.severity},
        ${body.startDate ?? new Date().toISOString().slice(0, 10)},
        ${body.locationPcode ?? null},
        ${body.affectedCount ?? null},
        ${body.displacedCount ?? null},
        ${body.deathsCount ?? null},
        ${body.description ?? null},
        ${body.responseLead ?? null},
        ${user.sub}
      )
      RETURNING *
    `

    await writeAuditLog(user.sub, 'create', 'crisis_events', crisis.id, request, { glideNumber })

    broadcast({ type: 'CRISIS_CREATED', payload: { id: crisis.id, glideNumber, title: body.title, hazardType: body.hazardType } } as any)

    return reply.status(201).send({ success: true, data: crisis })
  })

  // ── Détail d'une crise ──────────────────────────────────────────────────

  fastify.get('/crises/:id', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'territory_admin', 'humanitarian_partner')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const [crisis] = await sql`
      SELECT c.*, d.name_fr AS location_name
      FROM crisis_events c
      LEFT JOIN admin_divisions d ON d.pcode = c.location_pcode
      WHERE c.id = ${id}
    `
    if (!crisis) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND' } })

    const [tasks, sitreps, events] = await Promise.all([
      sql`
        SELECT t.*, u.full_name AS assignee_name
        FROM coordination_tasks t
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.crisis_event_id = ${id}
        ORDER BY t.priority DESC, t.created_at ASC
      `,
      sql`
        SELECT id, report_number, title, period_from, period_to, status, created_at
        FROM situation_reports WHERE crisis_event_id = ${id}
        ORDER BY report_number DESC
      `,
      sql`
        SELECT id, title, hazard_type, severity, created_at, location_pcode
        FROM disaster_events WHERE crisis_event_id = ${id}
        ORDER BY created_at DESC LIMIT 10
      `,
    ])

    return { success: true, data: { ...crisis, tasks, sitreps, recentEvents: events } }
  })

  // ── Mettre à jour une crise ─────────────────────────────────────────────

  fastify.patch('/crises/:id', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'territory_admin')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id } = request.params as { id: string }
    const body = UpdateCrisisSchema.parse(request.body)

    const [crisis] = await sql`
      UPDATE crisis_events SET
        title          = COALESCE(${body.title ?? null},          title),
        status         = COALESCE(${body.status ?? null},         status),
        severity       = COALESCE(${body.severity ?? null},       severity),
        end_date       = COALESCE(${body.endDate ?? null}::date,  end_date),
        affected_count = COALESCE(${body.affectedCount ?? null},  affected_count),
        displaced_count= COALESCE(${body.displacedCount ?? null}, displaced_count),
        deaths_count   = COALESCE(${body.deathsCount ?? null},    deaths_count),
        description    = COALESCE(${body.description ?? null},    description),
        response_lead  = COALESCE(${body.responseLead ?? null},   response_lead)
      WHERE id = ${id}
      RETURNING id, glide_number, status, title
    `
    if (!crisis) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND' } })

    await writeAuditLog(user.sub, 'update', 'crisis_events', id, request, body)
    broadcast({ type: 'CRISIS_UPDATED', payload: crisis } as any)

    return { success: true, data: crisis }
  })

  // ── SitReps ─────────────────────────────────────────────────────────────

  fastify.post('/crises/:id/sitreps', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'territory_admin', 'humanitarian_partner')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id } = request.params as { id: string }
    const body = CreateSitRepSchema.parse(request.body)

    const [{ nextNum }] = await sql`
      SELECT COALESCE(MAX(report_number), 0) + 1 AS next_num
      FROM situation_reports WHERE crisis_event_id = ${id}
    `

    const [sitrep] = await sql`
      INSERT INTO situation_reports (
        crisis_event_id, report_number, title, period_from, period_to,
        prepared_by, content
      ) VALUES (
        ${id}, ${nextNum}, ${body.title},
        ${body.periodFrom}, ${body.periodTo},
        ${user.sub}, ${JSON.stringify(body.content)}
      )
      RETURNING *
    `

    await writeAuditLog(user.sub, 'create', 'situation_reports', sitrep.id, request, { crisisId: id, reportNumber: nextNum })

    return reply.status(201).send({ success: true, data: sitrep })
  })

  fastify.get('/crises/:id/sitreps/:reportId', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'territory_admin', 'humanitarian_partner')],
  }, async (request, reply) => {
    const { id, reportId } = request.params as { id: string; reportId: string }

    const [sitrep] = await sql`
      SELECT s.*, c.title AS crisis_title, c.glide_number,
             u.full_name AS prepared_by_name
      FROM situation_reports s
      JOIN crisis_events c ON c.id = s.crisis_event_id
      LEFT JOIN users u ON u.id = s.prepared_by
      WHERE s.id = ${reportId} AND s.crisis_event_id = ${id}
    `
    if (!sitrep) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND' } })

    return { success: true, data: sitrep }
  })

  fastify.patch('/crises/:id/sitreps/:reportId', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'territory_admin')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id, reportId } = request.params as { id: string; reportId: string }
    const body = z.object({
      status:  z.enum(['draft', 'final', 'published']).optional(),
      content: z.record(z.unknown()).optional(),
      title:   z.string().optional(),
    }).parse(request.body)

    const [sitrep] = await sql`
      UPDATE situation_reports SET
        status  = COALESCE(${body.status ?? null}, status),
        content = COALESCE(${body.content ? JSON.stringify(body.content) : null}::jsonb, content),
        title   = COALESCE(${body.title ?? null}, title)
      WHERE id = ${reportId} AND crisis_event_id = ${id}
      RETURNING id, report_number, status, title
    `
    if (!sitrep) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND' } })

    await writeAuditLog(user.sub, 'update', 'situation_reports', reportId, request, body)
    return { success: true, data: sitrep }
  })
}
