import { compareQuote, quoteAnswer } from './quote-check';

// Tap & mixer repair: ₹49 visit fee, repair from ₹149, usually up to ₹596 → ₹198 to ₹645 in all.
const TAP = { visitFeePaise: 4_900n, repairFromPaise: 14_900n, repairTypicalMaxPaise: 59_600n };
const CARTRIDGE = 'a0000000-0000-4000-8000-000000000001';
const LISTED = new Map([[CARTRIDGE, 25_000n]]);
const line = (amount: number, kind: 'LABOUR' | 'MATERIAL' = 'LABOUR', partId: string | null = null, qty = 1) => ({ name: kind === 'LABOUR' ? 'Labour' : 'Cartridge', kind, qty, amount, partId });

describe('quote checker: the comparison', () => {
  it('calls a quote within the usual range fair', () => {
    expect(compareQuote('plumb-tap', TAP, [line(300), line(250, 'MATERIAL', CARTRIDGE)], LISTED)).toMatchObject({
      total: 550, usualMin: 198, usualMax: 645, visitFee: 49, verdict: 'FAIR', over: 0,
    });
    expect(compareQuote('plumb-tap', TAP, [line(645)], LISTED).verdict).toBe('FAIR');
  });

  it('says how much more than usual: a bit high up to 1.5×, then high', () => {
    expect(compareQuote('plumb-tap', TAP, [line(900)], LISTED)).toMatchObject({ verdict: 'A_BIT_HIGH', over: 255 });
    expect(compareQuote('plumb-tap', TAP, [line(967)], LISTED).verdict).toBe('A_BIT_HIGH');
    expect(compareQuote('plumb-tap', TAP, [line(1200)], LISTED)).toMatchObject({ verdict: 'HIGH', over: 555 });
  });

  it("compares listed parts with Housefi's price list (10% leeway, per piece)", () => {
    const lines = compareQuote('plumb-tap', TAP, [line(275, 'MATERIAL', CARTRIDGE), line(400, 'MATERIAL', CARTRIDGE), line(560, 'MATERIAL', CARTRIDGE, 2)], LISTED).lines;
    expect(lines.map((l) => [l.listPrice, l.overList])).toEqual([[250, 0], [250, 150], [250, 60]]);
  });

  it('ignores a part id that is not on the price list', () => {
    expect(compareQuote('plumb-tap', TAP, [line(400, 'MATERIAL', 'b0000000-0000-4000-8000-000000000002')], LISTED).lines[0]).toMatchObject({ partId: null, listPrice: null, overList: 0 });
  });
});

describe("quote checker: the model's reading", () => {
  const SERVICES = ['plumb-tap', 'plumb-block'];
  const PARTS = [CARTRIDGE];

  it('keeps known ids only, and sensible lines', () => {
    const read = quoteAnswer(
      {
        readable: true,
        serviceId: 'plumb-tap',
        lines: [
          { name: '  Tap   repair labour ', kind: 'LABOUR', qty: 1, amount: 350.4, partId: CARTRIDGE },
          { name: 'Cartridge', kind: 'MATERIAL', qty: 0, amount: 300, partId: CARTRIDGE },
          { name: 'Washer', kind: 'MATERIAL', qty: 2, amount: 60, partId: 'made-up' },
          { name: 'Total', kind: 'TOTAL', qty: 1, amount: 710, partId: null },
          { name: 'Free check', kind: 'LABOUR', qty: 1, amount: 0, partId: null },
          { name: '', kind: 'LABOUR', qty: 1, amount: 10, partId: null },
        ],
      },
      SERVICES,
      PARTS,
    );
    expect(read).toEqual({
      readable: true,
      serviceId: 'plumb-tap',
      lines: [
        { name: 'Tap repair labour', kind: 'LABOUR', qty: 1, amount: 350, partId: null },
        { name: 'Cartridge', kind: 'MATERIAL', qty: 1, amount: 300, partId: CARTRIDGE },
        { name: 'Washer', kind: 'MATERIAL', qty: 2, amount: 60, partId: null },
      ],
    });
  });

  it('is unreadable when the model says so or finds no usable line, and drops an unknown service', () => {
    expect(quoteAnswer({ readable: false, serviceId: 'plumb-tap', lines: [] }, SERVICES, PARTS)).toEqual({ readable: false, serviceId: 'plumb-tap', lines: [] });
    expect(quoteAnswer({ readable: true, serviceId: 'nope', lines: [{ name: 'x', kind: 'LABOUR', qty: 1, amount: 999_999, partId: null }] }, SERVICES, PARTS)).toEqual({ readable: false, serviceId: null, lines: [] });
  });

  it('keeps at most 20 lines', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `Line ${i}`, kind: 'LABOUR', qty: 1, amount: 10, partId: null }));
    expect(quoteAnswer({ readable: true, serviceId: null, lines: many }, SERVICES, PARTS).lines).toHaveLength(20);
  });
});
