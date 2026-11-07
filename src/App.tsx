import { useCallback, useEffect, useState } from 'react';
import { AudioEngine } from './audio/engine';
import type { SoundSettings } from './audio/engine';
import { READING, getExercise } from './content/reading';
import { loadSounds, saveSounds } from './lib/settings';
import { load, remove, save } from './lib/storage';
import { ExerciseScreen } from './screens/ExerciseScreen';
import { Home } from './screens/Home';
import { Settings } from './screens/Settings';
import { TimingLab } from './screens/TimingLab';

type Route =
  | { name: 'home' }
  | { name: 'lab' }
  | { name: 'settings'; back: Route }
  | { name: 'exercise'; id: string };

const OFFSET_KEY = 'rt.offsetMs';

export default function App() {
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [offsetMs, setOffsetMs] = useState<number | null>(() => load<number | null>(OFFSET_KEY, null));

  const [sounds, setSounds] = useState<SoundSettings>(loadSounds);

  useEffect(() => {
    engine?.setSounds(sounds);
    saveSounds(sounds);
  }, [engine, sounds]);

  const changeOffset = useCallback((ms: number | null) => {
    setOffsetMs(ms);
    if (ms === null) remove(OFFSET_KEY);
    else save(OFFSET_KEY, ms);
  }, []);

  const unlock = async () => {
    const next = engine ?? new AudioEngine();
    next.setSounds(sounds);
    await next.unlock();
    setEngine(next);
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* ignore */
    }
  };

  if (!engine) {
    return (
      <main className="app start">
        <h1>Тренажёр ритма</h1>
        <p className="muted">Чувство ритма и чтение нот</p>
        <button className="primary big" onClick={unlock}>
          Начать
        </button>
        <p className="hint">Включи звук. Лучше всего работает в наушниках или через динамик телефона.</p>
      </main>
    );
  }

  const home = () => setRoute({ name: 'home' });
  const openSettings = () => setRoute({ name: 'settings', back: route });

  if (route.name === 'settings') {
    return (
      <Settings
        engine={engine}
        sounds={sounds}
        onChange={setSounds}
        onBack={() => setRoute(route.back)}
        onOpenLab={() => setRoute({ name: 'lab' })}
      />
    );
  }

  if (route.name === 'lab') {
    return <TimingLab engine={engine} offsetMs={offsetMs} onOffsetChange={changeOffset} onBack={home} />;
  }

  if (route.name === 'exercise') {
    const exercise = getExercise(route.id);
    if (exercise) {
      const i = READING.indexOf(exercise);
      const next = READING[i + 1];
      return (
        <ExerciseScreen
          key={exercise.id}
          engine={engine}
          exercise={exercise}
          offsetMs={offsetMs ?? 0}
          onBack={home}
          onOpenSettings={openSettings}
          onNext={next ? () => setRoute({ name: 'exercise', id: next.id }) : undefined}
        />
      );
    }
  }

  return (
    <Home
      offsetMs={offsetMs}
      onOpenExercise={(id) => setRoute({ name: 'exercise', id })}
      onOpenLab={() => setRoute({ name: 'lab' })}
      onOpenSettings={openSettings}
    />
  );
}
