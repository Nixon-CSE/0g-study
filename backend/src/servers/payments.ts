/**
 * Payment verification for paid agent invites.
 *
 * `verifyAgentInvitePayment` reads the transaction from the 0G testnet RPC,
 * asserts that:
 *  - the tx came from the authenticated user's wallet (`expectedFrom`) — without
 *    this guard, any historical transfer to the owner wallet for the right
 *    amount could be replayed as proof-of-payment
 *  - the tx went to the correct `toAddress` (agent owner wallet)
 *  - the tx value matches `expectedOgAmount` (in OG, parsed as ether)
 *  - the tx receipt `status === 1` (mined and successful)
 *  - at least `minConfirmations` blocks have been built on top of the tx —
 *    cheap reorg protection on testnet
 *
 * The duplicate-tx guard (ensuring the same txHash can't be used twice) is
 * enforced by a UNIQUE INDEX on `serverMembers.paidTxHash` plus an
 * E11000-to-409 mapping in the route, not by a TOCTOU pre-check.
 */

import { JsonRpcProvider, parseEther } from 'ethers';
import { log } from '../util/logger.js';

const DEFAULT_MIN_CONFIRMATIONS = 2;

export interface VerifyPaymentInput {
  txHash: string;
  /**
   * Wallet address the authenticated user paid FROM. Defending against
   * third-party-payment replay — any historical tx to `toAddress` for the
   * right amount would otherwise pass.
   */
  expectedFrom: string;
  /** Wallet address the payment was expected to go to (agent ownerWallet). */
  toAddress: string;
  /** Amount in OG, as a decimal string (e.g. "0.5", "1", "1.25"). */
  expectedOgAmount: string;
  /** Minimum confirmations required. Defaults to 2 for testnet. */
  minConfirmations?: number;
}

export interface VerifyPaymentResult {
  ok: true;
  from: string;
}

export class PaymentVerificationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PaymentVerificationError';
  }
}

export async function verifyAgentInvitePayment(
  input: VerifyPaymentInput,
): Promise<VerifyPaymentResult> {
  const rpcUrl = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai';
  const provider = new JsonRpcProvider(rpcUrl);
  const minConfirmations = input.minConfirmations ?? DEFAULT_MIN_CONFIRMATIONS;

  log.debug(
    { txHash: input.txHash, from: input.expectedFrom, to: input.toAddress, amount: input.expectedOgAmount, minConfirmations },
    'verifying agent invite payment',
  );

  // Fetch the raw transaction (for value, to, from fields).
  const tx = await provider.getTransaction(input.txHash);
  if (!tx) {
    throw new PaymentVerificationError('tx_not_found', `Transaction ${input.txHash} not found on chain`);
  }

  // Verify the sender — must be the authenticated user. Without this any
  // historical transfer from anyone to the owner wallet could be reused as
  // proof-of-payment.
  if (!tx.from || tx.from.toLowerCase() !== input.expectedFrom.toLowerCase()) {
    throw new PaymentVerificationError(
      'wrong_sender',
      `Transaction sender ${tx.from ?? 'null'} does not match expected ${input.expectedFrom}`,
    );
  }

  // Verify the recipient matches.
  if (!tx.to || tx.to.toLowerCase() !== input.toAddress.toLowerCase()) {
    throw new PaymentVerificationError(
      'wrong_recipient',
      `Transaction recipient ${tx.to ?? 'null'} does not match expected ${input.toAddress}`,
    );
  }

  // Verify the value matches (parse expectedOgAmount as ether → wei bigint).
  const expectedWei = parseEther(input.expectedOgAmount);
  if (tx.value !== expectedWei) {
    throw new PaymentVerificationError(
      'wrong_amount',
      `Transaction value ${tx.value.toString()} wei does not match expected ${expectedWei.toString()} wei (${input.expectedOgAmount} OG)`,
    );
  }

  // Fetch the receipt to confirm the tx was mined successfully.
  const receipt = await provider.getTransactionReceipt(input.txHash);
  if (!receipt) {
    throw new PaymentVerificationError('receipt_not_found', `Receipt for ${input.txHash} not found — transaction may not be mined yet`);
  }
  if (receipt.status !== 1) {
    throw new PaymentVerificationError('tx_reverted', `Transaction ${input.txHash} was reverted (status=${receipt.status})`);
  }

  // Reorg protection: require at least `minConfirmations` confirmations.
  // 0G testnet has fast blocks; 2 is a cheap safety margin. The frontend
  // surfaces this as a "wait a moment and retry" rather than a hard failure.
  if (minConfirmations > 0) {
    const head = await provider.getBlockNumber();
    const confirmations = head - receipt.blockNumber + 1;
    if (confirmations < minConfirmations) {
      throw new PaymentVerificationError(
        'insufficient_confirmations',
        `Transaction has ${confirmations} confirmation(s); need ${minConfirmations}`,
      );
    }
  }

  return { ok: true, from: tx.from };
}
