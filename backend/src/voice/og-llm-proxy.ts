/**
 * 0G Compute → OpenAI-compatible proxy.
 *
 * The Python Pipecat bot uses `OpenAILLMService` and needs an
 * OpenAI-shaped chat-completions endpoint. The 0G Compute broker SDK is
 * Node-only — so this proxy:
 *   1. Reads the wallet private key from the request's
 *      `Authorization: Bearer <hexPrivateKey>` header (Pipecat sends whatever
 *      we put in `OG_LLM_API_KEY`). One broker is initialised per wallet and
 *      cached. Falls back to `STORAGE_UPLOADER_PRIVATE_KEY` /
 *      `DEPLOYER_PRIVATE_KEY` when no bearer is supplied (back-compat with
 *      curl/health-check usage).
 *   2. Picks a chat-capable service (honouring `OG_BROKER_PROVIDER` if set).
 *   3. Forwards every POST /chat/completions request to that service's
 *      `<endpoint>/v1/proxy/chat/completions`, injecting per-request signed
 *      headers from `broker.inference.getRequestHeaders()`.
 *   4. Streams the response back unchanged (SSE-compatible for Pipecat).
 *
 * Result: each voice session pays out of its OWN server wallet, the same way
 * text chat already does via the agent runtime's env-override flow.
 *
 * Mirrors the working pattern in `agent/src/runtime/llm-client.ts`.
 */

import type { Context, Hono } from 'hono';
import { ethers } from 'ethers';
import { log } from '../util/logger.js';

interface PickedService {
  provider: string;
  url: string;
  model: string;
}

interface OgLlmProxyState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  broker: any;
  picked: PickedService;
  address: string;
}

// Cache of (walletAddress → init Promise). Concurrent first-requests share
// the in-flight init instead of triggering N broker bootstraps.
const brokerCache = new Map<string, Promise<OgLlmProxyState | null>>();
const failReasons = new Map<string, string>();

async function loadBroker(): Promise<{ createZGComputeNetworkBroker: (wallet: ethers.Wallet) => Promise<unknown> }> {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  return req('@0glabs/0g-serving-broker');
}

/**
 * Initialise a 0G broker for one specific wallet — ensure ledger, pick a
 * service. Idempotent and cached by wallet address.
 *
 * Auto top-up: the 0G SDK requires ≥ 3 OG to *create* a ledger. If the
 * caller's wallet is below that threshold, the platform wallet
 * (DEPLOYER_PRIVATE_KEY) sends it just enough to bootstrap. Subsequent
 * inference still bills the caller's wallet (ledger ownership doesn't
 * change). One-time cold-start cost per server, then self-sufficient.
 */
