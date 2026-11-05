"use client";
import { type CSSProperties, useState, useEffect, useCallback } from "react";
import { ShieldAlert, RefreshCw } from "lucide-react";
import { bf, type AuditLogEntry } from "@/lib/api-bonfire";
import { useApp } from "@/context/AppContext";

/** Uppercase action token color — plum / banana / red + brand-tinted variants */
const ACTION_COLOR: Record<string, string> = {
  agent_invoked: "var(--bf-accent)",
  agent_replied: "var(--bf-yellow)",
  agent_failed: "var(--bf-red)",
  voice_join: "color-mix(in srgb, var(--bf-accent) 82%, white)",
  voice_leave: "color-mix(in srgb, var(--bf-yellow) 65%, var(--bf-gray))",
};

function actorTag(actor: AuditLogEntry["actorType"]): string {
  switch (actor) {
    case "agent":
      return "AGT";
    case "user":
      return "USR";
    case "system":
    default:
      return "SYS";
  }
}

function actionLabel(entry: AuditLogEntry): string {
  const p = entry.payload;
  switch (entry.action) {
    case "agent_invoked":
      return `invoke "${String(p.inputPreview ?? "").slice(0, 80)}"`;
    case "agent_replied":
      return `reply "${String(p.replyPreview ?? "").slice(0, 80)}" (${p.durationMs ?? "?"}ms)`;
    case "agent_failed":
      return `fail ${String(p.error ?? "unknown error").slice(0, 100)}`;
    default:
      return JSON.stringify(p);
  }
}

function TerminalTimestamp({ iso }: { iso: string }) {
  const d = new Date(iso);
  const wall = d.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    month: "short",
    day: "numeric",
  });
  const title = d.toISOString();
  return (
    <span
      title={title}
      className="inline-block shrink-0 cursor-help whitespace-nowrap tabular-nums"
      style={{ color: "var(--bf-symbol)" }}
    >
      [{wall}]
    </span>
  );
}

