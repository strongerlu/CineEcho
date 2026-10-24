// Web preview only: demo data instead of a real server. iOS uses api.ts.
import type { RemoteMovie, SegmentManifest } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function normalizeServerUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

const LINES = [
  "Here's looking at you, kid.",
  'May the Force be with you.',
  "I'm gonna make him an offer he can't refuse.",
  'You talking to me?',
  "Life was like a box of chocolates. You never know what you're gonna get.",
  "I'll be back.",
  'Houston, we have a problem.',
  'To infinity and beyond!',
];

const demo = (id: string, title: string, count: number, status: RemoteMovie['status'] = 'ready', progress = 1, poster = true): RemoteMovie => ({
  id,
  title,
  status,
  error: null,
  progress,
  segmentCount: count,
  duration: count * 2.4,
  sizeBytes: count * 21000,
  posterAt: poster ? new Date(0).toISOString() : null,
  updatedAt: new Date().toISOString(),
});

const MOVIES = [
  demo('a1', 'Forrest Gump', 1342),
  demo('e5', 'Casablanca', 811),
  demo('f6', 'Back to the Future', 1260),
  demo('b2', 'The Shawshank Redemption', 1187),
  demo('c3', 'Toy Story', 968, 'ready', 100, false),
  demo('d4', 'The Godfather', 0, 'processing', 42),
];

export async function login(): Promise<string> {
  return 'demo';
}

export async function fetchMovies(): Promise<RemoteMovie[]> {
  return MOVIES;
}

export async function fetchManifest(id: string): Promise<SegmentManifest> {
  const m = MOVIES.find((x) => x.id === id)!;
  return {
    version: 1,
    movieId: id,
    segments: Array.from({ length: m.segmentCount }, (_, i) => ({
      index: i,
      file: `${String(i + 1).padStart(5, '0')}.m4a`,
      text: LINES[i % LINES.length],
      sourceStart: i * 4,
      sourceEnd: i * 4 + 2.4,
      duration: 2.4,
      sizeBytes: 21000,
    })),
  };
}

export async function segmentUrl(id: string, file: string) {
  return { url: `demo://${id}/${file}`, headers: {} };
}

const HUES: Record<string, [string, string]> = {
  a1: ['#4b79a1', '#283e51'],
  b2: ['#614385', '#516395'],
  d4: ['#3a1c1c', '#000000'],
  e5: ['#8e7754', '#2b2b2b'],
  f6: ['#ff512f', '#3a1c71'],
};

/** Demo posters drawn as SVG so the preview works without a server. */
export function demoPoster(id: string, title: string): string {
  const [a, b] = HUES[id] ?? ['#444', '#111'];
  const words = title.toUpperCase().split(' ');
  const lines = words.map((w, i) => `<text x="60" y="${110 + i * 22}" font-size="18" font-weight="800" text-anchor="middle" fill="#fff" font-family="Georgia,serif">${w}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="120" height="180" fill="url(#g)"/><circle cx="60" cy="55" r="28" fill="#ffffff22"/>${lines}</svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export async function posterUrl(movie: RemoteMovie) {
  return { url: demoPoster(movie.id, movie.title), headers: {} };
}