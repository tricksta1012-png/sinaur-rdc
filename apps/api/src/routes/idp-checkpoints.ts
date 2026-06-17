/**
 * Routes IDP Checkpoint — Suivi des flux de déplacés aux points de passage.
 * Accessible à tous les rôles authentifiés pour la saisie ; stats publiques pour les décideurs.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireAuth, requireRole, writeAuditLog } from '../auth/jwt.js';
import { importIdpData } from '../services/idp-importer.js';
import { config } from '../config.js';

const CheckpointSchema = z.object({
  name:           z.string().min(2).max(200),
  provincePcode:  z.string().min(2).max(10),
  provinceName:   z.string().min(2).max(100),
  checkpointType: z.enum(['route', 'border', 'transit_site', 'reception_center']).default('route'),
});

const FlowSchema = z.object({
  checkpointId:    z.string().uuid().optional(),
  checkpointName:  z.string().min(2).max(200),
  provincePcode:   z.string().min(2).max(10),
  direction:       z.enum(['entrant', 'sortant']),
  count:           z.number().int().min(0),
  flowDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  originProvince:  z.string().max(100).optional(),
  destination:     z.string().max(200).optional(),
  notes:           z.string().max(1000).optional(),
});

export async function idpCheckpointRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Checkpoints ────────────────────────────────────────────────────────────

  // GET /idp-checkpoints — liste des checkpoints actifs
  fastify.get('/idp-checkpoints', { preHandler: [requireAuth] }, async (request) => {
    const { province } = z.object({ province: z.string().optional() }).parse(request.query);
    const rows = await sql`
      SELECT id, name, province_pcode, province_name, checkpoint_type, is_active, created_at
      FROM idp_checkpoints
      WHERE is_active = TRUE
      ${province ? sql`AND province_pcode = ${province}` : sql``}
      ORDER BY province_name, name
    `;
    return { data: rows };
  });

  // POST /idp-checkpoints — créer un checkpoint
  fastify.post('/idp-checkpoints', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.jwtUser;
    const body = CheckpointSchema.parse(request.body);
    const [row] = await sql`
      INSERT INTO idp_checkpoints (name, province_pcode, province_name, checkpoint_type, created_by_id)
      VALUES (${body.name}, ${body.provincePcode}, ${body.provinceName}, ${body.checkpointType}, ${user.id}::uuid)
      RETURNING id, name, province_pcode, province_name, checkpoint_type, created_at
    `;
    await writeAuditLog(user.id, 'CREATE', 'idp_checkpoint', row.id, request, body);
    return reply.status(201).send({ data: row });
  });

  // ── Flows ──────────────────────────────────────────────────────────────────

  // GET /idp-checkpoints/flows — liste des flux récents
  fastify.get('/idp-checkpoints/flows', { preHandler: [requireAuth] }, async (request) => {
    const user = request.jwtUser;
    const { limit, province } = z.object({
      limit:    z.coerce.number().int().min(1).max(100).default(20),
      province: z.string().optional(),
    }).parse(request.query);

    // Coordinateurs provinciaux : restreindre aux flux de leur province
    const isScoped = user.role !== 'system_admin' && user.role !== 'national_decision_maker' && user.scope.length > 0;
    const effectiveProvinces = isScoped
      ? (province ? user.scope.filter(s => s === province) : user.scope)
      : (province ? [province] : null);

    const rows = await sql`
      SELECT f.id, f.checkpoint_name, f.province_pcode, f.direction, f.count,
             f.flow_date, f.origin_province, f.destination, f.notes, f.created_at
      FROM idp_flows f
      ${effectiveProvinces ? sql`WHERE f.province_pcode = ANY(${effectiveProvinces}::text[])` : sql``}
      ORDER BY f.flow_date DESC, f.created_at DESC
      LIMIT ${limit}
    `;
    return { data: rows };
  });

  // POST /idp-checkpoints/flows — enregistrer un flux
  fastify.post('/idp-checkpoints/flows', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.jwtUser;
    const body = FlowSchema.parse(request.body);
    const flowDate = body.flowDate ?? new Date().toISOString().slice(0, 10);

    const [row] = await sql`
      INSERT INTO idp_flows (
        checkpoint_id, checkpoint_name, province_pcode, direction, count,
        flow_date, origin_province, destination, notes, recorded_by_id
      ) VALUES (
        ${body.checkpointId ?? null}::uuid,
        ${body.checkpointName},
        ${body.provincePcode},
        ${body.direction},
        ${body.count},
        ${flowDate}::date,
        ${body.originProvince ?? null},
        ${body.destination ?? null},
        ${body.notes ?? null},
        ${user.id}::uuid
      )
      RETURNING id, checkpoint_name, province_pcode, direction, count, flow_date, created_at
    `;
    await writeAuditLog(user.id, 'CREATE', 'idp_flow', row.id, request, { count: body.count, direction: body.direction });
    return reply.status(201).send({ data: row });
  });

  // GET /idp-checkpoints/stats — statistiques agrégées
  fastify.get('/idp-checkpoints/stats', { preHandler: [requireAuth] }, async (request) => {
    const user = request.jwtUser;
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).parse(request.query);

    const isScoped = user.role !== 'system_admin' && user.role !== 'national_decision_maker' && user.scope.length > 0;
    const scopeWhere = isScoped
      ? sql`AND province_pcode = ANY(${user.scope}::text[])`
      : sql``;

    const [totals] = await sql`
      SELECT
        COALESCE(SUM(count) FILTER (WHERE direction = 'entrant'), 0)  AS total_entrant,
        COALESCE(SUM(count) FILTER (WHERE direction = 'sortant'), 0)  AS total_sortant,
        COUNT(DISTINCT checkpoint_name)                               AS active_checkpoints
      FROM idp_flows
      WHERE flow_date >= CURRENT_DATE - (${days} || ' days')::interval
      ${scopeWhere}
    `;

    const byProvince = await sql`
      SELECT province_pcode,
             MAX(province_pcode) AS province,
             SUM(count) AS total_count,
             SUM(count) FILTER (WHERE direction = 'entrant') AS entrant,
             SUM(count) FILTER (WHERE direction = 'sortant') AS sortant
      FROM idp_flows
      WHERE flow_date >= CURRENT_DATE - (${days} || ' days')::interval
      ${scopeWhere}
      GROUP BY province_pcode
      ORDER BY total_count DESC
      LIMIT 10
    `;

    return {
      data: {
        period_days:        days,
        total_entrant:      Number(totals.totalEntrant),
        total_sortant:      Number(totals.totalSortant),
        net_displacement:   Number(totals.totalEntrant) - Number(totals.totalSortant),
        active_checkpoints: Number(totals.activeCheckpoints),
        // Normaliser en snake_case : postgres.js retourne camelCase (totalCount, provincePcode)
        // mais l'interface frontend attend snake_case (total_count, province_pcode)
        by_province: (byProvince as Record<string, unknown>[]).map(r => ({
          province_pcode: String(r.provincePcode ?? r.province_pcode ?? ''),
          total_count:    Number(r.totalCount ?? r.total_count) || 0,
        })),
      },
    };
  });

  // POST /idp-checkpoints/import — import depuis OCHA HDX et IOM DTM
  fastify.post('/idp-checkpoints/import', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'territory_admin')],
  }, async (request, reply) => {
    const user = request.jwtUser;
    const results = await importIdpData({
      dtmApiKey: config.DTM_API_KEY,
      importedById: user.sub,
      requestIp: request.ip,
    });

    const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
    const totalSkipped  = results.reduce((s, r) => s + r.skipped, 0);

    await writeAuditLog(user.sub, 'IMPORT', 'idp_flows', null, request, {
      sources: results.map(r => r.source),
      totalInserted,
    });

    return reply.status(200).send({ success: true, data: { results, totalInserted, totalSkipped } });
  });

  // GET /idp-checkpoints/audit — journal des actions (système_admin seulement)
  fastify.get('/idp-checkpoints/audit', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.jwtUser;
    if (!['system_admin', 'national_decision_maker'].includes(user.role)) {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Accès réservé aux administrateurs' } });
    }
    const { limit, resource } = z.object({
      limit:    z.coerce.number().int().min(1).max(200).default(50),
      resource: z.string().optional(),
    }).parse(request.query);

    const rows = await sql`
      SELECT a.id, a.event_at, a.action, a.resource, a.resource_id,
             a.ip_address, a.details,
             u.display_name AS user_name, u.email AS user_email, u.role AS user_role
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      ${resource ? sql`WHERE a.resource = ${resource}` : sql``}
      ORDER BY a.event_at DESC
      LIMIT ${limit}
    `;
    return { data: rows };
  });
}
