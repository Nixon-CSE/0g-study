'use client';
import { useEffect, useState, useCallback } from 'react';
import { Check, Copy } from 'lucide-react';
import { bf } from '@/lib/api-bonfire';
import type { BackendServerWallet, BackendServerFunding } from '@/lib/types';
import Modal, { ModalLabel, ModalInput } from '@/components/shared/Modal';
import { useFundServerWallet } from '@/lib/server-wallet';
import { useAuth } from '@/components/auth/AuthProvider';

/** Below this OG balance we warn, show faucet link, and omit the tier pill (no "Low" label). */
const LOW_BALANCE_THRESHOLD_OG = 0.1;

interface Props {
  serverId: string;
}

function BoostIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5L10.5 6H13.5L11 9H13L8 14.5L3 9H5L2.5 6H5.5L8 1.5Z" fill="url(#boost-grad)" />
      <defs>
        <linearGradient id="boost-grad" x1="8" y1="1.5" x2="8" y2="14.5" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function WalletPanel({ serverId }: Props) {
  const [wallet, setWallet] = useState<BackendServerWallet | null>(null);
  const [funding, setFunding] = useState<BackendServerFunding | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<'topup' | 'withdraw' | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    bf.getServerWallet(serverId)
      .then((r) => {
        setWallet(r.wallet);
        setFunding(r.funding);
        setBalance(r.balance);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'failed';
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, [serverId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    setAddressCopied(false);
  }, [serverId, wallet?.address]);

  const copyWalletAddress = async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setAddressCopied(true);
      window.setTimeout(() => setAddressCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (loading && !wallet) {
    return (
      <div className="mx-2 mb-2 px-3 py-2 rounded-lg text-sm" style={{ color: 'var(--bf-symbol)', background: 'var(--bf-quaternary)' }}>
        Loading wallet…
      </div>
    );
  }

  if (error || !wallet) {
    return (
      <div className="mx-2 mb-2 px-3 py-2 rounded-lg text-sm" style={{ color: 'var(--bf-symbol)', background: 'var(--bf-quaternary)' }}>
        Wallet unavailable
      </div>
    );
  }

  const short = wallet.address.slice(0, 6) + '…' + wallet.address.slice(-4);
  const bal = balance !== null ? Number(balance) : null;
  const lowBalance = bal !== null && bal < LOW_BALANCE_THRESHOLD_OG;

  const tier =
    bal === null ? null :
    bal >= 10 ? { label: "Blazing", color: "#7a5013" } :
    bal >= 2 ? { label: "Powered", color: "#7c9cf5" } :
    bal >= LOW_BALANCE_THRESHOLD_OG ? { label: "Active", color: "var(--bf-accent)" } :
    null;

  return (
    <div
      className="mx-2 mb-2 rounded-lg px-3 py-2.5"
      style={{ background: 'var(--bf-quaternary)', border: '1px solid var(--bf-quinary)' }}
    >
      {/* Top row: icon + label + refresh */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <BoostIcon size={16} />
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#c084fc' }}>
            Server Boost
          </span>
          {tier && (
            <span
              className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: `${tier.color}22`, color: tier.color, fontSize: 10 }}
            >
              {tier.label}
            </span>
          )}
        </div>
        <button onClick={load} title="Refresh balance" className="text-sm" style={{ color: 'var(--bf-symbol)' }}>
          ↻
        </button>
      </div>

      {/* Balance */}
      <div
        className="text-lg font-bold"
        style={{ color: lowBalance ? 'var(--negative)' : 'var(--foreground)' }}
      >
        {bal !== null ? `${bal.toFixed(4)} OG` : '— OG'}
      </div>

      {/* Wallet address — click to copy full address */}
      <button
        type="button"
        onClick={copyWalletAddress}
        title={addressCopied ? 'Copied' : 'Copy address'}
        aria-label={addressCopied ? 'Address copied' : 'Copy wallet address'}
        className="mt-0.5 flex w-full cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent py-0.5 pl-0 pr-0 text-left transition-colors hover:opacity-90"
      >
        <code className="min-w-0 flex-1 truncate font-mono text-xs" style={{ color: 'var(--bf-gray)' }}>
          {short}
        </code>
        {addressCopied ? (
          <Check className="shrink-0" size={14} strokeWidth={2.25} style={{ color: '#86efac' }} aria-hidden />
        ) : (
          <Copy className="shrink-0 opacity-70" size={14} strokeWidth={2} style={{ color: 'var(--bf-symbol)' }} aria-hidden />
        )}
      </button>

      <div className="flex gap-1.5 mt-2">
        <button
          onClick={() => setAction('topup')}
          className="flex-1 px-2 py-1 rounded text-xs font-semibold"
          style={{ background: 'var(--bf-accent)', color: 'var(--on-ink)' }}
        >
          Top Up
        </button>
        <button
          onClick={() => setAction('withdraw')}
          disabled={!bal || bal <= 0.05}
          className="flex-1 px-2 py-1 rounded text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--bf-quinary)', color: 'var(--bf-white)' }}
        >
          Withdraw
        </button>
      </div>

      {lowBalance && funding && (
        <a
          href={funding.faucetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs underline mt-1.5 inline-block text-zinc-400 hover:text-zinc-300 transition-colors"
        >
          Fund at faucet →
        </a>
      )}

      {action && wallet && (
        <WalletActionModal
          mode={action}
          serverId={serverId}
          serverWalletAddress={wallet.address}
          balance={balance}
          onClose={() => setAction(null)}
          onComplete={() => { setAction(null); load(); }}
        />
      )}
    </div>
  );
}

interface WalletActionProps {
  mode: 'topup' | 'withdraw';
  serverId: string;
  serverWalletAddress: string;
  balance: string | null;
  onClose: () => void;
  onComplete: () => void;
}

function WalletActionModal({ mode, serverId, serverWalletAddress, balance, onClose, onComplete }: WalletActionProps) {
  const { user } = useAuth();
  const { fund } = useFundServerWallet();
  const isTopUp = mode === 'topup';

  // Sensible defaults: top-up = 4 OG (matches min recommended); withdraw =
  // current balance minus a 0.05 OG gas reserve, never negative.
  const defaultAmount = isTopUp
    ? '4'
    : (() => {
        const b = balance !== null ? Number(balance) : 0;
        const max = Math.max(0, b - 0.05);
        return max > 0 ? max.toFixed(4) : '0';
      })();

  const [amount, setAmount] = useState(defaultAmount);
  const [toAddress, setToAddress] = useState(user?.walletAddress ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!/^\d+(\.\d+)?$/.test(amount.trim()) || Number(amount) <= 0) {
      setErr('Enter a positive amount.');
      return;
    }
    setSubmitting(true);
    try {
      if (isTopUp) {
        await fund({ toAddress: serverWalletAddress, amountOg: amount.trim() });
      } else {
        if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress.trim())) {
          setErr('Enter a valid 0x destination address.');
          setSubmitting(false);
          return;
        }
        await bf.withdrawFromServerWallet(serverId, {
          toAddress: toAddress.trim(),
          amount: amount.trim(),
        });
      }
      onComplete();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={isTopUp ? 'Top Up Server Wallet' : 'Withdraw From Server Wallet'}
      subtitle={
        isTopUp
          ? 'Send OG from your connected wallet to this server’s wallet.'
          : 'Send OG from this server’s wallet to any 0G address.'
      }
      onClose={onClose}
      onConfirm={submit}
      confirmDisabled={submitting}
      confirmLabel={submitting ? 'Sending…' : isTopUp ? 'Send' : 'Withdraw'}
    >
      {!isTopUp && (
        <div>
          <ModalLabel>Destination address</ModalLabel>
          <ModalInput
            value={toAddress}
            onChange={(e) => setToAddress(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
          />
          {user?.walletAddress && toAddress !== user.walletAddress && (
            <button
              onClick={() => setToAddress(user.walletAddress!)}
              className="text-xs underline mt-1"
              style={{ color: 'var(--bf-accent)' }}
            >
              Use my wallet ({user.walletAddress.slice(0, 6)}…{user.walletAddress.slice(-4)})
            </button>
          )}
        </div>
      )}
      <div>
        <ModalLabel>Amount (OG)</ModalLabel>
        <ModalInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="4" />
        {!isTopUp && balance !== null && (
          <p className="text-xs mt-1" style={{ color: 'var(--bf-symbol)' }}>
            Server balance: {Number(balance).toFixed(4)} OG (≈0.05 reserved for gas).
          </p>
        )}
      </div>
      {err && <p className="text-xs" style={{ color: '#a8372f' }}>{err}</p>}
    </Modal>
  );
}
