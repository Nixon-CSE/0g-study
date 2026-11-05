export interface BackendUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  email?: string;
  isService?: boolean;
}

export interface BackendServer {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  ownerId: string;
  createdAt: string;
}

export interface BackendChannel {
  id: string;
  serverId: string;
  name: string;
  topic: string | null;
  type: 'text' | 'voice' | 'audit' | 'knowledge';
  defaultAgentId: string | null;
  position: number;
  cascadeEnabled: boolean;
  createdAt: string;
  /** TEE-attested (private) channel. Knowledge injection skipped; replies stamped. */
  tee?: boolean;
  teeAttestationHash?: string | null;
}

export interface BackendMessage {
  id: string;
  channelId: string;
  serverId: string;
  authorType: 'user' | 'agent';
  authorId: string;
  authorName: string | null;
  content: string;
  mentions: Array<{ type: 'user' | 'agent'; id: string }>;
  replyToId: string | null;
  parentMessageId: string | null;
  cascadeRootId: string | null;
  cascadeHop: number | null;
  createdAt: string;
  editedAt: string | null;
  /** Present on agent replies in TEE channels — per-message attestation hash. */
  teeHash?: string | null;
}

export interface BackendAgent {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
  description: string;
  bio: string | null;
  tags: string[];
  baseUrl: string;
  createdBy: string;
  createdAt: string;
  /** Invite price in OG (decimal string). "0" or missing means free. */
  priceOg?: string;
  /** On-chain owner wallet address; required for paid invites. */
  ownerWallet?: string | null;
  /** iNFT on-chain fields — present only after mint/confirm. */
  tokenId?: string | null;
  contractAddress?: string | null;
  manifestUri?: string | null;
  bundleUri?: string | null;
  sealedDEKBaseUri?: string | null;
  bundleHash?: string | null;
}

export interface BackendMember {
  id: string;
  serverId: string;
  principalType: 'user' | 'agent';
  principalId: string;
  role: 'owner' | 'admin' | 'member';
  alias: string | null;
  joinedAt: string;
  /** Populated by the backend for principalType==='user' (joined from users collection). */
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface BackendServerWallet {
  address: string;
  /** Present in POST /v1/servers response and GET /v1/servers/:sid/wallet for owners */
  privateKey?: string;
  network: string;
  createdAt: string;
}

export interface BackendServerFunding {
  faucetUrl: string;
  rpcUrl: string;
  chainId?: number;
  tokenSymbol: string;
  minRecommendedBalance?: string;
  note?: string;
}
