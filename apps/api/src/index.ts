import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config.js';
import { checkDatabaseConnection } from './db.js';
import { authRoutes } from './routes/auth.js';
import { geoRoutes } from './routes/geo.js';
import { eventRoutes } from './routes/events.js';

const fastify = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    transport: config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  },
});

// Décorer l'instance avec la config (accessible dans les routes)
fastify.decorate('config', config);

// Sécurité
await fastify.register(fastifyHelmet, {
  contentSecurityPolicy: config.NODE_ENV === 'production',
});

await fastify.register(fastifyCors, {
  origin: config.NODE_ENV === 'development' ? true : ['https://sinaur-rdc.cd', 'https://app.sinaur-rdc.cd'],
  credentials: true,
});

await fastify.register(fastifyRateLimit, {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
});

// JWT
await fastify.register(fastifyJwt, { secret: config.JWT_SECRET });

// WebSocket (pour les alertes temps réel)
await fastify.register(fastifyWebsocket);

// Routes
await fastify.register(authRoutes);
await fastify.register(geoRoutes);
await fastify.register(eventRoutes);

// Health check
fastify.get('/health', async () => {
  await checkDatabaseConnection();
  return { status: 'ok', timestamp: new Date().toISOString(), version: '0.1.0' };
});

// Gestionnaire d'erreurs global
fastify.setErrorHandler((error, _request, reply) => {
  fastify.log.error(error);

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
  fastify.log.info(`SINAUR-RDC API démarrée — http://${config.API_HOST}:${config.API_PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
