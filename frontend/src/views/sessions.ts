// Lessons, reviews and practice sessions.
//
// Each session saves its state to sessionStorage after every step, so refreshing the
// page resumes it (same card, same unanswered question). Leaving with ✕ or finishing
// throws the saved state away.

import { BY_ID, ITEMS, display, gloss, type Item } from '../data';
import { Session, type ItemResult, type Snapshot } from '../session';
import { newStage, nextReviewAt, stageName, BURNED } from '../srs';
import { dueReviews, lessonQueue, progress, settings, updateItem } from '../store';
import { esc } from '../util';
import { bindCommon, itemDetailHtml } from './components';
import { runQuiz } from './quiz';

type Cleanup = () => void;
type Done = { item: Item; ok: boolean; note?: string };
type SavedDone = { id: string; ok: boolean; note?: string };

const key = (k: string) => `genki-kani:session:${k}`;

function load<T>(k: string): T | null {
  try {
    const raw = sessionStorage.getItem(key(k));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(k: string, value: unknown): void {
  try {
    sessionStorage.setItem(key(k), JSON.stringify(value));
  } catch {
    /* storage unavailable: refresh just restarts the session */
  }
}

function clear(k: string): void {
  try {
    sessionStorage.removeItem(key(k));
  } catch {
    /* ignore */
  }
}

const toSaved = (d: Done[]): SavedDone[] => d.map((x) => ({ id: x.item.id, ok: x.ok, note: x.note }));
const fromSaved = (d: SavedDone[]): Done[] =>
  d.flatMap((x) => (BY_ID.has(x.id) ? [{ item: BY_ID.get(x.id)!, ok: x.ok, note: x.note }] : []));

function summary(root: HTMLElement, title: string, results: Done[], actions: string): void {
  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  const row = (r: Done) =>
    `<a class="sum-item ${r.item.kind}" href="#/item/${r.item.id}"><span lang="ja">${esc(display(r.item))}</span><small>${esc(gloss(r.item))}</small>${r.note ? `<em>${esc(r.note)}</em>` : ''}</a>`;
  root.innerHTML = `
  <main class="container summary">
    <section class="card">
      <div class="card-head"><h2>${esc(title)}</h2>
        <span class="muted">${results.length ? Math.round((ok.length / results.length) * 100) : 100}% of items answered with no mistakes</span></div>
      ${bad.length ? `<h3 class="sum-h bad">${bad.length} answered incorrectly</h3><div class="sum-grid">${bad.map(row).join('')}</div>` : ''}
      ${ok.length ? `<h3 class="sum-h good">${ok.length} answered correctly</h3><div class="sum-grid">${ok.map(row).join('')}</div>` : ''}
      <div class="sum-actions">${actions}</div>
    </section>
  </main>`;
}

// ---------- reviews ----------

interface SavedReview {
  snapshot: Snapshot;
  done: SavedDone[];
}

export function startReviews(root: HTMLElement, fresh = false): Cleanup {
  if (fresh) clear('review');
  const saved = load<SavedReview>('review');
  let session = saved ? Session.restore(saved.snapshot) : null;
  const done: Done[] = session && saved ? fromSaved(saved.done) : [];
  if (!session || session.done) {
    const due = dueReviews();
    if (!due.length) {
      clear('review');
      summary(root, 'No reviews right now', [], '<a class="btn" href="#/">Back to dashboard</a>');
      return () => {};
    }
    session = new Session(due, settings().questionTypes);
    done.length = 0;
  }
  const s = session;
  return runQuiz(root, s, {
    mode: 'review',
    title: 'Reviews',
    exitHref: '#/',
    onChange: () => save('review', { snapshot: s.snapshot(), done: toSaved(done) } satisfies SavedReview),
    onExit: () => clear('review'),
    onItemDone(r: ItemResult) {
      const p = progress(r.item.id)!;
      const now = Date.now();
      const wrong = r.meaningWrong + r.readingWrong;
      const stage = newStage(p.stage, wrong);
      updateItem(r.item.id, {
        stage,
        nextReview: nextReviewAt(stage, now),
        burnedAt: stage === BURNED ? now : null,
        lastReviewed: now,
      });
      const arrow = stage > p.stage ? '▲' : stage < p.stage ? '▼' : '';
      done.push({ item: r.item, ok: wrong === 0, note: `${arrow} ${stageName(stage)}` });
    },
    onFinish() {
      clear('review');
      const left = dueReviews().length;
      summary(
        root,
        'Review summary',
        done,
        `${left ? `<a class="btn reviews" href="#/reviews" data-restart>Keep going (${left} more)</a>` : ''}
         <a class="btn" href="#/">Dashboard</a>`,
      );
      root.querySelector('[data-restart]')?.addEventListener('click', (e) => {
        e.preventDefault();
        startReviews(root, true);
      });
    },
  });
}

// ---------- lessons ----------

interface SavedLesson {
  batch: string[];
  idx: number;
  quiz: Snapshot | null;
}

export function startLessons(root: HTMLElement, fresh = false): Cleanup {
  if (fresh) clear('lesson');
  const saved = load<SavedLesson>('lesson');
  let batch: Item[] = saved && saved.batch.every((id) => BY_ID.has(id)) ? saved.batch.map((id) => BY_ID.get(id)!) : [];
  if (!batch.length) batch = lessonQueue().slice(0, Math.max(1, settings().batchSize));
  if (!batch.length) {
    clear('lesson');
    summary(root, 'No lessons available', [], `<p class="muted">You've started every word up to chapter ${settings().currentChapter}. Move on to the next chapter in <a href="#/chapters">Chapters</a> or <a href="#/settings">Settings</a>.</p><a class="btn" href="#/">Dashboard</a>`);
    return () => {};
  }
  let idx = saved && batch.length === saved.batch.length ? Math.min(saved.idx, batch.length - 1) : 0;
  let cleanup: Cleanup = () => {};
  const persist = (quiz: Snapshot | null) => save('lesson', { batch: batch.map((v) => v.id), idx, quiz } satisfies SavedLesson);

  function card() {
    persist(null);
    const v = batch[idx];
    root.innerHTML = `
    <div class="lesson">
      <div class="quiz-top">
        <a class="quiz-exit" href="#/" title="Leave">✕</a>
        <span class="quiz-title">${v.kind === 'kanji' ? 'Kanji' : 'Vocabulary'} lesson · Chapter ${v.chapter}</span>
        <span class="muted">${idx + 1} / ${batch.length}</span>
      </div>
      <div class="character meaning lesson-char ${v.kind}" lang="ja">
        <div class="char-main ${v.kind === 'kanji' ? 'kanji' : ''}">${esc(display(v))}</div>
        <div class="char-sub en">${esc(gloss(v))}</div>
      </div>
      <div class="lesson-body container">
        ${itemDetailHtml(v)}
      </div>
      <div class="lesson-nav">
        <button type="button" class="btn" data-prev ${idx === 0 ? 'disabled' : ''}>← Back</button>
        <div class="lesson-chips">${batch
          .map((b, i) => `<button type="button" class="chip ${b.kind} ${i === idx ? 'on' : ''}" data-go="${i}" lang="ja">${esc(display(b))}</button>`)
          .join('')}</div>
        ${idx < batch.length - 1
          ? '<button type="button" class="btn lessons" data-next>Next →</button>'
          : '<button type="button" class="btn lessons" data-quiz>Start quiz →</button>'}
      </div>
    </div>`;
    bindCommon(root);
    root.querySelector('.quiz-exit')!.addEventListener('click', () => clear('lesson'));
    root.querySelector('[data-prev]')?.addEventListener('click', () => go(idx - 1));
    root.querySelector('[data-next]')?.addEventListener('click', () => go(idx + 1));
    root.querySelector('[data-quiz]')?.addEventListener('click', () => quiz(null));
    root.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.go))));
  }

  function go(i: number) {
    idx = Math.max(0, Math.min(batch.length - 1, i));
    card();
  }

  const onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (!root.querySelector('.lesson') || tag === 'INPUT' || (tag === 'BUTTON' && e.key === 'Enter')) return;
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      if (idx < batch.length - 1) go(idx + 1);
      else quiz(null);
    } else if (e.key === 'ArrowLeft') go(idx - 1);
  };
  document.addEventListener('keydown', onKey);

  function quiz(snapshot: Snapshot | null) {
    document.removeEventListener('keydown', onKey);
    const session = (snapshot && Session.restore(snapshot)) || new Session(batch, settings().questionTypes);
    cleanup = runQuiz(root, session, {
      mode: 'lesson',
      title: 'Lesson quiz',
      exitHref: '#/',
      onChange: () => persist(session.snapshot()),
      onExit: () => clear('lesson'),
      onItemDone(r) {
        const now = Date.now();
        updateItem(r.item.id, { stage: 1, unlockedAt: now, nextReview: nextReviewAt(1, now) });
      },
      onFinish() {
        clear('lesson');
        const left = lessonQueue().length;
        summary(
          root,
          'Lesson complete!',
          batch.map((item) => ({ item, ok: true, note: 'Apprentice I' })),
          `<p class="muted">These words will show up in reviews in about 4 hours.</p>
           ${left ? `<a class="btn lessons" href="#/lessons" data-more>Next ${Math.min(left, settings().batchSize)} lessons (${left} left)</a>` : ''}
           <a class="btn" href="#/">Dashboard</a>`,
        );
        root.querySelector('[data-more]')?.addEventListener('click', (e) => {
          e.preventDefault();
          cleanup = startLessons(root, true);
        });
      },
    });
  }

  if (saved?.quiz && batch.length === saved.batch.length) quiz(saved.quiz);
  else card();
  return () => {
    document.removeEventListener('keydown', onKey);
    cleanup();
  };
}

