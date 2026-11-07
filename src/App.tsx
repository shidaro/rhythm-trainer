import { useCallback, useState } from 'react';
import { AudioEngine } from './audio/engine';
import { READING, getExercise } from './content/reading';
import { load, remove, save } from './lib/storage';
import { ExerciseScreen } from './screens/ExerciseScreen';
import { Home } from './screens/Home';
import { TimingLab } from './screens/TimingLab';

type Route = { name: 'home' } | { name: 'lab' } | { name: 'exercise'; id: string };

const OFFSET_KEY = 'rt.offsetMs';

export default function App() {
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [offsetMs, setOffsetMs] = useState<number | null>(() => load<number | null>(OFFSET_KEY, null));

  const changeOffset = useCallback((ms: number | null) => {
    setOffsetMs(ms);
    if (ms === null) remove(OFFSET_KEY);
    else save(OFFSET_KEY, ms);
  }, []);

  const unlock = async () => {
    const next = engine ?? new AudioEngine();
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
    />
  );
}
