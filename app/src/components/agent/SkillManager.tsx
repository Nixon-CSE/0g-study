"use client";
import { useCallback, useEffect, useState } from "react";
import { Search, Trash2, Zap, Loader2, ShieldAlert, Plus, X } from "lucide-react";
import { bf, type DiscoveredSkill, type InstalledSkill, type InstalledSkillSource } from "@/lib/api-bonfire";
import { ApiError } from "@/lib/api";

interface Props {
  /** Backend agent id. If null, manager operates in queue-only mode for create flows. */
  agentId: string | null;
  /** When true, install/remove buttons are shown. Backend still enforces ownership. */
  canManage?: boolean;
  /** Pending queue for create flow — when agentId is null, selections go here instead of API. */
  pending?: DiscoveredSkill[];
  onPendingChange?: (next: DiscoveredSkill[]) => void;
}

function formatSource(source: InstalledSkill["source"]): string | undefined {
  if (!source) return undefined;
  if (typeof source === "string") return source;
  const s = source as InstalledSkillSource;
  if (s.owner && s.slug) return `${s.owner}/${s.slug}`;
  if (s.slug) return s.slug;
  if (s.sourceUrl) return s.sourceUrl;
  return undefined;
}

export default function SkillManager({ agentId, canManage = true, pending, onPendingChange }: Props) {
  const queueMode = agentId === null;
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(false);
  const [installedError, setInstalledError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DiscoveredSkill[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!agentId) return;
    setLoadingInstalled(true);
    setInstalledError(null);
    try {
      const { skills } = await bf.listAgentSkills(agentId);
      setInstalled(skills);
    } catch (e) {
      setInstalledError(e instanceof ApiError ? `Could not load skills (${e.status})` : "Could not load skills");
    } finally {
      setLoadingInstalled(false);
    }
  }, [agentId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) { setResults([]); return; }
    setSearching(true);
    setSearchError(null);
    try {
      if (queueMode) {
        // No agent yet — go direct to public agentskill.sh search via any registered agent's proxy is not possible.
        // Fall back to a client-side hint: queue selection from manual slug entry only.
        setResults([]);
        setSearchError("Discovery is available once the agent is provisioned. You can still queue slugs manually.");
      } else {
        const { candidates } = await bf.discoverSkills(agentId!, q);
        setResults(candidates);
      }
    } catch (e) {
      setSearchError(e instanceof ApiError ? `Search failed (${e.status})` : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function install(slug: string) {
    setActionError(null);
    if (queueMode) {
      const existing = pending ?? [];
      if (existing.some(s => s.slug === slug)) return;
      onPendingChange?.([...existing, { slug, owner: "", description: "" }]);
      return;
    }
    setBusySlug(slug);
    try {
      const res = await bf.installSkill(agentId!, { source: "agentskill.sh", slug });
      if (!("ok" in res) || !res.ok) {
        setActionError(`Install failed: ${("error" in res && res.error) || "unknown"}`);
      } else {
        await refresh();
      }
    } catch (e) {
      setActionError(e instanceof ApiError ? `Install failed (${e.status})` : "Install failed");
    } finally {
      setBusySlug(null);
    }
  }

  async function remove(name: string) {
    setActionError(null);
    setBusySlug(name);
    try {
      await bf.removeSkill(agentId!, name);
      await refresh();
    } catch (e) {
      setActionError(e instanceof ApiError ? `Remove failed (${e.status})` : "Remove failed");
    } finally {
      setBusySlug(null);
    }
  }

  function unqueue(slug: string) {
    onPendingChange?.((pending ?? []).filter(s => s.slug !== slug));
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Installed / pending */}
      <div>
        <p className="text-xs uppercase tracking-wide mb-2 font-semibold" style={{ color: "var(--bf-gray)" }}>
          {queueMode ? "Queued for first boot" : "Installed"}
        </p>
        {queueMode ? (
          (pending ?? []).length === 0 ? (
            <EmptyHint text="No skills queued. Search agentskill.sh below to add some." />
          ) : (
            <div className="flex flex-wrap gap-2">
              {(pending ?? []).map(s => (
                <span
                  key={s.slug}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded font-mono"
                  style={{ background: "var(--bf-quaternary)", color: "var(--bf-accent)" }}
                >
                  {s.slug}
                  <button onClick={() => unqueue(s.slug)} aria-label="Remove" className="hover:opacity-70">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )
        ) : loadingInstalled ? (
          <EmptyHint text="Loading…" />
        ) : installedError ? (
          <EmptyHint text={installedError} tone="error" />
        ) : installed.length === 0 ? (
          <EmptyHint text="No skills installed yet." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {installed.map(s => (
              <div key={s.name} className="rounded-lg p-3 flex items-start gap-2" style={{ background: "var(--bf-quaternary)" }}>
                <Zap size={13} strokeWidth={2} style={{ color: "var(--bf-accent)", flexShrink: 0, marginTop: 3 }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--on-ink)] text-sm font-semibold truncate">{s.name}</p>
                  {s.description && (
                    <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--bf-gray)" }}>{s.description}</p>
                  )}
                  {formatSource(s.source) && (
                    <p className="text-xs mt-1 font-mono" style={{ color: "var(--bf-symbol)" }}>{formatSource(s.source)}</p>
                  )}
                </div>
                {canManage && (
                  <button
                    onClick={() => remove(s.name)}
                    disabled={busySlug === s.name}
                    className="flex-shrink-0 p-1 rounded hover:bg-black/20 disabled:opacity-50"
                    aria-label={`Remove ${s.name}`}
                  >
                    {busySlug === s.name ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Discover */}
      {canManage && (
        <div>
          <p className="text-xs uppercase tracking-wide mb-2 font-semibold" style={{ color: "var(--bf-gray)" }}>
            Discover on agentskill.sh
          </p>
          <form onSubmit={runSearch} className="flex gap-2 mb-2">
            <div className="flex-1 flex items-center gap-2 px-2 rounded-lg" style={{ background: "var(--bf-quaternary)" }}>
              <Search size={14} style={{ color: "var(--bf-gray)" }} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="e.g. web-search, github, summarise"
                className="flex-1 bg-transparent text-sm py-2 outline-none text-[var(--foreground)] placeholder:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={searching || !query.trim()}
              className="px-3 py-2 text-sm rounded-lg font-semibold text-[var(--on-ink)] disabled:opacity-50"
              style={{ background: "var(--bf-accent)" }}
            >
              {searching ? <Loader2 size={14} className="animate-spin" /> : "Search"}
            </button>
          </form>

          {searchError && <EmptyHint text={searchError} tone="warn" />}
          {actionError && <EmptyHint text={actionError} tone="error" />}

          {results.length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              {results.map(r => {
                const alreadyInstalled = !queueMode && installed.some(i => i.name === r.slug);
                const alreadyQueued = queueMode && (pending ?? []).some(p => p.slug === r.slug);
                return (
                  <div key={`${r.owner}/${r.slug}`} className="rounded-lg p-3 flex items-start gap-2" style={{ background: "var(--bf-quaternary)" }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs font-semibold" style={{ color: "var(--bf-accent)" }}>{r.slug}</code>
                        {r.owner && <span className="text-xs" style={{ color: "var(--bf-gray)" }}>by {r.owner}</span>}
                        {typeof r.securityScore === "number" && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded font-mono"
                            style={{
                              background: r.securityScore >= 80 ? "rgba(110,180,90,0.15)" : r.securityScore >= 50 ? "rgba(251,191,36,0.15)" : "rgba(240,91,91,0.15)",
                              color: r.securityScore >= 80 ? "var(--bf-accent)" : r.securityScore >= 50 ? "var(--bf-yellow)" : "var(--bf-red)",
                            }}
                          >
                            <ShieldAlert size={10} className="inline mr-0.5" />
                            {r.securityScore}
                          </span>
                        )}
                      </div>
                      {r.description && (
                        <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--bf-gray)" }}>{r.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => install(r.slug)}
                      disabled={busySlug === r.slug || alreadyInstalled || alreadyQueued}
                      className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs rounded font-semibold text-[var(--on-ink)] disabled:opacity-50"
                      style={{ background: "var(--bf-accent)" }}
                    >
                      {busySlug === r.slug ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : alreadyInstalled || alreadyQueued ? (
                        "Added"
                      ) : (
                        <><Plus size={12} /> {queueMode ? "Queue" : "Install"}</>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyHint({ text, tone = "muted" }: { text: string; tone?: "muted" | "warn" | "error" }) {
  const color = tone === "error" ? "var(--bf-red)" : tone === "warn" ? "var(--bf-yellow)" : "var(--bf-gray)";
  return <p className="text-xs py-2" style={{ color }}>{text}</p>;
}
