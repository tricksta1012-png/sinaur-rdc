import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '../stores/auth.js';

export type WsMessage =
  | { type: 'CONNECTED'; payload: { message: string } }
  | { type: 'NEW_EVENT'; payload: unknown }
  | { type: 'EVENT_UPDATED'; payload: unknown }
  | { type: 'NEW_ALERT'; payload: unknown }
  | { type: 'STATS_UPDATE'; payload: unknown };

type MessageHandler = (msg: WsMessage) => void;

const WS_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000')
  .replace(/^http/, 'ws') + '/ws';

export function useWebSocket(onMessage?: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const tokens = useAuthStore((s) => s.tokens);
  const retryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const url = tokens?.accessToken ? `${WS_URL}?token=${tokens.accessToken}` : WS_URL;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Reconnexion exponentielle (max 30s)
      const delay = Math.min(30_000, 1_000 * (2 ** Math.min(retryTimeout.current ? 5 : 0, 5)));
      retryTimeout.current = setTimeout(connect, delay);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage;
        setLastMessage(msg);
        onMessage?.(msg);
      } catch {}
    };
  }, [tokens?.accessToken, onMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (retryTimeout.current) clearTimeout(retryTimeout.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected, lastMessage };
}
