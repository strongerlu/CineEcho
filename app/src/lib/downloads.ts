import { Directory, File } from 'expo-file-system';
import { fetchManifest, posterUrl, segmentUrl } from './api';
import { clearProgress, moviesRoot } from './storage';
import type { LocalMovie, PosterSource, RemoteMovie, SegmentManifest } from './types';

const CONCURRENCY = 6;

export interface DownloadState {
  done: number;
  total: number;
  error?: string;
}

type Listener = () => void;

const active = new Map<string, DownloadState & { cancelled: boolean }>();
const listeners = new Set<Listener>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function subscribeDownloads(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function downloadsVersion(): number {
  return version;
}

export function getDownloadState(id: string): DownloadState | undefined {
  return active.get(id);
}

const movieDir = (id: string) => new Directory(moviesRoot(), id);
const segDir = (id: string) => new Directory(movieDir(id), 'segments');
const metaFile = (id: string) => new File(movieDir(id), 'meta.json');
const manifestFile = (id: string) => new File(movieDir(id), 'segments.json');

export function segmentUri(id: string, file: string): string {
  return new File(segDir(id), file).uri;
}

export function listLocalMovies(): LocalMovie[] {
  const root = moviesRoot();
  if (!root.exists) return [];
  const out: LocalMovie[] = [];
  for (const entry of root.list()) {
    if (!(entry instanceof Directory)) continue;
    const meta = new File(entry, 'meta.json');
    if (!meta.exists) continue;
    try {
      out.push(JSON.parse(meta.textSync()));
    } catch {
      // incomplete or corrupt download; ignore
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export function getLocalMovie(id: string): LocalMovie | undefined {
  const meta = metaFile(id);
  if (!meta.exists) return undefined;
  try {
    return JSON.parse(meta.textSync());
  } catch {
    return undefined;
  }
}

export function loadManifest(id: string): SegmentManifest {
  return JSON.parse(manifestFile(id).textSync());
}

export function deleteLocalMovie(id: string): void {
  const state = active.get(id);
  if (state) state.cancelled = true;
  const dir = movieDir(id);
  if (dir.exists) dir.delete();
  clearProgress(id);
  emit();
}

export function cancelDownload(id: string): void {
  const state = active.get(id);
  if (state) state.cancelled = true;
}

/** Downloads (or resumes) every segment of a movie. Already-downloaded files of the right size are skipped. */
export async function downloadMovie(movie: RemoteMovie): Promise<void> {
  if (active.has(movie.id)) return;
  const state = { done: 0, total: movie.segmentCount, cancelled: false } as DownloadState & { cancelled: boolean };
  active.set(movie.id, state);
  emit();
  try {
    const manifest = await fetchManifest(movie.id);
    segDir(movie.id).create({ intermediates: true, idempotent: true });
    const meta = metaFile(movie.id);
    if (meta.exists) meta.delete();
    state.total = manifest.segments.length;
    emit();

    let next = 0;
    let lastEmit = 0;
    const worker = async () => {
      while (next < manifest.segments.length) {
        if (state.cancelled) throw new Error('已取消');
        const seg = manifest.segments[next++];
        const dest = new File(segDir(movie.id), seg.file);
        if (!(dest.exists && dest.size === seg.sizeBytes)) {
          const { url, headers } = await segmentUrl(movie.id, seg.file);
          await File.downloadFileAsync(url, dest, { headers, idempotent: true });
        }
        state.done++;
        const now = Date.now();
        if (now - lastEmit > 200 || state.done === state.total) {
          lastEmit = now;
          emit();
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    manifestFile(movie.id).create({ intermediates: true, overwrite: true });
    manifestFile(movie.id).writeSync(JSON.stringify(manifest));
    const local: LocalMovie = {
      id: movie.id,
      title: movie.title,
      segmentCount: manifest.segments.length,
      duration: manifest.segments.reduce((s, x) => s + x.duration, 0),
      sizeBytes: manifest.segments.reduce((s, x) => s + x.sizeBytes, 0),
      downloadedAt: new Date().toISOString(),
    };
    meta.create({ intermediates: true, overwrite: true });
    meta.writeSync(JSON.stringify(local));
    active.delete(movie.id);
    emit();
    void syncLocalMovie(movie);
  } catch (e) {
    state.cancelled = true;
    state.error = e instanceof Error ? e.message : String(e);
    emit();
    // Keep the error visible briefly, then clear so the user can retry.
    setTimeout(() => {
      if (active.get(movie.id) === state) {
        active.delete(movie.id);
        emit();
      }
    }, 4000);
  }
}

function writeMeta(local: LocalMovie) {
  metaFile(local.id).writeSync(JSON.stringify(local));
  emit();
}

const syncing = new Set<string>();

/** Keeps a downloaded movie's title and cached poster in step with the server. */
export async function syncLocalMovie(remote: RemoteMovie): Promise<void> {
  let local = getLocalMovie(remote.id);
  if (!local || syncing.has(remote.id)) return;
  if (local.title !== remote.title) {
    local = { ...local, title: remote.title };
    writeMeta(local);
  }
  if ((local.posterAt ?? null) === (remote.posterAt ?? null)) return;
  syncing.add(remote.id);
  try {
    const old = local.posterFile ? new File(movieDir(remote.id), local.posterFile) : null;
    let posterFile: string | null = null;
    if (remote.posterAt) {
      // Unique name per version so the image cache never shows a stale poster.
      posterFile = `poster-${Date.parse(remote.posterAt) || Date.now()}.jpg`;
      const { url, headers } = await posterUrl(remote);
      await File.downloadFileAsync(url, new File(movieDir(remote.id), posterFile), { headers, idempotent: true });
    }
    if (old?.exists && old.name !== posterFile) old.delete();
    const latest = getLocalMovie(remote.id);
    if (latest) writeMeta({ ...latest, posterAt: remote.posterAt, posterFile });
  } catch {
    // Offline or poster missing: try again on the next refresh.
  } finally {
    syncing.delete(remote.id);
  }
}

/** Prefers the offline copy; falls back to the server for movies that aren't downloaded. */
export async function posterSource(remote: RemoteMovie | undefined, local: LocalMovie | undefined): Promise<PosterSource | null> {
  if (local?.posterFile) {
    const f = new File(movieDir(local.id), local.posterFile);
    if (f.exists) return { uri: f.uri };
  }
  if (remote?.posterAt) {
    const { url, headers } = await posterUrl(remote);
    return { uri: url, headers };
  }
  return null;
}
