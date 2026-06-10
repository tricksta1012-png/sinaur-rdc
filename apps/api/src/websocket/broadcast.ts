import type { WebSocket } from 'ws';

type WsEvent =
  | { type: 'NEW_EVENT'; payload: unknown }
  | { type: 'EVENT_UPDATED'; payload: unknown }
  | { type: 'NEW_ALERT'; payload: unknown }
  | { type: 'STATS_UPDATE'; payload: unknown };

// Registry des connexions WebSocket actives par périmètre géographique
const clients = new Map<WebSocket, { scope: string[] }>();

export function registerClient(ws: WebSocket, scope: string[] = []): void {
  clients.set(ws, { scope });
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
}

export function broadcast(event: WsEvent, targetPcodes?: string[]): void {
  const message = JSON.stringify(event);
  for (const [ws, meta] of clients) {
    if (ws.readyState !== 1) { clients.delete(ws); continue; }

    if (targetPcodes && targetPcodes.length > 0 && meta.scope.length > 0) {
      const inScope = targetPcodes.some((p) =>
        meta.scope.some((s) => p.startsWith(s) || s.startsWith(p)),
      );
      if (!inScope) continue;
    }

    ws.send(message);
  }
}

export function broadcastNewEvent(event: unknown, affectedPcodes: string[]): void {
  broadcast({ type: 'NEW_EVENT', payload: event }, affectedPcodes);
}

export function broadcastAlert(alert: unknown, targetPcodes: string[] = []): void {
  broadcast({ type: 'NEW_ALERT', payload: alert }, targetPcodes);
}

export function getConnectedCount(): number {
  return clients.size;
}
