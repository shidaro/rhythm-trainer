// "Read and play" exercises. Rhythm format: see parseRhythm in core/rhythm.ts.

import { parseRhythm } from '../core/rhythm';
import type { Rhythm } from '../core/rhythm';

export interface Exercise {
  id: string;
  title: string;
  hint: string;
  bpm: number;
  rhythm: Rhythm;
}

const def = (id: string, title: string, hint: string, bpm: number, src: string): Exercise => ({
  id,
  title,
  hint,
  bpm,
  rhythm: parseRhythm(src),
});

export const READING: Exercise[] = [
  def('r01', 'Четверти', 'Один тап на каждый щелчок метронома.', 80, '4/4: q q q q | q q q q'),
  def('r02', 'Половинные', 'Половинная длится два щелчка: тапай на первом.', 80, '4/4: h h | q q h | h q q | h h'),
  def('r03', 'Целые', 'Целая длится весь такт: один тап и считай до четырёх.', 80, '4/4: w | h h | q q q q | w'),
  def('r04', 'Паузы', 'На паузе не тапай, но продолжай считать.', 80, '4/4: q qr q qr | q q qr q | qr q q q | h hr'),
  def('r05', 'Восьмые', 'Две восьмые на один щелчок: «раз-и».', 70, '4/4: 8 8 8 8 q q | q q 8 8 q | 8 8 8 8 8 8 8 8 | h h'),
  def('r06', 'Четверти и восьмые', 'Чередуй: ровные шаги и быстрые пары.', 75, '4/4: q 8 8 q 8 8 | 8 8 q q q | q 8 8 8 8 q | w'),
  def('r07', 'Половинная с точкой', 'Точка добавляет половину длительности: три щелчка.', 80, '4/4: h. q | q h. | h. q | w'),
  def('r08', 'Размер 3/4', 'Три доли в такте, вальс.', 90, '3/4: q q q | h q | q 8 8 q | h.'),
  def('r09', 'Четверть с точкой', 'Четверть с точкой и восьмая: «раз-и-два».', 70, '4/4: q. 8 q q | q. 8 h | q q q. 8 | w'),
  def('r10', 'Восьмые паузы', 'Тап на «и», а на доле пауза.', 70, '4/4: 8r 8 8r 8 q q | q 8r 8 h | 8r 8 8r 8 8r 8 8r 8 | w'),
  def('r11', 'Всё вместе', 'Финальное упражнение уровня.', 80, '4/4: q 8 8 qr q | 8 8 8 8 h | q. 8 8 8 q | q qr h'),
];

export const getExercise = (id: string) => READING.find((e) => e.id === id);
