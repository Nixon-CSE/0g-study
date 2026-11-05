'use client';
import { useState } from 'react';
import Modal from '@/components/shared/Modal';
import type { BackendServerWallet, BackendServerFunding } from '@/lib/types';

interface Props {
  wallet: BackendServerWallet;
  funding: BackendServerFunding;
  serverName: string;
  onClose: () => void;
}

/**
 * Modal shown immediately after server creation.
 * Displays the auto-generated 0G wallet address, copy button, faucet link,
 * and chain info so the user can fund the server's inference wallet.
 *
 * The private key is intentionally hidden behind a collapsed <details> element
 * and must NEVER be copied or logged automatically.
 */
export default function WalletFundingModal({ wallet, funding, serverName, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal onClose={onClose} title={`Fund ${serverName}`}>
      <div className="space-y-4">
        <p className="text-sm" style={{ color: 'var(--bf-gray)' }}>
          Your server has its own 0G wallet. Fund it to pay for agent inference.
        </p>

        <div>
          <p
            className="text-xs uppercase tracking-wider font-semibold mb-1"
            style={{ color: 'var(--bf-symbol)' }}
          >
            Wallet Address
          </p>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 text-xs font-mono rounded px-2 py-2 break-all"
              style={{ background: 'var(--bf-tertiary)', color: 'var(--bf-white)' }}
            >
              {wallet.address}
            </code>
            <button
              onClick={handleCopy}
              className="px-3 py-2 rounded text-xs font-semibold flex-shrink-0"
              style={{ background: 'var(--bf-quinary)', color: 'var(--bf-white)' }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Network">{wallet.network}</Field>
          <Field label="Token">{funding.tokenSymbol}</Field>
          {funding.chainId !== undefined && (
            <Field label="Chain ID">{funding.chainId}</Field>
          )}
          {funding.minRecommendedBalance && (
            <Field label="Recommended balance">
              {funding.minRecommendedBalance} {funding.tokenSymbol}
            </Field>
          )}
        </div>

        <div className="rounded p-3 text-sm" style={{ background: 'var(--bf-tertiary)' }}>
          <p className="text-[var(--foreground)] mb-2 font-semibold">Steps</p>
          <ol className="list-decimal list-inside space-y-1" style={{ color: 'var(--bf-gray)' }}>
            <li>
              Open the{' '}
              <a
                href={funding.faucetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: 'var(--bf-accent)' }}
              >
                0G testnet faucet
              </a>
              .
            </li>
            <li>Paste the wallet address above.</li>
            <li>
              Request {funding.minRecommendedBalance ?? '1'} {funding.tokenSymbol} (or more).
            </li>
            <li>
              Come back and start chatting — your server&apos;s agents will run on these funds.
            </li>
          </ol>
        </div>

        {wallet.privateKey && (
          <details className="text-xs">
            <summary className="cursor-pointer" style={{ color: 'var(--bf-symbol)' }}>
              Show private key (advanced)
            </summary>
            <code
              className="block mt-2 break-all font-mono rounded p-2"
              style={{ background: 'var(--bf-tertiary)', color: 'var(--bf-gray)' }}
            >
              {wallet.privateKey}
            </code>
            <p className="mt-1" style={{ color: 'var(--bf-symbol)' }}>
              This is stored on the backend; you don&apos;t need to save it manually. Only inspect for debugging.
            </p>
          </details>
        )}

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm font-semibold"
            style={{ background: 'var(--bf-fire)', color: 'var(--bf-white)' }}
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p
        className="text-xs uppercase tracking-wider font-semibold mb-1"
        style={{ color: 'var(--bf-symbol)' }}
      >
        {label}
      </p>
      <p className="text-[var(--foreground)]">{children}</p>
    </div>
  );
}
