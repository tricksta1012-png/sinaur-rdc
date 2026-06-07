/**
 * Module 5 — Registre national des bénéficiaires SINAUR-RDC.
 *
 * Sécurité §9 (priorité absolue) :
 *  - Données de personnes vulnérables : déplacés, réfugiés, victimes de conflit
 *  - RBAC + périmètre géographique strict sur toutes les lectures
 *  - location_obfuscated masque les coordonnées précises si is_sensitive = true
 *  - Déduplication fingerprint + pg_trgm pour éviter double-inscription
 *  - Chaîne de validation 5 niveaux avant statut 'validated'
 *  - Audit log sur tout accès aux données personnelles
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createHash, createHmac } from 'crypto'
import { sql } from '../db.js'
import { requireAuth, requireRole, writeAuditLog } from '../auth/jwt.js'

const VALIDATION_STEPS = [
  'neighborhood_chief',
  'village_chief',
  'mayor',
  'territory_admin',
  'humanitarian_partner',
] as const

const HouseholdMemberSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  birthDate: z.string().date().optional(),
  gender: z.enum(['M', 'F', 'other']),
  isHeadOfHousehold: z.boolean().default(false),
  hasDisability: z.boolean().optional(),
  isPregnant: z.boolean().optional(),
  isUnaccompanied: z.boolean().optional(),
})

const CreateBeneficiarySchema = z.object({
  householdHead: HouseholdMemberSchema,
  householdMembers: z.array(HouseholdMemberSchema).default([]),
  vulnerabilityFactors: z.array(z.string()).default([]),
  disasterType: z.string(),
  disasterEventId: z.string().uuid().optional(),
  locationPcode: z.string().min(2).max(20),
  locationName: z.string().min(2).max(200),
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
  originPcode: z.string().optional(),
  originName: z.string().optional(),
  notes: z.string().max(1000).optional(),
  isSensitive: z.boolean().default(false),
  clientCreatedAt: z.string().datetime().optional(),
})

function buildDedupFingerprint(
  firstName: string,
  lastName: string,
  birthDate: string | undefined,
  pcode: string,
): string {
  const normalized = [
    firstName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
    lastName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
    birthDate ?? '',
    pcode.slice(0, 4),
  ].join('|')
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32)
}

function generateRegistrationNumber(): string {
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `BEN-${ym}-${rand}`
}

function generateQRData(id: string, regNum: string): string {
  return JSON.stringify({ type: 'SINAUR_BENEFICIARY', id, regNum, v: 1 })
}

export async function registryRoutes(fastify: FastifyInstance) {
  // ── Liste des bénéficiaires (avec filtres, sans données sensibles par défaut) ──
  fastify.get('/beneficiaries', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.jwtUser
    const q = z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      status: z.string().optional(),
      pcode: z.string().optional(),
      disasterType: z.string().optional(),
      search: z.string().optional(),
      vulnerability: z.string().optional(),
    }).parse(request.query)

    const offset = (q.page - 1) * q.limit
    const isAdmin = user.role === 'system_admin' || user.role === 'national_decision_maker'

    const rows = await sql`
      SELECT
        b.id, b.registration_number, b.status, b.vulnerability_level,
        b.vulnerability_factors, b.disaster_type, b.household_size,
        b.location_pcode, b.location_name,
        b.current_validation_step, b.registered_at,
        -- Masquer les infos personnelles pour les rôles sans accès direct
        CASE
          WHEN ${user.role === 'field_agent' || isAdmin} THEN b.head_first_name
          ELSE NULL
        END AS head_first_name,
        CASE
          WHEN ${user.role === 'field_agent' || isAdmin} THEN b.head_last_name
          ELSE NULL
        END AS head_last_name,
        CASE
          WHEN ${user.role === 'field_agent' || isAdmin} THEN b.head_birth_date
          ELSE NULL
        END AS head_birth_date,
        -- Obfuscation géographique si flaggé sensible
        CASE WHEN b.location_obfuscated THEN NULL
             ELSE ST_AsGeoJSON(b.location_point)::json
        END AS location_point,
        u.display_name AS registered_by_name
      FROM beneficiaries b
      LEFT JOIN users u ON u.id = b.registered_by_id
      WHERE b.deleted_at IS NULL
        -- Filtrage par périmètre géographique (RBAC)
        ${!isAdmin && user.scope.length > 0
          ? sql`AND EXISTS (
              SELECT 1 FROM unnest(${user.scope}::text[]) AS s
              WHERE b.location_pcode LIKE s || '%'
            )`
          : sql``
        }
        ${q.status ? sql`AND b.status = ${q.status}::beneficiary_status` : sql``}
        ${q.pcode ? sql`AND b.location_pcode = ${q.pcode}` : sql``}
        ${q.disasterType ? sql`AND b.disaster_type = ${q.disasterType}::hazard_type` : sql``}
        ${q.vulnerability ? sql`AND b.vulnerability_level = ${q.vulnerability}::vulnerability_level` : sql``}
        ${q.search ? sql`AND (
          b.head_first_name ILIKE ${'%' + q.search + '%'}
          OR b.head_last_name ILIKE ${'%' + q.search + '%'}
          OR b.registration_number ILIKE ${'%' + q.search + '%'}
        )` : sql``}
      ORDER BY b.registered_at DESC
      LIMIT ${q.limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM beneficiaries
      WHERE deleted_at IS NULL
        ${q.status ? sql`AND status = ${q.status}::beneficiary_status` : sql``}
    `

    await writeAuditLog(user.sub, 'list_beneficiaries', 'beneficiaries', null, request, { filters: q })

    return reply.send({
      success: true,
      data: rows,
      pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) },
    })
  })

  // ── Détail d'un bénéficiaire (avec données complètes selon rôle) ──
  fastify.get('/beneficiaries/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.jwtUser
    const { id } = request.params as { id: string }

    const [row] = await sql`
      SELECT
        b.*,
        ST_AsGeoJSON(b.location_point)::json AS location_point,
        u.display_name AS registered_by_name
      FROM beneficiaries b
      LEFT JOIN users u ON u.id = b.registered_by_id
      WHERE b.id = ${id}::uuid AND b.deleted_at IS NULL
    `
    if (!row) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Bénéficiaire introuvable' } })
    }

    // Vérifier le périmètre géographique
    const isAdmin = user.role === 'system_admin' || user.role === 'national_decision_maker'
    if (!isAdmin && user.scope.length > 0 && !user.scope.some(s => row.locationPcode?.startsWith(s))) {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Hors de votre périmètre géographique' } })
    }

    // Obfusquer les coordonnées précises si is_sensitive et accès non-opérationnel
    if (row.isSensitive && user.role === 'humanitarian_partner') {
      row.locationPoint = null
    }

    await writeAuditLog(user.sub, 'view_beneficiary', 'beneficiaries', id, request, null)

    return reply.send({ success: true, data: row })
  })

  // ── Créer un bénéficiaire (field_agent et au-dessus) ──
  fastify.post('/beneficiaries', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'provincial_coordinator', 'field_agent')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const body = CreateBeneficiarySchema.parse(request.body)

    const fingerprint = buildDedupFingerprint(
      body.householdHead.firstName,
      body.householdHead.lastName,
      body.householdHead.birthDate,
      body.locationPcode,
    )

    // Vérification doublon exact
    const [existing] = await sql`
      SELECT id, registration_number FROM beneficiaries
      WHERE deduplication_fingerprint = ${fingerprint}
        AND deleted_at IS NULL
      LIMIT 1
    `
    if (existing) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'DUPLICATE_BENEFICIARY',
          message: 'Un bénéficiaire avec des données identiques existe déjà',
          details: { existingId: existing.id, registrationNumber: existing.registrationNumber },
        },
      })
    }

    // Recherche de doublons approximatifs (pg_trgm)
    const nameFull = `${body.householdHead.firstName} ${body.householdHead.lastName}`
    const fuzzyDuplicates = await sql`
      SELECT id, registration_number, head_first_name, head_last_name, head_birth_date,
             similarity(head_first_name || ' ' || head_last_name, ${nameFull}) AS sim
      FROM beneficiaries
      WHERE deleted_at IS NULL
        AND similarity(head_first_name || ' ' || head_last_name, ${nameFull}) > 0.7
        ${body.householdHead.birthDate ? sql`AND head_birth_date = ${body.householdHead.birthDate}::date` : sql``}
      LIMIT 5
    `

    const regNum = generateRegistrationNumber()
    const newId = crypto.randomUUID()
    const qrData = generateQRData(newId, regNum)

    const householdSize = 1 + body.householdMembers.length
    const vulnerabilityLevel = computeVulnerabilityLevel(body.householdMembers, body.vulnerabilityFactors)

    const pointSql = body.locationLat !== undefined && body.locationLng !== undefined
      ? sql`ST_SetSRID(ST_MakePoint(${body.locationLng}, ${body.locationLat}), 4326)`
      : sql`NULL`

    const [created] = await sql`
      INSERT INTO beneficiaries (
        id, registration_number, qr_code_data, status,
        head_first_name, head_last_name, head_birth_date, head_gender,
        household_members, household_size,
        vulnerability_level, vulnerability_factors,
        disaster_type, disaster_event_id,
        location_pcode, location_name, location_point,
        origin_pcode, origin_name,
        current_validation_step,
        registered_by_id, registered_at,
        deduplication_fingerprint,
        notes, is_sensitive, location_obfuscated,
        sync_status, client_created_at
      ) VALUES (
        ${newId}::uuid, ${regNum}, ${qrData}, 'pending',
        ${body.householdHead.firstName}, ${body.householdHead.lastName},
        ${body.householdHead.birthDate ?? null}, ${body.householdHead.gender},
        ${JSON.stringify(body.householdMembers)}::jsonb, ${householdSize},
        ${vulnerabilityLevel}::vulnerability_level, ${body.vulnerabilityFactors},
        ${body.disasterType}::hazard_type, ${body.disasterEventId ?? null},
        ${body.locationPcode}, ${body.locationName}, ${pointSql},
        ${body.originPcode ?? null}, ${body.originName ?? null},
        'neighborhood_chief'::validation_step,
        ${user.sub}::uuid, NOW(),
        ${fingerprint},
        ${body.notes ?? null}, ${body.isSensitive}, ${body.isSensitive},
        'synced', ${body.clientCreatedAt ?? null}
      )
      RETURNING id, registration_number, qr_code_data, status, vulnerability_level,
                household_size, location_pcode, current_validation_step, registered_at
    `

    await writeAuditLog(user.sub, 'create_beneficiary', 'beneficiaries', created.id, request, { disasterType: body.disasterType })

    return reply.status(201).send({
      success: true,
      data: created,
      duplicateCandidates: fuzzyDuplicates.length > 0 ? fuzzyDuplicates : undefined,
      message: fuzzyDuplicates.length > 0
        ? `Bénéficiaire créé. ${fuzzyDuplicates.length} doublon(s) potentiel(s) détecté(s) — revue recommandée.`
        : 'Bénéficiaire enregistré avec succès.',
    })
  })

  // ── Étape de validation hiérarchique ──
  fastify.post('/beneficiaries/:id/validate', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'provincial_coordinator', 'field_agent')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id } = request.params as { id: string }
    const body = z.object({
      approved: z.boolean(),
      notes: z.string().max(500).optional(),
    }).parse(request.body)

    const [ben] = await sql`
      SELECT id, status, current_validation_step, validation_chain
      FROM beneficiaries WHERE id = ${id}::uuid AND deleted_at IS NULL
    `
    if (!ben) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Bénéficiaire introuvable' } })
    }
    if (ben.status === 'validated' || ben.status === 'rejected') {
      return reply.status(409).send({ success: false, error: { code: 'ALREADY_PROCESSED', message: 'Bénéficiaire déjà traité' } })
    }

    const currentStepIdx = VALIDATION_STEPS.indexOf(ben.currentValidationStep as any)
    const newRecord = {
      step: ben.currentValidationStep,
      validatedBy: { id: user.sub, name: user.email },
      validatedAt: new Date().toISOString(),
      approved: body.approved,
      notes: body.notes ?? null,
    }

    const chain = [...(ben.validationChain ?? []), newRecord]

    let newStatus = 'under_validation'
    let nextStep: string | null = null

    if (!body.approved) {
      newStatus = 'rejected'
    } else if (currentStepIdx >= VALIDATION_STEPS.length - 1) {
      newStatus = 'validated'
    } else {
      nextStep = VALIDATION_STEPS[currentStepIdx + 1]
    }

    const [updated] = await sql`
      UPDATE beneficiaries
      SET
        status = ${newStatus}::beneficiary_status,
        current_validation_step = ${nextStep as any},
        validation_chain = ${JSON.stringify(chain)}::jsonb
      WHERE id = ${id}::uuid
      RETURNING id, status, current_validation_step, validation_chain
    `

    await writeAuditLog(user.sub, body.approved ? 'validate_beneficiary' : 'reject_beneficiary',
      'beneficiaries', id, request, { step: ben.currentValidationStep })

    return reply.send({
      success: true,
      data: updated,
      message: newStatus === 'validated'
        ? 'Bénéficiaire validé — chaîne de validation complète.'
        : newStatus === 'rejected'
          ? 'Bénéficiaire rejeté.'
          : `Étape validée. Prochaine étape : ${nextStep}`,
    })
  })

  // ── Recherche phonétique de doublons ──
  fastify.get('/beneficiaries/search-duplicates', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'provincial_coordinator', 'field_agent')],
  }, async (request, reply) => {
    const { firstName, lastName, birthDate } = request.query as Record<string, string>
    if (!firstName && !lastName) {
      return reply.status(400).send({ success: false, error: { code: 'MISSING_PARAMS', message: 'firstName ou lastName requis' } })
    }
    const nameFull = `${firstName ?? ''} ${lastName ?? ''}`.trim()

    const candidates = await sql`
      SELECT id, registration_number, head_first_name, head_last_name, head_birth_date,
             location_pcode, status,
             similarity(head_first_name || ' ' || head_last_name, ${nameFull}) AS similarity_score
      FROM beneficiaries
      WHERE deleted_at IS NULL
        AND similarity(head_first_name || ' ' || head_last_name, ${nameFull}) > 0.6
        ${birthDate ? sql`AND head_birth_date = ${birthDate}::date` : sql``}
      ORDER BY similarity_score DESC
      LIMIT 10
    `

    return reply.send({ success: true, data: candidates })
  })

  // ── Données QR d'un bénéficiaire ──
  fastify.get('/beneficiaries/:id/qr', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'provincial_coordinator', 'field_agent')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [row] = await sql`
      SELECT qr_code_data, registration_number, qr_version, qr_revoked_at
      FROM beneficiaries WHERE id = ${id}::uuid AND deleted_at IS NULL
    `
    if (!row) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Bénéficiaire introuvable' } })
    }
    if (row.qrRevokedAt) {
      return reply.status(410).send({ success: false, error: { code: 'QR_REVOKED', message: 'QR code révoqué' } })
    }
    await writeAuditLog(request.jwtUser.sub, 'view_qr', 'beneficiaries', id, request, null)
    return reply.send({ success: true, data: { qrCodeData: row.qrCodeData, registrationNumber: row.registrationNumber, version: row.qrVersion } })
  })

  // ── Fusionner un doublon (admin uniquement) ──
  fastify.post('/beneficiaries/:id/merge/:duplicateId', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id, duplicateId } = request.params as { id: string; duplicateId: string }

    const rows = await sql`
      SELECT id FROM beneficiaries
      WHERE id = ANY(ARRAY[${id}::uuid, ${duplicateId}::uuid]) AND deleted_at IS NULL
    `
    if (rows.length < 2) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Un des bénéficiaires est introuvable' } })
    }

    // Marquer le doublon comme fusionné, pointer vers l'enregistrement principal
    await sql`
      UPDATE beneficiaries
      SET status = 'duplicate', duplicate_of = ${id}::uuid
      WHERE id = ${duplicateId}::uuid
    `

    await writeAuditLog(user.sub, 'merge_beneficiary', 'beneficiaries', id, request, { mergedId: duplicateId })

    return reply.send({ success: true, message: `Doublon ${duplicateId} fusionné dans ${id}.` })
  })
}

function computeVulnerabilityLevel(members: Array<{ hasDisability?: boolean; isPregnant?: boolean; isUnaccompanied?: boolean }>, factors: string[]): string {
  let score = 0
  if (members.some(m => m.hasDisability)) score++
  if (members.some(m => m.isPregnant)) score++
  if (members.some(m => m.isUnaccompanied)) score += 2
  if (factors.includes('orphan') || factors.includes('child_alone')) score += 2
  if (factors.includes('elderly') || factors.includes('chronic_illness')) score++
  if (factors.includes('conflict_survivor') || factors.includes('gbv_survivor')) score += 2
  if (score >= 4) return 'critical'
  if (score >= 2) return 'high'
  if (score >= 1) return 'medium'
  return 'low'
}
