import { describe, it, expect } from 'vitest'
import { classifyAxiosError } from '../conflicts.js'
import type { SyncItem } from '../conflicts.js'

const item: SyncItem = {
  id: 'local-abc-123',
  type: 'event',
  method: 'POST',
  endpoint: '/events',
  payload: { title: 'Test' },
}

function makeAxiosError(status: number, data?: unknown): unknown {
  return {
    response: {
      status,
      data: data ?? {},
    },
    message: `Request failed with status code ${status}`,
  }
}

describe('classifyAxiosError', () => {
  it('classifie 409 comme duplicate', () => {
    const result = classifyAxiosError(makeAxiosError(409), item)
    expect(result.id).toBe('local-abc-123')
    expect(result.status).toBe('duplicate')
  })

  it('classifie 409 et extrait le serverId si présent', () => {
    const result = classifyAxiosError(
      makeAxiosError(409, { data: { id: 'server-id-999' } }),
      item,
    )
    expect(result.status).toBe('duplicate')
    expect(result.serverId).toBe('server-id-999')
  })

  it('classifie code DUPLICATE comme duplicate', () => {
    const result = classifyAxiosError(
      makeAxiosError(200, { error: { code: 'DUPLICATE' } }),
      item,
    )
    expect(result.status).toBe('duplicate')
  })

  it('classifie 400 comme conflict', () => {
    const result = classifyAxiosError(
      makeAxiosError(400, { error: { message: 'Validation failed' } }),
      item,
    )
    expect(result.status).toBe('conflict')
    expect(result.error).toBe('Validation failed')
  })

  it('classifie 422 comme conflict', () => {
    const result = classifyAxiosError(makeAxiosError(422), item)
    expect(result.status).toBe('conflict')
    expect(result.error).toBe('Validation error')
  })

  it('classifie 500 comme error', () => {
    const result = classifyAxiosError(makeAxiosError(500), item)
    expect(result.status).toBe('error')
    expect(result.id).toBe('local-abc-123')
  })

  it('classifie les erreurs réseau (pas de response) comme error', () => {
    const networkError = { message: 'Network Error' }
    const result = classifyAxiosError(networkError, item)
    expect(result.status).toBe('error')
    expect(result.error).toContain('Network Error')
  })

  it('gère les erreurs inconnues sans planter', () => {
    const result = classifyAxiosError(null, item)
    expect(result.status).toBe('error')
    expect(result.error).toBeDefined()
  })
})
