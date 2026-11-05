"use client";
import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2, ShieldAlert, Plus, Check } from "lucide-react";
import { bf, type DiscoveredSkill } from "@/lib/api-bonfire";
import { ApiError } from "@/lib/api";

interface Props {
  selected: DiscoveredSkill[];
  onChange: (next: DiscoveredSkill[]) => void;
  /** Optional alternative search function — defaults to bf.searchSkills (agentskill.sh proxy). */
  search?: (q: string) => Promise<{ candidates: DiscoveredSkill[] }>;
  placeholder?: string;
}

export default function SkillSearchPicker({
  selected,
  onChange,
  search = bf.searchSkills,
  placeholder = "Search agentskill.sh — try 'web', 'github', 'summarise'…",
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DiscoveredSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const { candidates } = await search(q);
        setResults(candidates);
      } catch (e) {
        setError(e instanceof ApiError ? `Search failed (${e.status})` : "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [query, search]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function toggle(c: DiscoveredSkill) {
    const idx = selected.findIndex((s) => s.slug === c.slug);
    if (idx >= 0) onChange(selected.filter((_, i) => i !== idx));
    else onChange([...selected, c]);
  }

  function remove(slug: string) {
    onChange(selected.filter((s) => s.slug !== slug));
  }

  return (
    <div ref={wrapRef} className="relative">
      {/* Search input */}
      <div
        className="flex items-center gap-2 px-2 rounded-lg"
        style={{ background: "var(--bf-quaternary)" }}
      >
        <Search size={14} style={{ color: "var(--bf-gray)" }} />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm py-2 outline-none text-[var(--foreground)] placeholder:opacity-50"
        />
        {loading && <Loader2 size={14} className="animate-spin" style={{ color: "var(--bf-gray)" }} />}
      </div>

      {/* Dropdown */}
      {open && query.trim() && (
        <div
          className="absolute left-0 right-0 mt-1 rounded-lg overflow-hidden z-20 max-h-72 overflow-y-auto"
          style={{
            background: "var(--bf-tertiary)",
            border: "1px solid var(--bf-quinary)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {error ? (
            <p className="px-3 py-3 text-xs" style={{ color: "var(--bf-red)" }}>{error}</p>
          ) : loading && results.length === 0 ? (
            <p className="px-3 py-3 text-xs" style={{ color: "var(--bf-gray)" }}>Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-xs" style={{ color: "var(--bf-gray)" }}>
              No skills matched <code className="font-mono">{query}</code>.
            </p>
          ) : (
            results.map((r) => {
              const isSelected = selected.some((s) => s.slug === r.slug);
              return (
                <button
                  type="button"
                  key={`${r.owner}/${r.slug}`}
                  onClick={() => toggle(r)}
                  className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-[rgba(19,19,21,0.05)] transition-colors"
                  style={{ borderBottom: "1px solid var(--bf-quinary)" }}
                >
                  <div
                    className="flex-shrink-0 mt-0.5 rounded flex items-center justify-center"
                    style={{
                      width: 16,
                      height: 16,
                      background: isSelected ? "var(--bf-accent)" : "transparent",
                      border: `1px solid ${isSelected ? "var(--bf-accent)" : "var(--bf-gray)"}`,
                    }}
                  >
                    {isSelected && <Check size={11} style={{ color: "var(--foreground)" }} strokeWidth={3} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs font-semibold" style={{ color: "var(--bf-accent)" }}>
                        {r.slug}
                      </code>
                      {r.owner && (
                        <span className="text-xs" style={{ color: "var(--bf-gray)" }}>by {r.owner}</span>
                      )}
                      {typeof r.securityScore === "number" && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded font-mono inline-flex items-center gap-0.5"
                          style={{
                            background:
                              r.securityScore >= 80
                                ? "rgba(110,180,90,0.15)"
                                : r.securityScore >= 50
                                ? "rgba(251,191,36,0.15)"
                                : "rgba(240,91,91,0.15)",
                            color:
                              r.securityScore >= 80
                                ? "var(--bf-accent)"
                                : r.securityScore >= 50
                                ? "var(--bf-yellow)"
                                : "var(--bf-red)",
                          }}
                        >
                          <ShieldAlert size={10} />
                          {r.securityScore}
                        </span>
                      )}
                    </div>
                    {r.description && (
                      <p className="text-xs mt-0.5 leading-relaxed line-clamp-2" style={{ color: "var(--bf-gray)" }}>
                        {r.description}
                      </p>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selected.map((s) => (
            <span
              key={s.slug}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded font-mono"
              style={{ background: "var(--bf-quaternary)", color: "var(--bf-accent)" }}
            >
              <Plus size={10} />
              {s.slug}
              <button
                type="button"
                onClick={() => remove(s.slug)}
                aria-label={`Remove ${s.slug}`}
                className="hover:opacity-70"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
