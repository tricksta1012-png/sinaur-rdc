import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from '../db.js'
import { requireAuth, requireRole, writeAuditLog } from '../auth/jwt.js'

const RESOURCE_ROLES = ['system_admin', 'national_decision_maker', 'provincial_coordinator', 'humanitarian_partner'] as const
const APPROVER_ROLES = ['system_admin', 'national_decision_maker'] as const

const DemandSchema = z.object({
  crisisId:      z.string().uuid(),
  resourceType:  z.enum(['food', 'water', 'medicine', 'shelter_kit', 'nfi', 'hygiene_kit', 'fuel', 'equipment', 'other']),
  resourceName:  z.string().min(2).max(200),
  unit:          z.string().min(1).max(50),
  quantityNeeded:z.number().positive(),
  urgency:       z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  notes:         z.string().max(1000).optional(),
  depotId:       z.string().uuid().optional(),
})

const ApproveSchema = z.object({
  depotId:           z.string().uuid().optional(),
  stockId:           z.string().uuid().optional(),
  quantityAllocated: z.number().positive().optional(),
  notes:             z.string().max(1000).optional(),
})

const RejectSchema = z.object({
  notes: z.string().max(1000).optional(),
})

export async function demandsRoutes(fastify: FastifyInstance) {
  // ── Créer une demande ──
  fastify.post('/resources/demands', {
    preHandler: [requireAuth, requireRole(...RESOURCE_ROLES)],
  }, async (request, reply) => {
    const user = request.jwtUser
    const body = DemandSchema.parse(request.body)

    const [crisis] = await sql`SELECT id FROM crisis_events WHERE id = ${body.crisisId}::uuid`
    if (!crisis) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Crise introuvable' } })

    const [row] = await sql`
      INSERT INTO resource_demands
        (crisis_id, depot_id, resource_type, resource_name, unit, quantity_needed, urgency, notes, requested_by)
      VALUES
        (${body.crisisId}::uuid, ${body.depotId ?? null}::uuid, ${body.resourceType}::resource_type,
         ${body.resourceName}, ${body.unit}, ${body.quantityNeeded}, ${body.urgency},
         ${body.notes ?? null}, ${user.sub}::uuid)
      RETURNING id, crisis_id, resource_type, resource_name, unit, quantity_needed, urgency, status, notes, created_at
    `

    await writeAuditLog(user.sub, 'create_demand', 'resource_demands', row.id, request,
      { crisisId: body.crisisId, resourceName: body.resourceName, quantity: body.quantityNeeded })
    return reply.status(201).send({ success: true, data: row })
  })

  // ── Lister toutes les demandes ──
  fastify.get('/resources/demands', { preHandler: [requireAuth] }, async (request, reply) => {
    const q = z.object({
      status:   z.enum(['pending', 'approved', 'rejected', 'fulfilled']).optional(),
      crisisId: z.string().uuid().optional(),
      urgency:  z.enum(['low', 'normal', 'high', 'critical']).optional(),
      page:     z.coerce.number().int().positive().default(1),
      limit:    z.coerce.number().int().min(1).max(100).default(50),
    }).parse(request.query)

    const offset = (q.page - 1) * q.limit

    const rows = await sql`
      SELECT
        d.id, d.crisis_id, d.depot_id, d.stock_id,
        d.resource_type, d.resource_name, d.unit,
        d.quantity_needed, d.quantity_allocated, d.urgency, d.status, d.notes,
        d.reviewed_at, d.created_at, d.updated_at,
        c.glide_number AS crisis_glide, c.title AS crisis_title,
        dep.name AS depot_name,
        u.display_name AS requested_by_name,
        rv.display_name AS reviewed_by_name
      FROM resource_demands d
      JOIN crisis_events c ON c.id = d.crisis_id
      LEFT JOIN resource_depots dep ON dep.id = d.depot_id
      LEFT JOIN users u  ON u.id  = d.requested_by
      LEFT JOIN users rv ON rv.id = d.reviewed_by
      WHERE TRUE
        ${q.status   ? sql`AND d.status    = ${q.status}::demand_status` : sql``}
        ${q.crisisId ? sql`AND d.crisis_id = ${q.crisisId}::uuid`        : sql``}
        ${q.urgency  ? sql`AND d.urgency   = ${q.urgency}`               : sql``}
      ORDER BY
        CASE d.urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
        d.created_at DESC
      LIMIT ${q.limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM resource_demands d
      WHERE TRUE
        ${q.status   ? sql`AND d.status    = ${q.status}::demand_status` : sql``}
        ${q.crisisId ? sql`AND d.crisis_id = ${q.crisisId}::uuid`        : sql``}
        ${q.urgency  ? sql`AND d.urgency   = ${q.urgency}`               : sql``}
    `

    return reply.send({
      success: true, data: rows,
      pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) },
    })
  })

  // ── Demandes par crise ──
  fastify.get('/resources/crises/:crisisId/demands', { preHandler: [requireAuth] }, async (request, reply) => {
    const { crisisId } = request.params as { crisisId: string }

    const rows = await sql`
      SELECT
        d.id, d.resource_type, d.resource_name, d.unit,
        d.quantity_needed, d.quantity_allocated, d.urgency, d.status, d.notes,
        d.reviewed_at, d.created_at,
        dep.name AS depot_name,
        u.display_name  AS requested_by_name,
        rv.display_name AS reviewed_by_name
      FROM resource_demands d
      LEFT JOIN resource_depots dep ON dep.id = d.depot_id
      LEFT JOIN users u  ON u.id  = d.requested_by
      LEFT JOIN users rv ON rv.id = d.reviewed_by
      WHERE d.crisis_id = ${crisisId}::uuid
      ORDER BY
        CASE d.urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
        d.created_at DESC
    `

    return reply.send({ success: true, data: rows })
  })

  // ── Approuver une demande ──
  fastify.patch('/resources/demands/:id/approve', {
    preHandler: [requireAuth, requireRole(...APPROVER_ROLES)],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id } = request.params as { id: string }
    const body = ApproveSchema.parse(request.body)

    const [demand] = await sql`
      SELECT id, status, quantity_needed FROM resource_demands WHERE id = ${id}::uuid
    `
    if (!demand) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Demande introuvable' } })
    if (demand.status !== 'pending') {
      return reply.status(409).send({ success: false, error: { code: 'INVALID_STATUS', message: 'Seules les demandes en attente peuvent être approuvées' } })
    }

    const quantityAllocated = body.quantityAllocated ?? Number(demand.quantityNeeded)

    if (body.stockId) {
      const [stock] = await sql`SELECT id, quantity_available FROM resource_stocks WHERE id = ${body.stockId}::uuid`
      if (!stock) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Article introuvable' } })
      if (Number(stock.quantityAvailable) < quantityAllocated) {
        return reply.status(409).send({ success: false, error: { code: 'INSUFFICIENT_STOCK', message: 'Stock insuffisant pour cette allocation' } })
      }
      await sql`
        UPDATE resource_stocks
        SET quantity_reserved = quantity_reserved + ${quantityAllocated}, updated_at = now()
        WHERE id = ${body.stockId}::uuid
      `
    }

    const [row] = await sql`
      UPDATE resource_demands SET
        status             = 'approved'::demand_status,
        depot_id           = COALESCE(${body.depotId ?? null}::uuid,  depot_id),
        stock_id           = COALESCE(${body.stockId ?? null}::uuid,  stock_id),
        quantity_allocated = ${quantityAllocated},
        notes              = COALESCE(${body.notes ?? null}, notes),
        reviewed_by        = ${user.sub}::uuid,
        reviewed_at        = now(),
        updated_at         = now()
      WHERE id = ${id}::uuid
      RETURNING id, status, quantity_allocated, reviewed_at
    `

    await writeAuditLog(user.sub, 'approve_demand', 'resource_demands', id, request,
      { quantityAllocated, stockId: body.stockId ?? null })
    return reply.send({ success: true, data: row })
  })

  // ── Rejeter une demande ──
  fastify.patch('/resources/demands/:id/reject', {
    preHandler: [requireAuth, requireRole(...APPROVER_ROLES)],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id } = request.params as { id: string }
    const body = RejectSchema.parse(request.body)

    const [demand] = await sql`SELECT id, status FROM resource_demands WHERE id = ${id}::uuid`
    if (!demand) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Demande introuvable' } })
    if (demand.status !== 'pending') {
      return reply.status(409).send({ success: false, error: { code: 'INVALID_STATUS', message: 'Seules les demandes en attente peuvent être rejetées' } })
    }

    const [row] = await sql`
      UPDATE resource_demands SET
        status      = 'rejected'::demand_status,
        notes       = COALESCE(${body.notes ?? null}, notes),
        reviewed_by = ${user.sub}::uuid,
        reviewed_at = now(),
        updated_at  = now()
      WHERE id = ${id}::uuid
      RETURNING id, status, reviewed_at
    `

    await writeAuditLog(user.sub, 'reject_demand', 'resource_demands', id, request, { notes: body.notes ?? null })
    return reply.send({ success: true, data: row })
  })

  // ── Marquer une demande comme réalisée ──
  fastify.patch('/resources/demands/:id/fulfill', {
    preHandler: [requireAuth, requireRole(...RESOURCE_ROLES)],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id } = request.params as { id: string }

    const [demand] = await sql`
      SELECT id, status, stock_id, quantity_allocated FROM resource_demands WHERE id = ${id}::uuid
    `
    if (!demand) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Demande introuvable' } })
    if (demand.status !== 'approved') {
      return reply.status(409).send({ success: false, error: { code: 'INVALID_STATUS', message: 'Seules les demandes approuvées peuvent être réalisées' } })
    }

    if (demand.stockId && demand.quantityAllocated) {
      await sql`
        UPDATE resource_stocks
        SET quantity_reserved = GREATEST(0, quantity_reserved - ${Number(demand.quantityAllocated)}),
            updated_at = now()
        WHERE id = ${demand.stockId}::uuid
      `
    }

    const [row] = await sql`
      UPDATE resource_demands SET status = 'fulfilled'::demand_status, updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING id, status, updated_at
    `

    await writeAuditLog(user.sub, 'fulfill_demand', 'resource_demands', id, request, {})
    return reply.send({ success: true, data: row })
  })
}
