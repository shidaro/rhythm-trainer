import { DEFAULT_SOUNDS } from '../audio/engine';
import type { SoundSettings } from '../audio/engine';
import { load, save } from './storage';

const KEY = 'rt.sounds.v1';

export function loadSounds(): SoundSettings {
  return { ...DEFAULT_SOUNDS, ...load<Partial<SoundSettings>>(KEY, {}) };
}

export function saveSounds(s: SoundSettings): void {
  save(KEY, s);
}
