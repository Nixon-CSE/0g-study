"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "@/components/shared/Modal";
import { agentStudyFetch } from "@/lib/agent-study";
import { POD_REPLY_EVENT, clearSessionIds, sessionIds } from "@/lib/billing-session";
import {
  API_KEYS_URL, CONNECT_CTA, MANAGEMENT_KEYS_URL, balanceDetails, balanceName, formatMoney, keyPrefixError, sessionLine, toMicro, untilReset,
  type AccountBalance, type BilledCall,
} from "@/lib/credits";

/**
 * "Use your daily iAI credits" (NEXT_PUBLIC_ZEROG_ACCOUNTS=on, agent ZEROG_USER_ACCOUNTS=on).
 *
 * iAI daily credits sit in the student's pc.0g.ai balance and any key from that account spends them, so
 * they bring two keys: sk-… API key (pays for their pod calls) and a Read-only mk-… management key
 * (account:read to read the balance, keys:read so the agent can check the sk- key is on that account).
 * The keys are sent once to the agent runtime, stored encrypted server-side and never sent back.
 * The status bar then shows the real balance, re-read ~3 s and ~8 s after each pod reply: a charge
 * reaches `available` within about 3 s.
 */
export const ZEROG_ACCOUNTS_ENABLED = process.env.NEXT_PUBLIC_ZEROG_ACCOUNTS === "on";

type Account = { enabled: boolean; connected: boolean; balance?: AccountBalance | null; error?: string };

/** Counts down to a lower target so a charge is visible; `drop` is how much just went. */
function useCountdown(target: number | null) {
  const [shown, setShown] = useState<number | null>(null);
  const [drop, setDrop] = useState(0);
  const last = useRef<number | null>(null);
  useEffect(() => {
    const from = last.current;
    last.current = target;
    if (target === null || from === null || target >= from) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = reduced ? 1 : Math.min(1, (t - start) / 900);
      setShown(k < 1 ? from - (from - target) * k : null);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame((t) => { setDrop(from - target); step(t); });
    const clear = setTimeout(() => setDrop(0), 5_000);
    return () => { cancelAnimationFrame(raf); clearTimeout(clear); setShown(null); };
  }, [target]);
  return { value: shown ?? target, drop };
}

