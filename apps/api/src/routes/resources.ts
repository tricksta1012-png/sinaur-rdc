import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from '../db.js'
import { requireAuth, requireRole, writeAuditLog } from '../auth/jwt.js'

const RESOURCE_ROLES = ['system_admin', 'national_decision_maker', 'provincial_coordinator', 'humanitarian_partner'] as const

const DepotSchema = z.object({
  name: z.string().min(2).max(200),
  pcode: z.string().min(2).max(20),
  address: z.string().max(500).optional(),
  managerId: z.string().uuid().optional(),
})

const StockSchema = z.object({
  resourceType: z.enum(['food', 'water', 'medicine', 'shelter_kit', 'nfi', 'hygiene_kit', 'fuel', 'equipment', 'other']),
  resourceName: z.string().min(2).max(200),
  unit: z.string().min(1).max(50),
  quantityAvailable: z.number().min(0),
  minimumThreshold: z.number().min(0).default(0),
  crisisId: z.string().uuid().optional(),
})

const MovementSchema = z.object({
  stockId: z.string().uuid(),
  movementType: z.enum(['in', 'out', 'transfer', 'adjustment']),
  quantity: z.number().positive(),
  reason: z.string().max(500).optional(),
  referenceId: z.string().uuid().optional(),
})

export async function resourceRoutes(fastify: FastifyInstance) {
  // ── Lister les dépôts ──
  fastify.get('/resources/depots', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.jwtUser
    const q = z.object({
      pcode: z.string().optional(),
      active: z.coerce.boolean().optional(),
    }).parse(request.query)

    const isAdmin = user.role === 'system_admin' || user.role === 'national_decision_maker'

    const rows = await sql`
      SELECT
        d.id, d.name, d.pcode, d.address, d.is_active, d.created_at,
        u.display_name AS manager_name,
        COUNT(s.id)::int AS stock_lines,
        COALESCE(SUM(s.quantity_available), 0) AS total_units,
        COUNT(CASE WHEN s.quantity_available <= s.minimum_threshold AND s.minimum_threshold > 0 THEN 1 END)::int AS low_stock_count
      FROM resource_depots d
      LEFT JOIN users u ON u.id = d.manager_id
      LEFT JOIN resource_stocks s ON s.depot_id = d.id
      WHERE TRUE
        ${!isAdmin && user.scope.length > 0
          ? sql`AND (d.pcode = ANY(${user.scope}) OR ${user.scope}::text[] && ARRAY[d.pcode])`
          : sql``}
        ${q.pcode ? sql`AND d.pcode LIKE ${q.pcode + '%'}` : sql``}
        ${q.active !== undefined ? sql`AND d.is_active = ${q.active}` : sql``}
      GROUP BY d.id, u.display_name
      ORDER BY d.name
    `

    return reply.send({ success: true, data: rows })
  })

  // ── Détail d'un dépôt + ses stocks ──
  fastify.get('/resources/depots/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const [depot] = await sql`
      SELECT d.*, u.display_name AS manager_name
      FROM resource_depots d
      LEFT JOIN users u ON u.id = d.manager_id
      WHERE d.id = ${id}::uuid
    `
    if (!depot) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Dépôt introuvable' } })

    const stocks = await sql`
      SELECT s.*, c.glide_number AS crisis_glide
      FROM resource_stocks s
      LEFT JOIN crises c ON c.id = s.crisis_id
      WHERE s.depot_id = ${id}::uuid
      ORDER BY s.resource_type, s.resource_name
    `

    return reply.send({ success: true, data: { ...depot, stocks } })
  })

  // ── Créer un dépôt ──
  fastify.post('/resources/depots', {
    preHandler: [requireAuth, requireRole(...RESOURCE_ROLES)],
  }, async (request, reply) => {
    const user = request.jwtUser
    const body = DepotSchema.parse(request.body)

    const [row] = await sql`
      INSERT INTO resource_depots (name, pcode, address, manager_id)
      VALUES (${body.name}, ${body.pcode}, ${body.address ?? null}, ${body.managerId ?? null}::uuid)
      RETURNING id, name, pcode, address, is_active, created_at
    `

    await writeAuditLog(user.sub, 'create_depot', 'resource_depots', row.id, request, { name: body.name, pcode: body.pcode })
    return reply.status(201).send({ success: true, data: row })
  })

  // ── Modifier un dépôt ──
  fastify.patch('/resources/depots/:id', {
    preHandler: [requireAuth, requireRole(...RESOURCE_ROLES)],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id } = request.params as { id: string }
    const body = DepotSchema.partial().extend({ isActive: z.boolean().optional() }).parse(request.body)

    const [row] = await sql`
      UPDATE resource_depots SET
        name       = COALESCE(${body.name ?? null}, name),
        pcode      = COALESCE(${body.pcode ?? null}, pcode),
        address    = COALESCE(${body.address ?? null}, address),
        manager_id = COALESCE(${body.managerId ?? null}::uuid, manager_id),
        is_active  = COALESCE(${body.isActive ?? null}, is_active),
        updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING id, name, pcode, is_active, updated_at
    `
    if (!row) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Dépôt introuvable' } })

    await writeAuditLog(user.sub, 'update_depot', 'resource_depots', id, request, body)
    return reply.send({ success: true, data: row })
  })

  // ── Ajouter / mettre à jour un stock dans un dépôt ──
  fastify.post('/resources/depots/:id/stocks', {
    preHandler: [requireAuth, requireRole(...RESOURCE_ROLES)],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id: depotId } = request.params as { id: string }
    const body = StockSchema.parse(request.body)

    const [depot] = await sql`SELECT id FROM resource_depots WHERE id = ${depotId}::uuid`
    if (!depot) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Dépôt introuvable' } })

    const [row] = await sql`
      INSERT INTO resource_stocks
        (depot_id, resource_type, resource_name, unit, quantity_available, minimum_threshold, crisis_id)
      VALUES
        (${depotId}::uuid, ${body.resourceType}::resource_type, ${body.resourceName},
         ${body.unit}, ${body.quantityAvailable}, ${body.minimumThreshold},
         ${body.crisisId ?? null}::uuid)
      ON CONFLICT (depot_id, resource_name) DO UPDATE SET
        quantity_available = EXCLUDED.quantity_available,
        minimum_threshold  = EXCLUDED.minimum_threshold,
        unit               = EXCLUDED.unit,
        updated_at         = now()
      RETURNING id, resource_type, resource_name, unit, quantity_available, quantity_reserved, minimum_threshold, updated_at
    `

    await writeAuditLog(user.sub, 'upsert_stock', 'resource_stocks', row.id, request,
      { depotId, resourceName: body.resourceName, quantity: body.quantityAvailable })
    return reply.status(201).send({ success: true, data: row })
  })

  // ── Enregistrer un mouvement (entrée / sortie / ajustement) ──
  fastify.post('/resources/depots/:id/movements', {
    preHandler: [requireAuth, requireRole(...RESOURCE_ROLES)],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id: depotId } = request.params as { id: string }
    const body = MovementSchema.parse(request.body)

    const [stock] = await sql`
      SELECT id, quantity_available, quantity_reserved, resource_name
      FROM resource_stocks WHERE id = ${body.stockId}::uuid AND depot_id = ${depotId}::uuid
    `
    if (!stock) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Article introuvable dans ce dépôt' } })

    let newQty: number
    if (body.movementType === 'in') {
      newQty = Number(stock.quantityAvailable) + body.quantity
    } else if (body.movementType === 'out' || body.movementType === 'transfer') {
      newQty = Number(stock.quantityAvailable) - body.quantity
      if (newQty < 0) {
        return reply.status(409).send({ success: false, error: { code: 'INSUFFICIENT_STOCK', message: 'Stock insuffisant pour cette opération' } })
      }
    } else {
      // adjustment: quantity is the new absolute value
      newQty = body.quantity
    }

    const [movement] = await sql`
      INSERT INTO resource_movements (depot_id, stock_id, movement_type, quantity, reason, reference_id, created_by)
      VALUES (${depotId}::uuid, ${body.stockId}::uuid, ${body.movementType}::movement_type,
              ${body.quantity}, ${body.reason ?? null}, ${body.referenceId ?? null}::uuid, ${user.sub}::uuid)
      RETURNING id, movement_type, quantity, created_at
    `

    await sql`
      UPDATE resource_stocks
      SET quantity_available = ${newQty}, updated_at = now()
      WHERE id = ${body.stockId}::uuid
    `

    await writeAuditLog(user.sub, 'stock_movement', 'resource_movements', movement.id, request,
      { depotId, stockId: body.stockId, type: body.movementType, quantity: body.quantity })

    return reply.status(201).send({ success: true, data: { ...movement, newQuantityAvailable: newQty } })
  })

  // ── Historique des mouvements d'un dépôt ──
  fastify.get('/resources/depots/:id/movements', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const q = z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(request.query)

    const offset = (q.page - 1) * q.limit

    const rows = await sql`
      SELECT
        m.id, m.movement_type, m.quantity, m.reason, m.created_at,
        s.resource_name, s.unit,
        u.display_name AS created_by_name
      FROM resource_movements m
      JOIN resource_stocks s ON s.id = m.stock_id
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.depot_id = ${id}::uuid
      ORDER BY m.created_at DESC
      LIMIT ${q.limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM resource_movements WHERE depot_id = ${id}::uuid`

    return reply.send({
      success: true,
      data: rows,
      pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) },
    })
  })

  // ── Vue d'ensemble globale : stocks critiques (sous le seuil) ──
  fastify.get('/resources/alerts', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.jwtUser
    const isAdmin = user.role === 'system_admin' || user.role === 'national_decision_maker'

    const rows = await sql`
      SELECT
        s.id AS stock_id, s.resource_name, s.unit,
        s.quantity_available, s.minimum_threshold,
        s.quantity_available - s.minimum_threshold AS gap,
        d.id AS depot_id, d.name AS depot_name, d.pcode
      FROM resource_stocks s
      JOIN resource_depots d ON d.id = s.depot_id
      WHERE s.minimum_threshold > 0
        AND s.quantity_available <= s.minimum_threshold
        AND d.is_active = TRUE
        ${!isAdmin && user.scope.length > 0
          ? sql`AND d.pcode = ANY(${user.scope})`
          : sql``}
      ORDER BY gap ASC, d.pcode
    `

    return reply.send({ success: true, data: rows })
  })
}
