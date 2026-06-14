/**
 * Routes proxy vers l'Agent 10 — Renseignement Militaire & Sécuritaire (service ai-prediction).
 * RBAC : accès RESTRICTED pour les données opérationnelles.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/jwt.js';
import { aiGet, aiPost } from '../services/aiClient.js';

const RESTRICTED_ROLES = ['humanitarian_partner', 'national_decision_maker', 'system_admin'] as const;

export async function renseignementRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /renseignement/status
  fastify.get(
    '/renseignement/status',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/renseignement/status');
      return reply.status(status).send(data);
    },
  );

  // GET /renseignement/threat-assessment
  fastify.get(
    '/renseignement/threat-assessment',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/renseignement/threat-assessment');
      return reply.status(status).send(data);
    },
  );

  // GET /renseignement/events
  fastify.get(
    '/renseignement/events',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (request, reply) => {
      const { category, p_code } = z.object({
        category: z.string().optional(),
        p_code: z.string().optional(),
      }).parse(request.query);
      const params: Record<string, string> = {};
      if (category) params.category = category;
      if (p_code)   params.p_code   = p_code;
      const { status, data } = await aiGet('/internal/renseignement/events', params);
      return reply.status(status).send(data);
    },
  );

  // GET /renseignement/bulletin/latest
  fastify.get(
    '/renseignement/bulletin/latest',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/renseignement/bulletin/latest');
      return reply.status(status).send(data);
    },
  );

  // GET /renseignement/military-activity
  fastify.get(
    '/renseignement/military-activity',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (request, reply) => {
      const { p_code } = z.object({ p_code: z.string().optional() }).parse(request.query);
      const params: Record<string, string> = {};
      if (p_code) params.p_code = p_code;
      const { status, data } = await aiGet('/internal/renseignement/military-activity', params);
      return reply.status(status).send(data);
    },
  );

  // GET /renseignement/security-incidents
  fastify.get(
    '/renseignement/security-incidents',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (request, reply) => {
      const { p_code } = z.object({ p_code: z.string().optional() }).parse(request.query);
      const params: Record<string, string> = {};
      if (p_code) params.p_code = p_code;
      const { status, data } = await aiGet('/internal/renseignement/security-incidents', params);
      return reply.status(status).send(data);
    },
  );

  // GET /renseignement/infrastructure-damage
  fastify.get(
    '/renseignement/infrastructure-damage',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (request, reply) => {
      const { p_code } = z.object({ p_code: z.string().optional() }).parse(request.query);
      const params: Record<string, string> = {};
      if (p_code) params.p_code = p_code;
      const { status, data } = await aiGet('/internal/renseignement/infrastructure-damage', params);
      return reply.status(status).send(data);
    },
  );

  // POST /renseignement/search
  fastify.post(
    '/renseignement/search',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (request, reply) => {
      const body = z.object({
        query:    z.string().optional(),
        province: z.string().optional(),
        type:     z.string().optional(),
      }).parse(request.body);
      const { status, data } = await aiPost('/internal/renseignement/search', body);
      return reply.status(status).send(data);
    },
  );
}
