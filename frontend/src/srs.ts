// WaniKani-style SRS stages and intervals.

export const BURNED = 9;

const HOUR = 3600_000;
/** Hours until the next review after reaching a stage. */
const INTERVAL_HOURS: Record<number, number> = {
  1: 4,
  2: 8,
  3: 23,
  4: 47,
  5: 167,
  6: 335,
  7: 719,
  8: 2879,
};

export type SrsGroup = 'apprentice' | 'guru' | 'master' | 'enlightened' | 'burned';

export const GROUPS: SrsGroup[] = ['apprentice', 'guru', 'master', 'enlightened', 'burned'];

export function groupOf(stage: number): SrsGroup | null {
  if (stage <= 0) return null;
  if (stage <= 4) return 'apprentice';
  if (stage <= 6) return 'guru';
  if (stage === 7) return 'master';
  if (stage === 8) return 'enlightened';
  return 'burned';
}

export function stageName(stage: number): string {
  const roman = ['', 'I', 'II', 'III', 'IV'];
  if (stage <= 0) return 'Lesson';
  if (stage <= 4) return `Apprentice ${roman[stage]}`;
  if (stage <= 6) return `Guru ${roman[stage - 4]}`;
  if (stage === 7) return 'Master';
  if (stage === 8) return 'Enlightened';
  return 'Burned';
}

/** Next review time for an item that just reached `stage` (null once burned). */
export function nextReviewAt(stage: number, now = Date.now()): number | null {
  const hours = INTERVAL_HOURS[stage];
  if (!hours) return null;
  // Round down to the hour like WaniKani so reviews arrive in batches.
  return Math.floor((now + hours * HOUR) / HOUR) * HOUR;
}

/** WaniKani's formula for the new stage after a review. */
export function newStage(stage: number, incorrect: number): number {
  if (incorrect === 0) return Math.min(stage + 1, BURNED);
  const penalty = stage >= 5 ? 2 : 1;
  return Math.max(1, stage - Math.ceil(incorrect / 2) * penalty);
}
