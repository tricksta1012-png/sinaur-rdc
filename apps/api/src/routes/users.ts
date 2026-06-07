/**
 * Routes d'administration — gestion des utilisateurs et journal d'audit.
 * Accès : system_admin uniquement (sauf audit-log : + national_decision_maker).
 */
import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { sql } from '../db.js'
import { requireAuth, requireRole, writeAuditLog } from '../auth/jwt.js'

const CreateUserSchema = z.object({
  email:                z.string().email(),
  fullName:             z.string().min(2).max(120),
  phone:                z.string().optional(),
  password:             z.string().min(10),
  role:                 z.enum(['citizen', 'field_agent', 'local_validator', 'territory_admin', 'humanitarian_partner', 'national_decision_maker', 'system_admin']),
  geographicScopePcodes: z.array(z.string()).default([]),
})

const UpdateUserSchema = z.object({
  role:                 z.enum(['citizen', 'field_agent', 'local_validator', 'territory_admin', 'humanitarian_partner', 'national_decision_maker', 'system_admin']).optional(),
  geographicScopePcodes: z.array(z.string()).optional(),
  isActive:             z.boolean().optional(),
  fullName:             z.string().min(2).max(120).optional(),
  phone:                z.string().optional(),
})

export async function usersRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Liste des utilisateurs ─────────────────────────────────────────────────
  fastify.get('/admin/users', {
    preHandler: [requireAuth, requireRole('system_admin')],
  }, async (request) => {
    const q      = request.query as Record<string, string>
    const page   = Math.max(1, parseInt(q.page ?? '1'))
    const limit  = Math.min(100, parseInt(q.limit ?? '25'))
    const offset = (page - 1) * limit
    const role   = q.role ?? null
    const search = q.search ? `%${q.search}%` : null

    const rows = await sql`
      SELECT id, email, full_name, phone, role,
             geographic_scope_pcodes, is_active, created_at, last_login_at
      FROM users
      WHERE deleted_at IS NULL
        AND (${role}::text IS NULL OR role = ${role})
        AND (${search}::text IS NULL
             OR email ILIKE ${search}
             OR full_name ILIKE ${search})
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM users
      WHERE deleted_at IS NULL
        AND (${role}::text IS NULL OR role = ${role})
        AND (${search}::text IS NULL
             OR email ILIKE ${search}
             OR full_name ILIKE ${search})
    `

    return { success: true, data: rows, meta: { total, page, limit } }
  })

  // ── Créer un utilisateur ───────────────────────────────────────────────────
  fastify.post('/admin/users', {
    preHandler: [requireAuth, requireRole('system_admin')],
  }, async (request, reply) => {
    const body = CreateUserSchema.parse(request.body)
    const admin = request.jwtUser

    const [existing] = await sql`SELECT id FROM users WHERE email = ${body.email} AND deleted_at IS NULL`
    if (existing) {
      return reply.status(409).send({ success: false, error: { code: 'EMAIL_TAKEN', message: 'Cet email est déjà utilisé' } })
    }

    const hash = await bcrypt.hash(body.password, 12)

    const [user] = await sql`
      INSERT INTO users (email, full_name, phone, password_hash, role, geographic_scope_pcodes)
      VALUES (${body.email}, ${body.fullName}, ${body.phone ?? null}, ${hash},
              ${body.role}, ${sql.array(body.geographicScopePcodes)})
      RETURNING id, email, full_name, role, geographic_scope_pcodes, is_active, created_at
    `

    await writeAuditLog(admin.sub, 'USER_CREATED', 'users', user.id, request, {
      email: body.email, role: body.role,
    })

    return reply.status(201).send({ success: true, data: user })
  })

  // ── Modifier un utilisateur ────────────────────────────────────────────────
  fastify.patch('/admin/users/:id', {
    preHandler: [requireAuth, requireRole('system_admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body   = UpdateUserSchema.parse(request.body)
    const admin  = request.jwtUser

    const [existing] = await sql`SELECT id, role FROM users WHERE id = ${id} AND deleted_at IS NULL`
    if (!existing) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND' } })

    // Empêcher un admin de se retirer ses propres droits
    if (id === admin.sub && body.role && body.role !== 'system_admin') {
      return reply.status(400).send({ success: false, error: { code: 'CANNOT_DOWNGRADE_SELF' } })
    }

    const [updated] = await sql`
      UPDATE users SET
        role                   = COALESCE(${body.role ?? null}, role),
        geographic_scope_pcodes = COALESCE(${body.geographicScopePcodes ? sql.array(body.geographicScopePcodes) : null}, geographic_scope_pcodes),
        is_active              = COALESCE(${body.isActive ?? null}, is_active),
        full_name              = COALESCE(${body.fullName ?? null}, full_name),
        phone                  = COALESCE(${body.phone ?? null}, phone)
      WHERE id = ${id}
      RETURNING id, email, full_name, role, geographic_scope_pcodes, is_active
    `

    await writeAuditLog(admin.sub, 'USER_UPDATED', 'users', id, request, body)

    return { success: true, data: updated }
  })

  // ── Supprimer (soft-delete) un utilisateur ─────────────────────────────────
  fastify.delete('/admin/users/:id', {
    preHandler: [requireAuth, requireRole('system_admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const admin  = request.jwtUser

    if (id === admin.sub) {
      return reply.status(400).send({ success: false, error: { code: 'CANNOT_DELETE_SELF' } })
    }

    const [deleted] = await sql`
      UPDATE users SET deleted_at = NOW(), is_active = FALSE
      WHERE id = ${id} AND deleted_at IS NULL
      RETURNING id, email
    `
    if (!deleted) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND' } })

    await writeAuditLog(admin.sub, 'USER_DELETED', 'users', id, request, { email: deleted.email })

    return { success: true, data: { id } }
  })

  // ── Journal d'audit ────────────────────────────────────────────────────────
  fastify.get('/admin/audit-log', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker')],
  }, async (request) => {
    const q        = request.query as Record<string, string>
    const page     = Math.max(1, parseInt(q.page ?? '1'))
    const limit    = Math.min(100, parseInt(q.limit ?? '50'))
    const offset   = (page - 1) * limit
    const userId   = q.userId   ?? null
    const action   = q.action   ?? null
    const resource = q.resource ?? null
    const from     = q.from ? new Date(q.from) : new Date(Date.now() - 7 * 86400000) // 7 jours par défaut
    const to       = q.to   ? new Date(q.to)   : new Date()

    const rows = await sql`
      SELECT
        al.id, al.created_at, al.action, al.resource, al.resource_id,
        al.ip_address, al.user_agent, al.details,
        u.email AS user_email, u.full_name AS user_name, u.role AS user_role
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.created_at BETWEEN ${from} AND ${to}
        AND (${userId}::text IS NULL OR al.user_id::text = ${userId})
        AND (${action}::text IS NULL OR al.action = ${action})
        AND (${resource}::text IS NULL OR al.resource = ${resource})
      ORDER BY al.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM audit_log al
      WHERE al.created_at BETWEEN ${from} AND ${to}
        AND (${userId}::text IS NULL OR al.user_id::text = ${userId})
        AND (${action}::text IS NULL OR al.action = ${action})
        AND (${resource}::text IS NULL OR al.resource = ${resource})
    `

    // Actions et ressources distinctes (pour les filtres UI)
    const actions   = await sql`SELECT DISTINCT action   FROM audit_log ORDER BY action`
    const resources = await sql`SELECT DISTINCT resource FROM audit_log ORDER BY resource`

    return {
      success: true,
      data: rows,
      meta: { total, page, limit },
      filters: {
        actions:   actions.map(r => r.action),
        resources: resources.map(r => r.resource),
      },
    }
  })
}
