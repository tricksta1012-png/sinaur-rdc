/**
 * Tests d'intégration pour requireAuth + requireRole.
 * Utilise Fastify inject (pas de réseau), DB mockée.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { requireAuth, requireRole } from '../auth/jwt.js'
import { adminToken, agentToken, govToken, authHeader } from './helpers.js'

// Routes de test minimales — pas de DB impliquée
async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fastifyJwt, { secret: 'test_secret_min_32_characters_long_ok' })

  // Décorer request.jwtUser via requireAuth
  app.get('/protected', { preHandler: [requireAuth] }, async (req) => ({
    ok: true,
    role: (req as any).jwtUser?.role,
  }))

  app.get('/admin-only', { preHandler: [requireAuth, requireRole('system_admin')] }, async () => ({
    ok: true,
  }))

  app.get('/multi-role', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker')],
  }, async () => ({ ok: true }))

  await app.ready()
  return app
}

let app: FastifyInstance

beforeAll(async () => {
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
})

describe('requireAuth', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' })
    expect(res.statusCode).toBe(401)
    expect(res.json().success).toBe(false)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
  })

  it('renvoie 401 avec token malformé', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer not-a-valid-jwt' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 401 avec token signé par un mauvais secret', async () => {
    const jwt = (await import('jsonwebtoken')).default
    const badToken = jwt.sign({ sub: 'x', role: 'field_agent', scope: [] }, 'wrong-secret')
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: authHeader(badToken),
    })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 200 avec un token valide', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
    expect(res.json().role).toBe('field_agent')
  })
})

describe('requireRole', () => {
  it('renvoie 403 si le rôle est insuffisant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('FORBIDDEN')
  })

  it('renvoie 200 si le rôle correspond exactement', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepte plusieurs rôles autorisés', async () => {
    const res1 = await app.inject({
      method: 'GET',
      url: '/multi-role',
      headers: authHeader(adminToken()),
    })
    const res2 = await app.inject({
      method: 'GET',
      url: '/multi-role',
      headers: authHeader(govToken()), // territory_admin — pas dans la liste
    })
    expect(res1.statusCode).toBe(200)
    expect(res2.statusCode).toBe(403)
  })

  it('renvoie 401 sans token même sur une route avec requireRole', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin-only' })
    expect(res.statusCode).toBe(401)
  })
})
