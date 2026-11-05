import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface AesGcmEnvelope {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

/** Encrypt plaintext using AES-256-GCM. A random 12-byte IV is generated internally. */
export function encryptAesGcm(plaintext: Buffer, key: Buffer): AesGcmEnvelope {
  if (key.length !== 32) {
    throw new Error('invalid key length: AES-256-GCM requires a 32-byte key');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return { ciphertext, iv, tag };
}

/** Decrypt an AES-256-GCM envelope. */
export function decryptAesGcm(envelope: AesGcmEnvelope, key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new Error('invalid key length: AES-256-GCM requires a 32-byte key');
  }
  if (envelope.iv.length !== 12) {
    throw new Error('invalid iv length: expected 12 bytes');
  }
  if (envelope.tag.length !== 16) {
    throw new Error('invalid tag length: expected 16 bytes');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, envelope.iv, { authTagLength: 16 });
  decipher.setAuthTag(envelope.tag);

  try {
    const plaintext = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
    return plaintext;
  } catch {
    throw new Error('decryption failed: authentication tag mismatch');
  }
}

/** Pack an AesGcmEnvelope into a single Buffer: [iv(12) | tag(16) | ciphertext] */
export function packEnvelope(env: AesGcmEnvelope): Buffer {
  return Buffer.concat([env.iv, env.tag, env.ciphertext]);
}

/** Unpack a packed Buffer back into an AesGcmEnvelope. Expected format: [iv(12) | tag(16) | ciphertext] */
export function unpackEnvelope(packed: Buffer): AesGcmEnvelope {
  if (packed.length < 28) {
    throw new Error('invalid packed envelope: too short (minimum 28 bytes for iv + tag)');
  }
  return {
    iv: Buffer.from(packed.subarray(0, 12)),
    tag: Buffer.from(packed.subarray(12, 28)),
    ciphertext: Buffer.from(packed.subarray(28)),
  };
}
