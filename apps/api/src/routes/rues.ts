/**
 * Routes Rues — Référentiel des voies nommées SINAUR-RDC.
 *
 * RBAC :
 *   lecture     → tous rôles authentifiés (avec filtrage de périmètre)
 *   écriture    → field_agent, local_validator, territory_admin,
 *                 provincial_coordinator, national_decision_maker, system_admin
 *   validation  → local_validator, territory_admin, provincial_coordinator,
 *                 national_decision_maker, system_admin
 *   suppression → territory_admin, provincial_coordinator,
 *                 national_decision_maker, system_admin
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireAuth, requireRole, writeAuditLog } from '../auth/jwt.js';

// ── Role sets ──────────────────────────────────────────────────────────────

const WRITE_ROLES = [
  'field_agent', 'local_validator', 'territory_admin',
  'provincial_coordinator', 'national_decision_maker', 'system_admin',
] as const;

const VALIDATE_ROLES = [
  'local_validator', 'territory_admin', 'provincial_coordinator',
  'national_decision_maker', 'system_admin',
] as const;

const DELETE_ROLES = [
  'territory_admin', 'provincial_coordinator',
  'national_decision_maker', 'system_admin',
] as const;

const AUTO_VALIDATE_ROLES = new Set([
  'territory_admin', 'provincial_coordinator',
  'national_decision_maker', 'system_admin',
]);

const NATIONAL_ROLES = new Set([
  'provincial_coordinator', 'national_decision_maker',
  'humanitarian_partner', 'system_admin',
]);

// ── Helpers ────────────────────────────────────────────────────────────────

function isNationalRole(role: string): boolean {
  return NATIONAL_ROLES.has(role);
}

function normalizeRue(r: Record<string, unknown>) {
  return {
    id:                Number(r.id),
    nom:               String(r.nom ?? ''),
    type_voie:         (r.typeVoie         ?? r.type_voie         ?? 'rue') as string,
    commune_pcode:     (r.communePcode     ?? r.commune_pcode     ?? null) as string | null,
    quartier_pcode:    (r.quartierPcode    ?? r.quartier_pcode    ?? null) as string | null,
    source:            (r.source           ?? 'AGENT_TERRAIN') as string,
    statut_validation: String(r.statutValidation ?? r.statut_validation ?? 'PROPOSE'),
    cree_par:          (r.creePar          ?? r.cree_par          ?? null) as string | null,
    cree_le:           (r.creeLe           ?? r.cree_le           ?? null),
    valide_par:        (r.validePar        ?? r.valide_par        ?? null) as string | null,
    valide_le:         (r.valideLe         ?? r.valide_le         ?? null),
    geojson:           (r.geojson          ?? null),
    lng:               (r.lng              ?? null) as number | null,
    lat:               (r.lat              ?? null) as number | null,
  };
}

// ── Route plugin ───────────────────────────────────────────────────────────

export async function ruesRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /rues
  fastify.get('/rues', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.jwtUser;
    const query = z.object({
      q:              z.string().optional(),
      commune_pcode:  z.string().optional(),
      quartier_pcode: z.string().optional(),
      statut:         z.enum(['PROPOSE', 'VALIDE', 'REJETE']).optional(),
      limit:          z.coerce.number().int().min(1).max(200).default(100),
    }).parse(request.query);

    const rows = await sql`
      SELECT
        r.id, r.nom, r.type_voie,
        r.commune_pcode, r.quartier_pcode,
        r.source, r.statut_validation,
        r.cree_par, r.cree_le,
        r.valide_par, r.valide_le,
        ST_AsGeoJSON(r.geometry)::json  AS geojson,
        ST_X(r.centroid)                AS lng,
        ST_Y(r.centroid)                AS lat
      FROM rue r
      WHERE r.is_active = TRUE
        ${query.statut
          ? sql`AND r.statut_validation = ${query.statut}`
          : sql`AND r.statut_validation IN ('PROPOSE', 'VALIDE')`
        }
        ${query.commune_pcode  ? sql`AND r.commune_pcode  = ${query.commune_pcode}`  : sql``}
        ${query.quartier_pcode ? sql`AND r.quartier_pcode = ${query.quartier_pcode}` : sql``}
        ${query.q
          ? sql`AND (r.nom ILIKE ${'%' + query.q + '%'} OR ${query.q} = ANY(r.noms_alternatifs))`
          : sql``
        }
      ORDER BY r.nom
      LIMIT ${query.limit}
    ` as unknown as Record<string, unknown>[];

    let data = rows;
    if (!isNationalRole(user.role) && user.scope.length > 0) {
      const prefix = user.scope[0];
      data = rows.filter(r => {
        const cp = (r.communePcode  ?? r.commune_pcode  ?? '') as string;
        const qp = (r.quartierPcode ?? r.quartier_pcode ?? '') as string;
        return cp.startsWith(prefix) || qp.startsWith(prefix);
      });
    }

    return reply.send({ success: true, data: data.map(normalizeRue) });
  });

  // GET /rues/a-valider
  fastify.get(
    '/rues/a-valider',
    { preHandler: [requireAuth, requireRole(...VALIDATE_ROLES)] },
    async (request, reply) => {
      const user = request.jwtUser;

      const rows = await sql`
        SELECT
          r.id, r.nom, r.type_voie,
          r.commune_pcode, r.quartier_pcode,
          r.source, r.statut_validation,
          r.cree_par, r.cree_le,
          r.valide_par, r.valide_le,
          ST_AsGeoJSON(r.geometry)::json  AS geojson,
          ST_X(r.centroid)                AS lng,
          ST_Y(r.centroid)                AS lat,
          (SELECT COUNT(*)::int FROM rue_history rh WHERE rh.rue_id = r.id) AS nb_history
        FROM rue r
        WHERE r.is_active = TRUE
          AND r.statut_validation = 'PROPOSE'
        ORDER BY r.cree_le ASC
        LIMIT 500
      ` as unknown as Record<string, unknown>[];

      let data = rows;
      if (!isNationalRole(user.role) && user.scope.length > 0) {
        const prefix = user.scope[0];
        data = rows.filter(r => {
          const cp = (r.communePcode  ?? r.commune_pcode  ?? '') as string;
          const qp = (r.quartierPcode ?? r.quartier_pcode ?? '') as string;
          return cp.startsWith(prefix) || qp.startsWith(prefix);
        });
      }

      const normalized = data.map(r => ({
        ...normalizeRue(r),
        nb_history: Number(r.nbHistory ?? r.nb_history ?? 0),
      }));

      return reply.send({ success: true, data: normalized });
    },
  );

  // POST /rues
  fastify.post(
    '/rues',
    { preHandler: [requireAuth, requireRole(...WRITE_ROLES)] },
    async (request, reply) => {
      const user = request.jwtUser;
      const body = z.object({
        nom:            z.string().min(1),
        type_voie:      z.string().optional(),
        commune_pcode:  z.string().optional(),
        quartier_pcode: z.string().optional(),
        geometry:       z.record(z.unknown()).optional(),
        point:          z.tuple([z.number(), z.number()]).optional(),
        motif:          z.string().optional(),
      })
        .refine(b => b.commune_pcode || b.quartier_pcode, { message: 'commune_pcode ou quartier_pcode requis' })
        .parse(request.body);

      if (!isNationalRole(user.role) && user.scope.length > 0) {
        const prefix = user.scope[0];
        const cp = body.commune_pcode  ?? '';
        const qp = body.quartier_pcode ?? '';
        if (!cp.startsWith(prefix) && !qp.startsWith(prefix)) {
          return reply.status(403).send({
            success: false,
            error: { code: 'SCOPE_DENIED', message: 'Cette rue est hors de votre périmètre géographique' },
          });
        }
      }

      const statutValidation = AUTO_VALIDATE_ROLES.has(user.role) ? 'VALIDE' : 'PROPOSE';
      const creePar          = String(user.email ?? user.id);
      const communePcode     = body.commune_pcode  ?? null;
      const quartierPcode    = body.quartier_pcode ?? null;
      const typeVoie         = body.type_voie      ?? 'rue';

      let insertedId: number;

      if (body.geometry) {
        const geomJson = JSON.stringify(body.geometry);
        const rows = await sql.unsafe(
          `INSERT INTO rue (nom, type_voie, commune_pcode, quartier_pcode,
                            geometry, centroid, statut_validation, cree_par)
           VALUES ($1, $2, $3, $4,
                   ST_GeomFromGeoJSON($5::text),
                   ST_Centroid(ST_GeomFromGeoJSON($5::text)),
                   $6, $7)
           RETURNING id`,
          [body.nom, typeVoie, communePcode, quartierPcode, geomJson, statutValidation, creePar],
        ) as unknown as { id: number }[];
        insertedId = rows[0].id;
      } else if (body.point) {
        const [lng, lat] = body.point;
        const rows = await sql.unsafe(
          `INSERT INTO rue (nom, type_voie, commune_pcode, quartier_pcode,
                            centroid, statut_validation, cree_par)
           VALUES ($1, $2, $3, $4,
                   ST_SetSRID(ST_MakePoint($5, $6), 4326),
                   $7, $8)
           RETURNING id`,
          [body.nom, typeVoie, communePcode, quartierPcode, lng, lat, statutValidation, creePar],
        ) as unknown as { id: number }[];
        insertedId = rows[0].id;
      } else {
        const [row] = await sql`
          INSERT INTO rue (nom, type_voie, commune_pcode, quartier_pcode, statut_validation, cree_par)
          VALUES (${body.nom}, ${typeVoie}, ${communePcode}, ${quartierPcode}, ${statutValidation}, ${creePar})
          RETURNING id
        `;
        insertedId = Number(row.id);
      }

      await sql`
        INSERT INTO rue_history (rue_id, action, nouveau_nom, modifie_par, motif)
        VALUES (${insertedId}, 'AJOUT', ${body.nom}, ${creePar}, ${body.motif ?? null})
      `;

      await writeAuditLog(user.id, 'CREATE', 'rue', String(insertedId), request, {
        nom: body.nom, statut: statutValidation,
      });

      return reply.status(201).send({ success: true, data: { id: insertedId, statut: statutValidation } });
    },
  );

  // PUT /rues/:id
  fastify.put(
    '/rues/:id',
    { preHandler: [requireAuth, requireRole(...WRITE_ROLES)] },
    async (request, reply) => {
      const user = request.jwtUser;
      const { id } = request.params as { id: string };
      const rueId = Number(id);

      const body = z.object({
        nom:       z.string().min(1).optional(),
        type_voie: z.string().optional(),
        geometry:  z.record(z.unknown()).optional(),
        motif:     z.string().optional(),
      }).parse(request.body);

      const [current] = await sql`
        SELECT id, nom, type_voie FROM rue WHERE id = ${rueId} AND is_active = TRUE
      ` as unknown as Record<string, unknown>[];

      if (!current) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Rue introuvable' } });
      }

      const ancienNom   = String(current.nom ?? '');
      const nouveauNom  = body.nom ?? ancienNom;
      const modifiePar  = String(user.email ?? user.id);
      const autoValidate = AUTO_VALIDATE_ROLES.has(user.role);
      const typeVoie    = body.type_voie ?? ((current.typeVoie ?? current.type_voie ?? 'rue') as string);

      const action = body.geometry ? 'CORRECTION_TRACE' : (nouveauNom !== ancienNom ? 'RENOMMAGE' : 'RENOMMAGE');

      if (body.geometry) {
        const geomJson = JSON.stringify(body.geometry);
        if (autoValidate) {
          await sql.unsafe(
            `UPDATE rue SET nom=$1, type_voie=$2, geometry=ST_GeomFromGeoJSON($3::text),
             centroid=ST_Centroid(ST_GeomFromGeoJSON($3::text)),
             statut_validation='VALIDE', valide_par=$4, valide_le=NOW() WHERE id=$5`,
            [nouveauNom, typeVoie, geomJson, modifiePar, rueId],
          );
        } else {
          await sql.unsafe(
            `UPDATE rue SET nom=$1, type_voie=$2, geometry=ST_GeomFromGeoJSON($3::text),
             centroid=ST_Centroid(ST_GeomFromGeoJSON($3::text)) WHERE id=$4`,
            [nouveauNom, typeVoie, geomJson, rueId],
          );
        }
      } else if (autoValidate) {
        await sql.unsafe(
          `UPDATE rue SET nom=$1, type_voie=$2, statut_validation='VALIDE', valide_par=$3, valide_le=NOW() WHERE id=$4`,
          [nouveauNom, typeVoie, modifiePar, rueId],
        );
      } else {
        await sql.unsafe(
          `UPDATE rue SET nom=$1, type_voie=$2 WHERE id=$3`,
          [nouveauNom, typeVoie, rueId],
        );
      }

      await sql`
        INSERT INTO rue_history (rue_id, action, ancien_nom, nouveau_nom, modifie_par, motif)
        VALUES (${rueId}, ${action}, ${ancienNom}, ${nouveauNom}, ${modifiePar}, ${body.motif ?? null})
      `;

      await writeAuditLog(user.id, 'UPDATE', 'rue', String(rueId), request, { action, ancienNom, nouveauNom });
      return reply.send({ success: true, data: { id: rueId, action } });
    },
  );

  // POST /rues/:id/signaler
  fastify.post(
    '/rues/:id/signaler',
    { preHandler: [requireAuth, requireRole('field_agent', 'local_validator', 'citizen')] },
    async (request, reply) => {
      const user = request.jwtUser;
      const { id } = request.params as { id: string };
      const rueId = Number(id);

      const body = z.object({
        probleme:   z.string().min(1),
        suggestion: z.string().optional(),
      }).parse(request.body);

      const [rue] = await sql`SELECT id FROM rue WHERE id = ${rueId} AND is_active = TRUE`;
      if (!rue) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Rue introuvable' } });
      }

      const [row] = await sql`
        INSERT INTO rue_signalement (rue_id, probleme, suggestion, signale_par)
        VALUES (${rueId}, ${body.probleme}, ${body.suggestion ?? null}, ${String(user.email ?? user.id)})
        RETURNING id
      `;

      return reply.status(201).send({ success: true, data: { id: Number(row.id), rue_id: rueId, statut: 'A_TRAITER' } });
    },
  );

  // PUT /rues/:id/valider
  fastify.put(
    '/rues/:id/valider',
    { preHandler: [requireAuth, requireRole(...VALIDATE_ROLES)] },
    async (request, reply) => {
      const user = request.jwtUser;
      const { id } = request.params as { id: string };
      const rueId = Number(id);

      const body = z.object({
        decision: z.enum(['VALIDE', 'REJETE']),
        motif:    z.string().optional(),
      }).parse(request.body);

      const [current] = await sql`
        SELECT id, nom FROM rue WHERE id = ${rueId} AND is_active = TRUE
      ` as unknown as Record<string, unknown>[];

      if (!current) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Rue introuvable' } });
      }

      const validePar = String(user.email ?? user.id);
      const action    = body.decision === 'VALIDE' ? 'VALIDATION' : 'REJET';
      const nomActuel = String(current.nom ?? '');

      await sql`
        UPDATE rue SET statut_validation = ${body.decision}, valide_par = ${validePar}, valide_le = NOW()
        WHERE id = ${rueId}
      `;

      await sql`
        INSERT INTO rue_history (rue_id, action, ancien_nom, nouveau_nom, modifie_par, motif)
        VALUES (${rueId}, ${action}, ${nomActuel}, ${nomActuel}, ${validePar}, ${body.motif ?? null})
      `;

      await writeAuditLog(user.id, action, 'rue', String(rueId), request, { decision: body.decision });
      return reply.send({ success: true, data: { id: rueId, statut_validation: body.decision } });
    },
  );

  // DELETE /rues/:id
  fastify.delete(
    '/rues/:id',
    { preHandler: [requireAuth, requireRole(...DELETE_ROLES)] },
    async (request, reply) => {
      const user = request.jwtUser;
      const { id } = request.params as { id: string };
      const rueId = Number(id);

      const [current] = await sql`
        SELECT id, nom FROM rue WHERE id = ${rueId} AND is_active = TRUE
      ` as unknown as Record<string, unknown>[];

      if (!current) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Rue introuvable' } });
      }

      const modifiePar = String(user.email ?? user.id);
      const nomActuel  = String(current.nom ?? '');

      await sql`UPDATE rue SET is_active = FALSE WHERE id = ${rueId}`;

      await sql`
        INSERT INTO rue_history (rue_id, action, ancien_nom, modifie_par)
        VALUES (${rueId}, 'SUPPRESSION', ${nomActuel}, ${modifiePar})
      `;

      await writeAuditLog(user.id, 'DELETE', 'rue', String(rueId), request, { nom: nomActuel });
      return reply.send({ success: true });
    },
  );
}
