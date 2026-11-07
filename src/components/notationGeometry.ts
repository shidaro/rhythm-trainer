// Maps rhythm time (ticks) onto rendered notation coordinates so taps can be
// drawn exactly where they happened, between the notes.

export interface MeasureGeometry {
  startTick: number;
  endTick: number;
  /** y of the tap-dot row for this measure. */
  y: number;
  /** Note-head centres at their start ticks, sorted by tick; first is at startTick. */
  points: { tick: number; x: number }[];
  /** x where the measure's time ends (just before the barline). */
  endX: number;
  /** Leftmost x a dot may be drawn at (after clef/time signature). */
  minX: number;
}

/** Position of a moment in time on the notation. Taps outside the rhythm are clamped to its edges. */
export function tickToPoint(geoms: readonly MeasureGeometry[], tick: number): { x: number; y: number } | null {
  if (!geoms.length) return null;
  let g = geoms.find((m) => tick >= m.startTick && tick < m.endTick);
  if (!g) g = tick < geoms[0].startTick ? geoms[0] : geoms[geoms.length - 1];

  const anchors = [...g.points, { tick: g.endTick, x: g.endX }];
  let x: number;
  if (tick <= anchors[0].tick) {
    // Slightly early for the first note of the measure: extrapolate left along the first segment.
    const [a, b] = anchors;
    const slope = b && b.tick !== a.tick ? (b.x - a.x) / (b.tick - a.tick) : 0;
    x = Math.max(g.minX, a.x + (tick - a.tick) * slope);
  } else if (tick >= g.endTick) {
    x = g.endX;
  } else {
    let i = 0;
    while (i < anchors.length - 2 && anchors[i + 1].tick <= tick) i++;
    const a = anchors[i];
    const b = anchors[i + 1];
    x = a.x + ((tick - a.tick) / (b.tick - a.tick)) * (b.x - a.x);
  }
  return { x, y: g.y };
}
