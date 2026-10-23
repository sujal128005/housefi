import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $Enums } from '@prisma/client';
import { SECTIONS } from './exam-rules';
import { QuestionBank } from './question-bank';

const bank = QuestionBank.load();
/** The pictures the app can draw (app/src/illustrations/SkillArt.tsx; an app test checks each one has a drawing). */
const appArt = new Set<string>(JSON.parse(readFileSync(join(__dirname, '../../../../app/src/illustrations/skillArtIds.json'), 'utf8')));
const TELUGU = /[ఀ-౿]/;

describe('skill exam question bank', () => {
  it('has a full paper for every trade and every level', () => {
    for (const trade of Object.values($Enums.CategoryId)) {
      for (const band of [1, 2, 3, 4] as const) {
        const pool = bank.all().filter((q) => q.trade === trade && q.band === band);
        for (const s of SECTIONS) expect([trade, band, s.type, pool.filter((q) => q.type === s.type).length >= s.count]).toEqual([trade, band, s.type, true]);
        expect(bank.paper(trade, band)).toHaveLength(10);
      }
    }
  });

  it('every question is complete in English and Telugu, with one valid answer', () => {
    for (const q of bank.all()) {
      expect([q.id, q.q.en.length > 10, TELUGU.test(q.q.te)]).toEqual([q.id, true, true]);
      expect([q.id, q.answer >= 0 && q.answer < q.options.length, q.options.length >= 3 && q.options.length <= 6]).toEqual([q.id, true, true]);
      if (q.type === 'DIAGRAM') {
        // A diagram question points at a labelled part of its picture.
        expect([q.id, q.art?.startsWith('scene.'), q.options.map((o) => o.art)]).toEqual([q.id, true, q.options.map((_, i) => `label.${'ABCDEF'[i]}`)]);
      } else {
        // Codes such as "R32" or "16 A" read the same in Telugu; words must be translated.
        for (const o of q.options) expect([q.id, !!o.en && !!o.te && (TELUGU.test(o.te) || !/[a-z]{3}/.test(o.en))]).toEqual([q.id, true]);
      }
      if (q.type === 'SELECT') for (const o of q.options) expect([q.id, !!o.art]).toEqual([q.id, true]);
    }
  });

  it('every picture it names can be drawn by the app', () => {
    const named = new Set<string>();
    for (const q of bank.all()) {
      if (q.art) named.add(q.art);
      for (const o of q.options) if (o.art) named.add(o.art);
    }
    expect([...named].filter((a) => !appArt.has(a))).toEqual([]);
  });

  it('never sends the answer: letters for options, shuffled the same way every time for one paper', () => {
    const ids = bank.paper('PLUMBING', 1);
    const one = bank.forApp('attempt-1', ids);
    expect(bank.forApp('attempt-1', ids)).toEqual(one);
    expect(JSON.stringify(one)).not.toContain('answer');
    expect(one.map((q) => q.section)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 2]);
    // Letters follow the order shown; the answer key names the right option on that paper.
    const select = one.find((q) => q.type === 'SELECT')!;
    expect(select.options.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
    const right = bank.answerKey('attempt-1', select.id);
    expect(select.options.find((o) => o.id === right)?.en).toBe(bank.question(select.id).options[bank.question(select.id).answer]!.en);
    expect(bank.option('attempt-1', select.id, right)?.en).toBe(select.options.find((o) => o.id === right)?.en);
    // Over many papers the right answer's letter changes, so an option id never gives the answer away.
    const letters = new Set(Array.from({ length: 30 }, (_, i) => bank.answerKey(`a${i}`, select.id)));
    expect(letters.size).toBeGreaterThan(2);
  });
});
