/**
 * Tests d'intégration — Phase 26 — Crises humanitaires & SitReps OCHA.
 * Routes: GET/POST /crises, GET/PATCH /crises/:id,
 *         POST/GET/PATCH /crises/:id/sitreps/:reportId
 * RBAC lecture: system_admin, national_decision_maker, territory_admin, humanitarian_partner
 * RBAC écriture: system_admin, national_decision_maker, territory_admin
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyRateLimit from '@fastify/rate-limit'
import { ZodError } from 'zod'
import { adminToken, agentToken, deciderToken, partnerToken, govToken, authHeader } from './helpers.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CRISIS_ID = 'cccccccc-0000-0000-0000-000000000001'
const SITREP_ID = 'ssssssss-0000-0000-0000-000000000002'

const FAKE_CRISIS_ROW = {
  id: CRISIS_ID,
  glideNumber: 'FL-2026-000001-COD',
  title: 'Inondation Nord-Kivu',
  hazardType: 'flood',
  status: 'active',
  severity: 'high',
  startDate: '2026-01-15',
  endDate: null,
  affectedCount: 5000,
  displacedCount: 2000,
  deathsCount: 12,
  responseLead: 'OCHA',
  locationName: 'Nord-Kivu',
  openTasks: 3,
  sitrepCount: 1,
  createdAt: new Date().toISOString(),
}

const FAKE_CRISIS_DETAIL = {
  id: CRISIS_ID,
  glideNumber: 'FL-2026-000001-COD',
  title: 'Inondation Nord-Kivu',
  hazardType: 'flood',
  status: 'active',
  severity: 'high',
  startDate: '2026-01-15',
  endDate: null,
  affectedCount: 5000,
  displacedCount: 2000,
  deathsCount: 12,
  responseLead: 'OCHA',
  locationPcode: 'CD-NK',
  locationName: 'Nord-Kivu',
  description: 'Inondations sévères affectant les zones côtières du lac Kivu',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const FAKE_CRISIS_UPDATED = {
  id: CRISIS_ID,
  glideNumber: 'FL-2026-000001-COD',
  status: 'contained',
  title: 'Inondation Nord-Kivu',
}

const FAKE_SITREP_ROW = {
  id: SITREP_ID,
  crisisEventId: CRISIS_ID,
  reportNumber: 1,
  title: 'SitRep #1 — Inondation Nord-Kivu',
  periodFrom: '2026-01-15',
  periodTo: '2026-01-22',
  status: 'draft',
  content: '{}',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const FAKE_SITREP_DETAIL = {
  ...FAKE_SITREP_ROW,
  crisisTitle: 'Inondation Nord-Kivu',
  glideNumber: 'FL-2026-000001-COD',
  preparedByName: 'Admin Test',
}

const FAKE_SITREP_UPDATED = {
  id: SITREP_ID,
  reportNumber: 1,
  status: 'published',
  title: 'SitRep #1 — Inondation Nord-Kivu',
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../websocket/broadcast.js', () => ({ broadcast: vi.fn() }))

vi.mock('../db.js', () => ({
  sql: Object.assign(
    vi.fn().mockImplementation((strings: TemplateStringsArray) => {
      const q = strings.join('?')

      // generateGlideNumber — SELECT COUNT(*) + 1 AS seq
      if (q.includes('COUNT(*) + 1 AS seq')) {
        return Promise.resolve([{ seq: 1 }])
      }

      // Comptage pagination liste crises
      if (q.includes('COUNT(*)::int AS total FROM crisis_events')) {
        return Promise.resolve([{ total: 1 }])
      }

      // Liste des crises (avec GROUP BY et agrégats)
      if (q.includes('c.id, c.glide_number, c.title')) {
        return Promise.resolve([FAKE_CRISIS_ROW])
      }

      // Création d'une crise
      if (q.includes('INSERT INTO crisis_events')) {
        return Promise.resolve([{
          id: CRISIS_ID,
          glide_number: 'FL-2026-000001-COD',
          title: 'Inondation Nord-Kivu',
          hazard_type: 'flood',
          status: 'active',
          severity: 'high',
          start_date: '2026-01-15',
          created_at: new Date().toISOString(),
        }])
      }

      // Mise à jour d'une crise
      if (q.includes('UPDATE crisis_events')) {
        return Promise.resolve([FAKE_CRISIS_UPDATED])
      }

      // Détail d'une crise (SELECT c.*)
      if (q.includes('SELECT c.*')) {
        return Promise.resolve([FAKE_CRISIS_DETAIL])
      }

      // Tâches de coordination dans le détail
      if (q.includes('FROM coordination_tasks t')) {
        return Promise.resolve([])
      }

      // SitReps dans le détail (liste légère)
      if (q.includes('FROM situation_reports WHERE crisis_event_id')) {
        return Promise.resolve([{
          id: SITREP_ID,
          reportNumber: 1,
          title: 'SitRep #1',
          periodFrom: '2026-01-15',
          periodTo: '2026-01-22',
          status: 'draft',
          createdAt: new Date().toISOString(),
        }])
      }

      // Événements récents dans le détail
      if (q.includes('FROM disaster_events WHERE crisis_event_id')) {
        return Promise.resolve([])
      }

      // Prochain numéro de SitRep
      if (q.includes('COALESCE(MAX(report_number)')) {
        return Promise.resolve([{ nextNum: 1 }])
      }

      // Création d'un SitRep
      if (q.includes('INSERT INTO situation_reports')) {
        return Promise.resolve([FAKE_SITREP_ROW])
      }

      // Détail d'un SitRep (avec JOIN crisis_events)
      if (q.includes('s.*, c.title AS crisis_title')) {
        return Promise.resolve([FAKE_SITREP_DETAIL])
      }

      // Mise à jour d'un SitRep
      if (q.includes('UPDATE situation_reports')) {
        return Promise.resolve([FAKE_SITREP_UPDATED])
      }

      return Promise.resolve([])
    }),
    { array: vi.fn().mockImplementation((arr: unknown[]) => arr) },
  ),
  checkDatabaseConnection: vi.fn().mockResolvedValue(undefined),
}))

const { crisisRoutes } = await import('../routes/crises.js')

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
  await app.register(crisisRoutes)
  await app.ready()
  return app
}

let app: FastifyInstance
beforeAll(async () => { app = await buildApp() })
afterAll(async () => { await app.close() })

// ── GET /crises ───────────────────────────────────────────────────────────────

describe('GET /crises', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/crises' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain (rôle non autorisé)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/crises',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 200 pour system_admin avec liste paginée et champs GLIDE', async () => {
    const res = await app.inject({
      method: 'GET', url: '/crises',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.meta).toMatchObject({ total: 1, page: 1, limit: 20 })
    expect(body.data[0]).toHaveProperty('glideNumber')
    expect(body.data[0]).toHaveProperty('hazardType')
    expect(body.data[0]).toHaveProperty('openTasks')
    expect(body.data[0]).toHaveProperty('sitrepCount')
  })

  it('renvoie 200 pour humanitarian_partner', async () => {
    const res = await app.inject({
      method: 'GET', url: '/crises',
      headers: authHeader(partnerToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('renvoie 200 pour territory_admin', async () => {
    const res = await app.inject({
      method: 'GET', url: '/crises',
      headers: authHeader(govToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepte les filtres status, page et limit', async () => {
    const res = await app.inject({
      method: 'GET', url: '/crises?status=active&page=1&limit=10',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().meta).toMatchObject({ page: 1, limit: 10 })
  })
})

// ── POST /crises ──────────────────────────────────────────────────────────────

describe('POST /crises', () => {
  const payload = {
    title: 'Inondation Nord-Kivu',
    hazardType: 'flood',
    severity: 'high',
    locationPcode: 'CD-NK',
    affectedCount: 5000,
    displacedCount: 2000,
    deathsCount: 12,
    responseLead: 'OCHA',
  }

  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'POST', url: '/crises', payload })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'POST', url: '/crises',
      headers: authHeader(agentToken()), payload,
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 403 pour humanitarian_partner (pas le droit de créer)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/crises',
      headers: authHeader(partnerToken()), payload,
    })
    expect(res.statusCode).toBe(403)
  })

  it('crée une crise avec GLIDE number et renvoie 201 pour system_admin', async () => {
    const res = await app.inject({
      method: 'POST', url: '/crises',
      headers: authHeader(adminToken()), payload,
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('id')
    expect(body.data).toHaveProperty('glide_number')
    expect(body.data.glide_number).toMatch(/^FL-\d{4}-\d{6}-COD$/)
    expect(body.data).toHaveProperty('status', 'active')
  })

  it('crée une crise pour national_decision_maker', async () => {
    const res = await app.inject({
      method: 'POST', url: '/crises',
      headers: authHeader(deciderToken()), payload,
    })
    expect(res.statusCode).toBe(201)
  })

  it('crée une crise pour territory_admin', async () => {
    const res = await app.inject({
      method: 'POST', url: '/crises',
      headers: authHeader(govToken()), payload,
    })
    expect(res.statusCode).toBe(201)
  })

  it('renvoie 400 si le titre est trop court (< 3 caractères)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/crises',
      headers: authHeader(adminToken()),
      payload: { ...payload, title: 'AB' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 400 si le titre est absent', async () => {
    const res = await app.inject({
      method: 'POST', url: '/crises',
      headers: authHeader(adminToken()),
      payload: { hazardType: 'flood' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── GET /crises/:id ───────────────────────────────────────────────────────────

describe('GET /crises/:id', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: `/crises/${CRISIS_ID}` })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 200 avec détail complet (tasks, sitreps, recentEvents)', async () => {
    const res = await app.inject({
      method: 'GET', url: `/crises/${CRISIS_ID}`,
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('id', CRISIS_ID)
    expect(body.data).toHaveProperty('glideNumber')
    expect(body.data).toHaveProperty('locationName')
    expect(Array.isArray(body.data.tasks)).toBe(true)
    expect(Array.isArray(body.data.sitreps)).toBe(true)
    expect(Array.isArray(body.data.recentEvents)).toBe(true)
  })

  it('renvoie 404 si la crise est introuvable', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() => Promise.resolve([]))

    const res = await app.inject({
      method: 'GET', url: `/crises/${CRISIS_ID}`,
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })
})

// ── PATCH /crises/:id ─────────────────────────────────────────────────────────

describe('PATCH /crises/:id', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/crises/${CRISIS_ID}` })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour humanitarian_partner', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/crises/${CRISIS_ID}`,
      headers: authHeader(partnerToken()),
      payload: { status: 'contained' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('met à jour le statut à "contained" et renvoie 200 pour system_admin', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/crises/${CRISIS_ID}`,
      headers: authHeader(adminToken()),
      payload: { status: 'contained' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('id', CRISIS_ID)
    expect(body.data).toHaveProperty('status', 'contained')
  })

  it('met à jour pour national_decision_maker', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/crises/${CRISIS_ID}`,
      headers: authHeader(deciderToken()),
      payload: { status: 'closed', affectedCount: 5500 },
    })
    expect(res.statusCode).toBe(200)
  })

  it('met à jour pour territory_admin', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/crises/${CRISIS_ID}`,
      headers: authHeader(govToken()),
      payload: { responseLead: 'OCHA RDC' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 400 si le statut est invalide', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/crises/${CRISIS_ID}`,
      headers: authHeader(adminToken()),
      payload: { status: 'cancelled' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 404 si la crise est introuvable', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() => Promise.resolve([]))

    const res = await app.inject({
      method: 'PATCH', url: `/crises/${CRISIS_ID}`,
      headers: authHeader(adminToken()),
      payload: { status: 'closed' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })
})

// ── POST /crises/:id/sitreps ──────────────────────────────────────────────────

describe('POST /crises/:id/sitreps', () => {
  const sitrepPayload = {
    title: 'SitRep #1 — Inondation Nord-Kivu',
    periodFrom: '2026-01-15',
    periodTo: '2026-01-22',
    content: {
      overview: 'Les inondations affectent 5 000 personnes.',
      needs: 'Abris d\'urgence, eau potable, médicaments.',
      figures: { affected: 5000, displaced: 2000, deaths: 12 },
    },
  }

  it('renvoie 401 sans token', async () => {
    const res = await app.inject({
      method: 'POST', url: `/crises/${CRISIS_ID}/sitreps`, payload: sitrepPayload,
    })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'POST', url: `/crises/${CRISIS_ID}/sitreps`,
      headers: authHeader(agentToken()), payload: sitrepPayload,
    })
    expect(res.statusCode).toBe(403)
  })

  it('crée un SitRep numéroté automatiquement et renvoie 201 pour system_admin', async () => {
    const res = await app.inject({
      method: 'POST', url: `/crises/${CRISIS_ID}/sitreps`,
      headers: authHeader(adminToken()), payload: sitrepPayload,
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('id')
    expect(body.data).toHaveProperty('reportNumber', 1)
    expect(body.data).toHaveProperty('status', 'draft')
    expect(body.data).toHaveProperty('crisisEventId', CRISIS_ID)
  })

  it('crée un SitRep pour humanitarian_partner', async () => {
    const res = await app.inject({
      method: 'POST', url: `/crises/${CRISIS_ID}/sitreps`,
      headers: authHeader(partnerToken()), payload: sitrepPayload,
    })
    expect(res.statusCode).toBe(201)
  })

  it('renvoie 400 si le titre est trop court (< 3 caractères)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/crises/${CRISIS_ID}/sitreps`,
      headers: authHeader(adminToken()),
      payload: { ...sitrepPayload, title: 'AB' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 400 si periodFrom est absent ou mal formaté', async () => {
    const res = await app.inject({
      method: 'POST', url: `/crises/${CRISIS_ID}/sitreps`,
      headers: authHeader(adminToken()),
      payload: { ...sitrepPayload, periodFrom: '15/01/2026' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── GET /crises/:id/sitreps/:reportId ─────────────────────────────────────────

describe('GET /crises/:id/sitreps/:reportId', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({
      method: 'GET', url: `/crises/${CRISIS_ID}/sitreps/${SITREP_ID}`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 200 avec le détail complet du SitRep', async () => {
    const res = await app.inject({
      method: 'GET', url: `/crises/${CRISIS_ID}/sitreps/${SITREP_ID}`,
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('id', SITREP_ID)
    expect(body.data).toHaveProperty('reportNumber', 1)
    expect(body.data).toHaveProperty('crisisTitle')
    expect(body.data).toHaveProperty('glideNumber')
    expect(body.data).toHaveProperty('preparedByName')
  })

  it('renvoie 200 pour humanitarian_partner', async () => {
    const res = await app.inject({
      method: 'GET', url: `/crises/${CRISIS_ID}/sitreps/${SITREP_ID}`,
      headers: authHeader(partnerToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 404 si le SitRep est introuvable', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() => Promise.resolve([]))

    const res = await app.inject({
      method: 'GET', url: `/crises/${CRISIS_ID}/sitreps/${SITREP_ID}`,
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })
})

// ── PATCH /crises/:id/sitreps/:reportId ───────────────────────────────────────

describe('PATCH /crises/:id/sitreps/:reportId', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/crises/${CRISIS_ID}/sitreps/${SITREP_ID}`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour humanitarian_partner', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/crises/${CRISIS_ID}/sitreps/${SITREP_ID}`,
      headers: authHeader(partnerToken()),
      payload: { status: 'published' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('publie le SitRep (status → published) et renvoie 200 pour system_admin', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/crises/${CRISIS_ID}/sitreps/${SITREP_ID}`,
      headers: authHeader(adminToken()),
      payload: { status: 'published' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('id', SITREP_ID)
    expect(body.data).toHaveProperty('status', 'published')
  })

  it('met à jour pour national_decision_maker', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/crises/${CRISIS_ID}/sitreps/${SITREP_ID}`,
      headers: authHeader(deciderToken()),
      payload: { status: 'final' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 400 si le statut du SitRep est invalide', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/crises/${CRISIS_ID}/sitreps/${SITREP_ID}`,
      headers: authHeader(adminToken()),
      payload: { status: 'archived' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 404 si le SitRep est introuvable', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() => Promise.resolve([]))

    const res = await app.inject({
      method: 'PATCH', url: `/crises/${CRISIS_ID}/sitreps/${SITREP_ID}`,
      headers: authHeader(adminToken()),
      payload: { status: 'published' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })
})
