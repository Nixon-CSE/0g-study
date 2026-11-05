import type { ObjectId } from 'mongodb';

export interface UserDoc {
  _id: ObjectId;
  privyDid: string;               // Privy user DID, e.g. "did:privy:xyz...", unique
  walletAddress: string | null;   // embedded wallet address from Privy, 0x...; null until provisioned
  email: string | null;           // optional — some Privy logins are social-only
  passwordHash: string | null;    // deprecated; only legacy users
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  isService: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentDoc {
  _id: ObjectId;
  name: string;
  slug: string;
  avatarUrl: string | null;
  description: string;
  bio: string | null;
  tags: string[];
  baseUrl: string;
  /** Always public — retained on the document for backwards compatibility with older indexes. */
  visibility: 'public';
  agentKeyHash?: string | null;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  /** Invite price in OG (decimal string, e.g. "0.5"). Missing/undefined means free. */
  priceOg?: string;
  // INFT fields — optional during migration (legacy agents won't have these)
  tokenId?: string;               // bigint serialized as string (Mongo can't hold full uint256)
  contractAddress?: string;       // 0x...
  ownerWallet?: string;           // 0x... (denormalized from chain; refreshed on indexer events)
  manifestUri?: string;
  bundleUri?: string;
  sealedDEKBaseUri?: string;
  bundleHash?: string;            // hex string
}

/**
 * A single bot that has been invited into an active voice session.
 * Each invite spawns its own Pipecat subprocess.
 */
export interface VoiceBotEntry {
  agentDocId: ObjectId;
  agentSlug: string;
  pid: number;
  invitedByUserId: ObjectId;
  invitedAt: Date;
}

// TTL-cleaned up via the expiresAt Mongo TTL index.
export interface MintReservationDoc {
  _id: ObjectId;
  reservedId: string;             // uuid, returned to client and echoed on /mint/confirm
  userId: ObjectId;               // FK -> users
  slug: string;                   // claimed slug (transient lock)
  manifestUri: string;
  bundleUri: string;
  sealedDEKBaseUri: string;
  bundleHash: string;
  status: 'uploaded' | 'minted' | 'expired';
  createdAt: Date;
  expiresAt: Date;                // TTL anchor — Mongo TTL index drops expired rows
}

export interface ServerWalletDoc {
  address: string;
  privateKey: string;
  network: 'og-testnet';
  createdAt: Date;
}

export interface ServerDoc {
  _id: ObjectId;
  name: string;
  slug: string;
  iconUrl: string | null;
  ownerId: ObjectId;
  wallet?: ServerWalletDoc;
  createdAt: Date;
  updatedAt: Date;
}

export type PrincipalType = 'user' | 'agent';
export type MemberRole = 'owner' | 'admin' | 'member';

export interface ServerMemberDoc {
  _id: ObjectId;
  serverId: ObjectId;
  principalType: PrincipalType;
  principalId: ObjectId;
  role: MemberRole;
  alias: string | null;
  joinedAt: Date;
  /** Set when the invite was paid via an OG transaction. */
  paidTxHash?: string;
  paidAmount?: string;
  paidByUserId?: ObjectId;
}

export interface ChannelDoc {
  _id: ObjectId;
  serverId: ObjectId;
  name: string;
  topic: string | null;
  type: 'text' | 'voice' | 'audit' | 'knowledge';
  defaultAgentId: ObjectId | null;
  position: number;
  cascadeEnabled?: boolean;
  createdAt: Date;
  /**
   * Private (TEE-attested) channel. When true:
   *   - knowledge-base context injection is skipped (privacy boundary).
   *   - agent replies are stamped with a per-message attestation hash.
   *   - audit entries are redacted to action='tee_session' + hash only.
   * Demo-only — the attestation is computed by the backend, not by a real
   * enclave. See createChannel() for the hash construction.
   */
  tee?: boolean;
  teeAttestationHash?: string;
}

/**
 * Knowledge base document — one per server-uploaded note or file.
 * Auto-fed into agent prompts when an agent is invoked in the same server,
 * and queryable via /v1/servers/:sid/knowledge/search.
 */
export interface KnowledgeDocDoc {
  _id: ObjectId;
  serverId: ObjectId;
  channelId: ObjectId;            // the knowledge-base channel that holds it
  title: string;
  content: string;                // utf-8 markdown or plain text
  source: 'inline' | 'upload';
  filename: string | null;        // original upload filename, when source==='upload'
  mimeType: string | null;        // 'text/markdown' | 'text/plain' | null
  sizeBytes: number;
  createdBy: ObjectId;            // user._id
  createdAt: Date;
  updatedAt: Date;
}

export interface VoiceSessionDoc {
  _id: ObjectId;
  channelId: ObjectId;
  serverId: ObjectId;
  dailyRoomName: string;       // unique room name
  dailyRoomUrl: string;        // https://<domain>.daily.co/<roomName>
  participantIds: ObjectId[];  // active user IDs (Mongo refs)
  status: 'starting' | 'active' | 'ended';
  startedAt: Date;
  expiresAt: Date;             // startedAt + 10 minutes
  endedAt: Date | null;
  // DEPRECATED — kept for backwards compat with old rows; do not write on new sessions
  pythonPid?: number | null;
  agentSlug?: string | null;
  agentSoul?: string;
  // NEW — each invited bot has its own entry; empty by default
  bots: VoiceBotEntry[];
}

export interface MessageMention { type: PrincipalType; id: ObjectId; }

export interface MessageDoc {
  _id: ObjectId;
  channelId: ObjectId;
  serverId: ObjectId;
  authorType: PrincipalType;
  authorId: ObjectId;
  content: string;
  mentions: MessageMention[];
  replyToId: ObjectId | null;
  parentMessageId?: ObjectId | null;
  cascadeRootId?: ObjectId;
  cascadeHop?: number;
  createdAt: Date;
  editedAt: Date | null;
  /** Present on agent replies sent in TEE channels — see ChannelDoc.tee. */
  teeHash?: string;
}

export type AuditActorType = 'user' | 'agent' | 'system';

export interface AuditLogDoc {
  _id: ObjectId;
  serverId: ObjectId;
  channelId: ObjectId;
  actorType: AuditActorType;
  actorId: ObjectId | null;
  agentId: ObjectId | null;
  agentSlug: string | null;
  action: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export const collections = {
  users: 'users',
  agents: 'agents',
  servers: 'servers',
  serverMembers: 'serverMembers',
  channels: 'channels',
  messages: 'messages',
  mintReservations: 'mintReservations',
  voiceSessions: 'voiceSessions',
  auditLog: 'auditLog',
  knowledgeDocs: 'knowledgeDocs',
} as const;
