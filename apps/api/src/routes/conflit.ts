/**
 * Routes proxy vers l'Agent 9 — Surveillance Conflits (service ai-prediction).
 * RBAC : accès RESTRICTED pour les données opérationnelles complètes.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/jwt.js';
import { aiGet } from '../services/aiClient.js';

const RESTRICTED_ROLES = ['humanitarian_partner', 'national_decision_maker', 'system_admin'] as const;

export async function conflitRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /conflit/events — événements de conflit filtrés par rôle
  fastify.get(
    '/conflit/events',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { since_days, province } = z.object({
        since_days: z.coerce.number().int().min(1).max(90).default(30),
        province: z.string().optional(),
      }).parse(request.query);

      const userRole = request.jwtUser.role;
      const params: Record<string, string | number> = { since_days };
      if (province) params.province = province;

      const { status, data } = await aiGet('/internal/conflit/events', params, { 'X-User-Role': userRole });
      return reply.status(status).send(data);
    },
  );

  // GET /conflit/map/public — carte simplifiée publique (tension par province)
  fastify.get(
    '/conflit/map/public',
    { preHandler: [requireAuth] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/conflit/map/public');
      return reply.status(status).send(data);
    },
  );

  // GET /conflit/map/operational — carte opérationnelle complète (RESTRICTED)
  fastify.get(
    '/conflit/map/operational',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (request, reply) => {
      const userRole = request.jwtUser.role;
      const { status, data } = await aiGet('/internal/conflit/map/operational', {}, { 'X-User-Role': userRole });
      return reply.status(status).send(data);
    },
  );

  // GET /conflit/predictions/displacement — prédictions de déplacement (RESTRICTED)
  fastify.get(
    '/conflit/predictions/displacement',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (request, reply) => {
      const userRole = request.jwtUser.role;
      const { province } = z.object({ province: z.string().optional() }).parse(request.query);
      const params: Record<string, string> = {};
      if (province) params.province = province;
      const { status, data } = await aiGet('/internal/conflit/predictions/displacement', params, { 'X-User-Role': userRole });
      return reply.status(status).send(data);
    },
  );

  // GET /conflit/actors — acteurs armés documentés (RESTRICTED)
  fastify.get(
    '/conflit/actors',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (request, reply) => {
      const userRole = request.jwtUser.role;
      const { province } = z.object({ province: z.string().optional() }).parse(request.query);
      const params: Record<string, string> = {};
      if (province) params.province = province;
      const { status, data } = await aiGet('/internal/conflit/actors', params, { 'X-User-Role': userRole });
      return reply.status(status).send(data);
    },
  );

  // GET /conflit/data-sources — état des sources de données de conflit
  fastify.get(
    '/conflit/data-sources',
    { preHandler: [requireAuth] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/conflit/data-sources');
      return reply.status(status).send(data);
    },
  );
}
