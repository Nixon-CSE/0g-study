import fs from 'node:fs/promises';
import path from 'node:path';

export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const UPLOAD_ID = /^[a-f0-9-]{8,64}$/;

export interface Card { q: string; a: string }
export interface StudySet { topic: string; cards: Card[] }

export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID.test(id);
}

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function userDir(agentDir: string, userId: string): string {
  if (!isSafeId(userId)) throw new Error('invalid user id');
  return path.join(agentDir, 'study', userId);
}

/** Append a study set to study/<userId>/<YYYY-MM-DD>.json (UTC day). */
export async function logStudySet(
  agentDir: string, userId: string, set: StudySet, now: Date = new Date(),
): Promise<{ day: string; savedCards: number }> {
  const dir = userDir(agentDir, userId);
  await fs.mkdir(dir, { recursive: true });
  const day = dayKey(now);
  const file = path.join(dir, `${day}.json`);
  let cur: StudySet[] = [];
  try { cur = JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* new day or corrupt: start fresh */ }
  cur.push(set);
  await fs.writeFile(file, JSON.stringify(cur, null, 2));
  return { day, savedCards: set.cards.length };
}

/**
 * Streak = consecutive UTC days ending today with >=1 card. If today has none yet,
 * count back from yesterday without breaking the streak.
 */
export function computeStreak(cardsByDay: Record<string, number>, now: Date = new Date()): number {
  const cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!cardsByDay[dayKey(cur)]) cur.setUTCDate(cur.getUTCDate() - 1);
  let streak = 0;
  while (cardsByDay[dayKey(cur)]) { streak++; cur.setUTCDate(cur.getUTCDate() - 1); }
  return streak;
}

export async function studyStats(
  agentDir: string, userId: string, now: Date = new Date(),
): Promise<{ streak: number; today: number; totalCards: number }> {
  const dir = userDir(agentDir, userId);
  const days: Record<string, number> = {};
  let files: string[] = [];
  try { files = await fs.readdir(dir); } catch { /* no data yet */ }
  for (const f of files) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    try {
      const sets = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as StudySet[];
      days[m[1]] = sets.reduce((n, s) => n + (s.cards?.length ?? 0), 0);
    } catch { /* skip corrupt file */ }
  }
  return {
    streak: computeStreak(days, now),
    today: days[dayKey(now)] ?? 0,
    totalCards: Object.values(days).reduce((a, b) => a + b, 0),
  };
}
