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
import { sql } from '../db.js';

export async function epidemieRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /ai/epidemie/clusters — clusters épidémiques actifs
  fastify.get(
    '/ai/epidemie/clusters',
    { preHandler: [requireAuth, requireRole('provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
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
    { preHandler: [requireAuth, requireRole('provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
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
    { preHandler: [requireAuth, requireRole('provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
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
    { preHandler: [requireAuth, requireRole('provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
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
    { preHandler: [requireAuth, requireRole('provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/epidemie/dashboard');
      return reply.status(status).send(data);
    },
  );

  // GET /ai/auto_crisis/stats — statistiques du moteur de création automatique
  fastify.get(
    '/ai/auto_crisis/stats',
    { preHandler: [requireAuth, requireRole('provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/auto_crisis/stats');
      return reply.status(status).send(data);
    },
  );

  // GET /ai/virus_emergents/status — statut de la veille virale émergente
  fastify.get(
    '/ai/virus_emergents/status',
    { preHandler: [requireAuth, requireRole('provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const { status, data } = await aiGet('/internal/virus_emergents/status');
      return reply.status(status).send(data);
    },
  );

  // GET /epidemie/zones — GeoJSON des zones épidémiques (DB direct, migration 022)
  fastify.get(
    '/epidemie/zones',
    { preHandler: [requireAuth, requireRole('provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { maladie } = z.object({ maladie: z.string().default('EBOLA') }).parse(request.query);
      try {
        const rows = await sql`
          SELECT
            id, maladie, souche, zone_sante, territoire, province, p_code,
            ST_AsGeoJSON(coordinates)::json AS coordinates,
            cas_confirmes, cas_suspects, deces_confirmes, deces_suspects,
            statut, date_premier_cas, groupes_armes_actifs, acces_humanitaire, source
          FROM epidemic_zone
          WHERE maladie = ${maladie}
            AND statut IN ('ACTIF', 'ALERTE')
          ORDER BY cas_confirmes DESC
        `;
        const features = rows.map((r: any) => ({
          type: 'Feature',
          geometry: r.coordinates,
          properties: {
            id: r.pCode, zone_sante: r.zoneSante, territoire: r.territoire,
            province: r.province, p_code: r.pCode,
            cas_confirmes: r.casConfirmes, cas_suspects: r.casSuspects,
            deces_confirmes: r.decesConfirmes, deces_suspects: r.decesSuspects,
            statut: r.statut, date_premier_cas: r.datePremierCas,
            groupes_armes: JSON.stringify(r.groupesArmesActifs ?? {}),
            has_armed_groups: Object.values(r.groupesArmesActifs ?? {}).some(Boolean),
            armed_groups_label: Object.entries(r.groupesArmesActifs ?? {})
              .filter(([, v]) => v).map(([k]) => k.replace('_', '/')).join(', '),
            acces_humanitaire: r.accesHumanitaire,
            acces_bloque: r.accesHumanitaire === 'BLOQUE',
          },
        }));
        return reply.header('Cache-Control', 'no-store').send({ type: 'FeatureCollection', features });
      } catch (err: any) {
        if (err.code === '42P01') return reply.send({ type: 'FeatureCollection', features: [], _no_migration: true });
        throw err;
      }
    },
  );

  // GET /epidemie/timeseries — courbe épidémique cumulée (DB direct)
  fastify.get(
    '/epidemie/timeseries',
    { preHandler: [requireAuth, requireRole('provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { maladie } = z.object({ maladie: z.string().default('EBOLA') }).parse(request.query);
      try {
        const rows = await sql`
          SELECT date_rapport, cas_confirmes_cumul, cas_suspects_cumul,
                 deces_confirmes_cumul, deces_suspects_cumul, nouvelles_zones
          FROM epidemic_timeseries
          WHERE maladie = ${maladie}
          ORDER BY date_rapport ASC
        `;
        return reply.header('Cache-Control', 'no-store').send({ maladie, data: rows });
      } catch (err: any) {
        if (err.code === '42P01') return reply.send({ maladie, data: [] });
        throw err;
      }
    },
  );

  // GET /epidemie/stats — agrégats par maladie (live epidemic_zone + repli epidemic_stats)
  fastify.get(
    '/epidemie/stats',
    { preHandler: [requireAuth, requireRole('provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
    async (_request, reply) => {
      const safeQuery = async <T>(query: Promise<T[]>): Promise<T[]> => {
        try { return await query; }
        catch (e: any) { if (e.code === '42P01') return []; throw e; }
      };

      const [liveRows, fallbackRows] = await Promise.all([
        safeQuery(sql<{ maladie: string; zonesActives: number; casConfirmes: number; deces: number }[]>`
          SELECT maladie,
                 COUNT(*)::int             AS zones_actives,
                 COALESCE(SUM(cas_confirmes),0)::int  AS cas_confirmes,
                 COALESCE(SUM(deces_confirmes),0)::int AS deces
          FROM epidemic_zone
          WHERE statut IN ('ACTIF','ALERTE')
          GROUP BY maladie
        `),
        safeQuery(sql<{ maladie: string; zonesActives: number; casConfirmes: number; deces: number; dateMaj: string; source: string }[]>`
          SELECT maladie, zones_actives, cas_confirmes, deces, date_maj, source
          FROM epidemic_stats
        `),
      ]);

      const stats: Record<string, { zones_actives: number; cas_confirmes: number; deces: number; date_maj: string; source: string }> = {};
      for (const r of fallbackRows) {
        stats[r.maladie] = {
          zones_actives: r.zonesActives,
          cas_confirmes: r.casConfirmes,
          deces:         r.deces,
          date_maj:      r.dateMaj ? new Date(r.dateMaj).toISOString().split('T')[0] : '',
          source:        r.source ?? 'INSP/OMS',
        };
      }
      for (const r of liveRows) {
        if (r.zonesActives === 0 && r.casConfirmes === 0) continue;
        stats[r.maladie] = {
          ...(stats[r.maladie] ?? {}),
          zones_actives: r.zonesActives,
          cas_confirmes: r.casConfirmes,
          deces:         r.deces,
          date_maj:      new Date().toISOString().split('T')[0],
          source:        'DB live',
        };
      }

      return reply.header('Cache-Control', 'no-store').send({ success: true, data: stats });
    },
  );
}
