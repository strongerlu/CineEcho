import path from 'node:path';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  password: string;
  ffmpeg: string;
  ffprobe: string;
  concurrency: number;
}

export function loadConfig(env = process.env): Config {
  const password = env.CINEECHO_PASSWORD ?? '';
  if (!password) throw new Error('CINEECHO_PASSWORD environment variable is required');
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    password,
    ffmpeg: env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobe: env.FFPROBE_PATH ?? 'ffprobe',
    concurrency: Math.max(1, Number(env.FFMPEG_CONCURRENCY ?? 4)),
  };
}
