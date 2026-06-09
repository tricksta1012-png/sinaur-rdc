/**
 * SINAUR-RDC Sync Gateway — synchronisation delta pour agents terrain mobile.
 *
 * Endpoints :
 *   POST /sync/register          — enregistrer un appareil
 *   GET  /sync/delta             — récupérer les données modifiées depuis `since`
 *   POST /sync/push              — uploader la file offline (batch)
 *   GET  /sync/status            — état de l'appareil + dernière sync
 *   GET  /sync/conflicts         — conflits en attente de résolution
 *   GET  /health
 *
 * Écoute sur :3003
 */
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCors from '@fastify/cors'
import fastifyRateLimit from '@fastify/rate-limit'
import pino from 'pino'
import postgres from 'postgres'
import Redis from 'ioredis'
import axios from 'axios'
import { z } from 'zod'
import { buildDelta } from './delta.js'
import { logConflict, classifyAxiosError, type SyncItem, type SyncResult } from './conflicts.js'
import { registerMetrics, makeSyncCounters } from '@sinaur/metrics'

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'sync-gateway' },
})

const sql = postgres(
  process.env.DATABASE_URL ?? 'postgresql://sinaur:sinaur_secret@localhost:5432/sinaur_rdc',
  { transform: postgres.camel, max: 10 },
)

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')

const API_URL   = process.env.API_BASE_URL ?? 'http://api:3000'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev_secret_change_in_production_min_32_chars'

const fastify = Fastify({ logger: false })

await fastify.register(fastifyCors, { origin: true })
await fastify.register(fastifyRateLimit, { max: 120, timeWindow: '1 minute' })
await fastify.register(fastifyJwt, { secret: JWT_SECRET })
const metricsRegistry = await registerMetrics(fastify, { service: 'sync-gateway' })
const syncCounters = makeSyncCounters(metricsRegistry)

// ── Auth middleware ──────────────────────────────────────────────────────────

async function requireAuth(request: any, reply: any) {
  try {
    await request.jwtVerify()
  } catch {
    reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED' } })
  }
}

// ── Health ───────────────────────────────────────────────────────────────────

fastify.get('/health', async () => ({ status: 'ok', service: 'sinaur-sync-gateway' }))

// ── Enregistrement d'un appareil ─────────────────────────────────────────────

const RegisterSchema = z.object({
  deviceId:      z.string().uuid(),
  platform:      z.enum(['android', 'ios', 'other']).default('android'),
  appVersion:    z.string().optional(),
  pushToken:     z.string().optional(),
  locationScope: z.array(z.string()).default([]),
})

fastify.post('/sync/register', { preHandler: [requireAuth] }, async (request, reply) => {
  const user = (request as any).user as { sub: string }
  const body = RegisterSchema.parse(request.body)

  await sql`
    INSERT INTO sync_devices (device_id, platform, app_version, user_id, push_token, location_scope)
    VALUES (${body.deviceId}, ${body.platform}, ${body.appVersion ?? null}, ${user.sub}, ${body.pushToken ?? null}, ${sql.array(body.locationScope)})
    ON CONFLICT (device_id) DO UPDATE SET
      platform       = ${body.platform},
      app_version    = COALESCE(${body.appVersion ?? null}, sync_devices.app_version),
      user_id        = ${user.sub},
      push_token     = COALESCE(${body.pushToken ?? null}, sync_devices.push_token),
      location_scope = ${sql.array(body.locationScope)}
  `

  logger.info({ deviceId: body.deviceId, userId: user.sub }, 'Device registered')
  return reply.status(201).send({ success: true, data: { deviceId: body.deviceId } })
})

// ── Sync delta (pull) ─────────────────────────────────────────────────────────

fastify.get('/sync/delta', { preHandler: [requireAuth] }, async (request) => {
  const user = (request as any).user as { sub: string; scope: string[] }
  const q = request.query as Record<string, string>

  const since      = q.since ? new Date(q.since) : new Date(0)
  const deviceId   = q.deviceId ?? 'unknown'
  const typesRaw   = q.types ?? 'all'
  const types      = typesRaw === 'all' ? ['all'] : typesRaw.split(',')

  const syncStart = Date.now()

  // Récupérer le scope de l'appareil si connu
  const [device] = await sql`
    SELECT location_scope FROM sync_devices WHERE device_id = ${deviceId}
  `
  const scopePcodes: string[] = device?.locationScope ?? user.scope ?? []

  const delta = await buildDelta(sql, since, scopePcodes, types)
  const syncedAt = new Date().toISOString()

  // Mettre à jour le dernier sync
  await sql`
    UPDATE sync_devices
    SET last_sync_at = NOW(), last_sync_types = ${sql.array(types)}, total_syncs = total_syncs + 1
    WHERE device_id = ${deviceId}
  `.catch(() => {})

  // Log la session de sync
  const itemCount = Object.values(delta).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0)
  await sql`
    INSERT INTO sync_sessions (device_id, sync_type, since, items_received, duration_ms)
    VALUES (${deviceId}, 'pull', ${since}, ${itemCount}, ${Date.now() - syncStart})
  `.catch(() => {})

  logger.info({ deviceId, since: since.toISOString(), itemCount }, 'Delta sync served')

  return {
    success: true,
    data: {
      since:    since.toISOString(),
      syncedAt,
      counts:   Object.fromEntries(Object.entries(delta).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])),
      delta,
    },
  }
})

