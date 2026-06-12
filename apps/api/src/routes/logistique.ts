/**
 * Routes proxy vers l'Agent 7 — Logistique (service ai-prediction).
 *
 * IMPORTANT : Les recommandations sont SUGGÉRÉES UNIQUEMENT, jamais auto-appliquées.
 * Un opérateur doit les accepter ou les rejeter explicitement.
 *
 * RBAC :
 *   optimize     → system_admin
 *   lecture      → territory_admin, national_decision_maker, system_admin
 *   accept/reject → territory_admin, national_decision_maker, system_admin
 *   routes       → territory_admin, national_decision_maker, system_admin
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/jwt.js';
import { aiGet, aiPost } from '../services/aiClient.js';

export async function logistiqueRoutes(fastify: FastifyInstance): Promise<void> {

  // POST /ai/logistique/optimize — déclencher un cycle d'optimisation
  fastify.post(
    '/ai/logistique/optimize',
    { preHandler: [requireAuth, requireRole('system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiPost('/internal/logistique/optimize');
      return reply.status(status).send(data);
    },
  );

  // GET /ai/logistique/recommendations?status=
  fastify.get(
    '/ai/logistique/recommendations',
    { preHandler: [requireAuth, requireRole('provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { status: recStatus } = z.object({
        status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).optional(),
      }).parse(request.query);

      const { status, data } = await aiGet('/internal/logistique/recommendations', {
        ...(recStatus ? { status: recStatus } : {}),
      });
      return reply.status(status).send(data);
    },
  );

  // POST /ai/logistique/recommendations/:id/accept
  fastify.post(
    '/ai/logistique/recommendations/:id/accept',
    { preHandler: [requireAuth, requireRole('provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = (request as any).jwtUser;

      const { status, data } = await aiPost(
        `/internal/logistique/recommendations/${id}/accept`,
        { accepted_by: user?.id ?? 'unknown' },
      );
      return reply.status(status).send(data);
    },
  );

  // POST /ai/logistique/recommendations/:id/reject
  fastify.post(
    '/ai/logistique/recommendations/:id/reject',
    { preHandler: [requireAuth, requireRole('provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = (request as any).jwtUser;
      const body = z.object({
        reason: z.string().min(3),
      }).parse(request.body);

      const { status, data } = await aiPost(
        `/internal/logistique/recommendations/${id}/reject`,
        {
          rejected_by: user?.id ?? 'unknown',
          reason: body.reason,
        },
      );
      return reply.status(status).send(data);
    },
  );

  // GET /ai/logistique/routes — GeoJSON des routes PENDING (entrepôt → sinistre)
  fastify.get(
    '/ai/logistique/routes',
    { preHandler: [requireAuth, requireRole('provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/logistique/routes');
      return reply.status(status).send(data);
    },
  );
}
