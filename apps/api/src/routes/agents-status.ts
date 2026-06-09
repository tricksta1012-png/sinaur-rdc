/**
 * Proxy vers l'endpoint unifié de statut des 8 agents IA.
 * Répond en < 500ms (données mémoire, pas d'appel DB).
 */
import type { FastifyInstance } from 'fastify';
import { requireAuth, requireRole } from '../auth/jwt.js';
import { aiGet } from '../services/aiClient.js';

export async function agentsStatusRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/ai/agents/status',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/agents/status');
      return reply.status(status).send(data);
    },
  );
}
