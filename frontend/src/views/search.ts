import { isKana, toHiragana } from 'wanakana';
import { ITEMS, type Item } from '../data';
import { kanjiReadings } from '../answer';
import { esc } from '../util';
import { itemRow } from './components';

const LIMIT = 100;

const cleanJa = (s: string) => toHiragana(s.replace(/[（）()～〜…！X\s]/g, ''), { passRomaji: true });

/** Lower is better; Infinity means no match. */
function score(v: Item, q: string, qJa: string | null): number {
  let best = Infinity;
  if (v.kind === 'kanji' && q.includes(v.char)) best = q === v.char ? 0 : 2;
  const glosses = v.kind === 'kanji' ? v.meanings : [v.en, ...v.en.split(';')];
  for (const part of glosses) {
    const en = part.trim().toLowerCase().replace(/\([^)]*\)/g, '').trim();
    const bare = en.replace(/^to /, '');
    if (en === q || bare === q) best = Math.min(best, 0);
    else if (en.startsWith(q) || bare.startsWith(q)) best = Math.min(best, 1);
    else if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(en)) best = Math.min(best, 2);
    else if (en.includes(q)) best = Math.min(best, 3);
  }
  if (!qJa) return best;
  if (v.kind === 'kanji') {
    // A kanji matches a kana query only on an exact reading (searching "か" shouldn't list 100 kanji).
    const r = kanjiReadings(v);
    if ([...r.onyomi, ...r.kunyomi].includes(qJa)) best = Math.min(best, 1);
    return best;
  }
  for (const form of [v.kana, ...(v.kanji ? v.kanji.split('／') : [])]) {
    const ja = cleanJa(form);
    if (ja === qJa) best = Math.min(best, 0);
    else if (ja.startsWith(qJa)) best = Math.min(best, 1);
    else if (ja.includes(qJa)) best = Math.min(best, 3);
  }
  return best;
}

/** Search every chapter's words and kanji by English, kana, kanji, or romaji (e.g. "akirameru"). */
export function searchVocab(query: string): Item[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  // Romaji or katakana → hiragana, so "akirameru", "アキラメル" and "あきらめる" all match.
  const fromRomaji = /^[a-z' -]+$/.test(q) ? toHiragana(q.replace(/[\s-]+/g, '')) : null;
  const qJa = fromRomaji && isKana(fromRomaji) ? fromRomaji : /[^\x00-\x7f]/.test(q) ? cleanJa(q) : null;
  return ITEMS.map((v, i) => ({ v, i, s: score(v, q, qJa) }))
    .filter((x) => x.s < Infinity)
    .sort((a, b) => a.s - b.s || a.v.chapter - b.v.chapter || a.i - b.i)
    .map((x) => x.v);
}

export function renderSearchResults(root: HTMLElement, query: string): void {
  const q = query.trim();
  if (!q) {
    root.innerHTML = `
    <main class="container">
      <h1 class="page-title">Search</h1>
      <p class="muted">Type English, kana, kanji, or romaji (e.g. <code>akirameru</code>) in the search box. Every chapter's words and kanji are searched, including ones you haven't unlocked.</p>
    </main>`;
    return;
  }
  const results = searchVocab(q);
  root.innerHTML = `
  <main class="container">
    <h1 class="page-title">Search <span class="muted">“${esc(q)}”</span></h1>
    <p class="muted">${results.length ? `${results.length > LIMIT ? `Top ${LIMIT} of ${results.length}` : results.length} result${results.length === 1 ? '' : 's'}` : 'Nothing found.'}</p>
    ${results.length ? `<section class="card"><ul class="vocab-list">${results.slice(0, LIMIT).map((v) => itemRow(v, { chapter: true })).join('')}</ul></section>` : ''}
  </main>`;
}
