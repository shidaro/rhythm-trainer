import type { AudioEngine, MetronomeSound, SoundSettings, TapSound } from '../audio/engine';

interface Props {
  engine: AudioEngine;
  sounds: SoundSettings;
  onChange: (s: SoundSettings) => void;
  onBack: () => void;
  onOpenLab: () => void;
}

const METRONOME_OPTIONS: { value: MetronomeSound; label: string }[] = [
  { value: 'drums', label: 'Ударные' },
  { value: 'hihat', label: 'Хай-хэт' },
  { value: 'click', label: 'Щелчок' },
  { value: 'cowbell', label: 'Ковбелл' },
];

const TAP_OPTIONS: { value: TapSound; label: string }[] = [
  { value: 'snare', label: 'Малый барабан' },
  { value: 'clap', label: 'Хлопок' },
  { value: 'woodblock', label: 'Вуд-блок' },
  { value: 'kick', label: 'Бочка' },
  { value: 'none', label: 'Без звука' },
];

export function Settings({ engine, sounds, onChange, onBack, onOpenLab }: Props) {
  const previewMetronome = (sound: MetronomeSound) => {
    const t = engine.ctx.currentTime + 0.05;
    for (let i = 0; i < 4; i++) engine.beat(t + i * 0.4, i === 0, sound);
  };

  const set = (patch: Partial<SoundSettings>) => onChange({ ...sounds, ...patch });

  return (
    <main className="app">
      <header className="top">
        <button className="back" onClick={onBack} aria-label="Назад">
          ←
        </button>
        <h1>Настройки</h1>
      </header>

      <section className="card setting">
        <h2>Звук метронома</h2>
        <div className="choices" role="radiogroup" aria-label="Звук метронома">
          {METRONOME_OPTIONS.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={sounds.metronome === o.value}
              className={sounds.metronome === o.value ? 'chosen' : ''}
              onClick={() => {
                set({ metronome: o.value });
                previewMetronome(o.value);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <label className="volume">
          <span>Громкость</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sounds.metronomeVolume}
            onChange={(e) => set({ metronomeVolume: Number(e.target.value) })}
            onPointerUp={() => previewMetronome(sounds.metronome)}
          />
        </label>
      </section>

      <section className="card setting">
        <h2>Звук тапа</h2>
        <p className="muted">Этим же звуком проигрывается ритм в режиме «Послушать».</p>
        <div className="choices" role="radiogroup" aria-label="Звук тапа">
          {TAP_OPTIONS.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={sounds.tap === o.value}
              className={sounds.tap === o.value ? 'chosen' : ''}
              onClick={() => {
                set({ tap: o.value });
                engine.hit(engine.ctx.currentTime + 0.02, o.value);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <label className="volume">
          <span>Громкость</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sounds.tapVolume}
            disabled={sounds.tap === 'none'}
            onChange={(e) => set({ tapVolume: Number(e.target.value) })}
            onPointerUp={() => engine.hit(engine.ctx.currentTime + 0.02)}
          />
        </label>
      </section>

      <button className="row lab-link" onClick={onOpenLab}>
        <span className="title">Калибровка и проверка тайминга</span>
        <span className="muted">→</span>
      </button>
    </main>
  );
}
