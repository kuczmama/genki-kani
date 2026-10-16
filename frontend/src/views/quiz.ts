import { bind, unbind, toHiragana } from 'wanakana';
import { checkKanjiReading, checkMeaning, checkReading, type Verdict } from '../answer';
import { display, gloss, POS_LABEL } from '../data';
import { localPrefs, progress, updateItem } from '../store';
import type { ItemResult, Question, Session } from '../session';
import { esc, playAudio, wordAudio } from '../util';
import { bindCommon, itemDetailHtml } from './components';

export interface QuizOptions {
  mode: 'review' | 'lesson' | 'practice';
  title: string;
  onItemDone: (r: ItemResult) => void;
  onFinish: (s: Session) => void;
  exitHref: string;
  /** Called whenever session state changes (for saving it across refreshes). */
  onChange?: () => void;
  /** Called when the user deliberately leaves with ✕. */
  onExit?: () => void;
}

export function runQuiz(root: HTMLElement, session: Session, opts: QuizOptions): () => void {
  root.innerHTML = `
  <div class="quiz quiz-${opts.mode}">
    <div class="quiz-top">
      <a class="quiz-exit" href="${opts.exitHref}" title="Leave">✕</a>
      <span class="quiz-title">${esc(opts.title)}</span>
      <div class="quiz-stats">
        <span title="Correct">👍 <b data-stat="pct">100%</b></span>
        <span title="Done">✓ <b data-stat="done">0</b></span>
        <span title="Remaining">⧗ <b data-stat="left">${session.remaining}</b></span>
        ${opts.mode === 'review' ? '<button type="button" class="wrap-up" data-wrap>Wrap up</button>' : ''}
      </div>
    </div>
    <div class="quiz-progress"><div data-bar></div></div>
    <div class="character" data-character lang="ja"></div>
    <div class="prompt" data-prompt></div>
    <form class="answer-row" data-form autocomplete="off">
      <input data-input type="text" autocapitalize="off" autocorrect="off" spellcheck="false" />
      <button type="submit" class="submit" aria-label="Submit">➜</button>
    </form>
    <div class="shake-msg" data-msg></div>
    <div class="quiz-actions" data-actions hidden>
      <button type="button" data-info>Item info <kbd>F</kbd></button>
      <button type="button" data-right hidden>I was right <kbd>R</kbd></button>
      <button type="button" data-next>Next <kbd>Enter</kbd></button>
    </div>
    <div class="item-info" data-info-panel hidden></div>
  </div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const input = $<HTMLInputElement>('[data-input]');
  const form = $<HTMLFormElement>('[data-form]');
  const character = $('[data-character]');
  const prompt = $('[data-prompt]');
  const msg = $('[data-msg]');
  const actions = $('[data-actions]');
  const infoPanel = $('[data-info-panel]');
  const rightBtn = $('[data-right]');

  let q: Question | null = null;
  let answered: Verdict | null = null;
  let typed = '';
  let kanaBound = false;

  function setKana(on: boolean) {
    if (on && !kanaBound) bind(input, { IMEMode: 'toHiragana' });
    if (!on && kanaBound) unbind(input);
    kanaBound = on;
  }

  function updateStats() {
    const pct = session.answered ? Math.round((session.answeredCorrect / session.answered) * 100) : 100;
    $('[data-stat="pct"]').textContent = `${pct}%`;
    $('[data-stat="done"]').textContent = String(session.results.length);
    $('[data-stat="left"]').textContent = String(session.remaining);
    const total = session.results.length + session.remaining;
    $('[data-bar]').style.width = `${total ? (session.results.length / total) * 100 : 0}%`;
  }

  function show() {
    q = session.next();
    if (!q) {
      setKana(false);
      opts.onFinish(session);
      return;
    }
    answered = null;
    const v = q.item;
    character.className = `character ${q.type} ${v.kind}`;
    if (v.kind === 'kanji') {
      // Kanji: always show the character; the prompt says which answer we want.
      character.innerHTML = `<div class="char-main kanji">${esc(v.char)}</div>`;
      const label = { meaning: 'Meaning', onyomi: "On'yomi", kunyomi: "Kun'yomi", reading: 'Reading' }[q.type];
      prompt.className = `prompt ${q.type === 'meaning' ? 'meaning' : 'reading'} kanji`;
      prompt.innerHTML = `Kanji <b>${label}</b>`;
      input.placeholder = q.type === 'meaning' ? 'Your Response' : q.type === 'onyomi' ? "on'yomi" : "kun'yomi";
    } else if (q.type === 'meaning') {
      character.innerHTML = `<div class="char-main">${esc(display(v))}</div>${v.kanji ? `<div class="char-sub">${esc(v.kana)}</div>` : ''}`;
      prompt.className = 'prompt meaning';
      prompt.innerHTML = 'Vocabulary <b>Meaning</b>';
      input.placeholder = 'Your Response';
    } else {
      const long = v.en.length > 28;
      character.innerHTML = `<div class="char-main en ${long ? 'long' : ''}">${esc(v.en)}</div><div class="char-sub">${esc(POS_LABEL[v.pos] ?? v.pos)}</div>`;
      prompt.className = 'prompt reading';
      prompt.innerHTML = 'Vocabulary <b>Japanese</b>';
      input.placeholder = '答え';
    }
    input.value = '';
    input.disabled = false;
    input.className = '';
    input.lang = q.type === 'meaning' ? 'en' : 'ja';
    setKana(q.type !== 'meaning');
    msg.textContent = '';
    actions.hidden = true;
    infoPanel.hidden = true;
    updateStats();
    input.focus();
    opts.onChange?.();
  }

  function finishItem(r: ItemResult | null) {
    if (r) opts.onItemDone(r);
  }

  function submit() {
    if (!q) return;
    if (answered) return advance();
    const v = q.item;
    let value = input.value;
    if (q.type !== 'meaning') {
      value = toHiragana(value, { IMEMode: true });
      input.value = value;
    }
    const verdict =
      q.type === 'meaning'
        ? checkMeaning(v, value, progress(v.id)?.synonyms ?? [])
        : v.kind === 'kanji'
          ? checkKanjiReading(v, q.type === 'kunyomi' ? 'kunyomi' : 'onyomi', value)
          : checkReading(v, value);
    if (verdict.kind === 'shake') {
      msg.textContent = verdict.message;
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
      return;
    }
    answered = verdict;
    typed = value;
    const correct = verdict.kind === 'correct';
    input.disabled = true;
    input.className = correct ? 'correct' : 'incorrect';
    msg.textContent = !correct ? '' : verdict.note ?? (verdict.close ? `Close enough! The answer was “${gloss(v)}”.` : '');
    actions.hidden = false;
    rightBtn.hidden = correct;
    if (opts.mode === 'review') recordStat(q, correct);
    if (correct && v.kind === 'vocab' && q.type === 'reading' && localPrefs().autoplay) {
      playAudio(wordAudio(v.id), v.kana.replace(/[（）()～]/g, ''));
    }
    finishItem(session.answer(q, correct));
    updateStats();
    opts.onChange?.();
    if (!correct) showInfo();
    root.focus();
  }

  function recordStat(question: Question, correct: boolean) {
    const p = progress(question.item.id);
    if (!p) return;
    // A kanji's on'yomi/kun'yomi answers count toward its reading stats.
    const kind = question.type === 'meaning' ? 'meaning' : 'reading';
    const key = `${kind}${correct ? 'Correct' : 'Incorrect'}` as const;
    updateItem(question.item.id, { [key]: p[key] + 1 });
  }

  function overrule() {
    if (!q || !answered || answered.kind !== 'incorrect') return;
    const v = q.item;
    if (opts.mode === 'review') {
      const p = progress(v.id)!;
      const patch: Record<string, number | string[]> =
        q.type === 'meaning'
          ? { meaningIncorrect: Math.max(0, p.meaningIncorrect - 1), meaningCorrect: p.meaningCorrect + 1 }
          : { readingIncorrect: Math.max(0, p.readingIncorrect - 1), readingCorrect: p.readingCorrect + 1 };
      updateItem(v.id, patch);
    }
    // Remember the typed English as a synonym so it's accepted next time.
    const p = progress(v.id);
    if (q.type === 'meaning' && p && typed.trim() && !p.synonyms.includes(typed.trim())) {
      updateItem(v.id, { synonyms: [...p.synonyms, typed.trim()] });
    }
    answered = { kind: 'correct', close: false };
    input.className = 'correct';
    rightBtn.hidden = true;
    msg.textContent = q.type === 'meaning' ? `Marked correct — “${typed.trim()}” added as a synonym.` : 'Marked correct.';
    finishItem(session.overrule(q));
    updateStats();
    opts.onChange?.();
  }

  function showInfo() {
    if (!q) return;
    infoPanel.innerHTML = itemDetailHtml(q.item);
    bindCommon(infoPanel);
    infoPanel.hidden = false;
  }

  function advance() {
    show();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  $('[data-next]').addEventListener('click', advance);
  $('[data-info]').addEventListener('click', () => (infoPanel.hidden ? showInfo() : (infoPanel.hidden = true)));
  rightBtn.addEventListener('click', overrule);
  $('.quiz-exit').addEventListener('click', () => opts.onExit?.());
  root.querySelector('[data-wrap]')?.addEventListener('click', (e) => {
    session.wrapUp();
    opts.onChange?.();
    (e.target as HTMLButtonElement).disabled = true;
    (e.target as HTMLButtonElement).textContent = 'Wrapping up…';
    updateStats();
  });

  const onKey = (e: KeyboardEvent) => {
    if (!answered || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      advance();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      if (infoPanel.hidden) showInfo();
      else infoPanel.hidden = true;
    } else if ((e.key === 'r' || e.key === 'R') && !rightBtn.hidden) {
      e.preventDefault();
      overrule();
    }
  };
  document.addEventListener('keydown', onKey);
  root.tabIndex = -1;

  show();
  return () => {
    document.removeEventListener('keydown', onKey);
    setKana(false);
  };
}
