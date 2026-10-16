// A queue of questions over a set of items, WaniKani style: each item needs a correct
// meaning answer and a correct Japanese answer; wrong answers come back later.

import { BY_ID, type Item } from './data';
import type { QuestionTypes } from './store';
import { shuffle } from './util';

/** `reading` is a word's Japanese; `onyomi`/`kunyomi` are a kanji's readings. */
export type QType = 'meaning' | 'reading' | 'onyomi' | 'kunyomi';

export interface Question {
  item: Item;
  type: QType;
}

export interface ItemResult {
  item: Item;
  meaningWrong: number;
  readingWrong: number;
}

interface Tracking {
  item: Item;
  need: Set<QType>;
  meaningWrong: number;
  readingWrong: number;
}

const ACTIVE = 10;

/** Which questions an item needs: words get meaning + Japanese, kanji get meaning + the readings Genki uses. */
export function questionsFor(item: Item, types: QuestionTypes): QType[] {
  const readings: QType[] = item.kind === 'kanji' ? item.ask : ['reading'];
  if (types === 'meaning') return ['meaning'];
  if (types === 'reading') return readings;
  return ['meaning', ...readings];
}

/** Plain-JSON form of a session, so a refresh can pick up where it left off. */
export interface Snapshot {
  types: QuestionTypes;
  total: number;
  waiting: string[];
  active: { id: string; need: QType[]; meaningWrong: number; readingWrong: number }[];
  results: { id: string; meaningWrong: number; readingWrong: number }[];
  answered: number;
  answeredCorrect: number;
  /** The question on screen, if it hadn't been answered yet. */
  current: { id: string; type: QType } | null;
}

export class Session {
  private waiting: Item[];
  private active: Tracking[] = [];
  private last: Question | null = null;
  private current: Question | null = null;
  readonly total: number;
  readonly results: ItemResult[] = [];
  answered = 0;
  answeredCorrect = 0;

  constructor(items: Item[], private types: QuestionTypes, shuffleItems = true) {
    this.waiting = shuffleItems ? shuffle(items) : [...items];
    this.total = items.length;
    this.fill();
  }

  private fill(): void {
    while (this.active.length < ACTIVE && this.waiting.length) {
      const item = this.waiting.shift()!;
      this.active.push({ item, need: new Set(questionsFor(item, this.types)), meaningWrong: 0, readingWrong: 0 });
    }
  }

  get remaining(): number {
    return this.active.length + this.waiting.length;
  }

  get done(): boolean {
    return this.remaining === 0;
  }

  next(): Question | null {
    if (this.current && this.track(this.current.item.id)?.need.has(this.current.type)) {
      this.last = this.current;
      return this.current;
    }
    const options: Question[] = this.active.flatMap((t) => [...t.need].map((type) => ({ item: t.item, type })));
    if (!options.length) return null;
    const fresh = options.filter((q) => !this.last || q.item.id !== this.last.item.id || q.type !== this.last.type);
    const pool = fresh.length ? fresh : options;
    // Prefer finishing the other half of a half-answered item now and then, like WaniKani.
    const q = pool[Math.floor(Math.random() * pool.length)];
    this.last = q;
    this.current = q;
    return q;
  }

  private track(id: string): Tracking | undefined {
    return this.active.find((t) => t.item.id === id);
  }

  /** Record an answer. Returns the finished item's result if this completed it. */
  answer(q: Question, correct: boolean): ItemResult | null {
    const t = this.track(q.item.id);
    if (!t) return null;
    this.current = null;
    this.answered++;
    if (!correct) {
      if (q.type === 'meaning') t.meaningWrong++;
      else t.readingWrong++; // a kanji's on'yomi and kun'yomi both count as "reading"
      return null;
    }
    this.answeredCorrect++;
    t.need.delete(q.type);
    if (t.need.size) return null;
    this.active = this.active.filter((x) => x !== t);
    this.fill();
    const result = { item: t.item, meaningWrong: t.meaningWrong, readingWrong: t.readingWrong };
    this.results.push(result);
    return result;
  }

  /** "I was right": turn the last wrong answer into a correct one. */
  overrule(q: Question): ItemResult | null {
    const t = this.track(q.item.id);
    if (!t) return null;
    if (q.type === 'meaning') t.meaningWrong = Math.max(0, t.meaningWrong - 1);
    else t.readingWrong = Math.max(0, t.readingWrong - 1);
    this.answered--;
    return this.answer(q, true);
  }

  snapshot(): Snapshot {
    return {
      types: this.types,
      total: this.total,
      waiting: this.waiting.map((v) => v.id),
      active: this.active.map((t) => ({ id: t.item.id, need: [...t.need], meaningWrong: t.meaningWrong, readingWrong: t.readingWrong })),
      results: this.results.map((r) => ({ id: r.item.id, meaningWrong: r.meaningWrong, readingWrong: r.readingWrong })),
      answered: this.answered,
      answeredCorrect: this.answeredCorrect,
      current: this.current ? { id: this.current.item.id, type: this.current.type } : null,
    };
  }

  static restore(s: Snapshot): Session | null {
    const get = (id: string) => BY_ID.get(id);
    if (![...s.waiting, ...s.active.map((a) => a.id), ...s.results.map((r) => r.id)].every(get)) return null;
    const session = new Session([], s.types);
    Object.assign(session, { total: s.total });
    session.waiting = s.waiting.map((id) => get(id)!);
    session.active = s.active.map((a) => ({ item: get(a.id)!, need: new Set(a.need), meaningWrong: a.meaningWrong, readingWrong: a.readingWrong }));
    session.results.push(...s.results.map((r) => ({ item: get(r.id)!, meaningWrong: r.meaningWrong, readingWrong: r.readingWrong })));
    session.answered = s.answered;
    session.answeredCorrect = s.answeredCorrect;
    session.current = s.current ? { item: get(s.current.id)!, type: s.current.type } : null;
    return session;
  }

  /** Stop pulling in new items; finish only what's active (WaniKani's "wrap up"). */
  wrapUp(): void {
    this.waiting = [];
  }
}
