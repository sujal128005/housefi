import { waveFrame, WAVE_W } from '../ui/waveMath';

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('brand water', () => {
  it('draws closed layers, a crest, mesh lines and points with finite coordinates', () => {
    const f = waveFrame(3.7, 140);
    expect(f.layers).toHaveLength(3);
    for (const d of f.layers) expect(d.endsWith('Z')).toBe(true);
    for (const d of [...f.layers, f.crest, f.mesh, f.dots]) {
      expect(d.length).toBeGreaterThan(20);
      expect(numbers(d).every(Number.isFinite)).toBe(true);
    }
  });

  it('keeps the water inside the box, below the top', () => {
    for (const t of [0, 1.3, 12.8, 600]) {
      const f = waveFrame(t, 140);
      const ys = f.layers.flatMap((d) => numbers(d).filter((_, i) => i % 2 === 1));
      expect(Math.min(...ys)).toBeGreaterThan(0);
      expect(Math.max(...ys)).toBeLessThanOrEqual(142);
    }
  });

  it('moves over time and is the same for the same moment', () => {
    expect(waveFrame(1, 140)).toEqual(waveFrame(1, 140));
    expect(waveFrame(1, 140).layers[2]).not.toEqual(waveFrame(1.1, 140).layers[2]);
  });

  it('stays small enough to update every frame', () => {
    const f = waveFrame(2, 140);
    const size = [...f.layers, f.crest, f.mesh, f.dots].join('').length;
    expect(size).toBeLessThan(24000);
    expect(WAVE_W).toBe(400);
  });
});
