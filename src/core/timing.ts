// Pure timing math: matching taps to beats, grading, calibration.
// All times are in seconds (audio clock), deviations in milliseconds.

export type Grade = 'perfect' | 'good' | 'miss';

export const PERFECT_MS = 25;
export const GOOD_MS = 60;

export function grade(deviationMs: number): Grade {
  const d = Math.abs(deviationMs);
  if (d <= PERFECT_MS) return 'perfect';
  if (d <= GOOD_MS) return 'good';
  return 'miss';
}

/** Index of the beat closest to `t` in a sorted array, or -1 if empty. */
export function nearestIndex(t: number, beats: readonly number[]): number {
  if (beats.length === 0) return -1;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(beats[lo - 1] - t) <= Math.abs(beats[lo] - t)) return lo - 1;
  return lo;
}

export interface TapDeviation {
  beatIndex: number;
  deviationMs: number;
}

/** Deviation of a tap from its nearest beat; positive = late. `offsetMs` is the calibrated latency. */
export function tapDeviation(
  tapTime: number,
  beats: readonly number[],
  offsetMs = 0,
): TapDeviation | null {
  const corrected = tapTime - offsetMs / 1000;
  const i = nearestIndex(corrected, beats);
  if (i < 0) return null;
  return { beatIndex: i, deviationMs: (corrected - beats[i]) * 1000 };
}

/**
 * Assigns each beat at most one tap (the closest within `windowMs`).
 * Returns raw deviations in ms for beats that got a tap.
 */
export function assignTapsToBeats(
  taps: readonly number[],
  beats: readonly number[],
  windowMs: number,
): number[] {
  const best = new Map<number, number>();
  for (const tap of taps) {
    const i = nearestIndex(tap, beats);
    if (i < 0) continue;
    const dev = (tap - beats[i]) * 1000;
    if (Math.abs(dev) > windowMs) continue;
    const prev = best.get(i);
    if (prev === undefined || Math.abs(dev) < Math.abs(prev)) best.set(i, dev);
  }
  return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([, d]) => d);
}

export function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function stdDev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export interface CalibrationResult {
  offsetMs: number;
  jitterMs: number;
  samples: number;
}

/** Robust latency estimate: median after dropping outliers (> 3 scaled MADs, min 30 ms). */
export function computeCalibration(
  deviationsMs: readonly number[],
  minSamples = 8,
): CalibrationResult | null {
  if (deviationsMs.length < minSamples) return null;
  const med = median(deviationsMs);
  const mad = median(deviationsMs.map((d) => Math.abs(d - med))) * 1.4826;
  const limit = Math.max(3 * mad, 30);
  const kept = deviationsMs.filter((d) => Math.abs(d - med) <= limit);
  if (kept.length < minSamples) return null;
  return { offsetMs: median(kept), jitterMs: stdDev(kept), samples: kept.length };
}

export interface Summary {
  count: number;
  meanMs: number;
  sdMs: number;
  perfectPct: number;
  goodPct: number;
}

export function summarize(deviationsMs: readonly number[]): Summary {
  const n = deviationsMs.length;
  const grades = deviationsMs.map(grade);
  const pct = (g: Grade) => (n ? (grades.filter((x) => x === g).length / n) * 100 : 0);
  return {
    count: n,
    meanMs: mean(deviationsMs),
    sdMs: stdDev(deviationsMs),
    perfectPct: pct('perfect'),
    goodPct: pct('good'),
  };
}
