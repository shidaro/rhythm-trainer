import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { Metronome } from '../audio/metronome';
import { Notation } from '../components/Notation';
import type { TapDot } from '../components/Notation';
import { TapPad } from '../components/TapPad';
import type { Flash } from '../components/TapPad';
import type { Exercise } from '../content/reading';
import { beatTicks, flatten, measureTicks, noteOnsets, secondsPerTick, totalTicks } from '../core/rhythm';
import { matchTapLive, matchWindowMs, scoreRhythm } from '../core/scoring';
import type { ScoreResult } from '../core/scoring';
import { grade } from '../core/timing';
import { recordResult } from '../lib/progress';
import { load, save } from '../lib/storage';
import { keepAwake, releaseAwake } from '../lib/wakeLock';

type Phase = 'ready' | 'play' | 'paused' | 'listen' | 'result';

const METRONOME_KEY = 'rt.metronomeDuringPlay';
/** Taps earlier than this before the first note belong to the count-in and are ignored. */
const EARLY_IGNORE_S = 0.2;

/**
 * A stretch of continuous playback. Everything else uses "rhythm time":
 * seconds from the start of the rhythm, latency-corrected, so an attempt
 * can be paused and resumed (with a fresh count-in) without breaking scoring.
 */
interface Segment {
  /** Audio-clock time at which `startTick` sounds. */
  audioStart: number;
  startTick: number;
}

interface Props {
  engine: AudioEngine;
  exercise: Exercise;
  offsetMs: number;
  onBack: () => void;
  onOpenSettings: () => void;
  onNext?: () => void;
}

