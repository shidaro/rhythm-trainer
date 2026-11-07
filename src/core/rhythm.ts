// Rhythm model: notes/rests with durations in ticks, a compact text format
// for writing exercises, and conversion to tap times.

/** Ticks per quarter note. 12 keeps eighths, sixteenths and triplets integral. */
export const PPQ = 12;

export type NoteValue = 'w' | 'h' | 'q' | '8' | '16';

export interface RhythmEvent {
  value: NoteValue;
  dotted: boolean;
  rest: boolean;
}

export interface TimeSignature {
  beats: number;
  /** Note value of one beat: 4 = quarter, 8 = eighth. */
  unit: 2 | 4 | 8;
}

export interface Rhythm {
  time: TimeSignature;
  measures: RhythmEvent[][];
}

const BASE_TICKS: Record<NoteValue, number> = {
  w: PPQ * 4,
  h: PPQ * 2,
  q: PPQ,
  '8': PPQ / 2,
  '16': PPQ / 4,
};

export function eventTicks(e: RhythmEvent): number {
  const base = BASE_TICKS[e.value];
  return e.dotted ? base * 1.5 : base;
}

export function measureTicks(time: TimeSignature): number {
  return time.beats * ((PPQ * 4) / time.unit);
}

export function beatTicks(time: TimeSignature): number {
  return (PPQ * 4) / time.unit;
}

/**
 * Parses a compact rhythm string, e.g. `"4/4: q q 8 8 q | h qr q"`.
 * Tokens: w h q 8 16, optional `.` (dotted), optional `r` (rest). `|` separates measures.
 */
export function parseRhythm(src: string): Rhythm {
  const m = /^\s*(\d+)\/(\d+)\s*:(.*)$/s.exec(src);
  if (!m) throw new Error(`Нет размера в "${src}"`);
  const unit = Number(m[2]);
  if (unit !== 2 && unit !== 4 && unit !== 8) throw new Error(`Неподдерживаемый размер ${m[1]}/${m[2]}`);
  const time: TimeSignature = { beats: Number(m[1]), unit };
  const expected = measureTicks(time);
  const measures = m[3]
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, mi) => {
      const events = part.split(/\s+/).map((tok) => {
        const t = /^(w|h|q|8|16)(\.?)(r?)$/.exec(tok);
        if (!t) throw new Error(`Непонятный символ "${tok}" в такте ${mi + 1}`);
        return { value: t[1] as NoteValue, dotted: t[2] === '.', rest: t[3] === 'r' };
      });
      const total = events.reduce((s, e) => s + eventTicks(e), 0);
      if (total !== expected) {
        throw new Error(`Такт ${mi + 1}: ${total} тиков вместо ${expected}`);
      }
      return events;
    });
  if (!measures.length) throw new Error('Пустой ритм');
  return { time, measures };
}

export interface TimedEvent {
  /** Index across the whole rhythm (all measures flattened). */
  index: number;
  measure: number;
  event: RhythmEvent;
  startTick: number;
  ticks: number;
}

export function flatten(r: Rhythm): TimedEvent[] {
  const out: TimedEvent[] = [];
  let tick = 0;
  r.measures.forEach((events, measure) => {
    for (const event of events) {
      const ticks = eventTicks(event);
      out.push({ index: out.length, measure, event, startTick: tick, ticks });
      tick += ticks;
    }
  });
  return out;
}

export function totalTicks(r: Rhythm): number {
  return r.measures.length * measureTicks(r.time);
}

/** Seconds per tick at a tempo where `bpm` counts beats of the time signature's unit. */
export function secondsPerTick(r: Rhythm, bpm: number): number {
  return 60 / bpm / beatTicks(r.time);
}

/** Expected tap times (seconds) for every sounding note, starting at `start`. */
export function noteOnsets(r: Rhythm, bpm: number, start: number): { index: number; time: number }[] {
  const spt = secondsPerTick(r, bpm);
  return flatten(r)
    .filter((e) => !e.event.rest)
    .map((e) => ({ index: e.index, time: start + e.startTick * spt }));
}
