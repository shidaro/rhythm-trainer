import { describe, expect, it } from 'vitest';
import { flatten, noteOnsets, parseRhythm, totalTicks } from './rhythm';
import { matchTapLive, scoreRhythm } from './scoring';

describe('parseRhythm', () => {
  it('parses notes, rests and dots', () => {
    const r = parseRhythm('4/4: q. 8 qr q | h h');
    expect(r.time).toEqual({ beats: 4, unit: 4 });
    expect(r.measures).toHaveLength(2);
    expect(r.measures[0][0]).toEqual({ value: 'q', dotted: true, rest: false });
    expect(r.measures[0][2]).toEqual({ value: 'q', dotted: false, rest: true });
    expect(totalTicks(r)).toBe(96);
  });

  it('rejects measures with the wrong length', () => {
    expect(() => parseRhythm('4/4: q q q')).toThrow(/Такт 1/);
    expect(() => parseRhythm('3/4: q q q | h h')).toThrow(/Такт 2/);
    expect(() => parseRhythm('q q q q')).toThrow(/размера/);
    expect(() => parseRhythm('4/4: q q x q')).toThrow(/"x"/);
  });

  it('supports eighth-note meters', () => {
    const r = parseRhythm('6/8: q 8 q 8');
    expect(totalTicks(r)).toBe(36);
  });
});

describe('noteOnsets', () => {
  it('skips rests and converts ticks to seconds', () => {
    const r = parseRhythm('4/4: q 8 8 qr q');
    const on = noteOnsets(r, 120, 10);
    expect(on.map((o) => o.index)).toEqual([0, 1, 2, 4]);
    expect(on.map((o) => o.time)).toEqual([10, 10.5, 10.75, 11.5]);
    expect(flatten(r)[3].event.rest).toBe(true);
  });
});

describe('scoreRhythm', () => {
  const expected = noteOnsets(parseRhythm('4/4: q q q q'), 60, 0);

  it('gives full marks for exact taps', () => {
    const r = scoreRhythm(expected, [0, 1, 2, 3], 0);
    expect(r.score).toBe(100);
    expect(r.stars).toBe(3);
    expect(r.extraTaps).toBe(0);
  });

  it('applies the latency offset', () => {
    const r = scoreRhythm(expected, [0.05, 1.05, 2.05, 3.05], 50);
    expect(r.notes.every((n) => n.grade === 'perfect')).toBe(true);
  });

  it('marks missed notes and penalises extra taps', () => {
    const r = scoreRhythm(expected, [0, 0.5, 2.04, 3.2], 0);
    expect(r.notes.map((n) => n.grade)).toEqual(['perfect', 'miss', 'good', 'miss']);
    expect(r.notes[1].deviationMs).toBeNull();
    expect(r.extraTaps).toBe(2);
    expect(r.taps.map((t) => t.grade)).toEqual(['perfect', 'extra', 'good', 'extra']);
    expect(r.score).toBe(Math.round(((1 + 0.6 - 2 * 0.5) / 4) * 100));
  });

  it('does not let one tap count for two notes', () => {
    const fast = noteOnsets(parseRhythm('4/4: 16 16 16 16 h.'), 60, 0);
    const r = scoreRhythm(fast, [0.125], 0);
    expect(r.notes.filter((n) => n.deviationMs !== null)).toHaveLength(1);
  });
});

describe('matchTapLive', () => {
  const expected = noteOnsets(parseRhythm('4/4: q q q q'), 60, 0);

  it('matches the closest free note and skips taken ones', () => {
    expect(matchTapLive(expected, new Set(), 1.03, 0)).toEqual({ pos: 1, deviationMs: expect.closeTo(30) });
    expect(matchTapLive(expected, new Set([1]), 1.03, 0)).toBeNull();
    expect(matchTapLive(expected, new Set(), 2.06, 50)!.pos).toBe(2);
  });
});
