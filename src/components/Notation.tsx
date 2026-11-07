import { useEffect, useRef, useState } from 'react';
import { Beam, Dot, Formatter, Fraction, Renderer, Stave, StaveNote, Voice } from 'vexflow/bravura';
import { PPQ, beatTicks, flatten } from '../core/rhythm';
import type { Rhythm, RhythmEvent } from '../core/rhythm';

export type NoteMark = 'perfect' | 'good' | 'miss';

interface Props {
  rhythm: Rhythm;
  /** Index (in the flattened rhythm) of the event being played now. */
  current?: number;
  /** Result colouring per flattened event index. */
  marks?: ReadonlyMap<number, NoteMark>;
}

const STAVE_HEIGHT = 80;
const ROW_GAP = 4;
/** VexFlow reserves room above the staff that a single-line rhythm staff does not need. */
const STAVE_TOP_TRIM = 18;

let fontsReady: Promise<unknown> | null = null;
function loadFonts() {
  fontsReady ??= document.fonts.load('30px Bravura').catch(() => undefined);
  return fontsReady;
}

function vfDuration(e: RhythmEvent): string {
  // 'd' sets the dotted tick count; the dot glyph itself is attached separately.
  return e.value + (e.dotted ? 'd' : '') + (e.rest ? 'r' : '');
}

/** Beaming groups: per beat in simple meters, per dotted quarter in compound ones. */
function beamGroups(r: Rhythm): Fraction[] {
  const { beats, unit } = r.time;
  if (unit === 8 && beats % 3 === 0) return [new Fraction(3, 8)];
  return [new Fraction(beatTicks(r.time) / PPQ, 4)];
}

/** Approximate horizontal room one note needs, in logical px. */
const PX_PER_NOTE = 26;
const MAX_PER_ROW = 4;

interface Box {
  row: number;
  col: number;
  x: number;
  w: number;
}

/**
 * Packs measures into rows so busy measures get enough room, then splits each
 * row's width in proportion to how many notes each measure holds.
 */
function layoutRows(r: Rhythm, rowWidth: number): { rows: number; boxes: Box[] } {
  const weights = r.measures.map((ev) => ev.length + 1.5);
  const capacity = rowWidth / PX_PER_NOTE;
  const rows: number[][] = [];
  let cur: number[] = [];
  let sum = 0;
  weights.forEach((w, m) => {
    if (cur.length && (sum + w > capacity || cur.length >= MAX_PER_ROW)) {
      rows.push(cur);
      cur = [];
      sum = 0;
    }
    cur.push(m);
    sum += w;
  });
  if (cur.length) rows.push(cur);

  const boxes: Box[] = [];
  rows.forEach((ms, row) => {
    const total = ms.reduce((s, m) => s + weights[m], 0);
    let x = 0;
    ms.forEach((m, col) => {
      const w = (rowWidth * weights[m]) / total;
      boxes[m] = { row, col, x, w };
      x += w;
    });
  });
  return { rows: rows.length, boxes };
}

function drawRhythm(host: HTMLDivElement, rhythm: Rhythm, width: number) {
  // Draw in a smaller logical space and scale up: bigger, easier-to-read notes on phones.
  const scale = width < 420 ? 1.25 : 1.4;
  const logical = width / scale;
  const usable = logical - 2;
  const firstExtra = 60; // room for clef + time signature in the first measure of a row
  const layout = layoutRows(rhythm, usable - firstExtra);
  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(width, Math.ceil(layout.rows * (STAVE_HEIGHT + ROW_GAP) * scale));
  const ctx = renderer.getContext();
  ctx.scale(scale, scale);

  const flat = flatten(rhythm);
  const indices = new Map<StaveNote, number>();
  let flatIndex = 0;

  rhythm.measures.forEach((events, m) => {
    const { row, col, x: rx, w: rw } = layout.boxes[m];
    const x = col === 0 ? 0 : firstExtra + rx;
    const w = col === 0 ? rw + firstExtra : rw;

    const stave = new Stave(x, row * (STAVE_HEIGHT + ROW_GAP) - STAVE_TOP_TRIM, w);
    stave.setConfigForLines([
      { visible: false },
      { visible: false },
      { visible: true },
      { visible: false },
      { visible: false },
    ]);
    if (col === 0) stave.addClef('percussion');
    if (m === 0) stave.addTimeSignature(`${rhythm.time.beats}/${rhythm.time.unit}`);
    if (m === rhythm.measures.length - 1) stave.setEndBarType(3); // final double bar
    stave.setContext(ctx).draw();

    const notes = events.map((e) => {
      const note = new StaveNote({ keys: ['b/4'], duration: vfDuration(e), autoStem: false });
      if (e.dotted) Dot.buildAndAttach([note], { all: true });
      indices.set(note, flat[flatIndex].index);
      flatIndex++;
      return note;
    });

    const voice = new Voice({ numBeats: rhythm.time.beats, beatValue: rhythm.time.unit });
    voice.addTickables(notes);
    const beams = Beam.generateBeams(notes, { groups: beamGroups(rhythm) });
    new Formatter().joinVoices([voice]).formatToStave([voice], stave);
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());
    for (const note of notes) note.getSVGElement()?.classList.add('ev', `ev-${indices.get(note)}`);
  });
}

/** Renders a rhythm on a single-line percussion staff with VexFlow. */
export function Notation({ rhythm, current, marks }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [ready, setReady] = useState(false);
  const [rendered, setRendered] = useState(0);

  useEffect(() => {
    void loadFonts().then(() => setReady(true));
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !ready || width < 100) return;
    host.querySelector('svg')?.remove();
    try {
      drawRhythm(host, rhythm, width);
    } catch (err) {
      console.error('Notation render failed', err);
      host.querySelector('svg')?.remove();
    }
    setRendered((n) => n + 1);
  }, [rhythm, width, ready]);

  // Highlight current note and result marks without re-rendering.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelectorAll('.ev').forEach((el) => {
      const m = /ev-(\d+)/.exec(el.getAttribute('class') ?? '');
      if (!m) return;
      const i = Number(m[1]);
      el.classList.toggle('current', i === current);
      for (const k of ['perfect', 'good', 'miss'] as const) el.classList.toggle(k, marks?.get(i) === k);
    });
  }, [current, marks, rendered]);

  return <div className="notation" ref={hostRef} aria-label="Ноты" />;
}
