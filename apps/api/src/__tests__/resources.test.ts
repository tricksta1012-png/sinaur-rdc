/**
 * Tests d'intégration — Phase 20 — Stocks & ressources humanitaires.
 * Routes: GET/POST/PATCH /resources/depots, mouvements de stock, alertes seuil.
 * RBAC (écriture): system_admin, national_decision_maker, provincial_coordinator, humanitarian_partner
 * RBAC (lecture):  tout utilisateur authentifié (résultats filtrés par scope géographique)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyRateLimit from '@fastify/rate-limit'
import { ZodError } from 'zod'
import { adminToken, agentToken, deciderToken, partnerToken, authHeader } from './helpers.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEPOT_ID = 'dddddddd-0000-0000-0000-000000000001'
const STOCK_ID = 'aaaaaaaa-0000-0000-0000-000000000002'

const FAKE_DEPOT_ROW = {
  id: DEPOT_ID,
  name: 'Dépôt Central Kinshasa',
  pcode: 'CD-KN',
  address: '12 Avenue Kasa-Vubu, Kinshasa',
  is_active: true,
  manager_name: 'Jean Mukendi',
  stock_lines: 3,
  total_units: '1500',
  low_stock_count: 1,
  created_at: new Date().toISOString(),
}

const FAKE_DEPOT_DETAIL = {
  id: DEPOT_ID,
  name: 'Dépôt Central Kinshasa',
  pcode: 'CD-KN',
  address: '12 Avenue Kasa-Vubu, Kinshasa',
  is_active: true,
  manager_id: null,
  manager_name: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

const FAKE_STOCK = {
  id: STOCK_ID,
  depot_id: DEPOT_ID,
  resource_type: 'food',
  resource_name: 'Rations alimentaires',
  unit: 'kg',
  quantity_available: '500',
  quantity_reserved: '0',
  minimum_threshold: '100',
  crisis_id: null,
  crisis_glide: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

const FAKE_MOVEMENT_ROW = {
  id: 'bbbbbbbb-0000-0000-0000-000000000003',
  movement_type: 'in',
  quantity: '100',
  created_at: new Date().toISOString(),
}

const FAKE_ALERT = {
  stock_id: STOCK_ID,
  resource_name: 'Médicaments essentiels',
  unit: 'unités',
  quantity_available: '50',
  minimum_threshold: '200',
  gap: '-150',
  depot_id: DEPOT_ID,
  depot_name: 'Dépôt Central Kinshasa',
  pcode: 'CD-KN',
}

// ── Mock DB ───────────────────────────────────────────────────────────────────

vi.mock('axios', () => ({
  default: { post: vi.fn().mockResolvedValue({ data: { ok: true } }) },
}))

vi.mock('../db.js', () => ({
  sql: Object.assign(
    vi.fn().mockImplementation((strings: TemplateStringsArray) => {
      const q = strings.join('?')

      // Alertes stocks sous le seuil (WHERE unique à cette route)
      if (q.includes('WHERE s.minimum_threshold > 0')) {
        return Promise.resolve([FAKE_ALERT])
      }

      // Liste des dépôts (requête avec agrégats GROUP BY)
      if (q.includes('FROM resource_depots d') && q.includes('GROUP BY d.id')) {
        return Promise.resolve([FAKE_DEPOT_ROW])
      }

      // Détail dépôt (SELECT d.*)
      if (q.includes('SELECT d.*') && q.includes('FROM resource_depots d')) {
        return Promise.resolve([FAKE_DEPOT_DETAIL])
      }

      // Stocks d'un dépôt (détail, deuxième requête)
      if (q.includes('FROM resource_stocks s') && q.includes('LEFT JOIN crisis_events')) {
        return Promise.resolve([FAKE_STOCK])
      }

      // Vérification existence dépôt (avant upsert stock)
      if (q.includes('SELECT id FROM resource_depots WHERE id =')) {
        return Promise.resolve([{ id: DEPOT_ID }])
      }

      // Lecture stock avant enregistrement d'un mouvement (JOIN dépôt pour phase 23)
      if (q.includes('d.name AS depot_name')) {
        return Promise.resolve([{
          id: STOCK_ID, quantityAvailable: 500, quantityReserved: 0,
          resourceName: 'Rations alimentaires', unit: 'kg', minimumThreshold: 100,
          depotName: 'Dépôt Central Kinshasa', pcode: 'CD-KN',
        }])
      }

      // Création dépôt
      if (q.includes('INSERT INTO resource_depots')) {
        return Promise.resolve([{
          id: DEPOT_ID,
          name: 'Nouveau Dépôt Test',
          pcode: 'CD-KN',
          address: null,
          is_active: true,
          created_at: new Date().toISOString(),
        }])
      }

      // Mise à jour dépôt
      if (q.includes('UPDATE resource_depots SET')) {
        return Promise.resolve([{
          id: DEPOT_ID,
          name: 'Dépôt Modifié',
          pcode: 'CD-KN',
          is_active: false,
          updated_at: new Date().toISOString(),
        }])
      }

      // Upsert stock (INSERT ... ON CONFLICT)
      if (q.includes('INSERT INTO resource_stocks')) {
        return Promise.resolve([{
          id: STOCK_ID,
          resource_type: 'food',
          resource_name: 'Rations alimentaires',
          unit: 'kg',
          quantity_available: '500',
          quantity_reserved: '0',
          minimum_threshold: '100',
          updated_at: new Date().toISOString(),
        }])
      }

      // Enregistrement mouvement de stock
      if (q.includes('INSERT INTO resource_movements')) {
        return Promise.resolve([FAKE_MOVEMENT_ROW])
      }

      // Mise à jour quantité après mouvement
      if (q.includes('UPDATE resource_stocks')) {
        return Promise.resolve([])
      }

      // Historique des mouvements (liste)
      if (q.includes('FROM resource_movements m') && q.includes('JOIN resource_stocks s')) {
        return Promise.resolve([{
          id: FAKE_MOVEMENT_ROW.id,
          movement_type: 'in',
          quantity: '100',
          reason: 'Réapprovisionnement',
          created_at: new Date().toISOString(),
          resource_name: 'Rations alimentaires',
          unit: 'kg',
          created_by_name: 'Admin Test',
        }])
      }

      // Comptage pagination mouvements
      if (q.includes('COUNT(*)::int AS total FROM resource_movements')) {
        return Promise.resolve([{ total: 1 }])
      }

      return Promise.resolve([])
    }),
    { array: vi.fn().mockImplementation((arr: unknown[]) => arr) },
  ),
  checkDatabaseConnection: vi.fn().mockResolvedValue(undefined),
}))

const { resourceRoutes } = await import('../routes/resources.js')

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
  await app.register(resourceRoutes)
  await app.ready()
  return app
}

let app: FastifyInstance

beforeAll(async () => { app = await buildApp() })
afterAll(async () => { await app.close() })

// ── GET /resources/depots ─────────────────────────────────────────────────────

describe('GET /resources/depots', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/resources/depots' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 200 pour system_admin avec la liste des dépôts', async () => {
    const res = await app.inject({
      method: 'GET', url: '/resources/depots',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data[0]).toHaveProperty('id')
    expect(body.data[0]).toHaveProperty('pcode')
    expect(body.data[0]).toHaveProperty('low_stock_count')
    expect(body.data[0]).toHaveProperty('stock_lines')
  })

  it('renvoie 200 pour un agent terrain (scope limité)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/resources/depots',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('accepte les filtres pcode et active', async () => {
    const res = await app.inject({
      method: 'GET', url: '/resources/depots?pcode=CD-KN&active=true',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})

// ── GET /resources/depots/:id ─────────────────────────────────────────────────

describe('GET /resources/depots/:id', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: `/resources/depots/${DEPOT_ID}` })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 200 avec le détail du dépôt et ses stocks', async () => {
    const res = await app.inject({
      method: 'GET', url: `/resources/depots/${DEPOT_ID}`,
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('id', DEPOT_ID)
    expect(Array.isArray(body.data.stocks)).toBe(true)
    expect(body.data.stocks[0]).toHaveProperty('resource_type', 'food')
    expect(body.data.stocks[0]).toHaveProperty('quantity_available')
    expect(body.data.stocks[0]).toHaveProperty('minimum_threshold')
  })

  it('renvoie 404 si le dépôt est introuvable', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() => Promise.resolve([]))

    const res = await app.inject({
      method: 'GET', url: `/resources/depots/${DEPOT_ID}`,
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })
})

// ── POST /resources/depots ────────────────────────────────────────────────────

describe('POST /resources/depots', () => {
  const newDepot = {
    name: 'Entrepôt Nord-Kivu Goma',
    pcode: 'CD-NK',
    address: '5 Avenue des Volcans, Goma',
  }

  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'POST', url: '/resources/depots', payload: newDepot })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'POST', url: '/resources/depots',
      headers: authHeader(agentToken()),
      payload: newDepot,
    })
    expect(res.statusCode).toBe(403)
  })

  it('crée un dépôt et renvoie 201 pour system_admin', async () => {
    const res = await app.inject({
      method: 'POST', url: '/resources/depots',
      headers: authHeader(adminToken()),
      payload: newDepot,
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('id')
    expect(body.data).toHaveProperty('is_active', true)
  })

  it('crée un dépôt et renvoie 201 pour humanitarian_partner', async () => {
    const res = await app.inject({
      method: 'POST', url: '/resources/depots',
      headers: authHeader(partnerToken()),
      payload: newDepot,
    })
    expect(res.statusCode).toBe(201)
  })

  it('renvoie 400 si le nom est trop court (< 2 caractères)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/resources/depots',
      headers: authHeader(adminToken()),
      payload: { name: 'X', pcode: 'CD-NK' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 400 si le pcode est manquant', async () => {
    const res = await app.inject({
      method: 'POST', url: '/resources/depots',
      headers: authHeader(adminToken()),
      payload: { name: 'Dépôt sans pcode' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── PATCH /resources/depots/:id ───────────────────────────────────────────────

describe('PATCH /resources/depots/:id', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/resources/depots/${DEPOT_ID}`,
      payload: { isActive: false },
    })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/resources/depots/${DEPOT_ID}`,
      headers: authHeader(agentToken()),
      payload: { isActive: false },
    })
    expect(res.statusCode).toBe(403)
  })

  it('met à jour le dépôt et renvoie 200 pour system_admin', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/resources/depots/${DEPOT_ID}`,
      headers: authHeader(adminToken()),
      payload: { name: 'Dépôt Modifié', isActive: false },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('id', DEPOT_ID)
  })

  it('met à jour pour national_decision_maker', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/resources/depots/${DEPOT_ID}`,
      headers: authHeader(deciderToken()),
      payload: { name: 'Dépôt Modifié Décideur' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 404 si le dépôt est introuvable', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() => Promise.resolve([]))

    const res = await app.inject({
      method: 'PATCH', url: `/resources/depots/${DEPOT_ID}`,
      headers: authHeader(adminToken()),
      payload: { name: 'Inexistant' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })
})

// ── POST /resources/depots/:id/stocks ────────────────────────────────────────

describe('POST /resources/depots/:id/stocks', () => {
  const newStock = {
    resourceType: 'food',
    resourceName: 'Rations alimentaires',
    unit: 'kg',
    quantityAvailable: 500,
    minimumThreshold: 100,
  }

  it('renvoie 401 sans token', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/stocks`,
      payload: newStock,
    })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/stocks`,
      headers: authHeader(agentToken()),
      payload: newStock,
    })
    expect(res.statusCode).toBe(403)
  })

  it('crée ou met à jour un stock et renvoie 201', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/stocks`,
      headers: authHeader(adminToken()),
      payload: newStock,
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('resource_type', 'food')
    expect(body.data).toHaveProperty('unit', 'kg')
    expect(body.data).toHaveProperty('quantity_available')
    expect(body.data).toHaveProperty('minimum_threshold')
  })

  it('crée pour humanitarian_partner', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/stocks`,
      headers: authHeader(partnerToken()),
      payload: newStock,
    })
    expect(res.statusCode).toBe(201)
  })

  it('renvoie 404 si le dépôt est introuvable', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() => Promise.resolve([]))

    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/stocks`,
      headers: authHeader(adminToken()),
      payload: newStock,
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })

  it('renvoie 400 si resource_type est invalide', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/stocks`,
      headers: authHeader(adminToken()),
      payload: { ...newStock, resourceType: 'armes' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 400 si quantityAvailable est négative', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/stocks`,
      headers: authHeader(adminToken()),
      payload: { ...newStock, quantityAvailable: -10 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 400 si resourceName est trop court', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/stocks`,
      headers: authHeader(adminToken()),
      payload: { ...newStock, resourceName: 'X' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── POST /resources/depots/:id/movements ─────────────────────────────────────

describe('POST /resources/depots/:id/movements', () => {
  const inMovement = {
    stockId: STOCK_ID,
    movementType: 'in',
    quantity: 100,
    reason: 'Réapprovisionnement',
  }

  it('renvoie 401 sans token', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/movements`,
      payload: inMovement,
    })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 403 pour un agent terrain', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(agentToken()),
      payload: inMovement,
    })
    expect(res.statusCode).toBe(403)
  })

  it('enregistre une entrée "in" et calcule la nouvelle quantité', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(adminToken()),
      payload: inMovement,
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('movement_type', 'in')
    expect(body.data.newQuantityAvailable).toBe(600) // 500 + 100
  })

  it('enregistre une sortie "out" et soustrait la quantité', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(adminToken()),
      payload: { stockId: STOCK_ID, movementType: 'out', quantity: 50, reason: 'Distribution terrain' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.newQuantityAvailable).toBe(450) // 500 - 50
  })

  it('renvoie 409 INSUFFICIENT_STOCK si la sortie dépasse le disponible', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() =>
      Promise.resolve([{
        id: STOCK_ID, quantityAvailable: 30, quantityReserved: 0,
        resourceName: 'Rations alimentaires', unit: 'kg', minimumThreshold: 100,
        depotName: 'Dépôt Central Kinshasa', pcode: 'CD-KN',
      }])
    )

    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(adminToken()),
      payload: { stockId: STOCK_ID, movementType: 'out', quantity: 100 },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('INSUFFICIENT_STOCK')
  })

  it('enregistre un "transfer" et vérifie également le stock disponible', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(adminToken()),
      payload: { stockId: STOCK_ID, movementType: 'transfer', quantity: 200 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.newQuantityAvailable).toBe(300) // 500 - 200
  })

  it('enregistre un "adjustment" qui fixe la valeur absolue', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(adminToken()),
      payload: { stockId: STOCK_ID, movementType: 'adjustment', quantity: 750 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.newQuantityAvailable).toBe(750)
  })

  it('renvoie 404 si l\'article est introuvable dans ce dépôt', async () => {
    const { sql } = await import('../db.js')
    ;(sql as any).mockImplementationOnce(() => Promise.resolve([]))

    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(adminToken()),
      payload: inMovement,
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })

  it('renvoie 400 si la quantité est nulle ou négative', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(adminToken()),
      payload: { stockId: STOCK_ID, movementType: 'in', quantity: 0 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 400 si movementType est invalide', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(adminToken()),
      payload: { stockId: STOCK_ID, movementType: 'destruction', quantity: 10 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('renvoie 400 si stockId est absent', async () => {
    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(adminToken()),
      payload: { movementType: 'in', quantity: 50 },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── GET /resources/depots/:id/movements ──────────────────────────────────────

describe('GET /resources/depots/:id/movements', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: `/resources/depots/${DEPOT_ID}/movements` })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 200 avec l\'historique paginé pour system_admin', async () => {
    const res = await app.inject({
      method: 'GET', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.pagination).toMatchObject({ page: 1, limit: 50, total: 1 })
    expect(body.data[0]).toHaveProperty('resource_name')
    expect(body.data[0]).toHaveProperty('movement_type')
    expect(body.data[0]).toHaveProperty('unit')
  })

  it('renvoie 200 pour un humanitarian_partner', async () => {
    const res = await app.inject({
      method: 'GET', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(partnerToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un agent terrain (lecture non restreinte par rôle)', async () => {
    const res = await app.inject({
      method: 'GET', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepte les paramètres de pagination page et limit', async () => {
    const res = await app.inject({
      method: 'GET', url: `/resources/depots/${DEPOT_ID}/movements?page=2&limit=10`,
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().pagination).toMatchObject({ page: 2, limit: 10 })
  })

  it('renvoie 400 si limit dépasse 100', async () => {
    const res = await app.inject({
      method: 'GET', url: `/resources/depots/${DEPOT_ID}/movements?limit=200`,
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── GET /resources/alerts ─────────────────────────────────────────────────────

describe('GET /resources/alerts', () => {
  it('renvoie 401 sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/resources/alerts' })
    expect(res.statusCode).toBe(401)
  })

  it('renvoie 200 pour system_admin avec tous les stocks critiques', async () => {
    const res = await app.inject({
      method: 'GET', url: '/resources/alerts',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThan(0)
  })

  it('chaque alerte contient le stock, le dépôt et le gap négatif', async () => {
    const res = await app.inject({
      method: 'GET', url: '/resources/alerts',
      headers: authHeader(adminToken()),
    })
    const alert = res.json().data[0]
    expect(alert).toHaveProperty('stock_id')
    expect(alert).toHaveProperty('resource_name')
    expect(alert).toHaveProperty('quantity_available')
    expect(alert).toHaveProperty('minimum_threshold')
    expect(alert).toHaveProperty('gap')
    expect(Number(alert.gap)).toBeLessThan(0)
    expect(alert).toHaveProperty('depot_id')
    expect(alert).toHaveProperty('depot_name')
    expect(alert).toHaveProperty('pcode')
  })

  it('renvoie 200 pour national_decision_maker (vue globale)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/resources/alerts',
      headers: authHeader(deciderToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie 200 pour un agent terrain (résultats filtrés par scope)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/resources/alerts',
      headers: authHeader(agentToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('renvoie une liste vide si aucun stock n\'est sous le seuil', async () => {
    const { sql } = await import('../db.js')
    // Pour admin : 1er appel = sql`` (condition scope), 2e appel = requête alertes principale
    ;(sql as any)
      .mockImplementationOnce(() => Promise.resolve([]))
      .mockImplementationOnce(() => Promise.resolve([]))

    const res = await app.inject({
      method: 'GET', url: '/resources/alerts',
      headers: authHeader(adminToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(0)
  })
})

// ── Phase 23 — push FCM stocks critiques ─────────────────────────────────────

describe('Phase 23 — push FCM stock critique', () => {
  it('appelle axios.post /notify/stock-low quand le seuil est franchi à la baisse', async () => {
    const axios = (await import('axios')).default
    ;(axios.post as any).mockClear()

    const { sql } = await import('../db.js')
    // Stock à 150, seuil 100 — sortie de 60 → newQty = 90 (franchissement du seuil)
    ;(sql as any).mockImplementationOnce(() =>
      Promise.resolve([{
        id: STOCK_ID, quantityAvailable: 150, quantityReserved: 0,
        resourceName: 'Rations alimentaires', unit: 'kg', minimumThreshold: 100,
        depotName: 'Dépôt Central Kinshasa', pcode: 'CD-KN',
      }])
    )

    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(adminToken()),
      payload: { stockId: STOCK_ID, movementType: 'out', quantity: 60 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.newQuantityAvailable).toBe(90)
    expect(axios.post).toHaveBeenCalledOnce()
    const [url, payload] = (axios.post as any).mock.calls[0]
    expect(url).toMatch(/\/notify\/stock-low$/)
    expect(payload).toMatchObject({
      resourceName: 'Rations alimentaires',
      pcode: 'CD-KN',
      quantityAvailable: 90,
      minimumThreshold: 100,
      depotId: DEPOT_ID,
    })
  })

  it('ne déclenche pas axios.post si le stock était déjà sous le seuil', async () => {
    const axios = (await import('axios')).default
    ;(axios.post as any).mockClear()

    const { sql } = await import('../db.js')
    // Stock déjà à 80 (sous seuil 100) — pas de franchissement
    ;(sql as any).mockImplementationOnce(() =>
      Promise.resolve([{
        id: STOCK_ID, quantityAvailable: 80, quantityReserved: 0,
        resourceName: 'Rations alimentaires', unit: 'kg', minimumThreshold: 100,
        depotName: 'Dépôt Central Kinshasa', pcode: 'CD-KN',
      }])
    )

    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(adminToken()),
      payload: { stockId: STOCK_ID, movementType: 'out', quantity: 10 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.newQuantityAvailable).toBe(70)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('ne déclenche pas axios.post pour un mouvement "in" (réapprovisionnement)', async () => {
    const axios = (await import('axios')).default
    ;(axios.post as any).mockClear()

    const res = await app.inject({
      method: 'POST', url: `/resources/depots/${DEPOT_ID}/movements`,
      headers: authHeader(adminToken()),
      payload: { stockId: STOCK_ID, movementType: 'in', quantity: 500 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.newQuantityAvailable).toBe(1000) // 500 + 500
    expect(axios.post).not.toHaveBeenCalled()
  })
})
