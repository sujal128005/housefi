// node --test --experimental-strip-types src/arcade.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { E, flow, levelScore, levelSpec, makeBoard, N, rotate, S, seeded, W } from './arcade-logic.ts';

test('turns tiles a quarter at a time, both ways', () => {
  assert.equal(rotate(N), E);
  assert.equal(rotate(N | E), E | S);
  assert.equal(rotate(W), N);
  assert.equal(rotate(N | S, 3), E | W);
  assert.equal(rotate(N | E, -1), W | N);
  assert.equal(rotate(rotate(N | E | S), -1), N | E | S);
});

test('every board can be solved by turning tiles: each tile is a turn of its solved form', () => {
  for (let level = 1; level <= 8; level++) {
    const spec = levelSpec(level);
    for (let seed = 1; seed <= 25; seed++) {
      const b = makeBoard(spec.rows, spec.cols, seeded(seed * 31 + level));
      assert.equal(b.tiles.length, spec.rows * spec.cols);
      assert.ok(b.tiles.every((t) => t > 0 && t < 16));
      assert.ok(flow({ ...b, tiles: b.solution }).solved, `level ${level} seed ${seed}: the solved form works`);
      assert.ok(b.tiles.every((t, k) => [0, 1, 2, 3].some((n) => rotate(t, n) === b.solution[k])), `level ${level} seed ${seed}: reachable by turns`);
    }
  }
});

test('water flows only through matching openings, and reaches the tap', () => {
  // 1 row, 2 columns: main on the left, tap on the right.
  const solved = { rows: 1, cols: 2, source: 0, drain: 0, tiles: [E | W, E | W] };
  assert.deepEqual([...flow(solved).wet].sort(), [0, 1]);
  assert.equal(flow(solved).solved, true);
  const blocked = { ...solved, tiles: [E | W, N | S] };
  assert.equal(flow(blocked).solved, false);
  assert.deepEqual([...flow(blocked).wet], [0]);
  const dry = { ...solved, tiles: [N | S, E | W] };
  assert.equal(flow(dry).wet.size, 0);
});

test('levels get bigger and faster; scores reward speed and few turns', () => {
  assert.ok(levelSpec(5).cols > levelSpec(1).cols);
  assert.ok(levelSpec(5).seconds < levelSpec(1).seconds);
  assert.ok(levelSpec(50).seconds >= 25);
  assert.ok(levelScore(2, 20, 5, 30) > levelScore(2, 10, 5, 30));
  assert.ok(levelScore(2, 20, 5, 30) > levelScore(2, 20, 25, 30));
  assert.equal(levelScore(1, 0, 100, 10), 100);
});
