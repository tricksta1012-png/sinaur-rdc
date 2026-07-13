/**
 * Routes /flux — Flux commun d'événements SINAUR-RDC
 *
 * Toutes les pages lisent depuis cette table pivot.
 * Écrit par : Agent Renseignement, GDACS, Épidémie, Terrain.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/jwt.js';
import { sql } from '../db.js';

export async function fluxRoutes(fastify: FastifyInstance): Promise<void> {

  // ── GET /flux/evenements ──────────────────────────────────────────────────
  fastify.get(
    '/flux/evenements',
    { preHandler: [requireAuth] },
    async (request, _reply) => {
      const q = z.object({
        type_evenement: z.string().optional(),
        province_pcode: z.string().optional(),
        statut:         z.string().optional(),
        depuis_jours:   z.coerce.number().int().min(1).max(180).default(30),
        limit:          z.coerce.number().int().min(1).max(200).default(50),
        gravite:        z.string().optional(),
      }).parse(request.query);

      return sql`
        SELECT
          ef.id, ef.source_agent, ef.type_evenement,
          ef.titre, ef.description,
          ef.province_pcode, ef.lat, ef.lon,
          ef.fiabilite, ef.statut_verification, ef.nb_sources,
          ef.gravite, ef.gravite_score, ef.ampleur,
          ef.impacte_statut, ef.guerre_signalee, ef.source_url,
          ef.date_evenement, ef.cree_le,
          ad.name_fr AS province_nom
        FROM evenement_flux ef
        LEFT JOIN admin_divisions ad
          ON ad.pcode = ef.province_pcode AND ad.level = 1
        WHERE ef.date_evenement >= NOW() - (${q.depuis_jours}::int || ' days')::interval
          AND ef.statut_verification <> 'INFIRME'
          ${q.type_evenement ? sql`AND ef.type_evenement = ${q.type_evenement}` : sql``}
          ${q.province_pcode ? sql`AND ef.province_pcode = ${q.province_pcode}` : sql``}
          ${q.statut         ? sql`AND ef.statut_verification = ${q.statut}` : sql``}
          ${q.gravite        ? sql`AND ef.gravite = ${q.gravite}` : sql``}
        ORDER BY ef.date_evenement DESC
        LIMIT ${q.limit}
      `;
    },
  );

  // ── GET /flux/statut-provinces ───────────────────────────────────────────
  // Agrège le flux par province pour la double couche carte
  fastify.get(
    '/flux/statut-provinces',
    { preHandler: [requireAuth] },
    async (_request, _reply) => {
      const rows = await sql<{
        pcode: string;
        niveau: number;
        confirmes: number;
        aConfirmer: number;
        fiabiliteMax: number;
      }[]>`
        SELECT
          province_pcode                                    AS pcode,
          MAX(CASE
            WHEN impacte_statut AND gravite = 'CRITIQUE' THEN 4
            WHEN impacte_statut AND gravite = 'ELEVEE'   THEN 3
            WHEN statut_verification = 'A_CORROBORER'    THEN 1
            ELSE 0
          END)::int                                         AS niveau,
          COUNT(*) FILTER (
            WHERE statut_verification IN ('CORROBORE','PROBABLE')
          )::int                                            AS confirmes,
          COUNT(*) FILTER (
            WHERE statut_verification = 'A_CORROBORER'
          )::int                                            AS a_confirmer,
          MAX(fiabilite)::float                             AS fiabilite_max
        FROM evenement_flux
        WHERE date_evenement >= NOW() - INTERVAL '30 days'
          AND statut_verification <> 'INFIRME'
          AND province_pcode IS NOT NULL
        GROUP BY province_pcode
      `;

      const STATUT: Record<number, string> = {
        4: 'CRISE', 3: 'ALERTE', 1: 'VIGILANCE', 0: 'NORMAL',
      };
      return rows.map(r => ({
        pcode:        r.pcode,
        statut:       STATUT[r.niveau] ?? 'NORMAL',
        confirmes:    r.confirmes,
        aConfirmer:   r.aConfirmer,
        fiabiliteMax: r.fiabiliteMax,
      }));
    },
  );

  // ── GET /flux/alerte-precoce — signaux graves récents (≤24h) ─────────────
  fastify.get(
    '/flux/alerte-precoce',
    { preHandler: [requireAuth] },
    async (_request, _reply) => {
      return sql`
        SELECT
          ef.id, ef.source_agent, ef.titre,
          ef.province_pcode, ef.gravite, ef.fiabilite,
          ef.statut_verification, ef.date_evenement,
          ad.name_fr AS province_nom
        FROM evenement_flux ef
        LEFT JOIN admin_divisions ad
          ON ad.pcode = ef.province_pcode AND ad.level = 1
        WHERE ef.gravite IN ('ELEVEE','CRITIQUE')
          AND ef.date_evenement >= NOW() - INTERVAL '24 hours'
          AND ef.statut_verification <> 'INFIRME'
        ORDER BY ef.date_evenement DESC
        LIMIT 20
      `;
    },
  );
}
