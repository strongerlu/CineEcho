// Web preview only: timer-driven fake playback (no audio). iOS uses player.ts.
import { ensureManifest, getLocalMovie, listLocalMovies, loadManifest } from './downloads.web';
import { getProgress, loadSettings, setProgress } from './storage';
import type { LocalMovie, Settings } from './types';

export interface PlayerState {
  movie: LocalMovie | null;
  index: number;
  count: number;
  position: number;
  duration: number;
  playing: boolean;
  inGap: boolean;
  finished: boolean;
}

const EMPTY: PlayerState = { movie: null, index: 0, count: 0, position: 0, duration: 0, playing: false, inGap: false, finished: false };
const TICK = 200;

class FakePlayer {
  private state = EMPTY;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private offsets: number[] = [];
  private durations: number[] = [];
  private inSentence = 0;
  private gapLeft = 0;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = () => this.state;
  private set(p: Partial<PlayerState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  async load(id: string, opts: { autoplay?: boolean; startIndex?: number } = {}) {
    const movie = getLocalMovie(id);
    if (!movie) throw new Error('电影尚未下载');
    await ensureManifest(id);
    if (this.state.movie?.id !== id || opts.startIndex !== undefined) {
      this.stop();
      const segs = loadManifest(id).segments;
      this.durations = segs.map((s) => s.duration);
      this.offsets = [];
      let total = 0;
      for (const d of this.durations) {
        this.offsets.push(total);
        total += d;
      }
      const index = Math.min(opts.startIndex ?? getProgress(id), segs.length - 1);
      this.inSentence = 0;
      this.set({ ...EMPTY, movie, count: segs.length, index, position: this.offsets[index], duration: total });
    }
    if (opts.autoplay) this.play();
  }

  unload() {
    this.stop();
    this.set(EMPTY);
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick = () => {
    const { rate, gapSeconds } = loadSettings();
    if (this.gapLeft > 0) {
      this.gapLeft -= TICK / 1000;
      if (this.gapLeft <= 0) this.go(this.state.index + 1);
      return;
    }
    this.inSentence += (TICK / 1000) * rate;
    const { index } = this.state;
    if (this.inSentence < this.durations[index]) {
      this.set({ position: this.offsets[index] + this.inSentence });
      return;
    }
    if (index >= this.state.count - 1) return this.endOfMovie();
    if (gapSeconds > 0) {
      this.gapLeft = gapSeconds;
      this.set({ inGap: true, position: this.offsets[index + 1] });
    } else this.go(index + 1);
  };

  private endOfMovie() {
    const loop = loadSettings().loopMode;
    if (loop === 'movie') return this.go(0);
    if (loop === 'list') {
      const all = listLocalMovies();
      const next = all[(all.findIndex((m) => m.id === this.state.movie?.id) + 1) % all.length];
      void this.load(next.id, { autoplay: true, startIndex: 0 });
      return;
    }
    this.stop();
    if (this.state.movie) setProgress(this.state.movie.id, 0);
    this.set({ playing: false, finished: true, position: this.state.duration });
  }

  private go(i: number) {
    this.inSentence = 0;
    this.gapLeft = 0;
    this.set({ index: i, position: this.offsets[i] ?? 0, finished: false, inGap: false });
    if (this.state.movie) setProgress(this.state.movie.id, i);
  }

  play() {
    if (!this.state.movie) return;
    if (this.state.finished) this.go(0);
    this.stop();
    this.timer = setInterval(this.tick, TICK);
    this.set({ playing: true });
  }
  pause() {
    this.stop();
    this.gapLeft = 0;
    this.set({ playing: false, inGap: false });
  }
  toggle() {
    if (this.state.playing) this.pause();
    else this.play();
  }
  indexAt(seconds: number) {
    let i = 0;
    while (i + 1 < this.offsets.length && this.offsets[i + 1] <= seconds) i++;
    return i;
  }
  seekToTime(seconds: number) {
    this.skipTo(this.indexAt(seconds));
  }
  next() {
    if (this.state.index < this.state.count - 1) this.go(this.state.index + 1);
  }
  previous() {
    this.go(Math.max(0, this.state.index - 1));
  }
  skipTo(i: number) {
    this.go(Math.max(0, Math.min(i, this.state.count - 1)));
  }
  applySettings(_s: Settings) {}
}

export const player = new FakePlayer();
