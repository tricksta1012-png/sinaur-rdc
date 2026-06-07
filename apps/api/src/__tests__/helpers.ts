import jwt from 'jsonwebtoken'
import type { JwtPayload, UserRole } from '@sinaur/shared-types'

const TEST_SECRET = 'test_secret_min_32_characters_long_ok'

export function signToken(payload: Partial<JwtPayload> & { role: UserRole }): string {
  const defaults: JwtPayload = {
    sub:   payload.sub  ?? 'test-user-id',
    email: payload.email ?? 'test@sinaur-rdc.cd',
    role:  payload.role,
    scope: payload.scope ?? [],
    iat:   Math.floor(Date.now() / 1000),
    exp:   Math.floor(Date.now() / 1000) + 900,
  }
  return jwt.sign({ ...defaults, ...payload }, TEST_SECRET)
}

export const adminToken   = () => signToken({ role: 'system_admin' })
export const agentToken   = () => signToken({ role: 'field_agent', scope: ['CD-NK'] })
export const deciderToken = () => signToken({ role: 'national_decision_maker' })
export const govToken     = (scope: string[] = ['CD-KN']) =>
  signToken({ role: 'territory_admin', scope })

export function authHeader(token: string) {
  return { authorization: `Bearer ${token}` }
}
