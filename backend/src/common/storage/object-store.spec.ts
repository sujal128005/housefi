import { S3ObjectStore, uploadKey } from './object-store';

// Signing is local (no network), so the real AWS SDK runs here.
const keys = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };

describe('S3 signed URLs', () => {
  it('signs a PUT that only accepts the declared type and exact size, for 5 minutes', async () => {
    const store = new S3ObjectStore('housefi-prod-uploads', { region: 'ap-south-1', ...keys });
    const url = new URL(await store.presignPut(uploadKey('11111111-1111-4111-8111-111111111111'), 'image/jpeg', 12345, 300));
    expect(url.host).toBe('housefi-prod-uploads.s3.ap-south-1.amazonaws.com');
    expect(url.pathname).toBe('/u/11111111-1111-4111-8111-111111111111');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-SignedHeaders')!.split(';')).toEqual(expect.arrayContaining(['content-length', 'content-type', 'host']));
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signs short-lived GETs, path-style against a local S3 (S3Mock)', async () => {
    const store = new S3ObjectStore('housefi-dev-uploads', { region: 'ap-south-1', endpoint: 'http://localhost:9090', ...keys });
    const url = new URL(await store.presignGet(uploadKey('abc'), 300));
    expect(`${url.origin}${url.pathname}`).toBe('http://localhost:9090/housefi-dev-uploads/u/abc');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
  });
});
