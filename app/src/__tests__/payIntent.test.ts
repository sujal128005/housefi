import { hasPayIntent, markPayIntent, takePayIntent } from '../state/payIntent';

describe('pay straight away only from inside the app', () => {
  it('needs a mark from Confirm & pay, usable once', () => {
    expect(takePayIntent('bkg_link')).toBe(false); // a link alone cannot start a payment
    markPayIntent('bkg_1', 1_000);
    expect(takePayIntent('bkg_1', 2_000)).toBe(true);
    expect(takePayIntent('bkg_1', 2_100)).toBe(false); // used up
  });

  it('can be checked without using it up (the screen may open twice); taking it still works once', () => {
    markPayIntent('bkg_4', 0);
    expect(hasPayIntent('bkg_4', 10)).toBe(true);
    expect(hasPayIntent('bkg_4', 20)).toBe(true);
    expect(takePayIntent('bkg_4', 30)).toBe(true);
    expect(hasPayIntent('bkg_4', 40)).toBe(false);
    expect(hasPayIntent('bkg_link')).toBe(false);
  });

  it('expires after a minute and is per booking', () => {
    markPayIntent('bkg_2', 0);
    expect(takePayIntent('bkg_3', 1)).toBe(false);
    expect(takePayIntent('bkg_2', 61_000)).toBe(false);
    expect(takePayIntent(undefined)).toBe(false);
  });
});
