/**
 * Thin REST wrapper around the Daily.co v1 API.
 * Uses global `fetch` (Node 20+) — no extra deps needed.
 */

export interface DailyRoom {
  name: string;
  url: string;
  expiresAtUnix: number;
}

export interface DailyClient {
  createRoom(opts: { expSeconds: number; maxParticipants?: number }): Promise<DailyRoom>;
  deleteRoom(name: string): Promise<void>;
  mintMeetingToken(opts: {
    roomName: string;
    userName: string;
    isOwner?: boolean;
    expSeconds: number;
  }): Promise<string>;
}

const DAILY_BASE = 'https://api.daily.co/v1';

export function createDailyClient(): DailyClient {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) throw new Error('DAILY_API_KEY is not set');

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${DAILY_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Daily API ${method} ${path} → ${res.status}: ${text}`);
    }

    // 204 or empty body
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  return {
    async createRoom({ expSeconds, maxParticipants }) {
      const exp = Math.floor(Date.now() / 1000) + expSeconds;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await request<any>('POST', '/rooms', {
        properties: {
          exp,
          ...(maxParticipants !== undefined ? { max_participants: maxParticipants } : {}),
        },
      });
      return {
        name: data.name as string,
        url: data.url as string,
        expiresAtUnix: exp,
      };
    },

    async deleteRoom(name: string) {
      try {
        await request<void>('DELETE', `/rooms/${encodeURIComponent(name)}`);
      } catch (e: unknown) {
        // Tolerate 404 — room already gone
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('404')) return;
        throw e;
      }
    },

    async mintMeetingToken({ roomName, userName, isOwner = false, expSeconds }) {
      const exp = Math.floor(Date.now() / 1000) + expSeconds;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await request<any>('POST', '/meeting-tokens', {
        properties: {
          room_name: roomName,
          user_name: userName,
          is_owner: isOwner,
          exp,
        },
      });
      return data.token as string;
    },
  };
}
