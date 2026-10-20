// node --test --experimental-strip-types src/*.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ago, isSmallOrMobile, qs, rupees, statusTone, timeLeft } from './api.ts';

const LAPTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';

test('opens only on laptops and big screens', () => {
  assert.equal(isSmallOrMobile(LAPTOP, 1440), false);
  assert.equal(isSmallOrMobile(LAPTOP, 900), true);
  assert.equal(isSmallOrMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148', 1440), true);
  assert.equal(isSmallOrMobile('Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile', 1440), true);
});

test('writes rupees the Indian way and waiting times plainly', () => {
  assert.equal(rupees(125000), '₹1,25,000');
  assert.equal(rupees(49), '₹49');
  assert.equal(timeLeft(0), 'now');
  assert.equal(timeLeft(135 * 60_000), 'in 2 h 15 min');
  assert.equal(timeLeft(5 * 60_000), 'in 5 min');
});

test('builds queries, ages and status colours for the lists', () => {
  assert.equal(qs({ status: 'ACTIVE', search: '', page: 0 }), '?status=ACTIVE&page=0');
  assert.equal(qs({}), '');
  const now = Date.UTC(2026, 9, 20, 12);
  assert.equal(ago(now - 20_000, now), 'just now');
  assert.equal(ago(now - 5 * 60_000, now), '5 min ago');
  assert.equal(ago(now - 3 * 3_600_000, now), '3 h ago');
  assert.equal(ago(now - 3 * 86_400_000, now), '3 d ago');
  assert.equal(statusTone('MATCHING'), 'wait');
  assert.equal(statusTone('EN_ROUTE'), 'live');
  assert.equal(statusTone('COMPLETED'), 'done');
  assert.equal(statusTone('CANCELLED'), 'stop');
});
