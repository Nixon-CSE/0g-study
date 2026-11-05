import type { Db } from 'mongodb';
import { buildApp } from '../../src/api/server.js';
import { createIndexes } from '../../src/db/indexes.js';

export const TEST_JWT_SECRET = 'x'.repeat(32);

export async function makeApp(db: Db, overrides: { cascadeConfig?: { maxHops?: number; maxInvocationsPerRoot?: number } } = {}) {
  await createIndexes(db);
  return buildApp({
    db,
    jwtSecret: TEST_JWT_SECRET,
    jwtExpiresIn: '1h',
    cascadeConfig: overrides.cascadeConfig,
  });
}

export async function jsonReq(app: ReturnType<typeof buildApp>, method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.fetch(new Request(`http://test${path}`, init));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, res };
}
