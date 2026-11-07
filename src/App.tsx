import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AudioEngine } from './audio/engine';
import type { Diagnostics } from './audio/engine';
import { Metronome } from './audio/metronome';
import { DeviationChart } from './components/DeviationChart';
import {
  assignTapsToBeats,
  computeCalibration,
  grade,
  summarize,
  tapDeviation,
} from './core/timing';
import type { CalibrationResult, Grade } from './core/timing';
import { load, remove, save } from './lib/storage';
import { keepAwake, releaseAwake } from './lib/wakeLock';

type Mode = 'idle' | 'calibrating' | 'practice';

const COUNT_IN = 4;
const CALIBRATION_BEATS = 16;
const BEATS_PER_BAR = 4;
const OFFSET_KEY = 'rt.offsetMs';
const BPM_KEY = 'rt.bpm';

const GRADE_LABEL: Record<Grade, string> = { perfect: 'Точно', good: 'Хорошо', miss: 'Мимо' };

const fmt = (ms: number) => `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${Math.abs(ms).toFixed(0)}`;

export default function App() {
  const engineRef = useRef<AudioEngine | null>(null);
  const metronomeRef = useRef<Metronome | null>(null);
  const beatsRef = useRef<number[]>([]);
  const tapsRef = useRef<number[]>([]);

  const [unlocked, setUnlocked] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [bpm, setBpm] = useState(() => load(BPM_KEY, 90));
  const [offsetMs, setOffsetMs] = useState<number | null>(() => load<number | null>(OFFSET_KEY, null));
  const [beat, setBeat] = useState(-1);
  const [deviations, setDeviations] = useState<number[]>([]);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ grade: Grade | 'neutral'; key: number } | null>(null);
  const [diag, setDiag] = useState<Diagnostics | null>(null);

  useEffect(() => save(BPM_KEY, bpm), [bpm]);

  // Visual beat indicator synced to what is actually heard.
  useEffect(() => {
    if (mode === 'idle') return;
    let raf = 0;
    const loop = () => {
      const engine = engineRef.current;
      if (engine) {
        const now = engine.audibleNow();
        const beats = beatsRef.current;
        let i = beats.length - 1;
        while (i >= 0 && beats[i] > now) i--;
        setBeat(i);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  const stop = useCallback(() => {
    metronomeRef.current?.stop();
    metronomeRef.current = null;
    setMode('idle');
    setBeat(-1);
    void releaseAwake();
  }, []);

  useEffect(() => stop, [stop]);

  const unlock = async () => {
    const engine = engineRef.current ?? new AudioEngine();
    engineRef.current = engine;
    await engine.unlock();
    setDiag(engine.diagnostics());
    setUnlocked(true);
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* ignore */
    }
  };

  const finishCalibration = useCallback(() => {
    const beats = beatsRef.current.slice(COUNT_IN);
    const period = 60 / bpm;
    const devs = assignTapsToBeats(tapsRef.current, beats, Math.min(250, (period * 1000) / 2));
    const result = computeCalibration(devs, Math.ceil(CALIBRATION_BEATS / 2));
    stop();
    if (result) {
      setCalibration(result);
      setCalibrationError(null);
      setOffsetMs(result.offsetMs);
      save(OFFSET_KEY, result.offsetMs);
    } else {
      setCalibration(null);
      setCalibrationError(
        `Засчитано ${devs.length} из ${CALIBRATION_BEATS} тапов, нужно хотя бы ${Math.ceil(CALIBRATION_BEATS / 2)}. Попробуй ещё раз.`,
      );
    }
  }, [bpm, stop]);

  const start = (next: Exclude<Mode, 'idle'>) => {
    const engine = engineRef.current;
    if (!engine) return;
    metronomeRef.current?.stop();
    beatsRef.current = [];
    tapsRef.current = [];
    setDeviations([]);
    setFlash(null);
    setCalibrationError(null);
    if (next === 'calibrating') setCalibration(null);
    const metronome = new Metronome(engine, {
      bpm,
      beatsPerBar: BEATS_PER_BAR,
      maxBeats: next === 'calibrating' ? COUNT_IN + CALIBRATION_BEATS : undefined,
      onSchedule: (_i, time) => beatsRef.current.push(time),
      onEnd: next === 'calibrating' ? finishCalibration : undefined,
    });
    metronomeRef.current = metronome;
    metronome.start(0.4);
    setMode(next);
    setDiag(engine.diagnostics());
    void keepAwake();
  };

  const registerTap = (timeStamp: number) => {
    const engine = engineRef.current;
    if (!engine || mode === 'idle') return;
    const t = engine.perfToAudio(timeStamp);
    if (mode === 'calibrating') {
      tapsRef.current.push(t);
      setFlash({ grade: 'neutral', key: timeStamp });
      return;
    }
    const d = tapDeviation(t, beatsRef.current, offsetMs ?? 0);
    if (!d) return;
    setDeviations((prev) => [...prev.slice(-199), d.deviationMs]);
    setFlash({ grade: grade(d.deviationMs), key: timeStamp });
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    registerTap(e.timeStamp);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return;
    e.preventDefault();
    registerTap(e.timeStamp);
  };

  const resetCalibration = () => {
    remove(OFFSET_KEY);
    setOffsetMs(null);
    setCalibration(null);
  };

  if (!unlocked) {
    return (
      <main className="app start">
        <h1>Тренажёр ритма</h1>
        <p className="muted">Прототип: проверка точности тайминга</p>
        <button className="primary big" onClick={unlock}>
          Начать
        </button>
        <p className="hint">Включи звук. Лучше всего работает в наушниках или через динамик телефона.</p>
      </main>
    );
  }

  const summary = summarize(deviations);
  const last = deviations.at(-1);
  const inCountIn = mode === 'calibrating' && beat < COUNT_IN;
  const calibrationStep = mode === 'calibrating' ? Math.max(0, beat - COUNT_IN + 1) : 0;

  let status: string;
  if (mode === 'calibrating') {
    status = inCountIn
      ? `Слушай… ${beat >= 0 ? COUNT_IN - beat : ''}`
      : `Тапай в такт: ${calibrationStep} / ${CALIBRATION_BEATS}`;
  } else if (mode === 'practice') {
    status = last === undefined ? 'Тапай в такт щелчкам' : `${fmt(last)} мс · ${GRADE_LABEL[grade(last)]}`;
  } else {
    status = offsetMs === null ? 'Сначала откалибруй задержку' : 'Готово к проверке';
  }

  return (
    <main className="app">
      <header className="top">
        <h1>Тренажёр ритма</h1>
        <span className="badge">{offsetMs === null ? 'без калибровки' : `задержка ${offsetMs.toFixed(0)} мс`}</span>
      </header>

      <section className="card controls">
        <label className="bpm">
          <span>
            Темп <strong>{bpm}</strong> BPM
          </span>
          <input
            type="range"
            min={40}
            max={200}
            step={1}
            value={bpm}
            disabled={mode !== 'idle'}
            onChange={(e) => setBpm(Number(e.target.value))}
          />
        </label>
        <div className="buttons">
          {mode === 'idle' ? (
            <>
              <button className={offsetMs === null ? 'primary' : ''} onClick={() => start('calibrating')}>
                Калибровка
              </button>
              <button className={offsetMs === null ? '' : 'primary'} onClick={() => start('practice')}>
                Проверка
              </button>
            </>
          ) : (
            <button className="danger" onClick={stop}>
              Стоп
            </button>
          )}
        </div>
      </section>

      <div className="beats" aria-hidden>
        {Array.from({ length: BEATS_PER_BAR }, (_, i) => (
          <span key={i} className={`beat ${beat >= 0 && beat % BEATS_PER_BAR === i ? 'on' : ''} ${i === 0 ? 'accent' : ''}`} />
        ))}
      </div>

      <p className={`status ${mode === 'practice' && last !== undefined ? grade(last) : ''}`}>{status}</p>

      {mode === 'calibrating' && (
        <div className="progress">
          <div style={{ width: `${(calibrationStep / CALIBRATION_BEATS) * 100}%` }} />
        </div>
      )}

      {mode === 'idle' && calibration && (
        <section className="card result">
          <h2>Калибровка сохранена</h2>
          <p>
            Задержка <strong>{calibration.offsetMs.toFixed(0)} мс</strong>, разброс ±{calibration.jitterMs.toFixed(0)} мс
            ({calibration.samples} тапов).
          </p>
          <p className="muted">
            {calibration.jitterMs <= 15
              ? 'Разброс маленький, тайминг стабильный.'
              : 'Разброс большой: попробуй ещё раз, тапай спокойно и ровно.'}
          </p>
        </section>
      )}
      {mode === 'idle' && calibrationError && <p className="error">{calibrationError}</p>}

      {(mode === 'practice' || deviations.length > 0) && (
        <section className="card">
          <DeviationChart deviations={deviations} />
          <div className="stats">
            <div>
              <span>{summary.count}</span>тапов
            </div>
            <div>
              <span>{summary.count ? fmt(summary.meanMs) : '—'}</span>среднее, мс
            </div>
            <div>
              <span>{summary.count > 1 ? `±${summary.sdMs.toFixed(0)}` : '—'}</span>разброс, мс
            </div>
            <div>
              <span>{summary.count ? `${summary.perfectPct.toFixed(0)}%` : '—'}</span>точно
            </div>
          </div>
        </section>
      )}

      <button
        className={`pad ${mode === 'idle' ? 'disabled' : ''}`}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Тап"
      >
        {flash && <span key={flash.key} className={`flash ${flash.grade}`} />}
        <span className="pad-label">{mode === 'idle' ? 'Выбери режим' : 'ТАП'}</span>
      </button>

      <details className="diag">
        <summary>Диагностика</summary>
        {diag && (
          <ul>
            <li>Частота: {diag.sampleRate} Гц</li>
            <li>baseLatency: {diag.baseLatencyMs?.toFixed(1) ?? 'нет'} мс</li>
            <li>outputLatency: {diag.outputLatencyMs?.toFixed(1) ?? 'нет'} мс</li>
            <li>getOutputTimestamp: {diag.hasOutputTimestamp ? 'да' : 'нет'}</li>
            <li>Состояние: {diag.state}</li>
          </ul>
        )}
        {offsetMs !== null && mode === 'idle' && (
          <button className="link" onClick={resetCalibration}>
            Сбросить калибровку
          </button>
        )}
      </details>
    </main>
  );
}
