import { describe, it, expect } from 'vitest';
import { TelegramAdapter } from '../src/channels/telegram.js';

describe('TelegramAdapter', () => {
  it('does not start when disabled', async () => {
    const cfg: any = { channels: { telegram: { enabled: false, tokenEnv: 'NONE', dmPolicy: 'open', allowFrom: [], groups: {} } } };
    const a = new TelegramAdapter(cfg);
    await a.start(async () => {});
    expect(true).toBe(true);
  });

  it('does not start when token env is missing', async () => {
    delete process.env.TG_TEST_NOPE;
    const cfg: any = { channels: { telegram: { enabled: true, tokenEnv: 'TG_TEST_NOPE', dmPolicy: 'open', allowFrom: [], groups: {} } } };
    const a = new TelegramAdapter(cfg);
    await a.start(async () => {});
    expect(true).toBe(true);
  });
});

import { isAllowed, formatTelegramReply, handleCommand, type TelegramOps } from '../src/channels/telegram.js';

const tg: any = { dmPolicy: 'allowlist', allowFrom: ['42'], groups: { '-100': { requireMention: true, allowFrom: [] } } };

describe('telegram access control (applies to commands too)', () => {
  it('enforces the DM allowlist', () => {
    expect(isAllowed(tg, { id: 42, type: 'private' }, '42', 'hi')).toBe(true);
    expect(isAllowed(tg, { id: 7, type: 'private' }, '7', '/reset')).toBe(false);
  });
  it('requires a mention in groups', () => {
    expect(isAllowed(tg, { id: -100, type: 'group' }, '7', 'hello', 'ember_bot')).toBe(false);
    expect(isAllowed(tg, { id: -100, type: 'group' }, '7', 'hey @ember_bot', 'ember_bot')).toBe(true);
  });
});

describe('formatTelegramReply', () => {
  it('turns the request-id marker into a readable line', () => {
    expect(formatTelegramReply('Answer\n\n⟦0g:a,b⟧')).toBe('Answer\n\n0G · a, b');
    expect(formatTelegramReply('Plain')).toBe('Plain');
  });
});

describe('handleCommand', () => {
  const ops: TelegramOps = {
    status: () => 'Ember online · 2 skills',
    listSkills: () => [{ name: 'learn', description: 'install skills' }],
    soul: () => 'Be brief.',
    resetSession: (chatId) => (chatId === 'c1' ? 3 : 0),
    installSkill: async (slug) => (slug === 'good' ? { ok: true } : { ok: false, reason: 'critical finding' }),
    removeSkill: async (name) => name === 'learn',
  };
  it('wires /status, /soul, /reset, /skills', async () => {
    expect(await handleCommand('status', '', 'c1', ops)).toContain('Ember online');
    expect(await handleCommand('soul', '', 'c1', ops)).toBe('Be brief.');
    expect(await handleCommand('reset', '', 'c1', ops)).toBe('Session reset — cleared 3 messages.');
    expect(await handleCommand('skills', '', 'c1', ops)).toContain('• learn');
    expect(await handleCommand('skills', 'install good', 'c1', ops)).toBe('Installed good.');
    expect(await handleCommand('skills', 'install bad', 'c1', ops)).toContain('critical finding');
    expect(await handleCommand('skills', 'remove learn', 'c1', ops)).toBe('Removed learn.');
    expect(await handleCommand('help', '', 'c1', ops)).toContain('/skills install');
  });
  it('passes unknown commands to the model', async () => {
    expect(await handleCommand('summarize', 'this', 'c1', ops)).toBeNull();
  });
});
