/**
 * WebRTC signaling server — WebSocket-based, same HTTP port as the API.
 * Path: ws://host:PORT/voice
 *
 * Messages (JSON):
 *   client→server: join | offer | answer | ice | leave
 *   server→client: peers | joined | offer | answer | ice | left
 */

import type { Server as HttpServer } from 'http';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ws: any = _require('ws');
const WsServer: new (opts: { server: HttpServer; path: string }) => WsServerInstance = ws.Server ?? ws.WebSocketServer;
const OPEN: number = ws.OPEN ?? 1;

interface WsSocket {
  readyState: number;
  send(data: string): void;
  on(event: 'message', cb: (raw: Buffer) => void): this;
  on(event: 'close' | 'error', cb: () => void): this;
}

interface WsServerInstance {
  on(event: 'connection', cb: (socket: WsSocket) => void): this;
}

// ── Room state ───────────────────────────────────────────────────────────────

interface Peer {
  ws: WsSocket;
  userId: string;
  userName: string;
}

const rooms = new Map<string, Map<string, Peer>>();

function getRoom(id: string) {
  if (!rooms.has(id)) rooms.set(id, new Map());
  return rooms.get(id)!;
}

function sendTo(sock: WsSocket, data: object) {
  if (sock.readyState === OPEN) sock.send(JSON.stringify(data));
}

function broadcastRoom(room: Map<string, Peer>, data: object, exclude?: string) {
  for (const [uid, peer] of room) {
    if (uid !== exclude) sendTo(peer.ws, data);
  }
}

// ── Attach to existing HTTP server ───────────────────────────────────────────

export function attachSignalingServer(httpServer: HttpServer) {
  const server: WsServerInstance = new WsServer({ server: httpServer, path: '/voice' });

  server.on('connection', (sock: WsSocket) => {
    let curChannel: string | null = null;
    let curUserId:  string | null = null;

    const cleanup = () => {
      if (!curChannel || !curUserId) return;
      const room = rooms.get(curChannel);
      if (room) {
        room.delete(curUserId);
        broadcastRoom(room, { type: 'left', userId: curUserId });
        if (room.size === 0) rooms.delete(curChannel);
      }
      curChannel = null;
      curUserId  = null;
    };

    sock.on('message', (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      const { type } = msg as { type: string };

      if (type === 'join') {
        const channelId = msg.channelId as string;
        const userId    = msg.userId    as string;
        const userName  = (msg.userName as string) || userId;

        // Leave previous room first
        cleanup();

        curChannel = channelId;
        curUserId  = userId;

        const room  = getRoom(channelId);
        const peers = [...room.values()].map(p => ({ userId: p.userId, userName: p.userName }));
        sendTo(sock, { type: 'peers', peers });
        broadcastRoom(room, { type: 'joined', userId, userName });
        room.set(userId, { ws: sock, userId, userName });
        return;
      }

      if (type === 'offer' || type === 'answer' || type === 'ice') {
        const channelId = (msg.channelId as string | undefined) ?? curChannel;
        const to        = msg.to as string;
        const room      = channelId ? rooms.get(channelId) : undefined;
        const target    = room?.get(to);
        if (target) {
          sendTo(target.ws, {
            type,
            from:      msg.from ?? curUserId,
            sdp:       msg.sdp,
            candidate: msg.candidate,
          });
        }
        return;
      }

      if (type === 'leave') cleanup();
    });

    sock.on('close', cleanup);
    sock.on('error', cleanup);
  });
}
