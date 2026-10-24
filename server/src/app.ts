import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import cookie from '@fastify/cookie';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import type { Config } from './config.js';
import { Db } from './db.js';
import { makePoster, movieDir, Processor } from './processor.js';
import { parseSrt } from './srt.js';

const AUDIO_EXT = /^\.(mp3|m4a|aac|wav|flac|ogg|opus|wma|mp4|mkv|mov|avi|webm|m4v|ac3|eac3|dts|mka)$/i;
const SEGMENT_FILE = /^\d{5}\.m4a$/;
const ID_RE = /^[a-f0-9]{16}$/;
const POSTER_FILE = 'poster.jpg';

export function tokenFor(password: string): string {
  return crypto.createHmac('sha256', password).update('cineecho-token-v1').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export interface AppContext {
  app: FastifyInstance;
  db: Db;
  processor: Processor;
}

export async function buildApp(cfg: Config): Promise<AppContext> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test', bodyLimit: 1024 * 1024 });
  const db = new Db(cfg.dataDir);
  const processor = new Processor(cfg, db);
  const token = tokenFor(cfg.password);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 8 * 1024 ** 3, files: 3, fields: 10 } });
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  await app.register(fastifyStatic, { root: publicDir, prefix: '/' });

  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    const given = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies.token;
    if (!given || !safeEqual(given, token)) return reply.code(401).send({ error: '未登录或密码错误' });
  };

  const loadMovie = (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const movie = ID_RE.test(id) ? db.get(id) : undefined;
    if (!movie) {
      reply.code(404).send({ error: '电影不存在' });
      return undefined;
    }
    return movie;
  };

  app.get('/api/health', async () => ({ ok: true }));

  app.post('/api/login', async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: string };
    if (typeof password !== 'string' || !safeEqual(password, cfg.password)) {
      return reply.code(401).send({ error: '密码错误' });
    }
    reply.setCookie('token', token, { path: '/', httpOnly: true, sameSite: 'strict', maxAge: 60 * 60 * 24 * 365 });
    return { token };
  });

  app.post('/api/logout', async (_req, reply) => {
    reply.clearCookie('token', { path: '/' });
    return { ok: true };
  });

  app.register(async (api) => {
    api.addHook('onRequest', requireAuth);

    api.get('/api/movies', async () => ({ movies: db.list() }));

    api.post('/api/movies', async (req, reply) => {
      const id = crypto.randomBytes(8).toString('hex');
      const dir = movieDir(cfg, id);
      await fsp.mkdir(dir, { recursive: true });
      let title = '';
      let audioFile = '';
      let audioName = '';
      let hasSubtitle = false;
      let posterUpload = '';
      try {
        for await (const part of req.parts()) {
          if (part.type === 'field') {
            if (part.fieldname === 'title') title = String(part.value ?? '').trim();
            continue;
          }
          if (part.fieldname === 'audio') {
            const ext = path.extname(part.filename || '').toLowerCase();
            if (!AUDIO_EXT.test(ext)) {
              part.file.resume();
              throw Object.assign(new Error(`不支持的音频格式: ${ext || '(无扩展名)'}`), { statusCode: 400 });
            }
            audioFile = `source${ext}`;
            audioName = part.filename;
            await pipeline(part.file, fs.createWriteStream(path.join(dir, audioFile)));
          } else if (part.fieldname === 'subtitle') {
            if (path.extname(part.filename || '').toLowerCase() !== '.srt') {
              part.file.resume();
              throw Object.assign(new Error('字幕必须是 .srt 文件'), { statusCode: 400 });
            }
            await pipeline(part.file, fs.createWriteStream(path.join(dir, 'subtitle.srt')));
            hasSubtitle = true;
          } else if (part.fieldname === 'poster' && part.filename) {
            posterUpload = path.join(dir, 'poster-upload.tmp');
            await pipeline(part.file, fs.createWriteStream(posterUpload));
          } else {
            part.file.resume();
          }
          if (part.file.truncated) throw Object.assign(new Error('文件过大'), { statusCode: 413 });
        }
        if (!audioFile) throw Object.assign(new Error('缺少音频文件'), { statusCode: 400 });
        if (!hasSubtitle) throw Object.assign(new Error('缺少 SRT 字幕文件'), { statusCode: 400 });
        const cues = parseSrt(await fsp.readFile(path.join(dir, 'subtitle.srt'), 'utf8'));
        if (!cues.length) throw Object.assign(new Error('SRT 字幕中没有解析到任何条目'), { statusCode: 400 });
        if (posterUpload) {
          await makePoster(cfg, posterUpload, path.join(dir, POSTER_FILE));
          await fsp.rm(posterUpload, { force: true });
        }
      } catch (e) {
        await fsp.rm(dir, { recursive: true, force: true });
        const err = e as Error & { statusCode?: number };
        return reply.code(err.statusCode ?? 500).send({ error: err.message });
      }
      db.insert({ id, title: title || audioName.replace(/\.[^.]+$/, ''), audioFile });
      if (posterUpload) db.update(id, { posterAt: new Date().toISOString() });
      processor.enqueue(id);
      return reply.code(201).send({ movie: db.get(id) });
    });

    api.put('/api/movies/:id/poster', async (req, reply) => {
      const movie = loadMovie(req, reply);
      if (!movie) return;
      const dir = movieDir(cfg, movie.id);
      const tmp = path.join(dir, `poster-upload-${crypto.randomBytes(6).toString('hex')}.tmp`);
      let error: (Error & { statusCode?: number }) | null = null;
      try {
        const part = await req.file();
        if (!part || !part.filename) throw Object.assign(new Error('缺少海报图片'), { statusCode: 400 });
        await pipeline(part.file, fs.createWriteStream(tmp));
        await makePoster(cfg, tmp, path.join(dir, POSTER_FILE));
      } catch (e) {
        error = e as Error & { statusCode?: number };
      }
      await fsp.rm(tmp, { force: true });
      if (error) return reply.code(error.statusCode ?? 500).send({ error: error.message });
      db.update(movie.id, { posterAt: new Date().toISOString() });
      return { movie: db.get(movie.id) };
    });

    api.delete('/api/movies/:id/poster', async (req, reply) => {
      const movie = loadMovie(req, reply);
      if (!movie) return;
      await fsp.rm(path.join(movieDir(cfg, movie.id), POSTER_FILE), { force: true });
      db.update(movie.id, { posterAt: null });
      return { movie: db.get(movie.id) };
    });

    api.get('/api/movies/:id/poster', async (req, reply) => {
      const movie = loadMovie(req, reply);
      if (!movie) return;
      if (!movie.posterAt) return reply.code(404).send({ error: '没有海报' });
      // Clients add ?v=<posterAt>, so a replaced poster gets a new URL.
      return reply.sendFile(POSTER_FILE, movieDir(cfg, movie.id), { maxAge: '365d' });
    });

    api.patch('/api/movies/:id', async (req, reply) => {
      const movie = loadMovie(req, reply);
      if (!movie) return;
      const { title } = (req.body ?? {}) as { title?: string };
      if (typeof title !== 'string' || !title.trim()) return reply.code(400).send({ error: '标题不能为空' });
      db.update(movie.id, { title: title.trim() });
      return { movie: db.get(movie.id) };
    });

    api.post('/api/movies/:id/reprocess', async (req, reply) => {
      const movie = loadMovie(req, reply);
      if (!movie) return;
      if (movie.status === 'processing') return reply.code(409).send({ error: '正在处理中' });
      db.update(movie.id, { status: 'pending', progress: 0, error: null });
      processor.enqueue(movie.id);
      return { movie: db.get(movie.id) };
    });

    api.delete('/api/movies/:id', async (req, reply) => {
      const movie = loadMovie(req, reply);
      if (!movie) return;
      db.delete(movie.id);
      await fsp.rm(movieDir(cfg, movie.id), { recursive: true, force: true });
      return { ok: true };
    });

    api.get('/api/movies/:id/segments', async (req, reply) => {
      const movie = loadMovie(req, reply);
      if (!movie) return;
      if (movie.status !== 'ready') return reply.code(409).send({ error: '尚未处理完成' });
      reply.header('content-type', 'application/json; charset=utf-8');
      return fs.createReadStream(path.join(movieDir(cfg, movie.id), 'segments.json'));
    });

    api.get('/api/movies/:id/segments/:file', async (req, reply) => {
      const movie = loadMovie(req, reply);
      if (!movie) return;
      const { file } = req.params as { file: string };
      if (!SEGMENT_FILE.test(file)) return reply.code(400).send({ error: '无效的文件名' });
      return reply.sendFile(file, path.join(movieDir(cfg, movie.id), 'segments'), { maxAge: '365d', immutable: true });
    });
  });

  app.addHook('onClose', async () => {
    db.close();
  });

  return { app, db, processor };
}
