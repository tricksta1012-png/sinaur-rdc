/**
 * Routes proxy vers l'Agent 1 — Veille & Ingestion (service ai-prediction).
 * Réservé aux administrateurs et décideurs nationaux.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/jwt.js';
import { aiGet, aiPost } from '../services/aiClient.js';

const ADMIN_ROLES = ['territory_admin', 'national_decision_maker', 'system_admin'] as const;

export async function veilleRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /ai/veille/events — événements récents collectés par la veille
  fastify.get(
    '/ai/veille/events',
    { preHandler: [requireAuth, requireRole(...ADMIN_ROLES)] },
    async (request, reply) => {
      const { since, type, province } = z.object({
        since: z.string().optional(),
        type: z.string().optional(),
        province: z.string().optional(),
      }).parse(request.query);

      const params: Record<string, string> = {};
      if (since) params.since = since;
      if (type) params.type = type;
      if (province) params.province = province;

      const { status, data } = await aiGet('/internal/veille/events', params);
      return reply.status(status).send(data);
    },
  );

  // GET /ai/veille/health — état des connecteurs (circuit-breaker, dernière collecte)
  fastify.get(
    '/ai/veille/health',
    { preHandler: [requireAuth, requireRole(...ADMIN_ROLES)] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/veille/health');
      return reply.status(status).send(data);
    },
  );

  // POST /ai/veille/trigger/:sourceId — forcer une collecte manuelle sur une source
  fastify.post(
    '/ai/veille/trigger/:sourceId',
    { preHandler: [requireAuth, requireRole('system_admin')] },
    async (request, reply) => {
      const { sourceId } = request.params as { sourceId: string };
      const { status, data } = await aiPost(`/internal/veille/trigger/${sourceId}`);
      return reply.status(status).send(data);
    },
  );
}
