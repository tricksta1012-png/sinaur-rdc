import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../stores/auth.js';
import { apiClient } from '../lib/api.js';

export type FeedEvent =
  | { type: 'NEW_EVENT';      payload: { id: string; hazardType: string; severity: string; locationPcode: string; title: string; createdAt: string } }
  | { type: 'EVENT_UPDATED';  payload: { id: string; status: string } }
  | { type: 'NEW_ALERT';      payload: { identifier: string; headline: string; severity: string; urgency: string; areaPcode: string } }
  | { type: 'CRISIS_CREATED'; payload: { id: string; glideNumber: string; title: string; hazardType: string } }
  | { type: 'CRISIS_UPDATED'; payload: { id: string; status: string; title: string } }
  | { type: 'TASK_CREATED';   payload: { crisisId: string; task: unknown } }
  | { type: 'TASK_UPDATED';   payload: { id: string; status: string; crisisEventId: string } }
  | { type: 'CONNECTED';      payload: { message: string } }

const MAX_FEED_ITEMS = 100

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000 < Date.now() + 30_000; // 30s buffer
  } catch {
    return true;
  }
}

async function tryRefreshToken(): Promise<string | null> {
  const { tokens, logout } = useAuthStore.getState();
  if (!tokens?.refreshToken) return null;
  try {
    const { data } = await apiClient.post<{ success: boolean; data: { accessToken: string } }>(
      '/auth/refresh',
      { refreshToken: tokens.refreshToken },
    );
    const newTokens = { ...tokens, accessToken: data.data.accessToken };
    apiClient.defaults.headers.common['Authorization'] = `Bearer ${newTokens.accessToken}`;
    useAuthStore.setState({ tokens: newTokens });
    return newTokens.accessToken;
  } catch {
    logout();
    window.location.href = '/login';
    return null;
  }
}

function buildWsUrl(token: string): string {
  // Connect directly to the API if VITE_API_BASE_URL is set (bypasses nginx proxy + timeout)
  const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const wsBase = apiBase
    ? apiBase.replace(/^http/, 'ws').replace(/\/$/, '')
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  return `${wsBase}/ws?token=${encodeURIComponent(token)}`;
}

export function useRealtimeFeed() {
  const [events, setEvents] = useState<(FeedEvent & { receivedAt: string })[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef        = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCount   = useRef(0)
  const mountedRef   = useRef(true)
  const tokens = useAuthStore(s => s.tokens)

  // Chargement HTTP initial : évite que le panneau reste vide en attendant un message WebSocket
  useEffect(() => {
    if (!tokens?.accessToken) return
    apiClient
      .get('/events?limit=30')
      .then(r => {
        const rows: any[] = r.data?.data ?? []
        if (!rows.length) return
        const initial: (FeedEvent & { receivedAt: string })[] = rows.map(ev => ({
          type: 'NEW_EVENT' as const,
          payload: {
            id:            String(ev.id ?? ''),
            hazardType:    String(ev.hazardType ?? 'other'),
            severity:      String(ev.severity ?? 'Unknown'),
            locationPcode: String(ev.locationPcode ?? ''),
            title:         String(ev.title ?? `${ev.hazardType ?? 'Événement'} — ${ev.locationPcode ?? ''}`),
            createdAt:     String(ev.startDate ?? ev.createdAt ?? new Date().toISOString()),
          },
          receivedAt: String(ev.startDate ?? ev.createdAt ?? new Date().toISOString()),
        }))
        setEvents(prev => prev.length > 0 ? prev : initial.slice(0, MAX_FEED_ITEMS))
      })
      .catch(() => {})
  }, [tokens?.accessToken])

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) return

    let token = tokens?.accessToken ?? ''

    if (token && isTokenExpired(token)) {
      const refreshed = await tryRefreshToken()
      if (!refreshed) return
      token = refreshed
    }

    const ws = new WebSocket(buildWsUrl(token))
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      retryCount.current = 0
      // Heartbeat toutes les 25s pour éviter la fermeture Railway (idle ~60s)
      const ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'PING' }))
        }
      }, 25_000)
      ws.addEventListener('close', () => clearInterval(ping), { once: true })
    }

    ws.onclose = () => {
      setConnected(false)
      if (!mountedRef.current) return
      // Backoff exponentiel : 2s, 4s, 8s … plafonné à 30s
      const delay = Math.min(2_000 * Math.pow(2, retryCount.current), 30_000)
      retryCount.current += 1
      // connectRef.current assure qu'on appelle toujours la version la plus récente
      reconnectRef.current = setTimeout(() => connectRef.current(), delay)
    }

    ws.onerror = () => ws.close()

    ws.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data) as { type: string }
        if (raw.type === 'CONNECTED' || raw.type === 'PONG') return
        const msg = raw as FeedEvent
        setEvents(prev => [
          { ...msg, receivedAt: new Date().toISOString() },
          ...prev.slice(0, MAX_FEED_ITEMS - 1),
        ])
      } catch {}
    }
  }, [tokens?.accessToken])

  // Ref toujours à jour — évite le stale closure dans onclose
  const connectRef = useRef(connect)
  useEffect(() => { connectRef.current = connect }, [connect])

  useEffect(() => {
    mountedRef.current = true
    if (tokens) connect()
    return () => {
      mountedRef.current = false
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [connect, tokens])

  const clearFeed = () => setEvents([])

  // Reconnexion manuelle (bouton dans l'UI)
  const reconnect = useCallback(() => {
    if (reconnectRef.current) clearTimeout(reconnectRef.current)
    wsRef.current?.close()
    wsRef.current = null
    retryCount.current = 0
    connect()
  }, [connect])

  return { events, connected, clearFeed, reconnect }
}