async function initBrokerForWallet(privateKey: string): Promise<OgLlmProxyState | null> {
  const rpcUrl = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai';
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  let wallet: ethers.Wallet;
  try {
    wallet = new ethers.Wallet(privateKey, provider);
  } catch (e) {
    failReasons.set('invalid-key', (e as Error).message?.slice(0, 120) ?? 'invalid private key');
    return null;
  }
  const address = wallet.address;
  log.info({ address }, '0G LLM proxy: initialising broker');

  const { createZGComputeNetworkBroker } = await loadBroker();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const broker: any = await createZGComputeNetworkBroker(wallet as any);

  // Ensure ledger exists. If absent, auto top-up from platform wallet to
  // meet the 3 OG SDK minimum, then create.
  try { await broker.ledger.getLedger(); }
  catch {
    const reserve = 0.2;          // OG kept for gas
    const ledgerSeed = 3.0;       // SDK floor
    const balanceWei = await provider.getBalance(address);
    let balanceOg = Number(ethers.formatEther(balanceWei));

    if (balanceOg < ledgerSeed + reserve) {
      const topupPk = process.env.DEPLOYER_PRIVATE_KEY || process.env.STORAGE_UPLOADER_PRIVATE_KEY;
      if (!topupPk) {
        const reason = `${address} has ${balanceOg.toFixed(4)} OG; no DEPLOYER_PRIVATE_KEY for auto top-up`;
        failReasons.set(address, reason);
        log.error({ wallet: address, balanceOg }, '0G LLM proxy: top-up wallet unavailable');
        return null;
      }
      const platformWallet = new ethers.Wallet(topupPk, provider);
      // Avoid self-topup (would loop if the env wallet is the same as the caller)
      if (platformWallet.address.toLowerCase() === address.toLowerCase()) {
        const reason = `${address} has ${balanceOg.toFixed(4)} OG; cannot self-topup (it IS the platform wallet)`;
        failReasons.set(address, reason);
        log.error({ wallet: address, balanceOg }, '0G LLM proxy: caller is the platform wallet, refuse self-topup');
        return null;
      }
      const need = ledgerSeed + reserve - balanceOg + 0.05; // small headroom
      const needWei = ethers.parseEther(need.toFixed(6));
      log.warn(
        { server: address, fundedBy: platformWallet.address, amountOg: need.toFixed(4) },
        '0G LLM proxy: auto top-up — server wallet below ledger floor',
      );
      try {
        const tx = await platformWallet.sendTransaction({ to: address, value: needWei });
        await tx.wait();
        // Refresh balance.
        const newWei = await provider.getBalance(address);
        balanceOg = Number(ethers.formatEther(newWei));
        log.info({ server: address, balanceOg: balanceOg.toFixed(4), txHash: tx.hash }, '0G LLM proxy: top-up confirmed');
      } catch (e) {
        const reason = `auto top-up failed: ${(e as Error).message?.slice(0, 180) ?? String(e)}`;
        failReasons.set(address, reason);
        log.error({ wallet: address, err: e }, '0G LLM proxy: top-up tx failed');
        return null;
      }
    }

    const amount = Math.max(balanceOg - reserve, ledgerSeed);
    log.info({ wallet: address, amount }, '0G LLM proxy: creating ledger');
    await broker.ledger.addLedger(amount);
  }

  // Pick a chat-capable service.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const services: any[] = await broker.inference.listService();
  const chat = services.filter((s) => s.serviceType === 'chatbot' || s.serviceType === 'chat');
  if (!chat.length) {
    failReasons.set(address, '0G Compute: no chat services available');
    return null;
  }

  const preferred = (process.env.OG_BROKER_PROVIDER ?? '').toLowerCase();
  const ordered = preferred
    ? [
        ...chat.filter((s) => (s.provider ?? '').toLowerCase() === preferred),
        ...chat.filter((s) => (s.provider ?? '').toLowerCase() !== preferred),
      ]
    : chat;

  let picked: PickedService | null = null;
  for (const svc of ordered) {
    try {
      try { await broker.inference.getAccount(svc.provider); }
      catch {
        try {
          await broker.ledger.transferFund(svc.provider, 'inference', ethers.parseEther('1'));
        } catch (e) {
          log.warn({ wallet: address, provider: svc.provider, err: (e as Error).message?.slice(0, 200) }, '0G LLM proxy: transferFund failed, skipping');
          continue;
        }
      }
      await broker.inference.acknowledgeProviderSigner(svc.provider);
      picked = { provider: svc.provider, url: svc.url, model: svc.model };
      break;
    } catch (e) {
      log.debug({ wallet: address, provider: svc.provider, err: (e as Error).message?.slice(0, 120) }, '0G LLM proxy: provider unreachable');
    }
  }
  if (!picked) {
    failReasons.set(address, '0G Compute: no reachable provider');
    return null;
  }

  log.info({ wallet: address, provider: picked.provider, model: picked.model, endpoint: picked.url }, '0G LLM proxy: ready');
  failReasons.delete(address);
  return { broker, picked, address };
}

/**
 * Get a cached broker state for the given key, kicking off init if needed.
 * Caching is keyed by wallet address (multiple keys for the same wallet share state).
 */
function getStateForKey(privateKey: string | null): Promise<OgLlmProxyState | null> {
  if (!privateKey) {
    failReasons.set('no-key', 'no private key in request and no env fallback');
    return Promise.resolve(null);
  }
  let address: string;
  try {
    address = new ethers.Wallet(privateKey).address;
  } catch {
    return Promise.resolve(null);
  }
  const existing = brokerCache.get(address);
  if (existing) return existing;
  const p = initBrokerForWallet(privateKey).catch((e) => {
    failReasons.set(address, (e as Error).message?.slice(0, 200) ?? 'unknown error');
    log.error({ wallet: address, err: e }, '0G LLM proxy: init failed');
    // Drop the failed entry so a later retry can re-attempt
    brokerCache.delete(address);
    return null;
  });
  brokerCache.set(address, p);
  return p;
}

