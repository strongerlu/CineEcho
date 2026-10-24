import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { clampToDuration, mergeOverlaps, parseSrt } from './srt.js';

export interface Segment {
  index: number;
  file: string;
  text: string;
  /** Position in the original audio, seconds. */
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

const FADE = 0.008;

export function movieDir(cfg: Config, id: string): string {
  return path.join(cfg.dataDir, 'media', id);
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.trim().slice(-800)}`)),
    );
  });
}

/** Normalizes any uploaded image into a small JPEG thumbnail (max 360px wide). */
export async function makePoster(cfg: Config, input: string, output: string): Promise<void> {
  const partial = `${output}.${process.pid}.${Date.now()}.jpg`;
  try {
    await run(cfg.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-frames:v', '1',
      '-vf', "scale='min(360,iw)':-2",
      '-q:v', '4',
      partial,
    ]);
    await fs.rename(partial, output);
  } catch {
    await fs.rm(partial, { force: true });
    throw Object.assign(new Error('无法识别海报图片，请上传 jpg/png/webp'), { statusCode: 400 });
  }
}

export async function probeDuration(cfg: Config, file: string): Promise<number> {
  const out = await run(cfg.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const d = Number(out.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error('无法读取音频时长，文件可能不是有效的音频/视频');
  return d;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

export async function processMovie(cfg: Config, db: Db, id: string): Promise<void> {
  const movie = db.get(id);
  if (!movie) return;
  const dir = movieDir(cfg, id);
  const segDir = path.join(dir, 'segments');
  const wav = path.join(dir, 'work.wav');
  db.update(id, { status: 'processing', progress: 0, error: null });
  try {
    const source = path.join(dir, movie.audioFile);
    const srt = await fs.readFile(path.join(dir, 'subtitle.srt'), 'utf8');
    const duration = await probeDuration(cfg, source);
    const cues = clampToDuration(mergeOverlaps(parseSrt(srt)), duration);
    if (!cues.length) throw new Error('字幕中没有落在音频时长范围内的有效条目');

    await fs.rm(segDir, { recursive: true, force: true });
    await fs.mkdir(segDir, { recursive: true });
    // Decode once to PCM WAV so per-cue seeking is sample-accurate and fast.
    await run(cfg.ffmpeg, ['-y', '-v', 'error', '-i', source, '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', wav]);

    const segments: Segment[] = new Array(cues.length);
    let done = 0;
    let lastReported = -1;
    await mapLimit(cues, cfg.concurrency, async (cue, i) => {
      const dur = cue.end - cue.start;
      const file = `${String(i + 1).padStart(5, '0')}.m4a`;
      const out = path.join(segDir, file);
      const fade = Math.min(FADE, dur / 4);
      await run(cfg.ffmpeg, [
        '-y', '-v', 'error',
        '-ss', cue.start.toFixed(3), '-t', dur.toFixed(3), '-i', wav,
        '-af', `afade=t=in:d=${fade.toFixed(4)},afade=t=out:st=${(dur - fade).toFixed(4)}:d=${fade.toFixed(4)}`,
        '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out,
      ]);
      const { size } = await fs.stat(out);
      segments[i] = {
        index: i,
        file,
        text: cue.text,
        sourceStart: Number(cue.start.toFixed(3)),
        sourceEnd: Number(cue.end.toFixed(3)),
        duration: Number(dur.toFixed(3)),
        sizeBytes: size,
      };
      done++;
      const pct = Math.floor((done / cues.length) * 100);
      if (pct !== lastReported) {
        lastReported = pct;
        db.update(id, { progress: pct });
      }
    });

    const manifest: SegmentManifest = { version: 1, movieId: id, segments };
    await fs.writeFile(path.join(dir, 'segments.json'), JSON.stringify(manifest));
    db.update(id, {
      status: 'ready',
      progress: 100,
      segmentCount: segments.length,
      duration: Number(segments.reduce((s, x) => s + x.duration, 0).toFixed(3)),
      sizeBytes: segments.reduce((s, x) => s + x.sizeBytes, 0),
    });
  } catch (e) {
    db.update(id, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
  } finally {
    await fs.rm(wav, { force: true });
  }
}

/** Serial in-process job queue: one movie at a time, parallel ffmpeg inside each job. */
export class Processor {
  private queue: string[] = [];
  private running = false;
  private idleWaiters: (() => void)[] = [];

  constructor(private cfg: Config, private db: Db) {}

  enqueue(id: string): void {
    if (!this.queue.includes(id)) this.queue.push(id);
    void this.pump();
  }

  /** Re-queue movies interrupted by a restart. */
  resume(): void {
    for (const m of this.db.list().reverse()) {
      if (m.status === 'pending' || m.status === 'processing') this.enqueue(m.id);
    }
  }

  onIdle(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const id = this.queue.shift()!;
      await processMovie(this.cfg, this.db, id);
    }
    this.running = false;
    this.idleWaiters.splice(0).forEach((r) => r());
  }
}
