// Web Audio wrapper: unlocking on iOS, click synthesis, and mapping
// DOM event timestamps (performance.now clock) to the audio clock.

interface AudioSessionLike {
  type: string;
}

export interface Diagnostics {
  sampleRate: number;
  baseLatencyMs: number | null;
  outputLatencyMs: number | null;
  hasOutputTimestamp: boolean;
  state: AudioContextState;
}

export class AudioEngine {
  readonly ctx: AudioContext;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
  }

  /** Must be called from a user gesture (tap/click). */
  async unlock(): Promise<void> {
    // Safari 16.4+: play through the silent switch like a media app.
    const session = (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;
    if (session) {
      try {
        session.type = 'playback';
      } catch {
        /* unsupported */
      }
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    // Play one silent sample: older iOS versions only unlock after a source starts in a gesture.
    const buf = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.start();
  }

  /** Schedules a short metronome click at audio time `time`. */
  click(time: number, accent: boolean, volume = 1): AudioScheduledSourceNode {
    return this.tone(time, accent ? 1760 : 1175, (accent ? 0.9 : 0.6) * volume, 0.05, 'triangle');
  }

  /** Schedules a woodblock-like "note" sound used to play rhythms back. */
  note(time: number): AudioScheduledSourceNode {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, time);
    osc.frequency.exponentialRampToValueAtTime(560, time + 0.08);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.9, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.15);
    return osc;
  }

  private tone(
    time: number,
    freq: number,
    peak: number,
    decay: number,
    type: OscillatorType,
  ): AudioScheduledSourceNode {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + decay + 0.01);
    return osc;
  }

  /**
   * Converts a performance.now()-based timestamp (e.g. PointerEvent.timeStamp)
   * into "audible" audio-clock time: the context time of the sample that was
   * coming out of the speaker at that moment. A click scheduled at time t is
   * heard exactly when this function returns t.
   */
  perfToAudio(perfMs: number): number {
    const ctx = this.ctx;
    if (typeof ctx.getOutputTimestamp === 'function') {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime !== undefined && ts.performanceTime) {
        return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
      }
    }
    const latency = ctx.outputLatency || ctx.baseLatency || 0;
    return ctx.currentTime - latency + (perfMs - performance.now()) / 1000;
  }

  /** Audio-clock time currently being heard. */
  audibleNow(): number {
    return this.perfToAudio(performance.now());
  }

  diagnostics(): Diagnostics {
    const ctx = this.ctx;
    const ms = (s: number | undefined) => (typeof s === 'number' ? s * 1000 : null);
    return {
      sampleRate: ctx.sampleRate,
      baseLatencyMs: ms(ctx.baseLatency),
      outputLatencyMs: ms(ctx.outputLatency),
      hasOutputTimestamp: typeof ctx.getOutputTimestamp === 'function',
      state: ctx.state,
    };
  }
}
