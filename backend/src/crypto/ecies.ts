import * as secp from '@noble/secp256k1';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { computeAddress } from 'ethers';
import { encryptAesGcm, decryptAesGcm, packEnvelope, unpackEnvelope } from './aes-gcm.js';

// Enable synchronous secp256k1 operations by wiring in @noble/hashes
secp.hashes.sha256 = sha256;
secp.hashes.hmacSha256 = (key: Uint8Array, msg: Uint8Array) => hmac(sha256, key, msg);

const EPHEMERAL_PUBKEY_LEN = 33; // compressed secp256k1 public key

/**
 * Seal (encrypt) plaintext for a recipient identified by their secp256k1 public key.
 *
 * ECIES hybrid scheme:
 *   1. Generate ephemeral keypair
 *   2. ECDH(ephemeralPriv, recipientPub) -> 33-byte compressed shared point
 *   3. Use bytes 1-32 of the shared point as HKDF input keying material
 *   4. HKDF-SHA256 -> 32-byte DEK
 *   5. Encrypt plaintext with AES-256-GCM using the DEK
 *   6. Pack: [ephemeralPubkey(33) | iv(12) | tag(16) | ciphertext]
 *
 * @param recipientPubkeyHex - 65-byte uncompressed or 33-byte compressed hex pubkey
 * @param plaintext - data to encrypt
 */
export function sealEcies(recipientPubkeyHex: string, plaintext: Buffer): Buffer {
  const recipientPubBytes = Buffer.from(
    recipientPubkeyHex.startsWith('0x') ? recipientPubkeyHex.slice(2) : recipientPubkeyHex,
    'hex',
  );

  // Generate ephemeral keypair
  const { secretKey: ephemeralPriv, publicKey: ephemeralPubCompressed } = secp.keygen();

  // ECDH: ephemeralPriv * recipientPub -> 33-byte compressed shared point
  const sharedPoint = secp.getSharedSecret(ephemeralPriv, recipientPubBytes, true);
  // Use bytes 1-32 (strip the 0x02/0x03 prefix byte) as IKM for HKDF
  const ikm = sharedPoint.slice(1); // 32 bytes

  // HKDF-SHA256 to derive 32-byte AES key
  const dek = Buffer.from(hkdf(sha256, ikm, undefined, undefined, 32));

  // Encrypt
  const envelope = encryptAesGcm(plaintext, dek);
  const packedEnvelope = packEnvelope(envelope);

  // Final format: [ephemeralPubkey(33) | iv(12) | tag(16) | ciphertext]
  const ephPubBuf = Buffer.from(ephemeralPubCompressed);
  return Buffer.concat([ephPubBuf, packedEnvelope]);
}

/**
 * Unseal (decrypt) a sealed ECIES payload using the recipient's private key.
 *
 * @param recipientPrivkeyHex - 32-byte hex private key (with or without 0x prefix)
 * @param sealed - sealed buffer from sealEcies
 */
export function unsealEcies(recipientPrivkeyHex: string, sealed: Buffer): Buffer {
  if (sealed.length < EPHEMERAL_PUBKEY_LEN + 28) {
    throw new Error('invalid sealed payload: too short');
  }

  const privHex = recipientPrivkeyHex.startsWith('0x')
    ? recipientPrivkeyHex.slice(2)
    : recipientPrivkeyHex;
  const recipientPriv = Buffer.from(privHex, 'hex');

  if (recipientPriv.length !== 32) {
    throw new Error('invalid private key length: expected 32 bytes');
  }

  // Parse ephemeral pubkey (33 bytes compressed)
  const ephemeralPub = sealed.subarray(0, EPHEMERAL_PUBKEY_LEN);
  const packedEnvelope = sealed.subarray(EPHEMERAL_PUBKEY_LEN);

  // ECDH: recipientPriv * ephemeralPub -> 33-byte compressed shared point
  const sharedPoint = secp.getSharedSecret(recipientPriv, ephemeralPub, true);
  // Use bytes 1-32 as IKM for HKDF
  const ikm = sharedPoint.slice(1); // 32 bytes

  // HKDF-SHA256 to derive 32-byte AES key
  const dek = Buffer.from(hkdf(sha256, ikm, undefined, undefined, 32));

  // Decrypt
  const envelope = unpackEnvelope(Buffer.from(packedEnvelope));
  return decryptAesGcm(envelope, dek);
}

/**
 * Derive the checksummed Ethereum address from a hex private key.
 *
 * @param privkeyHex - 32-byte hex private key (with or without 0x prefix)
 * @returns checksummed Ethereum address (0x-prefixed)
 */
export function deriveAddressFromPrivkey(privkeyHex: string): string {
  const normalised = privkeyHex.startsWith('0x') ? privkeyHex : `0x${privkeyHex}`;
  const pub = pubkeyFromPrivkey(normalised);
  return computeAddress(`0x${pub}`);
}

/**
 * Derive the 65-byte uncompressed public key from a hex private key.
 *
 * @param privkeyHex - 32-byte hex private key (with or without 0x prefix)
 * @returns 65-byte uncompressed public key as hex string (no 0x prefix)
 */
export function pubkeyFromPrivkey(privkeyHex: string): string {
  const privHex = privkeyHex.startsWith('0x') ? privkeyHex.slice(2) : privkeyHex;
  const privBytes = Buffer.from(privHex, 'hex');

  if (privBytes.length !== 32) {
    throw new Error('invalid private key length: expected 32 bytes');
  }

  // getPublicKey returns uncompressed (65 bytes) when isCompressed=false
  const pubUncompressed = secp.getPublicKey(privBytes, false);
  return Buffer.from(pubUncompressed).toString('hex');
}
