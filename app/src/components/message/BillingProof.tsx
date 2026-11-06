"use client";
import { useEffect, useState } from "react";
import { agentStudyFetch } from "@/lib/agent-study";
import { billedLine, type BilledCall } from "@/lib/credits";

type Billing = { connected: boolean; currency?: string; items: Record<string, BilledCall> };

/**
 * What this reply cost the signed-in student, fetched only when the 0G badge is clicked. The agent
 * matches the ids against that student's own usage history. History can lag, so a call not found yet
 * shows "—" and is looked up once more. Renders nothing for students who haven't connected.
 */
export default function BillingProof({ ids }: { ids: string[] }) {
  const [data, setData] = useState<Billing | null>(null);
  const key = ids.join(",");

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const read = async (again: boolean) => {
      try {
        const r = await agentStudyFetch(`/study/account/billing?ids=${encodeURIComponent(key)}`);
        const j: Billing | null = r.ok ? await r.json() : null;
        if (cancelled || !j) return;
        setData(j);
        const missing = key.split(",").some((id) => !j.items[id]);
        if (again && j.connected && missing) retry = setTimeout(() => read(false), 6_000);
      } catch { /* the badge still copies the ids */ }
    };
    read(true);
    return () => { cancelled = true; if (retry) clearTimeout(retry); };
  }, [key]);

  if (!data?.connected) return null;
  return (
    <div className="mt-2 rounded-lg p-2.5 text-xs font-mono flex flex-col gap-1" style={{ background: "var(--bf-quaternary)", color: "var(--bf-gray)" }}>
      {ids.map((id) => (
        <p key={id} title={id} className="truncate">
          <span style={{ color: "var(--bf-accent)" }}>{id.slice(0, 8)}…</span>{" "}
          {data.items[id] ? billedLine(data.items[id], data.currency ?? "usd") : "—"}
        </p>
      ))}
    </div>
  );
}
