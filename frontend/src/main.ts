import './style.css';
import { initSync, subscribe } from './store';
import { footerHtml, navHtml, bindCommon } from './views/components';
import { renderDashboard } from './views/dashboard';
import { renderChapter, renderChapters, renderItem, renderSettings } from './views/pages';
import { renderSearchResults } from './views/search';
import { startLessons, startPractice, startReviews } from './views/sessions';

const app = document.getElementById('app')!;
let cleanup: () => void = () => {};
/** Static pages re-render when progress or sync status changes; sessions manage themselves. */
let isStatic = true;

/** "#/item/k%E9%A3%9F" → ["", "item", "k食"]: kanji ids get percent-encoded by the browser. */
function hashParts(): string[] {
  return location.hash
    .replace(/^#/, '')
    .split('/')
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
}
// Sessions wait for the first server sync so a fresh device sees its real queue.
const firstSync = initSync();
let routeId = 0;

async function route(): Promise<void> {
  const id = ++routeId;
  cleanup();
  cleanup = () => {};
  window.scrollTo(0, 0);
  const [, page = '', arg] = hashParts();

  if (page === 'reviews' || page === 'lessons' || page === 'practice') {
    isStatic = false;
    document.body.className = 'in-session';
    app.innerHTML = '<div id="view"><p class="footer">Loading…</p></div>';
    await firstSync;
    if (id !== routeId) return;
    const view = document.getElementById('view')!;
    cleanup =
      page === 'reviews'
        ? startReviews(view)
        : page === 'lessons'
          ? startLessons(view)
          : startPractice(view, Number(arg), location.hash.endsWith('/kanji') ? 'kanji' : 'vocab');
    return;
  }
  isStatic = true;
  document.body.className = '';
  render();
}

function searchQuery(): string {
  const m = location.hash.match(/^#\/search\/?(.*)$/);
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function bindSearch(view: HTMLElement): void {
  const form = app.querySelector<HTMLFormElement>('[data-search]')!;
  const input = form.querySelector('input')!;
  const go = () => {
    const hash = `#/search/${encodeURIComponent(input.value.trim())}`;
    if (location.hash.startsWith('#/search')) {
      // Update results in place; replaceState keeps typing out of the back-button history.
      history.replaceState(null, '', hash);
      renderSearchResults(view, input.value);
    } else {
      location.hash = hash;
    }
  };
  input.addEventListener('input', go);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    go();
    // Enter on a single obvious hit opens it.
    const first = view.querySelector<HTMLAnchorElement>('.vocab-list a');
    if (first && view.querySelectorAll('.vocab-list a').length === 1) location.hash = first.hash;
  });
  if (location.hash.startsWith('#/search')) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

// "/" focuses search from anywhere outside a text field.
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (e.key !== '/' || !isStatic || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
  const input = app.querySelector<HTMLInputElement>('[data-search] input');
  if (input) {
    e.preventDefault();
    input.focus();
  }
});

function render(): void {
  const [, page = '', arg] = hashParts();
  const navKey = page === '' ? 'dash' : page === 'chapter' || page === 'item' ? 'chapters' : page;
  const query = searchQuery();
  app.innerHTML = `${navHtml(navKey, query)}<div id="view"></div>${footerHtml()}`;
  const view = document.getElementById('view')!;
  bindSearch(view);
  switch (page) {
    case 'search':
      renderSearchResults(view, query);
      break;
    case 'chapters':
      renderChapters(view);
      break;
    case 'chapter':
      renderChapter(view, Number(arg));
      break;
    case 'item':
      renderItem(view, arg);
      break;
    case 'settings':
      renderSettings(view);
      break;
    default:
      view.innerHTML = renderDashboard();
      bindCommon(view);
  }
}

let pending = false;
subscribe(() => {
  if (!isStatic || pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    // Don't yank a text field out from under the user.
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.type !== 'checkbox') return;
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  });
});

window.addEventListener('hashchange', () => void route());
// Keep "reviews available" counts fresh.
setInterval(() => isStatic && render(), 60_000);

void route();
