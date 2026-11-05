"use client";
import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/shared/Modal";
import { agentStudyFetch } from "@/lib/agent-study";
import { formatCredits } from "@/lib/credits";

/**
 * FR9 — "Connect your 0G account" (NEXT_PUBLIC_ZEROG_ACCOUNTS=on, agent ZEROG_USER_ACCOUNTS=on).
 *
 * The 0G Router has no OAuth flow; a user brings their account as two keys from pc.0g.ai:
 *   sk-… API key (pays for their pod calls) and mk-… management key with only account:read (balance).
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
    setBusy(true); setErr(null);
    try {
      const r = await agentStudyFetch("/study/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), managementKey: managementKey.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? "Could not connect."); return; }
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
          Connect 0G account
        </button>
      )}
      <span style={{ color: "rgba(255,255,255,0.35)" }}>·</span>

      {open && (
        <Modal
          title="Connect your 0G account"
          subtitle="Your pod calls are then paid from your own 0G Private Computer balance, and the balance shows in the status bar."
          onClose={() => setOpen(false)}
          onConfirm={connect}
          confirmLabel={busy ? "Connecting…" : "Connect"}
          confirmDisabled={busy || !apiKey.startsWith("sk-") || !managementKey.startsWith("mk-")}
        >
          <ol className="text-sm flex flex-col gap-1.5 list-decimal pl-5" style={{ color: "var(--bf-gray)" }}>
            <li>At <a className="underline" href="https://pc.0g.ai/dashboard/api-keys" target="_blank" rel="noreferrer">pc.0g.ai → Dashboard → API Keys</a>, create a key for 0G Study.</li>
            <li>At pc.0g.ai → Settings → Management Keys, create a <b>Read-only</b> key (only <code>account:read</code> is needed).</li>
          </ol>
          <label className="text-xs flex flex-col gap-1" style={{ color: "var(--bf-gray)" }}>
            API key (sk-…)
            <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="rounded px-3 py-2 text-sm outline-none" style={inputStyle} placeholder="sk-…" />
          </label>
          <label className="text-xs flex flex-col gap-1" style={{ color: "var(--bf-gray)" }}>
            Management key (mk-…, read-only)
            <input type="password" autoComplete="off" value={managementKey} onChange={(e) => setManagementKey(e.target.value)} className="rounded px-3 py-2 text-sm outline-none" style={inputStyle} placeholder="mk-…" />
          </label>
          <p className="text-xs" style={{ color: "var(--bf-gray)" }}>
            Keys are stored encrypted on the study server and never shown again. Revoke them at pc.0g.ai any time.
          </p>
          {err && <p className="text-xs" role="alert" style={{ color: "var(--bf-red, #a8372f)" }}>{err}</p>}
        </Modal>
      )}
    </>
  );
}
