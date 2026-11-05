/**
 * Static-site serving — agents publish HTML into BONFIRE_SITES_DIR via the
 * `publish_site` tool in the agent runtime; this route serves those files.
 *
 *   GET /sites/<slug>/         → <slug>/index.html
 *   GET /sites/<slug>/<path>   → <slug>/<path>
 *
 * No auth — published sites are intentionally public so the agent can
 * just hand back a URL and the human (or another agent) can open it.
 */
import { Hono } from 'hono';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { tmpdir } from 'node:os';

const DEFAULT_SITES_DIR = join(tmpdir(), 'bonfire-sites');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

function sitesDir(): string {
  return process.env.BONFIRE_SITES_DIR ?? DEFAULT_SITES_DIR;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
};

export function siteRoutes() {
  const app = new Hono();

  // Bare /sites/:slug → index.html
  app.get('/sites/:slug', async (c) => serveFile(c, c.req.param('slug'), 'index.html'));

  // /sites/:slug/* → relative path under slug dir
  app.get('/sites/:slug/*', async (c) => {
    const slug = c.req.param('slug');
    // Hono's wildcard captures everything after /sites/:slug/
    const fullPath = c.req.path; // e.g. /sites/wabi/css/main.css
    const rel = fullPath.replace(/^\/sites\/[^/]+\//, '') || 'index.html';
    return serveFile(c, slug, rel);
  });

  return app;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function serveFile(c: any, slug: string, relPath: string): Promise<Response> {
  if (!SLUG_RE.test(slug)) return c.text('invalid slug', 400);
  const base = join(sitesDir(), slug);
  const file = normalize(join(base, relPath));
  // Defence-in-depth — never serve outside the slug dir even if the wildcard
  // somehow let `..` through (it shouldn't, Hono normalises).
  if (!file.startsWith(base + '/') && file !== base) {
    return c.text('forbidden', 403);
  }
  let buf: Buffer;
  try {
    const s = await stat(file);
    if (!s.isFile()) return c.text('not_found', 404);
    buf = await readFile(file);
  } catch {
    return c.text('not_found', 404);
  }
  const ct = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  // Convert Buffer → ArrayBuffer slice so it satisfies BodyInit
  const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': ct,
      // Sites are agent-published, freshness > cacheability.
      'cache-control': 'no-store',
    },
  });
}
