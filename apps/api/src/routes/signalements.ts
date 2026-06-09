/**
 * Routes proxy vers l'Agent 5 — Signalements Citoyens (service ai-prediction).
 *
 * RBAC :
 *   process  → field_agent, local_validator, territory_admin, system_admin
 *   lecture  → territory_admin, national_decision_maker, system_admin
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/jwt.js';
import { aiGet, aiPost } from '../services/aiClient.js';

export async function signalementsRoutes(fastify: FastifyInstance): Promise<void> {

  // POST /ai/signalements/process — traitement NLP d'un signalement entrant
  fastify.post(
    '/ai/signalements/process',
    { preHandler: [requireAuth, requireRole('field_agent', 'local_validator', 'territory_admin', 'system_admin')] },
    async (request, reply) => {
      const body = z.object({
        text: z.string().min(1),
        source: z.string().min(1),
        channel: z.string().min(1),
        metadata: z.record(z.unknown()).optional(),
      }).parse(request.body);

      const { status, data } = await aiPost('/internal/signalements/process', body);
      return reply.status(status).send(data);
    },
  );

  // GET /ai/signalements/clusters — clusters géographiques de signalements
  fastify.get(
    '/ai/signalements/clusters',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/signalements/clusters');
      return reply.status(status).send(data);
    },
  );

  // GET /ai/signalements/priority — signalements triés par priorité
  fastify.get(
    '/ai/signalements/priority',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/signalements/priority');
      return reply.status(status).send(data);
    },
  );

  // GET /ai/signalements/stats — statistiques générales des signalements
  fastify.get(
    '/ai/signalements/stats',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/signalements/stats');
      return reply.status(status).send(data);
    },
  );
}
