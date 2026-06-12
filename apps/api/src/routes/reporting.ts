/**
 * Routes proxy vers l'Agent 6 — Reporting & HXL (service ai-prediction).
 *
 * RBAC :
 *   generate → national_decision_maker, system_admin
 *   lecture  → territory_admin, national_decision_maker, system_admin
 *   hxl      → humanitarian_partner, territory_admin, national_decision_maker, system_admin
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/jwt.js';
import { aiGet, aiPost } from '../services/aiClient.js';

export async function reportingRoutes(fastify: FastifyInstance): Promise<void> {

  // POST /ai/reporting/generate — générer un rapport de situation
  fastify.post(
    '/ai/reporting/generate',
    { preHandler: [requireAuth, requireRole('national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const body = z.object({
        report_type: z.string().min(1),
        period_start: z.string().optional(),
        period_end: z.string().optional(),
        provinces: z.array(z.string()).optional(),
        format: z.enum(['pdf', 'docx', 'html', 'json']).optional(),
        language: z.enum(['fr', 'en']).optional(),
      }).parse(request.body);

      const { status, data } = await aiPost('/internal/reporting/generate', {
        ...body,
        requested_by: (request as any).jwtUser?.id,
      });
      return reply.status(status).send(data);
    },
  );

  // GET /ai/reporting/reports — liste des rapports générés
  fastify.get(
    '/ai/reporting/reports',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { report_type, limit } = z.object({
        report_type: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }).parse(request.query);

      const { status, data } = await aiGet('/internal/reporting/reports', {
        ...(report_type ? { report_type } : {}),
        limit,
      });
      return reply.status(status).send(data);
    },
  );

  // GET /ai/reporting/reports/:id — détail d'un rapport
  fastify.get(
    '/ai/reporting/reports/:id',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { status, data } = await aiGet(`/internal/reporting/reports/${id}`);
      return reply.status(status).send(data);
    },
  );

  // GET /ai/reporting/hxl/latest — dernier export HXL (OCHA)
  fastify.get(
    '/ai/reporting/hxl/latest',
    { preHandler: [requireAuth, requireRole('humanitarian_partner', 'provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/reporting/hxl/latest');
      return reply.status(status).send(data);
    },
  );

  // GET /ai/reporting/hxl/history — historique des exports HXL
  fastify.get(
    '/ai/reporting/hxl/history',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { limit } = z.object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }).parse(request.query);

      const { status, data } = await aiGet('/internal/reporting/hxl/history', { limit });
      return reply.status(status).send(data);
    },
  );

  // POST /reports/publish/hdx — export vers Humanitarian Data Exchange
  fastify.post(
    '/reports/publish/hdx',
    { preHandler: [requireAuth, requireRole('national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiPost('/internal/reporting/publish/hdx', {});
      return reply.status(status).send(data);
    },
  );

  // POST /reports/publish/reliefweb — publication vers ReliefWeb
  fastify.post(
    '/reports/publish/reliefweb',
    { preHandler: [requireAuth, requireRole('national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const body = z.object({ format: z.string().optional() }).parse(request.body ?? {});
      const { status, data } = await aiPost('/internal/reporting/publish/reliefweb', body);
      return reply.status(status).send(data);
    },
  );
}
