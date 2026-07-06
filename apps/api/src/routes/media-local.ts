/**
 * Routes /media-local — Registre des médias locaux RDC par province.
 * RBAC : lecture → rôles restreints ; écriture → system_admin, national_decision_maker, provincial_coordinator.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireAuth, requireRole } from '../auth/jwt.js';

const READ_ROLES  = ['system_admin', 'national_decision_maker', 'humanitarian_partner', 'provincial_coordinator'] as const;
const WRITE_ROLES = ['system_admin', 'national_decision_maker', 'provincial_coordinator'] as const;

const MediaSchema = z.object({
  nom:              z.string().min(1).max(200),
  typeMedia:        z.enum(['radio', 'tv', 'journal', 'web', 'agence', 'autre']),
  provincePcode:    z.string().max(20).optional().nullable(),
  territoirePcode:  z.string().max(20).optional().nullable(),
  collectif:        z.string().max(100).optional().nullable(),
  url:              z.string().url().optional().nullable().or(z.literal('').transform(() => null)),
  typeAcces:        z.enum(['rss', 'web', 'facebook', 'telegram', 'manuel']).default('web'),
  fiabilite:        z.number().min(0).max(1).default(0.60),
  notesFiabilite:   z.string().optional().nullable(),
  statut:           z.enum(['ACTIF', 'SUSPENDU', 'DETRUIT', 'COMPROMIS', 'INCONNU']).default('ACTIF'),
  langue:           z.string().default('fr'),
  contact:          z.string().optional().nullable(),
  notes:            z.string().optional().nullable(),
});

export async function mediaLocalRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /media-local
  fastify.get('/media-local',
    { preHandler: [requireAuth, requireRole(...READ_ROLES)] },
    async (request, reply) => {
      const q = z.object({
        province_pcode: z.string().optional(),
        collectif:      z.string().optional(),
        type_media:     z.string().optional(),
        statut:         z.string().optional(),
        q:              z.string().optional(),
        limit:          z.coerce.number().int().min(1).max(500).default(200),
        offset:         z.coerce.number().int().min(0).default(0),
      }).parse(request.query);

      const rows = await sql`
        SELECT
          id, nom, type_media, province_pcode, territoire_pcode,
          collectif, url, type_acces, fiabilite, notes_fiabilite,
          statut, langue, contact, notes, ajoute_par, cree_le, mis_a_jour_le
        FROM media_local
        WHERE TRUE
          ${q.province_pcode ? sql`AND province_pcode = ${q.province_pcode}` : sql``}
          ${q.collectif      ? sql`AND collectif = ${q.collectif}`           : sql``}
          ${q.type_media     ? sql`AND type_media = ${q.type_media}`         : sql``}
          ${q.statut         ? sql`AND statut = ${q.statut}`                 : sql``}
          ${q.q              ? sql`AND nom ILIKE ${'%' + q.q + '%'}`         : sql``}
        ORDER BY
          CASE statut WHEN 'COMPROMIS' THEN 0 WHEN 'ACTIF' THEN 1 ELSE 2 END,
          fiabilite DESC, nom
        LIMIT ${q.limit} OFFSET ${q.offset}
      `;

      const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count FROM media_local
        WHERE TRUE
          ${q.province_pcode ? sql`AND province_pcode = ${q.province_pcode}` : sql``}
          ${q.collectif      ? sql`AND collectif = ${q.collectif}`           : sql``}
          ${q.type_media     ? sql`AND type_media = ${q.type_media}`         : sql``}
          ${q.statut         ? sql`AND statut = ${q.statut}`                 : sql``}
          ${q.q              ? sql`AND nom ILIKE ${'%' + q.q + '%'}`         : sql``}
      ` as unknown as [{ count: number }];

      return reply.send({ data: rows, total: count });
    },
  );

  // GET /media-local/stats
  fastify.get('/media-local/stats',
    { preHandler: [requireAuth, requireRole(...READ_ROLES)] },
    async (_req, reply) => {
      const rows = await sql`
        SELECT
          statut,
          type_media,
          COUNT(*)::int AS n
        FROM media_local
        GROUP BY statut, type_media
        ORDER BY statut, type_media
      `;
      const byProvince = await sql`
        SELECT province_pcode, COUNT(*)::int AS n
        FROM media_local
        WHERE province_pcode IS NOT NULL
        GROUP BY province_pcode
        ORDER BY n DESC
      `;
      return reply.send({ byStatutType: rows, byProvince });
    },
  );

  // GET /media-local/:id
  fastify.get('/media-local/:id',
    { preHandler: [requireAuth, requireRole(...READ_ROLES)] },
    async (request, reply) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
      const [row] = await sql`
        SELECT * FROM media_local WHERE id = ${id}
      `;
      if (!row) return reply.status(404).send({ error: 'Média introuvable' });
      return reply.send(row);
    },
  );

  // POST /media-local
  fastify.post('/media-local',
    { preHandler: [requireAuth, requireRole(...WRITE_ROLES)] },
    async (request, reply) => {
      const body = MediaSchema.parse(request.body);
      const user = request.jwtUser;

      const [created] = await sql`
        INSERT INTO media_local
          (nom, type_media, province_pcode, territoire_pcode, collectif,
           url, type_acces, fiabilite, notes_fiabilite, statut, langue,
           contact, notes, ajoute_par)
        VALUES
          (${body.nom}, ${body.typeMedia}, ${body.provincePcode ?? null},
           ${body.territoirePcode ?? null}, ${body.collectif ?? null},
           ${body.url ?? null}, ${body.typeAcces}, ${body.fiabilite},
           ${body.notesFiabilite ?? null}, ${body.statut}, ${body.langue},
           ${body.contact ?? null}, ${body.notes ?? null}, ${user.sub})
        RETURNING *
      `;
      return reply.status(201).send(created);
    },
  );

  // PUT /media-local/:id
  fastify.put('/media-local/:id',
    { preHandler: [requireAuth, requireRole(...WRITE_ROLES)] },
    async (request, reply) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
      const body = MediaSchema.parse(request.body);

      const [updated] = await sql`
        UPDATE media_local SET
          nom             = ${body.nom},
          type_media      = ${body.typeMedia},
          province_pcode  = ${body.provincePcode ?? null},
          territoire_pcode = ${body.territoirePcode ?? null},
          collectif       = ${body.collectif ?? null},
          url             = ${body.url ?? null},
          type_acces      = ${body.typeAcces},
          fiabilite       = ${body.fiabilite},
          notes_fiabilite = ${body.notesFiabilite ?? null},
          statut          = ${body.statut},
          langue          = ${body.langue},
          contact         = ${body.contact ?? null},
          notes           = ${body.notes ?? null}
        WHERE id = ${id}
        RETURNING *
      `;
      if (!updated) return reply.status(404).send({ error: 'Média introuvable' });
      return reply.send(updated);
    },
  );

  // DELETE /media-local/:id
  fastify.delete('/media-local/:id',
    { preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker')] },
    async (request, reply) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
      await sql`DELETE FROM media_local WHERE id = ${id}`;
      return reply.status(204).send();
    },
  );
}
