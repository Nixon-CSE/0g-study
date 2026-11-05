/**
 * Chain event indexer for BonFireAgentINFT.
 *
 * Subscribes to contract events on 0G Chain and keeps the Mongo `AgentDoc`
 * cache in sync. Acts as the safety net for the mint flow: if the browser
 * closes after the on-chain tx but before `/mint/confirm` is called, this
 * indexer picks up `AgentMinted` and writes the AgentDoc.
 *
 * Strategy:
 *   1. Attempt a WebSocket subscription (WSS). Many 0G testnet RPCs do not
 *      expose WSS reliably, so any constructor/connect error falls through.
 *   2. Poll `eth_getLogs` every 10 s as the production-safe fallback.
 *
 * The cursor block advances on every successful poll so no events are
 * processed twice during a single process lifetime. On restart the caller
 * passes `startBlock` to replay from a known safe point.
 */

import { ethers } from 'ethers';
import type { Db } from 'mongodb';
import { InftChain } from './inft.js';
import { collections, type AgentDoc, type MintReservationDoc } from '../db/types.js';
import { log } from '../util/logger.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface IndexerDeps {
  db: Db;
  inft: InftChain;
  contractAddress: string;
  rpcUrl: string;
  /** Optional bootstrap block; defaults to current block at start time. */
  startBlock?: number;
}

// ---------------------------------------------------------------------------
// ChainIndexer
// ---------------------------------------------------------------------------

