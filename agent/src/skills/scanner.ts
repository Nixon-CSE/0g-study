export interface Finding { rule: string; match: string; line: number; }
export interface ScanResult { critical: Finding[]; warnings: Finding[]; }

const CRITICAL: { rule: string; re: RegExp }[] = [
  { rule: 'pipe-to-sh',   re: /\b(?:curl|wget)\s[^|\n]*\|\s*(?:ba)?sh\b/i },
  { rule: 'rm-rf-root',   re: /\brm\s+-rf\s+\/(?:\s|$)/ },
  { rule: 'hardcoded-key',re: /\b(sk-[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{16})\b/ },
  { rule: 'eval-remote',  re: /\beval\s*\(\s*(?:await\s+)?(?:fetch|http\.get|require\('https?'\))/ },
];
const WARN: { rule: string; re: RegExp }[] = [
  { rule: 'child-exec',   re: /child_process[^.]*\.\s*(exec|execSync|spawnSync)\b/ },
  { rule: 'fs-write',     re: /\bfs(?:\.promises)?\.\s*(writeFile|appendFile|writeFileSync)\b/ },
];

export function scanContent(content: string): ScanResult {
  const critical: Finding[] = [];
  const warnings: Finding[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const r of CRITICAL) { const m = line.match(r.re); if (m) critical.push({ rule: r.rule, match: m[0], line: i + 1 }); }
    for (const r of WARN)     { const m = line.match(r.re); if (m) warnings.push({ rule: r.rule, match: m[0], line: i + 1 }); }
  });
  return { critical, warnings };
}
