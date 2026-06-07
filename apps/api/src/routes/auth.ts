import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { sql } from '../db.js';
import { createOtp, verifyOtp } from '../auth/otp.js';
import { writeAuditLog } from '../auth/jwt.js';
import type { JwtPayload } from '@sinaur/shared-types';

const loginSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  password: z.string().min(8).optional(),
  otpCode: z.string().length(6).optional(),
}).refine((d) => d.email || d.phone, { message: 'email ou phone requis' });

const requestOtpSchema = z.object({ phone: z.string().min(9) });
const refreshSchema = z.object({ refreshToken: z.string() });

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /auth/request-otp — demande un OTP par SMS
  fastify.post('/auth/request-otp', async (request, reply) => {
    const { phone } = requestOtpSchema.parse(request.body);
    const code = await createOtp(phone);

    // En production : envoyer via service SMS (services/alerting)
    // En développement : retourner le code (JAMAIS en prod !)
    if (fastify.config.NODE_ENV === 'development') {
      return reply.send({ success: true, data: { debug_code: code } });
    }

    // TODO: appeler le service SMS
    return reply.send({ success: true, data: { message: 'OTP envoyé par SMS' } });
  });

  // POST /auth/login — connexion par email+password ou phone+OTP
  fastify.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);

    let user: { id: string; role: string; geographicScopePcodes: string[]; passwordHash: string | null; isActive: boolean } | undefined;

    if (body.email) {
      [user] = await sql`
        SELECT id, role, geographic_scope_pcodes, password_hash, is_active
        FROM users WHERE email = ${body.email} AND deleted_at IS NULL
      `;
    } else if (body.phone) {
      [user] = await sql`
        SELECT id, role, geographic_scope_pcodes, password_hash, is_active
        FROM users WHERE phone = ${body.phone} AND deleted_at IS NULL
      `;
    }

    if (!user || !user.isActive) {
      return reply.status(401).send({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Identifiants incorrects' } });
    }

    // Auth par OTP (phone)
    if (body.phone && body.otpCode) {
      const valid = await verifyOtp(body.phone, body.otpCode);
      if (!valid) {
        return reply.status(401).send({ success: false, error: { code: 'INVALID_OTP', message: 'Code OTP invalide ou expiré' } });
      }
    }
    // Auth par mot de passe (email)
    else if (body.email && body.password && user.passwordHash) {
      const valid = await bcrypt.compare(body.password, user.passwordHash);
      if (!valid) {
        return reply.status(401).send({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Identifiants incorrects' } });
      }
    } else {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'Méthode d\'authentification invalide' } });
    }

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      role: user.role as JwtPayload['role'],
      scope: user.geographicScopePcodes,
    };

    const accessToken = fastify.jwt.sign(payload, { expiresIn: '15m' });
    const refreshToken = fastify.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresIn: '7d' });

    await sql`
      UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}
    `;

    await writeAuditLog(user.id, 'LOGIN', 'users', user.id, request);

    return reply.send({ success: true, data: { accessToken, refreshToken, expiresIn: 900 } });
  });

  // POST /auth/refresh
  fastify.post('/auth/refresh', async (request, reply) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    try {
      const decoded = fastify.jwt.verify(refreshToken) as { sub: string; type: string };
      if (decoded.type !== 'refresh') throw new Error('Not a refresh token');

      const [user] = await sql`
        SELECT id, role, geographic_scope_pcodes, is_active
        FROM users WHERE id = ${decoded.sub} AND deleted_at IS NULL
      `;

      if (!user || !user.isActive) {
        return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Compte désactivé' } });
      }

      const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
        sub: user.id,
        role: user.role as JwtPayload['role'],
        scope: user.geographicScopePcodes,
      };

      const newAccessToken = fastify.jwt.sign(payload, { expiresIn: '15m' });
      return reply.send({ success: true, data: { accessToken: newAccessToken, expiresIn: 900 } });
    } catch {
      return reply.status(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Token de rafraîchissement invalide' } });
    }
  });
}

// Augmentation du type Fastify pour accéder à config
declare module 'fastify' {
  interface FastifyInstance {
    config: import('../config.js').Config;
  }
}
