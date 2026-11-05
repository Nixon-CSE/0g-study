import { api, ApiError, getAccessToken } from './api';
import { BONFIRE_BASE_URL } from './config';
import type {
  BackendUser,
  BackendServer,
  BackendChannel,
  BackendMessage,
  BackendAgent,
  BackendMember,
  BackendServerWallet,
  BackendServerFunding,
} from './types';

export const bf = {
  me: () => api<{ user: BackendUser }>('GET', '/v1/auth/me'),

  listServers: () => api<{ servers: BackendServer[] }>('GET', '/v1/servers'),

  getServer: (sid: string) =>
    api<{ server: BackendServer }>('GET', `/v1/servers/${sid}`),

  createServer: (body: { name: string; slug: string; iconUrl?: string | null }) =>
    api<{ server: BackendServer; wallet: BackendServerWallet; funding: BackendServerFunding }>('POST', '/v1/servers', body),

  getServerWallet: (sid: string) =>
    api<{ wallet: BackendServerWallet; balance: string | null; balanceError: string | null; funding: BackendServerFunding }>(
      'GET', `/v1/servers/${sid}/wallet`
    ),

  withdrawFromServerWallet: (sid: string, body: { toAddress: string; amount: string }) =>
    api<{ txHash: string; balance: string }>('POST', `/v1/servers/${sid}/wallet/withdraw`, body),

  getChannels: (sid: string) =>
    api<{ channels: BackendChannel[] }>('GET', `/v1/servers/${sid}/channels`),

  createChannel: (
    sid: string,
    body: { name: string; type?: 'text' | 'voice'; topic?: string; defaultAgentId?: string; tee?: boolean },
  ) =>
    api<{ channel: BackendChannel }>('POST', `/v1/servers/${sid}/channels`, body),

  inviteAgentToServer: (serverId: string, body: { agentSlug: string; paymentTxHash?: string }) =>
    api<{ member: BackendMember }>('POST', `/v1/servers/${serverId}/invite-agent`, body),

  patchChannel: (
    cid: string,
    body: Partial<{
      name: string;
      topic: string | null;
      defaultAgentId: string | null;
      cascadeEnabled: boolean;
    }>,
  ) =>
    api<{ channel: BackendChannel }>('PATCH', `/v1/channels/${cid}`, body),

  deleteChannel: (cid: string) =>
    api<{ ok: true }>('DELETE', `/v1/channels/${cid}`),

  listMessages: (cid: string, opts: { before?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.before) params.set('before', opts.before);
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return api<{ messages: BackendMessage[]; nextCursor: string | null }>(
      'GET',
      `/v1/channels/${cid}/messages${qs ? '?' + qs : ''}`,
    );
  },

  postMessage: (cid: string, body: { content: string; replyToId?: string }) =>
    api<{
      userMessage: BackendMessage;
      replies: BackendMessage[];
      streamIds?: string[];
    }>('POST', `/v1/channels/${cid}/messages`, body),

  listMembers: (sid: string, type?: 'user' | 'agent') => {
    const qs = type ? `?type=${type}` : '';
    return api<{ members: BackendMember[] }>(
      'GET',
      `/v1/servers/${sid}/members${qs}`,
    );
  },

  inviteMember: (
    sid: string,
    body: { principalType: 'user' | 'agent'; principalId: string },
  ) => api<{ member: BackendMember }>('POST', `/v1/servers/${sid}/members`, body),

  listAgents: (opts: { q?: string; tag?: string; limit?: number } = {}) => {
    const sp = new URLSearchParams();
    if (opts.q) sp.set('q', opts.q);
    if (opts.tag) sp.set('tag', opts.tag);
    if (opts.limit) sp.set('limit', String(opts.limit));
    const qs = sp.toString();
    return api<{ agents: BackendAgent[] }>('GET', `/v1/agents${qs ? '?' + qs : ''}`, undefined, { auth: false });
  },

  getAgent: (aidOrSlug: string) =>
    api<{ agent: BackendAgent }>('GET', `/v1/agents/${aidOrSlug}`),

  getAgentManifest: (aidOrSlug: string) =>
    api<{ manifest: Record<string, unknown> }>('GET', `/v1/agents/${aidOrSlug}/manifest`, undefined, { auth: false }),

  getAgentConfig: (aidOrSlug: string) =>
    api<{ model: string | null; provider: string | null; temperature: number | null }>(
      'GET', `/v1/agents/${aidOrSlug}/config`, undefined, { auth: false }
    ),

  /**
   * Lifetime invite earnings for an agent — sum of every paid serverMember row.
   * Public (no auth).
   */
  getAgentEarnings: (aidOrSlug: string) =>
    api<{
      agentSlug: string;
      ownerWallet: string | null;
      priceOg: string;
      totalEarnedOg: string;
      paidInviteCount: number;
      events: Array<{
        serverId: string;
        amount: string;
        txHash: string | null;
        paidByUserId: string | null;
        joinedAt: string;
      }>;
    }>('GET', `/v1/agents/${aidOrSlug}/earnings`, undefined, { auth: false }),

  createAgent: (body: {
    name: string;
    slug: string;
    baseUrl: string;
    description: string;
    soul?: string;
    agents?: string;
    bio?: string;
    avatarUrl?: string | null;
    tags?: string[];
    env?: Record<string, string>;
    llm?: {
      provider?: 'openai-compatible' | 'zerog';
      baseUrl?: string;
      model?: string;
      apiKeyEnv?: string;
      temperature?: number;
      maxTokens?: number;
    };
  }) => api<{ agent: BackendAgent; agentKey: string }>('POST', '/v1/agents', body),

  getUser: (username: string) =>
    api<{ user: BackendUser }>('GET', `/v1/users/${username}`),

  searchSkills: (q: string) =>
    api<{ candidates: DiscoveredSkill[] }>(
      'GET',
      `/v1/skills/search?q=${encodeURIComponent(q)}`,
      undefined,
      { auth: false },
    ),

  listAgentSkills: (aid: string) =>
    api<{ skills: InstalledSkill[] }>('GET', `/v1/agents/${aid}/skills`, undefined, { auth: false }),

  discoverSkills: (aid: string, q: string) =>
    api<{ candidates: DiscoveredSkill[] }>(
      'GET',
      `/v1/agents/${aid}/skills/discover?q=${encodeURIComponent(q)}`,
      undefined,
      { auth: false },
    ),

  installSkill: (
    aid: string,
    body: { source?: 'agentskill.sh' | 'clawhub' | 'url'; slug?: string; url?: string },
  ) => api<InstallSkillResult>('POST', `/v1/agents/${aid}/skills/install`, body),

  removeSkill: (aid: string, name: string) =>
    api<{ ok: boolean }>('DELETE', `/v1/agents/${aid}/skills/${encodeURIComponent(name)}`),

  listMcpServers: (aid: string) =>
    api<{ servers: Record<string, McpServerConfig> }>('GET', `/v1/agents/${aid}/mcp/servers`, undefined, { auth: false }),

  addMcpServer: (aid: string, body: { id: string; command: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }) =>
    api<{ ok: boolean }>('POST', `/v1/agents/${aid}/mcp/servers`, body),

  removeMcpServer: (aid: string, id: string) =>
    api<{ ok: boolean }>('DELETE', `/v1/agents/${aid}/mcp/servers/${encodeURIComponent(id)}`),

  patchAgent: (aidOrSlug: string, body: Partial<{
    name: string;
    description: string;
    bio: string | null;
    avatarUrl: string | null;
    tags: string[];
    baseUrl: string;
    priceOg: string;
  }>) => api<{ agent: BackendAgent }>('PATCH', `/v1/agents/${aidOrSlug}`, body),

  getAuditLog: (cid: string, opts: { limit?: number; before?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.before) params.set('before', opts.before);
    const qs = params.toString();
    return api<{ entries: AuditLogEntry[] }>(
      'GET',
      `/v1/channels/${cid}/audit${qs ? '?' + qs : ''}`,
    );
  },

  // ── Knowledge base ──────────────────────────────────────────────────────────

  listKnowledge: (sid: string) =>
    api<{ docs: KnowledgeDoc[] }>('GET', `/v1/servers/${sid}/knowledge`),

  getKnowledge: (sid: string, docId: string) =>
    api<{ doc: KnowledgeDoc & { content: string } }>(
      'GET',
      `/v1/servers/${sid}/knowledge/${docId}`,
    ),

  createKnowledge: (sid: string, body: { title: string; content: string }) =>
    api<{ doc: KnowledgeDoc }>('POST', `/v1/servers/${sid}/knowledge`, body),

  deleteKnowledge: (sid: string, docId: string) =>
    api<{ ok: true }>('DELETE', `/v1/servers/${sid}/knowledge/${docId}`),

  uploadKnowledge: async (
    sid: string,
    args: { file: File; title?: string },
  ): Promise<{ doc: KnowledgeDoc }> => {
    const fd = new FormData();
    fd.append('file', args.file);
    if (args.title) fd.append('title', args.title);
    // Use a custom fetch — the shared `api()` helper assumes JSON bodies.
    const tok = await getAccessToken();
    const headers: Record<string, string> = {};
    if (tok) headers['authorization'] = `Bearer ${tok}`;
    const res = await fetch(`${BONFIRE_BASE_URL}/v1/servers/${sid}/knowledge/upload`, {
      method: 'POST',
      headers,
      body: fd,
    });
    const text = await res.text();
    const data = text ? safeJsonForBf(text) : null;
    if (!res.ok) {
      const msg =
        data && typeof data === 'object' && data !== null && 'error' in data
          ? String((data as Record<string, unknown>).error)
          : `HTTP ${res.status}`;
      throw new ApiError(res.status, data, msg);
    }
    return data as { doc: KnowledgeDoc };
  },
};

function safeJsonForBf(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export interface KnowledgeDoc {
  id: string;
  serverId: string;
  channelId: string;
  title: string;
  source: 'inline' | 'upload';
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstalledSkillSource {
  slug?: string;
  owner?: string;
  contentSha?: string;
  installed?: string;
  sourceUrl?: string;
}

export interface InstalledSkill {
  name: string;
  description?: string;
  source?: string | InstalledSkillSource;
}

export interface DiscoveredSkill {
  slug: string;
  owner: string;
  description: string;
  securityScore?: number;
}

export type InstallSkillResult =
  | { ok: true; name: string }
  | { ok: false; error: string; findings?: unknown[] };

export interface McpServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actorType: 'user' | 'agent' | 'system';
  agentSlug?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
