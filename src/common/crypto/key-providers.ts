// Data-key providers for envelope encryption. Every encrypted value gets its own random 256-bit data key; the
// provider wraps that key with a master key: a local key from the environment in development, AWS KMS in
// production. The provider id is stored in each ciphertext, so values can always be routed to the right provider.
import { DecryptCommand, GenerateDataKeyCommand, type KMSClient } from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface DataKey {
  readonly plain: Buffer;
  readonly wrapped: Buffer;
}

export interface KeyProvider {
  /** Stored in every ciphertext (one byte). Never reuse an id for a different provider. */
  readonly id: number;
  generate(context: string): Promise<DataKey>;
  unwrap(wrapped: Buffer, context: string): Promise<Buffer>;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Development and tests: wraps data keys with AES-256-GCM under LOCAL_DATA_KEY_B64. Not allowed in production. */
export class LocalKeyProvider implements KeyProvider {
  readonly id = 1;

  constructor(private readonly masterKey: Buffer) {
    if (masterKey.length !== 32) throw new Error('LOCAL_DATA_KEY_B64 must decode to exactly 32 bytes');
  }

  async generate(context: string): Promise<DataKey> {
    const plain = randomBytes(32);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv).setAAD(Buffer.from(context));
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    return { plain, wrapped: Buffer.concat([iv, cipher.getAuthTag(), ct]) };
  }

  async unwrap(wrapped: Buffer, context: string): Promise<Buffer> {
    const iv = wrapped.subarray(0, IV_BYTES);
    const tag = wrapped.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv).setAAD(Buffer.from(context)).setAuthTag(tag);
    return Buffer.concat([decipher.update(wrapped.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
  }
}

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 5000;

/**
 * Production: AWS KMS (key in ap-south-1). One GenerateDataKey call per encrypted value; unwrapped data keys are
 * cached in memory for a few minutes so reading a list of records does not cost one KMS call per field.
 */
export class KmsKeyProvider implements KeyProvider {
  readonly id = 2;
  private readonly cache = new Map<string, { key: Buffer; until: number }>();

  constructor(
    private readonly kms: Pick<KMSClient, 'send'>,
    private readonly keyId: string,
    private readonly now: () => number = Date.now,
  ) {}

  async generate(context: string): Promise<DataKey> {
    const out = await this.kms.send(
      new GenerateDataKeyCommand({ KeyId: this.keyId, KeySpec: 'AES_256', EncryptionContext: { field: context } }),
    );
    if (!out.Plaintext || !out.CiphertextBlob) throw new Error('KMS GenerateDataKey returned no key');
    return { plain: Buffer.from(out.Plaintext), wrapped: Buffer.from(out.CiphertextBlob) };
  }

  async unwrap(wrapped: Buffer, context: string): Promise<Buffer> {
    const cacheKey = `${context}:${wrapped.toString('base64')}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.until > this.now()) return hit.key;
    const out = await this.kms.send(
      new DecryptCommand({ KeyId: this.keyId, CiphertextBlob: wrapped, EncryptionContext: { field: context } }),
    );
    if (!out.Plaintext) throw new Error('KMS Decrypt returned no key');
    const key = Buffer.from(out.Plaintext);
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(cacheKey, { key, until: this.now() + CACHE_TTL_MS });
    return key;
  }
}
