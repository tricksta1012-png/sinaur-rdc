import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload, UserRole } from '@sinaur/shared-types';
import { sql } from '../db.js';

declare module 'fastify' {
  interface FastifyRequest {
    jwtUser: JwtPayload;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
    const payload = request.user as JwtPayload;
    request.jwtUser = payload;
  } catch {
    reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token invalide ou expiré' } });
  }
}

export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.jwtUser) {
      reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Non authentifié' } });
      return;
    }
    if (!roles.includes(request.jwtUser.role)) {
      reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Accès refusé pour ce rôle' } });
    }
  };
}

export function requireGeographicScope(pcodeParam: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.jwtUser;
    if (!user) {
      reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Non authentifié' } });
      return;
    }
    if (user.role === 'system_admin' || user.role === 'national_decision_maker') return;
    if (user.scope.length === 0) return;
    const requestedPcode = (request.params as Record<string, string>)[pcodeParam];
    if (requestedPcode && !user.scope.some((s) => requestedPcode.startsWith(s))) {
      reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Hors de votre périmètre géographique' } });
    }
  };
}

export async function writeAuditLog(
  userId: string | null,
  action: string,
  resource: string,
  resourceId: string | null,
  request: FastifyRequest,
  details?: unknown,
): Promise<void> {
  await sql`
    INSERT INTO audit_log (user_id, action, resource, resource_id, ip_address, user_agent, details)
    VALUES (
      ${userId},
      ${action},
      ${resource},
      ${resourceId},
      ${request.ip}::inet,
      ${request.headers['user-agent'] ?? null},
      ${details ? JSON.stringify(details) : null}
    )
  `;
}
