// The brand water, as numbers: no React here, so it is cheap to run every frame and easy to test.
// - Surface layers: Gerstner waves (each point moves in a small circle, so crests sharpen and troughs flatten like real
//   water), three wave trains per layer, rising gently towards the right as in the logo's swoosh.
// - Mesh: a grid of points on the same kind of water seen in perspective, joined by thin lines and dotted at every
//   vertex (the "polygon point" look). Far rows sit closer together and fade, near rows are wide and bright.
// Everything is drawn in a 400-unit-wide box; `h` is the box height.

export const WAVE_W = 400;

interface Train {
  /** Amplitude (units). */
  readonly a: number;
  /** Wavelength (units). */
  readonly l: number;
  /** Speed (wavelengths per second). */
  readonly s: number;
  readonly phase: number;
  /** Steepness 0..1: how much the points swing sideways (sharper crests). */
  readonly q: number;
}

interface Layer {
  /** Height of the water at the left and right edges, as a share of the box height from the top. */
  readonly left: number;
  readonly right: number;
  readonly trains: readonly Train[];
}

const LAYERS: readonly Layer[] = [
  // back: long, slow swell
  { left: 0.5, right: 0.2, trains: [{ a: 7, l: 330, s: 0.09, phase: 0.4, q: 0.5 }, { a: 3.5, l: 150, s: 0.16, phase: 2.1, q: 0.6 }, { a: 1.4, l: 70, s: 0.3, phase: 4, q: 0.5 }] },
  // middle
  { left: 0.66, right: 0.4, trains: [{ a: 6, l: 260, s: -0.11, phase: 1.7, q: 0.6 }, { a: 3, l: 120, s: 0.2, phase: 0.2, q: 0.7 }, { a: 1.2, l: 55, s: 0.36, phase: 3.1, q: 0.5 }] },
  // front, with the amber crest line
  { left: 0.74, right: 0.48, trains: [{ a: 7.5, l: 300, s: 0.13, phase: 2.6, q: 0.7 }, { a: 3.4, l: 135, s: -0.19, phase: 5.2, q: 0.7 }, { a: 1.3, l: 62, s: 0.42, phase: 1.1, q: 0.6 }] },
];

const SAMPLES = 56;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** The surface of one layer at time t (seconds): points from left to right. */
function surface(layer: Layer, t: number, h: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const x0 = (i / SAMPLES) * (WAVE_W + 40) - 20;
    const u = Math.min(1, Math.max(0, x0 / WAVE_W));
    let x = x0;
    let y = h * (layer.left + (layer.right - layer.left) * u);
    for (const w of layer.trains) {
      const k = (2 * Math.PI) / w.l;
      const p = k * x0 - 2 * Math.PI * w.s * t + w.phase;
      x -= w.q * w.a * Math.cos(p);
      y -= w.a * Math.sin(p);
    }
    pts.push([r1(x), r1(y)]);
  }
  return pts;
}

function line(pts: readonly [number, number][]): string {
  let d = '';
  pts.forEach(([x, y], i) => {
    d += `${i === 0 ? 'M' : 'L'}${x} ${y}`;
  });
  return d;
}

// ---------- the perspective mesh ----------

const COLS = 30;
const ROWS = 9;
const X_SPAN = 2.6;

/** Height of the meshed water at (x, z): a few crossing wave trains. */
function meshHeight(x: number, z: number, t: number): number {
  return 0.11 * Math.sin(1.7 * x + 2.3 * z - 1.1 * t)
    + 0.06 * Math.sin(-2.9 * x + 3.1 * z - 1.7 * t + 1.3)
    + 0.035 * Math.sin(5.3 * x - 1.9 * z - 2.6 * t + 4.1);
}

export interface WaveFrame {
  /** Filled water layers, back to front (closed paths). */
  readonly layers: readonly string[];
  /** The front layer's crest, for the amber line. */
  readonly crest: string;
  /** Mesh lines (rows and columns). */
  readonly mesh: string;
  /** Mesh points, near rows bigger. */
  readonly dots: string;
}

/** One frame of the brand water at time t (seconds) for a box `h` units tall. */
export function waveFrame(t: number, h: number): WaveFrame {
  const layers = LAYERS.map((layer) => {
    const pts = surface(layer, t, h);
    return `${line(pts)}L${WAVE_W + 20} ${h + 2}L-20 ${h + 2}Z`;
  });
  const crest = line(surface(LAYERS[LAYERS.length - 1] as Layer, t, h).map(([x, y]) => [x, r1(y - 2)] as [number, number]));

  // Perspective: rows from far (z = 1) to near (z = 0).
  const f = h * 0.62;
  const horizon = h * 0.3;
  const grid: ([number, number] | null)[][] = [];
  let dots = '';
  for (let r = 0; r < ROWS; r++) {
    const z = 1 - r / (ROWS - 1);
    const depth = 1 + z * 2.3;
    const row: ([number, number] | null)[] = [];
    const rad = r1(0.7 + (1 - z) * 1.3);
    for (let c = 0; c <= COLS; c++) {
      const x = -X_SPAN + (2 * X_SPAN * c) / COLS;
      const y = meshHeight(x, z, t);
      const sx = WAVE_W / 2 + (x * WAVE_W * 0.52) / depth;
      const sy = horizon + ((1 - y) * f) / depth;
      if (sx < -30 || sx > WAVE_W + 30) {
        row.push(null);
        continue;
      }
      const p: [number, number] = [r1(sx), r1(sy)];
      row.push(p);
      if (sx >= 0 && sx <= WAVE_W) dots += `M${p[0] - rad} ${p[1]}a${rad} ${rad} 0 1 0 ${r1(2 * rad)} 0a${rad} ${rad} 0 1 0 ${r1(-2 * rad)} 0`;
    }
    grid.push(row);
  }
  let mesh = '';
  for (const row of grid) {
    let pen = false;
    for (const p of row) {
      if (!p) {
        pen = false;
        continue;
      }
      mesh += `${pen ? 'L' : 'M'}${p[0]} ${p[1]}`;
      pen = true;
    }
  }
  for (let c = 0; c <= COLS; c += 2) {
    let pen = false;
    for (const row of grid) {
      const p = row[c];
      if (!p) {
        pen = false;
        continue;
      }
      mesh += `${pen ? 'L' : 'M'}${p[0]} ${p[1]}`;
      pen = true;
    }
  }
  return { layers, crest, mesh, dots };
}
