/**
 * Tests d'intégration — Phase 30 — Routes proxy Anti-Fraude & Déduplication IA.
 * Routes: POST /ai/antifraud/check, GET /ai/antifraud/queue,
 *         GET /ai/antifraud/stats, GET /ai/antifraud/duplicates,
 *         POST /ai/antifraud/duplicates/:id/resolve
 * RBAC: voir préhandlers dans routes/antifraud.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyRateLimit from '@fastify/rate-limit'
import { ZodError } from 'zod'
import { adminToken, agentToken, deciderToken, partnerToken, govToken, authHeader, signToken } from './helpers.js'

// ── Helpers supplémentaires ───────────────────────────────────────────────────

const validatorToken = () => signToken({ role: 'local_validator' })

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_CHECK_BODY = {
  dossier: {
    dossier_id: 'DOS-001',
    nom_complet: 'Jean Kabila Mukeba',
    date_naissance: '1985-03-22',
    taille_menage: 5,
    p_code: 'CD-NK-0001',
    otp_verified: true,
  },
  context: {
    sinistre_id: 'SIN-00000001',
    sinistre_p_code: 'CD-NK',
    distance_to_disaster_km: 12.5,
  },
}

const DUPLICATE_ID = 'dup-0000-0001'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../services/aiClient.js', () => ({
  aiGet:         vi.fn().mockResolvedValue({ status: 200, data: { ok: true } }),
  aiPost:        vi.fn().mockResolvedValue({ status: 200, data: { verdict: 'clean', score: 5, flags: [] } }),
  aiHealthCheck: vi.fn().mockResolvedValue(true),
}))

const { antifraudRoutes } = await import('../routes/antifraud.js')

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
  await app.register(antifraudRoutes)
  await app.ready()
  return app
}

let app: FastifyInstance
beforeAll(async () => { app = await buildApp() })
afterAll(async () => { await app.close() })

// ── POST /ai/antifraud/check ──────────────────────────────────────────────────

describe('POST /ai/antifraud/check', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ai/antifraud/check',
      payload: VALID_CHECK_BODY,
    })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un partenaire humanitaire', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ai/antifraud/check',
      headers: authHeader(partnerToken()),
      payload: VALID_CHECK_BODY,
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 403 pour un décideur national', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ai/antifraud/check',
      headers: authHeader(deciderToken()),
      payload: VALID_CHECK_BODY,
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 200 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ai/antifraud/check',
      headers: authHeader(agentToken()),
      payload: VALID_CHECK_BODY,
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un validateur local', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ai/antifraud/check',
      headers: authHeader(validatorToken()),
      payload: VALID_CHECK_BODY,
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un system_admin', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ai/antifraud/check',
      headers: authHeader(adminToken()),
      payload: VALID_CHECK_BODY,
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 400 si date_naissance est mal formatée', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ai/antifraud/check',
      headers: authHeader(agentToken()),
      payload: {
        ...VALID_CHECK_BODY,
        dossier: { ...VALID_CHECK_BODY.dossier, date_naissance: '22/03/1985' },
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 400 si taille_menage est inférieure à 1', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ai/antifraud/check',
      headers: authHeader(agentToken()),
      payload: {
        ...VALID_CHECK_BODY,
        dossier: { ...VALID_CHECK_BODY.dossier, taille_menage: 0 },
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 400 si nom_complet est trop court (< 2 chars)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ai/antifraud/check',
      headers: authHeader(agentToken()),
      payload: {
        ...VALID_CHECK_BODY,
        dossier: { ...VALID_CHECK_BODY.dossier, nom_complet: 'A' },
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── GET /ai/antifraud/queue ───────────────────────────────────────────────────

describe('GET /ai/antifraud/queue', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/ai/antifraud/queue' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/antifraud/queue',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 200 pour un validateur local', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/antifraud/queue',
      headers: authHeader(validatorToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un décideur national', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/antifraud/queue',
      headers: authHeader(deciderToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un system_admin', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/antifraud/queue',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})

// ── GET /ai/antifraud/stats ───────────────────────────────────────────────────

describe('GET /ai/antifraud/stats', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/ai/antifraud/stats' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/antifraud/stats',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 403 pour un validateur local', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/antifraud/stats',
      headers: authHeader(validatorToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 200 pour un admin territorial', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/antifraud/stats',
      headers: authHeader(govToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un system_admin', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/antifraud/stats',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})

// ── GET /ai/antifraud/duplicates ──────────────────────────────────────────────

describe('GET /ai/antifraud/duplicates', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/ai/antifraud/duplicates' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un décideur national', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/antifraud/duplicates',
      headers: authHeader(deciderToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 200 pour un validateur local', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/antifraud/duplicates',
      headers: authHeader(validatorToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un admin territorial', async () => {
    const res = await app.inject({
      method: 'GET', url: '/ai/antifraud/duplicates',
      headers: authHeader(govToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})

// ── POST /ai/antifraud/duplicates/:id/resolve ─────────────────────────────────

describe('POST /ai/antifraud/duplicates/:id/resolve', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({
      method: 'POST', url: `/ai/antifraud/duplicates/${DUPLICATE_ID}/resolve`,
      payload: { resolution: 'MERGED' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'POST', url: `/ai/antifraud/duplicates/${DUPLICATE_ID}/resolve`,
      headers: authHeader(agentToken()),
      payload: { resolution: 'MERGED' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 400 pour une résolution invalide', async () => {
    const res = await app.inject({
      method: 'POST', url: `/ai/antifraud/duplicates/${DUPLICATE_ID}/resolve`,
      headers: authHeader(adminToken()),
      payload: { resolution: 'INVALID_VALUE' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 200 pour un validateur local avec REJECTED', async () => {
    const res = await app.inject({
      method: 'POST', url: `/ai/antifraud/duplicates/${DUPLICATE_ID}/resolve`,
      headers: authHeader(validatorToken()),
      payload: { resolution: 'REJECTED', note: 'Doublon confirmé manuellement' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un system_admin avec REVIEWED', async () => {
    const res = await app.inject({
      method: 'POST', url: `/ai/antifraud/duplicates/${DUPLICATE_ID}/resolve`,
      headers: authHeader(adminToken()),
      payload: { resolution: 'REVIEWED' },
    })
    expect(res.statusCode).toBe(200)
  })
})
