// Progress storage: always cached in localStorage, synced to the Rust backend when one is reachable.

import { ITEMS, type Item } from './data';

export interface ItemProgress {
  stage: number;
  unlockedAt: number;
  nextReview: number | null;
  burnedAt: number | null;
  lastReviewed: number | null;
  meaningCorrect: number;
  meaningIncorrect: number;
  readingCorrect: number;
  readingIncorrect: number;
  synonyms: string[];
  updatedAt: number;
}

export type QuestionTypes = 'both' | 'meaning' | 'reading';

export interface Settings {
  currentChapter: number;
  includeReading: boolean;
  includeExtra: boolean;
  includeKanji: boolean;
  batchSize: number;
  questionTypes: QuestionTypes;
  updatedAt: number;
}

export interface Doc {
  items: Record<string, ItemProgress>;
  settings: Settings;
}

/** Per-device preferences; never synced. */
export interface LocalPrefs {
  apiBase: string;
  token: string;
  furigana: boolean;
  autoplay: boolean;
}

export type SyncStatus = { state: 'offline' | 'syncing' | 'synced' | 'error'; message: string };

const DOC_KEY = 'genki-kani:doc';
const PREFS_KEY = 'genki-kani:prefs';

const DEFAULT_SETTINGS: Settings = {
  currentChapter: 14,
  includeReading: true,
  includeExtra: true,
  includeKanji: true,
  batchSize: 5,
  questionTypes: 'both',
  updatedAt: 0,
};

// Static hosts like GitHub Pages have no backend, so don't go looking for one there by default.
const STATIC_HOST = /\.github\.io$/.test(location.hostname);
const DEFAULT_PREFS: LocalPrefs = { apiBase: STATIC_HOST ? '' : './api', token: '', furigana: true, autoplay: true };

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked; the backend copy (if any) still has it */
  }
}

const stored = readJson<Partial<Doc>>(DOC_KEY);
let doc: Doc = {
  items: stored?.items ?? {},
  settings: { ...DEFAULT_SETTINGS, ...stored?.settings },
};
let prefs: LocalPrefs = { ...DEFAULT_PREFS, ...readJson<Partial<LocalPrefs>>(PREFS_KEY) };
let status: SyncStatus = { state: 'offline', message: 'Saved in this browser only' };

const listeners = new Set<() => void>();
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(): void {
  listeners.forEach((fn) => fn());
}

// ---------- reads ----------

export const settings = (): Settings => doc.settings;
export const localPrefs = (): LocalPrefs => prefs;
export const syncStatus = (): SyncStatus => status;
export const progress = (id: string): ItemProgress | undefined => doc.items[id];
export const exportDoc = (): Doc => structuredClone(doc);

/** Items that are part of the user's current study scope (chapter <= current, source/kanji filters). */
export function inScope(item: Item, s = doc.settings): boolean {
  if (item.chapter > s.currentChapter) return false;
  if (item.kind === 'kanji') return s.includeKanji;
  if (item.source === 'read' && !s.includeReading) return false;
  if (item.source === 'extra' && !s.includeExtra) return false;
  return true;
}

/** Unstarted items in scope, by chapter; within a chapter, its kanji come before its words. */
export function lessonQueue(): Item[] {
  return ITEMS.filter((i) => inScope(i) && !doc.items[i.id]).sort((a, b) => a.chapter - b.chapter);
}

export function dueReviews(now = Date.now()): Item[] {
  return ITEMS.filter((v) => {
    const p = doc.items[v.id];
    return p && p.nextReview !== null && p.nextReview <= now;
  });
}

// ---------- writes ----------

function save(): void {
  writeJson(DOC_KEY, doc);
  emit();
  scheduleSync();
}

