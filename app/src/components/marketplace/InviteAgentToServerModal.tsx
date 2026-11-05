'use client';

/**
 * InviteAgentToServerModal
 *
 * Invites a marketplace agent to one of the user's servers.
 * If the agent has a non-zero priceOg:
 *   1. Opens Privy's native-transfer modal (to=ownerWallet, value=priceOg, chainId=16602)
 *   2. On confirmation, posts to POST /v1/servers/:sid/invite-agent with paymentTxHash
 * For free agents the payment step is skipped entirely.
 */

import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { ApiError } from '@/lib/api';
import { bf } from '@/lib/api-bonfire';
import { useSendOgPayment } from '@/lib/inft';
import type { BackendAgent } from '@/lib/types';
import type { Server } from '@/context/AppContext';
import Modal from '@/components/shared/Modal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate a 0x address to "0x1234…abcd" */
function truncateAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function isPriced(agent: BackendAgent): boolean {
  const price = parseFloat(agent.priceOg ?? '0');
  return Number.isFinite(price) && price > 0;
}

// ---------------------------------------------------------------------------
// Toast helpers
// ---------------------------------------------------------------------------

type ToastKind = 'success' | 'warn' | 'error';
interface Toast { kind: ToastKind; text: string }

function toastClass(kind: ToastKind): string {
  if (kind === 'success') return 'bg-emerald-900/40 text-emerald-300';
  if (kind === 'warn') return 'bg-amber-900/40 text-amber-300';
  return 'bg-rose-900/40 text-rose-300';
}

// ---------------------------------------------------------------------------
// Per-server invite row
// ---------------------------------------------------------------------------

interface ServerRowProps {
  server: Server;
  agent: BackendAgent;
  onSuccess: (serverName: string) => void;
  onError: (msg: string) => void;
}

function ServerRow({ server, agent, onSuccess, onError }: ServerRowProps) {
  const [state, setState] = useState<'idle' | 'paying' | 'inviting'>('idle');
  const { payAndGetTxHash } = useSendOgPayment();

  const priced = isPriced(agent);
  const ctaLabel = priced
    ? `Pay ${agent.priceOg} OG & Invite`
    : 'Invite (free)';

  const handleClick = async () => {
    setState(priced ? 'paying' : 'inviting');

    try {
      let paymentTxHash: string | undefined;

      if (priced) {
        if (!agent.ownerWallet) {
          onError('Agent has no owner wallet — cannot process payment.');
          setState('idle');
          return;
        }

        // Open Privy signing modal.
        try {
          paymentTxHash = await payAndGetTxHash(agent.ownerWallet, agent.priceOg!);
        } catch (sigErr: unknown) {
          const msg = sigErr instanceof Error ? sigErr.message : String(sigErr);
          const isRejection = /rejected|denied|cancel/i.test(msg) ||
            (sigErr as { code?: number })?.code === 4001;
          onError(isRejection ? 'Transaction rejected.' : `Payment failed: ${msg}`);
          setState('idle');
          return;
        }

        setState('inviting');
      }

      // POST invite to backend.
      await bf.inviteAgentToServer(server.id, {
        agentSlug: agent.slug,
        ...(paymentTxHash ? { paymentTxHash } : {}),
      });

      onSuccess(server.name);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.status === 409) {
          onError(`@${agent.slug} is already in ${server.name}.`);
        } else if (e.status === 402) {
          onError(`Payment required to invite @${agent.slug}.`);
        } else if (e.status === 400) {
          const detail = (e as ApiError & { body?: { detail?: string } }).body?.detail;
          onError(detail ? `Payment invalid: ${detail}` : 'Payment verification failed.');
        } else if (e.status === 403) {
          onError(`You are not an admin of ${server.name}.`);
        } else {
          onError(e.message);
        }
      } else {
        onError(e instanceof Error ? e.message : 'Invite failed.');
      }
      setState('idle');
    }
  };

  const busy = state !== 'idle';

  return (
    <div
      className="flex items-center justify-between gap-3 rounded p-3"
      style={{ background: 'var(--bf-tertiary)' }}
    >
      <div className="min-w-0">
        <p className="font-semibold text-[var(--foreground)] text-sm truncate">{server.name}</p>
      </div>
      <button
        onClick={handleClick}
        disabled={busy}
        className="px-3 py-1.5 rounded text-sm font-semibold disabled:opacity-50 flex-shrink-0 transition-opacity hover:opacity-90"
        style={{ background: 'var(--bf-fire)', color: 'var(--bf-white)' }}
      >
        {state === 'paying' ? 'Waiting for payment…' :
          state === 'inviting' ? 'Inviting…' :
          ctaLabel}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface Props {
  agent: BackendAgent;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function InviteAgentToServerModal({ agent, onClose, onSuccess }: Props) {
  const { servers } = useApp();
  const [toast, setToast] = useState<Toast | null>(null);

  const priced = isPriced(agent);

  const handleSuccess = (serverName: string) => {
    setToast({ kind: 'success', text: `${agent.name} added to ${serverName}.` });
    onSuccess?.();
    setTimeout(onClose, 1500);
  };

  const handleError = (msg: string) => {
    setToast({ kind: 'error', text: msg });
  };

  return (
    <Modal title={`Invite ${agent.name}`} onClose={onClose}>
      {/* Pricing header */}
      <div
        className="rounded-lg p-3 mb-4 flex flex-col gap-1"
        style={{ background: 'var(--bf-tertiary)', border: '1px solid var(--bf-quaternary)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[var(--on-ink)] font-semibold text-sm">{agent.name}</span>
          <span className="text-xs px-2 py-0.5 rounded font-semibold" style={{ background: 'var(--bf-accent)', color: 'var(--on-ink)' }}>BOT</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: priced ? '#7a5013' : 'var(--bf-gray)' }}>
            {priced ? `${agent.priceOg} OG` : 'Free'}
          </span>
          {priced && agent.ownerWallet && (
            <span className="text-xs font-mono" style={{ color: 'var(--bf-gray)' }}>
              → {truncateAddress(agent.ownerWallet)}
            </span>
          )}
        </div>
      </div>

      {/* Server list */}
      {servers.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--bf-gray)' }}>
          You don&apos;t have any servers yet.{' '}
          <a href="/workspace" className="underline" style={{ color: 'var(--bf-accent)' }}>
            Create one first
          </a>
          .
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {servers.map((s) => (
            <ServerRow
              key={s.id}
              server={s}
              agent={agent}
              onSuccess={handleSuccess}
              onError={handleError}
            />
          ))}
          <p className="text-xs mt-1" style={{ color: 'var(--bf-gray)' }}>
            Don&apos;t see the server you want?{' '}
            <a href="/workspace" className="underline" style={{ color: 'var(--bf-accent)' }}>
              Go to workspace
            </a>{' '}
            to create one first.
          </p>
        </div>
      )}

      {toast && (
        <div className={`mt-4 text-sm rounded p-2 ${toastClass(toast.kind)}`}>
          {toast.text}
        </div>
      )}
    </Modal>
  );
}
