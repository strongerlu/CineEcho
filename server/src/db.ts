import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

export type MovieStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface Movie {
  id: string;
  title: string;
  status: MovieStatus;
  error: string | null;
  progress: number;
  segmentCount: number;
  duration: number;
  sizeBytes: number;
  audioFile: string;
  /** Set when a poster exists; changes whenever the poster is replaced (cache-busting). */
  posterAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  title: string;
  status: MovieStatus;
  error: string | null;
  progress: number;
  segment_count: number;
  duration: number;
  size_bytes: number;
  audio_file: string;
  poster_at: string | null;
  created_at: string;
  updated_at: string;
}

function toMovie(r: Row): Movie {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    error: r.error,
    progress: r.progress,
    segmentCount: r.segment_count,
    duration: r.duration,
    sizeBytes: r.size_bytes,
    audioFile: r.audio_file,
    posterAt: r.poster_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class Db {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'cineecho.sqlite'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS movies (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        progress INTEGER NOT NULL DEFAULT 0,
        segment_count INTEGER NOT NULL DEFAULT 0,
        duration REAL NOT NULL DEFAULT 0,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        audio_file TEXT NOT NULL,
        poster_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const cols = this.db.prepare('PRAGMA table_info(movies)').all() as unknown as { name: string }[];
    if (!cols.some((c) => c.name === 'poster_at')) this.db.exec('ALTER TABLE movies ADD COLUMN poster_at TEXT');
  }

  list(): Movie[] {
    return (this.db.prepare('SELECT * FROM movies ORDER BY created_at DESC').all() as unknown as Row[]).map(toMovie);
  }

  get(id: string): Movie | undefined {
    const r = this.db.prepare('SELECT * FROM movies WHERE id = ?').get(id) as unknown as Row | undefined;
    return r ? toMovie(r) : undefined;
  }

  insert(m: { id: string; title: string; audioFile: string }): Movie {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO movies (id, title, status, audio_file, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?)`,
      )
      .run(m.id, m.title, m.audioFile, now, now);
    return this.get(m.id)!;
  }

  update(
    id: string,
    patch: Partial<
      Pick<Movie, 'title' | 'status' | 'error' | 'progress' | 'segmentCount' | 'duration' | 'sizeBytes' | 'posterAt'>
    >,
  ): void {
    const cols: Record<string, string> = {
      title: 'title',
      status: 'status',
      error: 'error',
      progress: 'progress',
      segmentCount: 'segment_count',
      duration: 'duration',
      sizeBytes: 'size_bytes',
      posterAt: 'poster_at',
    };
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !(k in cols)) continue;
      sets.push(`${cols[k]} = ?`);
      vals.push(v as string | number | null);
    }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    vals.push(new Date().toISOString());
    this.db.prepare(`UPDATE movies SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM movies WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }
}
