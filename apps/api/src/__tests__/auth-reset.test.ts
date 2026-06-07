/**
 * Tests d'intégration — réinitialisation de mot de passe.
 * POST /auth/forgot-password  → génère un OTP
 * POST /auth/reset-password   → valide l'OTP et change le mot de passe
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyRateLimit from '@fastify/rate-limit'

const FAKE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000002'

// Contrôle du comportement OTP depuis les tests
let otpShouldBeValid = true

vi.mock('../db.js', () => ({
  sql: Object.assign(
    vi.fn().mockImplementation((strings: TemplateStringsArray) => {
      const q = strings.join('?')

      // Recherche utilisateur par email/phone
      if (q.includes('SELECT id FROM users') && q.includes('email =')) {
        return Promise.resolve([{ id: FAKE_USER_ID }])
      }

      // UPDATE password_hash
      if (q.includes('UPDATE users SET password_hash')) {
        return Promise.resolve([{ id: FAKE_USER_ID, email: 'user@sinaur-rdc.cd' }])
      }

      return Promise.resolve([])
    }),
    { array: vi.fn().mockImplementation((arr: unknown[]) => arr) },
  ),
  checkDatabaseConnection: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../auth/otp.js', () => ({
  createOtp:    vi.fn().mockResolvedValue('123456'),
  verifyOtp:    vi.fn().mockImplementation(() => Promise.resolve(otpShouldBeValid)),
  generateOtpCode: vi.fn().mockReturnValue('123456'),
}))

vi.mock('bcrypt', () => ({
  default: {
    hash:    vi.fn().mockResolvedValue('$2b$12$hashedpassword'),
    compare: vi.fn().mockResolvedValue(true),
  },
}))

const { authRoutes } = await import('../routes/auth.js')

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fastifyJwt, { secret: 'test_secret_min_32_characters_long_ok' })
  await app.register(fastifyRateLimit, { max: 1000, timeWindow: '1 minute' })
  app.decorate('config', { NODE_ENV: 'test' } as any)
  await app.register(authRoutes)
  await app.ready()
  return app
}

let app: FastifyInstance

beforeAll(async () => { app = await buildApp() })
afterAll(async () => { await app.close() })

// ── POST /auth/forgot-password ────────────────────────────────────────────────

describe('POST /auth/forgot-password', () => {
  it('renvoie 200 avec un email existant', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/forgot-password',
      payload: { identifier: 'user@sinaur-rdc.cd' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('renvoie 200 même si le compte n\'existe pas (prévient l\'énumération)', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() => Promise.resolve([]))

    const res = await app.inject({
      method: 'POST', url: '/auth/forgot-password',
      payload: { identifier: 'inconnu@exemple.cd' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('retourne le code OTP en mode dev (NODE_ENV=test)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/forgot-password',
      payload: { identifier: 'user@sinaur-rdc.cd' },
    })
    expect(res.statusCode).toBe(200)
    // En mode test (assimilé à dev), le debug_code est exposé
    const body = res.json()
    expect(body.data).toHaveProperty('debug_code')
  })

  it('renvoie 400 si l\'identifiant est trop court', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/forgot-password',
      payload: { identifier: 'ab' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('accepte un numéro de téléphone comme identifiant', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/forgot-password',
      payload: { identifier: '+243812345678' },
    })
    expect(res.statusCode).toBe(200)
  })
})

// ── POST /auth/reset-password ─────────────────────────────────────────────────

describe('POST /auth/reset-password', () => {
  const validPayload = {
    identifier:  'user@sinaur-rdc.cd',
    otpCode:     '123456',
    newPassword: 'nouveaumotdepasse!2026',
  }

  it('renvoie 200 avec un OTP valide et un nouveau mot de passe fort', async () => {
    otpShouldBeValid = true
    const res = await app.inject({
      method: 'POST', url: '/auth/reset-password',
      payload: validPayload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('renvoie 400 avec un OTP invalide ou expiré', async () => {
    otpShouldBeValid = false
    const res = await app.inject({
      method: 'POST', url: '/auth/reset-password',
      payload: validPayload,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('INVALID_OTP')
    otpShouldBeValid = true
  })

  it('renvoie 400 si le nouveau mot de passe est trop court (< 10 caractères)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/reset-password',
      payload: { ...validPayload, newPassword: 'court' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 400 si le code OTP n\'a pas 6 chiffres', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/reset-password',
      payload: { ...validPayload, otpCode: '12345' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 404 si l\'utilisateur n\'est pas trouvé après validation OTP', async () => {
    otpShouldBeValid = true
    const { sql } = await import('../db.js')
    // Simuler: UPDATE ne retourne aucune ligne (user introuvable ou supprimé)
    ;(sql as any).mockImplementationOnce(() => Promise.resolve([]))

    const res = await app.inject({
      method: 'POST', url: '/auth/reset-password',
      payload: validPayload,
    })
    expect(res.statusCode).toBe(404)
  })
})
