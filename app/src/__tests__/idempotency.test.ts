// Idempotency keys for create / pay: the same key for every retry of one attempt, a new one for a new attempt.
import { ApiError } from '../services/api';
import { idempotencyKeys, outcomeUnknown } from '../state/idempotency';

function counter() {
  let n = 0;
  return () => `k${++n}`;
}

describe('idempotency keys', () => {
  it('reuses the key while the input is the same and the outcome is not known', () => {
    const keys = idempotencyKeys(counter());
    const input = JSON.stringify({ serviceId: 'plumb-tap', time: 'INSTANT' });
    expect(keys.keyFor(input)).toBe('k1');
    expect(keys.keyFor(input)).toBe('k1'); // retry after a time-out
  });

  it('makes a new key when the input changes or the backend has answered', () => {
    const keys = idempotencyKeys(counter());
    expect(keys.keyFor('A')).toBe('k1');
    expect(keys.keyFor('B')).toBe('k2'); // a different service, address, time or method
    keys.settle(); // answered: paid, failed, or refused
    expect(keys.keyFor('B')).toBe('k3');
  });

  it('keeps the key only when the request may have gone through', () => {
    expect(outcomeUnknown(new ApiError('TIMEOUT'))).toBe(true);
    expect(outcomeUnknown(new ApiError('NETWORK'))).toBe(true);
    expect(outcomeUnknown(new ApiError('SERVER_ERROR'))).toBe(true);
    expect(outcomeUnknown(new ApiError('BAD_RESPONSE'))).toBe(true);
    expect(outcomeUnknown(new ApiError('SLOT_UNAVAILABLE'))).toBe(false);
    expect(outcomeUnknown(new ApiError('CONFLICT'))).toBe(false);
    expect(outcomeUnknown(new TypeError('x'))).toBe(false);
  });
});
