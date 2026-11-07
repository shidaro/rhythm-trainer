import { useEffect, useMemo, useRef, useState } from 'react';
import { Beam, BarlineType, Dot, Formatter, Fraction, Renderer, Stave, StaveNote, Voice } from 'vexflow/bravura';
import { PPQ, beatTicks, flatten, measureTicks } from '../core/rhythm';
import type { Rhythm, RhythmEvent } from '../core/rhythm';
import type { TapGrade } from '../core/scoring';
import { tickToPoint } from './notationGeometry';
import type { MeasureGeometry } from './notationGeometry';

/** A tap to show on the notation, positioned by its time in ticks from the rhythm start. */
export interface TapDot {
  tick: number;
  grade: TapGrade;
  /** Start tick of the matched note: keeps the dot in that note's row. */
  noteTick?: number;
}

interface Props {
  rhythm: Rhythm;
  /** Index (in the flattened rhythm) of the event being played now. */
  current?: number;
  /** Taps to draw where they happened. */
  taps?: readonly TapDot[];
  /** Flattened indices of notes that were not played: shown as hollow circles. */
  missed?: ReadonlySet<number>;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const DOT_R = 4.5;
/** Logical height of one measure row (staff + tap dots underneath). */
const ROW_H = 84;
/** VexFlow reserves room above the staff that a single-line rhythm staff does not need. */
const STAVE_TOP_TRIM = 18;
/** Room on the left for the measure number. */
const NUM_W = 26;
const VISIBLE_ROWS = 3;

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

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** One measure per row, numbered on the left. Returns tap-positioning geometry and the row height in px. */
function drawRhythm(
  host: HTMLDivElement,
  rhythm: Rhythm,
  width: number,
): { geoms: MeasureGeometry[]; rowPx: number } {
  // Draw in a smaller logical space and scale up: bigger, easier-to-read notes on phones.
  const scale = width < 420 ? 1.15 : 1.35;
  const logical = width / scale;
  const rows = rhythm.measures.length;
  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(width, Math.ceil(rows * ROW_H * scale));
  const ctx = renderer.getContext();
  ctx.scale(scale, scale);
  const svg = host.querySelector('svg')!;

  const flat = flatten(rhythm);
  const perMeasure = measureTicks(rhythm.time);
  const geoms: MeasureGeometry[] = [];
  const backgrounds: SVGElement[] = [];
  let flatIndex = 0;

  rhythm.measures.forEach((events, m) => {
    const y0 = m * ROW_H;
    backgrounds.push(svgEl('rect', { x: 0, y: y0, width: logical, height: ROW_H, class: `row-bg row-${m}` }));

    const stave = new Stave(NUM_W, y0 - STAVE_TOP_TRIM, logical - NUM_W - 2);
    stave.setConfigForLines([
      { visible: false },
      { visible: false },
      { visible: true },
      { visible: false },
      { visible: false },
    ]);
    stave.setBegBarType(BarlineType.NONE);
    stave.setEndBarType(m === rows - 1 ? BarlineType.END : BarlineType.NONE);
    stave.setContext(ctx).draw();
    const lineY = stave.getYForLine(2);

    const num = svgEl('text', { x: 6, y: lineY - 8, class: 'measure-num' });
    num.textContent = String(m + 1);
    svg.appendChild(num);

    const notes = events.map((e) => {
      const note = new StaveNote({ keys: ['b/4'], duration: vfDuration(e), stemDirection: 1 });
      if (e.dotted) Dot.buildAndAttach([note], { all: true });
      return note;
    });
    const first = flatIndex;
    flatIndex += events.length;

    const voice = new Voice({ numBeats: rhythm.time.beats, beatValue: rhythm.time.unit });
    voice.addTickables(notes);
    const beams = Beam.generateBeams(notes, { groups: beamGroups(rhythm), stemDirection: 1 });
    new Formatter().joinVoices([voice]).formatToStave([voice], stave);
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());

    const dotY = lineY + 28;
    const centre = (n: StaveNote) => (n.getNoteHeadBeginX() + n.getNoteHeadEndX()) / 2;
    notes.forEach((note, k) => {
      const ev = flat[first + k];
      note.getSVGElement()?.classList.add('ev', `ev-${ev.index}`);
      // Hollow circle under each sounding note, shown only if the note was missed.
      if (!ev.event.rest) {
        svg.appendChild(
          svgEl('circle', { cx: centre(note), cy: dotY, r: DOT_R, class: `missed-mark missed-${ev.index}` }),
        );
      }
    });

    geoms.push({
      startTick: m * perMeasure,
      endTick: (m + 1) * perMeasure,
      y: dotY,
      points: notes.map((n, k) => ({ tick: flat[first + k].startTick, x: centre(n) })),
      endX: stave.getNoteEndX() - 4,
      minX: NUM_W + 4,
    });
  });

