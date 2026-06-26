/**
 * Factory Fastify — séparée de l'écoute réseau pour permettre les tests.
 */
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCors from '@fastify/cors'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyWebsocket from '@fastify/websocket'
import fastifyMultipart from '@fastify/multipart'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import { config } from './config.js'
import { checkDatabaseConnection, startKeepalive } from './db.js'
import { startStatutSituationScheduler } from './services/statut-situation.js'
import { authRoutes } from './routes/auth.js'
import { geoRoutes } from './routes/geo.js'
import { eventRoutes } from './routes/events.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { mediaRoutes } from './routes/media.js'
import { alertRoutes } from './routes/alerts.js'
import { predictionRoutes } from './routes/predictions.js'
import { registryRoutes } from './routes/registry.js'
import { aidRoutes } from './routes/aids.js'
import { ussdRoutes } from './routes/ussd.js'
import { publicRoutes } from './routes/public.js'
import { crisisRoutes } from './routes/crises.js'
import { taskRoutes } from './routes/tasks.js'
import { usersRoutes } from './routes/users.js'
import { profileRoutes } from './routes/profile.js'
import { webhookRoutes } from './routes/webhooks.js'
import { resourceRoutes } from './routes/resources.js'
import { demandsRoutes } from './routes/demands.js'
import { veilleRoutes } from './routes/veille.js'
import { antifraudRoutes } from './routes/antifraud.js'
import { anomalieStocksRoutes } from './routes/anomalie-stocks.js'
import { signalementsRoutes } from './routes/signalements.js'
import { reportingRoutes } from './routes/reporting.js'
import { logistiqueRoutes } from './routes/logistique.js'
import { epidemieRoutes } from './routes/epidemie.js'
import { agentsStatusRoutes } from './routes/agents-status.js'
import { conflitRoutes } from './routes/conflit.js'
import { renseignementRoutes } from './routes/renseignement.js'
import { connaissanceRoutes } from './routes/connaissance.js'
import { etdRoutes } from './routes/etd.js'
import { idpCheckpointRoutes } from './routes/idp-checkpoints.js'
import { responsablesRoutes } from './routes/responsables.js'
import { ruesRoutes } from './routes/rues.js'
import { catastrophesRoutes } from './routes/catastrophes.js'
import { hubRoutes } from './routes/hub.js'
import { logSecurityEvent } from './auth/security.js'
import { aiHealthCheck } from './services/aiClient.js'
import { registerClient } from './websocket/broadcast.js'
import { registerMetrics } from '@sinaur/metrics'

