/** P7: what production needs from the agent: a volume-safe entrypoint, boot checks, CORS, upload limits. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { assertProductionEnv, corsOrigin, productionEnvProblems } from '../src/config/production.js';
import { studyRoutes } from '../src/api/routes/study.js';
import { MAX_UPLOAD_CHARS } from '../src/study/uploads.js';

const ENTRYPOINT = path.resolve(__dirname, '../docker/entrypoint.sh');
const OK = { NODE_ENV: 'production', AGENT_ADMIN_TOKEN: 'a'.repeat(32), STUDY_JWT_SECRET: 'b'.repeat(32), STUDY_ALLOWED_ORIGINS: 'https://0g-study.vercel.app' };

describe('docker/entrypoint.sh on a volume', () => {
  let root: string, vol: string, defaults: string, baked: string;
  const boot = (cmd: string[] = ['sh', '-c', 'echo "dir=$AGENT_DIR tenants=$TENANTS_FILE"']) => execFileSync('sh', [ENTRYPOINT, ...cmd], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH!, AGENT_DIR: vol, DEFAULTS_DIR: defaults, BAKED_TENANTS: baked },
  });
  const write = (f: string, s: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-'));
    vol = path.join(root, 'volume'); defaults = path.join(root, 'defaults'); baked = path.join(root, 'baked.json');
    write(path.join(defaults, 'agent.config.json'), 'baked config');
    write(path.join(defaults, 'SOUL.md'), 'baked soul');
    write(path.join(defaults, 'skills/learn/SKILL.md'), 'baked skill');
    write(baked, '[{"slug":"study-tutor"}]');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('an empty volume gets every default, and tenants land on the volume', () => {
    const out = boot();
    expect(fs.readFileSync(path.join(vol, 'agent.config.json'), 'utf8')).toBe('baked config');
    expect(fs.readFileSync(path.join(vol, 'skills/learn/SKILL.md'), 'utf8')).toBe('baked skill');
    expect(fs.readFileSync(path.join(vol, 'data/tenants.json'), 'utf8')).toContain('study-tutor');
    expect(out).toContain('4 default file(s) copied');
    expect(out).toContain(`tenants=${vol}/data/tenants.json`);
  });
  it('a redeploy never overwrites user data, but fills in what is missing', () => {
    boot();
    write(path.join(vol, 'SOUL.md'), 'edited soul');
    write(path.join(vol, 'data/tenants.json'), '[{"slug":"edited"}]');
    write(path.join(vol, 'study/alice/2026-11-06.json'), 'cards');
    write(path.join(vol, 'study/alice/zerog-keys.enc'), 'sealed');
    fs.rmSync(path.join(vol, 'agent.config.json'));
    write(path.join(defaults, 'SOUL.md'), 'newer image soul');
    const out = boot();
    expect(fs.readFileSync(path.join(vol, 'SOUL.md'), 'utf8')).toBe('edited soul');
    expect(fs.readFileSync(path.join(vol, 'data/tenants.json'), 'utf8')).toContain('edited');
    expect(fs.readFileSync(path.join(vol, 'study/alice/zerog-keys.enc'), 'utf8')).toBe('sealed');
    expect(fs.readFileSync(path.join(vol, 'agent.config.json'), 'utf8')).toBe('baked config');
    expect(out).toContain('1 default file(s) copied');
  });
  it('hands over to the command with exec, passing its exit code', () => {
    expect(() => boot(['sh', '-c', 'exit 7'])).toThrow(/status 7|Command failed/);
  });
});

describe('production boot checks', () => {
  it('passes with the secrets, and ignores development', () => {
    expect(productionEnvProblems(OK)).toEqual([]);
    expect(productionEnvProblems({ NODE_ENV: 'development' })).toEqual([]);
  });
  it('refuses to start without them', () => {
    for (const k of ['AGENT_ADMIN_TOKEN', 'STUDY_JWT_SECRET', 'STUDY_ALLOWED_ORIGINS'] as const) {
      const env = { ...OK, [k]: '' };
      expect(() => assertProductionEnv(env), k).toThrow(new RegExp(`Refusing to start[\\s\\S]*${k}`));
    }
    expect(productionEnvProblems({ ...OK, STUDY_JWT_SECRET: 'short' })).toEqual(['STUDY_JWT_SECRET must be at least 32 characters']);
  });
  it('names no secret values in the message', () => {
    expect(() => assertProductionEnv({ ...OK, AGENT_ADMIN_TOKEN: 'short-secret' })).toThrow(/^(?![\s\S]*short-secret)/);
  });
});

describe('agent CORS', () => {
  const app = (env: NodeJS.ProcessEnv) => {
    const a = new Hono();
    a.use('*', cors({ origin: (o) => corsOrigin(o, env) }));
    a.get('/x', (c) => c.text('ok'));
    return a;
  };
  const allow = async (env: NodeJS.ProcessEnv, origin: string) => (await app(env).request('/x', { headers: { origin } })).headers.get('access-control-allow-origin');
  it('production: only the app origin', async () => {
    expect(await allow(OK, 'https://0g-study.vercel.app')).toBe('https://0g-study.vercel.app');
    expect(await allow(OK, 'https://evil.example')).toBeNull();
    expect(await allow(OK, 'http://localhost:3000')).toBeNull();
  });
  it('a trailing slash in the setting still matches; several origins work', () => {
    const env = { ...OK, STUDY_ALLOWED_ORIGINS: 'https://a.vercel.app/, https://b.example' };
    expect(corsOrigin('https://a.vercel.app', env)).toBe('https://a.vercel.app');
    expect(corsOrigin('https://b.example', env)).toBe('https://b.example');
  });
  it('development: the list plus localhost; open only with no list', () => {
    const dev = { NODE_ENV: 'development', STUDY_ALLOWED_ORIGINS: 'https://a.vercel.app' };
    expect(corsOrigin('http://localhost:3000', dev)).toBe('http://localhost:3000');
    expect(corsOrigin('http://127.0.0.1:5173', dev)).toBe('http://127.0.0.1:5173');
    expect(corsOrigin('https://evil.example', dev)).toBeNull();
    expect(corsOrigin('https://anything.example', { NODE_ENV: 'development' })).toBe('https://anything.example');
    expect(corsOrigin(undefined, dev)).toBeNull();
  });
});

describe('upload size limit', () => {
  const SECRET = 'y'.repeat(40);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = enc({ alg: 'HS256' }), p = enc({ sub: 'alice', exp: Math.floor(Date.now() / 1000) + 60 });
  const token = `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'up-')); process.env.STUDY_JWT_SECRET = SECRET; });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.STUDY_JWT_SECRET; });

  it('an oversized body gets 413 even with no Content-Length (chunked through a proxy)', async () => {
    const big = new TextEncoder().encode(JSON.stringify({ dataUrl: 'A'.repeat(MAX_UPLOAD_CHARS + 200_000) }));
    const body = new ReadableStream({ start(c) { for (let i = 0; i < big.length; i += 1 << 20) c.enqueue(big.subarray(i, i + (1 << 20))); c.close(); } });
    const r = await studyRoutes(dir).request('/uploads', { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
    expect(r.status).toBe(413);
  });
  it('without a token the body is refused first', async () => {
    const r = await studyRoutes(dir).request('/uploads', { method: 'POST', body: '{}' });
    expect(r.status).toBe(401);
  });
  it('a normal photo still uploads', async () => {
    const r = await studyRoutes(dir).request('/uploads', { method: 'POST', headers, body: JSON.stringify({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }) });
    expect(r.status).toBe(200);
  });
});

describe('render.yaml (free plan)', () => {
  const yaml = fs.readFileSync(path.resolve(__dirname, '../../render.yaml'), 'utf8');
  it('both services: free, Docker, Singapore, health-checked, and PORT left to Render', () => {
    expect(yaml.match(/^\s+plan: free$/gm)).toHaveLength(2);
    expect(yaml.match(/^\s+runtime: docker$/gm)).toHaveLength(2);
    expect(yaml.match(/^\s+region: singapore$/gm)).toHaveLength(2);
    expect(yaml.match(/^\s+healthCheckPath: \/health$/gm)).toHaveLength(2);
    expect(yaml).toMatch(/rootDir: agent\n\s+dockerfilePath: \.\/docker\/Dockerfile/);
    expect(yaml).toMatch(/rootDir: backend\n\s+dockerfilePath: \.\/Dockerfile/);
    expect(yaml).not.toMatch(/key: PORT/);
    expect(yaml).not.toMatch(/^\s+disk:/m);
  });
  it('every secret is sync: false, so none can live in the file', () => {
    for (const k of ['ZEROG_API_KEY', 'STUDY_JWT_SECRET', 'AGENT_ADMIN_TOKEN', 'MONGODB_URI', 'JWT_SECRET', 'PRIVY_APP_SECRET']) {
      const rows = [...yaml.matchAll(new RegExp(`key: ${k}\\n\\s+(\\S+: \\S+)`, 'g'))];
      expect(rows.length, k).toBeGreaterThan(0);
      for (const r of rows) expect(r[1], k).toBe('sync: false');
    }
    expect(yaml).not.toMatch(/sk-[A-Za-z0-9]|mongodb\+srv|[0-9a-f]{40,}/);
  });
});

describe('no disk on the free plan', () => {
  it('production checks need no volume: a Render boot with the secrets passes', () => {
    expect(productionEnvProblems({ ...OK, RENDER: 'true' })).toEqual([]);
  });
});

