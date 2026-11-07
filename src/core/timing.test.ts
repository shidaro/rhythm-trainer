import { describe, expect, it } from 'vitest';
import {
  assignTapsToBeats,
  computeCalibration,
  grade,
  median,
  nearestIndex,
  summarize,
  tapDeviation,
} from './timing';

const beats = [1, 1.5, 2, 2.5, 3];

describe('nearestIndex', () => {
  it('finds the closest beat', () => {
    expect(nearestIndex(0, beats)).toBe(0);
    expect(nearestIndex(1.2, beats)).toBe(0);
    expect(nearestIndex(1.3, beats)).toBe(1);
    expect(nearestIndex(9, beats)).toBe(4);
    expect(nearestIndex(1, [])).toBe(-1);
  });
});

describe('tapDeviation', () => {
  it('reports signed deviation and applies the latency offset', () => {
    expect(tapDeviation(1.52, beats)!.deviationMs).toBeCloseTo(20);
    expect(tapDeviation(1.48, beats)!.deviationMs).toBeCloseTo(-20);
    const d = tapDeviation(1.58, beats, 80)!;
    expect(d.beatIndex).toBe(1);
    expect(d.deviationMs).toBeCloseTo(0);
  });
});

describe('grade', () => {
  it('uses symmetric windows', () => {
    expect(grade(-25)).toBe('perfect');
    expect(grade(40)).toBe('good');
    expect(grade(-61)).toBe('miss');
  });
});

describe('assignTapsToBeats', () => {
  it('keeps only the closest tap per beat and drops taps outside the window', () => {
    const devs = assignTapsToBeats([1.03, 1.01, 1.7, 2.02], beats, 100);
    expect(devs.map((d) => Math.round(d))).toEqual([10, 20]);
  });
});

describe('computeCalibration', () => {
  it('returns the median ignoring outliers', () => {
    const devs = [80, 82, 78, 85, 79, 81, 300, 83, 77, 80];
    const r = computeCalibration(devs)!;
    expect(r.samples).toBe(9);
    expect(r.offsetMs).toBe(80);
    expect(r.jitterMs).toBeLessThan(5);
  });

  it('needs enough samples', () => {
    expect(computeCalibration([10, 12, 11])).toBeNull();
  });
});

describe('summarize', () => {
  it('computes percentages', () => {
    const s = summarize([0, 10, 40, 100]);
    expect(s.count).toBe(4);
    expect(s.perfectPct).toBe(50);
    expect(s.goodPct).toBe(25);
    expect(median([3, 1, 2])).toBe(2);
  });
});
