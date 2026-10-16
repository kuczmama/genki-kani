import vocabJson from '../../data/vocab.json';
import kanjiJson from '../../data/kanji.json';

export type Source = 'conv' | 'read' | 'extra';

export interface Vocab {
  kind: 'vocab';
  id: string;
  kana: string;
  kanji: string | null;
  pos: string;
  en: string;
  chapter: number;
  source: Source;
}

export interface Sentence {
  ja: string;
  en: string;
}

export type ReadingType = 'onyomi' | 'kunyomi';

/** A single kanji (data from KANJIDIC2, © EDRDG, CC BY-SA 4.0). */
export interface Kanji {
  kind: 'kanji';
  id: string;
  char: string;
  meanings: string[];
  /** All on'yomi in katakana, and kun'yomi with okurigana after a dot (た.べる), as KANJIDIC lists them. */
  on: string[];
  kun: string[];
  /** The readings that actually occur in our Genki words and sentences. */
  usedOn: string[];
  usedKun: string[];
  /** Which reading questions to ask. */
  ask: ReadingType[];
  chapter: number;
  /** Vocab ids that use this kanji. */
  words: string[];
  strokes: number;
  grade: number | null;
  jlpt: number | null;
  freq: number | null;
}

export type Item = Vocab | Kanji;

export const VOCAB: Vocab[] = (vocabJson as Omit<Vocab, 'kind'>[]).map((v) => ({ ...v, kind: 'vocab' as const }));
export const KANJI: Kanji[] = (kanjiJson as Omit<Kanji, 'kind'>[]).map((k) => ({ ...k, kind: 'kanji' as const }));
/** Study order within a chapter: kanji first (like WaniKani), then words. */
export const ITEMS: Item[] = [...KANJI, ...VOCAB];
export const BY_ID = new Map<string, Item>(ITEMS.map((i) => [i.id, i]));
export const VOCAB_BY_ID = new Map(VOCAB.map((v) => [v.id, v]));
export const KANJI_BY_CHAR = new Map(KANJI.map((k) => [k.char, k]));
export const CHAPTERS = [...new Set(VOCAB.map((v) => v.chapter))].sort((a, b) => a - b);

const sentenceFiles = import.meta.glob<Record<string, Sentence[]>>('../../data/sentences/L*.json', {
  eager: true,
  import: 'default',
});
const SENTENCES: Record<string, Sentence[]> = Object.assign({}, ...Object.values(sentenceFiles));

const alternateFiles = import.meta.glob<Record<string, string[]>>('../../data/alternates/*.json', {
  eager: true,
  import: 'default',
});
// Several files can list the same word (hand-checked L*.json plus generated split.json), so merge.
const ALTERNATES: Record<string, string[]> = {};
for (const file of Object.values(alternateFiles)) {
  for (const [id, forms] of Object.entries(file)) ALTERNATES[id] = [...(ALTERNATES[id] ?? []), ...forms];
}

const meaningFiles = import.meta.glob<Record<string, string[]>>('../../data/meanings/*.json', {
  eager: true,
  import: 'default',
});
const MEANINGS: Record<string, string[]> = {};
for (const file of Object.values(meaningFiles)) {
  for (const [id, answers] of Object.entries(file)) MEANINGS[id] = [...(MEANINGS[id] ?? []), ...answers];
}

/** Extra accepted English answers beyond Genki's gloss (e.g. ～君 → "mr", "kun"). */
export function meaningsFor(id: string): string[] {
  return MEANINGS[id] ?? [];
}

/** Extra accepted Japanese spellings beyond Genki's (e.g. すてき → 素敵). */
export function alternatesFor(id: string): string[] {
  return ALTERNATES[id] ?? [];
}

export function sentencesFor(id: string): Sentence[] {
  return SENTENCES[id] ?? [];
}

export const SOURCE_LABEL: Record<Source, string> = {
  conv: 'Main text',
  read: 'Reading & Writing',
  extra: 'Extra vocab',
};

export const POS_LABEL: Record<string, string> = {
  'n.': 'Noun',
  'い-adj.': 'い-adjective',
  'な-adj.': 'な-adjective',
  'u-v.': 'U-verb',
  'ru-v.': 'Ru-verb',
  'irr-v.': 'Irregular verb',
  'adv.': 'Adverb',
  'part.': 'Particle',
  'pre.': 'Pre-nominal',
  'suf.': 'Suffix',
  'exp.': 'Expression',
};

/** The Japanese headline for an item: the kanji itself, or a word's kanji form (else kana). */
export function display(item: Item): string {
  return item.kind === 'kanji' ? item.char : (item.kanji ?? item.kana);
}

/** A short English label for an item. */
export function gloss(item: Item): string {
  return item.kind === 'kanji' ? item.meanings.slice(0, 3).join(', ') : item.en;
}

/** Kanji in a word that we have entries for, in order, without repeats. */
export function kanjiInWord(v: Vocab): Kanji[] {
  return [...new Set(v.kanji ?? '')].flatMap((c) => KANJI_BY_CHAR.get(c) ?? []);
}

/** "た.べる" → { stem: "た", okurigana: "べる" }; prefix/suffix markers (-) dropped. */
export function splitKun(r: string): { stem: string; okurigana: string } {
  const [stem, okurigana = ''] = r.replace(/-/g, '').split('.');
  return { stem, okurigana };
}
