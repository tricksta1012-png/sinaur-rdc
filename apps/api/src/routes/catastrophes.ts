/**
 * Routes proxy → Agent Catastrophes (GDACS).
 *
 * Données GDACS (ONU) : séismes, inondations, volcans, cyclones, sécheresses, feux.
 * Filtré sur la RDC + pays voisins. Orange/Red sur sol RDC → crise SINAUR créée.
 *
 * RBAC : lecture → territory_admin, national_decision_maker, system_admin, humanitarian_partner
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth, requireRole } from '../auth/jwt.js'
import { aiGet } from '../services/aiClient.js'
import { sql } from '../db.js'

export async function catastrophesRoutes(fastify: FastifyInstance): Promise<void> {

  const ROLES_LECTURE = ['territory_admin', 'provincial_coordinator', 'national_decision_maker', 'system_admin', 'humanitarian_partner'] as const

  // GET /ai/catastrophes/evenements — événements GDACS actifs
  fastify.get(
    '/ai/catastrophes/evenements',
    { preHandler: [requireAuth, requireRole(...ROLES_LECTURE)] },
    async (request, reply) => {
      const { niveau, type_code } = z.object({
        niveau:    z.enum(['Green', 'Orange', 'Red']).optional(),
        type_code: z.enum(['EQ', 'FL', 'VO', 'TC', 'DR', 'WF', 'TS']).optional(),
      }).parse(request.query)

      const { status, data } = await aiGet('/internal/catastrophes/evenements', {
        ...(niveau    ? { niveau }    : {}),
        ...(type_code ? { type_code } : {}),
      })
      return reply.status(status).send(data)
    },
  )

  // GET /ai/catastrophes/map — GeoJSON pour la carte
  fastify.get(
    '/ai/catastrophes/map',
    { preHandler: [requireAuth, requireRole(...ROLES_LECTURE)] },
    async (request, reply) => {
      const { status, data } = await aiGet('/internal/catastrophes/map')
      return reply.status(status).send(data)
    },
  )

  // GET /ai/catastrophes/crises — crises SINAUR créées par l'agent GDACS
  fastify.get(
    '/ai/catastrophes/crises',
    { preHandler: [requireAuth, requireRole('national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { status, data } = await aiGet('/internal/catastrophes/crises')
      return reply.status(status).send(data)
    },
  )

  // GET /ai/catastrophes/status — statut de l'agent
  fastify.get(
    '/ai/catastrophes/status',
    { preHandler: [requireAuth, requireRole('national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { status, data } = await aiGet('/internal/catastrophes/status')
      return reply.status(status).send(data)
    },
  )

  // GET /catastrophes/actives — lecture directe DB (GeoJSON, sans passer par ai-prediction)
  fastify.get(
    '/catastrophes/actives',
    { preHandler: [requireAuth, requireRole(...ROLES_LECTURE)] },
    async (request, reply) => {
      const { niveau, type_code } = z.object({
        niveau:    z.enum(['Green', 'Orange', 'Red']).optional(),
        type_code: z.enum(['EQ', 'FL', 'VO', 'TC', 'DR', 'WF', 'TS']).optional(),
      }).parse(request.query)

      const rows = await sql`
        SELECT
          gdacs_id, type_code, type_label, titre, pays, province_pcode,
          niveau_alerte_gdacs, statut_sinaur, severite, population_affectee,
          ST_X(coordinates) AS lon, ST_Y(coordinates) AS lat,
          date_debut, date_maj, source_url, cree_le
        FROM catastrophe_naturelle
        WHERE actif = true
          ${niveau    ? sql`AND niveau_alerte_gdacs = ${niveau}`    : sql``}
          ${type_code ? sql`AND type_code = ${type_code}` : sql``}
        ORDER BY
          CASE niveau_alerte_gdacs WHEN 'Red' THEN 1 WHEN 'Orange' THEN 2 ELSE 3 END,
          date_maj DESC NULLS LAST
      `

      const features = rows
        .filter((r: any) => r.lon != null && r.lat != null)
        .map((r: any) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
          properties: { ...r, lon: undefined, lat: undefined },
        }))

      return reply.send({
        type: 'FeatureCollection',
        features,
        metadata: { total: features.length },
      })
    },
  )
}
