export type MovieStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface RemoteMovie {
  id: string;
  title: string;
  status: MovieStatus;
  error: string | null;
  progress: number;
  segmentCount: number;
  duration: number;
  sizeBytes: number;
  posterAt: string | null;
  updatedAt: string;
}

export interface Segment {
  index: number;
  file: string;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  duration: number;
  sizeBytes: number;
}

export interface SegmentManifest {
  version: 1;
  movieId: string;
  segments: Segment[];
}

export interface LocalMovie {
  id: string;
  title: string;
  segmentCount: number;
  duration: number;
  sizeBytes: number;
  downloadedAt: string;
  /** Server posterAt of the locally cached poster file. */
  posterAt?: string | null;
  posterFile?: string | null;
}

/** Where to load a poster from: a local file, or the server (needs auth header). */
export interface PosterSource {
  uri: string;
  headers?: Record<string, string>;
}

export type LoopMode = 'none' | 'movie' | 'list';

export interface Settings {
  serverUrl: string;
  rate: number;
  gapSeconds: number;
  loopMode: LoopMode;
}
