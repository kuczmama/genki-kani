import { localPrefs } from './store';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const RUBY = /([㐀-鿿々〆ヶ0-9０-９]+)\[([^\]]+)\]/g;

/** Render `日本[にほん]で{雪[ゆき]}を見[み]た` as ruby HTML with the target word highlighted. */
export function renderJa(s: string): string {
  return esc(s)
    .replace(RUBY, (_, base: string, rt: string) => {
      // Digits before kanji (1960年代) stay outside the ruby.
      const m = base.match(/^([0-9０-９]*)(.*)$/)!;
      return `${m[1]}<ruby>${m[2]}<rt>${rt}</rt></ruby>`;
    })
    .replace(/\{/g, '<mark>')
    .replace(/\}/g, '</mark>');
}

/** Plain text with readings substituted for kanji (for text-to-speech). */
export function jaReading(s: string): string {
  return s.replace(RUBY, (_, base: string, rt: string) => base.replace(/[^0-9０-９]/g, '') + rt).replace(/[{}]/g, '');
}

export function jaPlain(s: string): string {
  return s.replace(/\[[^\]]*\]/g, '').replace(/[{}]/g, '');
}

let player: HTMLAudioElement | null = null;

/** Play a pre-generated Kokoro clip; fall back to the browser's voice if it's missing. */
export function playAudio(src: string, fallbackText: string): void {
  player?.pause();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const audio = new Audio(src);
  player = audio;
  let fellBack = false;
  const fallback = () => {
    if (fellBack || player !== audio) return;
    fellBack = true;
    speak(fallbackText);
  };
  audio.addEventListener('error', fallback);
  audio.play().catch((e: DOMException) => {
    // Autoplay blocked before any user gesture: stay quiet rather than fall back.
    if (e.name !== 'NotAllowedError') fallback();
  });
}

export const wordAudio = (id: string) => `audio/${id}.mp3`;
export const sentenceAudio = (id: string, i: number) => `audio/${id}-${i}.mp3`;

let jaVoice: SpeechSynthesisVoice | null | undefined;
function speak(text: string): void {
  if (!('speechSynthesis' in window)) return;
  if (jaVoice === undefined) {
    jaVoice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('ja')) ?? null;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  if (jaVoice) u.voice = jaVoice;
  speechSynthesis.speak(u);
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => (jaVoice = undefined);

export function furiganaClass(): string {
  return localPrefs().furigana ? '' : 'no-furigana';
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function relTime(ts: number, now = Date.now()): string {
  const diff = ts - now;
  if (diff <= 0) return 'now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  if (days < 60) return `in ${days} days`;
  return `in ${Math.round(days / 30)} months`;
}
