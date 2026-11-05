#!/usr/bin/env node
/**
 * Send native OG (Galileo testnet) from a funded dev key to a recipient address.
 *
 * Private key precedence (first set wins):
 *   FUND_SENDER_PRIVATE_KEY → SEED_OWNER_PRIVATE_KEY → PLATFORM_EXECUTOR_PRIVATE_KEY
 *
 * Usage (from backend/):
 *   node scripts/send-og-native.mjs <0xRecipient> [amountOg]
 *
 * Loads backend/.env via dotenv (same directory as cwd when run from backend/).
 */

import 'dotenv/config';
import { ethers } from 'ethers';

const [, , recipientRaw, amountRaw = '10'] = process.argv;

if (!recipientRaw || !/^0x[0-9a-fA-F]{40}$/.test(recipientRaw)) {
  console.error('Usage: node scripts/send-og-native.mjs <0xRecipient> [amountOg]');
  process.exit(1);
}

/** @param {string} pk */
function normalizePk(pk) {
  const t = pk.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(t)) return t;
  if (/^[0-9a-fA-F]{64}$/.test(t)) return `0x${t}`;
  return null;
}

const rpcUrl = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai';
const pkRaw =
  process.env.FUND_SENDER_PRIVATE_KEY ??
  process.env.SEED_OWNER_PRIVATE_KEY ??
  process.env.PLATFORM_EXECUTOR_PRIVATE_KEY;

const pk = pkRaw ? normalizePk(pkRaw) : null;

if (!pk) {
  console.error(
    'Missing sender key. Set one of FUND_SENDER_PRIVATE_KEY, SEED_OWNER_PRIVATE_KEY, or PLATFORM_EXECUTOR_PRIVATE_KEY in backend/.env',
  );
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(pk, provider);
const valueRequested = ethers.parseEther(String(amountRaw));

const fromBal = await provider.getBalance(wallet.address);
const feeData = await provider.getFeeData();
const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 1_500_000_000n;
const gasLimitSimple = 21_000n;
/** Headroom above naive gas*gasPrice — EIP-1559 fields vary by chain RPC. */
const feeReserve = gasLimitSimple * gasPrice * (12n / 10n) + ethers.parseEther('0.0003');
let value = valueRequested;
if (fromBal <= feeReserve) {
  console.error('Sender balance covers gas only.');
  process.exit(1);
}
if (fromBal < valueRequested + feeReserve) {
  value = fromBal - feeReserve;
  console.log(
    JSON.stringify({
      note: `Requested ${ethers.formatEther(valueRequested)} OG but sender lacks balance for amount + gas; sending ${ethers.formatEther(value)} OG.`,
    }),
  );
}

console.log(JSON.stringify({
  rpcUrl,
  from: wallet.address,
  fromBalanceOg: ethers.formatEther(fromBal),
  to: recipientRaw,
  amountOg: ethers.formatEther(value),
}));

if (value <= 0n) {
  console.error('Nothing to send after gas reserve.');
  process.exit(1);
}

const tx = await wallet.sendTransaction({
  to: recipientRaw,
  value,
  gasLimit: gasLimitSimple,
});

console.log(JSON.stringify({ txHash: tx.hash, status: 'submitted' }));
const receipt = await tx.wait();
console.log(JSON.stringify({ txHash: receipt.hash, status: receipt.status === 1 ? 'success' : 'failed', blockNumber: receipt.blockNumber }));