export function ExerciseScreen({ engine, exercise, offsetMs, onBack, onOpenSettings, onNext }: Props) {
  const { rhythm } = exercise;
  const flat = useMemo(() => flatten(rhythm), [rhythm]);
  const beatsPerBar = rhythm.time.beats;
  const total = totalTicks(rhythm);
  const perMeasure = measureTicks(rhythm.time);

  const [phase, setPhase] = useState<Phase>('ready');
  const [bpm, setBpm] = useState(exercise.bpm);
  const [metronomeOn, setMetronomeOn] = useState(() => load(METRONOME_KEY, true));
  const [current, setCurrent] = useState<number | undefined>(undefined);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [pausedTick, setPausedTick] = useState(0);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [record, setRecord] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [liveTaps, setLiveTaps] = useState<TapDot[]>([]);
  const [liveMissed, setLiveMissed] = useState<ReadonlySet<number>>(new Set());
  const [resultTaps, setResultTaps] = useState<TapDot[]>([]);

  const spt = secondsPerTick(rhythm, bpm);
  /** Expected notes in rhythm time (start = 0). */
  const onsets = useMemo(() => noteOnsets(rhythm, bpm, 0), [rhythm, bpm]);
  const windowS = useMemo(() => matchWindowMs(onsets.map((o) => o.time)) / 1000, [onsets]);

  const metronomeRef = useRef<Metronome | null>(null);
  const nodesRef = useRef<AudioScheduledSourceNode[]>([]);
  const segRef = useRef<Segment | null>(null);
  /** Taps in rhythm time. */
  const tapsRef = useRef<number[]>([]);
  /** Positions in `onsets` already matched by a live tap. */
  const liveMatchedRef = useRef<Set<number>>(new Set());
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => save(METRONOME_KEY, metronomeOn), [metronomeOn]);

  const setProgress = useCallback(
    (tick: number) => {
      if (progressRef.current) progressRef.current.style.width = `${Math.min(100, (tick / total) * 100)}%`;
    },
    [total],
  );

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
    segRef.current = null;
    setCurrent(undefined);
    setCountIn(null);
    void releaseAwake();
  }, []);

  useEffect(() => silence, [silence]);

  // Progress bar for phases where nothing is moving.
  useEffect(() => {
    if (phase === 'ready') setProgress(0);
    else if (phase === 'result') setProgress(total);
    else if (phase === 'paused') setProgress(pausedTick);
  }, [phase, pausedTick, total, setProgress]);

  // Playhead, count-in, progress and live "missed" detection, driven by what is audible now.
  useEffect(() => {
    if (phase !== 'play' && phase !== 'listen') return;
    const period = 60 / bpm;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const seg = segRef.current;
      if (!seg) return;
      const now = engine.audibleNow();
      if (now < seg.audioStart) {
        const beat = Math.floor((now - (seg.audioStart - beatsPerBar * period)) / period);
        setCountIn(beat >= 0 ? beat + 1 : null);
        setCurrent(undefined);
        setProgress(seg.startTick);
        return;
      }
      setCountIn(null);
      const tick = (now - seg.audioStart) / spt + seg.startTick;
      setProgress(tick);
      if (tick >= total) {
        setCurrent(undefined);
      } else {
        let i = flat.length - 1;
        while (i > 0 && flat[i].startTick > tick) i--;
        setCurrent(flat[i].index);
      }
      if (phase === 'play') {
        // A note is missed once its window has passed without a matching tap.
        const heard = now - offsetMs / 1000 - seg.audioStart + seg.startTick * spt;
        const missedNow: number[] = [];
        onsets.forEach((o, pos) => {
          if (!liveMatchedRef.current.has(pos) && o.time + windowS < heard) missedNow.push(o.index);
        });
        setLiveMissed((prev) => (prev.size === missedNow.length ? prev : new Set(missedNow)));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase, engine, bpm, spt, flat, beatsPerBar, total, onsets, windowS, offsetMs, setProgress]);

  const finish = useCallback(() => {
    const taps = tapsRef.current.filter((t) => t >= -EARLY_IGNORE_S);
    const r = scoreRhythm(onsets, taps, 0);
    silence();
    setResult(r);
    setResultTaps(
      r.taps.map((t) => ({
        tick: t.time / spt,
        grade: t.grade,
        noteTick: t.note === undefined ? undefined : flat[onsets[t.note].index].startTick,
      })),
    );
    setRecord(recordResult(exercise.id, r.score, r.stars));
    setPhase('result');
  }, [onsets, spt, silence, exercise.id, flat]);

  /** Plays from `fromTick` (a measure start) to the end, after a one-bar count-in. */
  const runSegment = (kind: 'play' | 'listen', fromTick: number) => {
    silence();
    const countInBeats = beatsPerBar;
    const remainingBeats = Math.round((total - fromTick) / beatTicks(rhythm.time));
    const period = 60 / bpm;
    const metronome = new Metronome(engine, {
      bpm,
      beatsPerBar,
      maxBeats: countInBeats + remainingBeats,
      audible: (i) => i < countInBeats || metronomeOn,
      onSchedule: (i, time) => {
        if (i !== 0) return;
        const seg = { audioStart: time + countInBeats * period, startTick: fromTick };
        segRef.current = seg;
        if (kind === 'listen') {
          nodesRef.current = onsets
            .filter((o) => o.time >= fromTick * spt - 1e-9)
            .flatMap((o) => engine.rhythmNote(seg.audioStart + o.time - fromTick * spt));
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

  const begin = (kind: 'play' | 'listen') => {
    if (kind === 'play') {
      tapsRef.current = [];
      liveMatchedRef.current = new Set();
      setLiveTaps([]);
      setLiveMissed(new Set());
      setResult(null);
    }
    setFlash(null);
    runSegment(kind, 0);
  };

  /** Pauses and rewinds to the start of the current measure, dropping what was played in it. */
  const pause = () => {
    const seg = segRef.current;
    let tick = seg ? seg.startTick : 0;
    if (seg) {
      const now = engine.audibleNow();
      if (now >= seg.audioStart) tick = (now - seg.audioStart) / spt + seg.startTick;
    }
    const from = Math.min(Math.floor(tick / perMeasure) * perMeasure, total - perMeasure);
    const cut = from * spt - 0.05;
    silence();
    tapsRef.current = tapsRef.current.filter((t) => t < cut);
    onsets.forEach((o, pos) => {
      if (o.time >= from * spt - 1e-9) liveMatchedRef.current.delete(pos);
    });
    setLiveTaps((prev) => prev.filter((t) => t.tick * spt < cut));
    setLiveMissed((prev) => new Set([...prev].filter((i) => flat[i].startTick < from)));
    setPausedTick(from);
    setPhase('paused');
  };

  const stop = () => {
    silence();
    setPhase(result ? 'result' : 'ready');
  };

  const onTap = (timeStamp: number) => {
    engine.tapNow();
    const seg = segRef.current;
    if (phase !== 'play' || !seg) return;
    const t = engine.perfToAudio(timeStamp);
    const v = t - offsetMs / 1000 - seg.audioStart + seg.startTick * spt;
    // Taps during the count-in only make a sound.
    if (v < seg.startTick * spt - EARLY_IGNORE_S) {
      setFlash({ grade: 'neutral', key: timeStamp });
      return;
    }
    tapsRef.current.push(v);
    const m = matchTapLive(onsets, liveMatchedRef.current, v, 0);
    if (!m) {
      setLiveTaps((prev) => [...prev, { tick: v / spt, grade: 'extra' }]);
      setFlash({ grade: 'miss', key: timeStamp });
      return;
    }
    liveMatchedRef.current.add(m.pos);
    const g = grade(m.deviationMs);
    const noteTick = flat[onsets[m.pos].index].startTick;
    setLiveTaps((prev) => [...prev, { tick: v / spt, grade: g, noteTick }]);
    setFlash({ grade: g, key: timeStamp });
  };

  const resultMissed = useMemo(
    () => new Set(result?.notes.filter((n) => n.deviationMs === null).map((n) => n.index) ?? []),
    [result],
  );

  const showLive = phase === 'play' || phase === 'paused';
  const shownTaps = showLive ? liveTaps : phase === 'result' ? resultTaps : undefined;
  const shownMissed = showLive ? liveMissed : phase === 'result' ? resultMissed : undefined;

  const counts = result
    ? {
        perfect: result.notes.filter((n) => n.grade === 'perfect').length,
        good: result.notes.filter((n) => n.grade === 'good').length,
        miss: result.notes.filter((n) => n.grade === 'miss').length,
      }
    : null;

  const running = phase === 'play' || phase === 'listen';
  const locked = running || phase === 'paused';
  let status = exercise.hint;
  if (running && countIn !== null) status = phase === 'play' ? `Отсчёт: ${countIn}` : `Слушай: ${countIn}`;
  else if (phase === 'play') status = 'Играй!';
  else if (phase === 'listen') status = 'Слушай ритм';
  else if (phase === 'paused') status = `Пауза. Продолжишь с такта ${pausedTick / perMeasure + 1}`;

  const mainAction = () => {
    if (phase === 'play') pause();
    else if (phase === 'listen') stop();
    else if (phase === 'paused') runSegment('play', pausedTick);
    else begin('play');
  };
  const mainLabel =
    phase === 'play' ? 'Пауза' : phase === 'listen' ? 'Стоп' : phase === 'paused' ? 'Продолжить' : 'Играть';

  return (
    <main className="app exercise">
      <header className="top">
        <button className="back" onClick={onBack} aria-label="Назад">
          ←
        </button>
        <h1>{exercise.title}</h1>
        <button className="icon" onClick={onOpenSettings} disabled={locked} aria-label="Настройки">
          ⚙︎
        </button>
      </header>

      <section className="card notation-card">
        <div className="notation-meta">
          <span>
            размер {rhythm.time.beats}/{rhythm.time.unit}
          </span>
          <button className={`play-toggle ${phase}`} onClick={mainAction} aria-label={mainLabel}>
            {phase === 'play' ? (
              <svg viewBox="0 0 24 24" aria-hidden>
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : phase === 'listen' ? (
              <svg viewBox="0 0 24 24" aria-hidden>
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" />
              </svg>
            )}
          </button>
          <span>{bpm} BPM</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" ref={progressRef} />
        </div>
        <Notation rhythm={rhythm} current={current} taps={shownTaps} missed={shownMissed} />
      </section>

      <div className="toolbar">
        <div className="tempo">
          <button onClick={() => setBpm((b) => Math.max(40, b - 5))} disabled={locked} aria-label="Медленнее">
            −
          </button>
          <span>
            <strong>{bpm}</strong>
          </span>
          <button onClick={() => setBpm((b) => Math.min(200, b + 5))} disabled={locked} aria-label="Быстрее">
            +
          </button>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={metronomeOn}
            disabled={running}
            onChange={(e) => setMetronomeOn(e.target.checked)}
          />
          <span className="track" aria-hidden />
          метроном
        </label>
      </div>

      {phase === 'result' && result && counts ? (
        <section className="card result compact">
          <div className="result-head">
            <span className="stars" aria-label={`${result.stars} из 3`}>
              {[1, 2, 3].map((s) => (
                <span key={s} className={s <= result.stars ? 'on' : ''}>
                  ★
                </span>
              ))}
            </span>
            <span className="score">
              {result.score}%{record && <span className="record"> рекорд!</span>}
            </span>
          </div>
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
              В среднем ты {result.meanMs < 0 ? 'спешишь' : 'опаздываешь'} на {Math.abs(result.meanMs).toFixed(0)} мс
            </p>
          )}
        </section>
      ) : (
        <p className={`status small ${countIn !== null ? 'count' : ''}`}>{status}</p>
      )}

      <div className="buttons">
        {running ? (
          <button className={phase === 'play' ? '' : 'danger'} onClick={mainAction}>
            {mainLabel}
          </button>
        ) : phase === 'paused' ? (
          <>
            <button onClick={() => begin('play')}>Заново</button>
            <button className="primary" onClick={mainAction}>
              Продолжить
            </button>
          </>
        ) : (
          <>
            <button onClick={() => begin('listen')}>Послушать</button>
            <button className="primary" onClick={() => begin('play')}>
              {phase === 'result' ? 'Ещё раз' : 'Играть'}
            </button>
            {phase === 'result' && onNext && result && result.stars > 0 && <button onClick={onNext}>Дальше →</button>}
          </>
        )}
      </div>

      <TapPad
        enabled={phase !== 'listen'}
        label={phase === 'play' ? '' : phase === 'listen' ? 'Слушай' : 'Тапай здесь'}
        flash={flash}
        onTap={onTap}
      />
    </main>
  );
}
