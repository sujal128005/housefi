// The skill exam question bank: one JSON file per trade in ./questions (English and Telugu), four difficulty bands
// (the technician's level picks the band). A paper is 3 MCQs, 3 diagram questions and 4 "choose the right part or
// tool" questions from the band. Pictures are named by id (`art`) and drawn by the app (illustrations/SkillArt.tsx;
// the ids it can draw are listed in app/src/illustrations/skillArtIds.json).
import { createHash } from 'node:crypto';
import type { CategoryId } from '@prisma/client';
import { type QuestionType, SECTIONS } from './exam-rules';
// Imported (not read from disk) so the build carries them.
import ac from './questions/ac.json';
import appliance from './questions/appliance.json';
import carpentry from './questions/carpentry.json';
import cleaning from './questions/cleaning.json';
import electrical from './questions/electrical.json';
import plumbing from './questions/plumbing.json';

export interface Localized {
  readonly en: string;
  readonly te: string;
}

export interface BankOption extends Partial<Localized> {
  /** A part or tool picture (SELECT questions), or a label such as "A" (DIAGRAM questions). */
  readonly art?: string;
}

export interface BankQuestion {
  readonly id: string;
  readonly band: 1 | 2 | 3 | 4;
  readonly type: QuestionType;
  readonly q: Localized;
  /** The diagram (labelled A-D) or the task picture. */
  readonly art?: string;
  readonly options: readonly BankOption[];
  /** Index of the right option. */
  readonly answer: number;
}

interface BankFile {
  readonly trade: CategoryId;
  readonly questions: readonly BankQuestion[];
}

const FILES = [plumbing, electrical, ac, appliance, cleaning, carpentry] as unknown as readonly BankFile[];
/**
 * Option ids as the app sees them: letters in the order shown on that paper (a = first shown). The right answer's letter
 * therefore differs from paper to paper, and nothing the app receives tells which option is right.
 */
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** What the app gets: the question without its answer, options shuffled for this paper. */
export interface PaperQuestion {
  readonly id: string;
  readonly section: number;
  readonly type: QuestionType;
  readonly q: Localized;
  readonly art: string | null;
  readonly options: readonly { readonly id: string; readonly en: string | null; readonly te: string | null; readonly art: string | null }[];
}

export class QuestionBank {
  private readonly byId = new Map<string, BankQuestion & { readonly trade: CategoryId }>();

  constructor(files: readonly BankFile[]) {
    for (const f of files) {
      for (const q of f.questions) {
        if (this.byId.has(q.id)) throw new Error(`question bank: id ${q.id} used twice`);
        this.byId.set(q.id, { ...q, trade: f.trade });
      }
    }
  }

  static load(): QuestionBank {
    return new QuestionBank(FILES);
  }

  get size(): number {
    return this.byId.size;
  }

  all(): readonly (BankQuestion & { readonly trade: CategoryId })[] {
    return [...this.byId.values()];
  }

  question(id: string): BankQuestion & { readonly trade: CategoryId } {
    const q = this.byId.get(id);
    if (!q) throw new Error(`question bank: no question ${id}`);
    return q;
  }

  /**
   * The bank's options of a question in the order one paper shows them (DIAGRAM labels A-D stay in order; others are
   * shuffled with a seed from the paper and the question, so a reopened paper shows the same order).
   */
  order(attemptId: string, id: string): number[] {
    const q = this.question(id);
    const indices = q.options.map((_, k) => k);
    return q.type === 'DIAGRAM' ? indices : shuffle(indices, seeded(`${attemptId}:${id}`));
  }

  /** The option id ("a"...) of the right answer on this paper. */
  answerKey(attemptId: string, id: string): string {
    return LETTERS[this.order(attemptId, id).indexOf(this.question(id).answer)]!;
  }

  /** The bank option an option id of this paper stands for (null for an unknown id). */
  option(attemptId: string, id: string, optionId: string): BankOption | null {
    const k = this.order(attemptId, id)[LETTERS.indexOf(optionId)];
    return k === undefined ? null : this.question(id).options[k] ?? null;
  }

  /**
   * A new paper for a trade and band: for each section, its count of questions of that type, picked at random when
   * the band has more than needed. Throws when the bank is short (a test keeps every trade and band complete).
   */
  paper(trade: CategoryId, band: 1 | 2 | 3 | 4, random: () => number = Math.random): string[] {
    const pool = this.all().filter((q) => q.trade === trade && q.band === band);
    return SECTIONS.flatMap((s) => {
      const ofType = pool.filter((q) => q.type === s.type);
      if (ofType.length < s.count) throw new Error(`question bank: ${trade} band ${band} has ${ofType.length} ${s.type}, needs ${s.count}`);
      return shuffle(ofType, random).slice(0, s.count).map((q) => q.id);
    });
  }

  /** The paper as the app shows it. Options are shuffled per paper (the same order every time it is opened). */
  forApp(attemptId: string, ids: readonly string[]): PaperQuestion[] {
    return ids.map((id, i) => {
      const q = this.question(id);
      const options = this.order(attemptId, id).map((k, shown) => {
        const o = q.options[k]!;
        return { id: LETTERS[shown]!, en: o.en ?? null, te: o.te ?? null, art: o.art ?? null };
      });
      return { id, section: sectionIndex(i), type: q.type, q: q.q, art: q.art ?? null, options };
    });
  }
}

function sectionIndex(i: number): number {
  let end = 0;
  for (let s = 0; s < SECTIONS.length; s++) {
    end += SECTIONS[s]!.count;
    if (i < end) return s;
  }
  return SECTIONS.length - 1;
}

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A repeatable random sequence from a text (so a reopened paper keeps its option order). */
export function seeded(text: string): () => number {
  let state = createHash('sha256').update(text).digest().readUInt32LE(0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}
