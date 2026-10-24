import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import type { Settings } from './types';

const TOKEN_KEY = 'cineecho.token';

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: '',
  rate: 1,
  gapSeconds: 0,
  loopMode: 'none',
};

export const RATE_OPTIONS = [0.75, 0.85, 1, 1.1, 1.25];
export const GAP_OPTIONS = [0, 0.5, 1, 2, 3];

function readJson<T>(file: File, fallback: T): T {
  try {
    if (!file.exists) return fallback;
    return { ...fallback, ...JSON.parse(file.textSync()) };
  } catch {
    return fallback;
  }
}

function writeJson(file: File, value: unknown): void {
  if (!file.exists) file.create({ intermediates: true });
  file.writeSync(JSON.stringify(value));
}

const settingsFile = () => new File(Paths.document, 'settings.json');
const progressFile = () => new File(Paths.document, 'progress.json');

export function loadSettings(): Settings {
  const s = readJson(settingsFile(), DEFAULT_SETTINGS);
  return { ...s, rate: clamp(s.rate, 0.75, 1.25), gapSeconds: clamp(s.gapSeconds, 0, 3) };
}

export function saveSettings(s: Settings): void {
  writeJson(settingsFile(), s);
}

function clamp(n: number, min: number, max: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

type ProgressMap = Record<string, number>;
let progressCache: ProgressMap | null = null;

export function getProgress(movieId: string): number {
  progressCache ??= readJson<ProgressMap>(progressFile(), {});
  return progressCache[movieId] ?? 0;
}

export function setProgress(movieId: string, index: number): void {
  progressCache ??= readJson<ProgressMap>(progressFile(), {});
  if (progressCache[movieId] === index) return;
  progressCache[movieId] = index;
  writeJson(progressFile(), progressCache);
}

export function clearProgress(movieId: string): void {
  progressCache ??= readJson<ProgressMap>(progressFile(), {});
  delete progressCache[movieId];
  writeJson(progressFile(), progressCache);
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string | null): Promise<void> {
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export const moviesRoot = () => new Directory(Paths.document, 'movies');
