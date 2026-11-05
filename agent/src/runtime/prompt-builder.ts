import type { SkillRecord } from '../skills/loader.js';

export interface BuildArgs {
  agentName: string;
  soul: string;
  agents: string;
  skills: SkillRecord[];
  memorySnippets: string[];
}

export function buildSystemPrompt(a: BuildArgs): string {
  const skillsXml = a.skills.map(s =>
    `<skill>\n  <name>${escapeXml(s.name)}</name>\n  <description>${escapeXml(s.description)}</description>\n  <location>${escapeXml(s.dir ?? '')}</location>\n</skill>`
  ).join('\n');

  return `You are ${a.agentName}.

<soul>
${a.soul.trim()}
</soul>

<operating_rules>
${a.agents.trim()}
</operating_rules>

<available_skills>
${skillsXml}
</available_skills>

<memory_context>
${a.memorySnippets.join('\n')}
</memory_context>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' } as any)[c]);
}
