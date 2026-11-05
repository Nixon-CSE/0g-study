import { Hono } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { requireUser } from '../../auth/middleware.js';
import { requireServerMember, type ServerBindings } from '../../servers/middleware.js';
import { collections, type ChannelDoc, type KnowledgeDocDoc } from '../../db/types.js';

const MAX_INLINE_BYTES = 256 * 1024;     // 256 KB for typed content
const MAX_UPLOAD_BYTES = 512 * 1024;     // 512 KB for file uploads
const ALLOWED_EXT = /\.(md|markdown|txt)$/i;
const ALLOWED_MIME = new Set(['text/markdown', 'text/plain', 'text/x-markdown', 'application/octet-stream']);

const CreateBody = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1),
});

function publicDoc(d: KnowledgeDocDoc) {
  return {
    id: d._id.toHexString(),
    serverId: d.serverId.toHexString(),
    channelId: d.channelId.toHexString(),
    title: d.title,
    source: d.source,
    filename: d.filename,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    createdBy: d.createdBy.toHexString(),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

async function getKnowledgeChannel(db: Db, serverId: ObjectId): Promise<ChannelDoc | null> {
  return await db
    .collection<ChannelDoc>(collections.channels)
    .findOne({ serverId, type: 'knowledge' });
}

export interface KnowledgeRouteDeps { db: Db; jwtSecret: string; }

export function knowledgeRoutes(deps: KnowledgeRouteDeps) {
  const app = new Hono<ServerBindings>();
  const requireAuth = requireUser(deps.db, deps.jwtSecret);

  // List documents for a server (members only).
  app.get(
    '/v1/servers/:sid/knowledge',
    requireAuth,
    requireServerMember(deps.db, 'member'),
    async (c) => {
      const server = c.get('server');
      const docs = await deps.db
        .collection<KnowledgeDocDoc>(collections.knowledgeDocs)
        .find({ serverId: server._id })
        .sort({ createdAt: -1 })
        .toArray();
      return c.json({ docs: docs.map(publicDoc) });
    }
  );

  // Text-indexed search. Returns title + snippet only (no full content) to keep
  // the response small; clients can fetch the full doc by id.
  // NOTE: must be registered BEFORE the `/:docId` route so 'search' doesn't get
  // captured as a doc id.
  app.get(
    '/v1/servers/:sid/knowledge/search',
    requireAuth,
    requireServerMember(deps.db, 'member'),
    async (c) => {
      const q = (c.req.query('q') || '').trim();
      const server = c.get('server');
      if (!q) return c.json({ results: [] });
      const limit = Math.min(parseInt(c.req.query('limit') || '5', 10) || 5, 20);
      // MongoDB's $text + $meta projections need permissive types — the
      // driver's Sort/Projection typings don't model $meta directly.
      const hits = await deps.db
        .collection<KnowledgeDocDoc>(collections.knowledgeDocs)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .find({ serverId: server._id, $text: { $search: q } } as any, {
          projection: { score: { $meta: 'textScore' } },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sort: { score: { $meta: 'textScore' } } as any,
        })
        .limit(limit)
        .toArray();
      const results = hits.map((d) => ({
        ...publicDoc(d as KnowledgeDocDoc),
        snippet: (d as KnowledgeDocDoc).content.slice(0, 400),
      }));
      return c.json({ results });
    }
  );

  // Get a single doc (full content). Members only.
  app.get(
    '/v1/servers/:sid/knowledge/:docId',
    requireAuth,
    requireServerMember(deps.db, 'member'),
    async (c) => {
      const did = c.req.param('docId');
      if (!did || !ObjectId.isValid(did)) return c.json({ error: 'invalid_doc_id' }, 400);
      const server = c.get('server');
      const doc = await deps.db
        .collection<KnowledgeDocDoc>(collections.knowledgeDocs)
        .findOne({ _id: new ObjectId(did), serverId: server._id });
      if (!doc) return c.json({ error: 'not_found' }, 404);
      return c.json({ doc: { ...publicDoc(doc), content: doc.content } });
    }
  );

  // Create from typed text. Any member can contribute.
  app.post(
    '/v1/servers/:sid/knowledge',
    requireAuth,
    requireServerMember(deps.db, 'member'),
    async (c) => {
      const parsed = CreateBody.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
      const { title, content } = parsed.data;
      const sizeBytes = Buffer.byteLength(content, 'utf8');
      if (sizeBytes > MAX_INLINE_BYTES) {
        return c.json({ error: 'content_too_large', maxBytes: MAX_INLINE_BYTES }, 413);
      }
      const server = c.get('server');
      const channel = await getKnowledgeChannel(deps.db, server._id);
      if (!channel) return c.json({ error: 'knowledge_channel_missing' }, 500);
      const user = c.get('user');
      const now = new Date();
      const doc: KnowledgeDocDoc = {
        _id: new ObjectId(),
        serverId: server._id,
        channelId: channel._id,
        title,
        content,
        source: 'inline',
        filename: null,
        mimeType: 'text/markdown',
        sizeBytes,
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      };
      await deps.db.collection<KnowledgeDocDoc>(collections.knowledgeDocs).insertOne(doc);
      return c.json({ doc: publicDoc(doc) }, 201);
    }
  );

  // Upload an .md/.txt file (multipart). Any member can contribute.
  app.post(
    '/v1/servers/:sid/knowledge/upload',
    requireAuth,
    requireServerMember(deps.db, 'member'),
    async (c) => {
      let form: Record<string, unknown>;
      try {
        form = await c.req.parseBody({ all: false });
      } catch {
        return c.json({ error: 'invalid_multipart' }, 400);
      }
      const file = form.file as File | undefined;
      const titleField = typeof form.title === 'string' ? form.title.trim() : '';
      if (!file || typeof file === 'string') return c.json({ error: 'missing_file' }, 400);
      const filename = (file as any).name as string | undefined;
      if (!filename || !ALLOWED_EXT.test(filename)) {
        return c.json({ error: 'unsupported_extension', allowed: ['.md', '.markdown', '.txt'] }, 400);
      }
      const mime = (file as any).type as string | undefined;
      // text/* is fine; we also tolerate application/octet-stream from generic uploaders
      const mimeOk = !mime || mime.startsWith('text/') || ALLOWED_MIME.has(mime);
      if (!mimeOk) return c.json({ error: 'unsupported_mime', mime }, 400);
      const buf = Buffer.from(await (file as any).arrayBuffer());
      if (buf.length > MAX_UPLOAD_BYTES) {
        return c.json({ error: 'file_too_large', maxBytes: MAX_UPLOAD_BYTES }, 413);
      }
      // Reject binary uploads disguised as txt — strict UTF-8 decode.
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch {
        return c.json({ error: 'not_utf8_text' }, 400);
      }
      if (content.trim().length === 0) return c.json({ error: 'empty_file' }, 400);
      const title = titleField || filename.replace(ALLOWED_EXT, '');
      const server = c.get('server');
      const channel = await getKnowledgeChannel(deps.db, server._id);
      if (!channel) return c.json({ error: 'knowledge_channel_missing' }, 500);
      const user = c.get('user');
      const now = new Date();
      const ext = filename.toLowerCase().endsWith('.txt') ? 'text/plain' : 'text/markdown';
      const doc: KnowledgeDocDoc = {
        _id: new ObjectId(),
        serverId: server._id,
        channelId: channel._id,
        title: title.slice(0, 200),
        content,
        source: 'upload',
        filename,
        mimeType: mime || ext,
        sizeBytes: buf.length,
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      };
      await deps.db.collection<KnowledgeDocDoc>(collections.knowledgeDocs).insertOne(doc);
      return c.json({ doc: publicDoc(doc) }, 201);
    }
  );

  // Delete — admin/owner only.
  app.delete(
    '/v1/servers/:sid/knowledge/:docId',
    requireAuth,
    requireServerMember(deps.db, 'admin'),
    async (c) => {
      const did = c.req.param('docId');
      if (!did || !ObjectId.isValid(did)) return c.json({ error: 'invalid_doc_id' }, 400);
      const server = c.get('server');
      const res = await deps.db
        .collection<KnowledgeDocDoc>(collections.knowledgeDocs)
        .deleteOne({ _id: new ObjectId(did), serverId: server._id });
      if (res.deletedCount !== 1) return c.json({ error: 'not_found' }, 404);
      return c.json({ ok: true });
    }
  );

  return app;
}
