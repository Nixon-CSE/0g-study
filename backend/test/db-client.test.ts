import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, type TestDb } from './helpers/db.js';

describe('test db helper', () => {
  let tdb: TestDb;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('exposes a working db handle', async () => {
    await tdb.db.collection('ping').insertOne({ x: 1 });
    const doc = await tdb.db.collection('ping').findOne({ x: 1 });
    expect(doc?.x).toBe(1);
  });
});