export function updateItem(id: string, patch: Partial<ItemProgress>): void {
  const base: ItemProgress = doc.items[id] ?? {
    stage: 0,
    unlockedAt: Date.now(),
    nextReview: null,
    burnedAt: null,
    lastReviewed: null,
    meaningCorrect: 0,
    meaningIncorrect: 0,
    readingCorrect: 0,
    readingIncorrect: 0,
    synonyms: [],
    updatedAt: 0,
  };
  doc.items[id] = { ...base, ...patch, updatedAt: Date.now() };
  save();
}

export function updateSettings(patch: Partial<Settings>): void {
  doc.settings = { ...doc.settings, ...patch, updatedAt: Date.now() };
  save();
}

export function updatePrefs(patch: Partial<LocalPrefs>): void {
  prefs = { ...prefs, ...patch };
  writeJson(PREFS_KEY, prefs);
  emit();
  if ('apiBase' in patch || 'token' in patch) void initSync();
}

export function importDoc(incoming: Doc): void {
  mergeInto(incoming);
  save();
}

export async function resetAll(): Promise<void> {
  doc = { items: {}, settings: { ...DEFAULT_SETTINGS, updatedAt: Date.now() } };
  writeJson(DOC_KEY, doc);
  if (status.state === 'synced') {
    try {
      await api('DELETE');
    } catch (e) {
      setStatus('error', `Reset locally, but the server reset failed: ${String(e)}`);
    }
  }
  save();
}

// ---------- sync ----------

function mergeInto(incoming: Partial<Doc>): void {
  for (const [id, item] of Object.entries(incoming.items ?? {})) {
    const cur = doc.items[id];
    if (!cur || item.updatedAt > cur.updatedAt) doc.items[id] = item;
  }
  if (incoming.settings && incoming.settings.updatedAt > doc.settings.updatedAt) {
    doc.settings = { ...DEFAULT_SETTINGS, ...incoming.settings };
  }
}

function setStatus(state: SyncStatus['state'], message: string): void {
  status = { state, message };
  emit();
}

async function api(method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<Doc | null> {
  const base = prefs.apiBase.replace(/\/$/, '');
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (prefs.token) headers.Authorization = `Bearer ${prefs.token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${base}/state`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (res.status === 401) throw new Error('server rejected the token');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (method === 'DELETE') return null;
    const type = res.headers.get('content-type') ?? '';
    // A static host may answer /api/state with index.html; that means "no backend".
    if (!type.includes('json')) throw new Error('no backend');
    return (await res.json()) as Doc;
  } finally {
    clearTimeout(timer);
  }
}

let syncTimer: ReturnType<typeof setTimeout> | undefined;
let backendAvailable = false;

function scheduleSync(): void {
  if (!backendAvailable) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void pushNow(), 800);
}

async function pushNow(): Promise<void> {
  setStatus('syncing', 'Syncing…');
  try {
    const merged = await api('POST', doc);
    if (merged) {
      mergeInto(merged);
      writeJson(DOC_KEY, doc);
    }
    setStatus('synced', 'Synced with server');
  } catch (e) {
    setStatus('error', `Sync failed (${String(e)}); will retry. Progress is safe in this browser.`);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void pushNow(), 30_000);
  }
}

/** Detect the backend, pull its state, and push ours. Safe to call repeatedly. */
export async function initSync(): Promise<void> {
  backendAvailable = false;
  if (!prefs.apiBase.trim()) {
    setStatus('offline', 'Saved in this browser only (sync disabled)');
    return;
  }
  setStatus('syncing', 'Connecting…');
  try {
    const remote = await api('GET');
    if (remote) mergeInto(remote);
    writeJson(DOC_KEY, doc);
    backendAvailable = true;
    emit();
    await pushNow();
  } catch (e) {
    const msg = String(e).includes('no backend') || String(e).includes('404')
      ? 'No server found; saved in this browser only'
      : `Couldn't reach server (${String(e)}); saved in this browser only`;
    setStatus('offline', msg);
  }
}

// Pick up changes made in another tab.
window.addEventListener('storage', (e) => {
  if (e.key === DOC_KEY && e.newValue) {
    mergeInto(JSON.parse(e.newValue) as Doc);
    emit();
  }
});
