/**
 * Routes proxy vers l'Agent 2 — Prédiction des Risques (service ai-prediction).
 * RBAC géré ici ; calcul effectué dans le microservice Python.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/jwt.js';
import { aiGet, aiPost } from '../services/aiClient.js';

export async function predictionRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /predictions/risks — scores de risque actuels (filtrables)
  fastify.get(
    '/predictions/risks',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { horizon, province, type } = z.object({
        horizon: z.coerce.number().int().min(1).max(90).default(7),
        province: z.string().optional(),
        type: z.string().optional(),
      }).parse(request.query);

      const { status, data } = await aiGet('/internal/prediction/risks', {
        horizon,
        ...(province ? { province } : {}),
        ...(type ? { type } : {}),
      });
      return reply.status(status).send(data);
    },
  );

  // GET /predictions/risk-map/:horizon — GeoJSON carte de risque (7, 30 ou 90 jours)
  fastify.get(
    '/predictions/risk-map/:horizon',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { horizon } = z.object({
        horizon: z.coerce.number().int().refine((v) => [7, 30, 90].includes(v), {
          message: 'horizon doit être 7, 30 ou 90',
        }),
      }).parse(request.params);
      const { type } = z.object({ type: z.string().optional() }).parse(request.query);

      const { status, data } = await aiGet(`/internal/prediction/map/${horizon}`, type ? { type } : {});
      return reply.status(status).send(data);
    },
  );

  // GET /predictions/alerts/pending — alertes CAP en attente de validation humaine
  fastify.get(
    '/predictions/alerts/pending',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/prediction/alerts/pending');
      return reply.status(status).send(data);
    },
  );

  // POST /predictions/alerts/:id/validate — valider une alerte CRITIQUE
  fastify.post(
    '/predictions/alerts/:id/validate',
    { preHandler: [requireAuth, requireRole('national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.jwtUser;
      const { status, data } = await aiPost(`/internal/prediction/alerts/${id}/validate`, {
        validated_by: user.id,
        validated_at: new Date().toISOString(),
      });
      return reply.status(status).send(data);
    },
  );

  // POST /predictions/alerts/:id/reject — rejeter une alerte avec motif
  fastify.post(
    '/predictions/alerts/:id/reject',
    { preHandler: [requireAuth, requireRole('national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.jwtUser;
      const body = z.object({ reason: z.string().min(5) }).parse(request.body);
      const { status, data } = await aiPost(`/internal/prediction/alerts/${id}/reject`, {
        rejected_by: user.id,
        reason: body.reason,
        rejected_at: new Date().toISOString(),
      });
      return reply.status(status).send(data);
    },
  );

  // GET /predictions/history/:pcode — historique des scores de risque pour un P-code
  fastify.get(
    '/predictions/history/:pcode',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { pcode } = request.params as { pcode: string };
      const { status, data } = await aiGet(`/internal/prediction/history/${pcode}`);
      return reply.status(status).send(data);
    },
  );

  // GET /predictions/models — liste des modèles actifs et leurs versions
  fastify.get(
    '/predictions/models',
    { preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/prediction/models');
      return reply.status(status).send(data);
    },
  );

  // POST /predictions/refresh — déclencher un recalcul complet (admin)
  fastify.post(
    '/predictions/refresh',
    { preHandler: [requireAuth, requireRole('system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiPost('/internal/prediction/refresh');
      return reply.status(status).send(data);
    },
  );
}
