/** Display a 0G balance: 3 decimals at 1 0G and above, 3 significant digits below. */
export function formatCredits(balance0G: number): string {
  return balance0G >= 1 ? balance0G.toFixed(3) : balance0G.toPrecision(3);
}

export const CONNECT_CTA = "Use your daily iAI credits →";
export const API_KEYS_URL = "https://pc.0g.ai/dashboard/api-keys";
export const MANAGEMENT_KEYS_URL = "https://pc.0g.ai/dashboard/management-keys";

/** Plain-words problem with the pasted keys, or null. The server checks them again, live. */
export function keyPrefixError(apiKey: string, managementKey: string): string | null {
  const a = apiKey.trim(), m = managementKey.trim();
  if (a.startsWith("mk-") && m.startsWith("sk-")) return "These two keys are swapped: the sk- key goes first.";
  if (!a.startsWith("sk-")) return "The API key should start with sk-.";
  if (!m.startsWith("mk-")) return "The management key should start with mk-.";
  return null;
}
