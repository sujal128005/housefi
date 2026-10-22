// The technician's service area: typing to filter the long lists, the PIN code rule, and the profile saved with it.
import { filterByText } from '../domain/search';
import { createMockBackend, memoryStore } from '../services/mock/MockBackend';
import { allowedPincodes } from '../domain/serviceArea';

const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Chhattisgarh', 'Delhi', 'Himachal Pradesh', 'Jammu and Kashmir', 'Telangana', 'The Dadra and Nagar Haveli and Daman and Diu'];
const same = (x: string) => x;

describe('typing to filter a list', () => {
  it('"Hi" finds Delhi and Himachal Pradesh, "Him" only Himachal', () => {
    expect(filterByText(STATES, 'Hi', same)).toEqual(['Himachal Pradesh', 'Delhi']);
    expect(filterByText(STATES, 'Him', same)).toEqual(['Himachal Pradesh']);
    expect(filterByText(STATES, 'him', same)).toEqual(['Himachal Pradesh']);
  });

  it('puts names that start with the text first, then a word that starts with it, then the rest', () => {
    expect(filterByText(['Kukatpally', 'Old Kukatpally', 'Moosapet Kukat'], 'kukat', same)).toEqual(['Kukatpally', 'Old Kukatpally', 'Moosapet Kukat']);
    expect(filterByText(STATES, 'pradesh', same)).toEqual(['Andhra Pradesh', 'Himachal Pradesh']);
  });

  it('ignores dots and extra spaces, and shows everything for no text', () => {
    expect(filterByText(['A.Gs Office', 'Banjara Hills'], 'ags', same)).toEqual(['A.Gs Office']);
    expect(filterByText(['Banjara Hills'], '  banjara   hills ', same)).toEqual(['Banjara Hills']);
    expect(filterByText(STATES, '  ', same)).toHaveLength(STATES.length);
    expect(filterByText(STATES, 'xyz', same)).toEqual([]);
  });
});

describe('the PIN code rule', () => {
  const HYDERABAD = [{ name: 'Banjara Hills', pincodes: ['500034'] }, { name: 'Jubilee Hills', pincodes: ['500033'] }, { name: 'Cyberabad', pincodes: ['500081'] }];

  it('allows the PIN codes of the chosen localities only', () => {
    expect([...allowedPincodes(HYDERABAD, ['Banjara Hills', 'jubilee hills'])].sort()).toEqual(['500033', '500034']);
  });

  it('allows any PIN code of the district once a locality is typed in by hand', () => {
    expect(allowedPincodes(HYDERABAD, ['Madhapur']).has('500081')).toBe(true);
    expect(allowedPincodes(HYDERABAD, ['Madhapur']).has('500072')).toBe(false);
  });
});

describe('profile with a service area (test double)', () => {
  const PROFILE = { name: 'Swathi Naidu', gender: 'F' as const, experienceYears: 5, skills: ['PLUMBING' as const], vehicle: '', photo: 'demo:tech_woman' };

  async function techToken() {
    const backend = createMockBackend({ store: memoryStore(), now: () => Date.UTC(2026, 9, 25), latency: [0, 0], pollMs: 10_000 });
    const ch = await backend.tech.auth.requestOtp('9876500041');
    return { backend, token: (await backend.tech.auth.verifyOtp(ch.challengeId, ch.demoCode ?? '')).session.token };
  }

  it('saves state, district and localities, and fills city and areas from them', async () => {
    const { backend, token } = await techToken();
    const p = await backend.tech.submitProfile(token, { ...PROFILE, state: 'Telangana', district: 'Hyderabad', localities: ['Banjara Hills', 'Jubilee Hills'], pincode: '500033' });
    expect(p).toMatchObject({ state: 'Telangana', district: 'Hyderabad', localities: ['Banjara Hills', 'Jubilee Hills'], city: 'Hyderabad', areas: 'Banjara Hills, Jubilee Hills', pincode: '500033' });
  });

  it('refuses a PIN code from outside the chosen localities', async () => {
    const { backend, token } = await techToken();
    await expect(backend.tech.submitProfile(token, { ...PROFILE, state: 'Telangana', district: 'Hyderabad', localities: ['Banjara Hills'], pincode: '500072' }))
      .rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('lists places and finds the one for a position', async () => {
    const { backend } = await techToken();
    expect(filterByText(await backend.places.states(), 'hi', same)).toEqual(['Himachal Pradesh', 'Delhi']);
    expect(await backend.places.districts('telangana')).toContain('Medchal Malkajgiri');
    await expect(backend.places.districts('Atlantis')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await backend.places.near(17.485, 78.414, '500072')).toMatchObject({ district: 'Medchal Malkajgiri', locality: 'Kukatpally', pincode: '500072' });
    expect(await backend.catalog.greeting()).toMatchObject({ theme: 'lights', categoryId: 'CLEANING' });
  });
});
