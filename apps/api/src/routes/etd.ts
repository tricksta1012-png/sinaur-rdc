/**
 * Routes ETD — Entités Territoriales Décentralisées + Flux Bidirectionnel.
 *
 * Deux couches :
 *   1. Analyse IA (proxy → service ai-prediction) : /etd/:pcode/analyse|rapport|seuils
 *   2. Flux CRUD (direct DB)                       : /etd/flux/*
 *
 * ETD = Ville · Commune · Secteur · Chefferie (personnalité juridique propre).
 * Rôles autorisés : territory_admin, provincial_coordinator,
 *                   national_decision_maker, humanitarian_partner, system_admin.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireAuth, requireRole, writeAuditLog } from '../auth/jwt.js';
import { aiGet } from '../services/aiClient.js';

const ETD_ROLES = ['territory_admin', 'provincial_coordinator', 'national_decision_maker', 'humanitarian_partner', 'system_admin'] as const;

const FluxMessageSchema = z.object({
  type_flux:                z.enum(['SIGNALEMENT', 'ALERTE', 'RAPPORT', 'DIRECTIVE', 'RESSOURCE']),
  direction:                z.enum(['ASCENDANT', 'DESCENDANT']),
  element_id:               z.string().optional(),
  element_type:             z.string().optional(),
  niveau_origine:           z.number().int().min(1).max(10),
  niveau_destination:       z.number().int().min(1).max(10),
  entite_origine_pcode:     z.string().max(20).optional(),
  entite_destination_pcode: z.string().min(1).max(20),
  contenu:                  z.record(z.unknown()).default({}),
  priorite:                 z.number().int().min(1).max(5).default(1),
});

function scopeCheck(user: { role: string; scope: string[] }, pcode: string): boolean {
  if (['system_admin', 'national_decision_maker', 'humanitarian_partner'].includes(user.role)) return true;
  if (!user.scope?.length) return true;
  return user.scope.some(s => pcode.startsWith(s) || s.startsWith(pcode));
}

function normalizeFlux(r: Record<string, unknown>) {
  return {
    id:                       r.id,
    type_flux:                r.typeFlux               ?? r.type_flux,
    direction:                r.direction,
    element_id:               r.elementId              ?? r.element_id              ?? null,
    element_type:             r.elementType            ?? r.element_type            ?? null,
    niveau_origine:           Number(r.niveauOrigine   ?? r.niveau_origine),
    niveau_destination:       Number(r.niveauDestination ?? r.niveau_destination),
    entite_origine_pcode:     (r.entiteOriginePcode    ?? r.entite_origine_pcode    ?? null) as string | null,
    entite_destination_pcode: String(r.entiteDestinationPcode ?? r.entite_destination_pcode ?? ''),
    contenu:                  r.contenu                ?? {},
    priorite:                 Number(r.priorite),
    statut:                   r.statut,
    accuse_reception_le:      (r.accuseReceptionLe     ?? r.accuse_reception_le     ?? null) as string | null,
    execute_le:               (r.executeLe             ?? r.execute_le              ?? null) as string | null,
    created_at:               String(r.createdAt       ?? r.created_at              ?? new Date().toISOString()),
  };
}

export async function etdRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Analyse IA (proxy) ─────────────────────────────────────────────────

  // GET /etd/:pcode/analyse — agrégation signalements + tendance
  fastify.get('/etd/:pcode/analyse', {
    preHandler: [requireAuth, requireRole(...ETD_ROLES)],
  }, async (request, reply) => {
    const { pcode } = request.params as { pcode: string };
    const user = request.jwtUser;
    if (!scopeCheck(user, pcode)) {
      return reply.status(403).send({ success: false, error: { code: 'SCOPE_DENIED', message: 'Accès restreint à votre périmètre' } });
    }
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).parse(request.query);
    const { status, data } = await aiGet(`/internal/etd/${encodeURIComponent(pcode)}/analyse`, { days });
    return reply.status(status).send({ success: true, data });
  });

  // GET /etd/:pcode/rapport — rapport complet pour la province
  fastify.get('/etd/:pcode/rapport', {
    preHandler: [requireAuth, requireRole(...ETD_ROLES)],
  }, async (request, reply) => {
    const { pcode } = request.params as { pcode: string };
    const user = request.jwtUser;
    if (!scopeCheck(user, pcode)) {
      return reply.status(403).send({ success: false, error: { code: 'SCOPE_DENIED', message: 'Accès restreint à votre périmètre' } });
    }
    const { status, data } = await aiGet(`/internal/etd/${encodeURIComponent(pcode)}/rapport`);
    return reply.status(status).send({ success: true, data });
  });

  // GET /etd/:pcode/seuils — indicateurs de seuil d'alerte
  fastify.get('/etd/:pcode/seuils', {
    preHandler: [requireAuth, requireRole(...ETD_ROLES)],
  }, async (request, reply) => {
    const { pcode } = request.params as { pcode: string };
    const user = request.jwtUser;
    if (!scopeCheck(user, pcode)) {
      return reply.status(403).send({ success: false, error: { code: 'SCOPE_DENIED', message: 'Accès restreint à votre périmètre' } });
    }
    const { status, data } = await aiGet(`/internal/etd/${encodeURIComponent(pcode)}/seuils`);
    return reply.status(status).send({ success: true, data });
  });

  // ── Flux bidirectionnel — CRUD direct DB ──────────────────────────────

  // GET /etd/flux — liste des messages de flux
  fastify.get('/etd/flux', {
    preHandler: [requireAuth, requireRole(...ETD_ROLES)],
  }, async (request) => {
    const user = request.jwtUser;
    const { pcode, direction, statut, limit } = z.object({
      pcode:     z.string().optional(),
      direction: z.enum(['ASCENDANT', 'DESCENDANT']).optional(),
      statut:    z.string().optional(),
      limit:     z.coerce.number().int().min(1).max(100).default(30),
    }).parse(request.query);

    // Scope guard : les coordinateurs provinciaux ne voient que leur périmètre
    const isScoped = !['system_admin', 'national_decision_maker', 'humanitarian_partner'].includes(user.role) && user.scope?.length > 0;
    const effectivePcodes = isScoped
      ? (pcode ? user.scope.filter((s: string) => s === pcode || pcode.startsWith(s) || s.startsWith(pcode)) : user.scope)
      : (pcode ? [pcode] : null);

    const rows = await sql`
      SELECT id, type_flux, direction, element_id, element_type,
             niveau_origine, niveau_destination,
             entite_origine_pcode, entite_destination_pcode,
             contenu, priorite, statut,
             accuse_reception_le, execute_le, created_by, created_at
      FROM flux_message
      WHERE TRUE
        ${effectivePcodes ? sql`AND (entite_origine_pcode = ANY(${effectivePcodes}::text[]) OR entite_destination_pcode = ANY(${effectivePcodes}::text[]))` : sql``}
        ${direction ? sql`AND direction = ${direction}` : sql``}
        ${statut    ? sql`AND statut = ${statut}`       : sql``}
      ORDER BY priorite DESC, created_at DESC
      LIMIT ${limit}
    `;

    return { data: (rows as Record<string, unknown>[]).map(normalizeFlux) };
  });

  // POST /etd/flux — créer un message (typiquement ascendant : terrain → province)
  fastify.post('/etd/flux', {
    preHandler: [requireAuth, requireRole(...ETD_ROLES)],
  }, async (request, reply) => {
    const user = request.jwtUser;
    const body = FluxMessageSchema.parse(request.body);

    if (body.entite_origine_pcode && !scopeCheck(user, body.entite_origine_pcode)) {
      return reply.status(403).send({ success: false, error: { code: 'SCOPE_DENIED', message: 'Vous ne pouvez pas émettre au nom de cette entité' } });
    }

    const [row] = await sql`
      INSERT INTO flux_message (
        type_flux, direction, element_id, element_type,
        niveau_origine, niveau_destination,
        entite_origine_pcode, entite_destination_pcode,
        contenu, priorite, statut, created_by
      ) VALUES (
        ${body.type_flux},
        ${body.direction},
        ${body.element_id ?? null},
        ${body.element_type ?? null},
        ${body.niveau_origine},
        ${body.niveau_destination},
        ${body.entite_origine_pcode ?? null},
        ${body.entite_destination_pcode},
        ${JSON.stringify(body.contenu)},
        ${body.priorite},
        'TRANSMIS',
        ${user.id}::uuid
      )
      RETURNING id, type_flux, direction, entite_origine_pcode, entite_destination_pcode,
                contenu, priorite, statut, created_at
    `;

    await writeAuditLog(user.id, 'CREATE', 'flux_message', (row as Record<string, unknown>).id as string, request, {
      type_flux:  body.type_flux,
      direction:  body.direction,
      priorite:   body.priorite,
    });

    return reply.status(201).send({ success: true, data: normalizeFlux(row as Record<string, unknown>) });
  });

  // PUT /etd/flux/:id/accuser — accuser réception d'un message descendant
  fastify.put('/etd/flux/:id/accuser', {
    preHandler: [requireAuth, requireRole(...ETD_ROLES)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.jwtUser;

    const [row] = await sql`
      UPDATE flux_message
      SET statut = 'ACCUSE_RECEPTION',
          accuse_reception_le = NOW()
      WHERE id = ${id}::uuid
        AND statut IN ('TRANSMIS', 'RECU')
      RETURNING id, statut, accuse_reception_le, entite_destination_pcode
    `;

    if (!row) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Message introuvable ou déjà traité' } });

    const r = row as Record<string, unknown>;
    if (!scopeCheck(user, String(r.entiteDestinationPcode ?? r.entite_destination_pcode ?? ''))) {
      return reply.status(403).send({ success: false, error: { code: 'SCOPE_DENIED', message: 'Accès restreint' } });
    }

    await writeAuditLog(user.id, 'UPDATE', 'flux_message', id, request, { statut: 'ACCUSE_RECEPTION' });
    return { success: true, data: { id, statut: r.statut, accuse_reception_le: r.accuseReceptionLe ?? r.accuse_reception_le } };
  });

  // PUT /etd/flux/:id/executer — marquer un message comme exécuté
  fastify.put('/etd/flux/:id/executer', {
    preHandler: [requireAuth, requireRole(...ETD_ROLES)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.jwtUser;

    const [row] = await sql`
      UPDATE flux_message
      SET statut = 'EXECUTE',
          execute_le = NOW()
      WHERE id = ${id}::uuid
        AND statut NOT IN ('EXECUTE')
      RETURNING id, statut, execute_le, entite_destination_pcode
    `;

    if (!row) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Message introuvable ou déjà exécuté' } });

    const r = row as Record<string, unknown>;
    if (!scopeCheck(user, String(r.entiteDestinationPcode ?? r.entite_destination_pcode ?? ''))) {
      return reply.status(403).send({ success: false, error: { code: 'SCOPE_DENIED', message: 'Accès restreint' } });
    }

    await writeAuditLog(user.id, 'UPDATE', 'flux_message', id, request, { statut: 'EXECUTE' });
    return { success: true, data: { id, statut: r.statut, execute_le: r.executeLe ?? r.execute_le } };
  });

  // GET /etd/flux/metriques — métriques de performance du flux
  fastify.get('/etd/flux/metriques', {
    preHandler: [requireAuth, requireRole(...ETD_ROLES)],
  }, async (request, reply) => {
    const { pcode } = z.object({ pcode: z.string().optional() }).parse(request.query);
    const { status, data } = await aiGet('/internal/etd/flux/metriques', pcode ? { pcode } : {});
    return reply.status(status).send({ success: true, data });
  });
}
