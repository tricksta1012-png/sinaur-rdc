import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../stores/auth.js';

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

export function useRealtimeFeed() {
  const [events, setEvents] = useState<(FeedEvent & { receivedAt: string })[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const tokens = useAuthStore(s => s.tokens)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const token = tokens?.accessToken ?? ''
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`)

    ws.onopen  = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      setTimeout(connect, 5000) // reconnect
    }
    ws.onerror = () => ws.close()
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as FeedEvent
        if (msg.type === 'CONNECTED') return
        setEvents(prev => [
          { ...msg, receivedAt: new Date().toISOString() },
          ...prev.slice(0, MAX_FEED_ITEMS - 1),
        ])
      } catch {}
    }

    wsRef.current = ws
  }, [tokens?.accessToken])

  useEffect(() => {
    if (tokens) connect()
    return () => wsRef.current?.close()
  }, [connect, tokens])

  const clearFeed = () => setEvents([])

  return { events, connected, clearFeed }
}
