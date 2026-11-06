import { Bot } from 'grammy';
import type { ChannelAdapter, InboundMessage } from './base.js';
import type { AgentConfig } from '../config/schema.js';
import { log } from '../util/logger.js';

/** Runtime operations the built-in slash commands need (agent-prd: /help /status /skills /soul /reset). */
export interface TelegramOps {
  status: () => string;
  listSkills: () => { name: string; description: string }[];
  soul: () => string;
  resetSession: (chatId: string) => number;
  installSkill: (slug: string) => Promise<{ ok: boolean; reason?: string }>;
  removeSkill: (name: string) => Promise<boolean>;
}

type TgConfig = AgentConfig['channels']['telegram'];

/** Access control shared by messages and commands. */
export function isAllowed(tg: TgConfig, chat: { id: number | string; type: string }, userId: string, text: string, botUsername?: string): boolean {
  if (chat.type === 'private') {
    if (tg.dmPolicy === 'disabled') return false;
    if (tg.dmPolicy === 'allowlist' && !tg.allowFrom.includes(userId)) return false;
    return true;
  }
  const g = tg.groups[String(chat.id)];
  if (g?.requireMention !== false && !(botUsername && text.includes('@' + botUsername))) return false;
  if (g?.allowFrom?.length && !g.allowFrom.includes(userId)) return false;
  return true;
}

/** The web UI renders ⟦0g:…⟧ as a badge; Telegram gets a plain trailing line instead. */
export function formatTelegramReply(text: string): string {
  return text.replace(/\n*⟦0g:([^⟧]*)⟧\s*$/, (_m, ids: string) => {
    const list = ids.split(',').filter(Boolean);
    return list.length ? `\n\n0G · ${list.join(', ')}` : '';
  });
}

const HELP = [
  '/help — this list',
  '/status — model, skills, uptime',
  '/skills — installed skills',
  '/skills install <slug> — install from agentskill.sh (security-scanned)',
  '/skills remove <name> — remove a skill',
  '/soul — show this agent\'s SOUL.md',
  '/reset — clear this chat\'s memory',
].join('\n');

/** Pure command handler: returns the reply text, or null for unknown commands (passed to the model). */
export async function handleCommand(cmd: string, args: string, chatId: string, ops?: TelegramOps): Promise<string | null> {
  switch (cmd) {
    case 'help':
    case 'start':
      return HELP;
    case 'status':
      return ops ? ops.status() : 'Online.';
    case 'soul': {
      const s = ops?.soul().trim();
      return s ? s.slice(0, 3900) : 'No SOUL.md loaded.';
    }
    case 'reset': {
      if (!ops) return 'Reset is not available.';
      const n = ops.resetSession(chatId);
      return `Session reset — cleared ${n} message${n === 1 ? '' : 's'}.`;
    }
    case 'skills': {
      if (!ops) return 'Skills are not available.';
      const [sub, name] = args.trim().split(/\s+/);
      if (sub === 'install') {
        if (!name) return 'Usage: /skills install <slug>';
        const r = await ops.installSkill(name);
        return r.ok ? `Installed ${name}.` : `Could not install ${name}: ${r.reason ?? 'failed'}`;
      }
      if (sub === 'remove') {
        if (!name) return 'Usage: /skills remove <name>';
        return (await ops.removeSkill(name)) ? `Removed ${name}.` : `No skill named ${name}.`;
      }
      const list = ops.listSkills();
      return list.length ? list.map((s) => `• ${s.name} — ${s.description}`).join('\n').slice(0, 3900) : 'No skills installed.';
    }
    default:
      return null;
  }
}

export class TelegramAdapter implements ChannelAdapter {
  id = 'telegram';
  private bot?: Bot;
  private live = false;
  constructor(private cfg: AgentConfig, private ops?: TelegramOps) {}

  /** True only while the bot is actually connected (started and not stopped or crashed). */
  get running(): boolean { return this.live; }

  async start(onMessage: (m: InboundMessage) => Promise<void>) {
    const tg = this.cfg.channels.telegram;
    if (!tg.enabled) return;
    const token = process.env[tg.tokenEnv];
    if (!token) { log.warn('Telegram enabled but token env empty; skipping'); return; }
    const bot = new Bot(token);
    this.bot = bot;
    let botUsername: string | undefined;

    bot.on('message:text', async (ctx) => {
      const m = ctx.message; if (!m) return;
      const chat = ctx.chat; if (!chat) return;
      const userId = String(ctx.from?.id ?? 'unknown');
      const chatId = String(chat.id);
      if (!botUsername) botUsername = (await ctx.api.getMe()).username;
      if (!isAllowed(tg, chat, userId, m.text, botUsername)) return;

      const cmdMatch = m.text.match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
      if (cmdMatch) {
        const out = await handleCommand(cmdMatch[1].toLowerCase(), cmdMatch[2] ?? '', chatId, this.ops);
        if (out !== null) { await ctx.reply(out); return; }
        // Unknown slash commands fall through to the model (agent-prd).
      }

      const preview = await ctx.reply('…');
      await onMessage({
        channel: 'telegram',
        chatId, userId,
        text: m.text,
        raw: ctx,
        reply: async (text) => {
          const out = formatTelegramReply(text);
          try { await ctx.api.editMessageText(chat.id, preview.message_id, out, { parse_mode: 'HTML' }); }
          catch { await ctx.api.editMessageText(chat.id, preview.message_id, out); }
        },
        editLast: async (text) => {
          try { await ctx.api.editMessageText(chat.id, preview.message_id, formatTelegramReply(text)); } catch {}
        },
      });
    });

    bot.start({ onStart: (info) => { this.live = true; botUsername = info.username; log.info({ username: info.username }, 'telegram bot started'); } })
      .then(() => { this.live = false; })
      .catch((e) => { this.live = false; log.error({ err: String(e?.message ?? e).slice(0, 200) }, 'telegram bot stopped with an error'); });
  }

  async stop() { this.live = false; await this.bot?.stop(); }
}
