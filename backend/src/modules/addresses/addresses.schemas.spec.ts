import { AppError } from '../../common/errors/app-error';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AddressInput, deriveLocality } from './addresses.schemas';

describe('deriveLocality', () => {
  it.each([
    ['Road No. 12, Banjara Hills', 'Hyderabad', 'Banjara Hills'],
    ['Plot 7, Jubilee Hills ', 'Hyderabad', 'Jubilee Hills'],
    ['MG Road', 'Hyderabad', 'Hyderabad'],
    ['Street 4, Hyderabad', 'Hyderabad', 'Hyderabad'],
    ['Lane 3, 4-1-22', 'Hyderabad', 'Hyderabad'],
    ['రోడ్ నం. 12, బంజారా హిల్స్', 'హైదరాబాద్', 'బంజారా హిల్స్'],
  ])('%s -> %s', (street, city, expected) => {
    expect(deriveLocality(street, city)).toBe(expected);
  });
});

describe('AddressInput', () => {
  const valid = { label: 'HOME', house: 'Flat 4B', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034' };
  const fields = (input: unknown) => {
    try {
      new ZodValidationPipe(AddressInput).transform(input);
      return null;
    } catch (e) {
      return (e as AppError).details.fields;
    }
  };

  it('accepts the app payload, with or without a GPS point', () => {
    expect(fields(valid)).toBeNull();
    expect(fields({ ...valid, lat: 17.4126, lng: 78.4482 })).toBeNull();
  });

  it('needs lat and lng together', () => {
    expect(fields({ ...valid, lat: 17.4 })).toEqual({ lng: 'REQUIRED' });
    expect(fields({ ...valid, lng: 78.4 })).toEqual({ lat: 'REQUIRED' });
  });

  it('applies the README limits', () => {
    expect(fields({ ...valid, house: ' ', street: 'ab', pincode: '012345', city: 'x'.repeat(61), landmark: 'x'.repeat(121), lat: 91, lng: 0 })).toEqual({
      house: 'REQUIRED', street: 'INVALID', pincode: 'INVALID', city: 'INVALID', landmark: 'INVALID', lat: 'INVALID',
    });
  });
});
