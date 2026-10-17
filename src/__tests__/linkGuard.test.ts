import { MAX_LINK_ESCAPES, safeIncomingPath } from '../domain/linkGuard';

describe('incoming links', () => {
  it('passes normal links through', () => {
    expect(safeIncomingPath('housefi://verify/AbCdEfGhIjKlMnOpQrStUvWx')).toBe('housefi://verify/AbCdEfGhIjKlMnOpQrStUvWx');
    expect(safeIncomingPath('/booking/technician?id=bkg_1')).toBe('/booking/technician?id=bkg_1');
  });

  it('sends oversized or escape-heavy links home', () => {
    expect(safeIncomingPath(`housefi://search?q=${'a'.repeat(5000)}`)).toBe('/');
    expect(safeIncomingPath(`housefi://search?q=${'%25'.repeat(MAX_LINK_ESCAPES + 1)}`)).toBe('/');
  });
});
