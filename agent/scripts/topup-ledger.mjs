import 'dotenv/config';
import { ethers } from 'ethers';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = req('@0glabs/0g-serving-broker');

const pk = process.env.DEPLOYER_PRIVATE_KEY;
const rpc = process.env.OG_RPC_URL || 'https://evmrpc-testnet.0g.ai';
if (!pk) { console.error('DEPLOYER_PRIVATE_KEY missing'); process.exit(1); }

const amount = Number(process.argv[2] ?? 2);  // OG, default 2
console.log(`Depositing ${amount} OG into ledger sub-account...`);

const provider = new ethers.JsonRpcProvider(rpc);
const wallet = new ethers.Wallet(pk, provider);
console.log('Wallet:', wallet.address);

const broker = await createZGComputeNetworkBroker(wallet);

try {
  const before = await broker.ledger.getLedger();
  console.log('Ledger before:', { totalBalance: before.totalBalance?.toString?.(), available: before.availableBalance?.toString?.() });
} catch (e) { console.log('No ledger yet:', e.message); }

await broker.ledger.depositFund(amount);
console.log('Deposit submitted.');

const after = await broker.ledger.getLedger();
console.log('Ledger after:', { totalBalance: after.totalBalance?.toString?.(), available: after.availableBalance?.toString?.() });
process.exit(0);