export default function AuditLogPane({ channelId }: { channelId: string }) {
  const { activeServer } = useApp();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    try {
      const { entries: data } = await bf.getAuditLog(channelId, { limit: 50 });
      setEntries(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    /* polling + initial load — state updates run after I/O resolves */
    // eslint-disable-next-line react-hooks/set-state-in-effect -- audit stream refresh
    void fetchEntries();
    const id = setInterval(fetchEntries, 5000);
    return () => clearInterval(id);
  }, [fetchEntries]);

  const terminalShell: CSSProperties = {
    borderColor: "color-mix(in srgb, var(--bf-accent) 28%, var(--bf-quinary))",
    background: "var(--bf-quaternary)",
    boxShadow: "inset 0 1px 0 rgba(254,255,252,0.04)",
  };

  const terminalTitleBar: CSSProperties = {
    borderBottomColor: "var(--bf-border)",
    background: "var(--bf-secondary)",
  };

  const scrollChrome: CSSProperties = {
    background: "var(--bf-primary)",
  };

  return (
    <main className="flex flex-1 min-w-0 flex-col overflow-hidden" style={{ background: "var(--bf-primary)" }}>
      <header
        className="flex h-14 flex-shrink-0 items-center gap-3 border-b px-4"
        style={{ borderColor: "var(--bf-quinary)" }}
      >
        <ShieldAlert size={20} style={{ color: "var(--bf-fire)", flexShrink: 0 }} strokeWidth={1.5} />
        <span className="min-w-0 truncate text-lg font-bold text-[var(--on-ink)]">
          Audit Log{activeServer ? ` · ${activeServer.name}` : ""}
        </span>
        <span
          className="ml-1 rounded px-2 py-0.5 text-xs font-bold uppercase"
          style={{
            background: "rgba(240,91,91,0.15)",
            color: "var(--bf-red)",
            border: "1px solid rgba(240,91,91,0.3)",
          }}
        >
          Owner-only
        </span>
        <div className="flex-1" />
        <button
          onClick={fetchEntries}
          title="Refresh"
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
          style={{ color: "var(--bf-gray)" }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.color = "var(--foreground)";
            el.style.background = "var(--bf-quinary)";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.color = "var(--bf-gray)";
            el.style.background = "transparent";
          }}
        >
          <RefreshCw size={16} strokeWidth={1.5} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border" style={terminalShell}>
          <div className="flex flex-shrink-0 items-center gap-2 border-b px-3 py-2" style={terminalTitleBar}>
            <span
              className="font-mono text-[11px]"
              style={{ color: "color-mix(in srgb, var(--bf-accent) 72%, var(--bf-gray))" }}
            >
              bonfire — audit stream
            </span>
            <span className="flex-1" />
            <span className="font-mono text-[10px]" style={{ color: "var(--bf-symbol)" }} title={channelId}>
              cid:{channelId.slice(0, 8)}…
            </span>
          </div>

          <div
            className="bf-audit-terminal-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed tracking-tight"
            style={scrollChrome}
          >
            {loading && (
              <p className="py-8 text-center" style={{ color: "var(--bf-gray)" }}>
                <span style={{ color: "var(--bf-accent)" }}>…</span> streaming events
              </p>
            )}

            {!loading && error && (
              <p className="break-words py-8 text-center" style={{ color: "var(--bf-red)" }}>
                <span style={{ color: "var(--bf-red)", fontWeight: 700 }}>ERR </span>
                {error}
              </p>
            )}

            {!loading && !error && entries.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-16" style={{ color: "var(--bf-gray)" }}>
                <span style={{ color: "var(--bf-symbol)" }}>—</span>
                <p className="text-[11px]">empty buffer · no audit lines yet</p>
              </div>
            )}

            {!loading && !error && entries.length > 0 && (
              <div className="flex flex-col">
                <div
                  aria-hidden
                  className="mb-2 select-none border-b border-dashed pb-2 text-[10px]"
                  style={{
                    borderColor: "var(--bf-quinary)",
                    color: "var(--bf-symbol)",
                  }}
                >
                  <span style={{ color: "var(--bf-accent)" }}>^ </span>
                  last {entries.length} lines (poll 5s) · monospace
                </div>
                {entries.map((entry, i) => (
                  <AuditLine key={entry.id} entry={entry} alt={i % 2 === 1} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        .bf-audit-terminal-scroll ::selection {
          background: color-mix(in srgb, var(--bf-accent) 35%, transparent);
        }
      `}</style>
    </main>
  );
}

function AuditLine({ entry, alt }: { entry: AuditLogEntry; alt: boolean }) {
  const actionColor = ACTION_COLOR[entry.action] ?? "var(--bf-gray)";
  const actionTok = entry.action.replaceAll("_", " ").toUpperCase();
  const detail = actionLabel(entry);

  const rowStyle: CSSProperties = {
    borderLeftWidth: 2,
    borderLeftStyle: "solid",
    borderLeftColor: alt ? "var(--bf-quinary)" : "color-mix(in srgb, var(--bf-accent) 22%, var(--bf-quinary))",
    background: alt ? "color-mix(in srgb, var(--bf-accent) 9%, var(--bf-primary))" : "transparent",
  };

  const badgeStyle: CSSProperties = {
    background: "var(--bf-quaternary)",
    color: "var(--bf-symbol)",
    border: "1px solid var(--bf-quinary)",
  };

  return (
    <div
      className="group grid gap-x-3 py-1.5 pl-2 pr-1 sm:grid-cols-[minmax(11rem,auto)_8.5rem_1fr] sm:items-baseline"
      style={rowStyle}
    >
      <TerminalTimestamp iso={entry.createdAt} />
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 sm:mt-0">
        <span className="font-semibold uppercase tracking-wide" style={{ color: actionColor }}>
          {actionTok}
        </span>
        <span className="rounded px-1 py-px text-[10px] font-medium uppercase tracking-wider" style={badgeStyle}>
          {actorTag(entry.actorType)}
        </span>
      </div>
      <div className="min-w-0 break-all sm:col-span-1">
        {entry.agentSlug && (
          <>
            <span style={{ color: "var(--bf-accent)" }}>@{entry.agentSlug}</span>
            <span style={{ color: "var(--bf-symbol)" }}> · </span>
          </>
        )}
        <span style={{ color: "var(--bf-gray)" }}>{detail}</span>
      </div>
    </div>
  );
}
