// Synthesised percussion (no samples: free, tiny, works offline).
// Each function schedules one hit at `time` into `out` and returns its sources
// so a caller can cancel hits that have not sounded yet.

export type Hit = (
  ctx: AudioContext,
  out: AudioNode,
  time: number,
  noise: AudioBuffer,
  velocity: number,
) => AudioScheduledSourceNode[];

export function createNoise(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function envelope(ctx: AudioContext, time: number, peak: number, decay: number, attack = 0.001): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), time + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  return g;
}

function noiseSource(ctx: AudioContext, noise: AudioBuffer, time: number, dur: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.start(time, Math.random() * 0.2);
  src.stop(time + dur);
  return src;
}

export const kick: Hit = (ctx, out, time, _noise, v) => {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, time);
  osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
  const g = envelope(ctx, time, 1.2 * v, 0.3, 0.002);
  osc.connect(g).connect(out);
  osc.start(time);
  osc.stop(time + 0.35);
  return [osc];
};

export const snare: Hit = (ctx, out, time, noise, v) => {
  const n = noiseSource(ctx, noise, time, 0.22);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1200;
  n.connect(hp).connect(envelope(ctx, time, 0.8 * v, 0.18)).connect(out);

  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(220, time);
  body.frequency.exponentialRampToValueAtTime(160, time + 0.08);
  body.connect(envelope(ctx, time, 0.7 * v, 0.09)).connect(out);
  body.start(time);
  body.stop(time + 0.12);
  return [n, body];
};

export const hihat: Hit = (ctx, out, time, noise, v) => {
  const n = noiseSource(ctx, noise, time, 0.12);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  n.connect(hp).connect(envelope(ctx, time, 0.55 * v, 0.05)).connect(out);
  return [n];
};

export const clap: Hit = (ctx, out, time, noise, v) => {
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1300;
  bp.Q.value = 0.8;
  bp.connect(out);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  // Three quick bursts followed by a short tail: the classic hand-clap shape.
  for (const dt of [0, 0.011, 0.022]) {
    g.gain.setValueAtTime(1.2 * v, time + dt);
    g.gain.exponentialRampToValueAtTime(0.1 * v, time + dt + 0.009);
  }
  g.gain.setValueAtTime(0.7 * v, time + 0.031);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
  const n = noiseSource(ctx, noise, time, 0.22);
  n.connect(g).connect(bp);
  return [n];
};

export const woodblock: Hit = (ctx, out, time, _noise, v) => {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(900, time);
  osc.frequency.exponentialRampToValueAtTime(600, time + 0.06);
  osc.connect(envelope(ctx, time, 0.9 * v, 0.1)).connect(out);
  osc.start(time);
  osc.stop(time + 0.13);
  return [osc];
};

export const cowbell: Hit = (ctx, out, time, _noise, v) => {
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 800;
  bp.Q.value = 2;
  const g = envelope(ctx, time, 0.6 * v, 0.25);
  bp.connect(g).connect(out);
  return [540, 800].map((f) => {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = f;
    osc.connect(bp);
    osc.start(time);
    osc.stop(time + 0.3);
    return osc;
  });
};

export const click: Hit = (ctx, out, time, _noise, v) => {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = v > 0.85 ? 1760 : 1175;
  osc.connect(envelope(ctx, time, 0.7 * v, 0.05)).connect(out);
  osc.start(time);
  osc.stop(time + 0.06);
  return [osc];
};