// ── Push sync (upload file offline) ──────────────────────────────────────────

const PushSchema = z.object({
  deviceId: z.string(),
  items: z.array(z.object({
    id:              z.string(),
    type:            z.enum(['event', 'beneficiary', 'receipt']),
    method:          z.enum(['POST', 'PATCH']),
    endpoint:        z.string(),
    payload:         z.record(z.unknown()),
    clientCreatedAt: z.string().optional(),
  })).max(100),
})

fastify.post('/sync/push', {
  preHandler: [requireAuth],
  config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
}, async (request) => {
  const user   = (request as any).user as { sub: string }
  const body   = PushSchema.parse(request.body)
  const token  = (request.headers['authorization'] ?? '').replace('Bearer ', '')

  const results: SyncResult[] = []
  let conflicts = 0
  const syncStart = Date.now()

  for (const item of body.items) {
    try {
      const response = await axios({
        method:  item.method.toLowerCase() as any,
        url:     `${API_URL}${item.endpoint}`,
        data:    item.payload,
        timeout: 8000,
        headers: {
          'Authorization':     `Bearer ${token}`,
          'X-Sync-Device':     body.deviceId,
          'X-Internal-Service':'sync-gateway',
        },
      })
      const serverId = response.data?.data?.id ?? undefined
      results.push({ id: item.id, status: 'synced', serverId })
    } catch (err: unknown) {
      const result = classifyAxiosError(err, item as import('./conflicts.js').SyncItem)
      results.push(result)

      if (result.status === 'conflict') {
        conflicts++
        syncCounters.syncConflicts.inc({ type: 'version_mismatch' })
        await logConflict(sql, body.deviceId, 'version_mismatch', item.type, item.payload)
      }
    }
  }

  // Log session
  const synced = results.filter(r => r.status === 'synced').length
  results.forEach(r => syncCounters.syncItemsPushed.inc({ status: r.status }))
  await sql`
    INSERT INTO sync_sessions (device_id, sync_type, items_pushed, conflicts, duration_ms)
    VALUES (${body.deviceId}, 'push', ${body.items.length}, ${conflicts}, ${Date.now() - syncStart})
  `.catch(() => {})

  // Notifier Redis pour éventuels abonnés (autres appareils)
  if (synced > 0) {
    await redis.publish('sinaur:sync:push', JSON.stringify({ userId: user.sub, count: synced }))
      .catch(() => {})
  }

  logger.info({ deviceId: body.deviceId, total: body.items.length, synced, conflicts }, 'Push sync processed')

  return {
    success: true,
    data: {
      results,
      syncedAt: new Date().toISOString(),
      summary: { total: body.items.length, synced, conflicts, errors: results.filter(r => r.status === 'error').length },
    },
  }
})

// ── Statut de l'appareil ──────────────────────────────────────────────────────

fastify.get('/sync/status', { preHandler: [requireAuth] }, async (request) => {
  const q = request.query as Record<string, string>
  const deviceId = q.deviceId

  if (!deviceId) return { success: false, error: { code: 'MISSING_DEVICE_ID' } }

  const [device] = await sql`
    SELECT device_id, platform, app_version, last_sync_at, total_syncs, location_scope
    FROM sync_devices WHERE device_id = ${deviceId}
  `
  if (!device) return { success: true, data: { registered: false } }

  const [conflicts] = await sql`
    SELECT COUNT(*)::int AS count FROM sync_conflicts
    WHERE device_id = ${deviceId} AND resolution = 'pending'
  `

  return { success: true, data: { ...device, pendingConflicts: conflicts?.count ?? 0 } }
})

// ── Conflits en attente ───────────────────────────────────────────────────────

fastify.get('/sync/conflicts', { preHandler: [requireAuth] }, async (request) => {
  const q = request.query as Record<string, string>
  const page   = Math.max(1, parseInt(q.page ?? '1'))
  const limit  = Math.min(50, parseInt(q.limit ?? '20'))
  const offset = (page - 1) * limit

  const rows = await sql`
    SELECT id, device_id, conflict_type, resource_type, resolution, created_at
    FROM sync_conflicts
    WHERE resolution = 'pending'
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  const countRows = await sql`SELECT COUNT(*)::int AS total FROM sync_conflicts WHERE resolution = 'pending'`
  const total = countRows[0]?.total ?? 0

  return { success: true, data: rows, meta: { total, page, limit } }
})

// ── Démarrage ─────────────────────────────────────────────────────────────────

process.on('SIGTERM', async () => { await sql.end(); redis.disconnect(); process.exit(0) })
process.on('SIGINT',  async () => { await sql.end(); redis.disconnect(); process.exit(0) })

try {
  await fastify.listen({ port: 3003, host: '0.0.0.0' })
  logger.info('SINAUR-RDC Sync Gateway listening on :3003')
} catch (err) {
  logger.fatal({ err }, 'Failed to start Sync Gateway')
  process.exit(1)
}
