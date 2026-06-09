/**
 * Tests d'intégration — Phase 24 — Demandes d'affectation ressources ↔ sinistres.
 * Routes: POST/GET /resources/demands, PATCH approve/reject/fulfill, GET par crise.
 * RBAC création: RESOURCE_ROLES (system_admin, national_decision_maker, provincial_coordinator, humanitarian_partner)
 * RBAC approbation: system_admin, national_decision_maker seulement
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyRateLimit from '@fastify/rate-limit'
import { ZodError } from 'zod'
import { adminToken, agentToken, deciderToken, partnerToken, authHeader } from './helpers.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CRISIS_ID  = 'cccccccc-0000-0000-0000-000000000001'
const DEMAND_ID  = 'dddddddd-0000-0000-0000-000000000002'
const DEPOT_ID   = 'eeeeeeee-0000-0000-0000-000000000003'
const STOCK_ID   = 'ffffffff-0000-0000-0000-000000000004'

const FAKE_CRISIS = { id: CRISIS_ID }

const FAKE_DEMAND_ROW = {
  id: DEMAND_ID,
  crisisId: CRISIS_ID,
  resourceType: 'food',
  resourceName: 'Rations alimentaires',
  unit: 'kg',
  quantityNeeded: '500',
  urgency: 'high',
  status: 'pending',
  notes: null,
  createdAt: new Date().toISOString(),
}

const FAKE_DEMAND_LIST = {
  ...FAKE_DEMAND_ROW,
  crisisGlide: 'FL-2026-000001-COD',
  crisisTitle: 'Inondation Nord-Kivu',
  depotName: null,
  requestedByName: 'Admin Test',
  reviewedByName: null,
  reviewedAt: null,
  updatedAt: new Date().toISOString(),
}

const FAKE_APPROVED_ROW = {
  id: DEMAND_ID,
  status: 'approved',
  quantityAllocated: '500',
  reviewedAt: new Date().toISOString(),
}

const FAKE_REJECTED_ROW = {
  id: DEMAND_ID,
  status: 'rejected',
  reviewedAt: new Date().toISOString(),
}

const FAKE_FULFILLED_ROW = {
  id: DEMAND_ID,
  status: 'fulfilled',
  updatedAt: new Date().toISOString(),
}

const FAKE_STOCK = { id: STOCK_ID, quantityAvailable: 1000 }

// ── Mock DB ───────────────────────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  sql: Object.assign(
    vi.fn().mockImplementation((strings: TemplateStringsArray) => {
      const q = strings.join('?')

      // Vérification crise avant création
      if (q.includes('SELECT id FROM crisis_events')) {
        return Promise.resolve([FAKE_CRISIS])
      }

      // Création d'une demande
      if (q.includes('INSERT INTO resource_demands')) {
        return Promise.resolve([FAKE_DEMAND_ROW])
      }

      // Liste des demandes (avec JOIN crises, dépôts, users)
      if (q.includes('FROM resource_demands d') && q.includes('JOIN crisis_events c')) {
        return Promise.resolve([FAKE_DEMAND_LIST])
      }

      // Comptage total pour pagination
      if (q.includes('COUNT(*)::int AS total FROM resource_demands')) {
        return Promise.resolve([{ total: 1 }])
      }

      // Demandes par crise (sans JOIN crisis_events — la crise est dans le WHERE)
      if (q.includes('FROM resource_demands d') && q.includes('WHERE d.crisis_id =')) {
        return Promise.resolve([FAKE_DEMAND_LIST])
      }

      // Lecture d'une demande avant approve/reject/fulfill
      if (q.includes('SELECT id, status, quantity_needed FROM resource_demands')) {
        return Promise.resolve([{ id: DEMAND_ID, status: 'pending', quantityNeeded: '500' }])
      }
      if (q.includes('SELECT id, status FROM resource_demands')) {
        return Promise.resolve([{ id: DEMAND_ID, status: 'pending' }])
      }
      if (q.includes('SELECT id, status, stock_id, quantity_allocated FROM resource_demands')) {
        return Promise.resolve([{ id: DEMAND_ID, status: 'approved', stockId: null, quantityAllocated: '500' }])
      }

      // Vérification stock avant approbation
      if (q.includes('SELECT id, quantity_available FROM resource_stocks')) {
        return Promise.resolve([FAKE_STOCK])
      }

      // Mise à jour quantity_reserved (approve/fulfill)
      if (q.includes('UPDATE resource_stocks')) {
        return Promise.resolve([])
      }

      // Approbation de la demande
      if (q.includes("'approved'::demand_status")) {
        return Promise.resolve([FAKE_APPROVED_ROW])
      }

      // Rejet de la demande
      if (q.includes("'rejected'::demand_status")) {
        return Promise.resolve([FAKE_REJECTED_ROW])
      }

      // Réalisation de la demande
      if (q.includes("'fulfilled'::demand_status")) {
        return Promise.resolve([FAKE_FULFILLED_ROW])
      }

      return Promise.resolve([])
    }),
    { array: vi.fn().mockImplementation((arr: unknown[]) => arr) },
  ),
  checkDatabaseConnection: vi.fn().mockResolvedValue(undefined),
}))

const { demandsRoutes } = await import('../routes/demands.js')

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fastifyJwt, { secret: 'test_secret_min_32_characters_long_ok' })
  await app.register(fastifyRateLimit, { max: 1000, timeWindow: '1 minute' })
  app.decorate('config', { NODE_ENV: 'test' } as any)
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } })
    }
    const status = (error as any).statusCode ?? 500
    return reply.status(status).send({ success: false, error: { code: 'ERROR', message: error.message } })
  })
  await app.register(demandsRoutes)
  await app.ready()
  return app
}

let app: FastifyInstance

beforeAll(async () => { app = await buildApp() })
afterAll(async () => { await app.close() })

// ── POST /resources/demands ───────────────────────────────────────────────────

describe('POST /resources/demands', () => {
  const payload = {
    crisisId: CRISIS_ID,
    resourceType: 'food',
    resourceName: 'Rations alimentaires',
    unit: 'kg',
    quantityNeeded: 500,
    urgency: 'high',
  }

  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'POST', url: '/resources/demands', payload })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'POST', url: '/resources/demands',
      headers: authHeader(agentToken()), payload,
    })
    expect(res.statusCode).toBe(403)
  })

  it('crée une demande et renvoie 201 pour system_admin', async () => {
    const res = await app.inject({
      method: 'POST', url: '/resources/demands',
      headers: authHeader(adminToken()), payload,
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data).toMatchObject({ resourceName: 'Rations alimentaires', status: 'pending', urgency: 'high' })
  })

  it('crée une demande pour humanitarian_partner', async () => {
    const res = await app.inject({
      method: 'POST', url: '/resources/demands',
      headers: authHeader(partnerToken()), payload,
    })
    expect(res.statusCode).toBe(201)
  })

  it('renvoie 404 si la crise est introuvable', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() => Promise.resolve([]))

    const res = await app.inject({
      method: 'POST', url: '/resources/demands',
      headers: authHeader(adminToken()), payload,
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })

  it('renvoie 400 si quantityNeeded est négatif ou nul', async () => {
    const res = await app.inject({
      method: 'POST', url: '/resources/demands',
      headers: authHeader(adminToken()),
      payload: { ...payload, quantityNeeded: 0 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 400 si resourceType est invalide', async () => {
    const res = await app.inject({
      method: 'POST', url: '/resources/demands',
      headers: authHeader(adminToken()),
      payload: { ...payload, resourceType: 'explosives' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── GET /resources/demands ────────────────────────────────────────────────────

describe('GET /resources/demands', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/resources/demands' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 200 pour system_admin avec la liste paginée', async () => {
    const res = await app.inject({
      method: 'GET', url: '/resources/demands',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.pagination).toMatchObject({ page: 1, limit: 50, total: 1 })
    expect(body.data[0]).toHaveProperty('crisisGlide')
    expect(body.data[0]).toHaveProperty('urgency')
    expect(body.data[0]).toHaveProperty('status')
  })

  it('renvoie 200 pour humanitarian_partner', async () => {
    const res = await app.inject({
      method: 'GET', url: '/resources/demands',
      headers: authHeader(partnerToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepte les filtres status, urgency et crisisId', async () => {
    const res = await app.inject({
      method: 'GET', url: `/resources/demands?status=pending&urgency=high&crisisId=${CRISIS_ID}`,
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})

// ── GET /resources/crises/:crisisId/demands ───────────────────────────────────

describe('GET /resources/crises/:crisisId/demands', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: `/resources/crises/${CRISIS_ID}/demands` })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 200 avec les demandes de la crise', async () => {
    const res = await app.inject({
      method: 'GET', url: `/resources/crises/${CRISIS_ID}/demands`,
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data[0]).toHaveProperty('resourceName')
    expect(body.data[0]).toHaveProperty('urgency')
  })
})

// ── PATCH /resources/demands/:id/approve ─────────────────────────────────────

describe('PATCH /resources/demands/:id/approve', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/approve` })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour humanitarian_partner', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/approve`,
      headers: authHeader(partnerToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('approuve une demande et renvoie 200 pour system_admin', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/approve`,
      headers: authHeader(adminToken()),
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('approved')
    expect(body.data).toHaveProperty('quantityAllocated')
    expect(body.data).toHaveProperty('reviewedAt')
  })

  it('approuve avec national_decision_maker', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/approve`,
      headers: authHeader(deciderToken()),
      payload: {},
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 404 si la demande est introuvable', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() => Promise.resolve([]))

    const res = await app.inject({
      method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/approve`,
      headers: authHeader(adminToken()),
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })

  it('renvoie 409 INVALID_STATUS si la demande n\'est pas en attente', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() =>
      Promise.resolve([{ id: DEMAND_ID, status: 'approved', quantityNeeded: '500' }])
    )

    const res = await app.inject({
      method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/approve`,
      headers: authHeader(adminToken()),
      payload: {},
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('INVALID_STATUS')
  })

  it('renvoie 409 INSUFFICIENT_STOCK si le stock lié est insuffisant', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any)
      .mockImplementationOnce(() => Promise.resolve([{ id: DEMAND_ID, status: 'pending', quantityNeeded: '500' }]))
      .mockImplementationOnce(() => Promise.resolve([{ id: STOCK_ID, quantityAvailable: 10 }]))

    const res = await app.inject({
      method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/approve`,
      headers: authHeader(adminToken()),
      payload: { stockId: STOCK_ID, quantityAllocated: 500 },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('INSUFFICIENT_STOCK')
  })
})

// ── PATCH /resources/demands/:id/reject ──────────────────────────────────────

describe('PATCH /resources/demands/:id/reject', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/reject` })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour humanitarian_partner', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/reject`,
      headers: authHeader(partnerToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejette une demande et renvoie 200 pour system_admin', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/reject`,
      headers: authHeader(adminToken()),
      payload: { notes: 'Stock insuffisant dans la région' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('rejected')
  })

  it('renvoie 404 si la demande est introuvable', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() => Promise.resolve([]))

    const res = await app.inject({
      method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/reject`,
      headers: authHeader(adminToken()),
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })

  it('renvoie 409 si la demande n\'est pas en attente', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() =>
      Promise.resolve([{ id: DEMAND_ID, status: 'rejected' }])
    )

    const res = await app.inject({
      method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/reject`,
      headers: authHeader(adminToken()),
      payload: {},
    })
    expect(res.statusCode).toBe(409)
  })
})

// ── PATCH /resources/demands/:id/fulfill ─────────────────────────────────────

describe('PATCH /resources/demands/:id/fulfill', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/fulfill` })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/fulfill`,
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('marque comme réalisée et renvoie 200 pour system_admin', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/fulfill`,
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('fulfilled')
  })

  it('renvoie 409 si la demande n\'est pas approuvée', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() =>
      Promise.resolve([{ id: DEMAND_ID, status: 'pending', stockId: null, quantityAllocated: null }])
    )

    const res = await app.inject({
      method: 'PATCH', url: `/resources/demands/${DEMAND_ID}/fulfill`,
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('INVALID_STATUS')
  })
})
