/**
 * Minimal ABI fragment for BonFireAgentINFT — only the functions and events
 * required by the frontend mint flow are included. The full contract ABI lives
 * in the backend/contracts/ directory; keeping this minimal avoids coupling the
 * frontend to the full contract surface area.
 */
export const BonFireAgentINFTAbi = [
  {
    inputs: [
      { internalType: 'string', name: 'manifestUri', type: 'string' },
      { internalType: 'string', name: 'bundleUri', type: 'string' },
      { internalType: 'string', name: 'sealedDEKBaseUri', type: 'string' },
      { internalType: 'bytes32', name: 'bundleHash', type: 'bytes32' },
      { internalType: 'uint8', name: 'mode', type: 'uint8' },
    ],
    name: 'mint',
    outputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'owner', type: 'address' },
      { indexed: false, internalType: 'uint8', name: 'mode', type: 'uint8' },
      { indexed: false, internalType: 'bytes32', name: 'bundleHash', type: 'bytes32' },
    ],
    name: 'AgentMinted',
    type: 'event',
  },
] as const;
