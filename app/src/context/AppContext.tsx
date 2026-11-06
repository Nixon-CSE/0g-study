"use client";
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { bf } from "@/lib/api-bonfire";
import { notePodReplies } from "@/lib/billing-session";
import type {
  BackendServer,
  BackendChannel,
  BackendMessage,
  BackendAgent,
  BackendMember,
  BackendServerWallet,
  BackendServerFunding,
} from "@/lib/types";
import { agentAvatarDisplayUrl } from "@/lib/agent-identicon";
import { BF_DISPLAY_AGENT_MODEL } from "@/lib/brand";
import { useAgentNotifications } from "@/hooks/useAgentNotifications";
import AgentToastStack from "@/components/shared/AgentToast";

// ─── Public types (kept stable so existing components compile) ─────────────

export type ChannelType = "text" | "voice" | "audit" | "knowledge";
export type AgentStatus = "online" | "busy" | "idle" | "offline";
export type AcquisitionMode = "owned" | "rented" | "licensed";

export interface Skill {
  id: string;
  name: string;
  description: string;
  command: string;
}

export interface Agent {
  id: string;
  name: string;
  /** Marketplace / backend handle — used for identicon seed when avatar is unset or legacy hex. */
  slug?: string;
  avatar?: string;
  emoji?: string;
  description: string;
  model?: string;
  status: AgentStatus;
  isBot: boolean;
  skills: Skill[];
  rateInput?: number;
  rateOutput?: number;
  acquisition?: AcquisitionMode;
  teeHash?: string;
  logs?: AgentLog[];
  /** iNFT on-chain fields — present only for minted agents. */
  tokenId?: string | null;
  contractAddress?: string | null;
  manifestUri?: string | null;
  bundleUri?: string | null;
  sealedDEKBaseUri?: string | null;
  bundleHash?: string | null;
  ownerWallet?: string | null;
}

export interface AgentLog {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "tool";
  message: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  durationMs?: number;
}

export interface Message {
  id: string;
  author: string;
  authorId: string;
  avatar?: string;
  content: string;
  date: string;
  isBot?: boolean;
  teeHash?: string;
  cost?: number;
  // cascade metadata (optional — MessageRow ignores these if absent)
  cascadeHop?: number | null;
  cascadeRootId?: string | null;
  replyToId?: string | null;
}

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  description?: string;
  messages: Message[];
  defaultAgentId?: string;
  /** TEE-attested (private) channel — see backend ChannelDoc.tee. */
  tee?: boolean;
  teeAttestationHash?: string | null;
}

export interface Member {
  id: string;
  username: string;
  discriminator: string;
  avatar?: string;
  online?: boolean;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  agentName: string;
  agentId: string;
  action: string;
  channel: string;
  cost?: number;
  teeHash?: string;
}

export interface Server {
  id: string;
  name: string;
  color: string;
  icon?: string;
  description?: string;
  ownerId: string;
  channels: Channel[];
  agents: Agent[];
  members: Member[];
  balance: number;
  spentToday: number;
  auditLog: AuditEntry[];
}

export interface UserProfile {
  id: string;
  username: string;
  discriminator: string;
  avatar?: string;
  walletAddress?: string;
}

interface AppContextValue {
  user: UserProfile;
  servers: Server[];
  activeServerId: string;
  activeChannelId: string;
  activeVoiceChannelId: string | null;
  setActiveVoiceChannelId: (id: string | null) => void;
  setActiveServer: (id: string) => void;
  setActiveChannel: (id: string) => void;
  createServer: (name: string, color: string, description?: string) => Promise<{
    server: Server;
    wallet?: BackendServerWallet;
    funding?: BackendServerFunding;
  }>;
  createChannel: (
    serverId: string,
    name: string,
    type: ChannelType,
    description?: string,
    opts?: { tee?: boolean },
  ) => void;
  sendMessage: (serverId: string, channelId: string, content: string) => void;
  updateUser: (profile: Partial<UserProfile>) => void;
  addAgent: (serverId: string, agent: Agent) => void;
  updateAgentStatus: (
    serverId: string,
    agentId: string,
    status: AgentStatus,
  ) => void;
  leaveServer: (serverId: string) => void;
  /** Delete a channel via the backend (admin-only). Used by the "Close" button on TEE channels. */
  closeChannel: (serverId: string, channelId: string) => Promise<void>;
  addAuditEntry: (
    serverId: string,
    entry: Omit<AuditEntry, "id" | "timestamp">,
  ) => void;
  activeServer: Server | undefined;
  activeChannel: Channel | undefined;
  loading: boolean;
  error: string | null;
  /** What the user wants agents (and the UI) to call them. Persisted to localStorage. */
  preferredName: string;
  setPreferredName: (name: string) => void;
}

