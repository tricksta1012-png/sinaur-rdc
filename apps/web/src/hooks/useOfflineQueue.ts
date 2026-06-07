import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../lib/api.js';

interface QueuedReport {
  id: string;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
}

const STORAGE_KEY = 'sinaur_offline_queue';

function loadQueue(): QueuedReport[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as QueuedReport[];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedReport[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function useOfflineQueue() {
  const [queue, setQueue] = useState<QueuedReport[]>(loadQueue);
  const [syncing, setSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  const enqueue = useCallback((payload: Record<string, unknown>) => {
    const item: QueuedReport = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      payload: { ...payload, clientCreatedAt: new Date().toISOString() },
      createdAt: Date.now(),
      attempts: 0,
    };
    setQueue((prev) => {
      const next = [...prev, item];
      saveQueue(next);
      return next;
    });
    return item.id;
  }, []);

  const syncNow = useCallback(async () => {
    const current = loadQueue();
    if (current.length === 0 || syncing) return;
    setSyncing(true);

    const remaining: QueuedReport[] = [];
    for (const item of current) {
      try {
        await apiClient.post('/events', item.payload);
        // Succès : ne pas remettre dans la queue
      } catch (err: any) {
        if (err?.response?.status === 409) continue; // Doublon détecté par le serveur — ignorer
        remaining.push({ ...item, attempts: item.attempts + 1 });
      }
    }

    setQueue(remaining);
    saveQueue(remaining);
    setSyncing(false);
  }, [syncing]);

  // Sync automatique dès que la connexion revient
  useEffect(() => {
    if (isOnline && queue.length > 0) {
      void syncNow();
    }
  }, [isOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  return { queue, enqueue, syncNow, syncing, isOnline, pendingCount: queue.length };
}
