/**
 * Hub de collecte — santé des sources de données.
 * Agrège l'état de tous les connecteurs et sources en un seul endpoint.
 */
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/jwt.js';
import { aiGet } from '../services/aiClient.js';

// Catalogue statique : sources connues avec leurs métadonnées fixes
// Les sources dynamiques (VeilleAgent) viennent de /internal/veille/health
const SOURCE_META: Record<string, { nom: string; agent: string; categorie: string; fiabilite: number; frequence_min: number }> = {
  // VeilleAgent connectors
  reliefweb:              { nom: 'ReliefWeb',                agent: 'veille',        categorie: 'CATASTROPHE',          fiabilite: 0.88, frequence_min: 180 },
  open_meteo:             { nom: 'Open-Meteo',               agent: 'veille',        categorie: 'MÉTÉO',                fiabilite: 0.85, frequence_min: 360 },
  fews_net:               { nom: 'FEWS NET',                 agent: 'veille',        categorie: 'SÉCURITÉ ALIMENTAIRE', fiabilite: 0.90, frequence_min: 1440 },
  ocha_hdx:               { nom: 'OCHA HDX',                 agent: 'veille',        categorie: 'HUMANITAIRE',          fiabilite: 0.92, frequence_min: 720 },
  mettelsat:              { nom: 'MettelSat',                agent: 'veille',        categorie: 'TÉLÉCOMMUNICATIONS',   fiabilite: 0.80, frequence_min: 60 },
  firms:                  { nom: 'NASA FIRMS',               agent: 'veille',        categorie: 'FEUX',                 fiabilite: 0.82, frequence_min: 180 },
  reliefweb_conflict:     { nom: 'ReliefWeb Conflits',       agent: 'veille',        categorie: 'CONFLIT',              fiabilite: 0.85, frequence_min: 180 },
  ucdp:                   { nom: 'UCDP GED',                 agent: 'veille',        categorie: 'CONFLIT',              fiabilite: 0.94, frequence_min: 1440 },
  gdelt:                  { nom: 'GDELT',                    agent: 'veille',        categorie: 'MÉDIA/CONFLIT',        fiabilite: 0.72, frequence_min: 360 },
  kivu_security_tracker:  { nom: 'Kivu Security Tracker',    agent: 'veille',        categorie: 'CONFLIT EST-RDC',      fiabilite: 0.88, frequence_min: 720 },
  ohchr:                  { nom: 'OHCHR',                    agent: 'veille',        categorie: 'DROITS HUMAINS',       fiabilite: 0.90, frequence_min: 1440 },
  acled:                  { nom: 'ACLED',                    agent: 'veille',        categorie: 'CONFLIT',              fiabilite: 0.92, frequence_min: 360 },
};

// Sources non-VeilleAgent — état inféré depuis le statut des agents
const STATIC_SOURCES = [
  { id: 'radio_okapi',   nom: 'Radio Okapi',           agent: 'renseignement', categorie: 'SÉCURITÉ',   fiabilite: 0.85, frequence_min: 120 },
  { id: 'acled_deep',    nom: 'ACLED Renseignement',   agent: 'renseignement', categorie: 'CONFLIT',    fiabilite: 0.92, frequence_min: 120 },
  { id: 'kmp_rss',       nom: 'Kivu Morning Post RSS', agent: 'renseignement', categorie: 'SÉCURITÉ',   fiabilite: 0.80, frequence_min: 120 },
  { id: 'kmp_youtube',   nom: 'Kivu Morning Post YT',  agent: 'renseignement', categorie: 'SÉCURITÉ',   fiabilite: 0.75, frequence_min: 120 },
  { id: 'presse_rdc',    nom: 'Presse congolaise',     agent: 'renseignement', categorie: 'GÉNÉRAL',    fiabilite: 0.70, frequence_min: 120 },
  { id: 'telesud_rens',  nom: 'Telesud (renseignement)',agent: 'renseignement',categorie: 'GÉNÉRAL',    fiabilite: 0.67, frequence_min: 120 },
  { id: 'presse_media',  nom: 'Presse + BBC/France24', agent: 'conflit',       categorie: 'CONFLIT',    fiabilite: 0.75, frequence_min: 120 },
  { id: 'telesud_conf',  nom: 'Telesud (conflits)',    agent: 'conflit',       categorie: 'CONFLIT',    fiabilite: 0.67, frequence_min: 120 },
  { id: 'views',         nom: 'VIEWS (Uppsala/PRIO)',  agent: 'conflit',       categorie: 'PRÉVISION',  fiabilite: 0.90, frequence_min: 10080 },
  { id: 'oms_don',       nom: 'OMS Disease Outbreaks', agent: 'epidemie',      categorie: 'ÉPIDÉMIE',   fiabilite: 0.97, frequence_min: 240 },
  { id: 'promedmail',    nom: 'ProMED Mail',           agent: 'epidemie',      categorie: 'ÉPIDÉMIE',   fiabilite: 0.88, frequence_min: 240 },
  { id: 'africa_cdc',   nom: 'Africa CDC',             agent: 'epidemie',      categorie: 'ÉPIDÉMIE',   fiabilite: 0.90, frequence_min: 720 },
  { id: 'reliefweb_sante', nom: 'ReliefWeb Santé',    agent: 'epidemie',      categorie: 'ÉPIDÉMIE',   fiabilite: 0.88, frequence_min: 240 },
  { id: 'telesud_epi',   nom: 'Telesud (santé)',       agent: 'epidemie',      categorie: 'ÉPIDÉMIE',   fiabilite: 0.67, frequence_min: 240 },
  { id: 'gdacs_cat',     nom: 'GDACS',                 agent: 'catastrophes',  categorie: 'CATASTROPHE',fiabilite: 0.93, frequence_min: 30 },
];

