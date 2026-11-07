import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { Metronome } from '../audio/metronome';
import { Notation } from '../components/Notation';
import type { NoteMark } from '../components/Notation';
import { TapPad } from '../components/TapPad';
import type { Flash } from '../components/TapPad';
import type { Exercise } from '../content/reading';
import { flatten, measureTicks, noteOnsets, secondsPerTick } from '../core/rhythm';
import { scoreRhythm } from '../core/scoring';
import type { ScoreResult } from '../core/scoring';
import { fmtMs } from '../lib/format';
import { recordResult } from '../lib/progress';
import { load, save } from '../lib/storage';
import { keepAwake, releaseAwake } from '../lib/wakeLock';

type Phase = 'ready' | 'play' | 'listen' | 'result';

const METRONOME_KEY = 'rt.metronomeDuringPlay';
/** Taps earlier than this before the first note belong to the count-in and are ignored. */
const EARLY_IGNORE_S = 0.2;

interface Props {
  engine: AudioEngine;
  exercise: Exercise;
  offsetMs: number;
  onBack: () => void;
  onNext?: () => void;
}

export function ExerciseScreen({ engine, exercise, offsetMs, onBack, onNext }: Props) {
  const { rhythm } = exercise;
  const flat = useMemo(() => flatten(rhythm), [rhythm]);
  const beatsPerBar = rhythm.time.beats;

  const metronomeRef = useRef<Metronome | null>(null);
  const nodesRef = useRef<AudioScheduledSourceNode[]>([]);
  const tapsRef = useRef<number[]>([]);
  const startRef = useRef(0);
  const onsetsRef = useRef<{ index: number; time: number }[]>([]);

  const [phase, setPhase] = useState<Phase>('ready');
  const [bpm, setBpm] = useState(exercise.bpm);
  const [metronomeOn, setMetronomeOn] = useState(() => load(METRONOME_KEY, true));
  const [current, setCurrent] = useState<number | undefined>(undefined);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [record, setRecord] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);

  useEffect(() => save(METRONOME_KEY, metronomeOn), [metronomeOn]);

  const silence = useCallback(() => {
    metronomeRef.current?.stop();
    metronomeRef.current = null;
    for (const n of nodesRef.current) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    nodesRef.current = [];
    setCurrent(undefined);
    setCountIn(null);
    void releaseAwake();
  }, []);

  useEffect(() => silence, [silence]);

  // Playhead + count-in display, driven by what is audible now.
  useEffect(() => {
    if (phase !== 'play' && phase !== 'listen') return;
    const spt = secondsPerTick(rhythm, bpm);
    const period = 60 / bpm;
    const total = rhythm.measures.length * measureTicks(rhythm.time);
    let raf = 0;
    const loop = () => {
      const now = engine.audibleNow();
      const start = startRef.current;
      if (start && now < start) {
        const beat = Math.floor((now - (start - beatsPerBar * period)) / period);
        setCountIn(beat >= 0 ? beat + 1 : null);
        setCurrent(undefined);
      } else if (start) {
        setCountIn(null);
        const tick = (now - start) / spt;
        if (tick >= total) {
          setCurrent(undefined);
        } else {
          let i = flat.length - 1;
          while (i > 0 && flat[i].startTick > tick) i--;
          setCurrent(flat[i].index);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase, engine, rhythm, bpm, flat, beatsPerBar]);

  const finish = useCallback(() => {
    const onsets = onsetsRef.current;
    const first = onsets[0]?.time ?? startRef.current;
    const taps = tapsRef.current.filter((t) => t - offsetMs / 1000 >= first - EARLY_IGNORE_S);
    const r = scoreRhythm(onsets, taps, offsetMs);
    silence();
    setResult(r);
    setRecord(recordResult(exercise.id, r.score, r.stars));
    setPhase('result');
  }, [offsetMs, silence, exercise.id]);

  const begin = (kind: 'play' | 'listen') => {
    silence();
    tapsRef.current = [];
    startRef.current = 0;
    setFlash(null);
    if (kind === 'play') setResult(null);
    const countInBeats = beatsPerBar;
    const totalBeats = countInBeats + rhythm.measures.length * beatsPerBar;
    const period = 60 / bpm;
    const metronome = new Metronome(engine, {
      bpm,
      beatsPerBar,
      maxBeats: totalBeats,
      audible: (i) => i < countInBeats || metronomeOn,
      onSchedule: (i, time) => {
        if (i !== 0) return;
        startRef.current = time + countInBeats * period;
        onsetsRef.current = noteOnsets(rhythm, bpm, startRef.current);
        if (kind === 'listen') {
          nodesRef.current = onsetsRef.current.map((o) => engine.note(o.time));
        }
      },
      onEnd:
        kind === 'play'
          ? finish
          : () => {
              silence();
              setPhase(result ? 'result' : 'ready');
            },
    });
    metronomeRef.current = metronome;
    metronome.start(0.4);
    setPhase(kind);
    void keepAwake();
  };

  const stop = () => {
    silence();
    setPhase(result ? 'result' : 'ready');
  };

  const onTap = (timeStamp: number) => {
    if (phase !== 'play') return;
    tapsRef.current.push(engine.perfToAudio(timeStamp));
    setFlash({ grade: 'neutral', key: timeStamp });
  };

  const marks = useMemo(() => {
    if (!result || phase !== 'result') return undefined;
    return new Map<number, NoteMark>(result.notes.map((n) => [n.index, n.grade]));
  }, [result, phase]);

  const counts = result
    ? {
        perfect: result.notes.filter((n) => n.grade === 'perfect').length,
        good: result.notes.filter((n) => n.grade === 'good').length,
        miss: result.notes.filter((n) => n.grade === 'miss').length,
      }
    : null;

  const running = phase === 'play' || phase === 'listen';
  let status = exercise.hint;
  if (running && countIn !== null) status = phase === 'play' ? `Отсчёт: ${countIn}` : `Слушай: ${countIn}`;
  else if (phase === 'play') status = 'Играй!';
  else if (phase === 'listen') status = 'Слушай ритм';

  return (
    <main className="app">
      <header className="top">
        <button className="back" onClick={onBack} aria-label="Назад">
          ←
        </button>
        <h1>{exercise.title}</h1>
        <span className="badge">
          {rhythm.time.beats}/{rhythm.time.unit}
        </span>
      </header>

      <section className="card notation-card">
        <Notation rhythm={rhythm} current={current} marks={marks} />
      </section>

      <p className={`status small ${countIn !== null ? 'count' : ''}`}>{status}</p>

      {phase === 'result' && result && counts && (
        <section className="card result">
          <div className="stars" aria-label={`${result.stars} из 3`}>
            {[1, 2, 3].map((s) => (
              <span key={s} className={s <= result.stars ? 'on' : ''}>
                ★
              </span>
            ))}
          </div>
          <p className="score">
            {result.score}%{record && <span className="record"> · рекорд!</span>}
          </p>
          <div className="stats">
            <div>
              <span className="perfect">{counts.perfect}</span>точно
            </div>
            <div>
              <span className="good">{counts.good}</span>хорошо
            </div>
            <div>
              <span className="miss">{counts.miss}</span>мимо
            </div>
            <div>
              <span>{result.extraTaps}</span>лишних
            </div>
          </div>
          {Math.abs(result.meanMs) >= 15 && counts.miss < result.notes.length && (
            <p className="muted tendency">
              В среднем ты {result.meanMs < 0 ? 'спешишь' : 'опаздываешь'} на {fmtMs(Math.abs(result.meanMs)).replace('+', '')}{' '}
              мс
            </p>
          )}
        </section>
      )}

      <section className="card controls">
        <div className="tempo">
          <button onClick={() => setBpm((b) => Math.max(40, b - 5))} disabled={running} aria-label="Медленнее">
            −
          </button>
          <span>
            <strong>{bpm}</strong> BPM
          </span>
          <button onClick={() => setBpm((b) => Math.min(200, b + 5))} disabled={running} aria-label="Быстрее">
            +
          </button>
          <label className="toggle">
            <input
              type="checkbox"
              checked={metronomeOn}
              disabled={running}
              onChange={(e) => setMetronomeOn(e.target.checked)}
            />
            Метроном
          </label>
        </div>
        <div className="buttons">
          {running ? (
            <button className="danger" onClick={stop}>
              Стоп
            </button>
          ) : (
            <>
              <button onClick={() => begin('listen')}>Послушать</button>
              <button className="primary" onClick={() => begin('play')}>
                {phase === 'result' ? 'Ещё раз' : 'Играть'}
              </button>
              {phase === 'result' && onNext && result && result.stars > 0 && (
                <button onClick={onNext}>Дальше →</button>
              )}
            </>
          )}
        </div>
      </section>

      <TapPad
        enabled={phase === 'play'}
        label={phase === 'play' ? 'ТАП' : phase === 'listen' ? 'Слушай' : 'Нажми «Играть»'}
        flash={flash}
        onTap={onTap}
      />
    </main>
  );
}
