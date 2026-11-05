'use client';

/**
 * Helpers for moving native OG between the user's Privy embedded wallet and a
 * server's BonFire-managed wallet.
 *
 * Deposits (user → server) are signed client-side via Privy's useSendTransaction
 * because the user's key never leaves the embedded wallet. Withdrawals
 * (server → user) go through the backend, which holds the server's private key.
 */

import { useSendTransaction } from '@privy-io/react-auth';
import { parseEther } from 'viem';
import { OG_TESTNET_CHAIN_ID } from './inft';

export interface FundResult {
  txHash: `0x${string}`;
}

/**
 * Returns a `fund` function that sends `amountOg` OG (decimal string) from the
 * connected Privy wallet to `toAddress`. Throws if the amount cannot be parsed.
 */
export function useFundServerWallet() {
  const { sendTransaction } = useSendTransaction();

  async function fund(opts: {
    toAddress: string;
    /** OG amount as a decimal string, e.g. "4" or "0.5". */
    amountOg: string;
  }): Promise<FundResult> {
    const valueWei = parseEther(opts.amountOg);
    const result = await sendTransaction({
      to: opts.toAddress,
      value: valueWei,
      chainId: OG_TESTNET_CHAIN_ID,
    });
    return { txHash: result.hash };
  }

  return { fund };
}
