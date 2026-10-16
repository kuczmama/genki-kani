import { isKana, toHiragana } from 'wanakana';
import { VOCAB, alternatesFor, meaningsFor, splitKun, type Kanji, type ReadingType, type Vocab } from './data';

export type Verdict =
  /** `note` is extra feedback shown even though the answer counts (e.g. a rarer valid reading). */
  | { kind: 'correct'; close: boolean; note?: string }
  | { kind: 'incorrect' }
  /** Not graded: the answer was the wrong kind (e.g. a reading for a meaning question). */
  | { kind: 'shake'; message: string };

// ---------- English ----------

function normEn(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\. \. \./g, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTo(s: string): string {
  return s.replace(/^to /, '');
}

/** "Mr./Ms. . . ." → "Mr. . . .", "Ms. . . ."; "plastic/paper bag" → "plastic bag", "paper bag". */
function expandSlashes(s: string): string[] {
  const m = s.match(/([^\s/()]+)\/([^\s/()]+)/);
  if (!m || m.index === undefined) return [s];
  const [before, after] = [s.slice(0, m.index), s.slice(m.index + m[0].length)];
  return [...expandSlashes(before + m[1] + after), ...expandSlashes(before + m[2] + after)];
}

const memoEn = new Map<string, string[]>();

/** All acceptable normalized English answers for a word or kanji (without user synonyms). */
export function meaningVariants(v: Vocab | Kanji): string[] {
  const cached = memoEn.get(v.id);
  if (cached) return cached;
  const out = new Set<string>();
  const glosses = v.kind === 'kanji' ? v.meanings : [v.en];
  const parts = glosses.flatMap((g) => [g, ...g.split(';')]).map((p) => p.trim()).filter(Boolean);
  for (const p of parts.flatMap(expandSlashes)) {
    const unbracketed = p.replace(/[[\]]/g, '');
    for (const form of [
      unbracketed,
      unbracketed.replace(/\([^)]*\)/g, ' '), // drop parentheticals
      unbracketed.replace(/[()]/g, ' '), // keep their contents
    ]) {
      const n = normEn(form);
      if (n) {
        out.add(n);
        out.add(stripTo(n));
      }
    }
  }
  for (const extra of meaningsFor(v.id)) {
    const n = normEn(extra);
    if (n) {
      out.add(n);
      out.add(stripTo(n));
    }
  }
  const list = [...out].filter(Boolean);
  memoEn.set(v.id, list);
  return list;
}

/** Edit distance where swapping two adjacent letters counts as one typo. */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** WaniKani-ish typo tolerance. */
function tolerance(len: number): number {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 7) return 2;
  return 2 + Math.floor((len - 7) / 7);
}

export function checkMeaning(v: Vocab | Kanji, input: string, synonyms: string[] = []): Verdict {
  const raw = input.trim();
  if (!raw) return { kind: 'shake', message: 'Type an answer first.' };
  const ans = stripTo(normEn(raw));
  const targets = [...meaningVariants(v), ...synonyms.map((s) => stripTo(normEn(s)))];
  // An explicitly accepted answer wins, even if it's romaji (～君 → "kun").
  if (targets.includes(ans)) return { kind: 'correct', close: false };
  if (isKana(raw.replace(/\s/g, '')) || (v.kind === 'vocab' && readingVariants(v).includes(normJa(raw)))) {
    return { kind: 'shake', message: 'We want the English meaning, not the Japanese.' };
  }
  for (const t of targets) {
    if (editDistance(ans, t) <= tolerance(t.length)) return { kind: 'correct', close: true };
  }
  return { kind: 'incorrect' };
}

// ---------- Japanese ----------

export function normJa(s: string): string {
  return toHiragana(s.trim(), { passRomaji: false })
    .replace(/[\s　]/g, '')
    .replace(/[～〜~…・！!？?。、,.X]/g, '');
}

/** Expand optional parentheticals: あんぜん（な） → あんぜん, あんぜんな; いう（もんくを） → もんくをいう … */
function expandParens(s: string): string[] {
  const m = s.match(/[（(]([^）)]*)[）)]/);
  if (!m || m.index === undefined) return [s];
  const before = s.slice(0, m.index);
  const after = s.slice(m.index + m[0].length);
  const inner = m[1];
  const options = [before + after, before + inner + after];
  if (/を$/.test(inner)) options.push(inner + before + after);
  return options.flatMap(expandParens);
}

const KANJI = /[\u3400-\u9fff々〆ヶ]/;
const isKanjiRun = (p: string) => /^[\u3400-\u9fff々〆ヶ]+$/.test(p);

/**
 * Every kanji/kana mix of a written form, given its reading: 友達 + ともだち → 友達, 友だち, とも達, ともだち.
 * Each kanji block is matched to its slice of the reading using the kana between blocks as anchors.
 */
