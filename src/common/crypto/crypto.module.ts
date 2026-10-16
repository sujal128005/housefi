import { KMSClient } from '@aws-sdk/client-kms';
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { Env } from '../../config/env';
import { FieldCipher } from './field-cipher';
import { Hashing, Hmac } from './hashing';
import { KmsKeyProvider, LocalKeyProvider } from './key-providers';

function required(value: string | undefined, name: string): Buffer {
  if (!value) throw new Error(`${name} is not set (run "npm run setup" for local development)`);
  return Buffer.from(value, 'base64');
}

function createFieldCipher(config: Env): FieldCipher {
  const local = config.LOCAL_DATA_KEY_B64 ? new LocalKeyProvider(Buffer.from(config.LOCAL_DATA_KEY_B64, 'base64')) : null;
  if (config.KMS_KEY_ID) {
    const kms = new KmsKeyProvider(new KMSClient({ region: config.AWS_REGION }), config.KMS_KEY_ID);
    // Outside production a local key may still be configured to read data written before KMS was turned on.
    return new FieldCipher(kms, local ? [local] : []);
  }
  if (!local) throw new Error('KMS_KEY_ID or LOCAL_DATA_KEY_B64 must be set (run "npm run setup" for local development)');
  return new FieldCipher(local);
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
