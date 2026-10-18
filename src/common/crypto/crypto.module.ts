import { KMSClient } from '@aws-sdk/client-kms';
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { Env } from '../../config/env';
import { FieldCipher } from './field-cipher';
import { Hashing, Hmac } from './hashing';
import { type KeyProvider, KmsKeyProvider, LocalKeyProvider, VersionedKeyProvider } from './key-providers';

function required(value: string | undefined, name: string): Buffer {
  if (!value) throw new Error(`${name} is not set (run "npm run setup" for local development)`);
  return Buffer.from(value, 'base64');
}

function createFieldCipher(config: Env): FieldCipher {
  const local = config.LOCAL_DATA_KEY_B64 ? new LocalKeyProvider(Buffer.from(config.LOCAL_DATA_KEY_B64, 'base64')) : null;
  const versioned = config.DATA_KEYS_B64 && config.DATA_KEY_ACTIVE ? new VersionedKeyProvider(config.DATA_KEYS_B64, config.DATA_KEY_ACTIVE) : null;
  const kms = config.KMS_KEY_ID ? new KmsKeyProvider(new KMSClient({ region: config.AWS_REGION }), config.KMS_KEY_ID) : null;
  // The writer: versioned master keys, else KMS, else the local development key. Every configured provider can read,
  // so data written before a switch stays readable.
  const writer = versioned ?? kms ?? local;
  if (!writer) throw new Error('DATA_KEYS_B64 (or KMS_KEY_ID, or LOCAL_DATA_KEY_B64 for development) must be set');
  const readers = [local, versioned, kms].filter((p): p is NonNullable<typeof p> => p !== null && p !== writer) as KeyProvider[];
  return new FieldCipher(writer, readers);
}

function createHashing(config: Env): Hashing {
  return new Hashing(
    new Hmac(required(config.PHONE_HASH_KEY_B64, 'PHONE_HASH_KEY_B64')),
    new Hmac(required(config.OTP_PEPPER_B64, 'OTP_PEPPER_B64')),
    new Hmac(required(config.TOKEN_PEPPER_B64, 'TOKEN_PEPPER_B64')),
  );
}

@Global()
@Module({
  providers: [
    { provide: FieldCipher, inject: [APP_CONFIG], useFactory: createFieldCipher },
    { provide: Hashing, inject: [APP_CONFIG], useFactory: createHashing },
  ],
  exports: [FieldCipher, Hashing],
})
export class CryptoModule {}
