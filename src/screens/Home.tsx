import { READING } from '../content/reading';
import { loadProgress } from '../lib/progress';

interface Props {
  offsetMs: number | null;
  onOpenExercise: (id: string) => void;
  onOpenLab: () => void;
  onOpenSettings: () => void;
}

export function Home({ offsetMs, onOpenExercise, onOpenLab, onOpenSettings }: Props) {
  const progress = loadProgress();
  return (
    <main className="app">
      <header className="top">
        <h1>Тренажёр ритма</h1>
        <button className="icon" onClick={onOpenSettings} aria-label="Настройки">
          ⚙︎
        </button>
      </header>

      {offsetMs === null && (
        <button className="card banner" onClick={onOpenLab}>
          <strong>Сначала калибровка</strong>
          <span>30 секунд: тапай в такт метроному, и приложение учтёт задержку твоего устройства.</span>
        </button>
      )}

      <section>
        <h2 className="section-title">Чтение с листа</h2>
        <ol className="list">
          {READING.map((ex, i) => {
            const best = progress[ex.id];
            return (
              <li key={ex.id}>
                <button className="row" onClick={() => onOpenExercise(ex.id)}>
                  <span className="num">{i + 1}</span>
                  <span className="title">{ex.title}</span>
                  <span className="row-stars" aria-label={best ? `${best.stars} из 3` : 'не пройдено'}>
                    {[1, 2, 3].map((s) => (
                      <span key={s} className={best && s <= best.stars ? 'on' : ''}>
                        ★
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <button className="row lab-link" onClick={onOpenLab}>
        <span className="title">Калибровка и проверка тайминга</span>
        <span className="muted">{offsetMs === null ? 'не настроено' : `${offsetMs.toFixed(0)} мс`}</span>
      </button>
    </main>
  );
}
