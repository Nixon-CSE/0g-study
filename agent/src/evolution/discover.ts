export interface DiscoveredSkill { slug: string; owner: string; description: string; securityScore?: number; }

export async function discover(interests: string[]): Promise<DiscoveredSkill[]> {
  const out: DiscoveredSkill[] = [];
  const seen = new Set<string>();
  for (const tag of interests) {
    try {
      const r = await fetch(`https://agentskill.sh/api/skills?q=${encodeURIComponent(tag)}&limit=20`);
      if (!r.ok) continue;
      const data: any = await r.json();
      for (const it of (data.data ?? data.results ?? [])) {
        const slug = it.owner && it.name ? `${it.owner}/${it.name}` : (it.slug ?? it.name);
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        out.push({
          slug,
          owner: it.owner ?? it.githubOwner ?? '',
          description: it.description ?? '',
          securityScore: typeof it.contentQualityScore === 'number' ? it.contentQualityScore : it.securityScore,
        });
      }
    } catch { /* registry endpoints may change; documented in code */ }
  }
  return out;
}
