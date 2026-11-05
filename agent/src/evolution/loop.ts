import type { LanguageModelV1 } from 'ai';
import { discover } from './discover.js';
import { scoreCandidates } from './score.js';
import { installSkill } from '../skills/installer.js';
import type { AgentConfig } from '../config/schema.js';
import { log } from '../util/logger.js';

export function startEvolutionLoop(opts: {
  cfg: AgentConfig;
  agentDir: string;
  model: LanguageModelV1;
  installedSlugs: () => string[];
  recentWorkSummary: () => string;
  notifySuggest: (items: { slug: string; owner: string; description: string; score: number; securityScore?: number }[]) => Promise<void>;
  reload: () => Promise<void>;
}): () => void {
  if (opts.cfg.evolution.mode === 'off') return () => {};
  const intervalMs = opts.cfg.evolution.intervalHours * 60 * 60 * 1000;
  const tick = async () => {
    try {
      const found = await discover(opts.cfg.evolution.interests);
      const installed = new Set(opts.installedSlugs());
      const fresh = found.filter(f => !installed.has(`${f.owner}/${f.slug}`) && !installed.has(f.slug));
      if (fresh.length === 0) return;
      const scored = await scoreCandidates(opts.model, opts.recentWorkSummary(), fresh);
      const top = scored.slice(0, 3);
      if (opts.cfg.evolution.mode === 'suggest') {
        await opts.notifySuggest(top.map(t => ({ slug: t.skill.slug, owner: t.skill.owner, description: t.skill.description, score: t.score, securityScore: t.skill.securityScore })));
        return;
      }
      for (const t of top) {
        if (opts.cfg.evolution.mode === 'auto-safe' && (t.skill.securityScore ?? 0) < 80) continue;
        if (opts.cfg.evolution.mode === 'auto-all' && (t.skill.securityScore ?? 0) < 50) continue;
        const r = await installSkill(opts.agentDir, 'agentskill.sh', { slug: `${t.skill.owner}/${t.skill.slug}` }, opts.cfg.evolution.mode);
        log.info({ slug: t.skill.slug, result: r }, 'evolution install');
      }
      await opts.reload();
    } catch (e) { log.warn({ err: e }, 'evolution tick failed'); }
  };
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
}
