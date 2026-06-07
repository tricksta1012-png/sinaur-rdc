/**
 * Routes profil personnel — utilisateurs authentifiés (tous rôles).
 * Accès : JWT valide requis.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from '../db.js'
import { requireAuth, writeAuditLog } from '../auth/jwt.js'

const UpdateProfileSchema = z.object({
  displayName: z.string().min(2).max(120).optional(),
  phone:       z.string().optional().nullable(),
})

export async function profileRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Profil courant ─────────────────────────────────────────────────────────
  fastify.get('/users/me', {
    preHandler: [requireAuth],
  }, async (request) => {
    const { sub } = request.jwtUser

    const [user] = await sql`
      SELECT id, email, phone, display_name, role,
             geographic_scope_pcodes, is_active, created_at, last_login_at
      FROM users
      WHERE id = ${sub} AND deleted_at IS NULL
    `

    return { success: true, data: user }
  })

  // ── Mise à jour du profil ──────────────────────────────────────────────────
  fastify.patch('/users/me', {
    preHandler: [requireAuth],
  }, async (request) => {
    const { sub } = request.jwtUser
    const body = UpdateProfileSchema.parse(request.body)

    const [updated] = await sql`
      UPDATE users SET
        display_name = COALESCE(${body.displayName ?? null}, display_name),
        phone        = COALESCE(${body.phone ?? null},        phone),
        updated_at   = NOW()
      WHERE id = ${sub} AND deleted_at IS NULL
      RETURNING id, email, phone, display_name, role, geographic_scope_pcodes, is_active, updated_at
    `

    await writeAuditLog(sub, 'PROFILE_UPDATED', 'users', sub, request, {
      fields: Object.keys(body),
    })

    return { success: true, data: updated }
  })
}
