import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { JwtPayload } from '../types';
import jwt from 'jsonwebtoken';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;

/** ticketId → набор подключённых клиентов */
const roomMap = new Map<string, Set<WebSocket>>();

export function initWebSocket(server: http.Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    let userId: string | null = null;
    let ticketId: string | null = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; token?: string; ticket_id?: string };

        if (msg.type === 'auth') {
          if (!msg.token) { ws.close(4001, 'No token'); return; }
          try {
            const payload = jwt.verify(msg.token, ACCESS_SECRET) as JwtPayload;
            userId = payload.sub;
            ws.send(JSON.stringify({ type: 'auth.ok', user_id: userId }));
          } catch {
            ws.close(4001, 'Invalid token');
          }
          return;
        }

        if (msg.type === 'subscribe' && msg.ticket_id) {
          if (!userId) { ws.close(4003, 'Not authenticated'); return; }
          ticketId = msg.ticket_id;
          if (!roomMap.has(ticketId)) roomMap.set(ticketId, new Set());
          roomMap.get(ticketId)!.add(ws);
          ws.send(JSON.stringify({ type: 'subscribed', ticket_id: ticketId }));
          return;
        }

        if (msg.type === 'unsubscribe' && ticketId) {
          roomMap.get(ticketId)?.delete(ws);
          ticketId = null;
          return;
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      if (ticketId) roomMap.get(ticketId)?.delete(ws);
    });

    // Ping/pong keepalive
    ws.on('pong', () => { (ws as WebSocket & { isAlive?: boolean }).isAlive = true; });
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
  });

  // Keepalive interval
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const w = ws as WebSocket & { isAlive?: boolean };
      if (w.isAlive === false) { w.terminate(); return; }
      w.isAlive = false;
      w.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));
  console.log('🔌  WebSocket server initialised');
}

/** Отправляет сообщение всем подписчикам обращения */
export function broadcastToTicket(ticketId: string, data: unknown): void {
  const clients = roomMap.get(ticketId);
  if (!clients || clients.size === 0) return;
  const payload = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

/** Широковещательная рассылка (для обновлений списка) */
export function broadcastAll(data: unknown): void {
  const payload = JSON.stringify(data);
  for (const [, clients] of roomMap) {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }
}
