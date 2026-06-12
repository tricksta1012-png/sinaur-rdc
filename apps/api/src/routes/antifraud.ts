/**
 * Routes proxy vers l'Agent 3 — Anti-Fraude & Déduplication (service ai-prediction).
 * La vérification de dossier est appelée automatiquement lors de l'inscription
 * au Registre des Sinistrés (voir routes/registry.ts).
 * Ces endpoints exposent la file de revue et les statistiques aux validateurs.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/jwt.js';
import { aiGet, aiPost } from '../services/aiClient.js';

export async function antifraudRoutes(fastify: FastifyInstance): Promise<void> {

  // POST /ai/antifraud/check — vérifier un dossier sinistré (appelé par le registre)
  fastify.post(
    '/ai/antifraud/check',
    { preHandler: [requireAuth, requireRole('field_agent', 'local_validator', 'provincial_coordinator', 'territory_admin', 'system_admin')] },
    async (request, reply) => {
      const body = z.object({
        dossier: z.object({
          dossier_id: z.string(),
          nom_complet: z.string().min(2),
          date_naissance: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          taille_menage: z.number().int().min(1),
          p_code: z.string(),
          telephone: z.string().optional(),
          agent_id: z.string().optional(),
          otp_verified: z.boolean().optional(),
        }),
        context: z.object({
          sinistre_id: z.string(),
          sinistre_p_code: z.string().optional(),
          distance_to_disaster_km: z.number().optional(),
          hierarchy_validated: z.boolean().optional(),
        }),
      }).parse(request.body);

      const { status, data } = await aiPost('/internal/antifraud/check', body);
      return reply.status(status).send(data);
    },
  );

  // GET /ai/antifraud/queue — file des dossiers en attente de revue humaine
  fastify.get(
    '/ai/antifraud/queue',
    { preHandler: [requireAuth, requireRole('local_validator', 'provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/antifraud/queue');
      return reply.status(status).send(data);
    },
  );

  // GET /ai/antifraud/stats — statistiques de détection de fraude
  fastify.get(
    '/ai/antifraud/stats',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/antifraud/stats');
      return reply.status(status).send(data);
    },
  );

  // GET /ai/antifraud/duplicates — liste des doublons détectés
  fastify.get(
    '/ai/antifraud/duplicates',
    { preHandler: [requireAuth, requireRole('local_validator', 'provincial_coordinator', 'territory_admin', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/antifraud/duplicates');
      return reply.status(status).send(data);
    },
  );

  // POST /ai/antifraud/duplicates/:id/resolve — résoudre manuellement un doublon
  fastify.post(
    '/ai/antifraud/duplicates/:id/resolve',
    { preHandler: [requireAuth, requireRole('local_validator', 'provincial_coordinator', 'territory_admin', 'system_admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z.object({
        resolution: z.enum(['MERGED', 'REJECTED', 'REVIEWED']),
        note: z.string().optional(),
      }).parse(request.body);

      const { status, data } = await aiPost(`/internal/antifraud/duplicates/${id}/resolve`, {
        ...body,
        resolved_by: request.jwtUser.id,
      });
      return reply.status(status).send(data);
    },
  );
}
