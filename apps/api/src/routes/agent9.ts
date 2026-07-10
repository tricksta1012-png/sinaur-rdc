import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from '../db.js'
import { requireAuth, requireRole } from '../auth/jwt.js'

// Rôles autorisés à accéder aux sorties de l'Agent 9
// humanitarian_partner accède uniquement aux recommandations validées (pas aux scores bruts)
const AGENT9_ROLES = ['system_admin', 'national_decision_maker', 'territory_admin'] as const

const incidentQuerySchema = z.object({
  pcode:      z.string().optional(),
  eventType:  z.string().optional(),
  dateFrom:   z.string().optional(),
  dateTo:     z.string().optional(),
  limit:      z.coerce.number().min(1).max(200).default(50),
  page:       z.coerce.number().min(1).default(1),
})

const alertValidateSchema = z.object({
  action:         z.enum(['VALIDATED', 'REJECTED', 'MODIFIED']),
  analyst_note:   z.string().min(1).max(2000),
  modified_level: z.enum(['FAIBLE', 'MOYEN', 'ELEVE', 'CRITIQUE']).optional(),
})

export async function agent9Routes(fastify: FastifyInstance): Promise<void> {

  // ── GET /agent9/health ─────────────────────────────────────────────────────
  fastify.get('/agent9/health', async (_req, reply) => {
    const [row] = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM violence_incidents
    `
    return reply.send({
      success: true,
      data: { status: 'ok', incident_count: parseInt(row?.count ?? '0', 10) },
    })
  })

  // ── GET /agent9/incidents ──────────────────────────────────────────────────
  // Liste des incidents de violence (sources publiques). Accès restreint analystes.
  fastify.get(
    '/agent9/incidents',
    { preHandler: [requireAuth, requireRole(...AGENT9_ROLES)] },
    async (request, reply) => {
      const q = incidentQuerySchema.parse(request.query)
      const offset = (q.page - 1) * q.limit

      const userPcode = (request.jwtUser as any).scope?.[0] as string | undefined

      // territory_admin : limité à son périmètre
      const scopePcode = (request.jwtUser as any).role === 'territory_admin' ? userPcode : q.pcode

      const rows = await sql`
        SELECT
          vi.id,
          vi.source_id,
          vi.source_type,
          vi.source_url,
          vi.event_date,
          vi.pcode_2,
          ad.name AS zone_name,
          vi.event_type,
          vi.target_type,
          vi.consequence_types,
          vi.fatalities,
          vi.estimated_affected,
          vi.source_reliability,
          vi.ingested_at,
          ST_AsGeoJSON(vi.location)::json AS location
        FROM violence_incidents vi
        LEFT JOIN admin_divisions ad ON ad.pcode = vi.pcode_2
        WHERE TRUE
          ${scopePcode ? sql`AND vi.pcode_2 = ${scopePcode}` : sql``}
          ${q.eventType ? sql`AND vi.event_type = ${q.eventType}` : sql``}
          ${q.dateFrom  ? sql`AND vi.event_date >= ${q.dateFrom}::date` : sql``}
          ${q.dateTo    ? sql`AND vi.event_date <= ${q.dateTo}::date` : sql``}
        ORDER BY vi.event_date DESC
        LIMIT ${q.limit} OFFSET ${offset}
      `

      const [{ total }] = await sql<{ total: string }[]>`
        SELECT COUNT(*)::text AS total
        FROM violence_incidents vi
        WHERE TRUE
          ${scopePcode ? sql`AND vi.pcode_2 = ${scopePcode}` : sql``}
          ${q.eventType ? sql`AND vi.event_type = ${q.eventType}` : sql``}
          ${q.dateFrom  ? sql`AND vi.event_date >= ${q.dateFrom}::date` : sql``}
          ${q.dateTo    ? sql`AND vi.event_date <= ${q.dateTo}::date` : sql``}
      `

      await logAccess(request, null, 'VIEW_SCORE')
      return reply.send({
        success: true,
        data: rows,
        pagination: { page: q.page, limit: q.limit, total: parseInt(total, 10) },
      })
    },
  )

  // ── GET /agent9/incidents/stats ────────────────────────────────────────────
  // Agrégation par pcode pour la carte de chaleur (phase 0 : données historiques)
  fastify.get(
    '/agent9/incidents/stats',
    { preHandler: [requireAuth, requireRole(...AGENT9_ROLES)] },
    async (request, reply) => {
      const { dateFrom, dateTo } = z.object({
        dateFrom: z.string().optional(),
        dateTo:   z.string().optional(),
      }).parse(request.query)

      const rows = await sql`
        SELECT
          vi.pcode_2                    AS pcode,
          ad.name                       AS zone_name,
          COUNT(*)::int                 AS incident_count,
          SUM(vi.fatalities)::int       AS total_fatalities,
          MAX(vi.event_date)            AS latest_incident,
          array_agg(DISTINCT vi.event_type) AS event_types
        FROM violence_incidents vi
        LEFT JOIN admin_divisions ad ON ad.pcode = vi.pcode_2
        WHERE vi.pcode_2 IS NOT NULL
          ${dateFrom ? sql`AND vi.event_date >= ${dateFrom}::date` : sql``}
          ${dateTo   ? sql`AND vi.event_date <= ${dateTo}::date`   : sql``}
        GROUP BY vi.pcode_2, ad.name
        ORDER BY incident_count DESC
      `

      return reply.send({ success: true, data: rows })
    },
  )

  // ── GET /agent9/vulnerability/:pcode ──────────────────────────────────────
  fastify.get(
    '/agent9/vulnerability/:pcode',
    { preHandler: [requireAuth, requireRole(...AGENT9_ROLES)] },
    async (request, reply) => {
      const { pcode } = request.params as { pcode: string }

      const [row] = await sql`
        SELECT
          zv.*,
          ad.name AS zone_name
        FROM zone_vulnerability zv
        JOIN admin_divisions ad ON ad.pcode = zv.pcode
        WHERE zv.pcode = ${pcode}
      `

      if (!row) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Aucune donnée de vulnérabilité pour ce pcode' },
        })
      }

      await logAccess(request, null, 'VIEW_SCORE')
      return reply.send({ success: true, data: row })
    },
  )

  // ── GET /agent9/scores ────────────────────────────────────────────────────
  // Scores de risque (sera alimenté en Phase 2+). En phase 0 retourne tableau vide.
  fastify.get(
    '/agent9/scores',
    { preHandler: [requireAuth, requireRole(...AGENT9_ROLES)] },
    async (request, reply) => {
      const { horizon, level, pcode } = z.object({
        horizon: z.coerce.number().optional().default(7),
        level:   z.string().optional(),
        pcode:   z.string().optional(),
      }).parse(request.query)

      const rows = await sql`
        SELECT
          rs.id, rs.pcode, rs.score, rs.level, rs.confidence,
          rs.uncertainty_low, rs.uncertainty_high,
          rs.top_factors, rs.horizon_days,
          rs.model_version, rs.computed_at,
          rs.requires_validation,
          ad.name AS zone_name
        FROM risk_scores_agent9 rs
        JOIN admin_divisions ad ON ad.pcode = rs.pcode
        WHERE rs.horizon_days = ${horizon}
          ${level ? sql`AND rs.level = ${level}` : sql``}
          ${pcode ? sql`AND rs.pcode = ${pcode}` : sql``}
        ORDER BY rs.score DESC, rs.computed_at DESC
        LIMIT 100
      `

      return reply.send({ success: true, data: rows })
    },
  )

  // ── GET /agent9/alerts ────────────────────────────────────────────────────
  // File de validation pour les analystes
  fastify.get(
    '/agent9/alerts',
    { preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker')] },
    async (request, reply) => {
      const { statut } = z.object({
        statut: z.string().optional().default('PENDING_VALIDATION'),
      }).parse(request.query)

      const rows = await sql`
        SELECT
          a.id, a.pcode, a.level, a.statut,
          a.created_at, a.validated_at,
          a.analyst_note, a.analyst_modified_level,
          a.recommended_actions,
          ad.name AS zone_name,
          u.display_name AS analyst_name,
          rs.score, rs.confidence, rs.top_factors, rs.model_version, rs.computed_at
        FROM agent9_alerts a
        JOIN admin_divisions ad ON ad.pcode = a.pcode
        LEFT JOIN users u       ON u.id = a.analyst_id
        LEFT JOIN risk_scores_agent9 rs ON rs.id = a.risk_score_id
        WHERE a.statut = ${statut}
        ORDER BY
          CASE a.level
            WHEN 'CRITIQUE' THEN 1
            WHEN 'ELEVE'    THEN 2
            WHEN 'MOYEN'    THEN 3
            ELSE 4
          END,
          a.created_at DESC
      `

      return reply.send({ success: true, data: rows })
    },
  )

  // ── POST /agent9/alerts/:id/validate ──────────────────────────────────────
  // Validation humaine obligatoire — aucune alerte ne se diffuse sans ce verrou.
  fastify.post(
    '/agent9/alerts/:id/validate',
    { preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = alertValidateSchema.parse(request.body)
      const analystId = request.jwtUser.sub

      if (body.action === 'MODIFIED' && !body.modified_level) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'modified_level obligatoire pour action MODIFIED' },
        })
      }

      const [alert] = await sql`
        SELECT id, statut, pcode FROM agent9_alerts WHERE id = ${id}
      `

      if (!alert) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND' } })
      }

      if (alert.statut !== 'PENDING_VALIDATION') {
        return reply.status(409).send({
          success: false,
          error: { code: 'ALREADY_PROCESSED', message: 'Cette alerte a déjà été traitée' },
        })
      }

      const diffusionScope = body.action === 'VALIDATED' || body.action === 'MODIFIED'
        ? ['system_admin', 'national_decision_maker', 'territory_admin']
        : []

      const [updated] = await sql`
        UPDATE agent9_alerts SET
          statut                = ${body.action},
          analyst_id            = ${analystId},
          validated_at          = NOW(),
          analyst_note          = ${body.analyst_note},
          analyst_modified_level = ${body.modified_level ?? null},
          diffused_at           = ${body.action !== 'REJECTED' ? sql`NOW()` : sql`NULL`},
          diffusion_scope       = ${diffusionScope}
        WHERE id = ${id}
        RETURNING id, statut, pcode, level, validated_at
      `

      await logAccess(request, id, body.action === 'REJECTED' ? 'REJECT' : 'VALIDATE')
      return reply.send({ success: true, data: updated })
    },
  )

  // ── GET /agent9/weights ───────────────────────────────────────────────────
  // Consultation de la pondération active
  fastify.get(
    '/agent9/weights',
    { preHandler: [requireAuth, requireRole('system_admin')] },
    async (_req, reply) => {
      const [row] = await sql`
        SELECT id, version, weights, note, activated_at, created_at
        FROM scoring_weights_agent9
        WHERE is_active = TRUE
        LIMIT 1
      `
      return reply.send({ success: true, data: row ?? null })
    },
  )
}

// ─── Helper : journalisation des accès ───────────────────────────────────────

async function logAccess(
  request: { jwtUser: { sub: string }; ip: string },
  alertId: string | null,
  action: string,
): Promise<void> {
  try {
    await sql`
      INSERT INTO agent9_access_log (user_id, alert_id, action, ip_addr)
      VALUES (${request.jwtUser.sub}, ${alertId}, ${action}, ${request.ip}::inet)
    `
  } catch { /* non bloquant */ }
}
