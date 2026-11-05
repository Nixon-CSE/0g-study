import { ethers } from 'ethers';
import type { ServerWalletDoc } from '../db/types.js';

export function createServerWallet(): ServerWalletDoc {
  const w = ethers.Wallet.createRandom();
  return {
    address: w.address,
    privateKey: w.privateKey,
    network: 'og-testnet',
    createdAt: new Date(),
  };
}

/**
 * Query the wallet's native OG balance via the RPC.
 * Returns the balance as a string of OG (decimal), not wei.
 * Throws if the RPC is unreachable.
 */
export async function fetchOnchainBalance(rpcUrl: string, address: string): Promise<string> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wei = await provider.getBalance(address);
  return ethers.formatEther(wei);
}

/** Reserve kept on the server wallet so a future ledger top-up still has gas. */
const WITHDRAW_GAS_RESERVE_OG = 0.05;

export interface WithdrawResult {
  txHash: string;
  /** Balance after the withdrawal, in OG (decimal string). */
  balance: string;
}

/**
 * Send native OG from the server wallet back to a user-supplied address.
 *
 * Validates address shape and that the requested amount leaves enough native
 * balance for the gas to cover the transaction itself (estimated, not just
 * reserved). Throws on insufficient funds rather than letting ethers surface
 * an opaque RPC error.
 */
export async function withdrawFromServerWallet(args: {
  rpcUrl: string;
  privateKey: string;
  toAddress: string;
  amountOg: string;
}): Promise<WithdrawResult> {
  if (!ethers.isAddress(args.toAddress)) {
    throw Object.assign(new Error('invalid_to_address'), { code: 'invalid_to_address' });
  }
  let amountWei: bigint;
  try {
    amountWei = ethers.parseEther(args.amountOg);
  } catch {
    throw Object.assign(new Error('invalid_amount'), { code: 'invalid_amount' });
  }
  if (amountWei <= 0n) {
    throw Object.assign(new Error('invalid_amount'), { code: 'invalid_amount' });
  }

  const provider = new ethers.JsonRpcProvider(args.rpcUrl);
  const wallet = new ethers.Wallet(args.privateKey, provider);
  const balanceWei = await provider.getBalance(wallet.address);

  const reserveWei = ethers.parseEther(String(WITHDRAW_GAS_RESERVE_OG));
  if (balanceWei < amountWei + reserveWei) {
    throw Object.assign(
      new Error(`insufficient_balance: have ${ethers.formatEther(balanceWei)} OG, need ${args.amountOg} + ~${WITHDRAW_GAS_RESERVE_OG} gas`),
      { code: 'insufficient_balance' },
    );
  }

  const tx = await wallet.sendTransaction({ to: args.toAddress, value: amountWei });
  await tx.wait();
  const after = await provider.getBalance(wallet.address);
  return { txHash: tx.hash, balance: ethers.formatEther(after) };
}
