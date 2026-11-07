import { load, save } from './storage';

export interface Best {
  score: number;
  stars: number;
}

const KEY = 'rt.progress.v1';

export function loadProgress(): Record<string, Best> {
  return load<Record<string, Best>>(KEY, {});
}

/** Stores the result if it beats the previous best. Returns true when it is a new record. */
export function recordResult(id: string, score: number, stars: number): boolean {
  const all = loadProgress();
  const prev = all[id];
  if (prev && prev.score >= score) return false;
  all[id] = { score, stars };
  save(KEY, all);
  return true;
}
