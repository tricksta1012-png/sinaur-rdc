/**
 * Plugin Prometheus partagé pour tous les services Fastify SINAUR-RDC.
 * Expose GET /metrics (format text Prometheus 0.0.4).
 * Enregistre les métriques par défaut (CPU, mémoire, event loop lag)
 * + histogramme de durée HTTP par route/méthode/statut.
 */
import { Registry, collectDefaultMetrics, Histogram, Counter, Gauge, type DefaultMetricsCollectorConfiguration } from 'prom-client'
import type { FastifyInstance } from 'fastify'

export { Registry, Counter, Gauge, Histogram }

export interface MetricsOptions {
  service: string
  defaultMetrics?: DefaultMetricsCollectorConfiguration<'text/plain; version=0.0.4; charset=utf-8'>
}

export function createRegistry(service: string): Registry {
  const registry = new Registry()
  registry.setDefaultLabels({ service })
  collectDefaultMetrics({ register: registry, labels: { service } })
  return registry
}

export async function registerMetrics(fastify: FastifyInstance, opts: MetricsOptions): Promise<Registry> {
  const registry = createRegistry(opts.service)

  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Durée des requêtes HTTP en secondes',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  })

  const httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'Nombre total de requêtes HTTP',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
  })

  fastify.addHook('onRequest', (request, _reply, done) => {
    (request as any)._metricStart = process.hrtime.bigint()
    done()
  })

  fastify.addHook('onResponse', (request, reply, done) => {
    const start = (request as any)._metricStart as bigint | undefined
    if (start) {
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9
      const route = request.routerPath ?? request.url.split('?')[0] ?? 'unknown'
      const labels = {
        method:      request.method,
        route,
        status_code: String(reply.statusCode),
      }
      httpDuration.observe(labels, durationSec)
      httpRequests.inc(labels)
    }
    done()
  })

  fastify.get('/metrics', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_req, reply) => {
    reply.header('Content-Type', registry.contentType)
    return reply.send(await registry.metrics())
  })

  return registry
}

// ── Compteurs métier partagés ──────────────────────────────────────────────

export function makeAlertCounters(registry: Registry) {
  return {
    alertsDispatched: new Counter({
      name: 'sinaur_alerts_dispatched_total',
      help: 'Alertes CAP dispatchées (push + SMS)',
      labelNames: ['channel', 'severity'],
      registers: [registry],
    }),
    alertQueueDepth: new Gauge({
      name: 'sinaur_alert_queue_depth',
      help: 'Nombre d\'alertes en file d\'attente de dispatch',
      registers: [registry],
    }),
  }
}

export function makeSyncCounters(registry: Registry) {
  return {
    syncItemsPushed: new Counter({
      name: 'sinaur_sync_items_pushed_total',
      help: 'Items poussés via sync gateway',
      labelNames: ['status'],
      registers: [registry],
    }),
    syncConflicts: new Counter({
      name: 'sinaur_sync_conflicts_total',
      help: 'Conflits de synchronisation détectés',
      labelNames: ['type'],
      registers: [registry],
    }),
    activeDevices: new Gauge({
      name: 'sinaur_sync_active_devices',
      help: 'Appareils ayant synchronisé dans les 24h',
      registers: [registry],
    }),
  }
}

export function makeUssdCounters(registry: Registry) {
  return {
    ussdSessions: new Counter({
      name: 'sinaur_ussd_sessions_total',
      help: 'Sessions USSD ouvertes',
      labelNames: ['action'],
      registers: [registry],
    }),
  }
}
