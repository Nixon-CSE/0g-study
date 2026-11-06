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

/**
 * A student's balance as the agent reports it (exact strings). `usd` amounts are integer micro-USD,
 * `0g` amounts are neuron (1e18 = 1 0G). `available` already has unsettled charges taken off.
 */
export interface AccountBalance { currency: "usd" | "0g"; available: string; credit: string; deposit: string; unsettled: string }
export type Currency = AccountBalance["currency"] | string;

/** An amount in millionths of its unit, for display and animation only. */
export function toMicro(currency: Currency, amount: string): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return currency === "usd" ? n : n / 1e12;
}

/** `$0.4375` or `1.500 0G`. USD is cut off, not rounded, so a balance is never overstated. */
export function formatMoney(currency: Currency, micro: number, decimals = 4): string {
  const m = Math.max(0, Math.floor(micro));
  if (currency !== "usd") return `${formatCredits(m / 1e6)} 0G`;
  return `$${Math.floor(m / 1e6)}.${String(m % 1e6).padStart(6, "0").slice(0, decimals)}`;
}

/** The status bar's name for the number: deposits count too, so it is only "credits" without any. */
export function balanceName(b: Pick<AccountBalance, "deposit">): string {
  return toMicro("usd", b.deposit) > 0 ? "0G balance" : "0G credits";
}

/** Popover lines. Deposits show only when there are some. */
export function balanceDetails(b: AccountBalance): string[] {
  const lines = [`0G credits (incl. daily iAI): ${formatMoney(b.currency, toMicro(b.currency, b.credit))}`];
  if (toMicro(b.currency, b.deposit) > 0) lines.push(`Deposits: ${formatMoney(b.currency, toMicro(b.currency, b.deposit))}`);
  return lines;
}

/** Time to the 00:00 UTC credit refresh, e.g. `3h 14m`. */
export function untilReset(now: Date = new Date()): string {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const mins = Math.max(1, Math.ceil((next - now.getTime()) / 60_000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export interface BilledCall { cost: string; creditUsed: string; depositUsed: string; model: string | null }

/** `billed to your 0G account: $0.001034 · credits · gemini-2.5-flash`. */
export function billedLine(call: BilledCall, currency: Currency): string {
  const credit = Number(call.creditUsed) > 0, deposit = Number(call.depositUsed) > 0;
  const paidBy = credit && deposit ? "credits + deposits" : deposit ? "deposits" : "credits";
  return [`billed to your 0G account: ${formatMoney(currency, toMicro(currency, call.cost), 6)}`, paidBy, call.model].filter(Boolean).join(" · ");
}

/** `This session: 3 calls · $0.0051 from your credits`: the sum of the calls matched in the student's history. */
export function sessionLine(calls: BilledCall[], currency: Currency): string {
  const total = calls.reduce((n, c) => n + toMicro(currency, c.cost), 0);
  return `This session: ${calls.length} call${calls.length === 1 ? "" : "s"} · ${formatMoney(currency, total)} from your credits`;
}
