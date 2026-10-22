// Places (India Post's All India Pincode Directory) for address forms, the technician's service area checked against
// it, and the festive greeting for the home screens.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FESTIVALS, festivalAt } from '../src/modules/catalog/festivals';
import { buildTestApp, requireTestDatabase, resetDatabase, signIn, TECH_PROFILE, type TestApp, uploadProfilePhoto } from './helpers';

const AREA = { state: 'Telangana', district: 'Hyderabad', localities: ['Banjara Hills', 'jubilee hills'], pincode: '500034' };
const { city: _city, areas: _areas, ...WITHOUT_TEXT_AREA } = TECH_PROFILE;

describe('places and greeting (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.rateLimits.clear();
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('GET /v1/places/...', () => {
    it('lists the states, then a state’s districts, without a token', async () => {
      const states = await api().get('/v1/places/states').expect(200);
      expect(states.body).toHaveLength(36);
      expect(states.body).toEqual(expect.arrayContaining(['Telangana', 'Andhra Pradesh', 'Delhi', 'Himachal Pradesh']));
      expect(states.headers['cache-control']).toBe('public, max-age=86400');
      // Any letter case finds the state.
      const districts = (await api().get('/v1/places/districts').query({ state: 'telangana' }).expect(200)).body;
      expect(districts).toHaveLength(33);
      expect(districts).toEqual(expect.arrayContaining(['Hyderabad', 'Medchal Malkajgiri', 'Ranga Reddy']));
      await api().get('/v1/places/districts').query({ state: 'Atlantis' }).expect(404);
      expect((await api().get('/v1/places/districts').expect(422)).body.error.fields).toEqual({ state: 'REQUIRED' });
    });

    it('lists a district’s localities with their PIN codes, post office endings removed', async () => {
      const res = await api().get('/v1/places/localities').query({ state: 'Telangana', district: 'hyderabad' }).expect(200);
      expect(res.body).toEqual(expect.arrayContaining([{ name: 'Banjara Hills', pincodes: ['500034'] }, { name: 'Jubilee Hills', pincodes: ['500033'] }]));
      expect(res.body.some((p: { name: string }) => /\b[BSH]\.?O\b/.test(p.name))).toBe(false);
      await api().get('/v1/places/localities').query({ state: 'Telangana', district: 'Gotham' }).expect(404);
    });

    it('finds where a PIN code is', async () => {
      expect((await api().get('/v1/places/pincodes/500034').expect(200)).body).toEqual({ pincode: '500034', places: [{ state: 'Telangana', district: 'Hyderabad', locality: 'Banjara Hills' }] });
      await api().get('/v1/places/pincodes/100000').expect(404);
      await api().get('/v1/places/pincodes/abc').expect(404);
    });

    it('fills the form from the phone’s position, trusting the phone’s PIN code and place names first', async () => {
      // India Post puts Kukatpally's post office kilometres away: the phone's PIN and area name decide.
      const kukatpally = (await api().get('/v1/places/near').query({ lat: 17.4849, lng: 78.4138, pincode: '500072', area: 'Kukatpally, Hyderabad' }).expect(200)).body;
      expect(kukatpally).toMatchObject({ state: 'Telangana', district: 'Medchal Malkajgiri', locality: 'Kukatpally', pincode: '500072' });
      // Only a position: the nearest locality India Post has a position for.
      const banjara = (await api().get('/v1/places/near').query({ lat: 17.4172, lng: 78.4359 }).expect(200)).body;
      expect(banjara).toMatchObject({ state: 'Telangana', district: 'Hyderabad', locality: 'Banjara Hills', pincode: '500034', distanceKm: 0 });
      expect((await api().get('/v1/places/near').query({ lat: 17.4172, lng: 78.4359 })).headers['cache-control']).toBe('no-store');
      // The middle of the Bay of Bengal.
      await api().get('/v1/places/near').query({ lat: 15, lng: 88 }).expect(404);
      await api().get('/v1/places/near').query({ lat: 'x', lng: 78 }).expect(422);
    });
  });

  describe('technician service area from the directory', () => {
    const register = async () => {
      const auth = await signIn(t, '9876500031', 'TECHNICIAN');
      return { token: auth.accessToken, photoUploadId: await uploadProfilePhoto(t, auth.accessToken) };
    };

    it('saves state, district and localities as the directory writes them, and fills city and areas from them', async () => {
      const { token, photoUploadId } = await register();
      const res = await api().put('/v1/tech/profile').set(as(token)).send({ ...WITHOUT_TEXT_AREA, ...AREA, photoUploadId }).expect(200);
      expect(res.body).toMatchObject({ state: 'Telangana', district: 'Hyderabad', localities: ['Banjara Hills', 'Jubilee Hills'], city: 'Hyderabad', areas: 'Banjara Hills, Jubilee Hills', pincode: '500034' });
      expect((await api().get('/v1/tech/me').set(as(token)).expect(200)).body).toMatchObject({ localities: ['Banjara Hills', 'Jubilee Hills'] });
    });

    it('refuses a PIN code that belongs to none of the chosen localities', async () => {
      const { token, photoUploadId } = await register();
      const res = await api().put('/v1/tech/profile').set(as(token)).send({ ...WITHOUT_TEXT_AREA, ...AREA, localities: ['Banjara Hills'], pincode: '500033', photoUploadId }).expect(422);
      expect(res.body.error.fields).toEqual({ pincode: 'INVALID' });
      // A PIN from another state altogether.
      await api().put('/v1/tech/profile').set(as(token)).send({ ...WITHOUT_TEXT_AREA, ...AREA, pincode: '110001', photoUploadId }).expect(422);
      expect(await t.prisma.technician.count()).toBe(0);
    });

    it('takes a locality India Post does not list when the PIN code is in the district', async () => {
      const { token, photoUploadId } = await register();
      const ok = await api().put('/v1/tech/profile').set(as(token)).send({ ...WITHOUT_TEXT_AREA, ...AREA, localities: ['Madhapur'], pincode: '500081', photoUploadId }).expect(200);
      expect(ok.body).toMatchObject({ localities: ['Madhapur'], pincode: '500081' });
      // 500072 is Kukatpally, in Medchal Malkajgiri: not in the Hyderabad district.
      const res = await api().put('/v1/tech/profile').set(as(token)).send({ ...WITHOUT_TEXT_AREA, ...AREA, localities: ['Madhapur'], pincode: '500072' }).expect(422);
      expect(res.body.error.fields).toEqual({ pincode: 'INVALID' });
    });

    it('names a state or district that does not exist, and asks for the missing parts', async () => {
      const { token, photoUploadId } = await register();
      expect((await api().put('/v1/tech/profile').set(as(token)).send({ ...WITHOUT_TEXT_AREA, ...AREA, district: 'Gotham', photoUploadId }).expect(422)).body.error.fields).toEqual({ district: 'INVALID' });
      expect((await api().put('/v1/tech/profile').set(as(token)).send({ ...WITHOUT_TEXT_AREA, ...AREA, state: 'Atlantis', photoUploadId }).expect(422)).body.error.fields).toEqual({ state: 'INVALID' });
      expect((await api().put('/v1/tech/profile').set(as(token)).send({ ...WITHOUT_TEXT_AREA, state: 'Telangana', photoUploadId }).expect(422)).body.error.fields).toEqual({ district: 'REQUIRED', localities: 'REQUIRED' });
      expect((await api().put('/v1/tech/profile').set(as(token)).send({ ...WITHOUT_TEXT_AREA, photoUploadId }).expect(422)).body.error.fields).toEqual({ city: 'REQUIRED', areas: 'REQUIRED' });
      expect((await api().put('/v1/tech/profile').set(as(token)).send({ ...WITHOUT_TEXT_AREA, ...AREA, localities: ['Banjara Hills', 'banjara hills'], photoUploadId }).expect(422)).body.error.fields).toEqual({ localities: 'INVALID' });
    });

    it('still takes city and areas as text from older apps', async () => {
      const { token, photoUploadId } = await register();
      const res = await api().put('/v1/tech/profile').set(as(token)).send({ ...TECH_PROFILE, photoUploadId }).expect(200);
      expect(res.body).toMatchObject({ city: 'Hyderabad', areas: TECH_PROFILE.areas, state: null, district: null, localities: [] });
    });
  });

  describe('GET /v1/catalog/greeting', () => {
    it('greets for the festival of the day, in both languages, and says nothing on ordinary days', async () => {
      t.clock.t = Date.parse('2026-10-25T10:00:00+05:30');
      const diwali = await api().get('/v1/catalog/greeting').expect(200);
      expect(diwali.body).toMatchObject({ id: 'diwali-2026', theme: 'lights', title: { en: 'Happy Diwali', te: expect.stringMatching(/దీపావళి/) }, categoryId: 'CLEANING' });
      expect(diwali.body.until).toBe(Date.parse('2026-11-10T23:59:59.999+05:30'));
      expect(diwali.body).not.toHaveProperty('from');

      t.clock.t = Date.parse('2026-12-01T10:00:00+05:30');
      expect((await api().get('/v1/catalog/greeting').expect(200)).body).toBeNull();
    });

    it('shows the festival coupon only once HQ has made it, and only while it can be used', async () => {
      t.clock.t = Date.parse('2026-10-25T10:00:00+05:30');
      const greeting = async () => (await api().get('/v1/catalog/greeting').expect(200)).body;
      expect((await greeting()).coupon).toBeNull();
      const now = new Date(t.clock.now());
      const until = t.clock.now() + 86_400_000;
      await t.prisma.coupon.create({ data: { code: 'DIWALI26', kind: 'PERCENT', value: 26, maxDiscountPaise: 30000n, createdBy: randomUUID(), createdAt: now, validTo: new Date(until) } });
      expect((await greeting()).coupon).toEqual({ code: 'DIWALI26', kind: 'PERCENT', value: 26, maxDiscount: 300, minBill: 0, firstBookingOnly: false, validTo: until });
      await t.prisma.coupon.update({ where: { code: 'DIWALI26' }, data: { active: false } });
      expect((await greeting()).coupon).toBeNull();
      await t.prisma.coupon.update({ where: { code: 'DIWALI26' }, data: { active: true, maxUses: 0 } });
      expect((await greeting()).coupon).toBeNull();
      await t.prisma.coupon.update({ where: { code: 'DIWALI26' }, data: { maxUses: null, validTo: new Date(t.clock.now() - 1) } });
      expect((await greeting()).coupon).toBeNull();
    });

    it('uses India time: just after midnight on the first day counts', () => {
      expect(festivalAt(Date.parse('2026-10-23T00:05:00+05:30'))?.id).toBe('diwali-2026');
      expect(festivalAt(Date.parse('2026-10-22T23:55:00+05:30'))).toBeNull();
    });

    it('keeps the calendar tidy: dates in order, no overlaps, Telugu written in Telugu', () => {
      const sorted = [...FESTIVALS].sort((a, b) => a.from.localeCompare(b.from));
      expect(sorted.map((f) => f.id)).toEqual(FESTIVALS.map((f) => f.id));
      sorted.forEach((f, i) => {
        expect(f.from <= f.to).toBe(true);
        if (i > 0) expect(sorted[i - 1]!.to < f.from).toBe(true);
        for (const text of [f.title, f.body, f.techBody, ...(f.cta ? [f.cta] : [])]) expect(text.te).toMatch(/[\u0C00-\u0C7F]/);
        expect(f.cta === null).toBe(f.categoryId === null);
        if (f.coupon) expect(f.coupon).toMatch(/^[A-Z0-9]{4,20}$/);
      });
    });
  });
});
