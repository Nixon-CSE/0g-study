import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';

let server: MongoMemoryServer | null = null;
let client: MongoClient | null = null;

export interface TestDb { db: Db; uri: string; }

export async function startTestDb(): Promise<TestDb> {
  server = await MongoMemoryServer.create();
  const uri = server.getUri();
  client = new MongoClient(uri);
  await client.connect();
  return { db: client.db('bonfire-test'), uri };
}

export async function stopTestDb(): Promise<void> {
  await client?.close();
  await server?.stop();
  client = null;
  server = null;
}

export async function cleanCollections(db: Db): Promise<void> {
  const cols = await db.collections();
  await Promise.all(cols.map(c => c.deleteMany({})));
}
