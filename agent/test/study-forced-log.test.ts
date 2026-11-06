/**
 * P2.1: the Tutor's flashcards no longer depend on the model choosing to call study_log. When a
 * study-tutor turn ends without a successful study_log, one follow-up generation forces it
 * (toolChoice), then the P2 appender adds the block. Cards only ever come from a model call.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MockLanguageModelV1 } from 'ai/test';
import { AgentRuntime, FORCE_STUDY_LOG_PROMPT } from '../src/runtime/agent.js';
import { MemoryStore } from '../src/memory/store.js';
import { makeStudyTools } from '../src/tools/builtin/study.js';
import { FLASHCARDS_HEADER } from '../src/study/flashcards.js';
import { detectNarration } from '../src/study/narration.js';

const usage = { promptTokens: 1, completionTokens: 1 };
const raw = { rawPrompt: null, rawSettings: {} };
const CARDS = Array.from({ length: 6 }, (_, i) => ({ q: `Why does step ${i + 1} of the Calvin cycle matter?`, a: `Because of reason ${i + 1}.` }));
const REPLY = 'RuBisCO fixes CO2; ATP and NADPH power the rest.\n\n@study-examiner';
const logCall = (cards = CARDS) => ({ toolCalls: [{ toolCallType: 'function', toolCallId: 'f1', toolName: 'study_log', args: JSON.stringify({ topic: 'Photosynthesis', cards }) }], finishReason: 'tool-calls', usage, rawCall: raw });

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forced-log-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** `followUp` decides what the forced generation does; every doGenerate call's options are recorded. */
function setup(followUp: () => any, opts: { tutorLogs?: boolean } = {}) {
  const seen: any[] = [];
  let n = 0;
  const model = new MockLanguageModelV1({
    doGenerate: async (o: any) => {
      seen.push(o);
      n++;
      if (n === 1 && opts.tutorLogs) return logCall() as any;
      if (n === 1 || (n === 2 && opts.tutorLogs)) return { text: REPLY, finishReason: 'stop', usage, rawCall: raw };
      return followUp();
    },
  });
  const store = new MemoryStore(path.join(dir, `m-${Math.random()}.json`), 8);
  const rt = new AgentRuntime({
    loaded: { dir, config: cfg(), soul: 's', agents: 'r', mcp: { servers: {} } } as any,
    model, embedModel: null, store, getSkills: () => [], getTools: () => makeStudyTools(dir) as any,
  });
  const run = async (slug: string, studentId: string | null = 'alice') => {
    let out = '';
    await rt.handle({ channel: 'web', chatId: 'c', userId: 'u', studentId: studentId ?? undefined, text: '# Notes\nCalvin cycle…',
      tenantInline: { slug, name: slug, soul: 's', agents: 'r', llm: {} }, reply: async (t: string) => { out = t; } } as any);
    store.close();
    return out;
  };
  return { seen, run };
}

describe('forced study_log follow-up (study-tutor only)', () => {
  it('the Tutor skipped study_log: one forced call saves the cards and the block is appended before the hand-off', async () => {
    const { seen, run } = setup(() => ({ ...logCall(), text: 'IGNORED FOLLOW-UP TEXT' }));
    const out = await run('study-tutor');
    expect(seen).toHaveLength(2);
    expect(seen[1].mode.toolChoice).toEqual({ type: 'tool', toolName: 'study_log' });
    expect(seen[1].mode.tools.map((t: any) => t.name)).toEqual(['study_log']);
    // Built from the notes and the Tutor's own reply.
    const prompt = JSON.stringify(seen[1].prompt);
    expect(prompt).toContain('Calvin cycle');
    expect(prompt).toContain('RuBisCO fixes CO2');
    expect(prompt).toContain(FORCE_STUDY_LOG_PROMPT.slice(0, 40));
    expect(out.startsWith('RuBisCO fixes CO2; ATP and NADPH power the rest.\n\n**Flashcards**\n1. Q:')).toBe(true);
    expect(out.trimEnd().endsWith('@study-examiner')).toBe(true);
    expect(out).not.toContain('IGNORED FOLLOW-UP TEXT');
    expect(out.split('\n').filter((l) => /^\d+\. Q: .+ — A: .+/.test(l))).toHaveLength(6);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'study', 'alice', `${new Date().toISOString().slice(0, 10)}.json`), 'utf8'));
    expect(saved[0].cards).toHaveLength(6);
  });

  it('the forced call fails: no block, no narration, reply unchanged', async () => {
    const { seen, run } = setup(() => { throw new Error('router rejected tool_choice'); });
    const out = await run('study-tutor');
    expect(seen).toHaveLength(2);
    expect(out).toBe(REPLY);
    expect(detectNarration(out)).toEqual([]);
  });

  it('the forced call answers without a tool call, or with invalid cards: no block (cards never invented)', async () => {
    const a = setup(() => ({ text: 'Here are cards: Q: x A: y', finishReason: 'stop', usage, rawCall: raw }));
    expect(await a.run('study-tutor')).toBe(REPLY);
    const b = setup(() => logCall([]));
    expect(await b.run('study-tutor')).toBe(REPLY);
    expect(fs.existsSync(path.join(dir, 'study', 'alice'))).toBe(false);
  });

  it('no follow-up when the Tutor already logged, for other tenants, or without a student', async () => {
    const logged = setup(() => { throw new Error('must not be called'); }, { tutorLogs: true });
    const out = await logged.run('study-tutor');
    expect(logged.seen).toHaveLength(2);
    expect(out).toContain(FLASHCARDS_HEADER);
    for (const [slug, student] of [['study-examiner', 'alice'], ['study-note-reader', 'alice'], ['study-tutor', null]] as const) {
      const s = setup(() => { throw new Error('must not be called'); });
      expect(await s.run(slug, student)).toBe(REPLY);
      expect([slug, student, s.seen.length]).toEqual([slug, student, 1]);
    }
  });
});

function cfg(): any {
  return {
    name: 'T', id: 't',
    llm: { baseUrl: 'x', model: 'm', apiKeyEnv: 'X', temperature: 0.7, maxTokens: 100 },
    channels: { telegram: { enabled: false, tokenEnv: 'X', dmPolicy: 'open', allowFrom: [], groups: {} }, web: { enabled: true, path: '/chat' } },
    mcp: { configFile: 'mcp.json' },
    evolution: { mode: 'off', intervalHours: 24, registries: [], interests: [] },
    memory: { maxSessions: 100, compactAfterTokens: 8000, vectorStorePath: 'x' },
    tools: { builtin: {} },
    logging: { level: 'info', logDir: '.' },
  };
}
