"use client";
import { useState, useEffect, useRef } from "react";
import { ShieldCheck, Wrench, Plus, Trash2, Server, Loader2, Sparkles, ExternalLink, Copy, Check, Lock, FileText, Key, Flame, Box } from "lucide-react";
import { SiTelegram, SiWhatsapp, SiDiscord, SiSlack, SiX } from "react-icons/si";
import type { Agent } from "@/context/AppContext";
import Modal from "@/components/shared/Modal";
import FlameAvatar from "@/components/shared/FlameAvatar";
import { profileModelLabel } from "@/lib/agent-model-label";
import SkillManager from "./SkillManager";
import { bf, type McpServerConfig } from "@/lib/api-bonfire";
import { ModalLabel, ModalInput } from "@/components/shared/Modal";
import { MCP_PRESETS, type McpPreset } from "./mcp-presets";

const STATUS_COLOR: Record<string, string> = {
  online:  "var(--bf-accent)",
  busy:    "var(--bf-yellow)",
  idle:    "var(--bf-symbol)",
  offline: "var(--bf-symbol)",
};

interface Props {
  agent: Agent;
  onClose: () => void;
}

export default function AgentProfileModal({ agent, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<"overview" | "inft" | "skills" | "mcp">("overview");

  return (
    <Modal title="" onClose={onClose} wide maxHeight="70vh">
      {/* Header */}
      <div className="flex items-center gap-4 pb-4" style={{ borderBottom: "1px solid var(--bf-quinary)" }}>
        <div className="relative flex-shrink-0">
          <FlameAvatar
            slug={agent.slug || agent.id}
            avatarUrl={agent.avatar}
            size={64}
            alt={agent.name}
          />
          <span
            className="absolute rounded-full"
            style={{
              width: 14,
              height: 14,
              background: STATUS_COLOR[agent.status] ?? "#4b5563",
              border: "3px solid var(--bf-primary)",
              bottom: 0,
              right: 0,
            }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[var(--on-ink)] text-xl font-bold">{agent.name}</span>
            <span className="text-xs px-1.5 py-0.5 rounded font-bold text-[var(--on-ink)] uppercase" style={{ background: "var(--bf-accent)", fontSize: 10 }}>BOT</span>
            <span className="text-xs font-medium capitalize" style={{ color: STATUS_COLOR[agent.status] }}>● {agent.status}</span>
          </div>
          <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--bf-gray)" }}>{agent.description}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: "1px solid var(--bf-quinary)" }}>
        {(["overview", "inft", "skills", "mcp"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-4 py-2 text-sm font-semibold capitalize transition-colors"
            style={{
              color: activeTab === tab ? "var(--bf-white)" : "var(--bf-gray)",
              borderBottom: activeTab === tab ? "2px solid var(--bf-accent)" : "2px solid transparent",
            }}
          >
            {tab === "skills" ? "Skills" : tab === "mcp" ? "MCP Servers" : tab === "inft" ? "iNFT" : "Overview"}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="flex flex-col gap-4 pt-2">
          {/* Stats grid */}
          <OverviewStats agentId={agent.id} />

          {agent.acquisition && (
            <div className="rounded-lg p-3 text-sm" style={{ background: "var(--bf-quaternary)" }}>
              <p className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--bf-gray)" }}>Acquisition</p>
              <p className="text-[var(--foreground)] font-medium capitalize">{agent.acquisition}</p>
            </div>
          )}

          {agent.teeHash && (
            <div className="rounded-lg p-3 text-sm" style={{ background: "var(--bf-quaternary)" }}>
              <p className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--bf-gray)" }}>TEE Attestation</p>
              <div className="flex items-center gap-2">
                <code className="text-xs flex-1 truncate" style={{ color: "var(--bf-accent)" }}>{agent.teeHash}</code>
                <button
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded font-semibold text-[var(--on-ink)] flex-shrink-0"
                  style={{ background: "var(--bf-accent)" }}
                  onClick={() => alert(`TEE Attestation:\n${agent.teeHash}\n\nVerified on 0G Compute Network`)}
                >
                  <ShieldCheck size={12} strokeWidth={2} />
                  Verify
                </button>
              </div>
            </div>
          )}

          {/* Adapters */}
          <AdaptersSection />

        </div>
      )}

      {activeTab === "inft" && (
        <div className="pt-2">
          <InftVisualiser agent={agent} />
        </div>
      )}

      {activeTab === "skills" && (
        <div className="pt-2">
          <SkillManager agentId={agent.id} canManage />
        </div>
      )}

      {activeTab === "mcp" && (
        <div className="pt-2">
          <McpManager agentId={agent.id} canManage />
        </div>
      )}

    </Modal>
  );
}

