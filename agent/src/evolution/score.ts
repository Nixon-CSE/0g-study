import { generateText, type LanguageModelV1 } from 'ai';
import type { DiscoveredSkill } from './discover.js';

export async function scoreCandidates(model: LanguageModelV1, recentWork: string, items: DiscoveredSkill[]): Promise<{ skill: DiscoveredSkill; score: number; reason: string }[]> {
  const out: { skill: DiscoveredSkill; score: number; reason: string }[] = [];
  for (const s of items.slice(0, 20)) {
    const { text } = await generateText({
      model,
      system: 'Score how useful a skill would be on a 0-10 integer scale. Reply as JSON {"score": N, "reason": "..."}.',
      prompt: `Recent work summary:\n${recentWork}\n\nCandidate: ${s.owner}/${s.slug}\n${s.description}`,
      maxTokens: 200,
    });
    try {
      const j = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
      out.push({ skill: s, score: Number(j.score) || 0, reason: String(j.reason || '') });
    } catch { out.push({ skill: s, score: 0, reason: 'parse failed' }); }
  }
  return out.sort((a, b) => b.score - a.score);
}
