import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { Metronome } from '../audio/metronome';
import { Notation } from '../components/Notation';
import type { TapDot } from '../components/Notation';
import { TapPad } from '../components/TapPad';
import type { Flash } from '../components/TapPad';
import type { Exercise } from '../content/reading';
import { flatten, measureTicks, noteOnsets, secondsPerTick } from '../core/rhythm';
import { matchTapLive, matchWindowMs, scoreRhythm } from '../core/scoring';
import type { ScoreResult } from '../core/scoring';
import { grade } from '../core/timing';
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
  onOpenSettings: () => void;
  onNext?: () => void;
}

export function ExerciseScreen({ engine, exercise, offsetMs, onBack, onOpenSettings, onNext }: Props) {
  const { rhythm } = exercise;
  const flat = useMemo(() => flatten(rhythm), [rhythm]);
  const beatsPerBar = rhythm.time.beats;

  const metronomeRef = useRef<Metronome | null>(null);
  const nodesRef = useRef<AudioScheduledSourceNode[]>([]);
  const tapsRef = useRef<number[]>([]);
  const startRef = useRef(0);
  const onsetsRef = useRef<{ index: number; time: number }[]>([]);
  /** Positions in onsetsRef already matched by a live tap. */
  const liveMatchedRef = useRef<Set<number>>(new Set());

  const [phase, setPhase] = useState<Phase>('ready');
  const [bpm, setBpm] = useState(exercise.bpm);
  const [metronomeOn, setMetronomeOn] = useState(() => load(METRONOME_KEY, true));
  const [current, setCurrent] = useState<number | undefined>(undefined);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [record, setRecord] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [liveTaps, setLiveTaps] = useState<TapDot[]>([]);
  const [resultTaps, setResultTaps] = useState<TapDot[]>([]);
  const [liveMissed, setLiveMissed] = useState<ReadonlySet<number>>(new Set());

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
        if (phase === 'play') {
          // A note is missed once its window has passed without a matching tap.
          const onsets = onsetsRef.current;
          const windowS = matchWindowMs(onsets.map((o) => o.time)) / 1000;
          const heard = now - offsetMs / 1000;
          const missedNow: number[] = [];
          onsets.forEach((o, pos) => {
            if (!liveMatchedRef.current.has(pos) && o.time + windowS < heard) missedNow.push(o.index);
          });
          setLiveMissed((prev) => (prev.size === missedNow.length ? prev : new Set(missedNow)));
        }
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
  }, [phase, engine, rhythm, bpm, flat, beatsPerBar, offsetMs]);

  const finish = useCallback(() => {
    const onsets = onsetsRef.current;
    const first = onsets[0]?.time ?? startRef.current;
    const taps = tapsRef.current.filter((t) => t - offsetMs / 1000 >= first - EARLY_IGNORE_S);
    const r = scoreRhythm(onsets, taps, offsetMs);
    const spt = secondsPerTick(rhythm, bpm);
    setResultTaps(r.taps.map((t) => ({ tick: (t.time - startRef.current) / spt, grade: t.grade })));
    silence();
    setResult(r);
    setRecord(recordResult(exercise.id, r.score, r.stars));
    setPhase('result');
  }, [offsetMs, silence, exercise.id, rhythm, bpm]);

  const begin = (kind: 'play' | 'listen') => {
    silence();
    tapsRef.current = [];
    startRef.current = 0;
    liveMatchedRef.current = new Set();
    setLiveTaps([]);
    setLiveMissed(new Set());
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
          nodesRef.current = onsetsRef.current.flatMap((o) => engine.rhythmNote(o.time));
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
    engine.tapNow();
    if (phase !== 'play') return;
    const t = engine.perfToAudio(timeStamp);
    tapsRef.current.push(t);
    const onsets = onsetsRef.current;
    const first = onsets[0]?.time;
    // Taps during the count-in only make a sound.
    if (first === undefined || t - offsetMs / 1000 < first - EARLY_IGNORE_S) {
      setFlash({ grade: 'neutral', key: timeStamp });
      return;
    }
    const tick = (t - offsetMs / 1000 - startRef.current) / secondsPerTick(rhythm, bpm);
    const m = matchTapLive(onsets, liveMatchedRef.current, t, offsetMs);
    if (!m) {
      setLiveTaps((prev) => [...prev, { tick, grade: 'extra' }]);
      setFlash({ grade: 'miss', key: timeStamp });
      return;
    }
    liveMatchedRef.current.add(m.pos);
    const g = grade(m.deviationMs);
    setLiveTaps((prev) => [...prev, { tick, grade: g }]);
    setFlash({ grade: g, key: timeStamp });
  };

  const resultMissed = useMemo(
    () => new Set(result?.notes.filter((n) => n.deviationMs === null).map((n) => n.index) ?? []),
    [result],
  );

  const shownTaps = phase === 'play' ? liveTaps : phase === 'result' ? resultTaps : undefined;
  const shownMissed = phase === 'play' ? liveMissed : phase === 'result' ? resultMissed : undefined;

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
    <main className="app exercise">
      <header className="top">
        <button className="back" onClick={onBack} aria-label="Назад">
          ←
        </button>
        <h1>{exercise.title}</h1>
        <button className="icon" onClick={onOpenSettings} disabled={running} aria-label="Настройки">
          ⚙︎
        </button>
      </header>

      <section className="card notation-card">
        <div className="notation-meta">
          <span>
            размер {rhythm.time.beats}/{rhythm.time.unit}
          </span>
          <span>{bpm} BPM</span>
        </div>
        <Notation rhythm={rhythm} current={current} taps={shownTaps} missed={shownMissed} />
      </section>

      <div className="toolbar">
        <div className="tempo">
          <button onClick={() => setBpm((b) => Math.max(40, b - 5))} disabled={running} aria-label="Медленнее">
            −
          </button>
          <span>
            <strong>{bpm}</strong>
          </span>
          <button onClick={() => setBpm((b) => Math.min(200, b + 5))} disabled={running} aria-label="Быстрее">
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
          <button className="danger" onClick={stop}>
            Стоп
          </button>
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
