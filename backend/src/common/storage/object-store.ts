// The private uploads bucket (S3 in ap-south-1; S3Mock from docker-compose locally). The app talks to S3 directly
// with pre-signed URLs, so file bytes never pass through the API except when the server checks a file once.
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { Env } from '../../config/env';

export interface ObjectStore {
  /** A URL the app PUTs the file to. S3 refuses any other Content-Type or Content-Length than signed here. */
  presignPut(key: string, contentType: string, bytes: number, expiresInSec: number): Promise<string>;
  /** A short-lived URL to read the file (photos in responses). */
  presignGet(key: string, expiresInSec: number): Promise<string>;
  /** The file, or null when nothing was uploaded yet. Refuses files larger than `maxBytes` without reading them. */
  get(key: string, maxBytes: number): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
}

export const OBJECT_STORE = Symbol('OBJECT_STORE');

/** Object keys carry no personal data: who uploaded what is only in the database. */
export const uploadKey = (uploadId: string) => `u/${uploadId}`;
/**
 * Where a file lives once checked. Upload URLs only ever point at uploadKey, so a checked file cannot be replaced
 * (the app could otherwise PUT different bytes to the same URL until it expires). Everything reads this key.
 */
export const verifiedKey = (uploadId: string) => `v/${uploadId}`;

/** README security checklist: photo URLs in responses live 5 minutes. */
export const READ_URL_TTL_SEC = 300;

export class ObjectTooLarge extends Error {}

export class S3ObjectStore implements ObjectStore {
  private readonly s3: S3Client;

  constructor(
    private readonly bucket: string,
    opts: { region: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string },
  ) {
    this.s3 = new S3Client({
      region: opts.region,
      // S3Mock (local) serves buckets as paths; real S3 uses the default virtual-hosted style.
      ...(opts.endpoint ? { endpoint: opts.endpoint, forcePathStyle: true } : {}),
      // Without keys the SDK's default chain is used (the task's IAM role in production).
      ...(opts.accessKeyId && opts.secretAccessKey ? { credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } } : {}),
    });
  }

  presignPut(key: string, contentType: string, bytes: number, expiresInSec: number): Promise<string> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: bytes });
    return getSignedUrl(this.s3, command, { expiresIn: expiresInSec, signableHeaders: new Set(['content-type', 'content-length']) });
  }

  presignGet(key: string, expiresInSec: number): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresInSec });
  }

  async get(key: string, maxBytes: number): Promise<Uint8Array | null> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if ((res.ContentLength ?? 0) > maxBytes) {
        res.Body?.transformToWebStream().cancel().catch(() => undefined);
        throw new ObjectTooLarge(`object is ${res.ContentLength} bytes`);
      }
      return res.Body ? await res.Body.transformToByteArray() : new Uint8Array(0);
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** Signs read URLs for photos shown in Booking / Job responses. */
@Injectable()
export class MediaUrls {
  constructor(@Inject(OBJECT_STORE) private readonly store: ObjectStore) {}

  photoUrl(uploadId: string): Promise<string> {
    return this.store.presignGet(verifiedKey(uploadId), READ_URL_TTL_SEC);
  }

  /** Any checked file (a work video, a certificate), read-only for a short time. */
  fileUrl(uploadId: string): Promise<string> {
    return this.store.presignGet(verifiedKey(uploadId), READ_URL_TTL_SEC);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORE,
      inject: [APP_CONFIG],
      useFactory: (c: Env): ObjectStore =>
        new S3ObjectStore(c.S3_BUCKET_UPLOADS, { region: c.S3_REGION ?? c.AWS_REGION, endpoint: c.S3_ENDPOINT, accessKeyId: c.S3_ACCESS_KEY_ID, secretAccessKey: c.S3_SECRET_ACCESS_KEY }),
    },
    MediaUrls,
  ],
  exports: [OBJECT_STORE, MediaUrls],
})
export class StorageModule {}