export default function ZeroGAccount({ refreshKey }: { refreshKey: number }) {
  const [acct, setAcct] = useState<Account | null>(null);
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [managementKey, setManagementKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [session, setSession] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await agentStudyFetch("/study/account");
      setAcct(r.ok ? await r.json() : null);
    } catch { setAcct(null); }
  }, []);

  // Re-read on mount, every 30s, and whenever the parent sees new usage (a pod reply just spent credits).
  useEffect(() => {
    if (!ZEROG_ACCOUNTS_ENABLED) return;
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load, refreshKey]);

  // A reply just spent credits: the charge shows in `available` within ~3 s.
  useEffect(() => {
    if (!ZEROG_ACCOUNTS_ENABLED) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const onReply = () => { timers.push(setTimeout(load, 3_000), setTimeout(load, 8_000)); };
    window.addEventListener(POD_REPLY_EVENT, onReply);
    return () => { window.removeEventListener(POD_REPLY_EVENT, onReply); timers.forEach(clearTimeout); };
  }, [load]);

  const balance = acct?.balance ?? null;
  const { value: shown, drop } = useCountdown(balance ? toMicro(balance.currency, balance.available) : null);

  // The session line sums what this tab's replies cost, as the student's own history reports it.
  const openDetails = async () => {
    const next = !details;
    setDetails(next);
    if (!next || !balance) return;
    const ids = sessionIds();
    if (ids.length === 0) { setSession(sessionLine([], balance.currency)); return; }
    setSession(null);
    try {
      const r = await agentStudyFetch(`/study/account/billing?ids=${encodeURIComponent(ids.join(","))}`);
      const j: { items?: Record<string, BilledCall>; currency?: string } = r.ok ? await r.json() : {};
      setSession(sessionLine(Object.values(j.items ?? {}), j.currency ?? balance.currency));
    } catch { setSession(null); }
  };

  if (!ZEROG_ACCOUNTS_ENABLED || !acct?.enabled) return null;

  const connect = async () => {
    const bad = keyPrefixError(apiKey, managementKey);
    if (bad) { setErr(bad); return; }
    setBusy(true); setErr(null);
    try {
      const r = await agentStudyFetch("/study/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), managementKey: managementKey.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? "Could not connect. Nothing was saved."); return; }
      setApiKey(""); setManagementKey(""); setOpen(false);
      await load();
    } catch { setErr("Could not reach the study server."); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    await agentStudyFetch("/study/account", { method: "DELETE" }).catch(() => {});
    clearSessionIds();
    setDetails(false);
    await load();
  };

  const inputStyle = { background: "var(--bf-tertiary)", color: "var(--foreground)" };

  return (
    <>
      {acct.connected ? (
        <span className="flex items-center gap-1.5 relative">
          <button
            type="button"
            onClick={openDetails}
            className="cursor-pointer tabular-nums"
            title={acct.error ? `0G balance unavailable: ${acct.error}` : "Your pc.0g.ai balance, which pays for your pod. Click for details."}
            style={{ color: "rgba(255,255,255,0.9)" }}
          >
            {balance && shown !== null
              ? `${balanceName(balance)}: ${formatMoney(balance.currency, shown)} · resets in ${untilReset()}`
              : "0G credits: —"}
          </button>
          {balance && drop > 0 && (
            <span className="tabular-nums" style={{ color: "var(--bf-banana)" }}>−{formatMoney(balance.currency, drop)}</span>
          )}
          <button type="button" onClick={disconnect} className="underline cursor-pointer" style={{ color: "rgba(255,255,255,0.55)" }} title="Stop using your 0G account">
            disconnect
          </button>
          {details && balance && (
            <div
              className="absolute right-0 bottom-full mb-2 w-72 rounded-lg p-3 shadow-2xl z-50 flex flex-col gap-1"
              style={{ background: "var(--bf-secondary)", border: "1px solid var(--bf-border)", color: "var(--foreground)" }}
            >
              {balanceDetails(balance).map((line) => <p key={line}>{line}</p>)}
              <p style={{ color: "var(--bf-gray)" }}>{session ?? "This session: —"}</p>
              <p style={{ color: "var(--bf-gray)" }}>Daily credits refresh at 00:00 UTC, in {untilReset()}.</p>
            </div>
          )}
        </span>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="underline cursor-pointer" style={{ color: "rgba(255,255,255,0.85)" }}>
          {CONNECT_CTA}
        </button>
      )}
      <span style={{ color: "rgba(255,255,255,0.35)" }}>·</span>

      {open && (
        <Modal
          title="Use your daily iAI credits"
          subtitle="Connect your pc.0g.ai account: your pod calls then spend your own credits, not the free tier."
          onClose={() => setOpen(false)}
          onConfirm={connect}
          confirmLabel={busy ? "Connecting…" : "Connect"}
          confirmDisabled={busy || !apiKey.trim() || !managementKey.trim()}
        >
          <ol className="text-sm flex flex-col gap-3 list-decimal pl-5" style={{ color: "var(--bf-gray)" }}>
            <li className="flex flex-col gap-1.5">
              <span>Create an API key at <a className="underline" href={API_KEYS_URL} target="_blank" rel="noreferrer">pc.0g.ai → API Keys</a>, and paste it here.</span>
              <label className="text-xs flex flex-col gap-1">
                API key (sk-…)
                <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="rounded px-3 py-2 text-sm outline-none" style={inputStyle} placeholder="sk-…" />
              </label>
            </li>
            <li className="flex flex-col gap-1.5">
              <span>On the same account, create a key at <a className="underline" href={MANAGEMENT_KEYS_URL} target="_blank" rel="noreferrer">pc.0g.ai → Management Keys</a> with the <b>Read-only</b> preset (<code>account:read</code>, <code>keys:read</code>).</span>
              <label className="text-xs flex flex-col gap-1">
                Management key (mk-…, read-only)
                <input type="password" autoComplete="off" value={managementKey} onChange={(e) => setManagementKey(e.target.value)} className="rounded px-3 py-2 text-sm outline-none" style={inputStyle} placeholder="mk-…" />
              </label>
            </li>
          </ol>
          <p className="text-xs" style={{ color: "var(--bf-gray)" }}>
            Keys are stored encrypted on the study server and never shown again. Revoke them at pc.0g.ai any time.
          </p>
          {err && <p className="text-xs" role="alert" style={{ color: "var(--bf-red, #a8372f)" }}>{err}</p>}
        </Modal>
      )}
    </>
  );
}
