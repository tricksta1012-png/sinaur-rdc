/**
 * Tests d'intégration — Phase 30 — Routes proxy Prédictions IA.
 * Routes: GET /predictions/risks, GET /predictions/risk-map/:horizon,
 *         GET /predictions/alerts/pending, POST /predictions/alerts/:id/validate,
 *         POST /predictions/alerts/:id/reject,
 *         GET /predictions/history/:pcode, GET /predictions/models,
 *         POST /predictions/refresh
 * RBAC: voir préhandlers dans routes/predictions.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyRateLimit from '@fastify/rate-limit'
import { ZodError } from 'zod'
import { adminToken, agentToken, deciderToken, govToken, authHeader } from './helpers.js'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../services/aiClient.js', () => ({
  aiGet:         vi.fn().mockResolvedValue({ status: 200, data: { ok: true } }),
  aiPost:        vi.fn().mockResolvedValue({ status: 200, data: { ok: true } }),
  aiHealthCheck: vi.fn().mockResolvedValue(true),
}))

const { predictionRoutes } = await import('../routes/predictions.js')

// ── App ───────────────────────────────────────────────────────────────────────

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
  await app.register(predictionRoutes)
  await app.ready()
  return app
}

let app: FastifyInstance
beforeAll(async () => { app = await buildApp() })
afterAll(async () => { await app.close() })

// ── GET /predictions/risks ────────────────────────────────────────────────────

describe('GET /predictions/risks', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/predictions/risks' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 200 pour un agent terrain (accès libre auth)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/predictions/risks',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un admin avec paramètres', async () => {
    const res = await app.inject({
      method: 'GET', url: '/predictions/risks?horizon=30&province=CD-NK',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 400 pour un horizon invalide (> 90)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/predictions/risks?horizon=200',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── GET /predictions/risk-map/:horizon ───────────────────────────────────────

describe('GET /predictions/risk-map/:horizon', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/predictions/risk-map/7' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 200 pour un décideur avec horizon 30', async () => {
    const res = await app.inject({
      method: 'GET', url: '/predictions/risk-map/30',
      headers: authHeader(deciderToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 400 pour un horizon non autorisé (15)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/predictions/risk-map/15',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── GET /predictions/alerts/pending ──────────────────────────────────────────

describe('GET /predictions/alerts/pending', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/predictions/alerts/pending' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'GET', url: '/predictions/alerts/pending',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 200 pour un admin territorial', async () => {
    const res = await app.inject({
      method: 'GET', url: '/predictions/alerts/pending',
      headers: authHeader(govToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un décideur national', async () => {
    const res = await app.inject({
      method: 'GET', url: '/predictions/alerts/pending',
      headers: authHeader(deciderToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})

// ── POST /predictions/alerts/:id/validate ────────────────────────────────────

describe('POST /predictions/alerts/:id/validate', () => {
  const ALERT_ID = 'alert-00000000-0001'

  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'POST', url: `/predictions/alerts/${ALERT_ID}/validate` })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un admin territorial', async () => {
    const res = await app.inject({
      method: 'POST', url: `/predictions/alerts/${ALERT_ID}/validate`,
      headers: authHeader(govToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 200 pour un décideur national', async () => {
    const res = await app.inject({
      method: 'POST', url: `/predictions/alerts/${ALERT_ID}/validate`,
      headers: authHeader(deciderToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un system_admin', async () => {
    const res = await app.inject({
      method: 'POST', url: `/predictions/alerts/${ALERT_ID}/validate`,
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})

// ── POST /predictions/alerts/:id/reject ──────────────────────────────────────

describe('POST /predictions/alerts/:id/reject', () => {
  const ALERT_ID = 'alert-00000000-0002'

  it('renvoie 401 sans token', async () => {
    const res = await app.inject({
      method: 'POST', url: `/predictions/alerts/${ALERT_ID}/reject`,
      payload: { reason: 'Données insuffisantes' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'POST', url: `/predictions/alerts/${ALERT_ID}/reject`,
      headers: authHeader(agentToken()),
      payload: { reason: 'Données insuffisantes' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 400 si le motif est trop court (< 5 chars)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/predictions/alerts/${ALERT_ID}/reject`,
      headers: authHeader(adminToken()),
      payload: { reason: 'NON' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 200 pour un décideur national avec motif valide', async () => {
    const res = await app.inject({
      method: 'POST', url: `/predictions/alerts/${ALERT_ID}/reject`,
      headers: authHeader(deciderToken()),
      payload: { reason: 'Données de source insuffisantes pour validation' },
    })
    expect(res.statusCode).toBe(200)
  })
})

// ── GET /predictions/history/:pcode ──────────────────────────────────────────

describe('GET /predictions/history/:pcode', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/predictions/history/CD-NK' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 200 pour tout utilisateur authentifié', async () => {
    const res = await app.inject({
      method: 'GET', url: '/predictions/history/CD-NK',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})

// ── GET /predictions/models ───────────────────────────────────────────────────

describe('GET /predictions/models', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/predictions/models' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'GET', url: '/predictions/models',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 200 pour un system_admin', async () => {
    const res = await app.inject({
      method: 'GET', url: '/predictions/models',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un décideur national', async () => {
    const res = await app.inject({
      method: 'GET', url: '/predictions/models',
      headers: authHeader(deciderToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})

// ── POST /predictions/refresh ─────────────────────────────────────────────────

describe('POST /predictions/refresh', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'POST', url: '/predictions/refresh' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un décideur national', async () => {
    const res = await app.inject({
      method: 'POST', url: '/predictions/refresh',
      headers: authHeader(deciderToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 403 pour un admin territorial', async () => {
    const res = await app.inject({
      method: 'POST', url: '/predictions/refresh',
      headers: authHeader(govToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 200 pour un system_admin', async () => {
    const res = await app.inject({
      method: 'POST', url: '/predictions/refresh',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})
