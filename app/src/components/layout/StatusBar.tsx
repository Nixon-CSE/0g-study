"use client";
import { useEffect, useRef, useState } from "react";
import { Copy, Check, Droplets, ExternalLink, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { agentStudyFetch } from "@/lib/agent-study";
import ZeroGAccount from "@/components/layout/ZeroGAccount";

const RPC_URL = "https://evmrpc-testnet.0g.ai";
const POLL_MS = 30_000;
const FAUCET_URL = "https://faucet.0g.ai";
const EXPLORER_URL = "https://chainscan-galileo.0g.ai";

function formatOg(weiHex: string): string {
  const wei = BigInt(weiHex);
  const denom = BigInt("1000000000000000000");
  const whole = wei / denom;
  const frac = wei % denom;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 4);
  return `${whole.toString()}.${fracStr}`;
}

async function fetchBalance(address: string): Promise<string> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return formatOg(json.result);
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function FundPopover({
  address,
  onClose,
}: {
  address: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer to avoid catching the same click that opened the popover
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    document.addEventListener("keydown", esc);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const copyAddr = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      ref={ref}
      className="absolute right-0 bottom-full mb-2 w-80 rounded-lg p-4 shadow-2xl z-50"
      style={{
        background: "var(--bf-secondary)",
        border: "1px solid var(--bf-border)",
        color: "var(--bf-white)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Droplets size={16} style={{ color: "var(--bf-plum)" }} />
          <h3 className="text-sm font-semibold">Wallet has 0 OG</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="hover:text-[var(--foreground)]"
          style={{ color: "var(--bf-symbol)" }}
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>
      <p className="text-xs mb-3 leading-relaxed" style={{ color: "var(--bf-gray)" }}>
        You need OG on the 0G Galileo Testnet to mint agents and pay for inference.
        Top up using one of the options below.
      </p>

      <div
        className="rounded p-2 mb-3 flex items-center justify-between gap-2"
        style={{ background: "var(--bf-quaternary)" }}
      >
        <code
          className="text-[11px] truncate"
          style={{ color: "var(--bf-gray)" }}
          title={address}
        >
          {address}
        </code>
        <button
          type="button"
          onClick={copyAddr}
          className="flex-shrink-0 flex items-center gap-1 text-[11px] px-2 py-1 rounded hover:text-[var(--foreground)]"
          style={{ color: "var(--bf-symbol)", background: "var(--bf-quinary)" }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <ol className="text-xs space-y-2 mb-3" style={{ color: "var(--bf-gray)" }}>
        <li className="flex gap-2">
          <span style={{ color: "var(--bf-plum)" }}>1.</span>
          <span>Copy your wallet address above.</span>
        </li>
        <li className="flex gap-2">
          <span style={{ color: "var(--bf-plum)" }}>2.</span>
          <span>
            Open the official 0G faucet, paste your address, and request testnet OG.
          </span>
        </li>
        <li className="flex gap-2">
          <span style={{ color: "var(--bf-plum)" }}>3.</span>
          <span>
            Wait ~30s for the tx to confirm. The balance here refreshes automatically.
          </span>
        </li>
      </ol>

      <div className="flex flex-col gap-1.5">
        <a
          href={FAUCET_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between text-xs px-3 py-2 rounded font-semibold"
          style={{ background: "var(--bf-plum)", color: "var(--on-ink)" }}
        >
          <span className="flex items-center gap-1.5">
            <Droplets size={12} /> Open 0G Faucet
          </span>
          <ExternalLink size={12} />
        </a>
        <a
          href={`${EXPLORER_URL}/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between text-xs px-3 py-2 rounded hover:text-[var(--foreground)]"
          style={{ background: "var(--bf-quaternary)", color: "var(--bf-gray)" }}
        >
          <span>View on 0G Explorer</span>
          <ExternalLink size={12} />
        </a>
      </div>

      <p
        className="text-[10px] mt-3 leading-relaxed"
        style={{ color: "var(--bf-symbol)" }}
      >
        Have OG in another wallet? Send it to the address above on the 0G Galileo
        testnet (chain 16602).
      </p>
    </div>
  );
}

/** Phones: the network, wallet and OG balance that the status bar has no room for. */
export function WalletCard() {
  const { user } = useAuth();
  const address = user?.walletAddress ?? null;
  const [balance, setBalance] = useState<string | null>(null);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    fetchBalance(address).then((b) => { if (!cancelled) setBalance(b); }).catch(() => {});
    return () => { cancelled = true; };
  }, [address]);
  return (
    <div className="px-4 py-3 text-xs border-t flex flex-col gap-1" style={{ borderColor: "var(--bf-quinary)", color: "var(--bf-gray)" }}>
      <p>0G Galileo Testnet</p>
      {address ? (
        <>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(address).catch(() => {})}
            className="flex items-center gap-1.5 min-h-[44px] text-left"
            title={`Copy ${address}`}
          >
            <span className="font-mono">{shortAddr(address)}</span>
            <Copy size={12} />
          </button>
          <p>{balance === null ? "—" : `${balance} OG`}</p>
          {balance !== null && parseFloat(balance) === 0 && (
            <a className="underline py-2" href={FAUCET_URL} target="_blank" rel="noopener noreferrer">Get OG at the 0G faucet</a>
          )}
        </>
      ) : <p>wallet not connected</p>}
    </div>
  );
}

export default function StatusBar() {
  const { user } = useAuth();
  const address = user?.walletAddress ?? null;
  const [balance, setBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fundOpen, setFundOpen] = useState(false);
  const autoOpenedRef = useRef(false);
  const [pc, setPc] = useState<{ calls: number; tokens: number; streak: number; today: number } | null>(null);

  // 0G Private Computer usage today + study streak (agent runtime).
  const studentId = user?.id ?? "";
  useEffect(() => {
    if (!studentId) { setPc(null); return; }
    let cancelled = false;
    const tick = async () => {
      try {
        const [u, s] = await Promise.all([
          agentStudyFetch("/usage").then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }),
          agentStudyFetch(`/study/index?user=${encodeURIComponent(studentId)}`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }),
        ]);
        if (!cancelled) setPc({ calls: u.calls, tokens: u.tokens, streak: s.streak, today: s.today });
      } catch { if (!cancelled) setPc(null); }
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [studentId]);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!address) {
      setBalance(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      setLoading(true);
      try {
        const bal = await fetchBalance(address);
        if (!cancelled) {
          setBalance(bal);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "fetch failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address]);

  // Reset the auto-open guard whenever the wallet changes or balance becomes positive
  useEffect(() => {
    if (!address) {
      autoOpenedRef.current = false;
      setFundOpen(false);
      return;
    }
    if (balance !== null && parseFloat(balance) > 0) {
      autoOpenedRef.current = false;
    }
  }, [address, balance]);

  // Auto-open the popover the first time we observe a zero balance
  useEffect(() => {
    if (!address) return;
    if (balance === null) return;
    // Not on phones: it would cover the composer, and wallet details live in the drawer there.
    if (parseFloat(balance) === 0 && !autoOpenedRef.current && window.innerWidth >= 768) {
      autoOpenedRef.current = true;
      setFundOpen(true);
    }
  }, [address, balance]);

  const isZero = balance !== null && parseFloat(balance) === 0;

  return (
    <div
      className="flex items-center gap-3 px-3 py-1 text-xs border-t relative whitespace-nowrap max-w-full"
      style={{
        background: "var(--bf-plum)",
        borderColor: "rgba(0,0,0,0.25)",
        color: "rgba(255,255,255,0.85)",
        height: "calc(24px + env(safe-area-inset-bottom))",
        paddingBottom: "calc(4px + env(safe-area-inset-bottom))",
        flexShrink: 0,
      }}
    >
      <div className="hidden min-[1100px]:flex items-center gap-2 flex-shrink-0">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: address ? "var(--bf-banana)" : "rgba(255,255,255,0.5)" }}
        />
        <span style={{ color: "rgba(255,255,255,0.75)" }}>0G Galileo Testnet</span>
      </div>

      {/* One line at any width. Credits, calls and streak never shrink; details drop out below ~900 px, the
          network label and wallet address below ~1100 px, and the OG balance truncates, then goes
          below ~520 px. Measured in a browser from 1440 to 320 px: one line, no horizontal scroll. Truncation is per
          item: overflow-hidden here would clip the popovers that open upward from this row. */}
      <div className="flex items-center gap-3 relative min-w-0 ml-auto">
        {pc && <ZeroGAccount refreshKey={pc.calls} />}
        {pc && (
          <>
            <span className="flex-shrink-0" title={`0G Private Computer usage today: ${pc.calls} calls, ${pc.tokens.toLocaleString()} tokens`} style={{ color: "rgba(255,255,255,0.85)" }}>
              ⚡ {pc.calls} calls<span className="hidden min-[900px]:inline"> · {pc.tokens.toLocaleString()} tokens today</span>
            </span>
            <span className="flex-shrink-0" title={`Daily study streak: ${pc.streak} days, ${pc.today} cards today`} style={{ color: "var(--bf-banana)" }}>
              🔥 {pc.streak}-day streak<span className="hidden min-[900px]:inline"> · {pc.today} cards today</span>
            </span>
            <span className="hidden min-[1100px]:inline" style={{ color: "rgba(255,255,255,0.35)" }}>·</span>
          </>
        )}
        {address ? (
          <>
            <button
              type="button"
              onClick={handleCopy}
              title={copied ? "Copied!" : `Copy ${address}`}
              className="hidden min-[1100px]:flex items-center gap-1 flex-shrink-0 hover:text-[var(--foreground)] transition-colors cursor-pointer"
              style={{ color: "rgba(255,255,255,0.75)" }}
            >
              <span>{shortAddr(address)}</span>
              {copied ? (
                <Check size={12} style={{ color: "var(--bf-banana)" }} />
              ) : (
                <Copy size={12} />
              )}
            </button>
            <span className="hidden min-[768px]:inline flex-shrink-0" style={{ color: "rgba(255,255,255,0.35)" }}>·</span>
            {error ? (
              <span className="hidden min-[768px]:inline min-w-0 truncate" style={{ color: "var(--bf-banana)" }} title={error}>
                balance unavailable
              </span>
            ) : balance !== null ? (
              <span className="hidden min-[768px]:flex items-center gap-2 min-w-0">
                <span className="min-w-0 truncate" title={`Wallet balance: ${balance} OG`}>
                  <span
                    className="font-semibold"
                    style={{ color: isZero ? "var(--bf-banana)" : "var(--bf-white)" }}
                  >
                    {balance}
                  </span>{" "}
                  <span style={{ color: "rgba(255,255,255,0.75)" }}>OG</span>
                </span>
                {isZero && (
                  <button
                    type="button"
                    onClick={() => setFundOpen((o) => !o)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold hover:opacity-90 flex-shrink-0"
                    style={{ background: "var(--bf-banana)", color: "var(--bf-primary)" }}
                  >
                    <Droplets size={10} /> Get OG
                  </button>
                )}
              </span>
            ) : (
              <span style={{ color: "rgba(255,255,255,0.6)" }}>
                {loading ? "loading…" : "—"}
              </span>
            )}

            {fundOpen && address && (
              <FundPopover address={address} onClose={() => setFundOpen(false)} />
            )}
          </>
        ) : (
          <span className="hidden min-[768px]:inline min-w-0 truncate" title="wallet not connected" style={{ color: "rgba(255,255,255,0.75)" }}>wallet not connected</span>
        )}
      </div>
    </div>
  );
}