// ─── ID helpers ────────────────────────────────────────────────────────────

let _nextId = 9000;
const uid = () => {
  _nextId += 1;
  return String(_nextId);
};

const LS_ACTIVE_SERVER = "bonfire_active_server";
const LS_PREFERRED_NAME = "bonfire_preferred_name";

// ─── Mappers ───────────────────────────────────────────────────────────────

function mapServer(s: BackendServer): Omit<Server, "channels" | "agents" | "members"> {
  return {
    id: s.id,
    name: s.name,
    color: "#7a5013", // backend has no color — use default fire orange
    icon: s.iconUrl ?? undefined,
    description: undefined,
    ownerId: s.ownerId,
    balance: 0,
    spentToday: 0,
    auditLog: [],
  };
}

function mapChannel(c: BackendChannel): Channel {
  const type: ChannelType =
    c.type === "voice"
      ? "voice"
      : c.type === "audit"
        ? "audit"
        : c.type === "knowledge"
          ? "knowledge"
          : "text";
  return {
    id: c.id,
    name: c.name,
    type,
    description: c.topic ?? undefined,
    messages: [],
    defaultAgentId: c.defaultAgentId ?? undefined,
    tee: c.tee === true,
    teeAttestationHash: c.teeAttestationHash ?? null,
  };
}

function mapAgent(a: BackendAgent): Agent {
  return {
    id: a.id,
    name: a.name,
    slug: a.slug,
    avatar: agentAvatarDisplayUrl(a),
    description: a.description,
    model: BF_DISPLAY_AGENT_MODEL,
    status: "online",
    isBot: true,
    skills: [],
    rateInput: undefined,
    rateOutput: undefined,
    teeHash: undefined,
    tokenId: a.tokenId ?? null,
    contractAddress: a.contractAddress ?? null,
    manifestUri: a.manifestUri ?? null,
    bundleUri: a.bundleUri ?? null,
    sealedDEKBaseUri: a.sealedDEKBaseUri ?? null,
    bundleHash: a.bundleHash ?? null,
    ownerWallet: a.ownerWallet ?? null,
  };
}

function mapMember(m: BackendMember): Member {
  // Prefer alias → backend-joined username → displayName → principalId (last resort).
  // principalId is a Mongo hex and reads like a Privy DID — never desirable.
  return {
    id: m.principalId,
    username: m.alias ?? m.username ?? m.displayName ?? m.principalId,
    discriminator: "#0000",
    online: true,
  };
}

