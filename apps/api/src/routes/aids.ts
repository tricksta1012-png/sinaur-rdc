/**
 * Module 6 — Distribution d'aide humanitaire avec traçabilité QR — SINAUR-RDC.
 *
 * Règle métier centrale : UNIQUE(distribution_id, beneficiary_id) — un bénéficiaire
 * ne peut recevoir la même aide qu'une seule fois par distribution.
 *
 * Offline-first : les reçus peuvent être soumis avec clientCreatedAt et sync_status='pending'
 * depuis l'application mobile, puis synchronisés au retour en zone de connexion.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createHmac } from 'crypto'
import { sql } from '../db.js'
import { requireAuth, requireRole, writeAuditLog } from '../auth/jwt.js'

const CreateDistributionSchema = z.object({
  aidType: z.enum(['food', 'medicine', 'shelter', 'school_kit', 'hygiene_kit',
    'cash_transfer', 'nfi', 'water_sanitation', 'protection', 'other']),
  description: z.string().max(500).default(''),
  quantity: z.number().positive(),
  unit: z.string().max(50),
  targetPcodes: z.array(z.string()).min(1),
  plannedDate: z.string().datetime(),
  organizationName: z.string().max(200),
  totalBeneficiariesTargeted: z.number().int().positive(),
  disasterEventId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
})

const CreateReceiptSchema = z.object({
  beneficiaryId: z.string().uuid().optional(), // UUID ou…
  qrCodeScanned: z.string().min(1),           // …données QR brutes (mobile scan)
  quantity: z.number().positive().default(1),
  notes: z.string().max(500).optional(),
  clientCreatedAt: z.string().datetime().optional(),
})

function buildDigitalSignature(distributionId: string, beneficiaryId: string, receivedAt: string): string {
  const secret = process.env.JWT_SECRET ?? 'sinaur_sig_secret'
  return createHmac('sha256', secret)
    .update(`${distributionId}:${beneficiaryId}:${receivedAt}`)
    .digest('hex')
    .slice(0, 32)
}

export async function aidRoutes(fastify: FastifyInstance) {
  // ── Lister les distributions ──
  fastify.get('/distributions', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.jwtUser
    const q = z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      status: z.string().optional(),
      aidType: z.string().optional(),
      pcode: z.string().optional(),
    }).parse(request.query)

    const offset = (q.page - 1) * q.limit
    const isAdmin = user.role === 'system_admin' || user.role === 'national_decision_maker'

    const rows = await sql`
      SELECT
        d.id, d.aid_type, d.description, d.quantity, d.unit, d.status,
        d.target_pcodes, d.planned_date, d.completed_date,
        d.organization_name, d.total_beneficiaries_targeted, d.total_beneficiaries_served,
        d.created_at, u.display_name AS responsible_agent_name
      FROM aid_distributions d
      LEFT JOIN users u ON u.id = d.responsible_agent_id
      WHERE TRUE
        ${!isAdmin && user.scope.length > 0
          ? sql`AND d.target_pcodes && ${user.scope}::text[]`
          : sql``
        }
        ${q.status ? sql`AND d.status = ${q.status}::aid_status` : sql``}
        ${q.aidType ? sql`AND d.aid_type = ${q.aidType}::aid_type` : sql``}
        ${q.pcode ? sql`AND ${q.pcode} = ANY(d.target_pcodes)` : sql``}
      ORDER BY d.planned_date DESC
      LIMIT ${q.limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM aid_distributions
      WHERE TRUE
        ${q.status ? sql`AND status = ${q.status}::aid_status` : sql``}
    `

    return reply.send({
      success: true,
      data: rows,
      pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) },
    })
  })

  // ── Détail d'une distribution ──
  fastify.get('/distributions/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [row] = await sql`
      SELECT
        d.*,
        u.display_name AS responsible_agent_name,
        ROUND(d.total_beneficiaries_served::numeric / NULLIF(d.total_beneficiaries_targeted, 0) * 100, 1) AS completion_pct
      FROM aid_distributions d
      LEFT JOIN users u ON u.id = d.responsible_agent_id
      WHERE d.id = ${id}::uuid
    `
    if (!row) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Distribution introuvable' } })
    }
    return reply.send({ success: true, data: row })
  })

  // ── Créer une distribution ──
  fastify.post('/distributions', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'provincial_coordinator', 'humanitarian_partner')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const body = CreateDistributionSchema.parse(request.body)

    const [row] = await sql`
      INSERT INTO aid_distributions (
        aid_type, description, quantity, unit, status, target_pcodes,
        planned_date, organization_name, responsible_agent_id,
        total_beneficiaries_targeted, disaster_event_id, created_by_id, notes
      ) VALUES (
        ${body.aidType}::aid_type, ${body.description}, ${body.quantity}, ${body.unit},
        'planned', ${body.targetPcodes},
        ${body.plannedDate}::timestamptz, ${body.organizationName}, ${user.sub}::uuid,
        ${body.totalBeneficiariesTargeted},
        ${body.disasterEventId ?? null},
        ${user.sub}::uuid,
        ${body.notes ?? null}
      )
      RETURNING id, aid_type, description, quantity, unit, status, target_pcodes,
                planned_date, organization_name, total_beneficiaries_targeted, created_at
    `

    await writeAuditLog(user.sub, 'create_distribution', 'aid_distributions', row.id, request,
      { aidType: body.aidType, targetPcodes: body.targetPcodes })

    return reply.status(201).send({ success: true, data: row })
  })

  // ── Mettre à jour le statut d'une distribution ──
  fastify.patch('/distributions/:id', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'provincial_coordinator', 'humanitarian_partner', 'field_agent')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id } = request.params as { id: string }
    const body = z.object({
      status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).optional(),
      completedDate: z.string().datetime().optional(),
    }).parse(request.body)

    const [row] = await sql`SELECT id, status FROM aid_distributions WHERE id = ${id}::uuid`
    if (!row) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Distribution introuvable' } })
    }

    const [updated] = await sql`
      UPDATE aid_distributions
      SET
        status = COALESCE(${body.status as any ?? null}, status),
        completed_date = COALESCE(${body.completedDate ?? null}::timestamptz, completed_date)
      WHERE id = ${id}::uuid
      RETURNING id, status, completed_date, total_beneficiaries_served
    `

    await writeAuditLog(user.sub, 'update_distribution', 'aid_distributions', id, request, body)

    return reply.send({ success: true, data: updated })
  })

  // ── Enregistrer un reçu (scan QR) — offline-first ──
  fastify.post('/distributions/:id/receipts', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'provincial_coordinator', 'humanitarian_partner', 'field_agent')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id: distributionId } = request.params as { id: string }
    const body = CreateReceiptSchema.parse(request.body)

    // Vérifier la distribution
    const [dist] = await sql`
      SELECT id, status, total_beneficiaries_targeted, total_beneficiaries_served
      FROM aid_distributions WHERE id = ${distributionId}::uuid
    `
    if (!dist) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Distribution introuvable' } })
    }
    if (dist.status === 'cancelled') {
      return reply.status(409).send({ success: false, error: { code: 'DISTRIBUTION_CANCELLED', message: 'Distribution annulée' } })
    }

    // Résoudre le bénéficiaire : par UUID direct ou par scan QR
    let beneficiaryId = body.beneficiaryId
    if (!beneficiaryId) {
      let qrObj: { id?: string } = {}
      try { qrObj = JSON.parse(body.qrCodeScanned) } catch {}
      beneficiaryId = qrObj.id
    }

    if (!beneficiaryId) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_QR', message: 'QR code invalide ou bénéficiaire inconnu' } })
    }

    // Vérifier que le bénéficiaire est validé
    const [ben] = await sql`
      SELECT id, status, qr_revoked_at FROM beneficiaries
      WHERE id = ${beneficiaryId}::uuid AND deleted_at IS NULL
    `
    if (!ben) {
      return reply.status(404).send({ success: false, error: { code: 'BENEFICIARY_NOT_FOUND', message: 'Bénéficiaire introuvable' } })
    }
    if (ben.status !== 'validated') {
      return reply.status(409).send({ success: false, error: { code: 'BENEFICIARY_NOT_VALIDATED', message: 'Bénéficiaire non encore validé' } })
    }
    if (ben.qrRevokedAt) {
      return reply.status(409).send({ success: false, error: { code: 'QR_REVOKED', message: 'QR code de ce bénéficiaire révoqué' } })
    }

    // Règle métier : unicité (distribution, beneficiary)
    const [dup] = await sql`
      SELECT id FROM aid_receipts
      WHERE distribution_id = ${distributionId}::uuid AND beneficiary_id = ${beneficiaryId}::uuid
    `
    if (dup) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'ALREADY_RECEIVED',
          message: 'Ce bénéficiaire a déjà reçu cette aide pour cette distribution',
          details: { receiptId: dup.id },
        },
      })
    }

    const receivedAt = body.clientCreatedAt ?? new Date().toISOString()
    const signature = buildDigitalSignature(distributionId, beneficiaryId, receivedAt)

    const [receipt] = await sql`
      INSERT INTO aid_receipts (
        distribution_id, beneficiary_id, qr_code_scanned,
        received_at, distributed_by_id, digital_signature,
        quantity, notes, sync_status, client_created_at
      ) VALUES (
        ${distributionId}::uuid, ${beneficiaryId}::uuid, ${body.qrCodeScanned},
        ${receivedAt}::timestamptz, ${user.sub}::uuid, ${signature},
        ${body.quantity}, ${body.notes ?? null},
        ${body.clientCreatedAt ? 'synced' : 'synced'},
        ${body.clientCreatedAt ?? null}
      )
      RETURNING id, distribution_id, beneficiary_id, received_at, quantity, digital_signature
    `

    // Mettre à jour statut distribution si premier reçu
    if (dist.status === 'planned') {
      await sql`UPDATE aid_distributions SET status = 'in_progress' WHERE id = ${distributionId}::uuid`
    }

    await writeAuditLog(user.sub, 'create_receipt', 'aid_receipts', receipt.id, request,
      { distributionId, beneficiaryId })

    return reply.status(201).send({ success: true, data: receipt })
  })

  // ── Liste des reçus d'une distribution ──
  fastify.get('/distributions/:id/receipts', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const q = z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(request.query)

    const offset = (q.page - 1) * q.limit

    const rows = await sql`
      SELECT
        r.id, r.received_at, r.quantity, r.sync_status,
        r.digital_signature,
        b.registration_number,
        b.household_size,
        -- Pas de données nominatives dans la liste (§9 minimisation)
        b.location_pcode,
        u.display_name AS distributed_by_name
      FROM aid_receipts r
      JOIN beneficiaries b ON b.id = r.beneficiary_id
      JOIN users u ON u.id = r.distributed_by_id
      WHERE r.distribution_id = ${id}::uuid
      ORDER BY r.received_at DESC
      LIMIT ${q.limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM aid_receipts WHERE distribution_id = ${id}::uuid
    `

    return reply.send({
      success: true,
      data: rows,
      pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) },
    })
  })

  // ── Export CSV HXL des distributions ──
  fastify.get('/distributions/:id/export.csv', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'provincial_coordinator', 'humanitarian_partner')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const [dist] = await sql`SELECT * FROM aid_distributions WHERE id = ${id}::uuid`
    if (!dist) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Distribution introuvable' } })
    }

    const rows = await sql`
      SELECT
        r.id               AS receipt_id,
        r.received_at,
        r.quantity,
        b.registration_number,
        b.location_pcode,
        b.household_size,
        b.vulnerability_level,
        -- Anonymisation §9 : no name, no birthdate, no coordinates
        u.display_name     AS distributed_by
      FROM aid_receipts r
      JOIN beneficiaries b ON b.id = r.beneficiary_id
      JOIN users u ON u.id = r.distributed_by_id
      WHERE r.distribution_id = ${id}::uuid
      ORDER BY r.received_at
    `

    // En-têtes HXL (Humanitarian Exchange Language)
    const hxlHeaders = '#receipt+id,#date+received,#quantity,#beneficiary+code,#adm+pcode,#household+size,#vulnerability+level,#actor+name'
    const csvHeaders = 'receipt_id,received_at,quantity,registration_number,location_pcode,household_size,vulnerability_level,distributed_by'
    const csvRows = rows.map(r =>
      [r.receiptId, r.receivedAt, r.quantity, r.registrationNumber,
       r.locationPcode, r.householdSize, r.vulnerabilityLevel, `"${r.distributedBy}"`].join(',')
    )
    const csv = [hxlHeaders, csvHeaders, ...csvRows].join('\n')

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="distribution-${id.slice(0, 8)}.csv"`)
      .send(csv)
  })
}
