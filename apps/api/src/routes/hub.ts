/**
 * Hub de collecte — registre + santé des sources de données.
 * GET  /hub/sources           — liste les sources (auth)
 * POST /hub/sources           — ajoute une source (system_admin)
 * PATCH /hub/sources/:id      — modifie une source (system_admin)
 * DELETE /hub/sources/:id     — désactive une source (system_admin)
 * POST /hub/sources/test      — teste une URL avant ajout (system_admin)
 * GET  /hub/sources/sante     — santé agrégée en temps réel (auth)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import axios from 'axios';
import { requireAuth, requireRole } from '../auth/jwt.js';
import { aiGet } from '../services/aiClient.js';
import { sql } from '../db.js';

// ── Fallback catalogue si la DB est indisponible ───────────────────────────────
const _VEILLE_META: Record<string, { nom: string; categorie: string; fiabilite: number; frequence_min: number }> = {
  reliefweb:             { nom: 'ReliefWeb',              categorie: 'CATASTROPHE',          fiabilite: 0.88, frequence_min: 180  },
  open_meteo:            { nom: 'Open-Meteo',             categorie: 'MÉTÉO',                fiabilite: 0.85, frequence_min: 360  },
  fews_net:              { nom: 'FEWS NET',               categorie: 'SÉCURITÉ ALIMENTAIRE', fiabilite: 0.90, frequence_min: 1440 },
  ocha_hdx:              { nom: 'OCHA HDX',               categorie: 'HUMANITAIRE',          fiabilite: 0.92, frequence_min: 720  },
  mettelsat:             { nom: 'MettelSat',              categorie: 'TÉLÉCOMMUNICATIONS',   fiabilite: 0.80, frequence_min: 60   },
  firms:                 { nom: 'NASA FIRMS',             categorie: 'FEUX',                 fiabilite: 0.82, frequence_min: 180  },
  reliefweb_conflict:    { nom: 'ReliefWeb Conflits',     categorie: 'CONFLIT',              fiabilite: 0.85, frequence_min: 180  },
  ucdp:                  { nom: 'UCDP GED',              categorie: 'CONFLIT',              fiabilite: 0.94, frequence_min: 1440 },
  gdelt:                 { nom: 'GDELT',                  categorie: 'MÉDIA/CONFLIT',        fiabilite: 0.72, frequence_min: 360  },
  kivu_security_tracker: { nom: 'Kivu Security Tracker',  categorie: 'CONFLIT EST-RDC',      fiabilite: 0.88, frequence_min: 720  },
  ohchr:                 { nom: 'OHCHR',                  categorie: 'DROITS HUMAINS',       fiabilite: 0.90, frequence_min: 1440 },
  acled:                 { nom: 'ACLED',                  categorie: 'CONFLIT',              fiabilite: 0.92, frequence_min: 360  },
};

function minsSince(isoStr: string | null | undefined): number | null {
  if (!isoStr) return null;
  try { return Math.round((Date.now() - new Date(isoStr).getTime()) / 60_000); } catch { return null; }
}

// ── Schémas de validation ────────────────────────────────────────────────────

const SourceCreateSchema = z.object({
  nom:              z.string().min(2).max(120),
  type_source:      z.enum(['RSS', 'API', 'WEB', 'RESEAU_SOCIAL', 'DOCUMENT']),
  categorie:        z.string().max(50).optional(),
  url:              z.string().url(),
  config:           z.record(z.unknown()).optional(),
  fiabilite:        z.number().min(0).max(1).default(0.70),
  langue:           z.string().max(5).default('fr'),
  frequence_minutes:z.number().int().min(5).max(10080).default(360),
  note:             z.string().max(500).optional(),
});

const SourceUpdateSchema = SourceCreateSchema.partial().extend({
  actif:            z.boolean().optional(),
  statut_sante:     z.enum(['OK','DEGRADED','ERROR','UNKNOWN','RATE_LIMITED','DISABLED']).optional(),
});

export async function hubRoutes(fastify: FastifyInstance): Promise<void> {

  // ── GET /hub/sources — liste depuis la DB ─────────────────────────────────
  fastify.get(
    '/hub/sources',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { actif } = z.object({ actif: z.coerce.boolean().default(true) }).parse(request.query);
      const rows = await sql<any[]>`
        SELECT id, nom, type_source, categorie, agent, connector_id,
               url, config, fiabilite, langue, frequence_minutes,
               actif, statut_sante, derniere_collecte, note, cree_le
        FROM source_collecte
        WHERE actif = ${actif}
        ORDER BY categorie, nom
      `;
      return reply.send({ sources: rows, total: rows.length });
    },
  );

  // ── POST /hub/sources/test — teste une URL avant ajout ───────────────────
  fastify.post(
    '/hub/sources/test',
    { preHandler: [requireAuth, requireRole('system_admin')] },
    async (request, reply) => {
      const { url, type_source } = z.object({
        url:         z.string().url(),
        type_source: z.string().default('RSS'),
      }).parse(request.body);

      try {
        const resp = await axios.get(url, {
          timeout: 10_000,
          headers: { 'User-Agent': 'SINAUR-RDC/1.0' },
          responseType: 'text',
          maxContentLength: 500_000,
          validateStatus: () => true,
        });

        const contentType = resp.headers['content-type'] ?? '';
        const preview: string[] = [];

        if (type_source === 'RSS' || contentType.includes('xml') || contentType.includes('rss')) {
          // Extraire les premiers titres RSS
          const matches = resp.data.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g) ?? [];
          for (const m of matches.slice(1, 5)) {
            const t = m.replace(/<[^>]+>/g, '').trim();
            if (t) preview.push(t);
          }
        }

        return reply.send({
          ok:           resp.status >= 200 && resp.status < 400,
          status_code:  resp.status,
          content_type: contentType,
          preview,
          message:      resp.status < 400 ? 'Source accessible' : `HTTP ${resp.status}`,
        });
      } catch (err: any) {
        return reply.send({
          ok: false,
          status_code: 0,
          content_type: '',
          preview: [],
          message: err?.message ?? 'Connexion impossible',
        });
      }
    },
  );

  // ── POST /hub/sources — ajoute une source ────────────────────────────────
  fastify.post(
    '/hub/sources',
    { preHandler: [requireAuth, requireRole('system_admin')] },
    async (request, reply) => {
      const body = SourceCreateSchema.parse(request.body);
      const user = (request as any).jwtUser;

      const [row] = await sql<any[]>`
        INSERT INTO source_collecte
          (nom, type_source, categorie, url, config, fiabilite, langue,
           frequence_minutes, note, ajoute_par)
        VALUES
          (${body.nom}, ${body.type_source}, ${body.categorie ?? null},
           ${body.url}, ${JSON.stringify(body.config ?? {})},
           ${body.fiabilite}, ${body.langue}, ${body.frequence_minutes},
           ${body.note ?? null}, ${user?.email ?? user?.sub ?? 'admin'})
        RETURNING id, nom, type_source, categorie, url, fiabilite,
                  frequence_minutes, actif, statut_sante, cree_le
      `;
      return reply.status(201).send({ source: row, ok: true });
    },
  );

  // ── PATCH /hub/sources/:id — modifie une source ──────────────────────────
  fastify.patch(
    '/hub/sources/:id',
    { preHandler: [requireAuth, requireRole('system_admin')] },
    async (request, reply) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
      const body = SourceUpdateSchema.parse(request.body);

      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) { sets.push(`${k} = $${i++}`); vals.push(k === 'config' ? JSON.stringify(v) : v); }
      }
      if (sets.length === 0) return reply.status(400).send({ error: 'No fields to update' });

      const [row] = await sql.unsafe(
        `UPDATE source_collecte SET ${sets.join(', ')}, mis_a_jour_le = NOW()
         WHERE id = $${i} RETURNING id, nom, statut_sante, actif`,
        [...vals, id],
      );
      if (!row) return reply.status(404).send({ error: 'Source not found' });
      return reply.send({ source: row, ok: true });
    },
  );

  // ── DELETE /hub/sources/:id — désactive (soft-delete) ────────────────────
  fastify.delete(
    '/hub/sources/:id',
    { preHandler: [requireAuth, requireRole('system_admin')] },
    async (request, reply) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
      const [row] = await sql<any[]>`
        UPDATE source_collecte
        SET actif = false, statut_sante = 'DISABLED', mis_a_jour_le = NOW()
        WHERE id = ${id}
        RETURNING id, nom
      `;
      if (!row) return reply.status(404).send({ error: 'Source not found' });
      return reply.send({ ok: true, desactivee: row.nom });
    },
  );

  // ── GET /hub/sources/sante — santé agrégée ────────────────────────────────
  fastify.get(
    '/hub/sources/sante',
    { preHandler: [requireAuth] },
    async (_request, reply) => {
      const now = new Date().toISOString();

      // DB metadata (fiabilité, catégorie, frequence depuis la table)
      let dbMeta: Record<string, any> = {};
      try {
        const rows = await sql<any[]>`
          SELECT connector_id, nom, categorie, fiabilite, frequence_minutes, statut_sante
          FROM source_collecte WHERE actif = true AND connector_id IS NOT NULL
        `;
        for (const r of rows) dbMeta[r.connector_id] = r;
      } catch { /* use fallback */ }

      // VeilleAgent connector health (temps réel)
      let veilleConnectors: any[] = [];
      try {
        const { data } = await aiGet('/internal/veille/health');
        veilleConnectors = (data as any)?.connectors ?? [];
      } catch { /* graceful */ }

      // Agent-level status for static sources
      let agentStatusMap: Record<string, string> = {};
      let agentMetrics: Record<string, any> = {};
      try {
        const { data } = await aiGet('/internal/agents/status');
        for (const a of (data as any)?.agents ?? []) {
          agentStatusMap[a.id] = a.status;
          agentMetrics[a.id] = a.metrics ?? {};
        }
      } catch { /* graceful */ }

      const sources: any[] = [];

      // 1. Connecteurs VeilleAgent (données dynamiques)
      for (const c of veilleConnectors) {
        const meta = dbMeta[c.source_id] ?? _VEILLE_META[c.source_id] ?? {
          nom: c.source_id, categorie: 'GÉNÉRAL', fiabilite: 0.70, frequence_minutes: 360,
        };
        const freqMin: number = meta.frequence_minutes ?? meta.frequence_min ?? 360;
        const mins = minsSince(c.last_success);
        const retard = mins != null && mins > freqMin * 2;

        const statut =
          c.circuit_open                           ? 'ERROR'   :
          !c.healthy || (c.consecutive_failures ?? 0) > 0 ? 'DEGRADED':
          retard                                   ? 'DEGRADED': 'OK';

        sources.push({
          id:                   c.source_id,
          nom:                  meta.nom,
          agent:                'veille',
          categorie:            meta.categorie,
          fiabilite:            Number(meta.fiabilite ?? 0.70),
          frequence_min:        freqMin,
          statut_sante:         statut,
          derniere_collecte:    c.last_success ?? null,
          temps_ecoule_min:     mins,
          nb_evenements:        c.last_raw_count ?? null,
          nb_nouveaux:          c.last_new_count ?? null,
          circuit_ouvert:       c.circuit_open ?? false,
          erreurs_consecutives: c.consecutive_failures ?? 0,
          note:                 c.last_error ?? null,
          dynamique:            true,
        });
      }

      // 2. Sources non-VeilleAgent depuis la DB (état inféré)
      try {
        const staticRows = await sql<any[]>`
          SELECT id, nom, type_source, categorie, agent, connector_id,
                 fiabilite, frequence_minutes, statut_sante, derniere_collecte, note
          FROM source_collecte
          WHERE actif = true
            AND (connector_id IS NULL OR connector_id NOT IN (
              ${sql(veilleConnectors.map(c => c.source_id))}
            ))
          ORDER BY categorie, nom
        `;
        for (const r of staticRows) {
          const agentStatus  = agentStatusMap[r.agent] ?? 'unknown';
          const metrics      = agentMetrics[r.agent] ?? {};
          const hasData      = (metrics.events_stored ?? metrics.active_clusters ?? metrics.assessments ?? 0) > 0;

          const statut =
            agentStatus === 'error'                        ? 'ERROR'   :
            agentStatus === 'degraded'                     ? 'DEGRADED':
            agentStatus === 'ok' && !hasData               ? 'DEGRADED':
            agentStatus === 'ok'                           ? 'OK'      : 'UNKNOWN';

          sources.push({
            id:                   r.connector_id ?? `sc-${r.id}`,
            nom:                  r.nom,
            agent:                r.agent ?? '—',
            categorie:            r.categorie ?? 'GÉNÉRAL',
            fiabilite:            Number(r.fiabilite ?? 0.70),
            frequence_min:        r.frequence_minutes ?? 360,
            statut_sante:         statut,
            derniere_collecte:    r.derniere_collecte ?? null,
            temps_ecoule_min:     minsSince(r.derniere_collecte),
            nb_evenements:        null,
            nb_nouveaux:          null,
            circuit_ouvert:       false,
            erreurs_consecutives: 0,
            note:                 r.note ?? null,
            dynamique:            false,
          });
        }
      } catch { /* DB unavailable — static fallback handled above */ }

      const ORDER: Record<string, number> = { ERROR: 0, DEGRADED: 1, UNKNOWN: 2, OK: 3 };
      sources.sort((a, b) => (ORDER[a.statut_sante] ?? 4) - (ORDER[b.statut_sante] ?? 4));

      const ok      = sources.filter(s => s.statut_sante === 'OK').length;
      const degraded = sources.filter(s => s.statut_sante === 'DEGRADED').length;
      const errors  = sources.filter(s => s.statut_sante === 'ERROR').length;
      const unknown = sources.filter(s => s.statut_sante === 'UNKNOWN').length;

      return reply.send({
        sources, total: sources.length,
        sains: ok, degrades: degraded, erreurs: errors, inconnus: unknown,
        genere_le: now,
      });
    },
  );
}
