/**
 * `publish_site` builtin tool — writes a static HTML page (and optional
 * assets) to a directory the BonFire backend serves at `/sites/<slug>/`.
 *
 * The agent runtime and backend share BONFIRE_SITES_DIR (default
 * /tmp/bonfire-sites) so the file written here shows up immediately at
 * http://localhost:8080/sites/<slug>/.
 *
 * Use case: the front-end-engineer agent receives marketing copy from
 * @og-marketing, drafts HTML+Tailwind, calls publish_site, replies with
 * the URL. No external services needed.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const DEFAULT_SITES_DIR = join(tmpdir(), 'bonfire-sites');

function sitesDir(): string {
  return process.env.BONFIRE_SITES_DIR ?? DEFAULT_SITES_DIR;
}

function publicBaseUrl(): string {
  return process.env.BONFIRE_PUBLIC_URL ?? 'http://localhost:8080';
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PATH_RE = /^[a-zA-Z0-9._/-]+$/;

export const publishSiteTool = tool({
  description:
    'Publish a static HTML landing page (and optional asset files) to BonFire-hosted /sites/<slug>/. ' +
    'Use this when you have a complete HTML page ready. Returns the public URL.',
  parameters: z.object({
    slug: z
      .string()
      .regex(SLUG_RE, 'slug must be lowercase letters/digits/hyphens, 1-63 chars')
      .describe('URL-safe site slug, e.g. "wabi-sushi"'),
    html: z
      .string()
      .min(1)
      .max(500_000)
      .describe('Complete HTML document. Use Tailwind via CDN (https://cdn.tailwindcss.com).'),
    assets: z
      .array(
        z.object({
          path: z.string().regex(PATH_RE, 'relative path, no .. allowed'),
          content: z.string().max(500_000),
        }),
      )
      .max(20)
      .optional()
      .describe('Optional supplementary files (CSS, JS, txt). Relative paths under <slug>/.'),
  }),
  execute: async ({ slug, html, assets }) => {
    if (!SLUG_RE.test(slug)) {
      return { ok: false, error: 'invalid_slug' };
    }
    const base = join(sitesDir(), slug);
    await mkdir(base, { recursive: true });
    await writeFile(join(base, 'index.html'), html, 'utf8');

    let assetCount = 0;
    if (assets) {
      for (const a of assets) {
        // Defence-in-depth: refuse paths that try to escape the slug dir.
        if (a.path.includes('..')) continue;
        const target = join(base, a.path);
        // Re-check: target must remain under `base` after path resolution.
        if (!target.startsWith(base + '/') && target !== base) continue;
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, a.content, 'utf8');
        assetCount++;
      }
    }

    const url = `${publicBaseUrl()}/sites/${slug}/`;
    return {
      ok: true,
      url,
      slug,
      filesWritten: 1 + assetCount,
      sitesDir: base,
    };
  },
});