// ---------------------------------------------------------------------------
// McpManager
// ---------------------------------------------------------------------------

const EMPTY_FORM = { id: "", command: "", args: "", env: "" };

export function McpManager({ agentId, canManage = true }: { agentId: string; canManage?: boolean }) {
  const [servers, setServers] = useState<Record<string, McpServerConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<typeof EMPTY_FORM>>({});

  useEffect(() => {
    bf.listMcpServers(agentId)
      .then(r => setServers(r.servers))
      .catch(() => setServers({}))
      .finally(() => setLoading(false));
  }, [agentId]);

  const validateForm = () => {
    const errs: Partial<typeof EMPTY_FORM> = {};
    if (!form.id.trim() || !/^[a-z0-9_-]+$/.test(form.id.trim())) errs.id = "ID: lowercase letters, numbers, - or _";
    if (!form.command.trim()) errs.command = "Command is required";
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleAdd = async () => {
    if (!validateForm()) return;
    setSaving(true);
    setError(null);
    try {
      const args = form.args.trim() ? form.args.split(/\s+/).filter(Boolean) : [];
      const env: Record<string, string> = {};
      for (const line of form.env.split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
      await bf.addMcpServer(agentId, { id: form.id.trim(), command: form.command.trim(), args, env });
      const r = await bf.listMcpServers(agentId);
      setServers(r.servers);
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add server");
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (preset: McpPreset) => {
    let id = preset.id;
    let n = 2;
    while (servers[id]) {
      id = `${preset.id}-${n++}`;
    }
    setForm({
      id,
      command: preset.command,
      args: preset.args,
      env: preset.envHints ?? "",
    });
    setFormErrors({});
    setShowForm(true);
  };

  const handleRemove = async (id: string) => {
    setRemoving(id);
    setError(null);
    try {
      await bf.removeMcpServer(agentId, id);
      setServers(prev => { const n = { ...prev }; delete n[id]; return n; });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove server");
    } finally {
      setRemoving(null);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-12" style={{ color: "var(--bf-gray)" }}>
      <Loader2 size={20} className="animate-spin mr-2" /> Loading…
    </div>
  );

  const entries = Object.entries(servers);

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p
          className="rounded p-2 text-sm border"
          style={{
            color: "var(--bf-yellow)",
            background: "color-mix(in srgb, var(--bf-accent) 18%, transparent)",
            borderColor: "var(--bf-quinary)",
          }}
        >
          {error}
        </p>
      )}

      {entries.length === 0 && !showForm && (
        <div className="flex flex-col items-center gap-2 py-8" style={{ color: "var(--bf-gray)" }}>
          <Server size={28} strokeWidth={1.5} />
          <p className="text-sm">No MCP servers configured yet.</p>
        </div>
      )}

      {entries.map(([id, cfg]) => (
        <div
          key={id}
          className="flex items-start gap-3 rounded-lg px-3 py-2.5"
          style={{ background: "var(--bf-quaternary)", border: "1px solid var(--bf-quinary)" }}
        >
          <Server size={14} style={{ color: "var(--bf-accent)", flexShrink: 0, marginTop: 3 }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--on-ink)]">{id}</p>
            <p className="text-xs font-mono mt-0.5 truncate" style={{ color: "var(--bf-gray)" }}>
              {cfg.command}{cfg.args?.length ? " " + cfg.args.join(" ") : ""}
            </p>
            {Object.keys(cfg.env ?? {}).length > 0 && (
              <p className="text-xs mt-0.5" style={{ color: "var(--bf-symbol)" }}>
                {Object.keys(cfg.env).length} env var{Object.keys(cfg.env).length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className="text-xs px-1.5 py-0.5 rounded font-semibold"
              style={{
                background: cfg.enabled ? "rgba(110,134,214,0.15)" : "rgba(75,85,99,0.3)",
                color: cfg.enabled ? "var(--bf-accent)" : "var(--bf-gray)",
              }}
            >
              {cfg.enabled ? "enabled" : "disabled"}
            </span>
            {canManage && (
              <button
                onClick={() => handleRemove(id)}
                disabled={removing === id}
                className="rounded p-1 transition-colors disabled:opacity-40 hover:bg-[color-mix(in_srgb,var(--bf-accent)_18%,transparent)]"
                title="Remove server"
              >
                {removing === id
                  ? <Loader2 size={13} className="animate-spin" style={{ color: "var(--bf-gray)" }} />
                  : <Trash2 size={13} style={{ color: "var(--bf-symbol)" }} />
                }
              </button>
            )}
          </div>
        </div>
      ))}

      {showForm && canManage && (
        <div
          className="rounded-lg p-3 flex flex-col gap-3"
          style={{ background: "var(--bf-quaternary)", border: "1px solid var(--bf-quinary)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--bf-gray)" }}>New MCP Server</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <ModalLabel>Server ID <span style={{ color: "var(--bf-fire)" }}>*</span></ModalLabel>
              <ModalInput
                type="text"
                value={form.id}
                onChange={e => setForm(p => ({ ...p, id: e.target.value }))}
                placeholder="my-mcp-server"
                autoComplete="off"
              />
              {formErrors.id && <p className="text-xs mt-1" style={{ color: "var(--bf-yellow)" }}>{formErrors.id}</p>}
            </div>
            <div>
              <ModalLabel>Command <span style={{ color: "var(--bf-fire)" }}>*</span></ModalLabel>
              <ModalInput
                type="text"
                value={form.command}
                onChange={e => setForm(p => ({ ...p, command: e.target.value }))}
                placeholder="npx"
                autoComplete="off"
              />
              {formErrors.command && <p className="text-xs mt-1" style={{ color: "var(--bf-yellow)" }}>{formErrors.command}</p>}
            </div>
            <div className="sm:col-span-2">
              <ModalLabel>Arguments</ModalLabel>
              <ModalInput
                type="text"
                value={form.args}
                onChange={e => setForm(p => ({ ...p, args: e.target.value }))}
                placeholder="-y @modelcontextprotocol/server-filesystem /path"
                autoComplete="off"
              />
              <p className="text-xs mt-1" style={{ color: "var(--bf-gray)" }}>Space-separated args</p>
            </div>
            <div className="sm:col-span-2">
              <ModalLabel>Environment variables</ModalLabel>
              <textarea
                rows={3}
                value={form.env}
                onChange={e => setForm(p => ({ ...p, env: e.target.value }))}
                placeholder={"API_KEY=abc123\nANOTHER_VAR=value"}
                className="w-full rounded px-3 py-2 text-sm font-mono resize-y"
                style={{
                  background: "var(--bf-tertiary)",
                  border: "1px solid var(--bf-quinary)",
                  color: "var(--bf-white)",
                  outline: "none",
                }}
              />
              <p className="text-xs mt-1" style={{ color: "var(--bf-gray)" }}>One KEY=VALUE per line</p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setFormErrors({}); }}
              className="px-3 py-1.5 text-sm rounded"
              style={{ color: "var(--bf-gray)" }}
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded disabled:opacity-40"
              style={{ background: "var(--bf-accent)", color: "var(--bf-primary)" }}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Add Server
            </button>
          </div>
        </div>
      )}

      {!showForm && canManage && (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5" style={{ color: "var(--bf-gray)" }}>
              <Sparkles size={11} /> Suggested servers
            </p>
            <div className="flex flex-wrap gap-2">
              {MCP_PRESETS.map(p => {
                const added = !!servers[p.id] || Object.keys(servers).some(k => k.startsWith(p.id + "-"));
                const tooltip = p.archived
                  ? `${p.description}\n\nNote: package is archived but still works.`
                  : p.description;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p)}
                    title={tooltip}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-full transition-colors"
                    style={{
                      background: added ? "rgba(110,134,214,0.18)" : "var(--bf-tertiary)",
                      color: added ? "var(--bf-accent)" : "var(--bf-white)",
                      border: `1px solid ${added ? "var(--bf-accent)" : "var(--bf-quinary)"}`,
                    }}
                  >
                    {added && <span style={{ color: "var(--bf-accent)" }}>✓</span>}
                    {p.name}
                    {p.archived && (
                      <span
                        className="rounded-full"
                        style={{ width: 5, height: 5, background: "#7a5013", display: "inline-block" }}
                        aria-label="archived package"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg transition-colors self-start"
            style={{ background: "var(--bf-quaternary)", color: "var(--bf-accent)", border: "1px dashed var(--bf-accent)" }}
          >
            <Plus size={14} />
            Add custom server
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// iNFT Visualiser
// ---------------------------------------------------------------------------

const OG_EXPLORER = "https://chainscan-galileo.0g.ai";
const OG_STORAGE_EXPLORER = "http://storagescan-galileo.0g.ai";

function ogHashFromUri(uri: string): string {
  return uri.startsWith("og://") ? uri.slice(5) : uri;
}

function truncate(s: string, start = 6, end = 4) {
  if (s.length <= start + end + 3) return s;
  return `${s.slice(0, start)}…${s.slice(-end)}`;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      title="Copy"
      className="p-1 rounded transition-colors flex-shrink-0 hover:bg-[color-mix(in_srgb,var(--bf-blanche)_12%,transparent)]"
    >
      {copied
        ? <Check size={12} style={{ color: "var(--bf-accent)" }} />
        : <Copy size={12} style={{ color: "var(--bf-gray)" }} />
      }
    </button>
  );
}

function HashRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5" style={{ borderBottom: "1px solid var(--bf-quinary)" }}>
      <span className="text-xs flex-shrink-0" style={{ color: "var(--bf-gray)" }}>{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <code className="text-xs font-mono truncate" style={{ color: "var(--bf-accent)" }}>{truncate(value, 8, 6)}</code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

interface ManifestData {
  name?: string;
  description?: string;
  tags?: string[];
  soul?: string;
  llm?: { provider?: string; model?: string };
  avatarUrl?: string | null;
  [key: string]: unknown;
}

function ManifestViewer({ agentId }: { agentId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setState("loading");
    try {
      const { manifest: m } = await bf.getAgentManifest(agentId);
      setManifest(m as ManifestData);
      setState("done");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to fetch manifest");
      setState("error");
    }
  };

  if (state === "idle") {
    return (
      <button
        onClick={load}
        className="text-xs px-2 py-1 rounded font-semibold transition-colors"
        style={{ background: "var(--bf-quaternary)", color: "var(--bf-accent)", border: "1px solid var(--bf-quinary)" }}
      >
        View manifest
      </button>
    );
  }
  if (state === "loading") return <span className="text-xs" style={{ color: "var(--bf-gray)" }}>Loading…</span>;
  if (state === "error") return <span className="text-xs" style={{ color: "var(--bf-yellow)" }}>{err}</span>;
  if (!manifest) return null;

  return (
    <div className="mt-2 rounded-lg overflow-hidden" style={{ border: "1px solid var(--bf-quinary)" }}>
      {/* Metadata fields */}
      <div className="px-3 py-2 flex flex-col gap-1.5" style={{ background: "var(--bf-tertiary)" }}>
        {manifest.tags && manifest.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {manifest.tags.map(t => (
              <span key={t} className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "var(--bf-quaternary)", color: "var(--bf-accent)" }}>{t}</span>
            ))}
          </div>
        )}
        {manifest.llm && (
          <p className="text-xs" style={{ color: "var(--bf-gray)" }}>
            Model: <span style={{ color: "var(--bf-white)" }}>{manifest.llm.provider ?? "—"} / {manifest.llm.model ?? "default"}</span>
          </p>
        )}
        {manifest.soul && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--bf-gray)" }}>Soul preview</p>
            <p className="text-xs leading-relaxed font-mono" style={{ color: "var(--bf-white)", whiteSpace: "pre-wrap" }}>
              {manifest.soul.slice(0, 300)}{manifest.soul.length > 300 ? "…" : ""}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const BLOB_DEFS = [
  {
    key: "manifestUri" as const,
    label: "Public Manifest",
    icon: FileText,
    color: "var(--bf-accent)",
    desc: "Plaintext JSON stored on 0G — contains name, description, tags, soul, and model config. Anyone can read this.",
    viewable: true,
  },
  {
    key: "bundleUri" as const,
    label: "Encrypted Bundle",
    icon: Lock,
    color: "var(--bf-symbol)",
    desc: "AES-256-GCM encrypted blob containing soul, operating rules, and LLM config. Only the platform executor can decrypt this.",
    viewable: false,
  },
  {
    key: "sealedDEKBaseUri" as const,
    label: "Sealed DEK",
    icon: Key,
    color: "var(--bf-yellow)",
    desc: "ECIES-sealed Data Encryption Key. Used by the platform executor to decrypt the bundle at inference time.",
    viewable: false,
  },
] as const;

function InftVisualiser({ agent }: { agent: Agent }) {
  const isMinted = !!agent.tokenId;
  const explorerTokenUrl = agent.contractAddress && agent.tokenId
    ? `${OG_EXPLORER}/token/${agent.contractAddress}?a=${agent.tokenId}`
    : null;
  const explorerWalletUrl = agent.ownerWallet
    ? `${OG_EXPLORER}/address/${agent.ownerWallet}`
    : null;

  return (
    <div className="flex flex-col gap-4">

      {/* ── iNFT Token Card ── */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: "1px solid var(--bf-fire)", background: "var(--bf-secondary)" }}
      >
        {/* Fire gradient header bar */}
        <div
          className="h-1.5 w-full"
          style={{ background: "linear-gradient(90deg, var(--bf-fire), var(--bf-accent))" }}
        />

        <div className="px-4 py-3 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Flame size={15} style={{ color: "var(--bf-fire)" }} strokeWidth={2} />
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--bf-fire)" }}>iNFT Token</span>
          </div>

          {isMinted ? (
            <>
              {/* Token ID */}
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-4xl font-black text-[var(--on-ink)]">#{agent.tokenId}</span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: "color-mix(in srgb, var(--bf-plum) 18%, transparent)", color: "var(--bf-fire)" }}
                >
                  BonFireAgentINFT
                </span>
              </div>

              {/* On-chain fields */}
              <div className="flex flex-col divide-y-0 gap-0">
                {agent.contractAddress && <HashRow label="Contract" value={agent.contractAddress} />}
                {agent.ownerWallet && <HashRow label="Owner" value={agent.ownerWallet} />}
                {agent.bundleHash && <HashRow label="Bundle hash" value={agent.bundleHash} />}
              </div>

              {/* Explorer links */}
              <div className="flex flex-wrap gap-2 pt-1">
                {explorerTokenUrl && (
                  <a
                    href={explorerTokenUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition-opacity hover:opacity-80"
                    style={{ background: "var(--bf-fire)", color: "var(--bf-blanche)" }}
                  >
                    <ExternalLink size={12} strokeWidth={2} />
                    View on 0G Explorer
                  </a>
                )}
                {explorerWalletUrl && (
                  <a
                    href={explorerWalletUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition-opacity hover:opacity-80"
                    style={{ background: "var(--bf-quaternary)", color: "var(--bf-gray)", border: "1px solid var(--bf-quinary)" }}
                  >
                    <ExternalLink size={12} strokeWidth={2} />
                    Owner wallet
                  </a>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <Flame size={28} strokeWidth={1.5} style={{ color: "var(--bf-fire)", opacity: 0.4 }} />
              <p className="text-sm font-semibold text-[var(--on-ink)]">Not yet minted as an iNFT</p>
              <p className="text-xs max-w-xs leading-relaxed" style={{ color: "var(--bf-gray)" }}>
                This agent has not been minted on-chain. iNFTs bind the agent&apos;s soul, skills, and encrypted config to a token on the 0G network.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── 0G Storage Blobs ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Box size={14} style={{ color: "var(--bf-gray)" }} />
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--bf-gray)" }}>0G Storage Blobs</span>
        </div>

        {!isMinted ? (
          <p className="text-xs py-4 text-center" style={{ color: "var(--bf-gray)" }}>No blobs — agent not minted yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {BLOB_DEFS.map(({ key, label, icon: Icon, color, desc, viewable }) => {
              const uri = agent[key];
              return (
                <div
                  key={key}
                  className="rounded-lg overflow-hidden"
                  style={{ border: "1px solid var(--bf-quinary)", borderLeft: `3px solid ${color}` }}
                >
                  <div className="px-3 py-2.5 flex items-start gap-3" style={{ background: "var(--bf-quaternary)" }}>
                    <Icon size={14} strokeWidth={2} style={{ color, flexShrink: 0, marginTop: 2 }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-[var(--foreground)]">{label}</span>
                        {!viewable && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{
                              background: "color-mix(in srgb, var(--bf-yellow) 16%, transparent)",
                              color: "var(--bf-yellow)",
                            }}
                          >
                            encrypted
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--bf-gray)" }}>{desc}</p>
                      {uri && (
                        <div className="flex items-center gap-1 mt-1.5">
                          <code className="text-xs font-mono truncate" style={{ color: "var(--bf-symbol)" }}>
                            {truncate(uri, 14, 8)}
                          </code>
                          <CopyButton value={ogHashFromUri(uri)} />
                          <a
                            href={OG_STORAGE_EXPLORER}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open 0G Storage Explorer — paste the copied hash into the search box"
                            onClick={() => navigator.clipboard?.writeText(ogHashFromUri(uri))}
                            className="flex-shrink-0 hover:opacity-80"
                            style={{ color: "var(--bf-accent)" }}
                          >
                            <ExternalLink size={11} strokeWidth={2} />
                          </a>
                        </div>
                      )}
                      {viewable && (
                        <div className="mt-2">
                          <ManifestViewer agentId={agent.id} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Metadata leverage explainer ── */}
      {isMinted && (
        <div
          className="rounded-lg px-4 py-3 text-xs leading-relaxed"
          style={{ background: "var(--bf-quaternary)", border: "1px solid var(--bf-quinary)", color: "var(--bf-gray)" }}
        >
          <p className="font-semibold text-[var(--on-ink)] mb-1">How BonFire uses this data</p>
          <ul className="flex flex-col gap-1 list-disc list-inside">
            <li>The <span style={{ color: "var(--bf-accent)" }}>Public Manifest</span> populates the marketplace listing — name, bio, tags, and model info.</li>
            <li>The <span style={{ color: "var(--bf-symbol)" }}>Encrypted Bundle</span> is decrypted by the platform executor at inference time to restore the agent&apos;s soul and config.</li>
            <li>The <span style={{ color: "var(--bf-yellow)" }}>Sealed DEK</span> ensures only the authorised executor can decrypt the bundle — enforced by ECIES + TEE.</li>
            <li>The <span style={{ color: "var(--bf-fire)" }}>bundle hash</span> is written on-chain at mint and verified on every bundle load — tamper-proof.</li>
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

const ADAPTERS = [
  { id: "telegram", label: "Telegram",    Icon: SiTelegram, color: "#2AABEE", active: true  },
  { id: "whatsapp", label: "WhatsApp",    Icon: SiWhatsapp, color: "#25D366", active: false },
  { id: "discord",  label: "Discord",     Icon: SiDiscord,  color: "#0d0d0f", active: false },
  { id: "slack",    label: "Slack",       Icon: SiSlack,    color: "#4A154B", active: false },
  { id: "x",        label: "X / Twitter", Icon: SiX,        color: "#ffffff", active: false },
];

// ---------------------------------------------------------------------------
// Overview stats — reported model (or the 0G Private Computer label) + real invite earnings
// ---------------------------------------------------------------------------

function OverviewStats({ agentId }: { agentId: string }) {
  const [priceOg, setPriceOg] = useState<string | null>(null);
  const [modelLabel, setModelLabel] = useState(() => profileModelLabel(null));
  const [displayed, setDisplayed] = useState("0.000000");
  const accRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    // One request when the profile opens (never per sidebar row): the model the backend reports, if any.
    bf.getAgentConfig(agentId).then((cfg) => { if (!cancelled) setModelLabel(profileModelLabel(cfg.model)); }).catch(() => {});

    bf.getAgentEarnings(agentId).catch(() => ({ totalEarnedOg: "0", priceOg: "0" })).then((earnings) => {
      if (cancelled) return;
      const price = earnings.priceOg ?? "0";
      setPriceOg(price);
      const seed = parseFloat(earnings.totalEarnedOg ?? "0");
      accRef.current = seed;
      // Show the real lifetime invite earnings from the backend. (It used to tick upward with
      // Math.random(), displaying OG the agent never earned.)
      setDisplayed(seed.toFixed(6));
    });

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [agentId]);

  const inviteLabel = priceOg === null ? "—" : priceOg === "0" ? "Free" : `${priceOg} OG`;

  return (
    <div className="grid grid-cols-3 gap-3 text-sm">
      {/* Model */}
      <div className="rounded-lg p-3" style={{ background: "var(--bf-quaternary)" }}>
        <p className="text-xs uppercase tracking-wide mb-1 font-semibold" style={{ color: "var(--bf-gray)" }}>Model</p>
        <p className="text-[var(--foreground)] font-semibold text-sm truncate" title={modelLabel}>
          {modelLabel}
        </p>
      </div>

      {/* Animated earnings */}
      <div className="rounded-lg p-3" style={{ background: "var(--bf-quaternary)" }}>
        <p className="text-xs uppercase tracking-wide mb-1 font-semibold flex items-center gap-1.5" style={{ color: "var(--bf-gray)" }}>
          Earned
          <span className="relative flex h-1.5 w-1.5">
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
              style={{ background: "#1f6b55" }}
            />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: "#1f6b55" }} />
          </span>
        </p>
        <p className="font-semibold text-sm tabular-nums" style={{ color: "#1f6b55" }}>
          {displayed} <span className="text-xs font-normal" style={{ color: "var(--bf-gray)" }}>OG</span>
        </p>
      </div>

      {/* Invite price */}
      <div className="rounded-lg p-3" style={{ background: "var(--bf-quaternary)" }}>
        <p className="text-xs uppercase tracking-wide mb-1 font-semibold" style={{ color: "var(--bf-gray)" }}>Invite Price</p>
        <p className="text-[var(--foreground)] font-semibold text-sm">{inviteLabel}</p>
      </div>
    </div>
  );
}

function AdaptersSection() {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide mb-2 font-semibold" style={{ color: "var(--bf-gray)" }}>
        Connections
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {ADAPTERS.map(a => (
          <div
            key={a.id}
            className="rounded-lg p-2.5 flex items-center gap-2.5"
            style={{
              background: "var(--bf-quaternary)",
              border: `1px solid ${a.active ? "var(--bf-accent)" : "var(--bf-quinary)"}`,
              opacity: a.active ? 1 : 0.65,
            }}
          >
            <a.Icon size={18} color={a.active ? a.color : "var(--bf-gray)"} />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--foreground)] leading-tight">{a.label}</p>
              <p
                className="text-xs leading-tight mt-0.5"
                style={{ color: a.active ? "#1f6b55" : "var(--bf-gray)" }}
              >
                {a.active ? "● Active" : "Coming soon"}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