function minsSince(isoStr: string | null | undefined): number | null {
  if (!isoStr) return null;
  try {
    return Math.round((Date.now() - new Date(isoStr).getTime()) / 60_000);
  } catch {
    return null;
  }
}

export async function hubRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/hub/sources/sante',
    { preHandler: [requireAuth] },
    async (_request, reply) => {
      const now = new Date().toISOString();

      // ── Données dynamiques VeilleAgent ──────────────────────────────────────
      let veilleConnectors: any[] = [];
      try {
        const { data } = await aiGet('/internal/veille/health');
        veilleConnectors = (data as any)?.connectors ?? [];
      } catch { /* graceful */ }

      // ── Statut des agents pour les sources statiques ─────────────────────────
      let agentStatusMap: Record<string, string> = {};
      let agentMetrics: Record<string, any> = {};
      try {
        const { data } = await aiGet('/internal/agents/status');
        for (const a of (data as any)?.agents ?? []) {
          agentStatusMap[a.id] = a.status;
          agentMetrics[a.id] = a.metrics ?? {};
        }
      } catch { /* graceful */ }

      // ── Construire la liste unifiée ──────────────────────────────────────────
      const sources: any[] = [];

      // 1. Connecteurs VeilleAgent (données temps réel)
      for (const c of veilleConnectors) {
        const meta = SOURCE_META[c.source_id] ?? {
          nom: c.source_id,
          agent: 'veille',
          categorie: 'GÉNÉRAL',
          fiabilite: 0.70,
          frequence_min: 360,
        };
        const minutesSince = minsSince(c.last_success);
        const retard = minutesSince != null && minutesSince > meta.frequence_min * 2;

        let statut: string;
        if (c.circuit_open) {
          statut = 'ERROR';
        } else if (!c.healthy || (c.consecutive_failures ?? 0) > 0) {
          statut = 'DEGRADED';
        } else if (retard) {
          statut = 'DEGRADED';
        } else {
          statut = 'OK';
        }

        sources.push({
          id:                           c.source_id,
          nom:                          meta.nom,
          agent:                        meta.agent,
          categorie:                    meta.categorie,
          fiabilite:                    meta.fiabilite,
          frequence_min:                meta.frequence_min,
          statut_sante:                 statut,
          derniere_collecte:            c.last_success ?? null,
          temps_ecoule_min:             minutesSince,
          nb_evenements:                c.last_raw_count ?? null,
          nb_nouveaux:                  c.last_new_count ?? null,
          circuit_ouvert:               c.circuit_open ?? false,
          erreurs_consecutives:         c.consecutive_failures ?? 0,
          note:                         c.last_error ?? null,
          dynamique:                    true,
        });
      }

      // 2. Sources statiques (état inféré depuis le statut de l'agent parent)
      for (const s of STATIC_SOURCES) {
        // Déjà couverte par les connecteurs VeilleAgent ?
        if (sources.find(x => x.id === s.id)) continue;

        const agentStatus = agentStatusMap[s.agent] ?? 'unknown';
        const metrics = agentMetrics[s.agent] ?? {};
        const hasData = (metrics.events_stored ?? metrics.active_clusters ?? metrics.assessments ?? 0) > 0;

        let statut: string;
        if (agentStatus === 'error') {
          statut = 'ERROR';
        } else if (agentStatus === 'degraded' || (agentStatus === 'ok' && !hasData)) {
          statut = 'DEGRADED';
        } else if (agentStatus === 'ok') {
          statut = 'OK';
        } else {
          statut = 'UNKNOWN';
        }

        sources.push({
          id:                 s.id,
          nom:                s.nom,
          agent:              s.agent,
          categorie:          s.categorie,
          fiabilite:          s.fiabilite,
          frequence_min:      s.frequence_min,
          statut_sante:       statut,
          derniere_collecte:  null,
          temps_ecoule_min:   null,
          nb_evenements:      null,
          nb_nouveaux:        null,
          circuit_ouvert:     false,
          erreurs_consecutives: 0,
          note:               null,
          dynamique:          false,
        });
      }

      // ── Tri : erreurs d'abord, puis dégradées, puis OK ─────────────────────
      const ORDER: Record<string, number> = { ERROR: 0, DEGRADED: 1, UNKNOWN: 2, OK: 3 };
      sources.sort((a, b) => (ORDER[a.statut_sante] ?? 4) - (ORDER[b.statut_sante] ?? 4));

      const ok      = sources.filter(s => s.statut_sante === 'OK').length;
      const degraded = sources.filter(s => s.statut_sante === 'DEGRADED').length;
      const errors  = sources.filter(s => s.statut_sante === 'ERROR').length;
      const unknown = sources.filter(s => s.statut_sante === 'UNKNOWN').length;

      return reply.send({
        sources,
        total:    sources.length,
        sains:    ok,
        degrades: degraded,
        erreurs:  errors,
        inconnus: unknown,
        genere_le: now,
      });
    },
  );
}
