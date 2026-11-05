// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title BonFireAgentINFT
 * @notice ERC-721-based intelligent NFT (INFT) for BonFire agent ownership and access control.
 *         Each token represents an agent whose encrypted bundle lives on 0G Storage.
 *         Transfers are disabled in v1 — tokens are soulbound to the minting wallet.
 * @dev Implements ERC-7857-style encrypted-metadata extensions.
 *      Uses OZ v5 _update hook to block transfers while permitting mint (from==0) and burn (to==0).
 */
contract BonFireAgentINFT is ERC721 {
    // ─── Data structures ────────────────────────────────────────────────────────

    /**
     * @notice On-chain record stored per tokenId at mint time.
     * @param owner          Wallet address that minted the token.
     * @param bundleHash     keccak256 of the raw encrypted bundle bytes on 0G Storage.
     * @param manifestUri    0G Storage URI of the plaintext public manifest JSON.
     * @param bundleUri      0G Storage URI of the AES-256-GCM encrypted soul/agents/llm blob.
     * @param sealedDEKBaseUri 0G Storage base URI for sealed DEK directory (shared.bin lives here).
     * @param mode           0 = public (any executor can invoke), 1 = permissioned (require authorizeUsage).
     * @param createdAt      Unix timestamp at time of mint.
     */
    struct AgentRecord {
        address owner;
        bytes32 bundleHash;
        string  manifestUri;
        string  bundleUri;
        string  sealedDEKBaseUri;
        uint8   mode;
        uint64  createdAt;
    }

    // ─── State ───────────────────────────────────────────────────────────────

    /// @notice Maps tokenId to its on-chain AgentRecord.
    mapping(uint256 => AgentRecord) public agents;

    /**
     * @notice Per-agent per-executor authorization expiry.
     *         0              → no authorization granted
     *         type(uint64).max → unbounded (never expires)
     *         any other value  → expires at that unix timestamp
     */
    mapping(uint256 => mapping(address => uint64)) public authorizations;

    /// @dev Auto-incrementing token id counter; starts at 1.
    uint256 private _nextTokenId = 1;

    // ─── Events ──────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when a new agent token is minted.
     * @param tokenId    The newly assigned token id.
     * @param owner      Address of the minting wallet.
     * @param mode       Initial access mode (0=public, 1=permissioned).
     * @param bundleHash keccak256 of the encrypted bundle at mint time.
     */
    event AgentMinted(
        uint256 indexed tokenId,
        address indexed owner,
        uint8 mode,
        bytes32 bundleHash
    );

    /**
     * @notice Emitted when the owner changes the agent's access mode.
     * @param tokenId The affected token.
     * @param oldMode Previous mode value.
     * @param newMode New mode value.
     */
    event ModeChanged(uint256 indexed tokenId, uint8 oldMode, uint8 newMode);

    /**
     * @notice Emitted when the owner grants an executor authorization to invoke the agent.
     * @param tokenId   The affected token.
     * @param executor  Wallet address of the authorized executor (e.g. a BonFire server wallet).
     * @param expiresAt Unix timestamp after which the authorization lapses; type(uint64).max = unbounded.
     */
    event UsageAuthorized(
        uint256 indexed tokenId,
        address indexed executor,
        uint64 expiresAt
    );

    /**
     * @notice Emitted when the owner revokes a previously granted authorization.
     * @param tokenId  The affected token.
     * @param executor The executor whose authorization was removed.
     */
    event UsageRevoked(uint256 indexed tokenId, address indexed executor);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    /**
     * @dev Reverts if the caller is not the current owner of the specified token.
     * @param tokenId Token to check ownership of.
     */
    modifier onlyTokenOwner(uint256 tokenId) {
        require(ownerOf(tokenId) == msg.sender, "BonFireAgentINFT: caller is not token owner");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() ERC721("BonFire Agent", "BFAGT") {}

    // ─── Write functions ─────────────────────────────────────────────────────

    /**
     * @notice Mint a new agent token to the caller's wallet.
     * @param manifestUri      0G Storage URI of the plaintext public manifest.
     * @param bundleUri        0G Storage URI of the encrypted soul/agents/llm bundle.
     * @param sealedDEKBaseUri 0G Storage base URI for the sealed DEK directory.
     * @param bundleHash       keccak256 of the encrypted bundle bytes for integrity verification.
     * @param mode             Initial access mode: 0 = public, 1 = permissioned.
     * @return tokenId         The assigned token id.
     */
    function mint(
        string calldata manifestUri,
        string calldata bundleUri,
        string calldata sealedDEKBaseUri,
        bytes32 bundleHash,
        uint8 mode
    ) external returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);

        agents[tokenId] = AgentRecord({
            owner:           msg.sender,
            bundleHash:      bundleHash,
            manifestUri:     manifestUri,
            bundleUri:       bundleUri,
            sealedDEKBaseUri: sealedDEKBaseUri,
            mode:            mode,
            createdAt:       uint64(block.timestamp)
        });

        emit AgentMinted(tokenId, msg.sender, mode, bundleHash);
        return tokenId;
    }

    /**
     * @notice Change the access mode of an agent token.
     *         Only the token owner may call this.
     * @param tokenId Token to update.
     * @param mode    New mode (0 = public, 1 = permissioned).
     */
    function setMode(uint256 tokenId, uint8 mode) external onlyTokenOwner(tokenId) {
        uint8 oldMode = agents[tokenId].mode;
        agents[tokenId].mode = mode;
        emit ModeChanged(tokenId, oldMode, mode);
    }

    /**
     * @notice Grant an executor permission to invoke a permissioned agent.
     *         Token must be in permissioned mode (mode == 1).
     *         Only the token owner may call this.
     * @param tokenId   Token to authorize against.
     * @param executor  Address to authorize (typically a BonFire server wallet).
     * @param expiresAt Unix timestamp of expiry; pass type(uint64).max for no expiry.
     */
    function authorizeUsage(
        uint256 tokenId,
        address executor,
        uint64 expiresAt
    ) external onlyTokenOwner(tokenId) {
        // Authorization only meaningful for permissioned mode.
        require(agents[tokenId].mode == 1, "BonFireAgentINFT: agent is not in permissioned mode");
        authorizations[tokenId][executor] = expiresAt;
        emit UsageAuthorized(tokenId, executor, expiresAt);
    }

    /**
     * @notice Revoke a previously granted authorization.
     *         Only the token owner may call this.
     * @param tokenId  Token to revoke against.
     * @param executor Address whose authorization should be removed.
     */
    function revokeAuthorization(
        uint256 tokenId,
        address executor
    ) external onlyTokenOwner(tokenId) {
        delete authorizations[tokenId][executor];
        emit UsageRevoked(tokenId, executor);
    }

    // ─── View functions ──────────────────────────────────────────────────────

    /**
     * @notice Check whether a given executor is authorized to invoke an agent.
     *         - Public mode (0): always returns true for any executor.
     *         - Permissioned mode (1): returns true only if a non-expired authorization exists.
     * @param tokenId  Token to check.
     * @param executor Address to check authorization for.
     * @return bool    True if the executor may invoke the agent.
     */
    function isAuthorized(uint256 tokenId, address executor) public view returns (bool) {
        AgentRecord storage record = agents[tokenId];
        if (record.mode == 0) {
            // Public mode — any executor may invoke.
            return true;
        }
        // Permissioned mode — check expiry.
        uint64 exp = authorizations[tokenId][executor];
        if (exp == 0) {
            return false;
        }
        // type(uint64).max means unbounded; otherwise check against current timestamp.
        return exp == type(uint64).max || exp > uint64(block.timestamp);
    }

    /**
     * @notice Retrieve the full AgentRecord for a token.
     * @param tokenId Token to query.
     * @return AgentRecord memory struct with all on-chain agent data.
     */
    function agentOf(uint256 tokenId) external view returns (AgentRecord memory) {
        return agents[tokenId];
    }

    // ─── Transfer guard ──────────────────────────────────────────────────────

    /**
     * @dev Override OZ v5's _update hook to disable token transfers in v1.
     *      Mints (from == address(0)) and burns (to == address(0)) are still allowed;
     *      any other combination (transfer) reverts.
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        // Revert on transfers: both from and to must be non-zero for a real transfer.
        if (from != address(0) && to != address(0)) {
            revert("transfers disabled in v1");
        }
        return super._update(to, tokenId, auth);
    }
}