function kanaMixes(form: string, reading: string): string[] {
  const parts = form.split(/([\u3400-\u9fff々〆ヶ]+)/).filter(Boolean);
  if (!KANJI.test(form)) return [];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = reading.match(new RegExp(`^${parts.map((p) => (isKanjiRun(p) ? '(.+?)' : esc(p))).join('')}$`));
  if (!m) return [];
  let combos = [''];
  let g = 1;
  for (const p of parts) {
    const choices = isKanjiRun(p) ? [p, m[g++]] : [p];
    combos = combos.flatMap((c) => choices.map((x) => c + x));
    if (combos.length > 64) return [];
  }
  return combos;
}

const memoJa = new Map<string, string[]>();

/** All acceptable normalized Japanese answers (kana, kanji, mixes, and extra spellings). */
export function readingVariants(v: Vocab): string[] {
  const cached = memoJa.get(v.id);
  if (cached) return cached;
  const expand = (forms: string[]) => [...new Set(forms.flatMap(expandParens).map(normJa).filter(Boolean))];
  const readings = expand([v.kana]);
  const written = expand([...(v.kanji ? v.kanji.split('／') : []), ...alternatesFor(v.id)]);
  const out = new Set<string>([...readings, ...written]);
  for (const w of written) for (const r of readings) for (const mix of kanaMixes(w, r)) out.add(mix);
  // な-adjectives: accept the bare stem and the stem + な for every spelling.
  if (v.pos === 'な-adj.') {
    for (const f of [...out]) out.add(f.endsWith('な') ? f.slice(0, -1) : f + 'な');
  }
  const list = [...out].filter(Boolean);
  memoJa.set(v.id, list);
  return list;
}

const STOP = new Set(['to', 'the', 'a', 'an', 'of', 'be', 'one', 'someone', 'something', 'for', 'and', 'or', 'in', 'on', 'at', 'with', 'is', 'about']);

function contentWords(v: Vocab): Set<string> {
  return new Set(
    meaningVariants(v)
      .flatMap((m) => m.split(' '))
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

export function checkReading(v: Vocab, input: string): Verdict {
  const ans = normJa(input);
  if (!ans) return { kind: 'shake', message: 'Type an answer first.' };
  if (/[a-z]/i.test(ans)) return { kind: 'shake', message: 'We want the Japanese — type it in romaji and it turns into kana.' };
  if (readingVariants(v).includes(ans)) return { kind: 'correct', close: false };

  // Typed a different Genki word with an overlapping meaning? Nudge rather than fail.
  const mine = contentWords(v);
  for (const other of VOCAB) {
    if (other.id === v.id || !readingVariants(other).includes(ans)) continue;
    const overlap = [...contentWords(other)].some((w) => mine.has(w));
    if (overlap) {
      return { kind: 'shake', message: `That's ${other.kana} (“${other.en}”). We're looking for a different word.` };
    }
  }
  return { kind: 'incorrect' };
}

// ---------- kanji readings ----------

const READING_NAME: Record<ReadingType, string> = { onyomi: "on'yomi", kunyomi: "kun'yomi" };

/** Normalized accepted answers for each reading type: on'yomi in hiragana; kun'yomi as stem and with okurigana. */
export function kanjiReadings(k: Kanji): Record<ReadingType, string[]> {
  const on = k.on.map((r) => normJa(r));
  const kun = k.kun.flatMap((r) => {
    const { stem, okurigana } = splitKun(r);
    return [stem, stem + okurigana].map((x) => normJa(x));
  });
  return { onyomi: [...new Set(on)], kunyomi: [...new Set(kun)] };
}

export function checkKanjiReading(k: Kanji, type: ReadingType, input: string): Verdict {
  const ans = normJa(input);
  if (!ans) return { kind: 'shake', message: 'Type an answer first.' };
  if (/[a-z]/i.test(ans)) return { kind: 'shake', message: 'Type the reading in romaji and it turns into kana.' };
  const all = kanjiReadings(k);
  const other: ReadingType = type === 'onyomi' ? 'kunyomi' : 'onyomi';
  if (all[type].includes(ans)) {
    const used = (type === 'onyomi' ? k.usedOn : k.usedKun).map((r) => normJa(r.includes('.') ? splitKun(r).stem + splitKun(r).okurigana : r.replace(/-/g, '')));
    const usedStems = type === 'kunyomi' ? k.usedKun.map((r) => normJa(splitKun(r).stem)) : [];
    const common = !used.length || used.includes(ans) || usedStems.includes(ans);
    const shown = (type === 'onyomi' ? k.usedOn : k.usedKun).join('、');
    return { kind: 'correct', close: false, note: common ? undefined : `Correct, though Genki words use ${shown}.` };
  }
  if (all[other].includes(ans)) {
    return { kind: 'shake', message: `That's ${other === 'onyomi' ? 'an' : 'a'} ${READING_NAME[other]}. We want the ${READING_NAME[type]}.` };
  }
  return { kind: 'incorrect' };
}
