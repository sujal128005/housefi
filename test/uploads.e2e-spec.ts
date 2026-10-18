// Uploads end to end: signed URLs, the one-time check of each file (type, size, length, location removed), using
// photos and a voice note in a booking and in AI calls, and deleting unused files. The bucket is in memory.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';
import { adts, GPS_LATITUDE, hasBytes, jpegWithGps, m4a, pngWithGps } from './media-fixtures';

const HOUR = 60 * 60_000;
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };

describe('uploads (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  let customer: string;
  let addressId: string;

  const ticket = (kind: 'photos' | 'audio', body: object, token = customer) => api().post(`/v1/uploads/${kind}`).set(as(token)).send(body);

  /** Gets a ticket and PUTs the file (as the app would). */
  async function upload(kind: 'photos' | 'audio', bytes: Buffer, contentType: string, token = customer): Promise<string> {
    const res = await ticket(kind, { contentType, bytes: bytes.length }, token).expect(200);
    t.store.upload(res.body.id, bytes, contentType);
    return res.body.id;
  }

  function newBooking(problem: object) {
    const body = { serviceId: 'plumb-tap', problem: { issueIds: [], notes: '', voiceNote: null, photos: [], ...problem }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
    return api().post('/v1/bookings').set(as(customer)).set('Idempotency-Key', randomUUID()).send(body);
  }

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedCatalog(t.prisma);
    t.sms.sent.length = 0;
    t.rateLimits.clear();
    t.store.objects.clear();
    t.clock.t = Date.UTC(2026, 9, 16, 6, 30);
    customer = (await signIn(t, '9876543210')).accessToken;
    addressId = (await api().post('/v1/addresses').set(as(customer)).send(HOME).expect(201)).body.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('tickets', () => {
    it('hands out a 5-minute PUT URL for the exact type and size', async () => {
      const res = await ticket('photos', { contentType: 'image/jpeg', bytes: 123456 }).expect(200);
      expect(res.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), uploadUrl: `https://uploads.test/u/${res.body.id}?op=put&type=image%2Fjpeg&bytes=123456&expires=300`, expiresAt: t.clock.now() + 300_000 });
      expect(await t.prisma.upload.findUniqueOrThrow({ where: { id: res.body.id } })).toMatchObject({ kind: 'PHOTO', stage: 'PROBLEM', state: 'PENDING', bytes: 123456, bookingId: null });
      expect((await ticket('audio', { contentType: 'audio/m4a', bytes: 2048 }).expect(200)).body.uploadUrl).toContain('type=audio%2Fm4a');
    });

    it('validates type, size and stage, and who may upload what', async () => {
      await ticket('photos', { contentType: 'image/gif', bytes: 10 }).expect(422);
      await ticket('photos', { contentType: 'image/jpeg', bytes: 8 * 1024 * 1024 + 1 }).expect(422);
      await ticket('photos', { contentType: 'image/jpeg', bytes: 0 }).expect(422);
      await ticket('audio', { contentType: 'audio/m4a', bytes: 2 * 1024 * 1024 + 1 }).expect(422);
      await ticket('photos', { contentType: 'image/jpeg', bytes: 10, stage: 'INSPECTION' }).expect(422); // customers photograph the problem
      await api().post('/v1/uploads/photos').send({ contentType: 'image/jpeg', bytes: 10 }).expect(401);
      const tech = await createTechnician(t);
      expect((await ticket('photos', { contentType: 'image/png', bytes: 10 }, tech.token).expect(200)).body.id).toBeDefined();
      expect((await t.prisma.upload.findFirstOrThrow({ where: { ownerId: tech.id, stage: { not: 'PROFILE' } } })).stage).toBe('INSPECTION');
      await ticket('photos', { contentType: 'image/png', bytes: 10, stage: 'PROBLEM' }, tech.token).expect(422);
      await ticket('audio', { contentType: 'audio/m4a', bytes: 10 }, tech.token).expect(404);
    });

    it('allows 40 tickets an hour per person', async () => {
      for (let i = 0; i < 40; i++) {
        t.rateLimits.clear();
        await ticket('photos', { contentType: 'image/jpeg', bytes: 10 }).expect(200);
      }
      t.rateLimits.clear();
      expect((await ticket('photos', { contentType: 'image/jpeg', bytes: 10 }).expect(429)).body.error.code).toBe('RATE_LIMITED');
      t.clock.advance(HOUR + 1);
      customer = (await signIn(t, '9876543210')).accessToken;
      await ticket('photos', { contentType: 'image/jpeg', bytes: 10 }).expect(200);
    });
  });

  describe('in a booking', () => {
    it('checks the files, removes the photo location, and shows them with short-lived URLs', async () => {
      const photo = await upload('photos', jpegWithGps(), 'image/jpeg');
      const voice = await upload('audio', m4a(9.2), 'audio/m4a');
      const res = await newBooking({ notes: 'Tap leaking', photos: [{ id: photo }], voiceNote: { durationSec: 3, transcript: '', audioId: voice } }).expect(201);
      expect(res.body.problem).toEqual({
        issueIds: [],
        notes: 'Tap leaking',
        voiceNote: { durationSec: 10, transcript: '', audioId: voice, url: `https://uploads.test/v/${voice}?op=get&expires=300` }, // the recording's real length, not the 3 s claimed
        photos: [{ id: photo, url: `https://uploads.test/v/${photo}?op=get&expires=300` }],
      });
      expect(hasBytes(t.store.stored(photo)!, GPS_LATITUDE)).toBe(false);
      expect(await t.prisma.upload.findMany({ where: { bookingId: res.body.id }, orderBy: { kind: 'asc' } })).toEqual([
        expect.objectContaining({ id: photo, state: 'READY', verifiedAt: new Date(t.clock.now()) }),
        expect.objectContaining({ id: voice, state: 'READY', durationSec: 10 }),
      ]);

      // A file belongs to one booking for good.
      expect((await newBooking({ photos: [{ id: photo }] }).expect(422)).body.error.fields).toEqual({ 'problem.photos': 'INVALID' });

      // The technician sees the photo count on the offer, then the photos once assigned.
      await t.prisma.booking.update({ where: { id: res.body.id }, data: { status: 'MATCHING', matchingStartedAt: new Date(t.clock.now()) } });
      const tech = await createTechnician(t);
      await api().post('/v1/tech/availability').set(as(tech.token)).send({ online: true }).expect(200);
      await t.prisma.$executeRaw`UPDATE technicians SET last_location = ST_SetSRID(ST_MakePoint(78.449, 17.4135), 4326)::geography WHERE user_id = ${tech.id}::uuid`;
      await t.app.get(DispatchService).offerNext(res.body.id);
      const offer = (await api().get('/v1/tech/offers/current').set(as(tech.token)).expect(200)).body;
      expect(offer.photoCount).toBe(1);
      expect(JSON.stringify(offer)).not.toContain('uploads.test');
      const job = (await api().post(`/v1/tech/offers/${offer.id}/accept`).set(as(tech.token)).expect(200)).body;
      expect(job.problem.photos).toEqual([{ id: photo, url: expect.stringContaining(`/v/${photo}?op=get`) }]);
    });

    it('a file not uploaded yet is refused until it is there', async () => {
      const id = (await ticket('photos', { contentType: 'image/png', bytes: pngWithGps().length }).expect(200)).body.id;
      expect((await newBooking({ photos: [{ id }] }).expect(422)).body.error).toMatchObject({ code: 'VALIDATION', fields: { 'problem.photos': 'INVALID' } });
      expect((await t.prisma.upload.findUniqueOrThrow({ where: { id } })).state).toBe('PENDING');
      t.store.upload(id, pngWithGps(), 'image/png');
      await newBooking({ photos: [{ id }] }).expect(201);
    });

    it('refuses (and deletes) a file that is not what it claims, the wrong size, or a voice note over 60 s', async () => {
      const fake = await upload('photos', pngWithGps(), 'image/jpeg'); // a PNG labelled JPEG
      await newBooking({ photos: [{ id: fake }] }).expect(422);
      expect(await t.prisma.upload.findUniqueOrThrow({ where: { id: fake } })).toMatchObject({ state: 'REJECTED', rejectReason: 'not a image/jpeg file' });
      expect(t.store.stored(fake)).toBeUndefined();
      await newBooking({ photos: [{ id: fake }] }).expect(422); // stays refused

      const short = (await ticket('photos', { contentType: 'image/jpeg', bytes: 99999 }).expect(200)).body.id;
      t.store.upload(short, jpegWithGps());
      await newBooking({ photos: [{ id: short }] }).expect(422);
      expect((await t.prisma.upload.findUniqueOrThrow({ where: { id: short } })).rejectReason).toBe('size differs from the ticket');

      const long = await upload('audio', adts(2600), 'audio/aac');
      await newBooking({ voiceNote: { durationSec: 60, transcript: '', audioId: long } }).expect(422);
      expect((await t.prisma.upload.findUniqueOrThrow({ where: { id: long } })).rejectReason).toBe('longer than 60 s');
    });

    it("refuses someone else's upload, a voice note as a photo, and the same photo twice", async () => {
      const other = (await signIn(t, '9876543211')).accessToken;
      const theirs = await upload('photos', jpegWithGps(), 'image/jpeg', other);
      await newBooking({ photos: [{ id: theirs }] }).expect(404);
      const voice = await upload('audio', m4a(5), 'audio/m4a');
      await newBooking({ photos: [{ id: voice }] }).expect(422);
      const mine = await upload('photos', jpegWithGps(), 'image/jpeg');
      await newBooking({ photos: [{ id: mine }, { id: mine }] }).expect(422);
    });
  });

  describe('AI calls', () => {
    it('classify-photo and transcribe take only the caller\'s own, checked files', async () => {
      const photo = await upload('photos', jpegWithGps(), 'image/jpeg');
      expect((await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId: photo }).expect(200)).body.serviceId).toBeNull();
      expect(hasBytes(t.store.stored(photo)!, GPS_LATITUDE)).toBe(false);
      // Uploading again to the same URL after the check changes nothing that is served or sent anywhere.
      const served = Buffer.from(t.store.stored(photo)!);
      t.store.upload(photo, Buffer.alloc(served.length, 0x41), 'image/jpeg');
      await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId: photo }).expect(200);
      expect(Buffer.from(t.store.stored(photo)!).equals(served)).toBe(true);
      const voice = await upload('audio', adts(430), 'audio/aac');
      expect((await api().post('/v1/ai/transcribe').set(as(customer)).send({ audioId: voice, locale: 'te' }).expect(200)).body).toEqual({ text: '' });
      await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId: randomUUID() }).expect(404);
      await api().post('/v1/ai/transcribe').set(as(customer)).send({ audioId: photo, locale: 'en' }).expect(422);
    });
  });

  describe('clean-up', () => {
    it('deletes unused uploads after 24 h and refused ones at once; files in bookings stay', async () => {
      const used = await upload('photos', jpegWithGps(), 'image/jpeg');
      await newBooking({ photos: [{ id: used }] }).expect(201);
      await upload('photos', jpegWithGps(), 'image/jpeg'); // never used in a booking
      const refused = await upload('photos', pngWithGps(), 'image/jpeg');
      await newBooking({ photos: [{ id: refused }] }).expect(422);
      const uploads = t.app.get(UploadsService);
      expect(await uploads.sweep()).toBe(1); // the refused one
      t.clock.advance(25 * HOUR);
      expect(await uploads.sweep()).toBe(1); // the unused one
      expect((await t.prisma.upload.findMany()).map((u) => u.id)).toEqual([used]);
      expect([...t.store.objects.keys()]).toEqual([`v/${used}`]);
    });

    it('account deletion deletes every upload of the person, files included', async () => {
      const used = await upload('photos', jpegWithGps(), 'image/jpeg');
      const booking = (await newBooking({ photos: [{ id: used }] }).expect(201)).body.id;
      await upload('audio', m4a(4), 'audio/m4a');
      await api().post(`/v1/bookings/${booking}/cancel`).set(as(customer)).send({}).expect(200);
      await api().delete('/v1/me').set(as(customer)).expect(204);
      expect(await t.prisma.upload.count()).toBe(0);
      expect(t.store.objects.size).toBe(0);
    });
  });
});