/**
 * Pull the private key from `Authorization: Bearer <key>`. Pipecat's OpenAI
 * client sends the value of `OG_LLM_API_KEY` here. Falls back to the env
 * platform wallet so old curl smoke tests and the GET /model probe still work.
 */
function privateKeyFromRequest(c: Context): string | null {
  const auth = c.req.header('authorization') ?? c.req.header('Authorization');
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m && m[1]) {
      const candidate = m[1].trim();
      // Heuristic: a 0G wallet private key is 0x + 64 hex chars. Anything
      // else (placeholder strings, "unused", etc.) gets ignored so we fall
      // back to the env wallet.
      if (/^0x[a-fA-F0-9]{64}$/.test(candidate)) return candidate;
    }
  }
  // Fallback for tests + the /model probe.
  return process.env.STORAGE_UPLOADER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || null;
}

/**
 * Register the proxy on the given Hono app. Mounts at `/internal/og-llm`.
 *
 * Endpoints:
 *   GET  /internal/og-llm/model          → { model, provider, endpoint, wallet }
 *                                          (uses env wallet — for sanity checks)
 *   POST /internal/og-llm/chat/completions → forwards to 0G, OpenAI-shaped.
 *                                          Wallet derived from Authorization header.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerOgLlmProxy(app: Hono<any>): void {
  app.get('/internal/og-llm/model', async (c: Context) => {
    const pk = privateKeyFromRequest(c);
    const state = await getStateForKey(pk);
    if (!state) {
      return c.json({
        error: 'og_llm_unavailable',
        detail: lastFailReason(),
      }, 503);
    }
    return c.json({
      model: state.picked.model,
      provider: state.picked.provider,
      endpoint: state.picked.url,
      wallet: state.address,
    });
  });

  app.post('/internal/og-llm/chat/completions', async (c: Context) => {
    const pk = privateKeyFromRequest(c);
    const state = await getStateForKey(pk);
    if (!state) {
      return c.json({
        error: 'og_llm_unavailable',
        detail: lastFailReason(),
      }, 503);
    }

    const body = pinModel(await c.req.text(), state.picked.model);
    const headers: Record<string, string> = {};
    try {
      const signed = await state.broker.inference.getRequestHeaders(state.picked.provider);
      for (const [k, v] of Object.entries(signed ?? {})) {
        if (typeof v === 'string') headers[k] = v;
      }
    } catch (e) {
      return c.json({ error: 'og_llm_sign_failed', detail: (e as Error).message?.slice(0, 200) }, 502);
    }

    const upstream = `${state.picked.url}/v1/proxy/chat/completions`;
    let res: Response;
    try {
      res = await fetch(upstream, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
      });
    } catch (e) {
      return c.json({ error: 'og_llm_network', detail: (e as Error).message?.slice(0, 200) }, 502);
    }

    // Forward response (streaming-safe — Pipecat reads SSE chunks).
    const respHeaders = new Headers();
    res.headers.forEach((v, k) => respHeaders.set(k, v));
    return new Response(res.body, { status: res.status, headers: respHeaders });
  });
}

/**
 * The picked 0G Compute provider serves exactly one model. Whatever model name the caller sent
 * (Pipecat defaults to an OpenAI name), ask for the one this provider actually serves.
 * Non-JSON bodies pass through untouched.
 */
export function pinModel(body: string, model: string): string {
  try {
    const j = JSON.parse(body);
    if (j && typeof j === 'object' && !Array.isArray(j)) return JSON.stringify({ ...j, model });
  } catch { /* not JSON */ }
  return body;
}

function lastFailReason(): string {
  // Pull the most recent reason from any wallet (this is best-effort
  // diagnostic surfacing, not authoritative).
  const reasons = Array.from(failReasons.values());
  return reasons[reasons.length - 1] ?? 'unknown';
}
