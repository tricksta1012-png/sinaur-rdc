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
      nom:              z.string().min(1),
      titre:            z.string().min(1),
      contact:          z.string().optional(),
      source:           z.string().optional(),
      statut:           z.enum(['NORMAL', 'VIGILANCE', 'ALERTE', 'CRISE']).optional(),
      contact_origine:  z.enum(['SAISIE_OFFICIELLE', 'DOCUMENT_OFFICIEL']).optional(),
      contact_verifie:  z.boolean().optional(),
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

    const contact          = (body.contact         ?? null) as string | null;
    const source           = (body.source          ?? null) as string | null;
    const statut           = (body.statut          ?? null) as string | null;
    const contactOrigine   = (body.contact_origine ?? null) as string | null;
    const contactVerifie   = body.contact_verifie ?? null;
    const userEmail        = String(user.email ?? user.id);

    // Historiser
    await sql.unsafe(
      `INSERT INTO responsable_history (
        pcode, entity_name,
        ancien_nom, ancien_titre, ancien_contact,
        nouveau_nom, nouveau_titre, nouveau_contact,
        modifie_par, source_info, action
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [pcode, entityName, ancienNom, ancienTitre, ancienContact,
       body.nom, body.titre, contact, userEmail, source, action],
    );

    // Mettre à jour l'entité (COALESCE pour statut optionnel)
    await sql.unsafe(
      `UPDATE admin_divisions
       SET responsable_nom = $1, responsable_titre = $2, responsable_contact = $3,
           responsable_source = $4, responsable_maj_par = $5, responsable_maj_le = NOW(),
           statut_situation = COALESCE($6::text, statut_situation),
           contact_origine = COALESCE($8::text, contact_origine),
           contact_verifie = COALESCE($9::boolean, contact_verifie),
           contact_verifie_le = CASE WHEN $9::boolean IS TRUE THEN NOW() ELSE contact_verifie_le END
       WHERE pcode = $7`,
      [body.nom, body.titre, contact, source, userEmail, statut, pcode, contactOrigine, contactVerifie],
    );

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

    await sql.unsafe(
      `INSERT INTO responsable_history (
        pcode, entity_name,
        ancien_nom, ancien_titre, ancien_contact,
        nouveau_nom, nouveau_titre, nouveau_contact,
        modifie_par, action
      ) VALUES ($1,$2,$3,$4,$5,NULL,NULL,NULL,$6,'SUPPRESSION')`,
      [pcode, entityName, ancienNom, ancienTitre, ancienContact, String(user.email ?? user.id)],
    );

    await sql.unsafe(
      `UPDATE admin_divisions
       SET responsable_nom = NULL, responsable_titre = NULL,
           responsable_contact = NULL, responsable_source = NULL,
           responsable_maj_par = $1, responsable_maj_le = NOW()
       WHERE pcode = $2`,
      [String(user.email ?? user.id), pcode],
    );

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

  // ---------------------------------------------------------------------------
  // Propositions — détections de l'agent veille presse
  // ---------------------------------------------------------------------------

  // GET /responsables/propositions — liste des propositions
  fastify.get('/responsables/propositions', {
    preHandler: [requireAuth, requireRole(...RESP_ROLES)],
  }, async (request, reply) => {
    const user = request.jwtUser;
    const { statut, pcode, limit } = z.object({
      statut: z.string().optional(),
      pcode:  z.string().optional(),
      limit:  z.coerce.number().int().min(1).max(200).default(50),
    }).parse(request.query);

    const rows = await sql.unsafe(
      `SELECT
        id, pcode, entite_nom, personne, fonction, type_acte, date_acte,
        interimaire, remplace, source, url_article, confiance,
        statut_rapprochement, candidats, statut, valide_par, valide_le,
        detecte_le, detail
       FROM responsable_proposition
       WHERE TRUE
         ${statut ? `AND statut = '${statut.replace(/'/g, "''")}'` : ''}
         ${pcode  ? `AND pcode = '${pcode.replace(/'/g, "''")}'`  : ''}
       ORDER BY detecte_le DESC
       LIMIT ${limit}`,
      [],
    ) as unknown as Record<string, unknown>[];

    const data = rows.map(r => ({
      id:                   Number(r.id),
      pcode:                (r.pcode ?? null) as string | null,
      entite_nom:           (r.entiteNom   ?? r.entite_nom   ?? null) as string | null,
      personne:             String(r.personne ?? ''),
      fonction:             (r.fonction ?? null) as string | null,
      type_acte:            (r.typeActe    ?? r.type_acte    ?? null) as string | null,
      date_acte:            (r.dateActe    ?? r.date_acte    ?? null) as string | null,
      interimaire:          Boolean(r.interimaire ?? false),
      remplace:             (r.remplace ?? null) as string | null,
      source:               (r.source ?? null) as string | null,
      url_article:          (r.urlArticle  ?? r.url_article  ?? null) as string | null,
      confiance:            r.confiance != null ? Number(r.confiance) : null,
      statut_rapprochement: String(r.statutRapprochement ?? r.statut_rapprochement ?? 'CERTAIN'),
      candidats:            (r.candidats ?? null) as unknown,
      statut:               String(r.statut ?? 'A_VALIDER'),
      valide_par:           (r.validePar   ?? r.valide_par   ?? null) as string | null,
      valide_le:            (r.valideLe    ?? r.valide_le    ?? null) as string | null,
      detecte_le:           String(r.detecteLe  ?? r.detecte_le  ?? ''),
      detail:               (r.detail ?? {}) as unknown,
    }));

    return reply.send({ success: true, data });
  });

  // GET /responsables/propositions/count — badge UI
  fastify.get('/responsables/propositions/count', {
    preHandler: [requireAuth, requireRole(...RESP_ROLES)],
  }, async (_request, reply) => {
    const [row] = await sql`
      SELECT COUNT(*) AS count
      FROM responsable_proposition
      WHERE statut = 'A_VALIDER'
    ` as unknown as Record<string, unknown>[];

    return reply.send({ count: Number(row?.count ?? 0) });
  });

  // PUT /responsables/propositions/:id/entite — choisir le pcode pour une proposition AMBIGU
  fastify.put('/responsables/propositions/:id/entite', {
    preHandler: [requireAuth, requireRole(...RESP_ROLES)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user   = request.jwtUser;
    const body   = z.object({ pcode: z.string().min(1) }).parse(request.body);

    if (!inScope(user, body.pcode)) {
      return reply.status(403).send({ success: false, error: { code: 'SCOPE_DENIED', message: 'Accès restreint à votre périmètre' } });
    }

    const [prop] = await sql`
      SELECT id, statut FROM responsable_proposition WHERE id = ${Number(id)}
    ` as unknown as Record<string, unknown>[];

    if (!prop) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Proposition introuvable' } });
    }

    await sql.unsafe(
      `UPDATE responsable_proposition
       SET pcode = $1, statut_rapprochement = 'CERTAIN'
       WHERE id = $2`,
      [body.pcode, Number(id)],
    );

    return reply.send({ success: true, data: { id: Number(id), pcode: body.pcode } });
  });

  // PUT /responsables/propositions/:id/valider — valider et appliquer la nomination
  fastify.put('/responsables/propositions/:id/valider', {
    preHandler: [requireAuth, requireRole(...RESP_ROLES)],
  }, async (request, reply) => {
    const { id }   = request.params as { id: string };
    const user     = request.jwtUser;
    const userEmail = String(user.email ?? user.id);

    // 1. Lire la proposition
    const [prop] = await sql`
      SELECT id, pcode, personne, fonction, type_acte, date_acte,
             interimaire, source, url_article
      FROM responsable_proposition
      WHERE id = ${Number(id)}
    ` as unknown as Record<string, unknown>[];

    if (!prop) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Proposition introuvable' } });
    }

    // 2. Vérifier que pcode est renseigné
    const pcode = (prop.pcode ?? null) as string | null;
    if (!pcode) {
      return reply.status(400).send({ success: false, error: { code: 'MISSING_PCODE', message: 'Le pcode doit être renseigné avant de valider (proposition AMBIGU ou ENTITE_INTROUVABLE)' } });
    }

    if (!inScope(user, pcode)) {
      return reply.status(403).send({ success: false, error: { code: 'SCOPE_DENIED', message: 'Accès restreint à votre périmètre' } });
    }

    // 3. Lire l'ancien responsable dans admin_divisions
    const [entity] = await sql`
      SELECT pcode, name_fr, responsable_nom, responsable_titre
      FROM admin_divisions
      WHERE pcode = ${pcode}
    ` as unknown as Record<string, unknown>[];

    if (!entity) {
      return reply.status(404).send({ success: false, error: { code: 'ENTITY_NOT_FOUND', message: 'Entité administrative introuvable' } });
    }

    const ancienNom   = (entity.responsableNom   ?? entity.responsable_nom   ?? null) as string | null;
    const ancienTitre = (entity.responsableTitre ?? entity.responsable_titre ?? null) as string | null;
    const entityName  = String(entity.nameFr ?? entity.name_fr ?? pcode);

    const personne  = String(prop.personne ?? '');
    const fonction  = (prop.fonction   ?? null) as string | null;
    const typeActe  = (prop.typeActe   ?? prop.type_acte  ?? null) as string | null;
    const dateActe  = (prop.dateActe   ?? prop.date_acte  ?? null) as string | null;
    const interim   = Boolean(prop.interimaire ?? false);
    const source    = (prop.source ?? null) as string | null;

    const nouveauTitre  = fonction
      ? `${fonction}${interim ? ' (intérimaire)' : ''}`
      : (interim ? '(intérimaire)' : null);
    const sourceStr = [typeActe, dateActe ? `${dateActe}` : null, source ? `via ${source}` : null]
      .filter(Boolean).join(' — ') || null;

    // 4. Insérer dans responsable_history
    await sql.unsafe(
      `INSERT INTO responsable_history (
        pcode, entity_name,
        ancien_nom, ancien_titre, ancien_contact,
        nouveau_nom, nouveau_titre, nouveau_contact,
        modifie_par, source_info, action
      ) VALUES ($1,$2,$3,$4,NULL,$5,$6,NULL,$7,$8,'MODIFICATION')`,
      [pcode, entityName, ancienNom, ancienTitre, personne, nouveauTitre, userEmail, sourceStr],
    );

    // 5. UPDATE admin_divisions
    await sql.unsafe(
      `UPDATE admin_divisions
       SET responsable_nom    = $1,
           responsable_titre  = $2,
           responsable_source = $3,
           responsable_maj_par = $4,
           responsable_maj_le  = NOW()
       WHERE pcode = $5`,
      [personne, nouveauTitre, sourceStr, userEmail, pcode],
    );

    // 5b. UPDATE responsable_proposition
    await sql.unsafe(
      `UPDATE responsable_proposition
       SET statut = 'VALIDE', valide_par = $1, valide_le = NOW()
       WHERE id = $2`,
      [userEmail, Number(id)],
    );

    await writeAuditLog(user.id, 'UPDATE', 'admin_divisions', pcode, request, {
      action: 'PROPOSITION_VALIDEE', proposition_id: Number(id), personne,
    });

    // 6. Retourner résultat
    return reply.send({ success: true, data: { pcode, personne } });
  });

  // PUT /responsables/propositions/:id/rejeter — rejeter une proposition
  fastify.put('/responsables/propositions/:id/rejeter', {
    preHandler: [requireAuth, requireRole(...RESP_ROLES)],
  }, async (request, reply) => {
    const { id }    = request.params as { id: string };
    const user      = request.jwtUser;
    const userEmail = String(user.email ?? user.id);

    const [prop] = await sql`
      SELECT id, pcode, statut FROM responsable_proposition WHERE id = ${Number(id)}
    ` as unknown as Record<string, unknown>[];

    if (!prop) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Proposition introuvable' } });
    }

    const pcode = (prop.pcode ?? null) as string | null;
    if (pcode && !inScope(user, pcode)) {
      return reply.status(403).send({ success: false, error: { code: 'SCOPE_DENIED', message: 'Accès restreint à votre périmètre' } });
    }

    await sql.unsafe(
      `UPDATE responsable_proposition
       SET statut = 'REJETE', valide_par = $1, valide_le = NOW()
       WHERE id = $2`,
      [userEmail, Number(id)],
    );

    return reply.send({ success: true, data: { id: Number(id) } });
  });

  // ---------------------------------------------------------------------------
  // Mandats — historique chronologique des responsables
  // ---------------------------------------------------------------------------

  // GET /responsables/:pcode/mandats — liste des mandats d'une entité
  fastify.get('/responsables/:pcode/mandats', {
    preHandler: [requireAuth, requireRole(...RESP_ROLES)],
  }, async (request, reply) => {
    const { pcode } = request.params as { pcode: string };
    const user = request.jwtUser;

    if (!inScope(user, pcode)) {
      return reply.status(403).send({ success: false, error: { code: 'SCOPE_DENIED', message: 'Accès restreint à votre périmètre' } });
    }

    const mandats = await sql.unsafe(
      `SELECT id, personne, fonction, date_debut, date_fin, interimaire, source, url_source, confiance, statut, cree_le
       FROM responsable_mandat
       WHERE pcode = $1
       ORDER BY COALESCE(date_debut, cree_le) DESC`,
      [pcode],
    ) as unknown as Record<string, unknown>[];

    const data = mandats.map(r => ({
      id:          Number(r.id),
      personne:    String(r.personne ?? ''),
      fonction:    (r.fonction   ?? null) as string | null,
      date_debut:  (r.dateDebut  ?? r.date_debut  ?? null) as string | null,
      date_fin:    (r.dateFin    ?? r.date_fin    ?? null) as string | null,
      interimaire: Boolean(r.interimaire ?? false),
      source:      (r.source     ?? null) as string | null,
      url_source:  (r.urlSource  ?? r.url_source  ?? null) as string | null,
      confiance:   r.confiance != null ? Number(r.confiance) : null,
      statut:      String(r.statut ?? 'HISTORIQUE'),
      cree_le:     String(r.creeLe ?? r.cree_le ?? ''),
    }));

    return reply.send({ success: true, data });
  });

  // POST /responsables/:pcode/mandats — créer manuellement un mandat (reconstitution)
  fastify.post('/responsables/:pcode/mandats', {
    preHandler: [requireAuth, requireRole(...ADMIN_ROLES)],
  }, async (request, reply) => {
    const { pcode } = request.params as { pcode: string };

    const body = z.object({
      personne:    z.string().min(1),
      fonction:    z.string().optional(),
      date_debut:  z.string().optional(),
      date_fin:    z.string().optional(),
      interimaire: z.boolean().default(false),
      source:      z.string().optional(),
      url_source:  z.string().optional(),
      statut:      z.enum(['HISTORIQUE', 'ACTUEL', 'A_VALIDER']).default('HISTORIQUE'),
    }).parse(request.body);

    // Vérifier que le pcode existe dans admin_divisions
    const [entity] = await sql`
      SELECT pcode FROM admin_divisions WHERE pcode = ${pcode}
    ` as unknown as Record<string, unknown>[];

    if (!entity) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Entité administrative introuvable' } });
    }

    const dateDebut   = (body.date_debut  ?? null) as string | null;
    const dateFin     = (body.date_fin    ?? null) as string | null;
    const fonction    = (body.fonction    ?? null) as string | null;
    const source      = (body.source      ?? null) as string | null;
    const urlSource   = (body.url_source  ?? null) as string | null;

    const [row] = await sql.unsafe(
      `INSERT INTO responsable_mandat (pcode, personne, fonction, date_debut, date_fin, interimaire, source, url_source, statut)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [pcode, body.personne, fonction, dateDebut, dateFin, body.interimaire, source, urlSource, body.statut],
    ) as unknown as Record<string, unknown>[];

    return reply.status(201).send({ success: true, data: { id: Number(row.id) } });
  });

  // POST /responsables/propositions — créer une proposition (system_admin uniquement)
  fastify.post('/responsables/propositions', {
    preHandler: [requireAuth, requireRole(...ADMIN_ROLES)],
  }, async (request, reply) => {
    const body = z.object({
      pcode:                z.string().optional(),
      entite_nom:           z.string().optional(),
      personne:             z.string().min(1),
      fonction:             z.string().optional(),
      type_acte:            z.string().optional(),
      date_acte:            z.string().optional(),
      interimaire:          z.boolean().default(false),
      remplace:             z.string().optional(),
      source:               z.string().optional(),
      url_article:          z.string().optional(),
      confiance:            z.number().min(0).max(1).optional(),
      statut_rapprochement: z.enum(['CERTAIN', 'AMBIGU', 'ENTITE_INTROUVABLE']).default('CERTAIN'),
      candidats:            z.unknown().optional(),
      detail:               z.unknown().optional(),
    }).parse(request.body);

    const pcode              = (body.pcode                ?? null) as string | null;
    const entiteNom          = (body.entite_nom           ?? null) as string | null;
    const fonction           = (body.fonction             ?? null) as string | null;
    const typeActe           = (body.type_acte            ?? null) as string | null;
    const dateActe           = (body.date_acte            ?? null) as string | null;
    const remplace           = (body.remplace             ?? null) as string | null;
    const source             = (body.source               ?? null) as string | null;
    const urlArticle         = (body.url_article          ?? null) as string | null;
    const confiance          = (body.confiance            ?? null) as number | null;
    const candidats          = body.candidats != null ? JSON.stringify(body.candidats) : null;
    const detail             = body.detail    != null ? JSON.stringify(body.detail)    : '{}';

    const [row] = await sql.unsafe(
      `INSERT INTO responsable_proposition (
        pcode, entite_nom, personne, fonction, type_acte, date_acte,
        interimaire, remplace, source, url_article, confiance,
        statut_rapprochement, candidats, detail
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING id, pcode, personne, statut, detecte_le`,
      [pcode, entiteNom, body.personne, fonction, typeActe, dateActe,
       body.interimaire, remplace, source, urlArticle, confiance,
       body.statut_rapprochement, candidats, detail],
    ) as unknown as Record<string, unknown>[];

    return reply.status(201).send({ success: true, data: row });
  });
}
