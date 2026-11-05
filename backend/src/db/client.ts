import { MongoClient, type Db } from 'mongodb';
import type { Env } from '../config/env.js';

export interface DbHandle { client: MongoClient; db: Db; close(): Promise<void>; }

export async function connectDb(env: Pick<Env, 'MONGODB_URI' | 'MONGODB_DB'>): Promise<DbHandle> {
  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  const db = client.db(env.MONGODB_DB);
  return { client, db, close: async () => { await client.close(); } };
}
