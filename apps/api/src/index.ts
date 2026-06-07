import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import { config } from './config.js';
import { checkDatabaseConnection } from './db.js';
import { authRoutes } from './routes/auth.js';
import { geoRoutes } from './routes/geo.js';
import { eventRoutes } from './routes/events.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { mediaRoutes } from './routes/media.js';
import { alertRoutes } from './routes/alerts.js';
import { predictionRoutes } from './routes/predictions.js';
import { registryRoutes } from './routes/registry.js';
import { aidRoutes } from './routes/aids.js';
import { ussdRoutes } from './routes/ussd.js';
import { publicRoutes } from './routes/public.js';
import { logSecurityEvent } from './auth/security.js';
import { registerClient } from './websocket/broadcast.js';

const fastify = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    transport: config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  },
});

fastify.decorate('config', config);

await fastify.register(fastifyHelmet, {
  contentSecurityPolicy: config.NODE_ENV === 'production',
});

await fastify.register(fastifyCors, {
  origin: config.NODE_ENV === 'development' ? true : ['https://sinaur-rdc.cd', 'https://app.sinaur-rdc.cd'],
  credentials: true,
});

await fastify.register(fastifyRateLimit, {
  max: 200,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
});

await fastify.register(fastifyJwt, { secret: config.JWT_SECRET });
await fastify.register(fastifyWebsocket);
await fastify.register(fastifyMultipart);

// Routes HTTP
await fastify.register(authRoutes);
await fastify.register(geoRoutes);
await fastify.register(eventRoutes);
await fastify.register(dashboardRoutes);
await fastify.register(mediaRoutes);
await fastify.register(alertRoutes);
await fastify.register(predictionRoutes);
await fastify.register(registryRoutes);
await fastify.register(aidRoutes);
await fastify.register(ussdRoutes);
await fastify.register(publicRoutes);

// WebSocket : flux temps réel des événements et alertes
fastify.get('/ws', { websocket: true }, (socket, request) => {
  // Extraire le périmètre géographique depuis le token si présent
  let scope: string[] = [];
  try {
    const token = (request.query as Record<string, string>)['token'];
    if (token) {
      const payload = fastify.jwt.verify(token) as { scope: string[] };
      scope = payload.scope ?? [];
    }
  } catch {}

  registerClient(socket, scope);
  socket.send(JSON.stringify({ type: 'CONNECTED', payload: { message: 'SINAUR-RDC flux temps réel actif' } }));
});

// Health check
fastify.get('/health', async () => {
  await checkDatabaseConnection();
  return { status: 'ok', timestamp: new Date().toISOString(), version: '0.5.0-phase5' };
});

fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);

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
    });
  }

  if (error.statusCode) {
    return reply.status(error.statusCode).send({
      success: false,
      error: { code: 'HTTP_ERROR', message: error.message },
    });
  }

  return reply.status(500).send({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: config.NODE_ENV === 'development' ? error.message : 'Erreur interne' },
  });
});

try {
  await fastify.listen({ port: config.API_PORT, host: config.API_HOST });
  fastify.log.info(`SINAUR-RDC API v0.5.0-phase5 — http://${config.API_HOST}:${config.API_PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
