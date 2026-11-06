'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Plus, ImagePlus, Share2, MoreHorizontal, X,
  Flame, Sparkles, Bot, MessageSquare, Pencil,
} from 'lucide-react';
import { bf } from '@/lib/api-bonfire';
import { agentAvatarDisplayUrl } from '@/lib/agent-identicon';
import FlameAvatar from '@/components/shared/FlameAvatar';
import { useAuth } from '@/components/auth/AuthProvider';
import type { BackendAgent } from '@/lib/types';

function truncateAddr(addr: string) {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
import InviteAgentToServerModal from '@/components/marketplace/InviteAgentToServerModal';
import CreateAgentModal from '@/components/marketplace/CreateAgentModal';
import SkillManager from '@/components/agent/SkillManager';
import { McpManager } from '@/components/agent/AgentProfileModal';
import LeftNav from '@/components/layout/LeftNav';
import StatusBar from '@/components/layout/StatusBar';
import DmSidebar, { upsertDmSession } from '@/components/dm/DmSidebar';
import Avatar from '@/components/shared/BoringAvatar';

const CATEGORY_COLOR: Record<string, string> = {
  Research: '#0d0d0f',
  Code: '#1f6b55',
  Finance: '#0d0d0f',
  Voice: '#0d0d0f',
  Generalist: '#0d0d0f',
};

/** Marble variant + “Pop” palette (boringavatars.com presets). */
const MARBLE_POP_COLORS = ['#ffad08', '#edd75a', '#73b06f', '#0c8f8f', '#405059'];

function agentBannerSeed(agent: BackendAgent) {
  return agent.slug || agent.id || agent.name;
}

function MarketplaceAgentCardBanner({ agent }: { agent: BackendAgent }) {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      <Avatar
        name={agentBannerSeed(agent)}
        variant="marble"
        colors={MARBLE_POP_COLORS}
        square
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        style={{ display: 'block' }}
      />
    </div>
  );
}
// ── Price label ───────────────────────────────────────────────────────────────

function PriceLabel({ agent }: { agent: BackendAgent }) {
  const price = parseFloat(agent.priceOg ?? '0');
  const priced = Number.isFinite(price) && price > 0;
  return (
    <span
      className="text-xs px-2 py-0.5 rounded font-semibold"
      style={{
        background: priced ? 'rgba(251,191,36,0.15)' : 'rgba(67,181,129,0.15)',
        color: priced ? '#7a5013' : '#1f6b55',
      }}
    >
      {priced ? `${agent.priceOg} OG` : 'Free'}
    </span>
  );
}

// ── Edit agent modal ──────────────────────────────────────────────────────────

function EditAgentModal({ agent, onClose, onSaved }: {
  agent: BackendAgent;
  onClose: () => void;
  onSaved: (updated: BackendAgent) => void;
}) {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [priceOg, setPriceOg] = useState(agent.priceOg ?? '0');
  const [tags, setTags] = useState((agent.tags ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await bf.patchAgent(agent.id, {
        name: name.trim(),
        description: description.trim(),
        priceOg: priceOg.trim() || '0',
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      });
      onSaved(res.agent);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, el: React.ReactNode) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--bf-gray)' }}>{label}</label>
      {el}
    </div>
  );

  const inputCls = "w-full rounded-lg px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--bf-accent)]";
  const inputStyle = { background: 'var(--bf-quaternary)', border: '1px solid var(--bf-quinary)' };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col"
        style={{ background: 'var(--bf-secondary)', border: '1px solid var(--bf-quinary)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--bf-quaternary)' }}>
          <h3 className="text-[var(--foreground)] font-bold text-base">Edit Agent</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bf-quinary)]" style={{ color: 'var(--bf-gray)' }}>
            <X size={15} />
          </button>
        </div>

        {/* Fields */}
        <div className="flex flex-col gap-4 px-5 py-4 overflow-y-auto" style={{ maxHeight: '60vh' }}>
          {field('Name', (
            <input className={inputCls} style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Agent name" />
          ))}
          {field('Description', (
            <textarea
              className={inputCls} style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }}
              value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description"
            />
          ))}
          {field('Invite Price (OG)', (
            <input className={inputCls} style={inputStyle} value={priceOg} onChange={e => setPriceOg(e.target.value)} placeholder="0" type="number" min="0" step="0.01" />
          ))}
          {field('Tags (comma-separated)', (
            <input className={inputCls} style={inputStyle} value={tags} onChange={e => setTags(e.target.value)} placeholder="Research, Code, Finance" />
          ))}
          {error && <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'rgba(240,91,91,0.12)', color: 'var(--bf-red)' }}>{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--bf-quaternary)' }}>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: 'var(--bf-quaternary)', color: 'var(--bf-gray)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg text-sm font-bold text-[var(--on-ink)] transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--bf-accent)' }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detail overlay ────────────────────────────────────────────────────────────

