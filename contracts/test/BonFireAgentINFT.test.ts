import { expect } from "chai";
import { ethers } from "hardhat";
import type { BonFireAgentINFT } from "../typechain-types";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("BonFireAgentINFT", function () {
  let contract: BonFireAgentINFT;
  let owner: SignerWithAddress;
  let other: SignerWithAddress;
  let executor: SignerWithAddress;

  const MANIFEST_URI = "0g://publicManifest/1.json";
  const BUNDLE_URI = "0g://encryptedBundle/1.bin";
  const SEALED_DEK_BASE_URI = "0g://sealedDEK/1/";
  const BUNDLE_HASH = ethers.keccak256(ethers.toUtf8Bytes("test-bundle"));

  beforeEach(async function () {
    [owner, other, executor] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("BonFireAgentINFT");
    contract = (await Factory.deploy()) as BonFireAgentINFT;
    await contract.waitForDeployment();
  });

  // ─── Mint ─────────────────────────────────────────────────────────────────

  describe("mint", function () {
    it("emits AgentMinted with correct fields and increments tokenId", async function () {
      const tx = await contract
        .connect(owner)
        .mint(MANIFEST_URI, BUNDLE_URI, SEALED_DEK_BASE_URI, BUNDLE_HASH, 0);
      const receipt = await tx.wait();

      await expect(tx)
        .to.emit(contract, "AgentMinted")
        .withArgs(1n, owner.address, 0, BUNDLE_HASH);

      // Second mint should get tokenId=2
      const tx2 = await contract
        .connect(owner)
        .mint(MANIFEST_URI, BUNDLE_URI, SEALED_DEK_BASE_URI, BUNDLE_HASH, 1);
      await expect(tx2)
        .to.emit(contract, "AgentMinted")
        .withArgs(2n, owner.address, 1, BUNDLE_HASH);
    });

    it("stores agentRecord correctly after mint", async function () {
      await contract
        .connect(owner)
        .mint(MANIFEST_URI, BUNDLE_URI, SEALED_DEK_BASE_URI, BUNDLE_HASH, 0);

      const record = await contract.agentOf(1n);
      expect(record.owner).to.equal(owner.address);
      expect(record.bundleHash).to.equal(BUNDLE_HASH);
      expect(record.manifestUri).to.equal(MANIFEST_URI);
      expect(record.bundleUri).to.equal(BUNDLE_URI);
      expect(record.sealedDEKBaseUri).to.equal(SEALED_DEK_BASE_URI);
      expect(record.mode).to.equal(0);
      expect(record.createdAt).to.be.gt(0n);
    });

    it("mints token to msg.sender", async function () {
      await contract
        .connect(owner)
        .mint(MANIFEST_URI, BUNDLE_URI, SEALED_DEK_BASE_URI, BUNDLE_HASH, 0);
      expect(await contract.ownerOf(1n)).to.equal(owner.address);
    });
  });

  // ─── setMode ──────────────────────────────────────────────────────────────

  describe("setMode", function () {
    beforeEach(async function () {
      await contract
        .connect(owner)
        .mint(MANIFEST_URI, BUNDLE_URI, SEALED_DEK_BASE_URI, BUNDLE_HASH, 0);
    });

    it("allows owner to change mode and emits ModeChanged", async function () {
      await expect(contract.connect(owner).setMode(1n, 1))
        .to.emit(contract, "ModeChanged")
        .withArgs(1n, 0, 1);

      const record = await contract.agentOf(1n);
      expect(record.mode).to.equal(1);
    });

    it("reverts when non-owner calls setMode", async function () {
      await expect(
        contract.connect(other).setMode(1n, 1)
      ).to.be.revertedWith("BonFireAgentINFT: caller is not token owner");
    });
  });

  // ─── authorizeUsage ───────────────────────────────────────────────────────

  describe("authorizeUsage", function () {
    beforeEach(async function () {
      // Mint a permissioned agent (mode=1)
      await contract
        .connect(owner)
        .mint(MANIFEST_URI, BUNDLE_URI, SEALED_DEK_BASE_URI, BUNDLE_HASH, 1);
    });

    it("reverts when non-owner calls authorizeUsage", async function () {
      // Use uint64 max value (not uint256 max) to match contract param type
      const MAX_UINT64 = BigInt("18446744073709551615");
      await expect(
        contract
          .connect(other)
          .authorizeUsage(1n, executor.address, MAX_UINT64)
      ).to.be.revertedWith("BonFireAgentINFT: caller is not token owner");
    });

    it("reverts when authorizing on a public-mode token", async function () {
      const MAX_UINT64 = BigInt("18446744073709551615");
      // Mint a public agent (mode=0)
      await contract
        .connect(owner)
        .mint(MANIFEST_URI, BUNDLE_URI, SEALED_DEK_BASE_URI, BUNDLE_HASH, 0);
      // tokenId=2 is public
      await expect(
        contract
          .connect(owner)
          .authorizeUsage(2n, executor.address, MAX_UINT64)
      ).to.be.revertedWith("BonFireAgentINFT: agent is not in permissioned mode");
    });

    it("emits UsageAuthorized after successful authorization", async function () {
      const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
      await expect(
        contract.connect(owner).authorizeUsage(1n, executor.address, expiresAt)
      )
        .to.emit(contract, "UsageAuthorized")
        .withArgs(1n, executor.address, expiresAt);
    });
  });

  // ─── revokeAuthorization ─────────────────────────────────────────────────

  describe("revokeAuthorization", function () {
    beforeEach(async function () {
      await contract
        .connect(owner)
        .mint(MANIFEST_URI, BUNDLE_URI, SEALED_DEK_BASE_URI, BUNDLE_HASH, 1);
    });

    it("reverts when non-owner calls revokeAuthorization", async function () {
      await expect(
        contract.connect(other).revokeAuthorization(1n, executor.address)
      ).to.be.revertedWith("BonFireAgentINFT: caller is not token owner");
    });

    it("emits UsageRevoked after revocation", async function () {
      // First authorize with uint64 max (unbounded)
      const expiresAt = BigInt("18446744073709551615"); // type(uint64).max
      await contract
        .connect(owner)
        .authorizeUsage(1n, executor.address, expiresAt);

      await expect(
        contract.connect(owner).revokeAuthorization(1n, executor.address)
      )
        .to.emit(contract, "UsageRevoked")
        .withArgs(1n, executor.address);
    });
  });

  // ─── isAuthorized ─────────────────────────────────────────────────────────

  describe("isAuthorized", function () {
    it("public mode: always returns true for any executor", async function () {
      await contract
        .connect(owner)
        .mint(MANIFEST_URI, BUNDLE_URI, SEALED_DEK_BASE_URI, BUNDLE_HASH, 0);

      expect(await contract.isAuthorized(1n, executor.address)).to.be.true;
      expect(await contract.isAuthorized(1n, other.address)).to.be.true;
      expect(await contract.isAuthorized(1n, owner.address)).to.be.true;
    });

    it("permissioned mode: returns false before authorization", async function () {
      await contract
        .connect(owner)
        .mint(MANIFEST_URI, BUNDLE_URI, SEALED_DEK_BASE_URI, BUNDLE_HASH, 1);

      expect(await contract.isAuthorized(1n, executor.address)).to.be.false;
    });

    it("permissioned mode: returns true after authorization (unbounded)", async function () {
      await contract
        .connect(owner)
        .mint(MANIFEST_URI, BUNDLE_URI, SEALED_DEK_BASE_URI, BUNDLE_HASH, 1);

      const MAX_UINT64 = BigInt("18446744073709551615"); // type(uint64).max
      await contract
        .connect(owner)
        .authorizeUsage(1n, executor.address, MAX_UINT64);

      expect(await contract.isAuthorized(1n, executor.address)).to.be.true;
    });

    it("permissioned mode: returns false after revocation", async function () {
      await contract
        .connect(owner)
        .mint(MANIFEST_URI, BUNDLE_URI, SEALED_DEK_BASE_URI, BUNDLE_HASH, 1);

      const MAX_UINT64 = BigInt("18446744073709551615");
      await contract
        .connect(owner)
        .authorizeUsage(1n, executor.address, MAX_UINT64);

      await contract
        .connect(owner)
        .revokeAuthorization(1n, executor.address);

      expect(await contract.isAuthorized(1n, executor.address)).to.be.false;
    });

    it("permissioned mode: returns false after timestamp expiry", async function () {
      await contract
        .connect(owner)
        .mint(MANIFEST_URI, BUNDLE_URI, SEALED_DEK_BASE_URI, BUNDLE_HASH, 1);

      // Set expiry in the past (1 second after Unix epoch)
      const pastExpiry = 1n;
      await contract
        .connect(owner)
        .authorizeUsage(1n, executor.address, pastExpiry);

      expect(await contract.isAuthorized(1n, executor.address)).to.be.false;
    });

    it("permissioned mode: returns true with future expiry", async function () {
      await contract
        .connect(owner)
        .mint(MANIFEST_URI, BUNDLE_URI, SEALED_DEK_BASE_URI, BUNDLE_HASH, 1);

      const futureExpiry = BigInt(Math.floor(Date.now() / 1000) + 86400 * 365);
      await contract
        .connect(owner)
        .authorizeUsage(1n, executor.address, futureExpiry);

      expect(await contract.isAuthorized(1n, executor.address)).to.be.true;
    });
  });

  // ─── Transfer guard ───────────────────────────────────────────────────────

  describe("transfer guard", function () {
    beforeEach(async function () {
      await contract
        .connect(owner)
        .mint(MANIFEST_URI, BUNDLE_URI, SEALED_DEK_BASE_URI, BUNDLE_HASH, 0);
    });

    it("transferFrom reverts with 'transfers disabled in v1'", async function () {
      await expect(
        contract
          .connect(owner)
          .transferFrom(owner.address, other.address, 1n)
      ).to.be.revertedWith("transfers disabled in v1");
    });

    it("safeTransferFrom reverts with 'transfers disabled in v1'", async function () {
      await expect(
        contract
          .connect(owner)
          ["safeTransferFrom(address,address,uint256)"](
            owner.address,
            other.address,
            1n
          )
      ).to.be.revertedWith("transfers disabled in v1");
    });
  });
});
