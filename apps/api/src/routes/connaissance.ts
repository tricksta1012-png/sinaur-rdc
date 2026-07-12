/**
 * Routes proxy — Moteur de Connaissance Évolutif SINAUR-RDC.
 * Graphe de connaissance : entités (groupes armés, lieux, personnes, événements),
 * relations, journal d'apprentissage.
 * RBAC : accès RESTRICTED.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/jwt.js';
import { aiGet, aiPost } from '../services/aiClient.js';

const RESTRICTED_ROLES = ['humanitarian_partner', 'national_decision_maker', 'system_admin'] as const;

export async function connaissanceRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /connaissance/status
  fastify.get('/connaissance/status',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (_req, reply) => {
      const { status, data } = await aiGet('/internal/connaissance/status');
      return reply.status(status).send(data);
    },
  );

  // GET /connaissance/entites
  fastify.get('/connaissance/entites',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (request, reply) => {
      const { type_entite, statut, q, limit, offset } = z.object({
        type_entite: z.string().optional(),
        statut:      z.string().optional(),
        q:           z.string().optional(),
        limit:       z.coerce.number().int().min(1).max(200).default(50),
        offset:      z.coerce.number().int().min(0).default(0),
      }).parse(request.query);
      const params: Record<string, string> = { limit: String(limit), offset: String(offset) };
      if (type_entite) params.type_entite = type_entite;
      if (statut)      params.statut      = statut;
      if (q)           params.q           = q;
      const { status, data } = await aiGet('/internal/connaissance/entites', params);
      return reply.status(status).send(data);
    },
  );

  // GET /connaissance/entites/:id
  fastify.get('/connaissance/entites/:id',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (request, reply) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
      const { status, data } = await aiGet(`/internal/connaissance/entites/${id}`);
      return reply.status(status).send(data);
    },
  );

  // GET /connaissance/graphe
  fastify.get('/connaissance/graphe',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (request, reply) => {
      const { min_confiance } = z.object({
        min_confiance: z.coerce.number().min(0).max(1).default(0.5),
      }).parse(request.query);
      const { status, data } = await aiGet('/internal/connaissance/graphe', {
        min_confiance: String(min_confiance),
      });
      return reply.status(status).send(data);
    },
  );

  // GET /connaissance/apprentissage
  fastify.get('/connaissance/apprentissage',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (request, reply) => {
      const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
      const { status, data } = await aiGet('/internal/connaissance/apprentissage', { limit: String(limit) });
      return reply.status(status).send(data);
    },
  );

  // GET /connaissance/projection
  fastify.get('/connaissance/projection',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (_req, reply) => {
      const { status, data } = await aiGet('/internal/connaissance/projection');
      return reply.status(status).send(data);
    },
  );

  // POST /connaissance/analyser  (test d'extraction manuelle)
  fastify.post('/connaissance/analyser',
    { preHandler: [requireAuth, requireRole('system_admin')] },
    async (request, reply) => {
      const body = z.object({
        texte:  z.string().min(10),
        source: z.string().default('manuel'),
      }).parse(request.body);
      const { status, data } = await aiPost('/internal/connaissance/analyser', body);
      return reply.status(status).send(data);
    },
  );

  // ── RAG — Bibliothèque analytique ─────────────────────────────────────────

  // GET /connaissance/rag/status
  fastify.get('/connaissance/rag/status',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (_req, reply) => {
      const { status, data } = await aiGet('/internal/connaissance/rag/status');
      return reply.status(status).send(data);
    },
  );

  // GET /connaissance/rag/documents
  fastify.get('/connaissance/rag/documents',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (request, reply) => {
      const { type_document, limit, offset } = z.object({
        type_document: z.string().optional(),
        limit:  z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }).parse(request.query);
      const params: Record<string, string> = { limit: String(limit), offset: String(offset) };
      if (type_document) params.type_document = type_document;
      const { status, data } = await aiGet('/internal/connaissance/rag/documents', params);
      return reply.status(status).send(data);
    },
  );

  // POST /connaissance/rag/documents  (texte collé OU PDF en base64)
  fastify.post<{ Body: unknown }>('/connaissance/rag/documents',
    {
      preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker')],
      bodyLimit: 20 * 1024 * 1024,   // 20 MB — pour les PDF base64
    },
    async (request, reply) => {
      const body = z.object({
        titre:           z.string().min(3).max(500),
        type_document:   z.enum(['RAPPORT', 'ANALYSE', 'FICHE_GROUPE', 'NOTE_TERRAIN']).default('RAPPORT'),
        source:          z.string().default('INTERNE'),
        url:             z.string().url().optional(),
        date_publication:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        fiabilite:       z.number().min(0).max(1).default(0.7),
        themes:          z.array(z.string()).default([]),
        texte:           z.string().optional(),      // texte collé (texte OU pdf_base64)
        pdf_base64:      z.string().optional(),      // PDF encodé en base64
        pdf_filename:    z.string().optional(),
        ajoute_par:      z.string().optional(),
      }).refine(d => !!(d.texte || d.pdf_base64), {
        message: 'texte ou pdf_base64 requis',
      }).parse(request.body);
      const { status, data } = await aiPost('/internal/connaissance/rag/documents', body);
      return reply.status(status).send(data);
    },
  );

  // POST /connaissance/rag/analyser-evenement
  fastify.post('/connaissance/rag/analyser-evenement',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (request, reply) => {
      const body = z.object({
        id:          z.string().optional(),
        titre:       z.string().min(3),
        description: z.string().optional(),
        source_agent:z.string().optional(),
      }).parse(request.body);
      const { status, data } = await aiPost('/internal/connaissance/rag/analyser-evenement', body);
      return reply.status(status).send(data);
    },
  );

  // GET /connaissance/rag/analyses
  fastify.get('/connaissance/rag/analyses',
    { preHandler: [requireAuth, requireRole(...RESTRICTED_ROLES)] },
    async (request, reply) => {
      const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(request.query);
      const { status, data } = await aiGet('/internal/connaissance/rag/analyses', { limit: String(limit) });
      return reply.status(status).send(data);
    },
  );
}
