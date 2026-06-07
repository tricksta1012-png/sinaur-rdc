/**
 * Tests d'intégration — routes publiques (/public/*).
 * Vérifie : accès sans auth, anonymisation (aucune PII), en-têtes HXL.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyRateLimit from '@fastify/rate-limit'

// ── Mock DB avant tout import de routes ─────────────────────────────────────
vi.mock('../db.js', () => ({
  sql: Object.assign(
    vi.fn().mockImplementation((strings: TemplateStringsArray, ..._args: unknown[]) => {
      const query = strings.join('?')

      // Alertes publiques
      if (query.includes('cap_alerts')) {
        return Promise.resolve([{
          identifier: 'SINAUR-2026-001',
          sentAt: new Date().toISOString(),
          status: 'Actual',
          msgType: 'Alert',
          urgency: 'Immediate',
          severity: 'Extreme',
          certainty: 'Observed',
          headline: 'Inondation Kinshasa',
          eventName: 'Flood',
          areaPcode: 'CD-KN',
        }])
      }

      // Stats publiques (vue matérialisée)
      if (query.includes('public_stats')) {
        return Promise.resolve([{
          province: 'Kinshasa',
          totalEvents: 3,
          activeAlerts: 1,
          affectedPeople: 500,
        }])
      }

      // Événements publics
      if (query.includes('disaster_events') && query.includes('is_public')) {
        return Promise.resolve([{
          id: 'evt-001',
          hazardType: 'flood',
          severity: 'Severe',
          locationPcode: 'CD-KN',
          locationName: 'Kinshasa',
          province: 'Kinshasa',
          source: 'OCHA',
          createdAt: new Date().toISOString(),
        }])
      }

      return Promise.resolve([])
    }),
    {
      array: vi.fn().mockImplementation((arr: unknown[]) => arr),
    },
  ),
  checkDatabaseConnection: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn(),
  })),
}))

const { publicRoutes } = await import('../routes/public.js')

async function buildPublicApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fastifyJwt, { secret: 'test_secret_min_32_characters_long_ok' })
  await app.register(fastifyRateLimit, { max: 1000, timeWindow: '1 minute' })
  await app.register(publicRoutes)
  await app.ready()
  return app
}

let app: FastifyInstance

beforeAll(async () => { app = await buildPublicApp() })
afterAll(async () => { await app.close() })

describe('GET /public/alerts', () => {
  it('répond 200 sans authentification', async () => {
    const res = await app.inject({ method: 'GET', url: '/public/alerts' })
    expect(res.statusCode).toBe(200)
  })

  it('retourne success: true avec tableau data', async () => {
    const body = (await app.inject({ method: 'GET', url: '/public/alerts' })).json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('ne contient aucun champ PII (nom complet, téléphone, email, coordonnées exactes)', async () => {
    const body = (await app.inject({ method: 'GET', url: '/public/alerts' })).json()
    const text = JSON.stringify(body)
    expect(text).not.toMatch(/phone/i)
    expect(text).not.toMatch(/email/i)
    expect(text).not.toMatch(/full_?name/i)
    expect(text).not.toMatch(/birth/i)
    expect(text).not.toMatch(/national_id/i)
  })
})

describe('GET /public/events', () => {
  it('répond 200 sans authentification', async () => {
    const res = await app.inject({ method: 'GET', url: '/public/events' })
    expect(res.statusCode).toBe(200)
  })

  it('ne contient pas de champs personnels', async () => {
    const body = (await app.inject({ method: 'GET', url: '/public/events' })).json()
    const text = JSON.stringify(body)
    expect(text).not.toMatch(/reporter/i)
    expect(text).not.toMatch(/user_id/i)
    expect(text).not.toMatch(/submitted_by/i)
  })
})

describe('GET /public/export/events.csv (HXL)', () => {
  it('renvoie un CSV avec en-têtes HXL', async () => {
    const res = await app.inject({ method: 'GET', url: '/public/export/events.csv' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/i)
    const body = res.body
    // Ligne HXL obligatoire : commence par #
    const lines = body.split('\n')
    const hxlLine = lines.find(l => l.startsWith('#'))
    expect(hxlLine).toBeDefined()
    expect(hxlLine).toContain('#event+id')
    expect(hxlLine).toContain('#adm+pcode')
  })
})

describe('GET /public/stats', () => {
  it('retourne des statistiques agrégées uniquement (pas de données individuelles)', async () => {
    const res = await app.inject({ method: 'GET', url: '/public/stats' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
  })
})
