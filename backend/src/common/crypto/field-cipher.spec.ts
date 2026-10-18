import { DecryptCommand, GenerateDataKeyCommand } from '@aws-sdk/client-kms';
import { randomBytes } from 'node:crypto';
import { FieldCipher } from './field-cipher';
import { Hashing, Hmac, digestsEqual } from './hashing';
import { KmsKeyProvider, LocalKeyProvider, VersionedKeyProvider } from './key-providers';

describe('FieldCipher (local key)', () => {
  const cipher = new FieldCipher(new LocalKeyProvider(randomBytes(32)));

  it('round-trips text, including Telugu', async () => {
    for (const text of ['9876543210', 'Flat 4B, Lake View', 'స్వాతి నాయుడు', '']) {
      expect(await cipher.decrypt('users.name', await cipher.encrypt('users.name', text))).toBe(text);
    }
  });

  it('never repeats a ciphertext and never contains the plaintext', async () => {
    const a = await cipher.encrypt('users.phone', '9876543210');
    const b = await cipher.encrypt('users.phone', '9876543210');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(Buffer.from(a).toString('latin1')).not.toContain('9876543210');
  });

  it('binds the value to its column: a copy in another column does not decrypt', async () => {
    const phone = await cipher.encrypt('users.phone', '9876543210');
    await expect(cipher.decrypt('users.name', phone)).rejects.toThrow();
  });

  it('detects tampering', async () => {
    const blob = Buffer.from(await cipher.encrypt('users.phone', '9876543210'));
    blob[blob.length - 1]! ^= 1;
    await expect(cipher.decrypt('users.phone', blob)).rejects.toThrow();
  });

  it('fails with another master key', async () => {
    const other = new FieldCipher(new LocalKeyProvider(randomBytes(32)));
    await expect(other.decrypt('users.phone', await cipher.encrypt('users.phone', 'x'))).rejects.toThrow();
  });

  it('rejects a local key that is not 32 bytes', () => {
    expect(() => new LocalKeyProvider(randomBytes(16))).toThrow('exactly 32 bytes');
  });
});

describe('FieldCipher (KMS)', () => {
  // A stand-in for KMS: "wraps" keys by XOR with a fixed pad, and checks the encryption context.
  function fakeKms() {
    const pad = randomBytes(32);
    const xor = (b: Uint8Array) => Buffer.from(b).map((x, i) => x ^ pad[i]!);
    const calls: string[] = [];
    const send = jest.fn(async (cmd: unknown) => {
      if (cmd instanceof GenerateDataKeyCommand) {
        calls.push(`generate:${cmd.input.EncryptionContext?.field}`);
        const plain = randomBytes(32);
        return { Plaintext: plain, CiphertextBlob: xor(plain) };
      }
      if (cmd instanceof DecryptCommand) {
        calls.push(`decrypt:${cmd.input.EncryptionContext?.field}`);
        return { Plaintext: xor(cmd.input.CiphertextBlob!) };
      }
      throw new Error('unexpected command');
    });
    return { send, calls };
  }

  it('wraps each value with its own KMS data key and caches unwrapped keys', async () => {
    const kms = fakeKms();
    const cipher = new FieldCipher(new KmsKeyProvider(kms as never, 'alias/housefi-pii'));
    const blob = await cipher.encrypt('users.phone', '9876543210');
    expect(await cipher.decrypt('users.phone', blob)).toBe('9876543210');
    expect(await cipher.decrypt('users.phone', blob)).toBe('9876543210');
    expect(kms.calls).toEqual(['generate:housefi:v1:users.phone', 'decrypt:housefi:v1:users.phone']);
  });

  it('can still read values written with the local key after switching to KMS', async () => {
    const local = new LocalKeyProvider(randomBytes(32));
    const old = await new FieldCipher(local).encrypt('users.phone', '9876543210');
    const migrated = new FieldCipher(new KmsKeyProvider(fakeKms() as never, 'k'), [local]);
    expect(await migrated.decrypt('users.phone', old)).toBe('9876543210');
  });
});

describe('Hashing', () => {
  const hashing = new Hashing(new Hmac(randomBytes(32)), new Hmac(randomBytes(32)), new Hmac(randomBytes(32)));

  it('is deterministic per input (usable for lookups) and differs per purpose', () => {
    expect(digestsEqual(hashing.phone('9876543210'), hashing.phone('9876543210'))).toBe(true);
    expect(digestsEqual(hashing.phone('9876543210'), hashing.phone('9876543211'))).toBe(false);
    expect(digestsEqual(hashing.otp('c1', '123456'), hashing.otp('c2', '123456'))).toBe(false);
  });

  it('rejects short keys', () => {
    expect(() => new Hmac(randomBytes(16))).toThrow();
  });
});

describe('VersionedKeyProvider (production without a cloud KMS)', () => {
  const k = (n: number) => Buffer.alloc(32, n).toString('base64');

  it('encrypts with the active version and still reads older versions after a rotation', async () => {
    const v1 = new FieldCipher(new VersionedKeyProvider(new Map([[1, k(1)]]), 1));
    const old = await v1.encrypt('users.phone', '9876543210');
    const rotated = new FieldCipher(new VersionedKeyProvider(new Map([[1, k(1)], [2, k(2)]]), 2));
    expect(await rotated.decrypt('users.phone', old)).toBe('9876543210');
    const fresh = await rotated.encrypt('users.phone', '9123456780');
    expect(await rotated.decrypt('users.phone', fresh)).toBe('9123456780');
    // Without version 2 the new value cannot be read.
    await expect(v1.decrypt('users.phone', fresh)).rejects.toThrow();
  });

  it('binds the field name: a value copied to another column does not decrypt', async () => {
    const c = new FieldCipher(new VersionedKeyProvider(new Map([[1, k(1)]]), 1));
    const blob = await c.encrypt('users.phone', 'x');
    await expect(c.decrypt('users.name', blob)).rejects.toThrow();
  });
});
