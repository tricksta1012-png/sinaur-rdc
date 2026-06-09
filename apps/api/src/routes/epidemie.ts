/**
 * Routes proxy vers l'Agent 8 — Surveillance Épidémique (service ai-prediction).
 *
 * RBAC :
 *   lecture → territory_admin, national_decision_maker, system_admin
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/jwt.js';
import { aiGet } from '../services/aiClient.js';

export async function epidemieRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /ai/epidemie/clusters — clusters épidémiques actifs
  fastify.get(
    '/ai/epidemie/clusters',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { disease, province } = z.object({
        disease: z.string().optional(),
        province: z.string().optional(),
      }).parse(request.query);

      const { status, data } = await aiGet('/internal/epidemie/clusters', {
        ...(disease ? { disease } : {}),
        ...(province ? { province } : {}),
      });
      return reply.status(status).send(data);
    },
  );

  // GET /ai/epidemie/map — GeoJSON carte épidémique
  fastify.get(
    '/ai/epidemie/map',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { disease } = z.object({
        disease: z.string().optional(),
      }).parse(request.query);

      const { status, data } = await aiGet('/internal/epidemie/map', {
        ...(disease ? { disease } : {}),
      });
      return reply.status(status).send(data);
    },
  );

  // GET /ai/epidemie/alerts — alertes épidémiques actives
  fastify.get(
    '/ai/epidemie/alerts',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { level } = z.object({
        level: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      }).parse(request.query);

      const { status, data } = await aiGet('/internal/epidemie/alerts', {
        ...(level ? { level } : {}),
      });
      return reply.status(status).send(data);
    },
  );

  // GET /ai/epidemie/history/:disease — historique d'une maladie
  fastify.get(
    '/ai/epidemie/history/:disease',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { disease } = request.params as { disease: string };
      const { weeks } = z.object({
        weeks: z.coerce.number().int().min(1).max(104).default(12),
      }).parse(request.query);

      const { status, data } = await aiGet(`/internal/epidemie/history/${disease}`, { weeks });
      return reply.status(status).send(data);
    },
  );

  // GET /ai/epidemie/dashboard — tableau de bord épidémique global
  fastify.get(
    '/ai/epidemie/dashboard',
    { preHandler: [requireAuth, requireRole('territory_admin', 'national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/epidemie/dashboard');
      return reply.status(status).send(data);
    },
  );
}
