import { api } from '@/lib/api';

export interface VoiceSession {
  roomUrl: string;
  token: string;
  sessionId: string;
  agentSlug: string | null;
  expiresAt: string;
}

export interface VoiceBot {
  agentSlug: string;
  agentDocId: string;
  invitedAt: string;
}

export const voiceApi = {
  join: (channelId: string) =>
    api<VoiceSession>('POST', `/v1/channels/${channelId}/voice/join`, {}),

  leave: (channelId: string, sessionId: string) =>
    api<{ ok: boolean; ended: boolean }>(
      'POST',
      `/v1/channels/${channelId}/voice/leave`,
      { sessionId },
    ),

  status: (channelId: string) =>
    api<{
      active: boolean;
      sessionId?: string;
      participantCount?: number;
      expiresAt?: string;
      bots?: VoiceBot[];
    }>('GET', `/v1/channels/${channelId}/voice/status`, undefined),

  inviteAgent: (
    channelId: string,
    body: { sessionId: string; agentSlug: string },
  ) =>
    api<{ bot: VoiceBot }>(
      'POST',
      `/v1/channels/${channelId}/voice/invite-agent`,
      body,
    ),

  kickAgent: (
    channelId: string,
    body: { sessionId: string; agentSlug: string },
  ) =>
    api<{ removed: boolean }>(
      'POST',
      `/v1/channels/${channelId}/voice/kick-agent`,
      body,
    ),
};
