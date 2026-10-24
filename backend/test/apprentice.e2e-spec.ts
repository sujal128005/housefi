// Apprentice mode end to end: who may learn and teach, asking and accepting a mentor, a trainee on a job only with
// the customer's consent (and "not today"), the apprentice share after the mentor confirms, and the Fair-pay meter.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { FieldCipher } from '../src/common/crypto/field-cipher';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';

const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
const QUOTE = { which: 'MAIN', diagnosis: 'Worn-out washer and a loose joint under the sink.', lines: [{ kind: 'LABOUR', name: 'Repair labour', qty: 1, unitPrice: 120 }, { kind: 'MATERIAL', name: 'Washer and sealant', qty: 1, unitPrice: 200 }] };
const MENTOR_PHONE = '9876500011';
const APPRENTICE_PHONE = '9876500012';
const OTHER_PHONE = '9876500013';

describe('apprentice mode (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  let customer: string;
  let addressId: string;
  let mentor: { id: string; token: string };
  let apprentice: { id: string; token: string };

  const overview = async (who: { token: string }) => (await api().get('/v1/tech/apprentice').set(as(who.token)).expect(200)).body;

  /** An apprentice: identity checked (Aadhaar, photo, Technician ID), plumbing not passed yet, not approved for jobs. */
  async function makeApprentice(phone: string) {
    const a = await createTechnician(t, phone, { approve: false, profile: { name: 'Ravi Kumar', gender: 'M', skills: ['PLUMBING'] } });
    await t.prisma.technician.update({
      where: { userId: a.id },
      data: { photoStatus: 'APPROVED', aadhaarVerifiedAt: new Date(t.clock.now()), aadhaarNameMatch: true, aadhaarGenderMatch: true, skillLevel: 'UNSKILLED' },
    });
    await t.prisma.technicianSkill.updateMany({ where: { technicianId: a.id }, data: { verifiedAt: null, verifiedVia: null } });
    return a;
  }

  /** A paid booking offered to and accepted by the mentor. */
  async function assigned(allowTrainee: boolean): Promise<string> {
    const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false, allowTrainee };
    const id = (await api().post('/v1/bookings').set(as(customer)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.id as string;
    await t.prisma.booking.update({ where: { id }, data: { status: 'MATCHING', matchingStartedAt: new Date(t.clock.now()) } });
    await t.prisma.payment.updateMany({ where: { bookingId: id }, data: { state: 'PAID', settledAt: new Date(t.clock.now()) } });
    await t.app.get(DispatchService).offerNext(id);
    const offer = (await api().get('/v1/tech/offers/current').set(as(mentor.token)).expect(200)).body;
    await api().post(`/v1/tech/offers/${offer.id}/accept`).set(as(mentor.token)).expect(200);
    return id;
  }

  const act = (id: string, action: string, body: object = {}) => api().post(`/v1/tech/jobs/${id}/${action}`).set(as(mentor.token)).send(body);

  async function completedInCash(id: string) {
    await act(id, 'start-trip').expect(200);
    await act(id, 'arrived').expect(200);
    const code = await t.app.get(FieldCipher).decrypt('bookings.arrival_code', (await t.prisma.booking.findUniqueOrThrow({ where: { id } })).arrivalCodeEnc);
    await act(id, 'verify-start-code', { code }).expect(200);
    await act(id, 'quotes', QUOTE).expect(200);
    await api().post(`/v1/bookings/${id}/quotes/MAIN/answer`).set(as(customer)).send({ answer: 'APPROVE' }).expect(200);
    await act(id, 'start-work').expect(200);
    await act(id, 'complete').expect(200);
    await api().post(`/v1/bookings/${id}/payments`).set(as(customer)).set('Idempotency-Key', randomUUID()).send({ kind: 'FINAL', method: 'CASH' }).expect(200);
    await act(id, 'confirm-cash').expect(200);
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
    customer = (await signIn(t, '9876543210')).accessToken;
    addressId = (await api().post('/v1/addresses').set(as(customer)).send(HOME).expect(201)).body.id;
    mentor = await createTechnician(t, MENTOR_PHONE);
    await t.prisma.technician.update({ where: { userId: mentor.id }, data: { skillLevel: 'SKILLED' } });
    await api().post('/v1/tech/availability').set(as(mentor.token)).send({ online: true }).expect(200);
    await t.prisma.$executeRaw`UPDATE technicians SET last_location = ST_SetSRID(ST_MakePoint(78.449, 17.4135), 4326)::geography WHERE user_id = ${mentor.id}::uuid`;
    apprentice = await makeApprentice(APPRENTICE_PHONE);
  });

  afterAll(async () => {
    await t?.close();
  });

  it('pairs an apprentice with a mentor who offers to teach, and shares phones only once accepted', async () => {
    // Not open to teaching yet: not listed.
    expect((await api().get('/v1/tech/apprentice/mentors?categoryId=PLUMBING').set(as(apprentice.token)).expect(200)).body).toEqual([]);
    const m = await api().put('/v1/tech/apprentice/mentoring').set(as(mentor.token)).send({ open: true }).expect(200);
    expect(m.body.mentor).toMatchObject({ trades: ['PLUMBING', 'CLEANING'], open: true, max: 2, requests: [], apprentices: [] });
    // An apprentice cannot offer to teach.
    await api().put('/v1/tech/apprentice/mentoring').set(as(apprentice.token)).send({ open: true }).expect(409);

    const me = await overview(apprentice);
    expect(me).toMatchObject({ shareRupees: 100, jobsTarget: 5, learner: { eligible: true, block: null, trades: ['PLUMBING'], link: null, helped: [], jobs: [] } });
    const mentors = (await api().get('/v1/tech/apprentice/mentors?categoryId=PLUMBING').set(as(apprentice.token)).expect(200)).body;
    expect(mentors).toEqual([{ id: mentor.id, name: 'Swathi N.', gender: 'F', photo: expect.any(String), techCode: expect.any(String), rating: null, jobsDone: 0, level: 'SKILLED', phone: null }]);

    // Only trades not passed yet, and one open request at a time.
    await api().post('/v1/tech/apprentice/requests').set(as(apprentice.token)).send({ mentorId: mentor.id, categoryId: 'CLEANING' }).expect(422);
    const asked = (await api().post('/v1/tech/apprentice/requests').set(as(apprentice.token)).send({ mentorId: mentor.id, categoryId: 'PLUMBING' }).expect(200)).body;
    expect(asked.learner.link).toMatchObject({ categoryId: 'PLUMBING', state: 'REQUESTED', other: { id: mentor.id, phone: null } });
    await api().post('/v1/tech/apprentice/requests').set(as(apprentice.token)).send({ mentorId: mentor.id, categoryId: 'PLUMBING' }).expect(409);

    const request = (await overview(mentor)).mentor.requests[0];
    expect(request).toMatchObject({ state: 'REQUESTED', other: { id: apprentice.id, name: 'Ravi K.', level: 'UNSKILLED', phone: null } });
    // Someone else cannot answer it.
    const other = await createTechnician(t, OTHER_PHONE);
    await api().post(`/v1/tech/apprentice/requests/${request.id}/answer`).set(as(other.token)).send({ accept: true }).expect(404);
    const accepted = (await api().post(`/v1/tech/apprentice/requests/${request.id}/answer`).set(as(mentor.token)).send({ accept: true }).expect(200)).body;
    expect(accepted.mentor.apprentices[0]).toMatchObject({ state: 'ACTIVE', other: { id: apprentice.id, phone: APPRENTICE_PHONE } });
    expect((await overview(apprentice)).learner.link).toMatchObject({ state: 'ACTIVE', other: { phone: MENTOR_PHONE } });

    const notices = await t.prisma.notification.findMany({ where: { kind: { in: ['APPRENTICE_REQUEST', 'APPRENTICE_ACCEPTED'] } }, orderBy: { createdAt: 'asc' } });
    expect(notices.map((n) => [n.userId, n.kind])).toEqual([[mentor.id, 'APPRENTICE_REQUEST'], [apprentice.id, 'APPRENTICE_ACCEPTED']]);
  });

  it('refuses apprentices whose identity is not checked, and mentors who do not qualify', async () => {
    await t.prisma.technician.update({ where: { userId: apprentice.id }, data: { aadhaarNameMatch: false } });
    expect((await overview(apprentice)).learner).toMatchObject({ eligible: false, block: 'IDENTITY' });
    await api().put('/v1/tech/apprentice/mentoring').set(as(mentor.token)).send({ open: true }).expect(200);
    await api().post('/v1/tech/apprentice/requests').set(as(apprentice.token)).send({ mentorId: mentor.id, categoryId: 'PLUMBING' }).expect(409);

    await t.prisma.technician.update({ where: { userId: apprentice.id }, data: { aadhaarNameMatch: true } });
    // A low rating (after 3 ratings) takes the mentor out of the list.
    await t.prisma.technician.update({ where: { userId: mentor.id }, data: { ratingAvg: 3.6, ratingCount: 5 } });
    expect((await api().get('/v1/tech/apprentice/mentors?categoryId=PLUMBING').set(as(apprentice.token)).expect(200)).body).toEqual([]);
    await api().post('/v1/tech/apprentice/requests').set(as(apprentice.token)).send({ mentorId: mentor.id, categoryId: 'PLUMBING' }).expect(404);
    expect((await overview(mentor)).mentor.trades).toEqual([]);
  });

  describe('a trainee on a job', () => {
    beforeEach(async () => {
      await api().put('/v1/tech/apprentice/mentoring').set(as(mentor.token)).send({ open: true }).expect(200);
      await api().post('/v1/tech/apprentice/requests').set(as(apprentice.token)).send({ mentorId: mentor.id, categoryId: 'PLUMBING' }).expect(200);
      const linkId = (await overview(mentor)).mentor.requests[0].id;
      await api().post(`/v1/tech/apprentice/requests/${linkId}/answer`).set(as(mentor.token)).send({ accept: true }).expect(200);
    });

    it('comes only when the customer agreed, and the customer can say "not today"', async () => {
      const without = await assigned(false);
      await api().post(`/v1/tech/jobs/${without}/trainee`).set(as(mentor.token)).send({ apprenticeId: apprentice.id }).expect(409);
      await api().post(`/v1/tech/jobs/${without}/cancel`).set(as(mentor.token)).send({}).catch(() => undefined);
      await t.prisma.booking.update({ where: { id: without }, data: { status: 'CANCELLED' } });

      const id = await assigned(true);
      const job = (await api().post(`/v1/tech/jobs/${id}/trainee`).set(as(mentor.token)).send({ apprenticeId: apprentice.id }).expect(200)).body;
      expect(job).toMatchObject({ allowTrainee: true, trainee: { id: apprentice.id, name: 'Ravi K.', techCode: expect.any(String), helped: null } });
      const booking = (await api().get(`/v1/bookings/${id}`).set(as(customer)).expect(200)).body;
      expect(booking).toMatchObject({ allowTrainee: true, trainee: { name: 'Ravi K.', gender: 'M' } });
      expect(JSON.stringify(booking.trainee)).not.toMatch(/Kumar|9876500012/);
      // The apprentice sees where and when, and the mentor's number.
      const mine = (await overview(apprentice)).learner.jobs;
      expect(mine).toEqual([expect.objectContaining({ id, status: 'ASSIGNED', address: expect.objectContaining({ street: HOME.street }), mentor: { name: 'Swathi N.', phone: MENTOR_PHONE }, helped: null, earning: 0 })]);
      expect((await t.prisma.notification.findFirst({ where: { userId: apprentice.id, kind: 'TRAINEE_JOB' } }))?.bookingId).toBe(id);

      // Someone else's apprentice, or another technician's job: not found.
      const stranger = await makeApprentice(OTHER_PHONE);
      await api().delete(`/v1/tech/jobs/${id}/trainee`).set(as(stranger.token)).expect(404);

      const declined = (await api().post(`/v1/bookings/${id}/trainee/decline`).set(as(customer)).expect(200)).body;
      expect(declined).toMatchObject({ allowTrainee: false, trainee: null });
      expect((await overview(apprentice)).learner.jobs).toEqual([]);
      expect(await t.prisma.notification.count({ where: { userId: apprentice.id, kind: 'TRAINEE_REMOVED' } })).toBe(1);
      await api().post(`/v1/tech/jobs/${id}/trainee`).set(as(mentor.token)).send({ apprenticeId: apprentice.id }).expect(409);
    });

    it('pays the apprentice ₹100 from Housefi once the mentor says they helped', async () => {
      const id = await assigned(true);
      await api().post(`/v1/tech/jobs/${id}/trainee`).set(as(mentor.token)).send({ apprenticeId: apprentice.id }).expect(200);
      await api().post(`/v1/tech/jobs/${id}/trainee/confirm`).set(as(mentor.token)).send({ helped: true }).expect(409);
      await completedInCash(id);
      // Not added or removed after arriving.
      await api().delete(`/v1/tech/jobs/${id}/trainee`).set(as(mentor.token)).expect(409);

      // ₹369 in all: technician ₹126, parts ₹200, trainee ₹100 and Housefi ₹-57, the same for both sides.
      const split = { total: 369, technician: 126, parts: 200, housefi: -57, trainee: 100, coupon: 0, labourSharePercent: 80, withBill: true };
      expect((await api().get(`/v1/bookings/${id}`).set(as(customer)).expect(200)).body.fairPay).toEqual(split);

      const job = (await api().post(`/v1/tech/jobs/${id}/trainee/confirm`).set(as(mentor.token)).send({ helped: true }).expect(200)).body;
      expect(job.trainee.helped).toBe(true);
      expect(job.fairPay).toEqual(split);
      await api().post(`/v1/tech/jobs/${id}/trainee/confirm`).set(as(mentor.token)).send({ helped: false }).expect(409);

      const ledger = await t.prisma.earningsLedger.findMany({ where: { technicianId: apprentice.id } });
      expect(ledger.map((l) => [l.type, Number(l.amountPaise), l.bookingId])).toEqual([['APPRENTICE_SHARE', 10000, id]]);
      // The mentor's earnings are unchanged by the trainee.
      expect((await api().get('/v1/tech/earnings').set(as(mentor.token)).expect(200)).body.total).toBe(326);
      expect((await api().get('/v1/tech/earnings').set(as(apprentice.token)).expect(200)).body).toMatchObject({ total: 100, entries: [{ jobId: id, amount: 100 }] });
      expect((await overview(apprentice)).learner).toMatchObject({ helped: [{ categoryId: 'PLUMBING', jobs: 1 }], jobs: [expect.objectContaining({ id, helped: true, earning: 100 })] });
    });

    it('pays nothing when the mentor says the trainee did not help', async () => {
      const id = await assigned(true);
      await api().post(`/v1/tech/jobs/${id}/trainee`).set(as(mentor.token)).send({ apprenticeId: apprentice.id }).expect(200);
      await completedInCash(id);
      const job = (await api().post(`/v1/tech/jobs/${id}/trainee/confirm`).set(as(mentor.token)).send({ helped: false }).expect(200)).body;
      expect(job.fairPay).toMatchObject({ trainee: 0, housefi: 43 });
      expect(await t.prisma.earningsLedger.count({ where: { technicianId: apprentice.id } })).toBe(0);
    });

    it('ending the apprenticeship takes the apprentice off upcoming jobs', async () => {
      const id = await assigned(true);
      await api().post(`/v1/tech/jobs/${id}/trainee`).set(as(mentor.token)).send({ apprenticeId: apprentice.id }).expect(200);
      const linkId = (await overview(apprentice)).learner.link.id;
      const after = (await api().post(`/v1/tech/apprentice/links/${linkId}/end`).set(as(apprentice.token)).expect(200)).body;
      expect(after.learner.link.state).toBe('ENDED');
      expect((await api().get(`/v1/tech/jobs/${id}`).set(as(mentor.token)).expect(200)).body.trainee).toBeNull();
      await api().post(`/v1/tech/jobs/${id}/trainee`).set(as(mentor.token)).send({ apprenticeId: apprentice.id }).expect(404);
      // Free to ask again.
      await api().post('/v1/tech/apprentice/requests').set(as(apprentice.token)).send({ mentorId: mentor.id, categoryId: 'PLUMBING' }).expect(200);
    });
  });
});