export class ChainIndexer {
  private wsProvider?: ethers.WebSocketProvider;
  private readonly httpProvider: ethers.JsonRpcProvider;
  private contract!: ethers.Contract;
  private running = false;
  private cursorBlock = 0;
  private pollTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly deps: IndexerDeps) {
    this.httpProvider = new ethers.JsonRpcProvider(deps.rpcUrl);
  }

  /**
   * Start the indexer.
   *
   * Attempts WSS subscription first; falls back to HTTP polling if WSS is
   * unavailable or throws during setup.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.cursorBlock =
      this.deps.startBlock ?? (await this.httpProvider.getBlockNumber());

    // 0G testnet does not expose WSS reliably; skip WSS entirely and use polling.
    // The polling path is the production path and covers all event types.
    log.info({ rpcUrl: this.deps.rpcUrl }, 'chain indexer: starting in polling mode (10s interval)');
    this.startPolling();
  }

  /**
   * Stop the indexer and release all resources.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.wsProvider) {
      try {
        await this.wsProvider.destroy();
      } catch {
        // Ignore destroy errors — we are shutting down.
      }
    }
  }

  // -------------------------------------------------------------------------
  // WebSocket path
  // -------------------------------------------------------------------------

  private attachListeners(): void {
    this.contract.on(
      'AgentMinted',
      (tokenId: bigint, owner: string, mode: number, bundleHash: string) => {
        this.handleAgentMinted(tokenId, owner, mode, bundleHash).catch(err =>
          log.error({ err }, 'AgentMinted handler failed'),
        );
      },
    );

    this.contract.on('ModeChanged', (tokenId: bigint, _oldMode: number, newMode: number) => {
      this.handleModeChanged(tokenId, newMode).catch(err =>
        log.error({ err }, 'ModeChanged handler failed'),
      );
    });

    this.contract.on('UsageAuthorized', (tokenId: bigint, executor: string) => {
      this.handleAuthChange(tokenId, executor).catch(err =>
        log.error({ err }, 'UsageAuthorized handler failed'),
      );
    });

    this.contract.on('UsageRevoked', (tokenId: bigint, executor: string) => {
      this.handleAuthChange(tokenId, executor).catch(err =>
        log.error({ err }, 'UsageRevoked handler failed'),
      );
    });
  }

  // -------------------------------------------------------------------------
  // Poll path
  // -------------------------------------------------------------------------

  private startPolling(): void {
    const tick = async (): Promise<void> => {
      if (!this.running) return;

      try {
        const latest = await this.httpProvider.getBlockNumber();
        if (latest > this.cursorBlock) {
          const c = this.deps.inft.readContract();
          const filter = {
            address: this.deps.contractAddress,
            fromBlock: this.cursorBlock + 1,
            toBlock: latest,
          };
          const rawLogs = await this.httpProvider.getLogs(filter);
          for (const rawLog of rawLogs) {
            let parsed: ethers.LogDescription | null = null;
            try {
              parsed = c.interface.parseLog({
                topics: rawLog.topics as string[],
                data: rawLog.data,
              });
            } catch {
              // Unrecognised event — skip silently.
              continue;
            }
            if (!parsed) continue;
            await this.dispatchEvent(parsed.name, parsed.args);
          }
          this.cursorBlock = latest;
        }
      } catch (e: unknown) {
        log.warn(
          { err: (e as Error)?.message },
          'chain indexer: poll cycle failed',
        );
      }

      // Schedule next tick only while still running.
      if (this.running) {
        this.pollTimer = setTimeout(tick, 10_000);
      }
    };

    // Kick off the first tick immediately.
    tick();
  }

  // -------------------------------------------------------------------------
  // Event dispatch (used by poll path)
  // -------------------------------------------------------------------------

  private async dispatchEvent(name: string, args: ethers.Result): Promise<void> {
    switch (name) {
      case 'AgentMinted':
        return this.handleAgentMinted(
          BigInt(args[0]),
          String(args[1]),
          Number(args[2]),
          String(args[3]),
        );
      case 'ModeChanged':
        // args[1] is oldMode — not needed here.
        return this.handleModeChanged(BigInt(args[0]), Number(args[2]));
      case 'UsageAuthorized':
      case 'UsageRevoked':
        return this.handleAuthChange(BigInt(args[0]), String(args[1]));
      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  /**
   * Handle `AgentMinted(tokenId, owner, mode, bundleHash)`.
   *
   * If `/mint/confirm` already ran and inserted the AgentDoc, this is a no-op.
   * Otherwise we look up the matching MintReservationDoc by bundleHash and
   * create the AgentDoc from reservation metadata + on-chain record.
   */
  private async handleAgentMinted(
    tokenId: bigint,
    owner: string,
    _mode: number,
    bundleHash: string,
  ): Promise<void> {
    const tokenStr = tokenId.toString();

    // Idempotency guard — /mint/confirm may have already written this row.
    const existing = await this.deps.db
      .collection<AgentDoc>(collections.agents)
      .findOne({ tokenId: tokenStr });
    if (existing) {
      log.debug({ tokenStr }, 'chain indexer: AgentDoc already exists — skipping');
      return;
    }

    // Find the MintReservationDoc matching this bundleHash.
    const reservation = await this.deps.db
      .collection<MintReservationDoc>(collections.mintReservations)
      .findOne({ bundleHash });

    if (!reservation) {
      log.warn(
        { tokenStr, bundleHash },
        'chain indexer: AgentMinted with no matching reservation — skipping',
      );
      return;
    }

    const res = reservation as MintReservationDoc & {
      manifest?: {
        name?: string;
        description?: string;
        avatarUrl?: string | null;
        tags?: string[];
      };
      /** Off-chain price chosen at mint time; persisted on the reservation. */
      priceOg?: string;
    };

    const insertion: Partial<AgentDoc> = {
      slug: reservation.slug,
      name: res.manifest?.name ?? reservation.slug,
      description: res.manifest?.description ?? '',
      avatarUrl: res.manifest?.avatarUrl ?? null,
      tags: res.manifest?.tags ?? [],
      tokenId: tokenStr,
      contractAddress: this.deps.contractAddress,
      ownerWallet: owner,
      manifestUri: reservation.manifestUri,
      bundleUri: reservation.bundleUri,
      sealedDEKBaseUri: reservation.sealedDEKBaseUri,
      bundleHash,
      baseUrl: process.env.EMBER_AGENT_BASE_URL ?? 'http://localhost:7777',
      visibility: 'public',
      bio: null,
      agentKeyHash: null,
      createdBy: reservation.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      // Pull the creator-chosen price from the reservation so it survives the
      // /confirm vs. indexer race. Falls back to "0" (free) if unset.
      priceOg: res.priceOg ?? '0',
    };

    await this.deps.db
      .collection<AgentDoc>(collections.agents)
      .insertOne(insertion as AgentDoc);

    await this.deps.db
      .collection(collections.mintReservations)
      .updateOne({ _id: reservation._id }, { $set: { status: 'minted' } });

    log.info(
      { tokenStr, slug: reservation.slug },
      'chain indexer: AgentDoc reconciled from AgentMinted event',
    );
  }

  /**
   * Handle `ModeChanged(tokenId, oldMode, newMode)`.
   *
   * Mode is ignored at the application layer — invocation does not gate on-chain mode.
   */
  private async handleModeChanged(tokenId: bigint, newMode: number): Promise<void> {
    log.info({ tokenStr: tokenId.toString(), newMode }, 'chain indexer: ModeChanged (ignored)');
  }

  /**
   * Handle `UsageAuthorized` / `UsageRevoked`.
   *
   * Logged for operators; invocation does not consult on-chain authorization.
   */
  private async handleAuthChange(tokenId: bigint, executor: string): Promise<void> {
    log.info(
      { tokenId: tokenId.toString(), executor },
      'chain indexer: UsageAuthorized/Revoked (informational)',
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ChainIndexer from explicit deps.
 *
 * @param deps - Indexer dependencies (db, inft, contractAddress, rpcUrl, startBlock?)
 */
export function createChainIndexer(deps: IndexerDeps): ChainIndexer {
  return new ChainIndexer(deps);
}
