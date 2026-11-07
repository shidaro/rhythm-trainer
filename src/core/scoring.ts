// Scoring a played rhythm: one-to-one matching of taps to expected onsets.

import { GOOD_MS, grade } from './timing';
import type { Grade } from './timing';

export interface NoteResult {
  /** Index of the event in the flattened rhythm. */
  index: number;
  expected: number;
  /** Signed deviation in ms, or null if the note was not played. */
  deviationMs: number | null;
  grade: Grade;
}

export interface ScoreResult {
  notes: NoteResult[];
  extraTaps: number;
  /** 0..100 */
  score: number;
  stars: 0 | 1 | 2 | 3;
  meanMs: number;
}

const POINTS: Record<Grade, number> = { perfect: 1, good: 0.6, miss: 0 };
const EXTRA_PENALTY = 0.5;

/** Matching window: generous enough for beginners, but never overlapping the neighbour note. */
export function matchWindowMs(onsets: readonly number[]): number {
  let minGap = Infinity;
  for (let i = 1; i < onsets.length; i++) minGap = Math.min(minGap, onsets[i] - onsets[i - 1]);
  const half = Number.isFinite(minGap) ? (minGap * 1000) / 2 : Infinity;
  return Math.max(GOOD_MS + 20, Math.min(150, half));
}

/**
 * @param expected sounding notes with their onset times (seconds, audio clock)
 * @param taps tap times (seconds, audio clock, NOT latency-corrected)
 * @param offsetMs calibrated latency to subtract from taps
 */
export function scoreRhythm(
  expected: readonly { index: number; time: number }[],
  taps: readonly number[],
  offsetMs: number,
): ScoreResult {
  const corrected = taps.map((t) => t - offsetMs / 1000);
  const windowMs = matchWindowMs(expected.map((e) => e.time));

  // All candidate pairs within the window, closest first; assign greedily one-to-one.
  const pairs: { e: number; t: number; dev: number }[] = [];
  expected.forEach((ex, e) => {
    corrected.forEach((tap, t) => {
      const dev = (tap - ex.time) * 1000;
      if (Math.abs(dev) <= windowMs) pairs.push({ e, t, dev });
    });
  });
  pairs.sort((a, b) => Math.abs(a.dev) - Math.abs(b.dev));

  const devByNote = new Map<number, number>();
  const usedTaps = new Set<number>();
  for (const p of pairs) {
    if (devByNote.has(p.e) || usedTaps.has(p.t)) continue;
    devByNote.set(p.e, p.dev);
    usedTaps.add(p.t);
  }

  const notes: NoteResult[] = expected.map((ex, e) => {
    const dev = devByNote.get(e);
    return {
      index: ex.index,
      expected: ex.time,
      deviationMs: dev ?? null,
      grade: dev === undefined ? 'miss' : grade(dev),
    };
  });

  const extraTaps = taps.length - usedTaps.size;
  const points = notes.reduce((s, n) => s + POINTS[n.grade], 0) - extraTaps * EXTRA_PENALTY;
  const score = expected.length ? Math.max(0, Math.round((points / expected.length) * 100)) : 0;
  const stars = score >= 90 ? 3 : score >= 75 ? 2 : score >= 50 ? 1 : 0;
  const played = [...devByNote.values()];
  const meanMs = played.length ? played.reduce((s, d) => s + d, 0) / played.length : 0;

  return { notes, extraTaps, score, stars, meanMs };
}

/**
 * Real-time matching of one tap while playing: the closest not-yet-matched
 * onset within the window. Returns the position in `expected` and the
 * deviation in ms, or null for an extra tap.
 */
export function matchTapLive(
  expected: readonly { index: number; time: number }[],
  matched: ReadonlySet<number>,
  tapTime: number,
  offsetMs: number,
): { pos: number; deviationMs: number } | null {
  const t = tapTime - offsetMs / 1000;
  const windowMs = matchWindowMs(expected.map((e) => e.time));
  let best: { pos: number; deviationMs: number } | null = null;
  expected.forEach((ex, pos) => {
    if (matched.has(pos)) return;
    const dev = (t - ex.time) * 1000;
    if (Math.abs(dev) <= windowMs && (!best || Math.abs(dev) < Math.abs(best.deviationMs))) {
      best = { pos, deviationMs: dev };
    }
  });
  return best;
}
