import { vi } from 'vitest'

// Mock the audit log to avoid DB writes in most tests
vi.mock('../auth/jwt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/jwt.js')>()
  return {
    ...actual,
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
  }
})

// Mock security event logger (fire-and-forget, no DB needed in tests)
vi.mock('../auth/security.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/security.js')>()
  return {
    ...actual,
    logSecurityEvent: vi.fn(),
  }
})
