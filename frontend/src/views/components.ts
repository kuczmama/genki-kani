import {
  POS_LABEL,
  SOURCE_LABEL,
  VOCAB_BY_ID,
  display,
  gloss,
  kanjiInWord,
  sentencesFor,
  splitKun,
  type Item,
  type Kanji,
  type Vocab,
} from '../data';
import { groupOf, stageName } from '../srs';
import { dueReviews, lessonQueue, localPrefs, progress, syncStatus, updatePrefs } from '../store';
import { esc, furiganaClass, jaReading, playAudio, relTime, renderJa, sentenceAudio, wordAudio } from '../util';

export function navHtml(active: string, query = ''): string {
  const lessons = lessonQueue().length;
  const reviews = dueReviews().length;
  const link = (href: string, label: string, key: string) =>
    `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  return `
  <header class="nav">
    <div class="nav-inner">
      <a class="logo" href="#/"><span class="logo-mark">蟹</span>genki<span>-</span>kani</a>
      <nav class="nav-links">
        ${link('#/', 'Dashboard', 'dash')}
        ${link('#/chapters', 'Chapters', 'chapters')}
        ${link('#/settings', 'Settings', 'settings')}
      </nav>
      <form class="nav-search" data-search role="search">
        <input type="search" placeholder="Search words & kanji…  /" aria-label="Search words and kanji" value="${esc(query)}" autocomplete="off" spellcheck="false" />
      </form>
      <div class="nav-actions">
        <a class="nav-btn lessons ${lessons ? '' : 'empty'}" href="#/lessons">Lessons <b>${lessons}</b></a>
        <a class="nav-btn reviews ${reviews ? '' : 'empty'}" href="#/reviews">Reviews <b>${reviews}</b></a>
      </div>
    </div>
  </header>`;
}

export function footerHtml(): string {
  const s = syncStatus();
  return `<footer class="footer"><span class="sync-dot ${s.state}"></span>${esc(s.message)}
    <span class="credit">Kanji data: <a href="https://www.edrdg.org/wiki/index.php/KANJIDIC_Project" target="_blank" rel="noopener">KANJIDIC2</a> © EDRDG, CC BY-SA 4.0</span></footer>`;
}

export function speakButton(src: string, text: string, label = 'Play audio'): string {
  return `<button class="speak" type="button" data-audio="${esc(src)}" data-speak="${esc(text)}" title="${label}" aria-label="${label}">▶</button>`;
}

/** Wire up any [data-speak] buttons and the furigana toggle inside root. */
export function bindCommon(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-speak]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault();
      playAudio(b.dataset.audio!, b.dataset.speak!);
    }),
  );
  root.querySelectorAll<HTMLElement>('[data-toggle-furigana]').forEach((b) =>
    b.addEventListener('click', () => {
      updatePrefs({ furigana: !localPrefs().furigana });
      root.querySelectorAll('.sentences').forEach((el) => el.classList.toggle('no-furigana', !localPrefs().furigana));
      b.textContent = localPrefs().furigana ? 'Hide furigana' : 'Show furigana';
    }),
  );
}

export function sentencesHtml(v: Vocab): string {
  const list = sentencesFor(v.id);
  if (!list.length) return '<p class="muted">No example sentences yet.</p>';
  return `
    <div class="sentences-head">
      <button type="button" class="link-btn" data-toggle-furigana>${localPrefs().furigana ? 'Hide furigana' : 'Show furigana'}</button>
    </div>
    <ul class="sentences ${furiganaClass()}">
      ${list
        .map(
          (s, i) => `<li>
            <p class="ja" lang="ja">${speakButton(sentenceAudio(v.id, i), jaReading(s.ja), 'Play sentence')}<span>${renderJa(s.ja)}</span></p>
            <p class="en">${esc(s.en)}</p>
          </li>`,
        )
        .join('')}
    </ul>`;
}

export function stagePill(stage: number): string {
  const g = groupOf(stage) ?? 'lesson';
  return `<span class="pill srs-${g}">${stageName(stage)}</span>`;
}

function statsHtml(item: Item): string {
  const p = progress(item.id);
  if (!p) return '';
  const mTotal = p.meaningCorrect + p.meaningIncorrect;
  const rTotal = p.readingCorrect + p.readingIncorrect;
  const pct = (c: number, t: number) => (t ? `${Math.round((c / t) * 100)}%` : '—');
  return `
    <section class="detail-section">
      <h3>Your progress</h3>
      <div class="stats">
        <div><span>SRS stage</span>${stagePill(p.stage)}</div>
        <div><span>Next review</span>${p.nextReview ? relTime(p.nextReview) : p.stage >= 9 ? 'Burned 🔥' : '—'}</div>
        <div><span>Meaning correct</span>${pct(p.meaningCorrect, mTotal)} <small>(${p.meaningCorrect}/${mTotal})</small></div>
        <div><span>${item.kind === 'kanji' ? 'Readings' : 'Japanese'} correct</span>${pct(p.readingCorrect, rTotal)} <small>(${p.readingCorrect}/${rTotal})</small></div>
      </div>
    </section>`;
}

function synonymsLine(item: Item): string {
  const syn = progress(item.id)?.synonyms ?? [];
  return syn.length ? `<p class="synonyms"><span>Your synonyms:</span> ${syn.map(esc).join(', ')}</p>` : '';
}

/** The full breakdown of an item: meaning, reading(s), context, and (optionally) progress. */
export function itemDetailHtml(item: Item, opts: { stats?: boolean } = {}): string {
  return item.kind === 'kanji' ? kanjiDetailHtml(item, opts) : vocabDetailHtml(item, opts);
}

function vocabDetailHtml(v: Vocab, opts: { stats?: boolean }): string {
  const pos = POS_LABEL[v.pos] ?? v.pos;
  const kanji = kanjiInWord(v);
  return `
    <section class="detail-section">
      <h3>Meaning</h3>
      <p class="big-meaning">${esc(v.en)}</p>
      ${synonymsLine(v)}
    </section>
    <section class="detail-section">
      <h3>Reading</h3>
      <p class="big-reading" lang="ja">${speakButton(wordAudio(v.id), v.kana.replace(/[（）()～]/g, ''))}${esc(v.kana)}${v.kanji ? ` <span class="muted">· ${esc(v.kanji)}</span>` : ''}</p>
      <p class="meta"><span class="pill">${esc(pos)}</span> <span class="pill">Chapter ${v.chapter}</span> <span class="pill">${SOURCE_LABEL[v.source]}</span></p>
    </section>
    ${kanji.length ? `
    <section class="detail-section">
      <h3>Kanji in this word</h3>
      <div class="kanji-chips">${kanji.map(kanjiChip).join('')}</div>
    </section>` : ''}
    <section class="detail-section">
      <h3>Context sentences</h3>
      ${sentencesHtml(v)}
    </section>
    ${opts.stats ? statsHtml(v) : ''}`;
}

/** "た.べる" with the okurigana dimmed; "-" markers become ～. */
function kunHtml(r: string): string {
  const { stem, okurigana } = splitKun(r);
  const pre = r.startsWith('-') ? '～' : '';
  const post = r.endsWith('-') ? '～' : '';
  return `${pre}${esc(stem)}${okurigana ? `<span class="okuri">${esc(okurigana)}</span>` : ''}${post}`;
}

function readingList(all: string[], used: string[], render: (r: string) => string): string {
  if (!all.length) return '<span class="muted">—</span>';
  const main = all.filter((r) => used.includes(r));
  const rest = all.filter((r) => !used.includes(r));
  return `${main.map((r) => `<span class="reading used">${render(r)}</span>`).join('')}${
    rest.length ? `<span class="reading-rest">${rest.map((r) => `<span class="reading">${render(r)}</span>`).join('')}</span>` : ''
  }`;
}

function kanjiDetailHtml(k: Kanji, opts: { stats?: boolean }): string {
  const words = k.words.flatMap((id) => VOCAB_BY_ID.get(id) ?? []);
  const asked = (t: 'onyomi' | 'kunyomi') => (k.ask.includes(t) ? '<span class="pill quizzed">quizzed</span>' : '');
  return `
    <section class="detail-section">
      <h3>Meaning</h3>
      <p class="big-meaning">${esc(k.meanings.join(', '))}</p>
      ${synonymsLine(k)}
    </section>
    <section class="detail-section">
      <h3>Readings</h3>
      <div class="readings" lang="ja">
        <div><span class="reading-label">On'yomi ${asked('onyomi')}</span><span class="reading-values">${readingList(k.on, k.usedOn, esc)}</span></div>
        <div><span class="reading-label">Kun'yomi ${asked('kunyomi')}</span><span class="reading-values">${readingList(k.kun, k.usedKun, kunHtml)}</span></div>
      </div>
      <p class="muted small">Highlighted readings are the ones your Genki words use. Any listed reading is accepted.</p>
      <p class="meta">
        <span class="pill">${k.strokes} strokes</span>
        ${k.grade ? `<span class="pill">${k.grade <= 6 ? `Grade ${k.grade}` : 'Jōyō'}</span>` : ''}
        ${k.jlpt ? `<span class="pill">Old JLPT ${k.jlpt}</span>` : ''}
        ${k.freq ? `<span class="pill">Frequency #${k.freq}</span>` : ''}
        <span class="pill">Chapter ${k.chapter}</span>
      </p>
    </section>
    <section class="detail-section">
      <h3>Found in these Genki words</h3>
      <ul class="vocab-list compact">${words.map((v) => itemRow(v, { chapter: true })).join('')}</ul>
    </section>
    ${opts.stats ? statsHtml(k) : ''}`;
}

function kanjiChip(k: Kanji): string {
  const p = progress(k.id);
  const g = p ? groupOf(p.stage) : null;
  return `<a class="kanji-chip srs-border-${g ?? 'locked'}" href="#/item/${k.id}" lang="ja">
    <span class="kc-char">${esc(k.char)}</span>
    <span class="kc-meaning">${esc(k.meanings[0] ?? '')}</span>
  </a>`;
}

/** The readings to show next to a kanji in lists: the ones Genki uses, else the first on'yomi. */
export function kanjiReadingSummary(k: Kanji): string {
  const used = [...k.usedOn, ...k.usedKun.map((r) => splitKun(r).stem + splitKun(r).okurigana)];
  return used.slice(0, 3).join('、') || k.on[0] || k.kun[0] || '';
}

/** A row in a word or kanji list (chapter pages, search results). */
export function itemRow(item: Item, opts: { chapter?: boolean } = {}): string {
  const p = progress(item.id);
  const grp = p ? groupOf(p.stage) : null;
  const sub = item.kind === 'kanji' ? kanjiReadingSummary(item) : item.kanji ? item.kana : '';
  return `<li><a href="#/item/${item.id}" class="srs-border-${grp ?? 'locked'} ${item.kind}">
    <span class="ja" lang="ja">${esc(display(item))}</span>
    <span class="kana" lang="ja">${esc(sub)}</span>
    <span class="en">${esc(gloss(item))}</span>
    <span class="row-pills">${item.kind === 'kanji' ? '<span class="pill kind-kanji">Kanji</span>' : ''}${opts.chapter ? `<span class="pill">Ch. ${item.chapter}</span>` : ''}${p ? stagePill(p.stage) : '<span class="pill">Not started</span>'}</span>
  </a></li>`;
}

export function itemTile(item: Item): string {
  const p = progress(item.id);
  const g = p ? groupOf(p.stage) : null;
  return `<a class="tile ${item.kind} srs-${g ?? 'locked'}" href="#/item/${item.id}" title="${esc(gloss(item))}" lang="ja">${esc(display(item))}</a>`;
}
