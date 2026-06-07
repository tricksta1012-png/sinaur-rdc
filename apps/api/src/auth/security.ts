/**
 * Journalisation des événements de sécurité (§9 spec SINAUR-RDC).
 * Écrit dans security_events sans bloquer la réponse (fire-and-forget).
 */
import type { FastifyRequest } from 'fastify'
import { sql } from '../db.js'

export type SecurityEventType =
  | 'auth_failed'
  | 'rate_limited'
  | 'forbidden'
  | 'suspicious_input'
  | 'unauthorized_access'

export function logSecurityEvent(
  eventType: SecurityEventType,
  request: FastifyRequest,
  details: Record<string, unknown> = {},
  userId?: string,
): void {
  const ip = request.ip ?? null
  const ua = request.headers['user-agent'] ?? null
  const resource = request.routeOptions?.url ?? request.url ?? null

  sql`
    INSERT INTO security_events (event_type, ip_address, user_agent, user_id, resource, details)
    VALUES (
      ${eventType},
      ${ip}::inet,
      ${ua},
      ${userId ?? null},
      ${resource},
      ${JSON.stringify(details)}
    )
  `.catch(() => {}) // Non-bloquant — l'audit ne doit pas casser la réponse
}

/**
 * Détecte des motifs suspects dans les query params / body.
 * Retourne true si l'entrée semble contenir une tentative d'injection.
 */
export function hasSuspiciousInput(input: string): boolean {
  const patterns = [
    /(\bUNION\b.*\bSELECT\b)/i,
    /(\bDROP\b.*\bTABLE\b)/i,
    /(<script[\s>])/i,
    /(javascript\s*:)/i,
    /(\.\.\/)/, // path traversal
  ]
  return patterns.some(p => p.test(input))
}
