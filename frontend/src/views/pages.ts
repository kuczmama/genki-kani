// Chapters list, chapter detail, item detail, settings.

import { BY_ID, CHAPTERS, ITEMS, KANJI, SOURCE_LABEL, VOCAB, display, gloss, type Source } from '../data';
import { groupOf } from '../srs';
import {
  exportDoc,
  importDoc,
  inScope,
  localPrefs,
  progress,
  resetAll,
  settings,
  syncStatus,
  updateItem,
  updatePrefs,
  updateSettings,
  type Doc,
  type QuestionTypes,
} from '../store';
import { esc } from '../util';
import { bindCommon, itemDetailHtml, itemRow, kanjiReadingSummary } from './components';

export function renderChapters(root: HTMLElement): void {
  const s = settings();
  root.innerHTML = `
  <main class="container">
    <h1 class="page-title">Chapters</h1>
    <p class="muted">Lessons unlock for every chapter up to your current one (chapter ${s.currentChapter}).</p>
    <div class="chapter-grid">
      ${CHAPTERS.map((c) => {
        const items = ITEMS.filter((v) => v.chapter === c && inScope(v, { ...s, currentChapter: 99 }));
        const nKanji = items.filter((i) => i.kind === 'kanji').length;
        const started = items.filter((v) => progress(v.id)).length;
        const guru = items.filter((v) => (progress(v.id)?.stage ?? 0) >= 5).length;
        const locked = c > s.currentChapter;
        return `
        <div class="card chapter-card ${locked ? 'locked' : ''} ${c === s.currentChapter ? 'current' : ''}">
          <a href="#/chapter/${c}" class="chapter-link">
            <span class="chapter-num">第${c}課</span>
            <span class="chapter-name">Chapter ${c}</span>
          </a>
          <div class="bar"><div style="width:${items.length ? (guru / items.length) * 100 : 0}%"></div></div>
          <p class="muted">${items.length - nKanji} words${nKanji ? ` · ${nKanji} kanji` : ''} · ${started} started · ${guru} guru+</p>
          ${locked ? `<button type="button" class="btn small" data-unlock="${c}">Unlock up to here</button>` : c === s.currentChapter ? '<span class="pill srs-guru">Current</span>' : ''}
        </div>`;
      }).join('')}
    </div>
  </main>`;
  root.querySelectorAll<HTMLElement>('[data-unlock]').forEach((b) =>
    b.addEventListener('click', () => updateSettings({ currentChapter: Number(b.dataset.unlock) })),
  );
}

