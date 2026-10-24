// Web preview only (browser has no expo-file-system / SecureStore). iOS uses storage.ts.
import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: 'https://demo.cineecho',
  rate: 1,
  gapSeconds: 0,
  loopMode: 'none',
};

export const RATE_OPTIONS = [0.75, 0.85, 1, 1.1, 1.25];
export const GAP_OPTIONS = [0, 0.5, 1, 2, 3];

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => localStorage.setItem(key, JSON.stringify(v));

export const loadSettings = (): Settings => read('cineecho.settings', DEFAULT_SETTINGS);
export const saveSettings = (s: Settings) => write('cineecho.settings', s);

const progress = (): Record<string, number> => read('cineecho.progress', {});
export const getProgress = (id: string) => progress()[id] ?? 0;
export const setProgress = (id: string, i: number) => write('cineecho.progress', { ...progress(), [id]: i });
export const clearProgress = (id: string) => {
  const p = progress();
  delete p[id];
  write('cineecho.progress', p);
};

export const getToken = async () => localStorage.getItem('cineecho.token') ?? 'demo';
export const setToken = async (t: string | null) =>
  t ? localStorage.setItem('cineecho.token', t) : localStorage.removeItem('cineecho.token');
