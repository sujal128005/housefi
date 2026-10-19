// Pipe Panic's rules, separate from the screen so they can be tested: a grid of pipe tiles, each with openings
// (N=1, E=2, S=4, W=8); the water main on the left edge, the customer's tap on the right. Every board is built from a
// real path first, then scrambled, so it can always be solved.

export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;
const DIRS: readonly { readonly bit: number; readonly dr: number; readonly dc: number; readonly opp: number }[] = [
  { bit: N, dr: -1, dc: 0, opp: S },
  { bit: E, dr: 0, dc: 1, opp: W },
  { bit: S, dr: 1, dc: 0, opp: N },
  { bit: W, dr: 0, dc: -1, opp: E },
];

export interface Board {
  readonly rows: number;
  readonly cols: number;
  /** Openings of each tile, row by row. */
  readonly tiles: readonly number[];
  /** The row where water enters (from the left of column 0) and where the tap is (right of the last column). */
  readonly source: number;
  readonly drain: number;
  /** The tiles before the scramble (a solved board): for tests, never shown. */
  readonly solution: readonly number[];
}

/** Turns a tile a quarter clockwise (N→E→S→W). */
export function rotate(mask: number, times = 1): number {
  let m = mask;
  for (let i = 0; i < ((times % 4) + 4) % 4; i++) m = ((m << 1) | (m >> 3)) & 15;
  return m;
}

/** A small seeded generator, so a level can be replayed in tests. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The board size and time for a level. */
export function levelSpec(level: number): { rows: number; cols: number; seconds: number } {
  const rows = Math.min(8, 4 + Math.floor((level + 1) / 2));
  const cols = Math.min(10, 5 + level);
  return { rows, cols, seconds: Math.max(25, 60 - level * 3) };
}

/** A solvable board: a random path from the main to the tap, other tiles random, then every tile turned at random. */
export function makeBoard(rows: number, cols: number, rand: () => number): Board {
  const source = Math.floor(rand() * rows);
  const drain = Math.floor(rand() * rows);
  const tiles = new Array<number>(rows * cols).fill(0);
  // A self-avoiding walk that always ends at the tap: try until one does (small boards: quick).
  for (let attempt = 0; attempt < 500; attempt++) {
    const path = walk(rows, cols, source, drain, rand);
    if (!path) continue;
    tiles.fill(0);
    for (let i = 0; i < path.length; i++) {
      const [r, c] = path[i]!;
      let m = 0;
      const prev = i === 0 ? ([r, -1] as const) : path[i - 1]!;
      const next = i === path.length - 1 ? ([r, cols] as const) : path[i + 1]!;
      for (const p of [prev, next]) {
        const d = DIRS.find((x) => x.dr === p[0] - r && x.dc === p[1] - c);
        if (d) m |= d.bit;
      }
      tiles[r * cols + c] = m;
    }
    break;
  }
  const shapes = [N | S, E | W, N | E, E | S, S | W, W | N, N | E | S, E | S | W, N | S | W, N | E | W];
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === 0) tiles[i] = shapes[Math.floor(rand() * shapes.length)]!;
  const solution = tiles.slice();
  for (let i = 0; i < tiles.length; i++) tiles[i] = rotate(tiles[i]!, Math.floor(rand() * 4));
  return { rows, cols, tiles, source, drain, solution };
}

function walk(rows: number, cols: number, source: number, drain: number, rand: () => number): [number, number][] | null {
  const seen = new Set<number>();
  const path: [number, number][] = [[source, 0]];
  seen.add(source * cols);
  for (let steps = 0; steps < rows * cols * 4; steps++) {
    const [r, c] = path[path.length - 1]!;
    if (c === cols - 1 && r === drain) return path;
    // Prefer moving right, and towards the tap's row near the end.
    const options = DIRS.map((d) => [r + d.dr, c + d.dc] as [number, number]).filter(([rr, cc]) => rr >= 0 && rr < rows && cc >= 0 && cc < cols && !seen.has(rr * cols + cc));
    if (options.length === 0) return null;
    const weighted = options.flatMap((o) => {
      const right = o[1] > c ? 3 : 1;
      const toward = c >= cols - 2 && Math.abs(o[0] - drain) < Math.abs(r - drain) ? 3 : 1;
      return Array<[number, number]>(right * toward).fill(o);
    });
    const pick = weighted[Math.floor(rand() * weighted.length)]!;
    seen.add(pick[0] * cols + pick[1]);
    path.push(pick);
  }
  return null;
}

/** Tiles the water reaches from the main, and whether it comes out at the tap. */
export function flow(b: Omit<Board, 'solution'>): { wet: Set<number>; solved: boolean } {
  const wet = new Set<number>();
  const start = b.source * b.cols;
  if (!(b.tiles[start]! & W)) return { wet, solved: false };
  const queue = [start];
  wet.add(start);
  let solved = false;
  while (queue.length) {
    const i = queue.shift()!;
    const r = Math.floor(i / b.cols);
    const c = i % b.cols;
    const m = b.tiles[i]!;
    if (c === b.cols - 1 && r === b.drain && m & E) solved = true;
    for (const d of DIRS) {
      if (!(m & d.bit)) continue;
      const rr = r + d.dr;
      const cc = c + d.dc;
      if (rr < 0 || rr >= b.rows || cc < 0 || cc >= b.cols) continue;
      const j = rr * b.cols + cc;
      if (wet.has(j) || !(b.tiles[j]! & d.opp)) continue;
      wet.add(j);
      queue.push(j);
    }
  }
  return { wet, solved };
}

/** Points for a cleared level: more for higher levels, time left, and few turns. */
export function levelScore(level: number, secondsLeft: number, turns: number, tiles: number): number {
  const efficiency = Math.max(0, tiles - turns);
  return level * 100 + Math.round(secondsLeft * 10) + efficiency * 2;
}
