// Web preview only: simulated downloads kept in localStorage. iOS uses downloads.ts.
import { demoPoster, fetchManifest } from './api.web';
import { clearProgress } from './storage';
import type { LocalMovie, PosterSource, RemoteMovie, SegmentManifest } from './types';

export interface DownloadState {
  done: number;
  total: number;
  error?: string;
}

const KEY = 'cineecho.local';
const active = new Map<string, DownloadState & { cancelled: boolean }>();
const listeners = new Set<() => void>();
const manifests = new Map<string, SegmentManifest>();
let version = 0;

const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
const readLocal = (): Record<string, LocalMovie> => JSON.parse(localStorage.getItem(KEY) ?? '{}');
const writeLocal = (v: Record<string, LocalMovie>) => localStorage.setItem(KEY, JSON.stringify(v));

export function subscribeDownloads(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const downloadsVersion = () => version;
export const getDownloadState = (id: string) => active.get(id);
export const segmentUri = (id: string, file: string) => `demo://${id}/${file}`;
export const listLocalMovies = () => Object.values(readLocal()).sort((a, b) => a.title.localeCompare(b.title));
export const getLocalMovie = (id: string): LocalMovie | undefined => readLocal()[id];

export function loadManifest(id: string): SegmentManifest {
  return manifests.get(id) ?? { version: 1, movieId: id, segments: [] };
}

export async function ensureManifest(id: string) {
  if (!manifests.has(id)) manifests.set(id, await fetchManifest(id));
}

export function deleteLocalMovie(id: string) {
  const l = readLocal();
  delete l[id];
  writeLocal(l);
  clearProgress(id);
  emit();
}

export function cancelDownload(id: string) {
  const s = active.get(id);
  if (s) s.cancelled = true;
}

export async function downloadMovie(movie: RemoteMovie) {
  if (active.has(movie.id)) return;
  const state = { done: 0, total: movie.segmentCount, cancelled: false };
  active.set(movie.id, state);
  emit();
  while (state.done < state.total) {
    if (state.cancelled) {
      active.delete(movie.id);
      emit();
      return;
    }
    await new Promise((r) => setTimeout(r, 60));
    state.done = Math.min(state.total, state.done + Math.ceil(state.total / 40));
    emit();
  }
  await ensureManifest(movie.id);
  writeLocal({
    ...readLocal(),
    [movie.id]: {
      id: movie.id,
      title: movie.title,
      segmentCount: movie.segmentCount,
      duration: movie.duration,
      sizeBytes: movie.sizeBytes,
      downloadedAt: new Date().toISOString(),
      posterAt: movie.posterAt,
      posterFile: movie.posterAt ? 'demo' : null,
    },
  });
  active.delete(movie.id);
  emit();
}

export async function syncLocalMovie(remote: RemoteMovie) {
  const l = readLocal();
  const local = l[remote.id];
  if (!local) return;
  const next = { ...local, title: remote.title, posterAt: remote.posterAt, posterFile: remote.posterAt ? 'demo' : null };
  if (JSON.stringify(next) === JSON.stringify(local)) return;
  l[remote.id] = next;
  writeLocal(l);
  emit();
}

export async function posterSource(remote?: RemoteMovie, local?: LocalMovie): Promise<PosterSource | null> {
  const m = remote ?? local;
  if (!m || !(remote?.posterAt || local?.posterFile)) return null;
  return { uri: demoPoster(m.id, m.title) };
}
