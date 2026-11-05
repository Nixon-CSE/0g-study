/** Fully decrypted agent bundle injected inline by the BonFire backend.
 * When present, the runtime uses this directly and skips the tenant registry lookup.
 */
export interface TenantPayload {
  slug: string;
  name: string;
  soul: string;
  agents: string;
  llm: {
    provider?: 'openai-compatible' | 'zerog' | 'zerog-router';
    baseUrl?: string;
    model?: string;
    apiKeyEnv?: string;
    temperature?: number;
    maxTokens?: number;
  };
}

export interface InboundMessage {
  channel: string;
  chatId: string;
  userId: string;
  /** Human student behind this turn (study streaks, daily cap). Distinct from userId, which keys the session. */
  studentId?: string;
  text: string;
  /** Legacy slug-based tenant lookup against the registry. */
  tenant?: string;
  /** Inline decrypted tenant bundle (preferred over `tenant` slug when both are present). */
  tenantInline?: TenantPayload;
  envOverride?: Record<string, string>;
  raw?: unknown;
  reply: (text: string, opts?: { stream?: boolean }) => Promise<void>;
  editLast?: (text: string) => Promise<void>;
}

export interface ChannelAdapter {
  id: string;
  start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}
