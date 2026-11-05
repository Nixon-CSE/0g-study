import fs from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';
import { TenantSchema, type Tenant } from './types.js';
import { SEED_TENANTS } from './seed.js';
import { log } from '../util/logger.js';

export class TenantRegistry {
  private cache = new Map<string, Tenant>();
  private filePath: string;
  private saving = false;
  private saveQueue: (() => void)[] = [];
  private subscribers: Array<(slug: string) => void> = [];

  /** Register a callback that fires whenever a tenant is created, updated, or deleted. */
  subscribe(fn: (slug: string) => void): void {
    this.subscribers.push(fn);
  }

  private notify(slug: string): void {
    for (const fn of this.subscribers) fn(slug);
  }

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Load from disk (or seed if file doesn't exist). Call once at boot. */
  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      let arr: unknown[];
      try {
        arr = JSON.parse(raw) as unknown[];
      } catch (parseErr: any) {
        // Keep previous in-memory copy on JSON parse failure rather than crashing.
        log.warn({ err: parseErr?.message }, 'tenants: JSON parse failed, keeping previous state');
        return;
      }
      this.cache.clear();
      for (const item of arr) {
        const parsed = TenantSchema.safeParse(item);
        if (parsed.success) {
          this.cache.set(parsed.data.slug, parsed.data);
        } else {
          log.warn({ err: parsed.error }, 'tenants: invalid entry skipped');
        }
      }
      log.info({ count: this.cache.size }, 'tenants: loaded');
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        log.info('tenants: file not found, seeding defaults');
        for (const t of SEED_TENANTS) {
          this.cache.set(t.slug, t);
        }
        await this.persist();
      } else {
        // Keep previous in-memory copy on unexpected read errors.
        log.warn({ err: e?.message }, 'tenants: load error, keeping previous state');
      }
    }
  }

  /** Start watching the tenants file for external changes and reload. */
  watch(): () => void {
    const watcher = chokidar.watch(this.filePath, { ignoreInitial: true });
    watcher.on('change', async () => {
      log.info('tenants: file changed, reloading');
      const prevSlugs = new Set(this.cache.keys());
      await this.load();
      // Notify all slugs that were present or are now present so caches are cleared.
      const allSlugs = new Set([...prevSlugs, ...this.cache.keys()]);
      for (const slug of allSlugs) this.notify(slug);
    });
    return () => { watcher.close(); };
  }

  all(): Tenant[] {
    return Array.from(this.cache.values());
  }

  get(slug: string): Tenant | undefined {
    return this.cache.get(slug);
  }

  async create(data: Tenant): Promise<{ ok: true; tenant: Tenant } | { ok: false; error: 'slug_taken' }> {
    if (this.cache.has(data.slug)) {
      return { ok: false, error: 'slug_taken' };
    }
    const tenant = TenantSchema.parse(data);
    this.cache.set(tenant.slug, tenant);
    await this.persist();
    this.notify(tenant.slug);
    return { ok: true, tenant };
  }

  async update(slug: string, patch: Partial<Omit<Tenant, 'slug' | 'createdAt'>>): Promise<Tenant | null> {
    const existing = this.cache.get(slug);
    if (!existing) return null;
    const updated = TenantSchema.parse({
      ...existing,
      ...patch,
      slug: existing.slug,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    });
    this.cache.set(slug, updated);
    await this.persist();
    this.notify(slug);
    return updated;
  }

  async remove(slug: string): Promise<boolean> {
    if (!this.cache.has(slug)) return false;
    this.cache.delete(slug);
    await this.persist();
    this.notify(slug);
    return true;
  }

  /** Serialize cache to disk with a simple mutex to prevent concurrent writes. */
  private async persist(): Promise<void> {
    if (this.saving) {
      // Enqueue and wait for current save to finish
      await new Promise<void>((resolve) => this.saveQueue.push(resolve));
    }
    this.saving = true;
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      const arr = Array.from(this.cache.values());
      await fs.writeFile(this.filePath, JSON.stringify(arr, null, 2), 'utf8');
    } finally {
      this.saving = false;
      const next = this.saveQueue.shift();
      if (next) next();
    }
  }
}
