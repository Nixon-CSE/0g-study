import { describe, it, expect } from 'vitest';
import {
  encryptAesGcm,
  decryptAesGcm,
  packEnvelope,
  unpackEnvelope,
  sealEcies,
  unsealEcies,
  deriveAddressFromPrivkey,
  pubkeyFromPrivkey,
} from '../src/crypto/index.js';

// ---------------------------------------------------------------------------
// Test vectors (generated with ethers v6)
// ---------------------------------------------------------------------------

// Hardhat account #0
const KNOWN_PRIV = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const KNOWN_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const KNOWN_PUB_HEX =
  '048318535b54105d4a7aae60c08fc45f9687181b4fdfc625bd1a753fa7397fed753547f11ca8696646f2f3acb08e31016afac23e630c5d11f59f61fef57b0d2aa5';

// Hardhat account #1 (used as the ECIES recipient)
const ALICE_PRIV = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const ALICE_PUB_HEX =
  '04ba5734d8f7091719471e7f7ed6b9df170dc70cc661ca05e688601ad984f068b0d67351e5f06073092499336ab0839ef8a521afd334e53807205fa2f08eec74f4';

// A different private key (Hardhat account #2) — used to test wrong-key failures
const BOB_PRIV = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

// ---------------------------------------------------------------------------
// AES-256-GCM
// ---------------------------------------------------------------------------

describe('AES-GCM', () => {
  const KEY = Buffer.alloc(32, 0xab); // 32 bytes of 0xab
  const PLAINTEXT = Buffer.from('hello bonfire INFT!', 'utf8');

  it('round-trip: encrypt then decrypt returns original plaintext', () => {
    const envelope = encryptAesGcm(PLAINTEXT, KEY);
    const recovered = decryptAesGcm(envelope, KEY);
    expect(recovered.equals(PLAINTEXT)).toBe(true);
  });

  it('tamper: flipping a bit in ciphertext causes decrypt to throw', () => {
    const envelope = encryptAesGcm(PLAINTEXT, KEY);
    // Flip the first byte of ciphertext
    const tampered = Buffer.from(envelope.ciphertext);
    tampered[0] ^= 0x01;
    expect(() =>
      decryptAesGcm({ ...envelope, ciphertext: tampered }, KEY),
    ).toThrow();
  });

  it('wrong key: decrypting with a different key throws', () => {
    const envelope = encryptAesGcm(PLAINTEXT, KEY);
    const wrongKey = Buffer.alloc(32, 0xcd);
    expect(() => decryptAesGcm(envelope, wrongKey)).toThrow();
  });

  it('invalid key length: throws on non-32-byte key', () => {
    const shortKey = Buffer.alloc(16, 0xab);
    expect(() => encryptAesGcm(PLAINTEXT, shortKey)).toThrow('invalid key length');
  });

  it('packEnvelope / unpackEnvelope round-trip preserves all fields', () => {
    const envelope = encryptAesGcm(PLAINTEXT, KEY);
    const packed = packEnvelope(envelope);
    expect(packed.length).toBe(12 + 16 + envelope.ciphertext.length);

    const unpacked = unpackEnvelope(packed);
    expect(unpacked.iv.equals(envelope.iv)).toBe(true);
    expect(unpacked.tag.equals(envelope.tag)).toBe(true);
    expect(unpacked.ciphertext.equals(envelope.ciphertext)).toBe(true);
  });

  it('packed envelope decrypts correctly', () => {
    const envelope = encryptAesGcm(PLAINTEXT, KEY);
    const packed = packEnvelope(envelope);
    const unpacked = unpackEnvelope(packed);
    const recovered = decryptAesGcm(unpacked, KEY);
    expect(recovered.equals(PLAINTEXT)).toBe(true);
  });

  it('unpackEnvelope throws on too-short buffer', () => {
    expect(() => unpackEnvelope(Buffer.alloc(10))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ECIES
// ---------------------------------------------------------------------------

describe('ECIES', () => {
  const PLAINTEXT = Buffer.from('agent personality bundle', 'utf8');

  it('round-trip with known secp256k1 keypair', () => {
    const sealed = sealEcies(ALICE_PUB_HEX, PLAINTEXT);
    const recovered = unsealEcies(ALICE_PRIV, sealed);
    expect(recovered.equals(PLAINTEXT)).toBe(true);
  });

  it('wrong private key: unseal with a different key throws', () => {
    const sealed = sealEcies(ALICE_PUB_HEX, PLAINTEXT);
    expect(() => unsealEcies(BOB_PRIV, sealed)).toThrow();
  });

  it('tamper: flipping a bit in the ciphertext portion causes unseal to throw', () => {
    const sealed = sealEcies(ALICE_PUB_HEX, PLAINTEXT);
    // The ciphertext starts at byte 33 (ephemeral pubkey) + 12 (iv) + 16 (tag) = 61
    const tampered = Buffer.from(sealed);
    tampered[61] ^= 0x01;
    expect(() => unsealEcies(ALICE_PRIV, tampered)).toThrow();
  });

  it('sealed payload has correct minimum length (33 + 12 + 16 = 61+ bytes)', () => {
    const sealed = sealEcies(ALICE_PUB_HEX, PLAINTEXT);
    expect(sealed.length).toBeGreaterThanOrEqual(61 + PLAINTEXT.length);
  });

  it('seal with 0x-prefixed pubkey works the same as without', () => {
    const sealedWith = sealEcies('0x' + ALICE_PUB_HEX, PLAINTEXT);
    const recovered = unsealEcies(ALICE_PRIV, sealedWith);
    expect(recovered.equals(PLAINTEXT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deriveAddressFromPrivkey
// ---------------------------------------------------------------------------

describe('deriveAddressFromPrivkey', () => {
  it('returns expected checksummed address for known private key', () => {
    const addr = deriveAddressFromPrivkey(KNOWN_PRIV);
    expect(addr).toBe(KNOWN_ADDR);
  });

  it('works with 0x-prefixed and unprefixed private keys', () => {
    const withPrefix = deriveAddressFromPrivkey(KNOWN_PRIV);
    const withoutPrefix = deriveAddressFromPrivkey(KNOWN_PRIV.slice(2));
    expect(withPrefix).toBe(withoutPrefix);
  });

  it('returns checksummed (EIP-55) address', () => {
    const addr = deriveAddressFromPrivkey(KNOWN_PRIV);
    // EIP-55 checksummed addresses have mixed case
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Verify it matches the expected value exactly (proves checksum is applied)
    expect(addr).toBe(KNOWN_ADDR);
  });
});

// ---------------------------------------------------------------------------
// pubkeyFromPrivkey
// ---------------------------------------------------------------------------

describe('pubkeyFromPrivkey', () => {
  it('returns expected 65-byte uncompressed public key for known private key', () => {
    const pub = pubkeyFromPrivkey(KNOWN_PRIV);
    expect(pub).toBe(KNOWN_PUB_HEX);
  });

  it('returns 130-char hex string (65 bytes)', () => {
    const pub = pubkeyFromPrivkey(KNOWN_PRIV);
    expect(pub.length).toBe(130); // 65 bytes * 2 hex chars = 130
  });

  it('works with 0x-prefixed and unprefixed private keys', () => {
    const withPrefix = pubkeyFromPrivkey(KNOWN_PRIV);
    const withoutPrefix = pubkeyFromPrivkey(KNOWN_PRIV.slice(2));
    expect(withPrefix).toBe(withoutPrefix);
  });

  it('alice key returns expected public key', () => {
    const pub = pubkeyFromPrivkey(ALICE_PRIV);
    expect(pub).toBe(ALICE_PUB_HEX);
  });
});
