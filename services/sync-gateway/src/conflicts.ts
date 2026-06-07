/**
 * Résolution de conflits de synchronisation.
 * Stratégie : server-wins sur les conflits de version, log pour review humaine.
 */
import type { Sql } from 'postgres'
import type { Logger } from 'pino'

export type SyncItemStatus = 'synced' | 'duplicate' | 'conflict' | 'error'

export interface SyncItem {
  id: string        // ID local (UUID mobile)
  type: 'event' | 'beneficiary' | 'receipt'
  method: 'POST' | 'PATCH'
  endpoint: string
  payload: Record<string, unknown>
  clientCreatedAt?: string
}

export interface SyncResult {
  id: string
  status: SyncItemStatus
  serverId?: string
  error?: string
}

export async function logConflict(
  sql: Sql,
  deviceId: string,
  conflictType: string,
  resourceType: string,
  clientPayload: unknown,
  serverRecord?: unknown,
): Promise<void> {
  await sql`
    INSERT INTO sync_conflicts (device_id, conflict_type, resource_type, client_payload, server_record)
    VALUES (${deviceId}, ${conflictType}, ${resourceType}, ${JSON.stringify(clientPayload)}, ${serverRecord ? JSON.stringify(serverRecord) : null})
  `.catch(() => {}) // Non-bloquant
}

export function classifyAxiosError(err: unknown, item: SyncItem): SyncResult {
  const status = (err as any)?.response?.status
  const code   = (err as any)?.response?.data?.error?.code

  if (status === 409 || code === 'DUPLICATE') {
    return { id: item.id, status: 'duplicate', serverId: (err as any)?.response?.data?.data?.id }
  }

  if (status === 400 || status === 422) {
    return { id: item.id, status: 'conflict', error: (err as any)?.response?.data?.error?.message ?? 'Validation error' }
  }

  return { id: item.id, status: 'error', error: String((err as any)?.message ?? 'Unknown error') }
}