export function renderChapter(root: HTMLElement, chapter: number): void {
  const groups: Source[] = ['conv', 'extra', 'read'];
  const s = settings();
  const kanji = KANJI.filter((k) => k.chapter === chapter);
  root.innerHTML = `
  <main class="container">
    <div class="page-head">
      <h1 class="page-title">Chapter ${chapter} <span class="muted" lang="ja">第${chapter}課</span></h1>
      <div class="row-actions">
        <a class="btn" href="#/practice/${chapter}">Practice words</a>
        ${kanji.length ? `<a class="btn kanji" href="#/practice/${chapter}/kanji">Practice kanji</a>` : ''}
      </div>
    </div>
    ${chapter > s.currentChapter ? `<p class="notice">This chapter is past your current chapter, so its words aren't in your lessons yet. <a href="#/chapters">Unlock it from Chapters.</a></p>` : ''}
    ${kanji.length ? `
    <section class="card">
      <div class="card-head"><h2>Kanji</h2><span class="muted">${kanji.length} kanji first seen in this chapter${s.studyKanji ? '' : ' · not in your lessons (turn on “Study kanji” in Settings)'}</span></div>
      <div class="kanji-grid">${kanji
        .map((k) => {
          const p = progress(k.id);
          const g = p ? groupOf(p.stage) : null;
          return `<a class="kanji-card srs-border-${g ?? 'locked'}" href="#/item/${k.id}">
            <span class="kc-char" lang="ja">${esc(k.char)}</span>
            <span class="kc-reading" lang="ja">${esc(kanjiReadingSummary(k))}</span>
            <span class="kc-meaning">${esc(k.meanings[0] ?? '')}</span>
          </a>`;
        })
        .join('')}</div>
    </section>` : ''}
    ${groups
      .map((g) => {
        const items = VOCAB.filter((v) => v.chapter === chapter && v.source === g);
        if (!items.length) return '';
        const off = (g === 'read' && !s.includeReading) || (g === 'extra' && !s.includeExtra);
        return `
        <section class="card">
          <div class="card-head"><h2>${SOURCE_LABEL[g]}</h2><span class="muted">${items.length} words${off ? ' · excluded in settings' : ''}</span></div>
          <ul class="vocab-list">${items.map((v) => itemRow(v)).join('')}</ul>
        </section>`;
      })
      .join('')}
  </main>`;
}

export function renderItem(root: HTMLElement, id: string): void {
  const v = BY_ID.get(id);
  if (!v) {
    root.innerHTML = `<main class="container"><p>Unknown item.</p></main>`;
    return;
  }
  const p = progress(id);
  root.innerHTML = `
  <div class="character meaning item-hero ${v.kind}" lang="ja">
    <div class="char-main ${v.kind === 'kanji' ? 'kanji' : ''}">${esc(display(v))}</div>
    <div class="char-sub en">${esc(gloss(v))}</div>
  </div>
  <main class="container item-page">
    <p><a href="#/chapter/${v.chapter}">← Chapter ${v.chapter}</a></p>
    <div class="card">${itemDetailHtml(v, { stats: true })}
      ${p ? `
      <section class="detail-section">
        <h3>Synonyms</h3>
        <p class="muted">Extra English answers to accept for this ${v.kind === 'kanji' ? 'kanji' : 'word'}.</p>
        <ul class="syn-list">${p.synonyms.map((s, i) => `<li>${esc(s)} <button type="button" class="link-btn" data-del="${i}">remove</button></li>`).join('')}</ul>
        <form class="syn-form" data-syn><input placeholder="Add a synonym" /><button class="btn small">Add</button></form>
      </section>` : `<p class="muted">Not started yet. This ${v.kind === 'kanji' ? 'kanji' : 'word'} will appear in your lessons once its chapter is unlocked.</p>`}
    </div>
  </main>`;
  bindCommon(root);
  root.querySelector<HTMLFormElement>('[data-syn]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).querySelector('input')!;
    const val = input.value.trim();
    if (val && p) updateItem(id, { synonyms: [...p.synonyms, val] });
  });
  root.querySelectorAll<HTMLElement>('[data-del]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!p) return;
      updateItem(id, { synonyms: p.synonyms.filter((_, i) => i !== Number(b.dataset.del)) });
    }),
  );
}

export function renderSettings(root: HTMLElement): void {
  const s = settings();
  const prefs = localPrefs();
  const st = syncStatus();
  root.innerHTML = `
  <main class="container settings">
    <h1 class="page-title">Settings</h1>
    <section class="card">
      <div class="card-head"><h2>Study</h2></div>
      <label class="field"><span>Current chapter</span>
        <select data-k="currentChapter">${CHAPTERS.map((c) => `<option value="${c}" ${c === s.currentChapter ? 'selected' : ''}>Chapter ${c}</option>`).join('')}</select>
        <small>Lessons include words from chapter 14 up to this chapter.</small>
      </label>
      <label class="field check"><input type="checkbox" data-k="includeReading" ${s.includeReading ? 'checked' : ''}/> <span>Include Reading &amp; Writing (読み書き編) vocab</span></label>
      <label class="field check"><input type="checkbox" data-k="includeExtra" ${s.includeExtra ? 'checked' : ''}/> <span>Include end-of-chapter extra vocab</span></label>
      <label class="field check"><input type="checkbox" data-k="studyKanji" ${s.studyKanji ? 'checked' : ''}/> <span>Study kanji too (meaning, on'yomi and kun'yomi). Off by default. When on, each chapter's kanji come before its words; turning it off pauses kanji reviews but keeps their progress.</span></label>
      <label class="field"><span>Lesson batch size</span>
        <input type="number" min="1" max="20" data-k="batchSize" value="${s.batchSize}" /></label>
      <label class="field"><span>Questions</span>
        <select data-k="questionTypes">
          ${(['both', 'meaning', 'reading'] as QuestionTypes[])
            .map((q) => `<option value="${q}" ${q === s.questionTypes ? 'selected' : ''}>${{ both: 'Both directions (Japanese → English and English → Japanese)', meaning: 'Japanese → English only', reading: 'English → Japanese only' }[q]}</option>`)
            .join('')}
        </select></label>
    </section>

    <section class="card">
      <div class="card-head"><h2>Audio</h2></div>
      <label class="field check"><input type="checkbox" data-pref-bool="autoplay" ${prefs.autoplay ? 'checked' : ''}/> <span>Play the word after a correct Japanese answer</span></label>
    </section>

    <section class="card">
      <div class="card-head"><h2>Sync</h2><span class="sync-inline"><span class="sync-dot ${st.state}"></span>${esc(st.message)}</span></div>
      <p class="muted">Progress is always saved in this browser. If the genki-kani Rust server is running, it's also saved there so it follows you across devices.</p>
      <label class="field"><span>Server API URL</span>
        <input data-p="apiBase" value="${esc(prefs.apiBase)}" placeholder="./api" />
        <small>Default <code>./api</code> works when the Rust server hosts this page. Leave blank to turn sync off.</small></label>
      <label class="field"><span>Access token</span>
        <input data-p="token" type="password" value="${esc(prefs.token)}" placeholder="(only if GENKI_KANI_TOKEN is set on the server)" /></label>
    </section>

    <section class="card">
      <div class="card-head"><h2>Data</h2></div>
      <div class="row-actions">
        <button type="button" class="btn" data-export>Export progress</button>
        <label class="btn">Import progress<input type="file" accept="application/json" data-import hidden /></label>
        <button type="button" class="btn danger" data-reset>Reset all progress</button>
      </div>
    </section>
  </main>`;

  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((el) =>
    el.addEventListener('change', () => {
      const k = el.dataset.k!;
      let val: unknown = el.value;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') val = el.checked;
      else if (k === 'currentChapter' || k === 'batchSize') val = Math.max(1, Number(el.value) || 1);
      updateSettings({ [k]: val });
    }),
  );
  root.querySelectorAll<HTMLInputElement>('[data-p]').forEach((el) =>
    el.addEventListener('change', () => updatePrefs({ [el.dataset.p!]: el.value.trim() })),
  );
  root.querySelectorAll<HTMLInputElement>('[data-pref-bool]').forEach((el) =>
    el.addEventListener('change', () => updatePrefs({ [el.dataset.prefBool!]: el.checked })),
  );
  root.querySelector('[data-export]')!.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(exportDoc(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `genki-kani-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  root.querySelector<HTMLInputElement>('[data-import]')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      importDoc(JSON.parse(await file.text()) as Doc);
      alert('Imported.');
    } catch (err) {
      alert(`Couldn't import: ${String(err)}`);
    }
  });
  root.querySelector('[data-reset]')!.addEventListener('click', () => {
    if (confirm('Erase ALL progress (here and on the server)? This cannot be undone.')) void resetAll();
  });
}
