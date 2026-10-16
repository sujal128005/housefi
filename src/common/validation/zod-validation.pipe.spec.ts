import { z } from 'zod';
import { AppError } from '../errors/app-error';
import { ZodValidationPipe } from './zod-validation.pipe';

// A slice of openapi.yaml AddressInput.
const AddressInput = z.object({
  label: z.enum(['HOME', 'WORK', 'OTHER']),
  house: z.string().trim().min(2).max(120),
  street: z.string().trim().min(3).max(160),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/),
  geo: z.object({ lat: z.number().min(-90).max(90), lng: z.number() }).optional(),
});

function fieldsFor(input: unknown): unknown {
  try {
    new ZodValidationPipe(AddressInput).transform(input);
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe('VALIDATION');
    return (e as AppError).details.fields;
  }
  throw new Error('expected a validation error');
}

describe('ZodValidationPipe', () => {
  it('returns the parsed value', () => {
    const ok = new ZodValidationPipe(AddressInput).transform({ label: 'HOME', house: ' 4B ', street: 'Road 12', pincode: '500034', extra: 1 });
    expect(ok).toEqual({ label: 'HOME', house: '4B', street: 'Road 12', pincode: '500034' });
  });

  it('reports missing fields as REQUIRED and wrong ones as INVALID, with dotted paths', () => {
    expect(fieldsFor({ label: 'CASTLE', house: '', pincode: '012345', geo: { lat: 200, lng: 78 } })).toEqual({
      label: 'INVALID',
      house: 'REQUIRED',
      street: 'REQUIRED',
      pincode: 'INVALID',
      'geo.lat': 'INVALID',
    });
  });

  it('rejects a body that is not an object without field details', () => {
    expect(fieldsFor('nope')).toEqual({});
  });
});
