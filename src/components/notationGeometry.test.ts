import { describe, expect, it } from 'vitest';
import { tickToPoint } from './notationGeometry';
import type { MeasureGeometry } from './notationGeometry';

const geoms: MeasureGeometry[] = [
  {
    startTick: 0,
    endTick: 48,
    y: 50,
    points: [
      { tick: 0, x: 100 },
      { tick: 24, x: 200 },
    ],
    endX: 300,
    minX: 80,
  },
  { startTick: 48, endTick: 96, y: 150, points: [{ tick: 48, x: 20 }], endX: 300, minX: 10 },
];

describe('tickToPoint', () => {
  it('lands exactly on notes and interpolates between them', () => {
    expect(tickToPoint(geoms, 0)).toEqual({ x: 100, y: 50 });
    expect(tickToPoint(geoms, 12)).toEqual({ x: 150, y: 50 });
    expect(tickToPoint(geoms, 36)).toEqual({ x: 250, y: 50 });
  });

  it('switches rows by measure', () => {
    expect(tickToPoint(geoms, 72)).toEqual({ x: 160, y: 150 });
  });

  it('extrapolates early taps but not past the left edge', () => {
    expect(tickToPoint(geoms, -2)!.x).toBeCloseTo(100 - (2 * 100) / 24);
    expect(tickToPoint(geoms, -100)!.x).toBe(80);
    expect(tickToPoint(geoms, 500)).toEqual({ x: 300, y: 150 });
  });
});
