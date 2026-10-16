import { BY_ID, CHAPTERS, ITEMS, display, gloss, type Item } from '../data';
import { GROUPS, groupOf } from '../srs';
import { dueReviews, exportDoc, inScope, lessonQueue, settings } from '../store';
import { esc, relTime } from '../util';
import { itemTile } from './components';

const GROUP_LABEL = { apprentice: 'Apprentice', guru: 'Guru', master: 'Master', enlightened: 'Enlightened', burned: 'Burned' };

export function renderDashboard(): string {
  const s = settings();
  const doc = exportDoc();
  const lessons = lessonQueue().length;
  const reviews = dueReviews().length;
  const now = Date.now();

  const counts = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<string, number>;
  const upcoming: number[] = [];
  for (const p of Object.values(doc.items)) {
    const g = groupOf(p.stage);
    if (g) counts[g]++;
    if (p.nextReview && p.nextReview > now) upcoming.push(p.nextReview);
  }
  upcoming.sort((a, b) => a - b);

  // Forecast: reviews arriving in each of the next 24 hours.
  const HOUR = 3600_000;
  const startHour = Math.floor(now / HOUR) * HOUR;
  const buckets = new Map<number, number>();
  for (const t of upcoming) {
    if (t - now > 24 * HOUR) break;
    const h = Math.floor(t / HOUR) * HOUR;
    buckets.set(h, (buckets.get(h) ?? 0) + 1);
  }
  let running = reviews;
  const forecastRows = [...buckets.entries()]
    .map(([h, n]) => {
      running += n;
      const d = new Date(h);
      const label = h - startHour < 24 * HOUR && d.getDate() === new Date(now).getDate() ? 'Today' : 'Tomorrow';
      const time = d.toLocaleTimeString([], { hour: 'numeric' });
      return `<li><span>${label} ${time}</span><b>+${n}</b><span class="muted">${running}</span></li>`;
    })
    .join('');

  const nextReview = reviews ? 'Available now' : upcoming.length ? `Next review ${relTime(upcoming[0])}` : 'No reviews scheduled yet';

  const chapters = CHAPTERS.filter((c) => c <= s.currentChapter).reverse();
  const chapterBlocks = chapters
    .map((c) => {
      const items = ITEMS.filter((v) => v.chapter === c && inScope(v));
      const kanji = items.filter((i) => i.kind === 'kanji');
      const words = items.filter((i) => i.kind === 'vocab');
      const guruCount = (list: Item[]) => list.filter((v) => (doc.items[v.id]?.stage ?? 0) >= 5).length;
      const guru = guruCount(items);
      const pct = items.length ? Math.round((guru / items.length) * 100) : 0;
      const group = (label: string, list: Item[]) =>
        list.length
          ? `<div class="tile-group"><h3>${label} <span class="muted">${guruCount(list)} / ${list.length} guru+</span></h3><div class="tiles">${list.map(itemTile).join('')}</div></div>`
          : '';
      return `
      <section class="card chapter-progress">
        <div class="card-head">
          <h2><a href="#/chapter/${c}">Chapter ${c}</a></h2>
          <span class="muted">${guru} / ${items.length} at Guru or above · ${pct}%</span>
        </div>
        <div class="bar"><div style="width:${pct}%"></div></div>
        ${group('Kanji', kanji)}
        ${group('Vocabulary', words)}
      </section>`;
    })
    .join('');

  const critical = Object.entries(doc.items)
    .filter(([, p]) => p.stage > 0 && p.stage <= 4)
    .map(([id, p]) => {
      const total = p.meaningCorrect + p.meaningIncorrect + p.readingCorrect + p.readingIncorrect;
      const wrong = p.meaningIncorrect + p.readingIncorrect;
      return { id, pct: total ? (total - wrong) / total : 1, wrong };
    })
    .filter((x) => x.wrong > 0 && x.pct < 0.75)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 10);

  const criticalHtml = critical.length
    ? `<ul class="list">${critical
        .map(({ id, pct }) => {
          const v = BY_ID.get(id)!;
          return `<li><a href="#/item/${id}"><span class="ja ${v.kind}" lang="ja">${esc(display(v))}</span><span class="en">${esc(gloss(v))}</span><b>${Math.round(pct * 100)}%</b></a></li>`;
        })
        .join('')}</ul>`
    : '<p class="muted">Nothing critical. Nice work!</p>';

  return `
  <main class="container dashboard">
    <div class="hero">
      <a class="hero-card lessons ${lessons ? '' : 'empty'}" href="#/lessons">
        <div><h2>Lessons</h2><p>${lessons ? 'New Genki words are waiting for you.' : `You've learned everything up to chapter ${s.currentChapter}.`}</p></div>
        <span class="hero-count">${lessons}</span>
      </a>
      <a class="hero-card reviews ${reviews ? '' : 'empty'}" href="#/reviews">
        <div><h2>Reviews</h2><p>${esc(nextReview)}</p></div>
        <span class="hero-count">${reviews}</span>
      </a>
    </div>

    <section class="srs-row">
      ${GROUPS.map((g) => `<div class="srs-box srs-${g}"><b>${counts[g]}</b><span>${GROUP_LABEL[g]}</span></div>`).join('')}
    </section>

    <div class="dash-grid">
      <div class="dash-main">${chapterBlocks}</div>
      <aside class="dash-side">
        <section class="card">
          <div class="card-head"><h2>Review forecast</h2></div>
          ${forecastRows ? `<ul class="forecast">${forecastRows}</ul>` : '<p class="muted">Nothing due in the next 24 hours.</p>'}
        </section>
        <section class="card">
          <div class="card-head"><h2>Critical items</h2></div>
          ${criticalHtml}
        </section>
      </aside>
    </div>
  </main>`;
}