// ---------- practice ----------

export type PracticeKind = 'vocab' | 'kanji';

interface SavedPractice {
  chapter: number;
  kind: PracticeKind;
  snapshot: Snapshot;
  done: SavedDone[];
}

/** Extra study for a chapter's words or kanji: doesn't touch SRS progress. */
export function startPractice(root: HTMLElement, chapter: number, kind: PracticeKind = 'vocab'): Cleanup {
  const all = ITEMS.filter((v) => v.chapter === chapter && v.kind === kind);
  const learned = all.filter((v) => (progress(v.id)?.stage ?? 0) > 0);
  const saved = load<SavedPractice>('practice');
  const restored = saved && saved.chapter === chapter && saved.kind === kind ? Session.restore(saved.snapshot) : null;
  const session = restored && !restored.done ? restored : new Session(learned.length ? learned : all, settings().questionTypes);
  const results: Done[] = session === restored && saved ? fromSaved(saved.done) : [];
  return runQuiz(root, session, {
    mode: 'practice',
    title: `Practice ${kind === 'kanji' ? 'kanji' : 'words'} · Chapter ${chapter}${learned.length ? '' : ' (all)'}`,
    exitHref: `#/chapter/${chapter}`,
    onChange: () => save('practice', { chapter, kind, snapshot: session.snapshot(), done: toSaved(results) } satisfies SavedPractice),
    onExit: () => clear('practice'),
    onItemDone(r) {
      results.push({ item: r.item, ok: r.meaningWrong + r.readingWrong === 0 });
    },
    onFinish() {
      clear('practice');
      summary(
        root,
        `Practice complete · Chapter ${chapter}`,
        results,
        `<p class="muted">Practice doesn't change your SRS progress.</p>
         <a class="btn" href="#/chapter/${chapter}">Back to chapter</a><a class="btn" href="#/">Dashboard</a>`,
      );
    },
  });
}