interface AgentEarnings {
  totalEarnedOg: string;
  paidInviteCount: number;
  events: Array<{
    serverId: string;
    amount: string;
    txHash: string | null;
    joinedAt: string;
  }>;
}

function AgentDetailOverlay({
  agent: initialAgent,
  onClose,
  onInvite,
  onMessage,
  onAgentUpdated,
}: {
  agent: BackendAgent;
  onClose: () => void;
  onInvite: (a: BackendAgent) => void;
  onMessage: (a: BackendAgent) => void;
  onAgentUpdated?: (updated: BackendAgent) => void;
}) {
  const [agent, setAgent] = useState(initialAgent);
  const [showEdit, setShowEdit] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'skills' | 'mcp'>('overview');
  const { user } = useAuth();
  const walletAddress = user?.walletAddress ?? null;
  const isCreator = !!walletAddress && !!agent.ownerWallet &&
    agent.ownerWallet.toLowerCase() === walletAddress.toLowerCase();

  const agentPrice = parseFloat(agent.priceOg ?? '0');
  const priced = Number.isFinite(agentPrice) && agentPrice > 0;

  const handleSaved = (updated: BackendAgent) => {
    setAgent(updated);
    onAgentUpdated?.(updated);
  };

  // Lifetime invite earnings for the agent (public; no auth needed).
  const [earnings, setEarnings] = useState<AgentEarnings | null>(null);
  const [earningsLoading, setEarningsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setEarningsLoading(true);
    bf.getAgentEarnings(agent.slug)
      .then((r) => {
        if (cancelled) return;
        setEarnings({
          totalEarnedOg: r.totalEarnedOg,
          paidInviteCount: r.paidInviteCount,
          events: r.events.map((e) => ({
            serverId: e.serverId,
            amount: e.amount,
            txHash: e.txHash,
            joinedAt: e.joinedAt,
          })),
        });
      })
      .catch(() => {
        if (!cancelled) setEarnings({ totalEarnedOg: '0.0', paidInviteCount: 0, events: [] });
      })
      .finally(() => { if (!cancelled) setEarningsLoading(false); });
    return () => { cancelled = true; };
  }, [agent.slug]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <div
        className="m-auto w-full max-w-3xl rounded-2xl overflow-hidden shadow-2xl flex flex-col"
        style={{ background: 'var(--bf-secondary)', maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Banner — z-10 so avatar (translate-y-1/2) paints above the body below */}
        <div className="relative z-10 h-44 flex-shrink-0">
          <MarketplaceAgentCardBanner agent={agent} />
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.4)', color: 'var(--foreground)' }}
          >
            <X size={16} />
          </button>
          <FlameAvatar
            slug={agent.slug}
            avatarUrl={agent.avatarUrl}
            size={80}
            className="absolute bottom-0 left-6 z-10 translate-y-1/2 border-4"
            style={{ borderRadius: '1rem', borderColor: 'var(--bf-secondary)' }}
          />
        </div>

        {/* Action bar */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--bf-quaternary)' }}>
          <button className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--bf-quinary)]" style={{ color: 'var(--bf-gray)' }}>
            <Share2 size={15} />
          </button>
          <button className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--bf-quinary)]" style={{ color: 'var(--bf-gray)' }}>
            <MoreHorizontal size={15} />
          </button>
          {isCreator && (
            <button
              onClick={() => setShowEdit(true)}
              className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-colors"
              style={{ background: 'var(--bf-quaternary)', color: 'var(--bf-gray)', border: '1px solid var(--bf-quinary)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--foreground)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bf-gray)'; }}
            >
              <Pencil size={13} />
              Edit
            </button>
          )}
          <button
            onClick={() => { onMessage(agent); onClose(); }}
            className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5"
            style={{ background: 'var(--bf-quinary)', color: 'var(--foreground)' }}
          >
            <MessageSquare size={14} />
            Message
          </button>
          <button
            onClick={() => { onInvite(agent); onClose(); }}
            className="px-5 py-2 rounded-lg text-sm font-bold text-[var(--on-ink)] flex items-center gap-2"
            style={{ background: 'var(--bf-accent)' }}
          >
            {priced && (
              <span className="text-xs font-semibold opacity-90">{agent.priceOg} OG</span>
            )}
            Add to Server
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 flex-shrink-0" style={{ borderBottom: '1px solid var(--bf-quaternary)' }}>
          {(['overview', 'skills', 'mcp'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2 text-sm font-semibold capitalize transition-colors"
              style={{
                color: activeTab === tab ? 'var(--bf-white)' : 'var(--bf-gray)',
                borderBottom: activeTab === tab ? '2px solid var(--bf-accent)' : '2px solid transparent',
              }}
            >
              {tab === 'mcp' ? 'MCP Servers' : tab === 'skills' ? 'Skills' : 'Overview'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left */}
          <div className="flex-1 overflow-y-auto px-6 pt-4 pb-6">
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-[var(--foreground)] text-2xl font-bold">{agent.name}</h2>
              <span className="text-xs px-2 py-0.5 rounded font-semibold" style={{ background: 'var(--bf-accent)', color: 'var(--on-ink)' }}>BOT</span>
              <PriceLabel agent={agent} />
            </div>
            <p className="text-sm mb-1" style={{ color: 'var(--bf-gray)' }}>@{agent.slug}</p>
            <p className="text-sm mb-4" style={{ color: 'var(--bf-gray)' }}>{agent.description}</p>

            {activeTab === 'overview' && (
              <>
                {/* Screenshot placeholder */}
                <div className="mb-6 rounded-xl flex items-center justify-center" style={{ background: 'var(--bf-quaternary)', aspectRatio: '16/9' }}>
                  <div className="text-center">
                    <ImagePlus size={32} style={{ color: 'var(--bf-gray)', margin: '0 auto 8px' }} />
                    <p className="text-xs" style={{ color: 'var(--bf-gray)' }}>No screenshots uploaded</p>
                  </div>
                </div>

                {/* Tags */}
                {agent.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {agent.tags.map(t => (
                      <span key={t} className="text-xs px-2.5 py-1 rounded-full font-medium"
                        style={{ background: (CATEGORY_COLOR[t] ?? '#888') + '33', color: CATEGORY_COLOR[t] ?? '#888' }}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}

            {activeTab === 'skills' && (
              <SkillManager agentId={agent.id} canManage={isCreator} />
            )}

            {activeTab === 'mcp' && (
              <McpManager agentId={agent.id} canManage={isCreator} />
            )}
          </div>

          {/* Right sidebar */}
          <div className="w-64 flex-shrink-0 px-4 pt-6 pb-6 overflow-y-auto border-l flex flex-col gap-5" style={{ borderColor: 'var(--bf-quaternary)' }}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--bf-gray)' }}>Details</p>
              <div className="flex flex-col gap-2">
                <DetailRow label="Slug" value={`@${agent.slug}`} />
                <DetailRow label="Created" value={new Date(agent.createdAt).toLocaleDateString()} />
                <DetailRow
                  label="Invite price"
                  value={priced ? `${agent.priceOg} OG` : 'Free'}
                  color={priced ? '#7a5013' : '#1f6b55'}
                />
                {agent.ownerWallet && (
                  <DetailRow label="Creator" value={truncateAddr(agent.ownerWallet)} mono />
                )}
              </div>
            </div>

            {/* ── Earnings panel ─────────────────────────────────────── */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--bf-gray)' }}>
                Earnings
              </p>
              <div
                className="rounded-lg p-3"
                style={{ background: 'var(--bf-quaternary)' }}
              >
                {earningsLoading ? (
                  <p className="text-xs" style={{ color: 'var(--bf-gray)' }}>Loading…</p>
                ) : earnings && earnings.paidInviteCount > 0 ? (
                  <>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xl font-bold" style={{ color: '#7a5013' }}>
                        {earnings.totalEarnedOg}
                      </span>
                      <span className="text-xs font-semibold" style={{ color: 'var(--bf-gray)' }}>OG</span>
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--bf-gray)' }}>
                      {earnings.paidInviteCount} paid invite{earnings.paidInviteCount === 1 ? '' : 's'}
                    </p>
                    {earnings.events.length > 0 && (
                      <div className="mt-3 flex flex-col gap-1.5 pt-2" style={{ borderTop: '1px solid var(--bf-quinary)' }}>
                        {earnings.events.slice(0, 5).map((ev) => (
                          <div key={`${ev.serverId}-${ev.joinedAt}`} className="flex items-center justify-between gap-2">
                            <span className="text-xs truncate" style={{ color: 'var(--bf-gray)' }}>
                              {new Date(ev.joinedAt).toLocaleDateString()}
                            </span>
                            <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--foreground)' }}>
                              +{ev.amount} OG
                            </span>
                          </div>
                        ))}
                        {earnings.events.length > 5 && (
                          <p className="text-xs mt-1" style={{ color: 'var(--bf-gray)' }}>
                            + {earnings.events.length - 5} earlier
                          </p>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs" style={{ color: 'var(--bf-gray)' }}>No paid invites yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showEdit && (
        <EditAgentModal
          agent={agent}
          onClose={() => setShowEdit(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function DetailRow({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--bf-gray)' }}>{label}</span>
      <span className={`text-xs font-medium text-right${mono ? ' font-mono' : ''}`} style={{ color: color ?? 'var(--foreground)' }}>{value}</span>
    </div>
  );
}

// ── Agent card ────────────────────────────────────────────────────────────────

function renderAgentCard(
  agent: BackendAgent,
  handlers: {
    setDetailAgent: (a: BackendAgent) => void;
    startDm: (a: BackendAgent) => void;
    openInvite: (a: BackendAgent) => void;
  },
) {
  const { setDetailAgent, startDm, openInvite } = handlers;
  return (
    <div key={agent.id}
      className="rounded-xl overflow-hidden cursor-pointer"
      style={{ background: 'var(--bf-secondary)' }}
      onClick={() => setDetailAgent(agent)}
    >
      {/* Mini banner */}
      <div className="relative z-10 h-16">
        <MarketplaceAgentCardBanner agent={agent} />
        <FlameAvatar
          slug={agent.slug}
          avatarUrl={agent.avatarUrl}
          size={52}
          className="absolute bottom-0 left-3 z-10 translate-y-1/2 border-2"
          style={{ borderRadius: '0.5rem', borderColor: 'var(--bf-secondary)' }}
        />
      </div>
      <div className="pt-9 px-4 pb-4 flex flex-col gap-2">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[var(--foreground)] font-bold text-sm">{agent.name}</span>
            </div>
            {agent.tags[0] && (
              <span className="text-xs px-2 py-0.5 rounded font-medium"
                style={{ background: (CATEGORY_COLOR[agent.tags[0]] ?? '#888') + '33', color: CATEGORY_COLOR[agent.tags[0]] ?? '#888' }}>
                {agent.tags[0]}
              </span>
            )}
          </div>
          <PriceLabel agent={agent} />
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--bf-gray)' }}>{agent.description}</p>
        {agent.ownerWallet && (
          <p className="text-xs font-mono" style={{ color: 'var(--bf-symbol)' }}>
            by {truncateAddr(agent.ownerWallet)}
          </p>
        )}
        <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: 'var(--bf-quaternary)' }}>
          <p className="text-xs" style={{ color: 'var(--bf-symbol)' }}>@{agent.slug}</p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={e => { e.stopPropagation(); startDm(agent); }}
              className="text-xs px-2.5 py-1.5 rounded font-semibold flex items-center gap-1"
              style={{ background: 'var(--bf-white)', color: 'var(--bf-primary)' }}
            >
              <MessageSquare size={11} />
              Message
            </button>
            <button
              onClick={e => { e.stopPropagation(); openInvite(agent); }}
              className="text-xs px-2.5 py-1.5 rounded font-semibold text-[var(--on-ink)]"
              style={{ background: 'var(--bf-accent)' }}
            >
              Invite
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({
  hasAgents,
  query,
  onClearSearch,
  onCreateAgent,
}: {
  hasAgents: boolean;
  query: string;
  onClearSearch: () => void;
  onCreateAgent?: () => void;
}) {
  const isFiltered = hasAgents && query;

  if (isFiltered) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-5">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: 'var(--bf-secondary)' }}
        >
          <Search size={28} style={{ color: 'var(--bf-gray)' }} />
        </div>
        <div className="text-center">
          <p className="text-[var(--foreground)] font-semibold text-base mb-1">No agents found</p>
          <p className="text-sm" style={{ color: 'var(--bf-gray)' }}>
            No results for <span className="text-[var(--foreground)] font-medium">&ldquo;{query}&rdquo;</span>. Try a different search.
          </p>
        </div>
        <button
          onClick={onClearSearch}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-[var(--on-ink)] transition-opacity hover:opacity-80"
          style={{ background: 'var(--bf-accent)' }}
        >
          Clear filters
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6">
      {/* Glyph cluster */}
      <div className="relative w-24 h-24">
        <div
          className="absolute inset-0 rounded-3xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#0a0014 0%,#2a0060 50%,#0d0d0f 100%)' }}
        >
          <Flame size={40} className="text-[var(--on-ink)] opacity-90" />
        </div>
        <div
          className="absolute -bottom-2 -right-2 w-9 h-9 rounded-xl flex items-center justify-center border-2"
          style={{ background: 'var(--bf-secondary)', borderColor: 'var(--bf-quaternary)' }}
        >
          <Bot size={18} style={{ color: 'var(--bf-accent)' }} />
        </div>
        <div
          className="absolute -top-2 -right-2 w-7 h-7 rounded-lg flex items-center justify-center border-2"
          style={{ background: 'var(--bf-secondary)', borderColor: 'var(--bf-quaternary)' }}
        >
          <Sparkles size={14} style={{ color: '#7a5013' }} />
        </div>
      </div>

      <div className="text-center max-w-sm">
        <h3 className="text-[var(--foreground)] font-bold text-xl mb-2">No agents yet</h3>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--bf-gray)' }}>
          The marketplace is empty. Be the first to publish an agent running verifiable inference on&nbsp;0G&nbsp;Compute.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        {onCreateAgent ? (
          <button
            onClick={onCreateAgent}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-[var(--on-ink)] transition-opacity hover:opacity-90"
            style={{ background: 'var(--bf-fire)' }}
          >
            <Plus size={16} strokeWidth={2.5} />
            Create the first agent
          </button>
        ) : (
          <p className="text-xs" style={{ color: 'var(--bf-gray)' }}>
            Sign in to publish an agent.
          </p>
        )}
        <p className="text-xs" style={{ color: 'var(--bf-symbol)' }}>
          Minted agents are INFTs on 0G Chain, with encrypted bundles on 0G Storage
        </p>
      </div>
    </div>
  );
}

// ── Inner page ────────────────────────────────────────────────────────────────

function MarketplaceInner() {
  const [query, setQuery] = useState('');
  const [agents, setAgents] = useState<BackendAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteTarget, setInviteTarget] = useState<BackendAgent | null>(null);
  const [detailAgent, setDetailAgent] = useState<BackendAgent | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const { status, user } = useAuth();
  const walletAddress = user?.walletAddress ?? null;
  const router = useRouter();
  const cancelRef = useRef(false);

  // Fetch agents from backend
  useEffect(() => {
    cancelRef.current = false;
    setLoading(true);
    bf.listAgents()
      .then(r => { if (!cancelRef.current) { setAgents(r.agents); setLoading(false); } })
      .catch(() => { if (!cancelRef.current) setLoading(false); });
    return () => { cancelRef.current = true; };
  }, []);

  const filtered = agents.filter(a =>
    a.name.toLowerCase().includes(query.toLowerCase()) ||
    a.description.toLowerCase().includes(query.toLowerCase())
  );

  const myAgents = walletAddress
    ? filtered.filter(a => a.ownerWallet?.toLowerCase() === walletAddress.toLowerCase())
    : [];
  const otherAgents = walletAddress
    ? filtered.filter(a => a.ownerWallet?.toLowerCase() !== walletAddress.toLowerCase())
    : filtered;

  const openInvite = (a: BackendAgent) => {
    if (status !== 'authenticated') { router.push('/login'); return; }
    setInviteTarget(a);
  };

  const startDm = (a: BackendAgent) => {
    upsertDmSession({
      agentId: a.id,
      agentName: a.name,
      agentSlug: a.slug,
      agentAvatar: agentAvatarDisplayUrl(a),
      agentBaseUrl: a.baseUrl,
      lastMessage: '',
      lastMessageAt: new Date().toISOString(),
    });
    router.push(`/dm/${a.id}`);
  };

  return (
    <>
      <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: 'var(--bf-tertiary)' }}>
        <div className="flex flex-1 min-h-0 w-full overflow-hidden">
          {/* Server rail */}
          <LeftNav />

          {/* DM sidebar */}
          <DmSidebar />

          {/* Main content */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">

            {/* Hero banner */}
            <div className="relative flex-shrink-0 px-6 pt-6">
              <div className="lift flex items-end justify-between rounded-[30px] px-6 py-7" style={{ background: 'var(--paper)' }}>
                <div>
                  <h1 className="font-display mb-3" style={{ fontSize: 'clamp(1.9rem, 3.4vw, 2.6rem)', color: 'var(--foreground)' }}>
                    Find an agent for your pod.
                  </h1>
                  <p style={{ color: 'var(--muted)', fontSize: 15 }}>
                    Every agent is an INFT on 0G Chain, answering through 0G Private Computer.
                  </p>
                </div>
                {status === 'authenticated' && (
                  <button
                    onClick={() => setShowCreate(true)}
                    className="interactive flex items-center gap-2 px-5 py-2.5 rounded-full font-semibold flex-shrink-0"
                    style={{ background: 'var(--ink)', color: 'var(--on-ink)', fontSize: 14 }}
                  >
                    <Plus size={16} strokeWidth={2.5} />
                    Create Claw
                  </button>
                )}
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto" style={{ background: 'var(--bf-tertiary)' }}>
              <div className="w-full px-8 py-4">

                {loading ? (
                  <div className="grid grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-48 rounded-xl animate-pulse" style={{ background: 'var(--bf-secondary)' }} />
                    ))}
                  </div>
                ) : (
                  <>
                    {/* Search bar */}
                    <div className="flex justify-end mb-4">
                      <div
                        className="flex items-center gap-2 px-3 py-2 rounded-lg w-full sm:w-auto sm:min-w-[220px] sm:max-w-sm"
                        style={{ background: 'var(--bf-secondary)', border: '1px solid var(--bf-quaternary)' }}
                      >
                        <Search size={16} style={{ color: 'var(--bf-gray)', flexShrink: 0 }} />
                        <input
                          value={query}
                          onChange={e => setQuery(e.target.value)}
                          placeholder="Search agents"
                          className="bg-transparent text-sm focus:outline-none flex-1 min-w-0 text-[var(--foreground)] placeholder:opacity-50"
                          style={{ color: 'var(--foreground)' }}
                        />
                      </div>
                    </div>

                    {/* My agents */}
                    {myAgents.length > 0 && (
                      <section className="mb-8">
                        <h2 className="text-[var(--foreground)] font-bold text-lg mb-4">My Agents</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {myAgents.map(agent => renderAgentCard(agent, { setDetailAgent, startDm, openInvite }))}
                        </div>
                      </section>
                    )}

                    {/* All agents */}
                    <section>
                      <h2 className="text-[var(--foreground)] font-bold text-lg mb-4">
                        {myAgents.length > 0 ? 'Other Agents' : 'All Agents'}
                      </h2>
                      {otherAgents.length === 0 && myAgents.length === 0 ? (
                        <EmptyState
                          hasAgents={agents.length > 0}
                          query={query}
                          onClearSearch={() => { setQuery(''); }}
                          onCreateAgent={status === 'authenticated' ? () => setShowCreate(true) : undefined}
                        />
                      ) : otherAgents.length === 0 ? (
                        <p className="text-sm py-6" style={{ color: 'var(--bf-gray)' }}>
                          {query ? 'No other agents match your search.' : 'No other agents yet.'}
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {otherAgents.map(agent => renderAgentCard(agent, { setDetailAgent, startDm, openInvite }))}
                        </div>
                      )}
                    </section>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        <StatusBar />
      </div>

      {/* Detail overlay */}
      {detailAgent && (
        <AgentDetailOverlay
          agent={detailAgent}
          onClose={() => setDetailAgent(null)}
          onInvite={openInvite}
          onMessage={startDm}
          onAgentUpdated={updated => {
            setDetailAgent(updated);
            setAgents(prev => prev.map(a => a.id === updated.id ? updated : a));
          }}
        />
      )}

      {/* Invite modal */}
      {inviteTarget && (
        <InviteAgentToServerModal
          agent={inviteTarget}
          onClose={() => setInviteTarget(null)}
        />
      )}

      {/* Create agent modal */}
      {showCreate && (
        <CreateAgentModal
          onClose={() => setShowCreate(false)}
          onCreated={newAgent => {
            setAgents(prev => [newAgent, ...prev]);
            setShowCreate(false);
          }}
        />
      )}
    </>
  );
}

// ── Page export ───────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  return (
    <Suspense fallback={
      <div className="flex h-full items-center justify-center" style={{ background: 'var(--bf-tertiary)' }}>
        <div className="animate-pulse text-sm" style={{ color: 'var(--bf-gray)' }}>Loading marketplace…</div>
      </div>
    }>
      <MarketplaceInner />
    </Suspense>
  );
}
