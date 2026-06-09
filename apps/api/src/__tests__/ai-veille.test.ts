/**
 * Tests d'intégration — Phase 30 — Routes proxy Veille & Ingestion IA.
 * Routes: GET /ai/veille/events, GET /ai/veille/health,
 *         POST /ai/veille/trigger/:sourceId
 * RBAC lecture: territory_admin, national_decision_maker, system_admin
 * RBAC trigger: system_admin uniquement
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyRateLimit from '@fastify/rate-limit'
import { ZodError } from 'zod'
import { adminToken, agentToken, deciderToken, partnerToken, govToken, authHeader } from './helpers.js'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../services/aiClient.js', () => ({
  aiGet:         vi.fn().mockResolvedValue({ status: 200, data: { ok: true } }),
  aiPost:        vi.fn().mockResolvedValue({ status: 200, data: { ok: true } }),
  aiHealthCheck: vi.fn().mockResolvedValue(true),
}))

const { veilleRoutes } = await import('../routes/veille.js')

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
  await app.register(veilleRoutes)
  await app.ready()
  return app
}

let app: FastifyInstance
beforeAll(async () => { app = await buildApp() })
afterAll(async () => { await app.close() })

// ── GET /ai/veille/events ────────────────────────────────────────────────────

describe('GET /ai/veille/events', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/ai/veille/events' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/veille/events',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 403 pour un partenaire humanitaire', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/veille/events',
      headers: authHeader(partnerToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 200 pour un admin territorial', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/veille/events',
      headers: authHeader(govToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un décideur national', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/veille/events',
      headers: authHeader(deciderToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un system_admin', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/veille/events',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepte les paramètres de filtre sans erreur', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/veille/events?type=flood&province=CD-NK',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})

// ── GET /ai/veille/health ────────────────────────────────────────────────────

describe('GET /ai/veille/health', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/ai/veille/health' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/veille/health',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 200 pour un admin territorial', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/veille/health',
      headers: authHeader(govToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un system_admin', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/veille/health',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})

// ── POST /ai/veille/trigger/:sourceId ────────────────────────────────────────

describe('POST /ai/veille/trigger/:sourceId', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'POST', url: '/ai/veille/trigger/reliefweb' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un admin territorial', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ai/veille/trigger/reliefweb',
      headers: authHeader(govToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 403 pour un décideur national', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ai/veille/trigger/reliefweb',
      headers: authHeader(deciderToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 200 pour un system_admin', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ai/veille/trigger/gdacs',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})
