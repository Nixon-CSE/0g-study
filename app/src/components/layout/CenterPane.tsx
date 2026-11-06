"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Hash, Volume2, Bell, BellOff, Users, Search, HelpCircle, UserPlus, Mic, MicOff, Plus, Compass, Sparkles, MessageSquare, ShieldCheck, ArrowLeft, Pencil, Check, X, Lock, XCircle } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useVoiceCtx, type VoiceParticipant } from "@/context/VoiceContext";
import MessageFeed from "@/components/message/MessageFeed";
import MessageComposer from "@/components/message/MessageComposer";
import Avatar from "@/components/shared/Avatar";
import { BF_BRAND_EMOJI } from "@/lib/brand";
import { appAgentAvatarSrc } from "@/lib/agent-identicon";
import { resolveGreetingName, greetingUsesFallback } from "@/lib/greeting-name";
import AuditLogPane from "@/components/audit/AuditLogPane";
import KnowledgePanel from "@/components/knowledge/KnowledgePanel";

export default function CenterPane() {
  const { servers, activeServer, activeChannel, activeServerId, activeChannelId, sendMessage, closeChannel, user } = useApp();
  const voice = useVoiceCtx();

  const [showMembers, setShowMembers] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [notifEnabled, setNotifEnabled] = useState(() => {
    try { return localStorage.getItem("bonfire_notifications_enabled") !== "false"; } catch { return true; }
  });

  const handleCloseTee = async () => {
    if (!activeChannel || !activeServer) return;
    const ok = window.confirm(
      `Close "${activeChannel.name}"?\n\nThis ends the private session and permanently deletes the channel and all its messages.`,
    );
    if (!ok) return;
    try {
      await closeChannel(activeServer.id, activeChannel.id);
    } catch {
      // closeChannel surfaces the error via setError; nothing more to do here.
    }
  };

  const toggleNotif = () => {
    const next = !notifEnabled;
    setNotifEnabled(next);
    try { localStorage.setItem("bonfire_notifications_enabled", next ? "true" : "false"); } catch { /* ignore */ }
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  };

  const openSearch = () => {
    setShowSearch(s => !s);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  if (!activeServer) {
    return servers.length === 0
      ? <NoServersHero />
      : <NoServerSelectedHero />;
  }

  if (!activeChannel) {
    return <NoChannelSelected serverName={activeServer.name} />;
  }

  const isVoice = activeChannel.type === "voice";
  const isAudit = activeChannel.type === "audit";
  const isKnowledge = activeChannel.type === "knowledge";

  if (isAudit) {
    return <AuditLogPane channelId={activeChannel.id} />;
  }

  if (isKnowledge) {
    return <KnowledgePanel serverId={activeServerId} />;
  }

  const messages = activeChannel.messages;
  const filteredMessages = searchQuery.trim()
    ? messages.filter(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden" style={{ background: "var(--bf-primary)" }}>

      {/* Channel header */}
      <header
        className="flex items-center gap-1 px-4 h-14 border-b flex-shrink-0"
        style={{ borderColor: "var(--bf-quinary)" }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {activeChannel.tee
            ? <Lock size={20} style={{ color: "var(--bf-fire)", flexShrink: 0 }} strokeWidth={2} />
            : isVoice
              ? <Volume2 size={22} style={{ color: "var(--bf-symbol)", flexShrink: 0 }} strokeWidth={1.5} />
              : <Hash size={22} style={{ color: "var(--bf-symbol)", flexShrink: 0 }} strokeWidth={2} />
          }
          <span className="font-bold text-[var(--foreground)] text-lg">{activeChannel.name}</span>

          {activeChannel.tee && activeChannel.teeAttestationHash && (
            <button
              type="button"
              title={`Click to copy this channel's demo hash (computed by the backend, not a hardware attestation)\n${activeChannel.teeAttestationHash}`}
              onClick={() => navigator.clipboard?.writeText(activeChannel.teeAttestationHash!)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
              style={{ background: "rgba(255,140,40,0.12)", color: "var(--bf-fire)", border: "1px solid rgba(255,140,40,0.35)" }}
            >
              <ShieldCheck size={12} strokeWidth={2.5} />
              <span>Private · demo hash</span>
              <code className="font-mono text-[10px] font-normal normal-case tracking-normal" style={{ color: "var(--bf-fire)", opacity: 0.85 }}>
                {activeChannel.teeAttestationHash.slice(0, 8)}…{activeChannel.teeAttestationHash.slice(-4)}
              </code>
            </button>
          )}

          {activeChannel.description && (
            <>
              <span className="w-px h-5 mx-1 flex-shrink-0" style={{ background: "var(--bf-quinary)" }} />
              <span className="text-sm truncate" style={{ color: "var(--bf-gray)" }}>
                {activeChannel.description}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {activeChannel.tee && activeServer.ownerId === user.id && (
            <button
              onClick={handleCloseTee}
              title="End private session — deletes this channel and all its messages"
              className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-semibold transition-colors mr-1"
              style={{
                background: "rgba(240,91,91,0.08)",
                color: "var(--bf-red)",
                border: "1px solid rgba(240,91,91,0.35)",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "var(--bf-red)";
                (e.currentTarget as HTMLElement).style.color = "var(--on-ink)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(240,91,91,0.08)";
                (e.currentTarget as HTMLElement).style.color = "var(--bf-red)";
              }}
            >
              <XCircle size={14} strokeWidth={2.2} />
              Close session
            </button>
          )}

          {/* Notifications toggle */}
          <HeaderBtn
            title={notifEnabled ? "Mute notifications" : "Enable notifications"}
            active={notifEnabled}
            onClick={toggleNotif}
          >
            {notifEnabled ? <Bell size={20} strokeWidth={1.5} /> : <BellOff size={20} strokeWidth={1.5} />}
          </HeaderBtn>

          {/* Members sidebar */}
          <HeaderBtn title="Member List" active={showMembers} onClick={() => setShowMembers(v => !v)}>
            <Users size={20} strokeWidth={1.5} />
          </HeaderBtn>

          {/* Search */}
          <HeaderBtn title="Search messages" active={showSearch} onClick={openSearch}>
            <Search size={20} strokeWidth={1.5} />
          </HeaderBtn>

          {/* Help */}
          <HeaderBtn title="Help" onClick={() => window.open("https://github.com/anthropics/claude-code/issues", "_blank")}>
            <HelpCircle size={20} strokeWidth={1.5} />
          </HeaderBtn>
        </div>
      </header>

      {isVoice ? (
        <VoiceStatusPane
          channelId={activeChannel.id}
          channelName={activeChannel.name}
          agents={activeServer.agents}
        />
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Main chat column */}
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            {/* Search bar */}
            {showSearch && (
              <div
                className="flex items-center gap-2 px-4 py-2 flex-shrink-0"
                style={{ borderBottom: "1px solid var(--bf-quinary)", background: "var(--bf-secondary)" }}
              >
                <Search size={14} style={{ color: "var(--bf-gray)", flexShrink: 0 }} />
                <input
                  ref={searchRef}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search messages…"
                  className="flex-1 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-gray-500"
                />
                {searchQuery && (
                  <span className="text-xs flex-shrink-0" style={{ color: "var(--bf-gray)" }}>
                    {filteredMessages.length} result{filteredMessages.length !== 1 ? "s" : ""}
                  </span>
                )}
                <button onClick={() => { setShowSearch(false); setSearchQuery(""); }} style={{ color: "var(--bf-gray)" }}>
                  <X size={14} />
                </button>
              </div>
            )}

            <MessageFeed messages={searchQuery.trim() ? filteredMessages : activeChannel.messages} />
            <MessageComposer
              channel={activeChannel}
              onSend={text => sendMessage(activeServerId, activeChannelId, text)}
              agents={activeServer.agents}
            />
          </div>

          {/* Members sidebar */}
          {showMembers && (
            <div
              className="flex-shrink-0 overflow-y-auto flex flex-col gap-1 py-3 px-2"
              style={{ width: 220, borderLeft: "1px solid var(--bf-quinary)", background: "var(--bf-primary)" }}
            >
              <p className="text-xs font-semibold uppercase tracking-wider px-2 mb-1" style={{ color: "var(--bf-gray)" }}>
                Members — {activeServer.agents.length + activeServer.members.length}
              </p>
              {activeServer.agents.length > 0 && (
                <>
                  <p className="text-xs uppercase tracking-wider px-2 mt-1 mb-0.5" style={{ color: "var(--bf-gray)", fontSize: 10 }}>Agents</p>
                  {activeServer.agents.map(a => (
                    <div key={a.id} className="flex items-center gap-2 px-2 py-1 rounded-lg" style={{ color: "var(--foreground)" }}>
                      <Avatar name={a.name} size={28} src={a.avatar} color="var(--bf-fire)" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{a.name}</p>
                      </div>
                      <span className="ml-auto w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#1f6b55" }} />
                    </div>
                  ))}
                </>
              )}
              {activeServer.members.length > 0 && (
                <>
                  <p className="text-xs uppercase tracking-wider px-2 mt-2 mb-0.5" style={{ color: "var(--bf-gray)", fontSize: 10 }}>Users</p>
                  {activeServer.members.map(m => (
                    <div key={m.id} className="flex items-center gap-2 px-2 py-1 rounded-lg" style={{ color: "var(--bf-gray)" }}>
                      <Avatar name={m.username} size={28} color="var(--bf-plum)" />
                      <p className="text-sm truncate">{m.username}</p>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

// ── Header button ─────────────────────────────────────────────────────────────

function HeaderBtn({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
      style={{
        color: active ? "var(--foreground)" : "var(--bf-gray)",
        background: active ? "var(--bf-quinary)" : "transparent",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--foreground)"; if (!active) (e.currentTarget as HTMLElement).style.background = "var(--bf-quinary)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = active ? "white" : "var(--bf-gray)"; if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}

// ── Empty states ──────────────────────────────────────────────────────────────

function NoServersHero() {
  const router = useRouter();
  const { user, preferredName, setPreferredName } = useApp();
  const openCreate = () => window.dispatchEvent(new Event("bonfire:open-create-server"));

  const displayName = resolveGreetingName(preferredName, user.username);
  const usingFallback = greetingUsesFallback(preferredName, user.username);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(preferredName);

  const saveName = () => {
    setPreferredName(draft);
    setEditing(false);
  };
  const cancelEdit = () => {
    setDraft(preferredName);
    setEditing(false);
  };

  const features = [
    {
      Icon: Sparkles,
      title: "Mint an iNFT agent",
      body: "Spin up a soul-bound AI agent on 0G. Voice, memory, and skills baked in.",
      color: "var(--bf-fire)",
    },
    {
      Icon: MessageSquare,
      title: "Chat & voice channels",
      body: "Talk to your agents in text or jump into a Daily-powered voice room.",
      color: "var(--bf-accent)",
    },
    {
      Icon: ShieldCheck,
      title: "Audit log & private channels",
      body: "Agent activity is recorded in the server's audit log. Private channels stamp each reply with a hash computed by the backend (a demo, not a hardware attestation).",
      color: "var(--bf-fire)",
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "var(--bf-primary)" }}>
      <div className="max-w-3xl mx-auto px-8 py-16 flex flex-col items-center text-center">

        {editing ? (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-3xl font-bold text-[var(--foreground)]">Hey,</span>
            <input
              autoFocus
              value={draft}
              maxLength={40}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") cancelEdit();
              }}
              placeholder="what should we call you?"
              className="text-3xl font-bold bg-transparent border-b-2 outline-none text-[var(--foreground)] placeholder:text-[var(--subtle)] min-w-0"
              style={{ borderColor: "var(--bf-accent)", width: "auto", minWidth: 240 }}
            />
            <button
              onClick={saveName}
              title="Save"
              className="w-9 h-9 flex items-center justify-center rounded-lg transition-opacity hover:opacity-90"
              style={{ background: "var(--bf-accent)", color: "var(--on-ink)" }}
            >
              <Check size={18} strokeWidth={2.5} />
            </button>
            <button
              onClick={cancelEdit}
              title="Cancel"
              className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
              style={{ background: "var(--bf-quaternary)", color: "var(--bf-gray)", border: "1px solid var(--bf-quinary)" }}
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>
        ) : (
          <h1 className="flex items-center gap-3 text-3xl font-bold text-[var(--foreground)] mb-2">
            <span>
              Hey, <span style={{ color: usingFallback ? "var(--bf-gray)" : "var(--foreground)", fontStyle: usingFallback ? "italic" : "normal", marginRight: usingFallback ? "0.15em" : 0 }}>{displayName}</span>!
            </span>
            <button
              onClick={() => { setDraft(preferredName); setEditing(true); }}
              title="What should agents call you?"
              className="ml-2 w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:text-[var(--foreground)]"
              style={{ color: "var(--bf-gray)", background: "var(--bf-quaternary)", border: "1px solid var(--bf-quinary)" }}
            >
              <Pencil size={14} strokeWidth={2} />
            </button>
          </h1>
        )}

        <p className="text-base max-w-lg" style={{ color: "var(--bf-gray)" }}>
          Servers are your private workspaces where humans and AI agents collaborate.
          Create your first one, or browse the marketplace to invite an existing agent.
          {usingFallback && !editing && (
            <>
              {" "}
              <button
                onClick={() => { setDraft(""); setEditing(true); }}
                className="underline hover:opacity-70 transition-opacity"
                style={{ color: "var(--bf-accent)" }}
              >
                Tell us what to call you →
              </button>
            </>
          )}
        </p>

        <div className="flex flex-wrap gap-3 justify-center mt-8">
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-[var(--on-ink)] transition-opacity hover:opacity-90"
            style={{ background: "var(--bf-accent)" }}
          >
            <Plus size={18} strokeWidth={2.5} />
            Create your first server
          </button>
          <button
            onClick={() => router.push("/marketplace")}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold transition-colors"
            style={{ background: "var(--bf-quaternary)", color: "var(--foreground)", border: "1px solid var(--bf-quinary)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bf-quinary)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--bf-quaternary)"; }}
          >
            <Compass size={18} strokeWidth={2} />
            Browse the marketplace
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-12 w-full">
          {features.map(({ Icon, title, body, color }) => (
            <div
              key={title}
              className="p-5 rounded-2xl text-left"
              style={{ background: "var(--bf-secondary)", border: "1px solid var(--bf-quinary)" }}
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
                style={{ background: "var(--bf-quaternary)", color }}
              >
                <Icon size={18} strokeWidth={2} />
              </div>
              <p className="text-[var(--foreground)] font-bold text-sm mb-1">{title}</p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--bf-gray)" }}>{body}</p>
            </div>
          ))}
        </div>

        <div
          className="mt-10 px-4 py-3 rounded-xl flex items-center gap-3 text-sm"
          style={{ background: "var(--bf-secondary)", border: "1px solid var(--bf-quinary)", color: "var(--bf-gray)" }}
        >
          <span style={{ color: "var(--bf-fire)" }}>💡</span>
          <span>
            Each new server gets its own 0G wallet for paying agent inference and gas. You&apos;ll be asked to fund it after creation.
          </span>
        </div>
      </div>
    </div>
  );
}

function NoServerSelectedHero() {
  const router = useRouter();
  return (
    <div className="flex-1 flex items-center justify-center" style={{ background: "var(--bf-primary)" }}>
      <div className="text-center max-w-md px-8">
        <ArrowLeft
          size={28}
          className="mx-auto mb-4 animate-pulse"
          style={{ color: "var(--bf-gray)" }}
          strokeWidth={1.5}
        />
        <p className="font-bold text-[var(--foreground)] text-xl mb-2">Pick a server</p>
        <p className="text-sm" style={{ color: "var(--bf-gray)" }}>
          Choose a server from the left to see its channels, agents, and wallet.
        </p>
        <button
          onClick={() => router.push("/marketplace")}
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          style={{ background: "var(--bf-quaternary)", color: "var(--foreground)", border: "1px solid var(--bf-quinary)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bf-quinary)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--bf-quaternary)"; }}
        >
          <Compass size={15} />
          Browse marketplace
        </button>
      </div>
    </div>
  );
}

function NoChannelSelected({ serverName }: { serverName: string }) {
  return (
    <div className="flex-1 flex items-center justify-center" style={{ background: "var(--bf-primary)" }}>
      <div className="text-center max-w-md px-8 -mt-24" style={{ color: "var(--bf-gray)" }}>
        <p className="font-bold text-[var(--foreground)] text-xl">No channel selected</p>
        <p className="text-sm mt-1">
          Pick a text or voice channel in <span className="text-[var(--foreground)] font-semibold">{serverName}</span> to start chatting.
        </p>
      </div>
    </div>
  );
}

// ── Voice status pane ─────────────────────────────────────────────────────────

interface VoiceAgent {
  id: string;
  name: string;
  emoji?: string;
  avatar?: string;
  slug?: string;
  status: string;
}

function VoiceStatusPane({
  channelId,
  channelName,
  agents,
}: {
  channelId: string;
  channelName: string;
  agents: VoiceAgent[];
}) {
  const voice = useVoiceCtx();
  const [chatInput, setChatInput] = useState("");
  const [talkingToAgent, setTalkingToAgent] = useState<string | null>(null);

  const joined = !!voice.joinedChannelId;

  const handleSendToAgent = (agentId: string, agentName: string) => {
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput("");
    voice.speakAsAgent(agentId, `${agentName} says: ${text}`);
  };

  const handleInviteAgent = (agent: VoiceAgent) => {
    voice.inviteAgentToVoice(agent.id);
    setParticipantInfo(prev => ({
      ...prev,
      [agent.id]: { name: agent.name, emoji: agent.emoji, color: appAgentAvatarSrc(agent) },
    }));
  };

  const [participantInfo, setParticipantInfo] = useState<Record<string, { name: string; emoji?: string; color?: string }>>({});

  const agentsInVoice = voice.participants.filter(p => p.isAgent);
  const humansInVoice = voice.participants.filter(p => !p.isAgent);
  const availableAgents = agents.filter(a => !voice.participants.find(p => p.userId === a.id));

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--bf-primary)" }}>

      {/* Participants area */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {!joined && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center"
              style={{ background: "var(--bf-quaternary)" }}
            >
              <Volume2 size={36} style={{ color: "var(--bf-gray)" }} strokeWidth={1.2} />
            </div>
            <div className="text-center">
              <p className="text-[var(--foreground)] font-bold text-xl">{channelName}</p>
              <p className="text-sm mt-1" style={{ color: "var(--bf-gray)" }}>
                Voice channel — click to join and talk to agents
              </p>
            </div>
            <button
              onClick={() => voice.join(channelId, channelName)}
              disabled={voice.joining}
              className="px-8 py-2.5 rounded-xl font-bold text-[var(--on-ink)] transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--bf-accent)" }}
            >
              {voice.joining ? "Joining…" : "Join Voice"}
            </button>
          </div>
        )}

        {joined && (
          <>
            {/* Discord-style full-bleed participant grid */}
            {voice.participants.length > 0 && (
              <div
                className="flex-1 p-3 gap-2"
                style={{
                  display: "grid",
                  gridTemplateColumns: voice.participants.length === 1
                    ? "1fr"
                    : voice.participants.length <= 4
                      ? "repeat(2, 1fr)"
                      : "repeat(3, 1fr)",
                  gridAutoRows: "1fr",
                  minHeight: 0,
                }}
              >
                {voice.participants.map(p => {
                  const info = participantInfo[p.userId];
                  return (
                    <ParticipantTile
                      key={p.userId}
                      participant={p}
                      emoji={info?.emoji ?? p.emoji}
                      color={info?.color ?? p.agentColor}
                      onTalk={p.isAgent ? () => setTalkingToAgent(talkingToAgent === p.userId ? null : p.userId) : undefined}
                      talkingTo={talkingToAgent === p.userId}
                    />
                  );
                })}
              </div>
            )}

            {/* Chat-to-agent bar */}
            {talkingToAgent && (() => {
              const agent = voice.participants.find(p => p.userId === talkingToAgent);
              const info = participantInfo[talkingToAgent];
              const name = info?.name ?? agent?.userName ?? "Agent";
              return (
                <div
                  className="mx-3 mb-2 flex items-center gap-3 rounded-xl px-4 py-3 flex-shrink-0"
                  style={{ background: "var(--bf-quaternary)", border: "1px solid var(--bf-quinary)" }}
                >
                  <span className="text-sm font-semibold flex-shrink-0" style={{ color: "var(--bf-accent)" }}>
                    → {name}
                  </span>
                  <input
                    autoFocus
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleSendToAgent(talkingToAgent, name); }}
                    placeholder={`Say something to ${name}…`}
                    className="flex-1 bg-transparent text-[var(--foreground)] text-sm outline-none placeholder:text-gray-500"
                  />
                  <button
                    onClick={() => handleSendToAgent(talkingToAgent, name)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg text-[var(--on-ink)]"
                    style={{ background: "var(--bf-accent)" }}
                  >
                    Send
                  </button>
                </div>
              );
            })()}

            {/* Invite agents */}
            {availableAgents.length > 0 && (
              <div className="mx-3 mb-2 flex-shrink-0">
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--bf-gray)" }}>
                  Invite agents to voice
                </p>
                <div className="flex flex-wrap gap-2">
                  {availableAgents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => handleInviteAgent(agent)}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-colors"
                      style={{ background: "var(--bf-quaternary)", color: "var(--bf-gray)", border: "1px solid var(--bf-quinary)" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bf-quinary)"; (e.currentTarget as HTMLElement).style.color = "var(--foreground)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--bf-quaternary)"; (e.currentTarget as HTMLElement).style.color = "var(--bf-gray)"; }}
                    >
                      <UserPlus size={14} strokeWidth={2} />
                      {agent.emoji && <span>{agent.emoji}</span>}
                      {agent.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {voice.error && (
          <p
            className="text-sm px-5 py-3 rounded-xl max-w-sm text-center"
            style={{ background: "rgba(240,91,91,0.12)", color: "#a8372f", border: "1px solid rgba(240,91,91,0.3)" }}
          >
            {voice.error}
          </p>
        )}
      </div>

      {/* Bottom bar — participant count */}
      {joined && (
        <div
          className="flex items-center justify-between px-6 py-2 text-sm flex-shrink-0"
          style={{ borderTop: "1px solid var(--bf-quinary)", color: "var(--bf-gray)" }}
        >
          <span>
            {humansInVoice.length} human{humansInVoice.length !== 1 ? "s" : ""} · {agentsInVoice.length} agent{agentsInVoice.length !== 1 ? "s" : ""} · {channelName}
          </span>
          <div className="flex items-center gap-1 text-xs">
            {voice.muted
              ? <MicOff size={14} style={{ color: "var(--bf-red)" }} />
              : <Mic size={14} style={{ color: "var(--bf-accent)" }} />
            }
            <span>{voice.muted ? "Muted" : "Live"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Participant tile ───────────────────────────────────────────────────────────

function ParticipantTile({
  participant,
  emoji,
  color,
  onTalk,
  talkingTo,
}: {
  participant: VoiceParticipant;
  emoji?: string;
  color?: string;
  onTalk?: () => void;
  talkingTo?: boolean;
}) {
  const displayName = participant.userName.startsWith("did:")
    ? participant.userName.slice(0, 14) + "…"
    : participant.userName;

  const avatarSrc = color && !color.startsWith("#") ? color : undefined;
  const fallbackColor = color?.startsWith("#") ? color : "var(--bf-plum)";

  const speaking = participant.speaking;

  return (
    <div
      className="relative rounded-xl overflow-hidden flex items-center justify-center transition-all"
      onClick={onTalk}
      role={onTalk ? "button" : undefined}
      style={{
        background: "var(--bf-secondary)",
        border: speaking
          ? "2px solid #23d05e"
          : talkingTo
            ? "2px solid var(--bf-accent)"
            : "2px solid rgba(255,255,255,0.06)",
        boxShadow: speaking ? "0 0 0 4px rgba(35,208,94,0.15)" : undefined,
        minHeight: 120,
        cursor: onTalk ? "pointer" : "default",
      }}
    >
      {/* Avatar centered */}
      <Avatar
        name={participant.userName}
        size={72}
        color={fallbackColor}
        emoji={emoji}
        src={avatarSrc}
      />

      {/* Speaking pulse ring */}
      {speaking && (
        <span
          className="absolute inset-0 rounded-xl pointer-events-none animate-pulse"
          style={{ border: "2px solid rgba(35,208,94,0.4)" }}
        />
      )}

      {/* Name + role bar at bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 py-2"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {speaking && (
            <span className="flex-shrink-0 w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          )}
          <p className="text-[var(--foreground)] text-sm font-semibold truncate">{displayName}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {participant.isAgent && (
            <span
              className="text-xs font-bold px-1.5 py-0.5 rounded"
              style={{ background: "var(--bf-accent)", color: "var(--on-ink)", fontSize: 9 }}
            >
              BOT
            </span>
          )}
          {talkingTo && (
            <span className="text-xs font-semibold" style={{ color: "var(--bf-accent)" }}>Chatting</span>
          )}
        </div>
      </div>
    </div>
  );
}
