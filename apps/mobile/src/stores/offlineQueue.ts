import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../lib/api.js';

const QUEUE_KEY = 'sinaur_offline_queue';

interface QueuedReport {
  id: string;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
}

export async function loadQueue(): Promise<QueuedReport[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedReport[]) : [];
  } catch {
    return [];
  }
}

export async function saveQueue(queue: QueuedReport[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueueReport(payload: Record<string, unknown>): Promise<string> {
  const item: QueuedReport = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    payload: { ...payload, clientCreatedAt: new Date().toISOString() },
    createdAt: Date.now(),
    attempts: 0,
  };
  const queue = await loadQueue();
  await saveQueue([...queue, item]);
  return item.id;
}

export async function syncQueue(): Promise<{ synced: number; failed: number }> {
  const queue = await loadQueue();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  const remaining: QueuedReport[] = [];

  for (const item of queue) {
    try {
      await api.post('/events', item.payload);
      synced++;
    } catch (err: any) {
      if (err?.response?.status === 409) { synced++; continue; } // doublon → ignoré
      const updated = { ...item, attempts: item.attempts + 1 };
      if (updated.attempts < 5) remaining.push(updated);
      failed++;
    }
  }

  await saveQueue(remaining);
  return { synced, failed };
}

export async function getQueueCount(): Promise<number> {
  const q = await loadQueue();
  return q.length;
}
