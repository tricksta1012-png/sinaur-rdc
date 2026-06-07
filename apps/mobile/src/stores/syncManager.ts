/**
 * Gestionnaire de file de synchronisation unifié — SINAUR-RDC Mobile.
 *
 * Remplace les queues séparées (events, beneficiaries, receipts) par un
 * gestionnaire unique avec priorité, retry exponentiel et résolution de conflits.
 *
 * Types d'éléments :
 *   - event       → POST /events
 *   - beneficiary → POST /beneficiaries
 *   - receipt     → POST /distributions/:id/receipts
 *
 * Stratégie retry : max 5 tentatives, backoff 1m/2m/4m/8m/16m
 * Conflits 409 : marqués 'duplicate' (pas une erreur, non-retried)
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { apiClient } from '../lib/api.js'

export type QueueItemType = 'event' | 'beneficiary' | 'receipt'
export type QueueItemStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'duplicate'

export interface QueueItem {
  id: string
  type: QueueItemType
  endpoint: string
  method: 'POST' | 'PATCH'
  payload: Record<string, unknown>
  status: QueueItemStatus
  priority: number        // 0 = normal, 1 = high (ex: severity Extreme)
  attempts: number
  enqueuedAt: string      // ISO8601
  lastAttemptAt?: string
  lastError?: string
}

const QUEUE_KEY = 'sinaur_sync_queue_v2'
const MAX_ATTEMPTS = 5

// Backoff en millisecondes : 1m, 2m, 4m, 8m, 16m
function backoffMs(attempt: number): number {
  return Math.min(Math.pow(2, attempt) * 60_000, 16 * 60_000)
}

export async function loadQueue(): Promise<QueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    return raw ? (JSON.parse(raw) as QueueItem[]) : []
  } catch {
    return []
  }
}

async function saveQueue(queue: QueueItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ── Enqueue functions ──────────────────────────────────────────────────────

export async function enqueueEvent(
  payload: Record<string, unknown>,
  priority = 0,
): Promise<string> {
  const item: QueueItem = {
    id: makeId(),
    type: 'event',
    endpoint: '/events',
    method: 'POST',
    payload: { ...payload, clientCreatedAt: payload.clientCreatedAt ?? new Date().toISOString() },
    status: 'pending',
    priority,
    attempts: 0,
    enqueuedAt: new Date().toISOString(),
  }
  const q = await loadQueue()
  await saveQueue([...q, item])
  return item.id
}

export async function enqueueBeneficiary(
  payload: Record<string, unknown>,
): Promise<string> {
  const item: QueueItem = {
    id: makeId(),
    type: 'beneficiary',
    endpoint: '/beneficiaries',
    method: 'POST',
    payload: { ...payload, clientCreatedAt: payload.clientCreatedAt ?? new Date().toISOString() },
    status: 'pending',
    priority: 0,
    attempts: 0,
    enqueuedAt: new Date().toISOString(),
  }
  const q = await loadQueue()
  await saveQueue([...q, item])
  return item.id
}

export async function enqueueReceipt(
  distributionId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const item: QueueItem = {
    id: makeId(),
    type: 'receipt',
    endpoint: `/distributions/${distributionId}/receipts`,
    method: 'POST',
    payload: { ...payload, clientCreatedAt: payload.clientCreatedAt ?? new Date().toISOString() },
    status: 'pending',
    priority: 1, // receipts ont priorité haute (impact direct sur distribution)
    attempts: 0,
    enqueuedAt: new Date().toISOString(),
  }
  const q = await loadQueue()
  await saveQueue([...q, item])
  return item.id
}

// ── Sync engine ───────────────────────────────────────────────────────────

export interface SyncResult {
  synced: number
  duplicates: number
  failed: number
  remaining: number
}

export async function syncAll(
  onProgress?: (done: number, total: number) => void,
): Promise<SyncResult> {
  const queue = await loadQueue()
  const eligible = queue
    .filter(item => {
      if (item.status === 'synced' || item.status === 'duplicate') return false
      if (item.status === 'failed' && item.attempts >= MAX_ATTEMPTS) return false
      // Backoff check
      if (item.lastAttemptAt && item.attempts > 0) {
        const wait = backoffMs(item.attempts)
        const elapsed = Date.now() - new Date(item.lastAttemptAt).getTime()
        if (elapsed < wait) return false
      }
      return true
    })
    .sort((a, b) => b.priority - a.priority) // haute priorité en premier

  if (eligible.length === 0) return { synced: 0, duplicates: 0, failed: 0, remaining: queue.filter(i => i.status === 'pending').length }

  let synced = 0
  let duplicates = 0
  let failed = 0

  // Traitement par lot de 5
  const BATCH = 5
  for (let i = 0; i < eligible.length; i += BATCH) {
    const batch = eligible.slice(i, i + BATCH)
    await Promise.allSettled(
      batch.map(async (item) => {
        const now = new Date().toISOString()
        try {
          await apiClient({
            method: item.method,
            url: item.endpoint,
            data: item.payload,
          })
          item.status = 'synced'
          item.lastAttemptAt = now
          synced++
        } catch (e: any) {
          item.lastAttemptAt = now
          item.attempts++
          const status = e?.response?.status
          const code = e?.response?.data?.error?.code

          if (status === 409) {
            // Doublon → succès sémantique, ne pas retenter
            item.status = 'duplicate'
            item.lastError = code ?? 'duplicate'
            duplicates++
          } else if (item.attempts >= MAX_ATTEMPTS) {
            item.status = 'failed'
            item.lastError = e?.response?.data?.error?.message ?? e?.message ?? 'unknown'
            failed++
          } else {
            item.status = 'pending'
            item.lastError = e?.response?.data?.error?.message ?? e?.message ?? 'unknown'
            failed++
          }
        }
      }),
    )
    onProgress?.(Math.min(i + BATCH, eligible.length), eligible.length)
  }

  // Mettre à jour la queue en mémoire
  const updatedMap = new Map(eligible.map(i => [i.id, i]))
  const updatedQueue = queue.map(i => updatedMap.get(i.id) ?? i)

  // Purger les éléments synced/duplicate vieux de plus de 7 jours
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const pruned = updatedQueue.filter(i => {
    if (i.status !== 'synced' && i.status !== 'duplicate') return true
    return new Date(i.enqueuedAt).getTime() > cutoff
  })

  await saveQueue(pruned)

  const remaining = pruned.filter(i => i.status === 'pending').length

  return { synced, duplicates, failed, remaining }
}

export async function getQueueStats(): Promise<{
  pending: number
  failed: number
  synced: number
  byType: Record<QueueItemType, number>
}> {
  const queue = await loadQueue()
  return {
    pending: queue.filter(i => i.status === 'pending').length,
    failed: queue.filter(i => i.status === 'failed' && i.attempts >= MAX_ATTEMPTS).length,
    synced: queue.filter(i => i.status === 'synced').length,
    byType: {
      event: queue.filter(i => i.type === 'event' && i.status === 'pending').length,
      beneficiary: queue.filter(i => i.type === 'beneficiary' && i.status === 'pending').length,
      receipt: queue.filter(i => i.type === 'receipt' && i.status === 'pending').length,
    },
  }
}

export async function retryFailed(): Promise<void> {
  const queue = await loadQueue()
  const reset = queue.map(i => {
    if (i.status === 'failed') {
      return { ...i, status: 'pending' as QueueItemStatus, attempts: 0, lastError: undefined }
    }
    return i
  })
  await saveQueue(reset)
}

export async function clearSynced(): Promise<void> {
  const queue = await loadQueue()
  await saveQueue(queue.filter(i => i.status !== 'synced' && i.status !== 'duplicate'))
}
