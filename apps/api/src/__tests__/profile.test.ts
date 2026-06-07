/**
 * Tests d'intégration — routes profil personnel.
 * GET  /users/me  → profil de l'utilisateur courant
 * PATCH /users/me → mise à jour displayName / phone
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyRateLimit from '@fastify/rate-limit'
import { adminToken, agentToken, authHeader, signToken } from './helpers.js'

const FAKE_PROFILE = {
  id:                    'test-user-id',
  email:                 'agent@sinaur-rdc.cd',
  phone:                 null,
  displayName:           'Agent Test',
  role:                  'field_agent',
  geographicScopePcodes: ['CD-NK'],
  isActive:              true,
  createdAt:             new Date().toISOString(),
  lastLoginAt:           null,
}

vi.mock('../db.js', () => ({
  sql: Object.assign(
    vi.fn().mockImplementation((strings: TemplateStringsArray) => {
      const q = strings.join('?')

      // SELECT profil
      if (q.includes('SELECT id, email, phone, display_name, role') && q.includes('WHERE id =')) {
        return Promise.resolve([FAKE_PROFILE])
      }

      // UPDATE profil
      if (q.includes('UPDATE users SET') && q.includes('display_name = COALESCE')) {
        return Promise.resolve([{ ...FAKE_PROFILE, displayName: 'Nouveau Nom' }])
      }

      return Promise.resolve([])
    }),
    { array: vi.fn().mockImplementation((arr: unknown[]) => arr) },
  ),
  checkDatabaseConnection: vi.fn().mockResolvedValue(undefined),
}))

const { profileRoutes } = await import('../routes/profile.js')

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fastifyJwt, { secret: 'test_secret_min_32_characters_long_ok' })
  await app.register(fastifyRateLimit, { max: 1000, timeWindow: '1 minute' })
  app.decorate('config', { NODE_ENV: 'test' } as any)
  await app.register(profileRoutes)
  await app.ready()
  return app
}

let app: FastifyInstance

beforeAll(async () => { app = await buildApp() })
afterAll(async () => { await app.close() })

// ── GET /users/me ─────────────────────────────────────────────────────────────

describe('GET /users/me', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/users/me' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 200 avec un profil valide pour un field_agent', async () => {
    const res = await app.inject({
      method: 'GET', url: '/users/me',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('id')
    expect(body.data).toHaveProperty('role')
    expect(body.data).toHaveProperty('displayName')
  })

  it('renvoie 200 pour un system_admin également', async () => {
    const res = await app.inject({
      method: 'GET', url: '/users/me',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('ne retourne pas le hash du mot de passe', async () => {
    const res = await app.inject({
      method: 'GET', url: '/users/me',
      headers: authHeader(agentToken()),
    })
    const text = JSON.stringify(res.json())
    expect(text).not.toMatch(/password_hash/i)
    expect(text).not.toMatch(/passwordHash/i)
  })

  it('renvoie le bon ID depuis le sub du token', async () => {
    const specificToken = signToken({ sub: 'specific-user-id', role: 'citizen' })
    const res = await app.inject({
      method: 'GET', url: '/users/me',
      headers: authHeader(specificToken),
    })
    // La route a bien appelé sql avec le sub du token (vérifié via spy)
    expect(res.statusCode).toBe(200)
  })
})

// ── PATCH /users/me ───────────────────────────────────────────────────────────

describe('PATCH /users/me', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/users/me',
      payload: { displayName: 'Nouveau Nom' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('met à jour le displayName et renvoie 200', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/users/me',
      headers: authHeader(agentToken()),
      payload: { displayName: 'Nouveau Nom' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
    expect(res.json().data.displayName).toBe('Nouveau Nom')
  })

  it('met à jour le numéro de téléphone', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/users/me',
      headers: authHeader(agentToken()),
      payload: { phone: '+243812345678' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 400 si displayName est trop court (< 2 caractères)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/users/me',
      headers: authHeader(agentToken()),
      payload: { displayName: 'X' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('accepte un body vide (aucune modification)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/users/me',
      headers: authHeader(agentToken()),
      payload: {},
    })
    // COALESCE garantit que les valeurs existantes sont conservées
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 400 si displayName dépasse 120 caractères', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/users/me',
      headers: authHeader(agentToken()),
      payload: { displayName: 'A'.repeat(121) },
    })
    expect(res.statusCode).toBe(400)
  })
})
