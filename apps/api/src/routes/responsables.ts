/**
 * Routes Responsables — Gestion des responsables d'entités administratives.
 *
 * Permet de rechercher des entités admin, affecter/modifier/supprimer un responsable,
 * consulter l'historique des changements et la couverture nationale.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireAuth, requireRole, writeAuditLog } from '../auth/jwt.js';

const RESP_ROLES = ['system_admin', 'national_decision_maker', 'provincial_coordinator', 'territory_admin'] as const;
const ADMIN_ROLES = ['system_admin', 'national_decision_maker'] as const;

function inScope(user: { role: string; scope: string[] }, pcode: string): boolean {
  if (['system_admin', 'national_decision_maker'].includes(user.role)) return true;
  if (!user.scope?.length) return true;
  return user.scope.some(s => pcode.startsWith(s));
}

function suggererTitre(level: number, nameFr: string): string {
  switch (level) {
    case 1: return 'Gouverneur';
    case 2: return /ville/i.test(nameFr) ? 'Maire' : 'Administrateur de territoire';
    case 3: return 'Bourgmestre / Chef de secteur / Chef de chefferie';
    default: return 'Responsable';
  }
}

export async function responsablesRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /responsables/entities/search — recherche d'entités administratives
  fastify.get('/responsables/entities/search', {
    preHandler: [requireAuth, requireRole(...RESP_ROLES)],
  }, async (request, reply) => {
    const user = request.jwtUser;
    const { q, niveau, parentPcode, sansResponsable, limit } = z.object({
      q:               z.string().optional(),
      niveau:          z.coerce.number().int().min(0).max(6).optional(),
      parentPcode:     z.string().optional(),
      sansResponsable: z.coerce.boolean().default(false),
      limit:           z.coerce.number().int().min(1).max(200).default(50),
    }).parse(request.query);

    const isScoped = !['system_admin', 'national_decision_maker'].includes(user.role) && (user.scope?.length ?? 0) > 0;

    // Pour le scope, on va filtrer en JS après récupération (safe et simple)
    // On récupère un peu plus pour compenser le filtrage post-requête si scoped
    const fetchLimit = isScoped ? Math.min(limit * 4, 500) : limit;

    const rows = await sql`
      SELECT
        pcode, name_fr, level, parent_pcode,
        responsable_nom, responsable_titre, responsable_contact,
        responsable_source, responsable_maj_par, responsable_maj_le,
        statut_situation
      FROM admin_divisions
      WHERE is_active = TRUE
        ${niveau !== undefined ? sql`AND level = ${niveau}` : sql``}
        ${parentPcode ? sql`AND parent_pcode = ${parentPcode}` : sql``}
        ${sansResponsable ? sql`AND (responsable_nom IS NULL OR responsable_nom = '')` : sql``}
        ${q ? sql`AND (name_fr ILIKE ${'%' + q + '%'} OR pcode ILIKE ${'%' + q + '%'})` : sql``}
      ORDER BY level, name_fr
      LIMIT ${fetchLimit}
    ` as unknown as Record<string, unknown>[];

    // Filtrage scope en JS
    let filtered = rows as Record<string, unknown>[];
    if (isScoped) {
      filtered = rows.filter(r => {
        const pc = String(r.pcode ?? '');
        return user.scope.some((s: string) => pc.startsWith(s));
      });
      filtered = filtered.slice(0, limit);
    }

    const data = filtered.map(r => {
      const nameFr = String(r.nameFr ?? r.name_fr ?? r.pcode ?? '');
      const level = Number(r.level ?? 0);
      return {
        pcode:              String(r.pcode ?? ''),
        nameFr,
        name_fr:            nameFr,
        level,
        parent_pcode:       (r.parentPcode ?? r.parent_pcode ?? null) as string | null,
        responsable_nom:    (r.responsableNom    ?? r.responsable_nom    ?? null) as string | null,
        responsable_titre:  (r.responsableTitre  ?? r.responsable_titre  ?? null) as string | null,
        responsable_contact:(r.responsableContact ?? r.responsable_contact ?? null) as string | null,
        responsable_source: (r.responsableSource ?? r.responsable_source ?? null) as string | null,
        responsable_maj_par:(r.responsableMajPar ?? r.responsable_maj_par ?? null) as string | null,
        responsable_maj_le: (r.responsableMajLe  ?? r.responsable_maj_le  ?? null) as string | null,
        statut_situation:   String(r.statutSituation ?? r.statut_situation ?? 'NORMAL'),
        titreSuggere:       suggererTitre(level, nameFr),
      };
    });

    return reply.send({ success: true, data });
  });

  // PUT /responsables/entities/:pcode/responsable — affecter ou modifier un responsable
  fastify.put('/responsables/entities/:pcode/responsable', {
    preHandler: [requireAuth, requireRole(...RESP_ROLES)],
  }, async (request, reply) => {
    const { pcode } = request.params as { pcode: string };
    const user = request.jwtUser;

    if (!inScope(user, pcode)) {
      return reply.status(403).send({ success: false, error: { code: 'SCOPE_DENIED', message: 'Accès restreint à votre périmètre' } });
    }

    const body = z.object({
      nom:     z.string().min(1),
      titre:   z.string().min(1),
      contact: z.string().optional(),
      source:  z.string().optional(),
      statut:  z.enum(['NORMAL', 'VIGILANCE', 'ALERTE', 'CRISE']).optional(),
    }).parse(request.body);

    // Lire l'entité actuelle
    const [entity] = await sql`
      SELECT pcode, name_fr, responsable_nom, responsable_titre, responsable_contact
      FROM admin_divisions
      WHERE pcode = ${pcode}
    ` as unknown as Record<string, unknown>[];

    if (!entity) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Entité introuvable' } });
    }

    const ancienNom     = (entity.responsableNom    ?? entity.responsable_nom    ?? null) as string | null;
    const ancienTitre   = (entity.responsableTitre  ?? entity.responsable_titre  ?? null) as string | null;
    const ancienContact = (entity.responsableContact ?? entity.responsable_contact ?? null) as string | null;
    const entityName    = String(entity.nameFr ?? entity.name_fr ?? pcode);
    const action        = ancienNom ? 'MODIFICATION' : 'CREATION';

    // Historiser
    await sql`
      INSERT INTO responsable_history (
        pcode, entity_name,
        ancien_nom, ancien_titre, ancien_contact,
        nouveau_nom, nouveau_titre, nouveau_contact,
        modifie_par, source_info, action
      ) VALUES (
        ${pcode}, ${entityName},
        ${ancienNom}, ${ancienTitre}, ${ancienContact},
        ${body.nom}, ${body.titre}, ${body.contact ?? null},
        ${user.email}, ${body.source ?? null}, ${action}
      )
    `;

    // Mettre à jour l'entité
    await sql`
      UPDATE admin_divisions
      SET
        responsable_nom    = ${body.nom},
        responsable_titre  = ${body.titre},
        responsable_contact = ${body.contact ?? null},
        responsable_source = ${body.source ?? null},
        responsable_maj_par = ${user.email},
        responsable_maj_le  = NOW()
        ${body.statut ? sql`, statut_situation = ${body.statut}` : sql``}
      WHERE pcode = ${pcode}
    `;

    await writeAuditLog(user.id, 'UPDATE', 'admin_divisions', pcode, request, {
      action, nom: body.nom, titre: body.titre,
    });

    return reply.send({ success: true, data: { pcode, nom: body.nom, titre: body.titre } });
  });

  // DELETE /responsables/entities/:pcode/responsable — supprimer le responsable
  fastify.delete('/responsables/entities/:pcode/responsable', {
    preHandler: [requireAuth, requireRole(...ADMIN_ROLES)],
  }, async (request, reply) => {
    const { pcode } = request.params as { pcode: string };
    const user = request.jwtUser;

    const [entity] = await sql`
      SELECT pcode, name_fr, responsable_nom, responsable_titre, responsable_contact
      FROM admin_divisions
      WHERE pcode = ${pcode}
    ` as unknown as Record<string, unknown>[];

    if (!entity) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Entité introuvable' } });
    }

    const ancienNom     = (entity.responsableNom    ?? entity.responsable_nom    ?? null) as string | null;
    const ancienTitre   = (entity.responsableTitre  ?? entity.responsable_titre  ?? null) as string | null;
    const ancienContact = (entity.responsableContact ?? entity.responsable_contact ?? null) as string | null;
    const entityName    = String(entity.nameFr ?? entity.name_fr ?? pcode);

    await sql`
      INSERT INTO responsable_history (
        pcode, entity_name,
        ancien_nom, ancien_titre, ancien_contact,
        nouveau_nom, nouveau_titre, nouveau_contact,
        modifie_par, action
      ) VALUES (
        ${pcode}, ${entityName},
        ${ancienNom}, ${ancienTitre}, ${ancienContact},
        NULL, NULL, NULL,
        ${user.email}, 'SUPPRESSION'
      )
    `;

    await sql`
      UPDATE admin_divisions
      SET
        responsable_nom     = NULL,
        responsable_titre   = NULL,
        responsable_contact = NULL,
        responsable_source  = NULL,
        responsable_maj_par = ${user.email},
        responsable_maj_le  = NOW()
      WHERE pcode = ${pcode}
    `;

    await writeAuditLog(user.id, 'DELETE', 'admin_divisions', pcode, request, { action: 'SUPPRESSION' });

    return reply.send({ success: true, data: { pcode } });
  });

  // GET /responsables/entities/:pcode/history — historique des changements
  fastify.get('/responsables/entities/:pcode/history', {
    preHandler: [requireAuth, requireRole(...RESP_ROLES)],
  }, async (request, reply) => {
    const { pcode } = request.params as { pcode: string };
    const user = request.jwtUser;

    if (!inScope(user, pcode)) {
      return reply.status(403).send({ success: false, error: { code: 'SCOPE_DENIED', message: 'Accès restreint à votre périmètre' } });
    }

    const rows = await sql`
      SELECT
        id, pcode, entity_name,
        ancien_nom, ancien_titre, ancien_contact,
        nouveau_nom, nouveau_titre, nouveau_contact,
        modifie_par, modifie_le, source_info, action
      FROM responsable_history
      WHERE pcode = ${pcode}
      ORDER BY modifie_le DESC
      LIMIT 50
    ` as unknown as Record<string, unknown>[];

    const data = rows.map(r => ({
      id:           Number(r.id),
      pcode:        String(r.pcode ?? ''),
      entity_name:  String(r.entityName ?? r.entity_name ?? ''),
      ancien_nom:   (r.ancienNom    ?? r.ancien_nom    ?? null) as string | null,
      ancien_titre: (r.ancienTitre  ?? r.ancien_titre  ?? null) as string | null,
      nouveau_nom:  (r.nouveauNom   ?? r.nouveau_nom   ?? null) as string | null,
      nouveau_titre:(r.nouveauTitre ?? r.nouveau_titre ?? null) as string | null,
      modifie_par:  String(r.modifiePar ?? r.modifie_par ?? ''),
      modifie_le:   String(r.modifieLe  ?? r.modifie_le  ?? ''),
      source_info:  (r.sourceInfo ?? r.source_info ?? null) as string | null,
      action:       String(r.action ?? ''),
    }));

    return reply.send({ success: true, data });
  });

  // POST /responsables/entities — créer une entité manquante
  fastify.post('/responsables/entities', {
    preHandler: [requireAuth, requireRole(...ADMIN_ROLES)],
  }, async (request, reply) => {
    const user = request.jwtUser;
    const body = z.object({
      pcode:       z.string().min(1),
      nameFr:      z.string().min(1),
      level:       z.number().int().min(0).max(5),
      parentPcode: z.string().optional(),
      population:  z.number().int().positive().optional(),
    }).parse(request.body);

    // Vérifier que pcode n'existe pas déjà
    const [existing] = await sql`
      SELECT pcode FROM admin_divisions WHERE pcode = ${body.pcode}
    ` as unknown as Record<string, unknown>[];

    if (existing) {
      return reply.status(409).send({ success: false, error: { code: 'CONFLICT', message: 'Cette entité existe déjà' } });
    }

    const [row] = await sql`
      INSERT INTO admin_divisions (pcode, name, name_fr, level, parent_pcode, population, is_active)
      VALUES (
        ${body.pcode},
        ${body.nameFr},
        ${body.nameFr},
        ${body.level},
        ${body.parentPcode ?? null},
        ${body.population ?? null},
        TRUE
      )
      RETURNING pcode, name_fr, level, parent_pcode
    ` as unknown as Record<string, unknown>[];

    await writeAuditLog(user.id, 'CREATE', 'admin_divisions', body.pcode, request, {
      nameFr: body.nameFr, level: body.level,
    });

    return reply.status(201).send({ success: true, data: row });
  });

  // GET /responsables/couverture — couverture nationale par province + niveau
  fastify.get('/responsables/couverture', {
    preHandler: [requireAuth, requireRole(...RESP_ROLES)],
  }, async (_request, reply) => {
    const rows = await sql`
      SELECT
        p.pcode AS province_pcode,
        p.name_fr AS province_nom,
        d.level,
        COUNT(*) AS total,
        COUNT(d.responsable_nom) AS avec_responsable
      FROM admin_divisions p
      JOIN admin_divisions d ON d.pcode LIKE p.pcode || '%' AND d.level IN (2, 3)
      WHERE p.level = 1 AND p.is_active = TRUE AND d.is_active = TRUE
      GROUP BY p.pcode, p.name_fr, d.level
      ORDER BY p.name_fr, d.level
    ` as unknown as Record<string, unknown>[];

    const data_rows = rows.map(r => ({
      province_pcode:    String(r.provincePcode ?? r.province_pcode ?? ''),
      province_nom:      String(r.provinceNom   ?? r.province_nom   ?? ''),
      level:             Number(r.level ?? 0),
      total:             Number(r.total ?? 0),
      avec_responsable:  Number(r.avecResponsable ?? r.avec_responsable ?? 0),
    }));

    const total         = data_rows.reduce((acc, r) => acc + r.total, 0);
    const total_avec    = data_rows.reduce((acc, r) => acc + r.avec_responsable, 0);

    return reply.send({ success: true, data: { rows: data_rows, total, total_avec } });
  });
}
