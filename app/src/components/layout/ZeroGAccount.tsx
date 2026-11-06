"use client";
import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/shared/Modal";
import { agentStudyFetch } from "@/lib/agent-study";
import { API_KEYS_URL, CONNECT_CTA, MANAGEMENT_KEYS_URL, formatCredits, keyPrefixError } from "@/lib/credits";

/**
 * "Use your daily iAI credits" (NEXT_PUBLIC_ZEROG_ACCOUNTS=on, agent ZEROG_USER_ACCOUNTS=on).
 *
 * iAI daily credits sit in the student's pc.0g.ai balance and any key from that account spends them, so
 * they bring two keys: sk-… API key (pays for their pod calls) and a Read-only mk-… management key
 * (account:read to read the balance, keys:read so the agent can check the sk- key is on that account).
 * The keys are sent once to the agent runtime, stored encrypted server-side and never sent back.
 * The status bar then shows the user's real 0G balance, re-read after each pod reply.
 */
export const ZEROG_ACCOUNTS_ENABLED = process.env.NEXT_PUBLIC_ZEROG_ACCOUNTS === "on";

type Account = { enabled: boolean; connected: boolean; balance0G?: number | null; error?: string };

export default function ZeroGAccount({ refreshKey }: { refreshKey: number }) {
  const [acct, setAcct] = useState<Account | null>(null);
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [managementKey, setManagementKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    await load();
  };

  const inputStyle = { background: "var(--bf-tertiary)", color: "var(--foreground)" };

  return (
    <>
      {acct.connected ? (
        <span className="flex items-center gap-1.5">
          <span title={acct.error ? `0G balance unavailable: ${acct.error}` : "Your 0G Private Computer balance (pays for your pod)"} style={{ color: "rgba(255,255,255,0.9)" }}>
            Credits: {typeof acct.balance0G === "number" ? `${formatCredits(acct.balance0G)} 0G` : "—"}
          </span>
          <button type="button" onClick={disconnect} className="underline cursor-pointer" style={{ color: "rgba(255,255,255,0.55)" }} title="Stop using your 0G account">
            disconnect
          </button>
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
