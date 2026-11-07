import type { KeyboardEvent, PointerEvent } from 'react';
import type { Grade } from '../core/timing';

export interface Flash {
  grade: Grade | 'neutral';
  key: number;
}

interface Props {
  enabled: boolean;
  label: string;
  flash: Flash | null;
  /** Receives the DOM event timestamp (performance.now clock). */
  onTap: (timeStamp: number) => void;
}

/** Large tap area. Reacts on pointerdown (not click) for the lowest latency; Space/Enter also work. */
export function TapPad({ enabled, label, flash, onTap }: Props) {
  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    if (enabled) onTap(e.timeStamp);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return;
    e.preventDefault();
    if (enabled) onTap(e.timeStamp);
  };
  return (
    <button
      className={`pad ${enabled ? '' : 'disabled'}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="Тап"
    >
      {flash && <span key={flash.key} className={`flash ${flash.grade}`} />}
      <span className="pad-label">{label}</span>
    </button>
  );
}