export async function createApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: config.NODE_ENV === 'test' ? false : {
      level: config.LOG_LEVEL,
      transport: config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
    },
  })

  fastify.decorate('config', config)

  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: config.NODE_ENV === 'production',
  })

  await fastify.register(fastifyCors, {
    origin: config.NODE_ENV === 'development'
      ? true
      : [
          'https://sinaur-rdc.cd',
          'https://app.sinaur-rdc.cd',
          'https://command-center-production-3de3.up.railway.app',
          'https://public-production-c035.up.railway.app',
        ],
    credentials: true,
  })

  await fastify.register(fastifyRateLimit, {
    max: 200,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  })

  await fastify.register(fastifyJwt, { secret: config.JWT_SECRET })
  await fastify.register(fastifyWebsocket)
  await fastify.register(fastifyMultipart)
  await registerMetrics(fastify, { service: 'api' })

  // OpenAPI — uniquement hors production ou si SWAGGER_ENABLED=true
  if (config.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true') {
    await fastify.register(fastifySwagger, {
      openapi: {
        openapi: '3.0.3',
        info: {
          title: 'SINAUR-RDC API',
          description: 'Système National Intelligent d\'Alerte, d\'Urgence et de Réponse aux Sinistres — RDC',
          version: '1.0.0',
          contact: { name: 'SINAUR-RDC', email: 'api@sinaur-rdc.cd' },
          license: { name: 'Usage gouvernemental et humanitaire — RDC' },
        },
        servers: [
          { url: 'https://api.sinaur-rdc.cd', description: 'Production' },
          { url: 'http://localhost:3000', description: 'Développement' },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
              description: 'JWT obtenu via POST /auth/login',
            },
          },
        },
        security: [{ bearerAuth: [] }],
        tags: [
          { name: 'auth',     description: 'Authentification et tokens' },
          { name: 'events',   description: 'Événements catastrophes' },
          { name: 'alerts',   description: 'Alertes CAP 1.2' },
          { name: 'registry', description: 'Registre des sinistrés' },
          { name: 'aids',     description: 'Suivi des aides' },
          { name: 'crises',   description: 'Gestion de crise (GLIDE)' },
          { name: 'public',   description: 'Endpoints publics (sans auth)' },
          { name: 'geo',      description: 'Divisions administratives COD-AB' },
        ],
      },
    })

    await fastify.register(fastifySwaggerUi, {
      routePrefix: '/docs',
      uiConfig: { deepLinking: true, persistAuthorization: true },
      staticCSP: true,
    })
  }

  await fastify.register(authRoutes)
  await fastify.register(geoRoutes)
  await fastify.register(eventRoutes)
  await fastify.register(dashboardRoutes)
  await fastify.register(mediaRoutes)
  await fastify.register(alertRoutes)
  await fastify.register(predictionRoutes)
  await fastify.register(registryRoutes)
  await fastify.register(aidRoutes)
  await fastify.register(ussdRoutes)
  await fastify.register(publicRoutes)
  await fastify.register(crisisRoutes)
  await fastify.register(taskRoutes)
  await fastify.register(usersRoutes)
  await fastify.register(profileRoutes)
  await fastify.register(webhookRoutes)
  await fastify.register(resourceRoutes)
  await fastify.register(demandsRoutes)
  await fastify.register(veilleRoutes)
  await fastify.register(antifraudRoutes)
  await fastify.register(anomalieStocksRoutes)
  await fastify.register(signalementsRoutes)
  await fastify.register(reportingRoutes)
  await fastify.register(logistiqueRoutes)
  await fastify.register(epidemieRoutes)
  await fastify.register(agentsStatusRoutes)
  await fastify.register(conflitRoutes)
  await fastify.register(renseignementRoutes)
  await fastify.register(connaissanceRoutes)
  await fastify.register(etdRoutes)
  await fastify.register(idpCheckpointRoutes)
  await fastify.register(responsablesRoutes)
  await fastify.register(ruesRoutes)
  await fastify.register(catastrophesRoutes)
  await fastify.register(hubRoutes)

  fastify.get('/ws', { websocket: true }, (socket, request) => {
    let scope: string[] = []
    try {
      const token = (request.query as Record<string, string>)['token']
      if (token) {
        const payload = fastify.jwt.verify(token) as { scope: string[] }
        scope = payload.scope ?? []
      }
    } catch {}
    registerClient(socket.socket, scope)
    socket.socket.send(JSON.stringify({ type: 'CONNECTED', payload: { message: 'SINAUR-RDC flux temps réel actif' } }))
  })

  fastify.addHook('onReady', async () => {
    startKeepalive();
    startStatutSituationScheduler();
  });

  fastify.get('/health', async () => {
    const [, aiOk] = await Promise.allSettled([
      checkDatabaseConnection(),
      aiHealthCheck(),
    ])
    const aiStatus = aiOk.status === 'fulfilled' && aiOk.value ? 'ok' : 'unreachable'
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      services: { database: 'ok', ai_prediction: aiStatus },
    }
  })

  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error)

    if (error.statusCode === 401) {
      logSecurityEvent('auth_failed', request, { message: error.message })
    } else if (error.statusCode === 403) {
      logSecurityEvent('forbidden', request, { message: error.message, url: request.url })
    } else if (error.statusCode === 429) {
      logSecurityEvent('rate_limited', request, { url: request.url })
    }

    if (error.name === 'ZodError') {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Données invalides', details: (error as any).errors },
      })
    }

    if (error.statusCode) {
      return reply.status(error.statusCode).send({
        success: false,
        error: { code: 'HTTP_ERROR', message: error.message },
      })
    }

    return reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: config.NODE_ENV === 'development' ? error.message : 'Erreur interne' },
    })
  })

  return fastify
}
