import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { Metronome } from '../audio/metronome';
import { DeviationChart } from '../components/DeviationChart';
import { TapPad } from '../components/TapPad';
import type { Flash } from '../components/TapPad';
import { assignTapsToBeats, computeCalibration, grade, summarize, tapDeviation } from '../core/timing';
import type { CalibrationResult, Grade } from '../core/timing';
import { fmtMs } from '../lib/format';
import { load, save } from '../lib/storage';
import { keepAwake, releaseAwake } from '../lib/wakeLock';

type Mode = 'idle' | 'calibrating' | 'practice';

const COUNT_IN = 4;
const CALIBRATION_BEATS = 16;
const BEATS_PER_BAR = 4;
const BPM_KEY = 'rt.labBpm';

const GRADE_LABEL: Record<Grade, string> = { perfect: 'Точно', good: 'Хорошо', miss: 'Мимо' };


interface Props {
  engine: AudioEngine;
  offsetMs: number | null;
  onOffsetChange: (ms: number | null) => void;
  onBack: () => void;
}

/** Latency calibration and free tap-timing check. */
export function TimingLab({ engine, offsetMs, onOffsetChange, onBack }: Props) {
  const metronomeRef = useRef<Metronome | null>(null);
  const beatsRef = useRef<number[]>([]);
  const tapsRef = useRef<number[]>([]);

  const [mode, setMode] = useState<Mode>('idle');
  const [bpm, setBpm] = useState(() => load(BPM_KEY, 90));
  const [beat, setBeat] = useState(-1);
  const [deviations, setDeviations] = useState<number[]>([]);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);

  useEffect(() => save(BPM_KEY, bpm), [bpm]);

  useEffect(() => {
    if (mode === 'idle') return;
    let raf = 0;
    const loop = () => {
      const now = engine.audibleNow();
      const beats = beatsRef.current;
      let i = beats.length - 1;
      while (i >= 0 && beats[i] > now) i--;
      setBeat(i);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode, engine]);

  const stop = useCallback(() => {
    metronomeRef.current?.stop();
    metronomeRef.current = null;
    setMode('idle');
    setBeat(-1);
    void releaseAwake();
  }, []);

  useEffect(() => stop, [stop]);

  const finishCalibration = useCallback(() => {
    const beats = beatsRef.current.slice(COUNT_IN);
    const period = 60 / bpm;
    const devs = assignTapsToBeats(tapsRef.current, beats, Math.min(250, (period * 1000) / 2));
    const result = computeCalibration(devs, Math.ceil(CALIBRATION_BEATS / 2));
    stop();
    if (result) {
      setCalibration(result);
      setCalibrationError(null);
      onOffsetChange(result.offsetMs);
    } else {
      setCalibration(null);
      setCalibrationError(
        `Засчитано ${devs.length} из ${CALIBRATION_BEATS} тапов, нужно хотя бы ${Math.ceil(CALIBRATION_BEATS / 2)}. Попробуй ещё раз.`,
      );
    }
  }, [bpm, stop, onOffsetChange]);

  const start = (next: Exclude<Mode, 'idle'>) => {
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
    void keepAwake();
  };

  const onTap = (timeStamp: number) => {
    if (mode === 'idle') return;
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

  const diag = engine.diagnostics();
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
    status = last === undefined ? 'Тапай в такт щелчкам' : `${fmtMs(last)} мс · ${GRADE_LABEL[grade(last)]}`;
  } else {
    status = offsetMs === null ? 'Сначала откалибруй задержку' : 'Готово к проверке';
  }

  return (
    <main className="app">
      <header className="top">
        <button className="back" onClick={onBack} aria-label="Назад">
          ←
        </button>
        <h1>Тайминг</h1>
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
          <span
            key={i}
            className={`beat ${beat >= 0 && beat % BEATS_PER_BAR === i ? 'on' : ''} ${i === 0 ? 'accent' : ''}`}
          />
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
              <span>{summary.count ? fmtMs(summary.meanMs) : '—'}</span>среднее, мс
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

      <TapPad enabled={mode !== 'idle'} label={mode === 'idle' ? 'Выбери режим' : 'ТАП'} flash={flash} onTap={onTap} />

      <details className="diag">
        <summary>Диагностика</summary>
        <ul>
          <li>Частота: {diag.sampleRate} Гц</li>
          <li>baseLatency: {diag.baseLatencyMs?.toFixed(1) ?? 'нет'} мс</li>
          <li>outputLatency: {diag.outputLatencyMs?.toFixed(1) ?? 'нет'} мс</li>
          <li>getOutputTimestamp: {diag.hasOutputTimestamp ? 'да' : 'нет'}</li>
          <li>Состояние: {diag.state}</li>
        </ul>
        {offsetMs !== null && mode === 'idle' && (
          <button
            className="link"
            onClick={() => {
              onOffsetChange(null);
              setCalibration(null);
            }}
          >
            Сбросить калибровку
          </button>
        )}
      </details>
    </main>
  );
}
