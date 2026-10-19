// Chat between a customer and the assigned technician: open from assignment until the job is done, words and photos,
// unread counts, notifications without the text, and clearing only once the job is done (by either side, or by
// itself a day later).
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { ChatService } from '../src/modules/chat/chat.service';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';
import { jpegWithGps } from './media-fixtures';

const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
const HOUR = 3_600_000;

describe('chat (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  let customer: string;
  let tech: { id: string; token: string };
  let id: string;

  const customerChat = () => api().get(`/v1/bookings/${id}/chat`).set(as(customer));
  const techChat = () => api().get(`/v1/tech/jobs/${id}/chat`).set(as(tech.token));
  const fromCustomer = (body: object) => api().post(`/v1/bookings/${id}/chat`).set(as(customer)).send(body);
  const fromTech = (body: object) => api().post(`/v1/tech/jobs/${id}/chat`).set(as(tech.token)).send(body);

  async function chatPhoto(token: string): Promise<string> {
    const bytes = jpegWithGps();
    const res = await api().post('/v1/uploads/photos').set(as(token)).send({ contentType: 'image/jpeg', bytes: bytes.length, stage: 'CHAT' }).expect(200);
    t.store.upload(res.body.id, bytes, 'image/jpeg');
    return res.body.id as string;
  }

  /** Paid, offered and accepted: the technician is assigned. */
  async function assigned() {
    customer = (await signIn(t, '9876543210')).accessToken;
    const addressId = (await api().post('/v1/addresses').set(as(customer)).send(HOME).expect(201)).body.id;
    const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
    id = (await api().post('/v1/bookings').set(as(customer)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.id;
    tech = await createTechnician(t);
    await api().post('/v1/tech/availability').set(as(tech.token)).send({ online: true }).expect(200);
    // Before a technician is assigned there is no chat.
    await customerChat().expect(409);
    await t.prisma.booking.update({ where: { id }, data: { status: 'MATCHING', matchingStartedAt: new Date(t.clock.now()) } });
    await t.prisma.payment.updateMany({ where: { bookingId: id }, data: { state: 'PAID', settledAt: new Date(t.clock.now()) } });
    await t.app.get(DispatchService).offerNext(id);
    const offer = (await api().get('/v1/tech/offers/current').set(as(tech.token)).expect(200)).body;
    await api().post(`/v1/tech/offers/${offer.id}/accept`).set(as(tech.token)).expect(200);
  }

  async function finish() {
    await t.prisma.booking.update({ where: { id }, data: { status: 'COMPLETED' } });
    await t.prisma.bookingEvent.create({ data: { bookingId: id, status: 'COMPLETED', actorType: 'SYSTEM', at: new Date(t.clock.now()) } });
  }

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedCatalog(t.prisma);
    t.rateLimits.clear();
    t.clock.t = Date.UTC(2026, 9, 16, 6, 30);
    await assigned();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('carries words and photos both ways while the job is on, with unread counts', async () => {
    expect((await customerChat().expect(200)).body).toEqual({ bookingId: id, open: true, clearable: false, clearsAt: null, messages: [] });
    await fromCustomer({ text: 'Gate code is 4521, second floor' }).expect(200);
    expect((await api().get('/v1/tech/chats').set(as(tech.token)).expect(200)).body).toEqual([{ bookingId: id, code: expect.any(String), open: true, unread: 1 }]);

    expect((await techChat().expect(200)).body.messages).toEqual([{ id: expect.any(String), from: 'THEM', text: 'Gate code is 4521, second floor', photo: null, at: t.clock.now() }]);
    const asked = t.clock.now();
    t.clock.t += 60_000;
    const photo = await chatPhoto(tech.token);
    const sent = (await fromTech({ text: 'This is the part I need', photoUploadId: photo }).expect(200)).body;
    expect(sent.messages).toEqual([
      { id: expect.any(String), from: 'THEM', text: 'Gate code is 4521, second floor', photo: null, at: asked },
      { id: expect.any(String), from: 'ME', text: 'This is the part I need', photo: `https://uploads.test/v/${photo}?op=get&expires=300`, at: t.clock.now() },
    ]);
    // Reading the chat marks it read.
    expect((await api().get('/v1/tech/chats').set(as(tech.token)).expect(200)).body[0].unread).toBe(0);
    expect((await api().get('/v1/chats').set(as(customer)).expect(200)).body[0].unread).toBe(1);
    expect((await customerChat().expect(200)).body.messages.map((m: { from: string }) => m.from)).toEqual(['ME', 'THEM']);
    expect((await api().get('/v1/chats').set(as(customer)).expect(200)).body[0].unread).toBe(0);
  });

  it('notifies the other side without the text, once every couple of minutes; stores the text encrypted', async () => {
    await fromCustomer({ text: 'Gate code is 4521' }).expect(200);
    await fromCustomer({ text: 'Ring twice' }).expect(200);
    const notes = await t.prisma.notification.findMany({ where: { userId: tech.id, kind: 'CHAT_MESSAGE' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.params).toEqual({ code: expect.any(String), from: 'CUSTOMER' });
    const raw = await t.prisma.chatMessage.findMany();
    expect(Buffer.concat(raw.map((m) => Buffer.from(m.bodyEnc))).toString('latin1')).not.toContain('4521');
  });

  it('refuses empty messages, strangers, and anything after the job; clears only once it is done', async () => {
    await fromCustomer({ text: '   ' }).expect(422);
    const stranger = (await signIn(t, '9876543211')).accessToken;
    await api().get(`/v1/bookings/${id}/chat`).set(as(stranger)).expect(404);
    await fromCustomer({ text: 'See you soon' }).expect(200);
    await api().delete(`/v1/bookings/${id}/chat`).set(as(customer)).expect(409);
    await api().delete(`/v1/tech/jobs/${id}/chat`).set(as(tech.token)).expect(409);

    await finish();
    await fromTech({ text: 'Thanks!' }).expect(409);
    const done = (await customerChat().expect(200)).body;
    expect(done).toMatchObject({ open: false, clearable: true, clearsAt: t.clock.now() + 24 * HOUR });
    await api().delete(`/v1/tech/jobs/${id}/chat`).set(as(tech.token)).expect(204);
    expect((await customerChat().expect(200)).body.messages).toEqual([]);
    expect(await t.prisma.notification.count({ where: { kind: 'CHAT_MESSAGE' } })).toBe(0);
  });

  it('clears itself a day after the job is done, photos too', async () => {
    const photo = await chatPhoto(customer);
    await fromCustomer({ text: 'The leak', photoUploadId: photo }).expect(200);
    await finish();
    t.clock.t += 23 * HOUR;
    expect(await t.app.get(ChatService).sweep()).toBe(0);
    t.clock.t += 2 * HOUR;
    expect(await t.app.get(ChatService).sweep()).toBe(1);
    expect(await t.prisma.chatMessage.count()).toBe(0);
    expect(await t.prisma.upload.count({ where: { id: photo } })).toBe(0);
  });
});
