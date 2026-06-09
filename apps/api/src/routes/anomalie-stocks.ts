/**
 * Routes proxy vers l'Agent 4 — Anomalies Stocks (service ai-prediction).
 *
 * RBAC :
 *   lecture  → territory_admin, national_decision_maker, system_admin
 *   resolve  → territory_admin, system_admin
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/jwt.js';
import { aiGet, aiPost } from '../services/aiClient.js';

export async function anomalieStocksRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /ai/anomalie-stocks/alerts?statut=&province=
  fastify.get(
    '/ai/anomalie-stocks/alerts',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { statut, province } = z.object({
        statut: z.string().optional(),
        province: z.string().optional(),
      }).parse(request.query);

      const { status, data } = await aiGet('/internal/anomalie-stocks/alerts', {
        ...(statut ? { statut } : {}),
        ...(province ? { province } : {}),
      });
      return reply.status(status).send(data);
    },
  );

  // GET /ai/anomalie-stocks/stats/:entrepotId
  fastify.get(
    '/ai/anomalie-stocks/stats/:entrepotId',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { entrepotId } = request.params as { entrepotId: string };
      const { status, data } = await aiGet(`/internal/anomalie-stocks/stats/${entrepotId}`);
      return reply.status(status).send(data);
    },
  );

  // POST /ai/anomalie-stocks/alerts/:id/resolve
  fastify.post(
    '/ai/anomalie-stocks/alerts/:id/resolve',
    { preHandler: [requireAuth, requireRole('territory_admin', 'system_admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z.object({
        resolution: z.string().min(2),
        note: z.string().optional(),
      }).parse(request.body);

      const { status, data } = await aiPost(`/internal/anomalie-stocks/alerts/${id}/resolve`, {
        resolution: body.resolution,
        note: body.note ?? '',
      });
      return reply.status(status).send(data);
    },
  );

  // GET /ai/anomalie-stocks/dashboard
  fastify.get(
    '/ai/anomalie-stocks/dashboard',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/anomalie-stocks/dashboard');
      return reply.status(status).send(data);
    },
  );
}
