import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp, type AppContext } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cineecho-'));
const cfg = loadConfig({ CINEECHO_PASSWORD: 'secret', DATA_DIR: path.join(tmp, 'data') });
const audioPath = path.join(tmp, 'movie.mp3');
const SRT =
  '1\n00:00:01,000 --> 00:00:02,500\nFirst line.\n\n' +
  '2\n00:00:04,000 --> 00:00:05,000\nSecond line.\n\n' +
  '3\n00:00:04,500 --> 00:00:06,000\nOverlapping.\n\n' +
  '4\n00:00:30,000 --> 00:00:31,000\nBeyond the end.\n';

let ctx: AppContext;
let base: string;
let token: string;

before(async () => {
  execFileSync(cfg.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-ac', '2', audioPath]);
  ctx = await buildApp(cfg);
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = ctx.app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(async () => {
  await ctx.processor.onIdle();
  await ctx.app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const auth = () => ({ authorization: `Bearer ${token}` });

function form(withSubtitle = true, audioName = 'movie.mp3') {
  const fd = new FormData();
  fd.append('title', 'Test Movie');
  fd.append('audio', new Blob([fs.readFileSync(audioPath)]), audioName);
  if (withSubtitle) fd.append('subtitle', new Blob([SRT]), 'movie.srt');
  return fd;
}

test('rejects unauthenticated and wrong password', async () => {
  assert.equal((await fetch(`${base}/api/movies`)).status, 401);
  const bad = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'nope' }),
  });
  assert.equal(bad.status, 401);
});

test('login returns token', async () => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'secret' }),
  });
  assert.equal(res.status, 200);
  token = (await res.json()).token;
  assert.ok(token);
});

test('upload validation', async () => {
  const noSub = await fetch(`${base}/api/movies`, { method: 'POST', headers: auth(), body: form(false) });
  assert.equal(noSub.status, 400);
  const badExt = await fetch(`${base}/api/movies`, { method: 'POST', headers: auth(), body: form(true, 'x.txt') });
  assert.equal(badExt.status, 400);
  const { movies } = await (await fetch(`${base}/api/movies`, { headers: auth() })).json();
  assert.equal(movies.length, 0);
});

test('upload, process, fetch segments, rename, delete', async () => {
  const res = await fetch(`${base}/api/movies`, { method: 'POST', headers: auth(), body: form() });
  assert.equal(res.status, 201);
  const { movie } = await res.json();
  await ctx.processor.onIdle();

  const { movies } = await (await fetch(`${base}/api/movies`, { headers: auth() })).json();
  const m = movies.find((x: { id: string }) => x.id === movie.id);
  assert.equal(m.status, 'ready', m.error);
  assert.equal(m.segmentCount, 2);
  assert.equal(m.duration, 3.5);

  const manifest = await (await fetch(`${base}/api/movies/${movie.id}/segments`, { headers: auth() })).json();
  assert.deepEqual(manifest.segments.map((s: { text: string }) => s.text), ['First line.', 'Second line. Overlapping.']);
  assert.equal(manifest.segments[1].file, '00002.m4a');

  const seg = await fetch(`${base}/api/movies/${movie.id}/segments/00002.m4a`, { headers: auth() });
  assert.equal(seg.status, 200);
  const segPath = path.join(tmp, 'seg.m4a');
  fs.writeFileSync(segPath, Buffer.from(await seg.arrayBuffer()));
  const dur = Number(execFileSync(cfg.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', segPath]).toString());
  assert.ok(Math.abs(dur - 2) < 0.06, `segment duration ${dur}`);

  assert.equal((await fetch(`${base}/api/movies/${movie.id}/segments/..%2F..%2Fx`, { headers: auth() })).status, 400);

  const renamed = await fetch(`${base}/api/movies/${movie.id}`, {
    method: 'PATCH', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify({ title: 'New' }),
  });
  assert.equal((await renamed.json()).movie.title, 'New');

  assert.equal((await fetch(`${base}/api/movies/${movie.id}`, { method: 'DELETE', headers: auth() })).status, 200);
  assert.ok(!fs.existsSync(path.join(cfg.dataDir, 'media', movie.id)));
});

test('poster upload, replace, fetch, delete', async () => {
  const png = path.join(tmp, 'poster.png');
  execFileSync(cfg.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=800x1200', '-frames:v', '1', png]);
  const fd = form();
  fd.append('poster', new Blob([fs.readFileSync(png)]), 'poster.png');
  const res = await fetch(`${base}/api/movies`, { method: 'POST', headers: auth(), body: fd });
  assert.equal(res.status, 201);
  const { movie } = await res.json();
  assert.ok(movie.posterAt);

  const img = await fetch(`${base}/api/movies/${movie.id}/poster?v=1`, { headers: auth() });
  assert.equal(img.status, 200);
  assert.match(img.headers.get('content-type') ?? '', /jpeg/);
  const jpg = path.join(tmp, 'p.jpg');
  fs.writeFileSync(jpg, Buffer.from(await img.arrayBuffer()));
  const size = execFileSync(cfg.ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', jpg]).toString().trim();
  assert.equal(size, '360,540');

  const bad = new FormData();
  bad.append('poster', new Blob(['not an image']), 'x.png');
  assert.equal((await fetch(`${base}/api/movies/${movie.id}/poster`, { method: 'PUT', headers: auth(), body: bad })).status, 400);

  const again = new FormData();
  again.append('poster', new Blob([fs.readFileSync(png)]), 'poster.png');
  const rr = await fetch(`${base}/api/movies/${movie.id}/poster`, { method: 'PUT', headers: auth(), body: again }); const replaced = await rr.json(); assert.equal(rr.status, 200, JSON.stringify(replaced));
  assert.notEqual(replaced.movie.posterAt, movie.posterAt);

  const removed = await (await fetch(`${base}/api/movies/${movie.id}/poster`, { method: 'DELETE', headers: auth() })).json();
  assert.equal(removed.movie.posterAt, null);
  assert.equal((await fetch(`${base}/api/movies/${movie.id}/poster`, { headers: auth() })).status, 404);
});