  // Row backgrounds go underneath everything else.
  svg.prepend(...backgrounds);
  svg.appendChild(svgEl('g', { class: 'tap-layer' }));
  return { geoms, rowPx: ROW_H * scale };
}

/** Renders a rhythm one measure per row on a single-line staff, scrolling to follow the playhead. */
export function Notation({ rhythm, current, taps, missed }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const geomsRef = useRef<MeasureGeometry[]>([]);
  const [width, setWidth] = useState(0);
  const [ready, setReady] = useState(false);
  const [rendered, setRendered] = useState(0);
  const [rowPx, setRowPx] = useState(0);

  const flat = useMemo(() => flatten(rhythm), [rhythm]);
  const currentMeasure = current === undefined ? undefined : flat[current]?.measure;

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
      const out = drawRhythm(host, rhythm, width);
      geomsRef.current = out.geoms;
      setRowPx(out.rowPx);
    } catch (err) {
      console.error('Notation render failed', err);
      geomsRef.current = [];
      host.querySelector('svg')?.remove();
    }
    setRendered((n) => n + 1);
  }, [rhythm, width, ready]);

  // Current note and current row highlight.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelectorAll('.ev').forEach((el) => {
      const m = /ev-(\d+)/.exec(el.getAttribute('class') ?? '');
      if (m) el.classList.toggle('current', Number(m[1]) === current);
    });
    host.querySelectorAll('.row-bg').forEach((el) => {
      const m = /row-(\d+)/.exec(el.getAttribute('class') ?? '');
      if (m) el.classList.toggle('current', Number(m[1]) === currentMeasure);
    });
  }, [current, currentMeasure, rendered]);

  // Keep the playing measure in the middle row of the window.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || currentMeasure === undefined || !rowPx) return;
    vp.scrollTo({ top: Math.max(0, (currentMeasure - 1) * rowPx), behavior: 'smooth' });
  }, [currentMeasure, rowPx]);

  // Back to the top when a new attempt starts (no taps yet, nothing playing).
  useEffect(() => {
    if (!taps?.length && current === undefined) viewportRef.current?.scrollTo({ top: 0 });
  }, [taps, current]);

  // Missed notes and tap dots.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelectorAll('.missed-mark').forEach((el) => {
      const m = /missed-(\d+)/.exec(el.getAttribute('class') ?? '');
      if (m) el.classList.toggle('on', missed?.has(Number(m[1])) ?? false);
    });
    const layer = host.querySelector('.tap-layer');
    if (!layer) return;
    layer.replaceChildren(
      ...(taps ?? []).flatMap((t) => {
        const p = tickToPoint(geomsRef.current, t.tick, t.noteTick);
        if (!p) return [];
        return [svgEl('circle', { cx: p.x, cy: p.y, r: DOT_R, class: `tap-dot ${t.grade}` })];
      }),
    );
  }, [taps, missed, rendered]);

  const visible = Math.min(VISIBLE_ROWS, rhythm.measures.length);
  return (
    <div className="notation-viewport" ref={viewportRef} style={rowPx ? { height: visible * rowPx } : undefined}>
      <div className="notation" ref={hostRef} aria-label="Ноты" />
    </div>
  );
}
