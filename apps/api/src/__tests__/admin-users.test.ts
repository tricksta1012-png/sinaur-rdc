/**
 * Tests d'intégration — routes /admin/users et /admin/audit-log.
 * Accès RBAC : system_admin uniquement (sauf audit-log : + national_decision_maker).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyRateLimit from '@fastify/rate-limit'
import { adminToken, agentToken, deciderToken, authHeader } from './helpers.js'

const FAKE_USER = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  email: 'agent@sinaur-rdc.cd',
  fullName: 'Agent Test',
  phone: null,
  role: 'field_agent',
  geographicScopePcodes: ['CD-NK'],
  isActive: true,
  createdAt: new Date().toISOString(),
  lastLoginAt: null,
}

vi.mock('../db.js', () => ({
  sql: Object.assign(
    vi.fn().mockImplementation((strings: TemplateStringsArray) => {
      const q = strings.join('?')

      // Lookup par email (duplicate check)
      if (q.includes('SELECT id FROM users WHERE email')) return Promise.resolve([])

      // Count pour pagination
      if (q.includes('COUNT(*)')) return Promise.resolve([{ total: 1 }])

      // SELECT liste utilisateurs
      if (q.includes('SELECT id, email, full_name')) return Promise.resolve([FAKE_USER])

      // INSERT utilisateur → retourne le nouvel utilisateur
      if (q.includes('INSERT INTO users')) return Promise.resolve([{ ...FAKE_USER, id: 'new-user-id' }])

      // SELECT pour update (existing check)
      if (q.includes('SELECT id, role FROM users')) return Promise.resolve([{ id: FAKE_USER.id, role: 'field_agent' }])

      // UPDATE users (patch)
      if (q.includes('UPDATE users SET') && q.includes('RETURNING id, email, full_name, role')) {
        return Promise.resolve([{ ...FAKE_USER, role: 'local_validator' }])
      }

      // DELETE (soft-delete)
      if (q.includes('UPDATE users SET deleted_at')) {
        return Promise.resolve([{ id: FAKE_USER.id, email: FAKE_USER.email }])
      }

      // Audit log
      if (q.includes('audit_log') && q.includes('SELECT')) return Promise.resolve([])
      if (q.includes('DISTINCT action')) return Promise.resolve([{ action: 'USER_CREATED' }, { action: 'LOGIN' }])
      if (q.includes('DISTINCT resource')) return Promise.resolve([{ resource: 'users' }])
      if (q.includes('COUNT(*)::int AS total FROM audit_log')) return Promise.resolve([{ total: 0 }])

      return Promise.resolve([])
    }),
    { array: vi.fn().mockImplementation((arr: unknown[]) => arr) },
  ),
  checkDatabaseConnection: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2b$12$hashedpassword'),
    compare: vi.fn().mockResolvedValue(true),
  },
}))

const { usersRoutes } = await import('../routes/users.js')

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fastifyJwt, { secret: 'test_secret_min_32_characters_long_ok' })
  await app.register(fastifyRateLimit, { max: 1000, timeWindow: '1 minute' })
  app.decorate('config', { NODE_ENV: 'test' } as any)
  await app.register(usersRoutes)
  await app.ready()
  return app
}

let app: FastifyInstance

beforeAll(async () => { app = await buildApp() })
afterAll(async () => { await app.close() })

// ── GET /admin/users ──────────────────────────────────────────────────────────

describe('GET /admin/users', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/users' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/users',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 200 pour system_admin avec liste paginée', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/users',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.meta).toMatchObject({ page: 1, limit: 25 })
  })

  it('accepte les filtres role et search dans la query', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/users?role=field_agent&search=agent&page=2',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})

// ── POST /admin/users ─────────────────────────────────────────────────────────

describe('POST /admin/users', () => {
  const newUser = {
    email: 'nouvel@sinaur-rdc.cd',
    fullName: 'Nouvel Agent',
    password: 'motdepassefort123',
    role: 'field_agent',
    geographicScopePcodes: ['CD-NK'],
  }

  it('renvoie 403 pour un non-admin', async () => {
    const res = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: authHeader(agentToken()),
      payload: newUser,
    })
    expect(res.statusCode).toBe(403)
  })

  it('crée un utilisateur et renvoie 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: authHeader(adminToken()),
      payload: newUser,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().success).toBe(true)
  })

  it('renvoie 400 si champs obligatoires manquants', async () => {
    const res = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: authHeader(adminToken()),
      payload: { email: 'incomplet@sinaur-rdc.cd' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 409 si email déjà utilisé', async () => {
    // Reconfigurer le mock pour simuler un email existant
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() => Promise.resolve([{ id: 'existing-id' }]))

    const res = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: authHeader(adminToken()),
      payload: newUser,
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('EMAIL_TAKEN')
  })
})

// ── PATCH /admin/users/:id ────────────────────────────────────────────────────

describe('PATCH /admin/users/:id', () => {
  const TARGET_ID = FAKE_USER.id

  it('renvoie 403 pour un non-admin', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/admin/users/${TARGET_ID}`,
      headers: authHeader(agentToken()),
      payload: { role: 'local_validator' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('met à jour le rôle et renvoie 200', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/admin/users/${TARGET_ID}`,
      headers: authHeader(adminToken()),
      payload: { role: 'local_validator' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('renvoie 400 si un admin tente de se rétrograder', async () => {
    // Le token admin a sub = 'test-user-id' par défaut
    // On cible ce même ID pour simuler l'auto-rétrogradation
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() =>
      Promise.resolve([{ id: 'test-user-id', role: 'system_admin' }])
    )
    const res = await app.inject({
      method: 'PATCH', url: '/admin/users/test-user-id',
      headers: authHeader(adminToken()),
      payload: { role: 'field_agent' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('CANNOT_DOWNGRADE_SELF')
  })
})

// ── DELETE /admin/users/:id ───────────────────────────────────────────────────

describe('DELETE /admin/users/:id', () => {
  it('renvoie 403 pour un non-admin', async () => {
    const res = await app.inject({
      method: 'DELETE', url: `/admin/users/${FAKE_USER.id}`,
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('soft-delete un utilisateur et renvoie 200', async () => {
    const res = await app.inject({
      method: 'DELETE', url: `/admin/users/${FAKE_USER.id}`,
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('renvoie 400 si un admin tente de se supprimer lui-même', async () => {
    const res = await app.inject({
      method: 'DELETE', url: '/admin/users/test-user-id',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('CANNOT_DELETE_SELF')
  })
})

// ── GET /admin/audit-log ──────────────────────────────────────────────────────

describe('GET /admin/audit-log', () => {
  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/audit-log',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie 200 pour system_admin avec filtres disponibles', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/audit-log',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.filters).toHaveProperty('actions')
    expect(body.filters).toHaveProperty('resources')
    expect(Array.isArray(body.filters.actions)).toBe(true)
  })

  it('renvoie 200 pour national_decision_maker', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/audit-log',
      headers: authHeader(deciderToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})