function mapMessage(
  m: BackendMessage,
  agentMap: Map<string, Agent>,
  userMap: Map<string, UserProfile>,
  selfId: string,
): Message {
  const isBot = m.authorType === "agent";
  let author = m.authorId;
  let avatar: string | undefined;

  if (isBot) {
    const agent = agentMap.get(m.authorId);
    author = agent?.name ?? m.authorId;
    avatar = agent?.avatar;
  } else {
    if (m.authorId === selfId) {
      author = userMap.get(selfId)?.username ?? m.authorName ?? "You";
    } else {
      author = m.authorName ?? userMap.get(m.authorId)?.username ?? m.authorId;
    }
  }

  return {
    id: m.id,
    author,
    authorId: m.authorId,
    avatar,
    content: m.content,
    date: new Date(m.createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    isBot,
    cascadeHop: m.cascadeHop,
    cascadeRootId: m.cascadeRootId,
    replyToId: m.replyToId,
    teeHash: m.teeHash ?? undefined,
  };
}

// ─── Context ───────────────────────────────────────────────────────────────

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { user: authUser, status: authStatus } = useAuth();

  // Derive UserProfile directly from authUser — no separate state needed
  const user: UserProfile = authUser
    ? {
        id: authUser.id,
        username: authUser.displayName || authUser.username,
        discriminator: "#0001",
        avatar: authUser.avatarUrl ?? undefined,
        walletAddress: authUser.walletAddress ?? undefined,
      }
    : { id: "", username: "You", discriminator: "#0001" };

  const [servers, setServers] = useState<Server[]>([]);
  const [activeServerId, setActiveServerId] = useState("");
  const [preferredName, setPreferredNameState] = useState("");

  // Load preferred name on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(LS_PREFERRED_NAME);
    if (stored) setPreferredNameState(stored);
  }, []);

  const setPreferredName = useCallback((name: string) => {
    const trimmed = name.trim();
    setPreferredNameState(trimmed);
    if (typeof window !== "undefined") {
      if (trimmed) localStorage.setItem(LS_PREFERRED_NAME, trimmed);
      else localStorage.removeItem(LS_PREFERRED_NAME);
    }
  }, []);
  const [activeChannelId, setActiveChannelId] = useState("");
  const [activeVoiceChannelId, setActiveVoiceChannelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Agent / user caches for message mapping
  const agentMapRef = useRef<Map<string, Agent>>(new Map());
  const userMapRef = useRef<Map<string, UserProfile>>(new Map());

  // Polling cleanup
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeChannelIdRef = useRef(activeChannelId);

  // Keep ref in sync via effect (not during render)
  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
  }, [activeChannelId]);

  // Keep user map cache in sync
  useEffect(() => {
    if (authUser) {
      userMapRef.current.set(authUser.id, user);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  // ── Merge messages helper ──────────────────────────────────────────────
  const mergeMessages = useCallback(
    (existing: Message[], incoming: Message[]): Message[] => {
      const byId = new Map<string, Message>();
      for (const m of existing) byId.set(m.id, m);
      for (const m of incoming) byId.set(m.id, m);
      return Array.from(byId.values()).sort((a, b) => {
        // date strings from mapMessage are locale times — use id lexicographic order
        // as a stable tiebreak; backend returns newest-first so we need oldest-first
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
    },
    [],
  );

  // ── Fetch messages for a channel and merge into state ─────────────────
  const fetchAndMergeMessages = useCallback(
    async (channelId: string, selfId: string) => {
      try {
        const { messages: raw } = await bf.listMessages(channelId, {
          limit: 50,
        });
        const mapped = raw.map((m) =>
          mapMessage(m, agentMapRef.current, userMapRef.current, selfId),
        );
        setServers((prev) =>
          prev.map((s) => ({
            ...s,
            channels: s.channels.map((c) => {
              if (c.id !== channelId) return c;
              return { ...c, messages: mergeMessages(c.messages, mapped) };
            }),
          })),
        );
      } catch {
        // Silently ignore poll errors
      }
    },
    [mergeMessages],
  );

  // ── Start / stop polling ───────────────────────────────────────────────
  const startPolling = useCallback(
    (channelId: string, selfId: string) => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(() => {
        // Only poll if channel hasn't changed
        if (activeChannelIdRef.current === channelId) {
          fetchAndMergeMessages(channelId, selfId);
        }
      }, 3000);
    },
    [fetchAndMergeMessages],
  );

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // ── Load servers on auth ───────────────────────────────────────────────
  useEffect(() => {
    if (authStatus !== "authenticated" || !authUser) return;

    let cancelled = false;

    async function loadServers() {
      setLoading(true);
      setError(null);
      try {
        const { servers: raw } = await bf.listServers();
        if (cancelled) return;

        const mapped: Server[] = raw.map((s) => ({
          ...mapServer(s),
          channels: [],
          agents: [],
          members: [],
        }));
        setServers(mapped);

        // Pick active server
        const stored = typeof window !== "undefined"
          ? localStorage.getItem(LS_ACTIVE_SERVER)
          : null;
        const initialId =
          stored && mapped.find((s) => s.id === stored)
            ? stored
            : mapped[0]?.id ?? "";
        if (!cancelled) setActiveServerId(initialId);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load servers");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadServers();
    return () => { cancelled = true; };
  }, [authStatus, authUser]);

  // ── Load channels + members when active server changes ────────────────
  useEffect(() => {
    if (!activeServerId || !authUser) return;

    let cancelled = false;

    async function loadServerData() {
      try {
        const [{ channels: rawCh }, { members: rawMembers }] = await Promise.all([
          bf.getChannels(activeServerId),
          bf.listMembers(activeServerId),
        ]);
        if (cancelled) return;

        const textChannels = rawCh
          .filter((c) => c.type === "text")
          .map(mapChannel);

        // Voice channels: prefer what the backend returns (auto-spawned general-voice
        // and any user-created voice channels). Fall back to localStorage-persisted
        // channels for offline / legacy servers, then to a hard-coded default.
        const voiceKey = `bonfire_voice_${activeServerId}`;
        let voiceChannels: Channel[] = rawCh
          .filter((c) => c.type === "voice")
          .map(mapChannel);

        if (voiceChannels.length === 0) {
          // Backend didn't return any voice channels — try localStorage
          try {
            const stored = typeof window !== "undefined" ? localStorage.getItem(voiceKey) : null;
            voiceChannels = stored ? JSON.parse(stored) : [];
          } catch { /* ignore */ }
        }
        // Always ensure at least one default voice channel
        if (voiceChannels.length === 0) {
          voiceChannels = [{ id: `voice-${activeServerId}`, name: "General Voice", type: "voice", description: "", messages: [] }];
          try { if (typeof window !== "undefined") localStorage.setItem(voiceKey, JSON.stringify(voiceChannels)); } catch { /* ignore */ }
        }

        // Audit channels — kept as-is; UI components gate visibility to owner only.
        const auditChannels: Channel[] = rawCh
          .filter((c) => c.type === "audit")
          .map(mapChannel);

        // Knowledge-base channel(s) — visible to every member.
        const knowledgeChannels: Channel[] = rawCh
          .filter((c) => c.type === "knowledge")
          .map(mapChannel);

        // Separate agent vs user members
        const agentMembers = rawMembers.filter((m) => m.principalType === "agent");
        const userMembers = rawMembers.filter((m) => m.principalType === "user");

        const agentDetails = await Promise.allSettled(
          agentMembers.map((m) => bf.getAgent(m.principalId)),
        );

        const agents: Agent[] = agentDetails
          .filter(
            (r): r is PromiseFulfilledResult<{ agent: BackendAgent }> =>
              r.status === "fulfilled",
          )
          .map((r) => mapAgent(r.value.agent));

        // Populate agent map cache
        for (const a of agents) agentMapRef.current.set(a.id, a);

        const members: Member[] = userMembers.map(mapMember);

        if (cancelled) return;

        setServers((prev) =>
          prev.map((s) => {
            if (s.id !== activeServerId) return s;
            return { ...s, channels: [...textChannels, ...voiceChannels, ...knowledgeChannels, ...auditChannels], agents, members };
          }),
        );

        // No channel selected by default — user picks one explicitly.
      } catch {
        // Non-fatal — server data load errors are soft
      }
    }

    loadServerData();
    return () => { cancelled = true; };
  }, [activeServerId, authUser]);

  // ── Fetch messages + start polling when active channel changes ────────
  useEffect(() => {
    if (!activeChannelId || !authUser) return;

    stopPolling();
    fetchAndMergeMessages(activeChannelId, authUser.id);
    startPolling(activeChannelId, authUser.id);

    return () => stopPolling();
  }, [activeChannelId, authUser, fetchAndMergeMessages, startPolling, stopPolling]);

  // ── Persist active server ──────────────────────────────────────────────
  useEffect(() => {
    if (activeServerId && typeof window !== "undefined") {
      localStorage.setItem(LS_ACTIVE_SERVER, activeServerId);
    }
  }, [activeServerId]);

  // ── Actions ───────────────────────────────────────────────────────────

  const setActiveServer = useCallback((id: string) => {
    setActiveServerId(id);
    // Channel will be reset in the "active server changes" effect
  }, []);

  const setActiveChannel = useCallback((id: string) => {
    setActiveChannelId(id);
  }, []);

  const setVoiceChannelId = useCallback((id: string | null) => {
    setActiveVoiceChannelId(id);
  }, []);

  const createServer = useCallback(
    async (name: string, _color: string, _description?: string): Promise<{
      server: Server;
      wallet?: BackendServerWallet;
      funding?: BackendServerFunding;
    }> => {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 32) || `server-${Date.now()}`;
      try {
        const result = await bf.createServer({ name, slug });
        // Eagerly fetch the server's channel list so that the auto-created
        // text + voice + audit channels are visible immediately, without
        // waiting for the `activeServerId` useEffect to re-fetch.
        let initialChannels: Channel[] = [];
        try {
          const { channels: rawCh } = await bf.getChannels(result.server.id);
          initialChannels = rawCh.map(mapChannel);
        } catch {
          // Soft-fail — the useEffect-driven loader will retry.
        }
        const newServer: Server = {
          ...mapServer(result.server),
          color: _color,
          description: _description,
          channels: initialChannels,
          agents: [],
          members: [],
        };
        setServers((prev) => [...prev, newServer]);
        setActiveServerId(result.server.id);
        // Select the first text channel if any.
        const firstText = initialChannels.find((c) => c.type === "text");
        setActiveChannelId(firstText?.id ?? "");
        return { server: newServer, wallet: result.wallet, funding: result.funding };
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create server");
        throw err;
      }
    },
    [],
  );

  const createChannel = useCallback(
    async (
      serverId: string,
      name: string,
      type: ChannelType,
      description?: string,
      opts?: { tee?: boolean },
    ) => {
      // Voice channels live client-side only — persist in localStorage
      if (type === "voice") {
        const id = uid();
        const newVoiceCh: Channel = { id, name, type: "voice", description: description ?? "", messages: [] };
        setServers((prev) =>
          prev.map((s) => {
            if (s.id !== serverId) return s;
            const updated = { ...s, channels: [...s.channels, newVoiceCh] };
            // Persist all voice channels for this server
            const voiceKey = `bonfire_voice_${serverId}`;
            const voices = updated.channels.filter(c => c.type === "voice");
            try { if (typeof window !== "undefined") localStorage.setItem(voiceKey, JSON.stringify(voices)); } catch { /* ignore */ }
            return updated;
          }),
        );
        setActiveChannelId(id);
        return;
      }
      try {
        const { channel: raw } = await bf.createChannel(serverId, {
          name,
          topic: description,
          tee: opts?.tee,
        });
        const ch = mapChannel(raw);
        setServers((prev) =>
          prev.map((s) =>
            s.id !== serverId ? s : { ...s, channels: [...s.channels, ch] },
          ),
        );
        setActiveChannelId(ch.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create channel");
      }
    },
    [],
  );

  const { toasts, push: pushNotification, dismiss: dismissToast, requestPermission } =
    useAgentNotifications(() => activeChannelIdRef.current);

  const sendMessage = useCallback(
    async (serverId: string, channelId: string, content: string) => {
      if (!content.trim() || !authUser) return;
      try {
        const { userMessage, replies } = await bf.postMessage(channelId, {
          content: content.trim(),
        });
        const allMessages = [userMessage, ...replies];
        const mapped = allMessages.map((m) =>
          mapMessage(m, agentMapRef.current, userMapRef.current, authUser.id),
        );
        setServers((prev) =>
          prev.map((s) => {
            if (s.id !== serverId) return s;
            return {
              ...s,
              channels: s.channels.map((c) => {
                if (c.id !== channelId) return c;
                return {
                  ...c,
                  messages: mergeMessages(c.messages, mapped),
                };
              }),
            };
          }),
        );

        // The status bar re-reads the student's balance and remembers these ids for the session line.
        notePodReplies(replies.map((r) => r.content));

        // Fire a notification for each agent reply
        for (const reply of replies) {
          const agent = agentMapRef.current.get(reply.authorId);
          const agentName = agent?.name ?? "Agent";
          const agentAvatar = agent?.avatar;
          const replyText = reply.content ?? "";
          // Tool-call markers mean the agent ran a task; the preview itself is cleaned by the hook.
          const isTask = replyText.includes("[tool:") || (replyText.includes("→") && replyText.includes("←"));
          pushNotification({ agentName, agentAvatar, message: replyText, isTask, channelId: reply.channelId ?? channelId });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send message");
      }
    },
    [authUser, mergeMessages, pushNotification],
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const updateUser = useCallback((_profile: Partial<UserProfile>) => {
    // User is derived from authUser — no local state to update
  }, []);

  const addAgent = useCallback(
    async (serverId: string, agent: Agent) => {
      try {
        await bf.inviteMember(serverId, {
          principalType: "agent",
          principalId: agent.id,
        });
        // Re-fetch agent list for that server
        const { members: rawMembers } = await bf.listMembers(
          serverId,
          "agent",
        );
        const agentDetails = await Promise.allSettled(
          rawMembers.map((m) => bf.getAgent(m.principalId)),
        );
        const agents: Agent[] = agentDetails
          .filter(
            (r): r is PromiseFulfilledResult<{ agent: BackendAgent }> =>
              r.status === "fulfilled",
          )
          .map((r) => mapAgent(r.value.agent));
        for (const a of agents) agentMapRef.current.set(a.id, a);
        setServers((prev) =>
          prev.map((s) => (s.id !== serverId ? s : { ...s, agents })),
        );
      } catch (err) {
        // Re-throw so callers (e.g. InviteToServerModal) can handle HTTP status codes
        throw err;
      }
    },
    [],
  );

  const updateAgentStatus = useCallback(
    (_serverId: string, _agentId: string, _status: AgentStatus) => {
      // No backend support — no-op
    },
    [],
  );

  const leaveServer = useCallback(
    (serverId: string) => {
      setServers((prev) => {
        const remaining = prev.filter((s) => s.id !== serverId);
        if (remaining.length > 0) {
          setActiveServerId(remaining[0].id);
          const first = remaining[0].channels.find((c) => c.type === "text") ??
            remaining[0].channels[0];
          if (first) setActiveChannelId(first.id);
          else setActiveChannelId("");
        } else {
          setActiveServerId("");
          setActiveChannelId("");
        }
        return remaining;
      });
    },
    [],
  );

  const closeChannel = useCallback(
    async (serverId: string, channelId: string) => {
      try {
        await bf.deleteChannel(channelId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to close channel");
        throw err;
      }
      // Update state only after the backend confirmed deletion. Snap the active
      // channel to the server's first text channel (typically #general) so the
      // pane doesn't render the now-gone channel.
      setServers((prev) =>
        prev.map((s) => {
          if (s.id !== serverId) return s;
          return { ...s, channels: s.channels.filter((c) => c.id !== channelId) };
        }),
      );
      const srv = servers.find((s) => s.id === serverId);
      const fallback =
        srv?.channels.find((c) => c.id !== channelId && c.type === "text")?.id ??
        srv?.channels.find((c) => c.id !== channelId)?.id ??
        "";
      setActiveChannelId(fallback);
    },
    [servers],
  );

  const addAuditEntry = useCallback(
    (_serverId: string, _entry: Omit<AuditEntry, "id" | "timestamp">) => {
      // No backend support — no-op
    },
    [],
  );

  // Request browser notification permission once on mount
  useEffect(() => {
    requestPermission();
  }, [requestPermission]);

  const activeServer = servers.find((s) => s.id === activeServerId);
  const activeChannel = activeServer?.channels.find(
    (c) => c.id === activeChannelId,
  );

  return (
    <AppContext.Provider
      value={{
        user,
        servers,
        activeServerId,
        activeChannelId,
        activeVoiceChannelId,
        setActiveVoiceChannelId: setVoiceChannelId,
        setActiveServer,
        setActiveChannel,
        createServer,
        createChannel,
        sendMessage,
        updateUser,
        addAgent,
        updateAgentStatus,
        leaveServer,
        closeChannel,
        addAuditEntry,
        activeServer,
        activeChannel,
        loading,
        error,
        preferredName,
        setPreferredName,
      }}
    >
      {children}
      <AgentToastStack toasts={toasts} onDismiss={dismissToast} />
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be inside AppProvider");
  return ctx;
}
