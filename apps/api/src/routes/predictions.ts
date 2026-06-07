/**
 * Routes proxy vers le service AI de prédiction SINAUR-RDC.
 * Authentification et RBAC ici, calcul dans le microservice Python.
 */
import type { FastifyInstance } from 'fastify'
import axios from 'axios'
import { requireAuth, requireRole } from '../auth/jwt.js'

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://ai-prediction:8000'

async function proxyToAI(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) {
  const res = await axios({
    method,
    url: `${AI_SERVICE_URL}${path}`,
    data: body,
    timeout: 30_000,
    validateStatus: () => true,
  })
  return { status: res.status, data: res.data }
}

export async function predictionRoutes(fastify: FastifyInstance) {
  // Carte des risques (frontend carte)
  fastify.get('/predictions/risk-map', { preHandler: [requireAuth] }, async (request, reply) => {
    const { horizon = '30d' } = request.query as Record<string, string>
    const { status, data } = await proxyToAI(`/predictions/risk-map?horizon=${horizon}`)
    return reply.status(status).send(data)
  })

  // Prédiction pour une province spécifique
  fastify.get('/predictions/province/:pcode', { preHandler: [requireAuth] }, async (request, reply) => {
    const { pcode } = request.params as { pcode: string }
    const { status, data } = await proxyToAI(`/predictions/province/${pcode}`, 'POST')
    return reply.status(status).send(data)
  })

  // Prédiction nationale — réservée aux décideurs
  fastify.post('/predictions/national', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker')],
  }, async (_request, reply) => {
    const { status, data } = await proxyToAI('/predictions/national', 'POST')
    return reply.status(status).send(data)
  })

  // Prédiction détaillée pour un aléa spécifique
  fastify.get('/predictions/province/:pcode/hazard/:hazardType', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { pcode, hazardType } = request.params as { pcode: string; hazardType: string }
    const { horizon = '30d' } = request.query as Record<string, string>
    const { status, data } = await proxyToAI(
      `/predictions/province/${pcode}/hazard/${hazardType}?horizon=${horizon}`,
    )
    return reply.status(status).send(data)
  })

  // Recalcul complet (admin seulement)
  fastify.post('/predictions/refresh', {
    preHandler: [requireAuth, requireRole('system_admin')],
  }, async (_request, reply) => {
    const { status, data } = await proxyToAI('/predictions/trigger-refresh', 'POST')
    return reply.status(status).send(data)
  })
}
