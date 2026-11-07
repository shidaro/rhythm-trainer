// Look-ahead metronome ("a tale of two clocks"): a coarse JS timer wakes up
// every 25 ms and schedules clicks precisely on the audio clock.

import type { AudioEngine } from './engine';

export interface MetronomeOptions {
  bpm: number;
  beatsPerBar: number;
  /** Stop after this many beats (undefined = endless). */
  maxBeats?: number;
  /** Called for each beat as it is scheduled (ahead of time). */
  onSchedule?: (index: number, time: number) => void;
  /** Called shortly after the last beat has sounded. */
  onEnd?: () => void;
}

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;

export class Metronome {
  private timer: ReturnType<typeof setInterval> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private nextTime = 0;
  private index = 0;
  private readonly engine: AudioEngine;
  private readonly opts: MetronomeOptions;

  constructor(engine: AudioEngine, opts: MetronomeOptions) {
    this.engine = engine;
    this.opts = opts;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(delayS = 0.3): void {
    this.stop();
    this.nextTime = this.engine.ctx.currentTime + delayS;
    this.index = 0;
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    if (this.endTimer !== null) clearTimeout(this.endTimer);
    this.timer = null;
    this.endTimer = null;
  }

  private tick(): void {
    const { ctx } = this.engine;
    const { bpm, beatsPerBar, maxBeats, onSchedule, onEnd } = this.opts;
    const period = 60 / bpm;
    while (this.nextTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      if (maxBeats !== undefined && this.index >= maxBeats) {
        const lastBeat = this.nextTime - period;
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
        const waitMs = Math.max(0, (lastBeat + 0.5 - ctx.currentTime) * 1000);
        this.endTimer = setTimeout(() => {
          this.endTimer = null;
          onEnd?.();
        }, waitMs);
        return;
      }
      this.engine.click(this.nextTime, this.index % beatsPerBar === 0);
      onSchedule?.(this.index, this.nextTime);
      this.nextTime += period;
      this.index++;
    }
  }
}
