/**
 * Chain client for BonFireAgentINFT (ERC-721 + ERC-7857-style extensions).
 *
 * Two surfaces:
 *   - readContract()   — returns a read-only Contract bound to the injected provider
 *   - writerContract() — returns a signer-bound Contract for write calls
 *
 * ABI is sourced from contracts/abi/BonFireAgentINFT.json.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — ABI file may not exist in all environments
import inftAbi from '../../../contracts/abi/BonFireAgentINFT.json' assert { type: 'json' };
import { ethers } from 'ethers';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface AgentRecord {
  owner: string;
  bundleHash: string;          // 0x-prefixed hex
  manifestUri: string;
  bundleUri: string;
  sealedDEKBaseUri: string;
  mode: 0 | 1;                 // 0 = public, 1 = permissioned
  createdAt: bigint;
}

export interface MintTxResult {
  tokenId: bigint;
  owner: string;
  mode: number;
  bundleHash: string;          // 0x-prefixed hex
}

// Prefer inftAbi.abi when the JSON has a top-level `abi` field (Hardhat artifact),
// fall back to the JSON itself for bare ABI arrays.
const INFT_ABI = ((inftAbi as Record<string, unknown>).abi ?? inftAbi) as ethers.InterfaceAbi;

// ---------------------------------------------------------------------------
// InftChain class
// ---------------------------------------------------------------------------

export class InftChain {
  constructor(
    private readonly provider: ethers.JsonRpcProvider,
    private readonly contractAddress: string,
  ) {}

  /** Returns a read-only Contract instance bound to the injected provider. */
  readContract(): ethers.Contract {
    return new ethers.Contract(this.contractAddress, INFT_ABI, this.provider);
  }

  /** Returns a signer-bound Contract instance for state-changing calls. */
  writerContract(signer: ethers.Wallet): ethers.Contract {
    return new ethers.Contract(this.contractAddress, INFT_ABI, signer);
  }

  /**
   * Read the on-chain AgentRecord for a given tokenId.
   *
   * @param tokenId - uint256 token ID (bigint or decimal string)
   * @returns Decoded AgentRecord struct
   */
  async agentOf(tokenId: bigint | string): Promise<AgentRecord> {
    const contract = this.readContract();
    const result = await contract.agents(BigInt(tokenId));
    // Solidity struct fields are returned as positional tuple elements.
    // Destructuring order must match the struct definition in the contract.
    return {
      owner: result.owner as string,
      bundleHash: result.bundleHash as string,
      manifestUri: result.manifestUri as string,
      bundleUri: result.bundleUri as string,
      sealedDEKBaseUri: result.sealedDEKBaseUri as string,
      mode: Number(result.mode) as 0 | 1,
      createdAt: BigInt(result.createdAt),
    };
  }

  /**
   * Check whether an executor address is currently authorized for a given tokenId.
   *
   * @param tokenId  - uint256 token ID
   * @param executor - executor wallet address (0x-prefixed)
   */
  async isAuthorized(tokenId: bigint | string, executor: string): Promise<boolean> {
    const contract = this.readContract();
    return Boolean(await contract.isAuthorized(BigInt(tokenId), executor));
  }

  /**
   * ERC-721 ownerOf lookup.
   *
   * @param tokenId - uint256 token ID
   * @returns checksummed owner address
   */
  async ownerOf(tokenId: bigint | string): Promise<string> {
    const contract = this.readContract();
    return String(await contract.ownerOf(BigInt(tokenId)));
  }

  /**
   * Wait for a mint transaction receipt and decode the AgentMinted event.
   *
   * Waits up to 2 confirmations for the receipt, then scans the logs for the
   * first AgentMinted event emitted by the INFT contract and returns its fields.
   *
   * @param txHash - 0x-prefixed 32-byte transaction hash
   * @returns Decoded mint event fields
   * @throws Error if the receipt is not found or AgentMinted event is absent
   */
  async verifyMintTx(txHash: string): Promise<MintTxResult> {
    const receipt = await this.provider.waitForTransaction(txHash, 1, 60_000);
    if (!receipt) {
      throw new Error(`verifyMintTx: no receipt found for txHash ${txHash}`);
    }
    if (receipt.status !== 1) {
      throw new Error(`verifyMintTx: transaction reverted (txHash ${txHash})`);
    }

    const contract = this.readContract();
    const iface = contract.interface;

    for (const log of receipt.logs) {
      // Only consider logs from our contract
      if (log.address.toLowerCase() !== this.contractAddress.toLowerCase()) continue;

      let parsed: ethers.LogDescription | null = null;
      try {
        parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      } catch {
        // Not a recognised event from this ABI — skip
        continue;
      }

      if (parsed && parsed.name === 'AgentMinted') {
        const args = parsed.args;
        return {
          tokenId: BigInt(args.tokenId ?? args[0]),
          owner: String(args.owner ?? args[1]),
          // Event signature: AgentMinted(tokenId, owner, mode, bundleHash) → positional args [0,1,2,3]
          mode: Number(args.mode ?? args[2]),
          bundleHash: String(args.bundleHash ?? args[3]),
        };
      }
    }

    throw new Error(`verifyMintTx: AgentMinted event not found in receipt for txHash ${txHash}`);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an InftChain instance from environment variables or explicit overrides.
 *
 * Required env vars (when opts not provided):
 *   OG_RPC_URL             — JSON-RPC endpoint for 0G chain (or any EVM-compatible chain)
 *   INFT_CONTRACT_ADDRESS  — deployed BonFireAgentINFT contract address
 *
 * @param opts.rpcUrl          - Override OG_RPC_URL
 * @param opts.contractAddress - Override INFT_CONTRACT_ADDRESS
 */
export function createInftChain(opts?: { rpcUrl?: string; contractAddress?: string }): InftChain {
  const rpc = opts?.rpcUrl ?? process.env.OG_RPC_URL;
  const addr = opts?.contractAddress ?? process.env.INFT_CONTRACT_ADDRESS;

  if (!rpc || !addr) {
    throw new Error(
      'createInftChain: OG_RPC_URL and INFT_CONTRACT_ADDRESS are required ' +
      '(set env vars or pass opts.rpcUrl / opts.contractAddress)',
    );
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  return new InftChain(provider, addr);
}
