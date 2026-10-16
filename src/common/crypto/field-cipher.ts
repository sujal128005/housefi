import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KeyProvider } from './key-providers';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Field-level encryption for personal data (phone numbers, names, addresses): AES-256-GCM with a fresh data key per
 * value, wrapped by a KeyProvider. The field name is bound in as authenticated data, so a ciphertext copied into
 * another column does not decrypt.
 *
 * Layout: version (1) | provider id (1) | wrapped key length (2, BE) | wrapped key | iv (12) | tag (16) | ciphertext
 */
export class FieldCipher {
  private readonly byId: ReadonlyMap<number, KeyProvider>;

  /** `writer` encrypts new values; `readers` (which include the writer) can decrypt older ones. */
  constructor(
    private readonly writer: KeyProvider,
    readers: readonly KeyProvider[] = [],
  ) {
    this.byId = new Map([...readers, writer].map((p) => [p.id, p]));
  }

  async encrypt(field: string, plaintext: string): Promise<Uint8Array<ArrayBuffer>> {
    const context = `housefi:v${VERSION}:${field}`;
    const dataKey = await this.writer.generate(context);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', dataKey.plain, iv).setAAD(Buffer.from(context));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const header = Buffer.alloc(4);
    header.writeUInt8(VERSION, 0);
    header.writeUInt8(this.writer.id, 1);
    header.writeUInt16BE(dataKey.wrapped.length, 2);
    dataKey.plain.fill(0);
    return new Uint8Array(Buffer.concat([header, dataKey.wrapped, iv, cipher.getAuthTag(), ct]));
  }

  async decrypt(field: string, blob: Uint8Array): Promise<string> {
    const buf = Buffer.from(blob);
    if (buf.length < 4 || buf.readUInt8(0) !== VERSION) throw new Error(`unsupported ciphertext for ${field}`);
    const provider = this.byId.get(buf.readUInt8(1));
    if (!provider) throw new Error(`no key provider ${buf.readUInt8(1)} for ${field}`);
    const wrappedLen = buf.readUInt16BE(2);
    let at = 4;
    const wrapped = buf.subarray(at, (at += wrappedLen));
    const iv = buf.subarray(at, (at += IV_BYTES));
    const tag = buf.subarray(at, (at += TAG_BYTES));
    const context = `housefi:v${VERSION}:${field}`;
    const key = await provider.unwrap(wrapped, context);
    const decipher = createDecipheriv('aes-256-gcm', key, iv).setAAD(Buffer.from(context)).setAuthTag(tag);
    return Buffer.concat([decipher.update(buf.subarray(at)), decipher.final()]).toString('utf8');
  }
}
