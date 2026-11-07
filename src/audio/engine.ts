// Web Audio wrapper: unlocking on iOS, metronome/tap sounds with separate
// volume buses, and mapping DOM event timestamps (performance.now clock) to
// the audio clock.

import * as drums from './drums';
import type { Hit } from './drums';

interface AudioSessionLike {
  type: string;
}

export type MetronomeSound = 'click' | 'drums' | 'hihat' | 'cowbell';
export type TapSound = 'snare' | 'clap' | 'woodblock' | 'kick' | 'none';

export interface SoundSettings {
  metronome: MetronomeSound;
  tap: TapSound;
  /** 0..1 */
  metronomeVolume: number;
  /** 0..1 */
  tapVolume: number;
}

export const DEFAULT_SOUNDS: SoundSettings = {
  metronome: 'drums',
  tap: 'snare',
  metronomeVolume: 0.7,
  tapVolume: 0.9,
};

const TAP_HITS: Record<Exclude<TapSound, 'none'>, Hit> = {
  snare: drums.snare,
  clap: drums.clap,
  woodblock: drums.woodblock,
  kick: drums.kick,
};

export interface Diagnostics {
  sampleRate: number;
  baseLatencyMs: number | null;
  outputLatencyMs: number | null;
  hasOutputTimestamp: boolean;
  state: AudioContextState;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  private readonly noise: AudioBuffer;
  private readonly metronomeBus: GainNode;
  private readonly tapBus: GainNode;
  private sounds: SoundSettings = DEFAULT_SOUNDS;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.noise = drums.createNoise(this.ctx);
    this.metronomeBus = this.ctx.createGain();
    this.tapBus = this.ctx.createGain();
    this.metronomeBus.connect(this.ctx.destination);
    this.tapBus.connect(this.ctx.destination);
    this.setSounds(DEFAULT_SOUNDS);
  }

  setSounds(s: SoundSettings): void {
    this.sounds = s;
    this.metronomeBus.gain.value = s.metronomeVolume;
    this.tapBus.gain.value = s.tapVolume;
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

  /** Schedules one metronome beat with the selected sound. */
  beat(time: number, accent: boolean, sound: MetronomeSound = this.sounds.metronome): AudioScheduledSourceNode[] {
    const { ctx, metronomeBus: out, noise } = this;
    switch (sound) {
      case 'click':
        return drums.click(ctx, out, time, noise, accent ? 1 : 0.7);
      case 'hihat':
        return drums.hihat(ctx, out, time, noise, accent ? 1 : 0.6);
      case 'cowbell':
        return drums.cowbell(ctx, out, time, noise, accent ? 1 : 0.6);
      case 'drums':
        return accent
          ? [...drums.kick(ctx, out, time, noise, 1), ...drums.hihat(ctx, out, time, noise, 0.8)]
          : drums.hihat(ctx, out, time, noise, 0.7);
    }
  }

  /** Schedules the "player" instrument: used for taps and for playing rhythms back. */
  hit(time: number, sound: TapSound = this.sounds.tap): AudioScheduledSourceNode[] {
    if (sound === 'none') return [];
    return TAP_HITS[sound](this.ctx, this.tapBus, time, this.noise, 1);
  }

  /** Sound for listening to a rhythm: the tap instrument, or a woodblock if taps are silent. */
  rhythmNote(time: number): AudioScheduledSourceNode[] {
    return this.hit(time, this.sounds.tap === 'none' ? 'woodblock' : this.sounds.tap);
  }

  /** Immediate feedback for a tap. */
  tapNow(): void {
    this.hit(this.ctx.currentTime);
  }

  /**
   * Converts a performance.now()-based timestamp (e.g. PointerEvent.timeStamp)
   * into "audible" audio-clock time: the context time of the sample that was
   * coming out of the speaker at that moment. A sound scheduled at time t is
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
