// Dev-only MongoDB. Binds an in-process MongoMemoryServer to a fixed port.
// Data is wiped on exit. Kill with SIGINT/SIGTERM for clean shutdown.
import { MongoMemoryServer } from 'mongodb-memory-server';

const port = Number(process.env.MONGO_DEV_PORT ?? 27017);
const server = await MongoMemoryServer.create({ instance: { port, dbName: 'bonfire' } });
console.log(JSON.stringify({ uri: server.getUri(), port, pid: process.pid }));

const stop = async () => {
  try { await server.stop(); } catch {}
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

setInterval(() => {}, 1 << 30);
