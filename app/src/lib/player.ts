import {
  createAudioPlayer,
  createAudioPlaylist,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioPlaylist,
  type AudioPlaylistStatus,
} from 'expo-audio';
import { getLocalMovie, listLocalMovies, loadManifest, segmentUri } from './downloads';
import { getProgress, loadSettings, setProgress } from './storage';
import type { LocalMovie, Segment, Settings } from './types';

export interface PlayerState {
  movie: LocalMovie | null;
  index: number;
  count: number;
  /** Seconds of dialogue played so far in the movie (sum of earlier sentences + time in the current one). */
  position: number;
  /** Total dialogue seconds of the movie. */
  duration: number;
  playing: boolean;
  inGap: boolean;
  finished: boolean;
}

const EMPTY: PlayerState = {
  movie: null,
  index: 0,
  count: 0,
  position: 0,
  duration: 0,
  playing: false,
  inGap: false,
  finished: false,
};

/** How close to the end of a track counts as "finished naturally" (vs. a skip). */
const NATURAL_END_TOLERANCE = 0.6;

/**
 * Plays one downloaded movie as a playlist where every subtitle line is its own track.
 * Lock-screen / Bluetooth / steering-wheel next & previous are handled natively by the
 * playlist, so they step sentence-by-sentence even while JS is throttled in the background.
 */
class PlayerEngine {
  private playlist: AudioPlaylist | null = null;
  private silence: AudioPlayer | null = null;
  private segments: Segment[] = [];
  /** offsets[i] = start of sentence i on the movie's dialogue timeline. */
  private offsets: number[] = [];
  private subs: { remove(): void }[] = [];
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private last = { index: 0, time: 0, duration: 0 };
  private wantPlaying = false;
  private commandAt = 0;
  private sessionReady = false;
  private state: PlayerState = EMPTY;
  private listeners = new Set<() => void>();

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = () => this.state;

  private set(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private async ensureSession() {
    if (this.sessionReady) return;
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
    // Played (silently) during sentence gaps so iOS keeps the app alive while the playlist is paused.
    this.silence = createAudioPlayer(require('../../assets/silence.m4a'), { keepAudioSessionActive: true });
    this.silence.loop = true;
    this.sessionReady = true;
  }

  async load(movieId: string, opts: { autoplay?: boolean; startIndex?: number } = {}) {
    await this.ensureSession();
    const movie = getLocalMovie(movieId);
    if (!movie) throw new Error('电影尚未下载');
    if (this.state.movie?.id === movieId && this.playlist && opts.startIndex === undefined) {
      if (opts.autoplay) this.play();
      return;
    }
    this.unload();

    const { segments } = loadManifest(movieId);
    if (!segments.length) throw new Error('这部电影没有对白片段');
    this.segments = segments;
    this.offsets = [];
    let total = 0;
    for (const s of segments) {
      this.offsets.push(total);
      total += s.duration;
    }
    const settings = loadSettings();
    const start = Math.min(opts.startIndex ?? getProgress(movieId), segments.length - 1);

    const playlist = createAudioPlaylist({
      sources: segments.map((s) => ({ uri: segmentUri(movieId, s.file), name: s.text })),
      loop: settings.loopMode === 'movie' ? 'all' : 'none',
      updateInterval: 200,
    });
    this.playlist = playlist;
    if (start > 0) playlist.skipTo(start);
    playlist.playbackRate = settings.rate;
    this.last = { index: start, time: 0, duration: 0 };

    this.subs.push(
      playlist.addListener('trackChanged', ({ previousIndex, currentIndex }) =>
        this.onTrackChanged(previousIndex, currentIndex),
      ),
      playlist.addListener('playlistStatusUpdate', (s) => this.onStatus(s)),
    );

    playlist.setActiveForLockScreen(true, this.metadata(start, movie), {
      showNextTrack: true,
      showPreviousTrack: true,
      showSeekForward: false,
      showSeekBackward: false,
    });

    this.set({
      movie,
      index: start,
      count: segments.length,
      position: this.offsets[start],
      duration: total,
      playing: false,
      inGap: false,
      finished: false,
    });
    setProgress(movieId, start);
    if (opts.autoplay) this.play();
  }

  unload() {
    this.clearGap();
    this.subs.forEach((s) => s.remove());
    this.subs = [];
    if (this.playlist) {
      this.playlist.pause();
      this.playlist.clearLockScreenControls();
      this.playlist.destroy();
      this.playlist = null;
    }
    this.wantPlaying = false;
    this.set(EMPTY);
  }

  private metadata(index: number, movie = this.state.movie) {
    const seg = this.segments[index];
    return {
      title: seg?.text || '…',
      artist: movie?.title ?? 'CineEcho',
      albumTitle: `${index + 1} / ${this.segments.length}`,
    };
  }

  play() {
    if (!this.playlist) return;
    if (this.state.finished) {
      this.playlist.skipTo(0);
      this.set({ finished: false, index: 0, position: 0 });
    }
    this.clearGap();
    this.wantPlaying = true;
    this.commandAt = Date.now();
    this.playlist.playbackRate = loadSettings().rate;
    this.playlist.play();
    this.set({ playing: true });
  }

  pause() {
    this.clearGap();
    this.wantPlaying = false;
    this.commandAt = Date.now();
    this.playlist?.pause();
    this.set({ playing: false });
  }

  toggle() {
    if (this.state.playing || this.state.inGap) this.pause();
    else this.play();
  }

  next() {
    if (!this.playlist) return;
    const { index, count } = this.state;
    if (index >= count - 1) {
      if (loadSettings().loopMode === 'list') void this.advanceMovie();
      else if (loadSettings().loopMode === 'movie') this.skipTo(0);
      return;
    }
    this.markSkip();
    this.playlist.next();
  }

  previous() {
    if (!this.playlist) return;
    if (this.state.index === 0) {
      void this.playlist.seekTo(0);
      return;
    }
    this.markSkip();
    this.playlist.previous();
  }

  /** Index of the sentence playing at `seconds` on the dialogue timeline. */
  indexAt(seconds: number): number {
    let lo = 0;
    let hi = this.offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsets[mid] <= seconds) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  /** Progress-bar seek: jumps to the start of the sentence at that time. */
  seekToTime(seconds: number) {
    this.skipTo(this.indexAt(seconds));
  }

  skipTo(index: number) {
    if (!this.playlist) return;
    const i = Math.max(0, Math.min(index, this.state.count - 1));
    this.clearGap();
    this.markSkip();
    this.playlist.skipTo(i);
    this.set({ index: i, position: this.offsets[i] ?? 0, finished: false });
    if (this.wantPlaying) {
      this.commandAt = Date.now();
      this.playlist.play();
    }
  }

  applySettings(s: Settings) {
    if (!this.playlist) return;
    this.playlist.playbackRate = s.rate;
    this.playlist.loop = s.loopMode === 'movie' ? 'all' : 'none';
  }

  /** In-app skips must never be mistaken for natural track ends. */
  private markSkip() {
    this.last.time = 0;
  }

  private clearGap() {
    if (this.gapTimer) clearTimeout(this.gapTimer);
    this.gapTimer = null;
    this.silence?.pause();
    if (this.state.inGap) this.set({ inGap: false });
  }

  private onTrackChanged(previousIndex: number, currentIndex: number) {
    const natural =
      this.last.index === previousIndex &&
      this.last.duration > 0 &&
      this.last.time >= this.last.duration - NATURAL_END_TOLERANCE;
    this.last = { index: currentIndex, time: 0, duration: 0 };

    const movie = this.state.movie;
    if (movie) setProgress(movie.id, currentIndex);
    this.playlist?.updateLockScreenMetadata(this.metadata(currentIndex));
    this.set({ index: currentIndex, position: this.offsets[currentIndex] ?? 0, finished: false });

    const gap = loadSettings().gapSeconds;
    if (natural && this.wantPlaying && gap > 0 && this.playlist) {
      // The next sentence already started; pause, wait, then restart it from 0.
      this.playlist.pause();
      this.silence?.play();
      this.set({ inGap: true });
      this.gapTimer = setTimeout(async () => {
        this.gapTimer = null;
        this.silence?.pause();
        this.set({ inGap: false });
        if (!this.playlist || !this.wantPlaying) return;
        await this.playlist.seekTo(0);
        this.commandAt = Date.now();
        this.playlist.play();
      }, gap * 1000);
    } else if (!natural) {
      // Skip from lock screen / car while paused or in a gap: follow the user's play intent.
      const wasInGap = this.gapTimer !== null;
      this.clearGap();
      if (wasInGap && this.wantPlaying) {
        this.commandAt = Date.now();
        this.playlist?.play();
      }
    }
  }

  private onStatus(s: AudioPlaylistStatus) {
    if (s.currentIndex === this.last.index) {
      this.last.time = s.currentTime;
      if (s.duration > 0) this.last.duration = s.duration;
      if (!this.gapTimer && s.currentIndex === this.state.index) {
        const pos = (this.offsets[s.currentIndex] ?? 0) + Math.min(s.currentTime, this.segments[s.currentIndex]?.duration ?? 0);
        if (Math.abs(pos - this.state.position) >= 0.25) this.set({ position: pos });
      }
    }
    if (s.didJustFinish) {
      this.onMovieFinished();
      return;
    }
    if (this.gapTimer) {
      // User pressed play on the car during a gap: resume right away.
      if (s.playing) this.clearGap();
      return;
    }
    if (Date.now() - this.commandAt < 800) return;
    if (s.playing !== this.state.playing) {
      // Play/pause from lock screen, headset or car.
      this.wantPlaying = s.playing;
      this.set({ playing: s.playing });
    }
  }

  private onMovieFinished() {
    const movie = this.state.movie;
    if (movie) setProgress(movie.id, 0);
    if (loadSettings().loopMode === 'list') {
      void this.advanceMovie();
      return;
    }
    this.wantPlaying = false;
    this.set({ playing: false, finished: true, position: this.state.duration });
  }

  private async advanceMovie() {
    const current = this.state.movie?.id;
    const all = listLocalMovies();
    if (!all.length) return;
    const i = all.findIndex((m) => m.id === current);
    const nextMovie = all[(i + 1) % all.length];
    await this.load(nextMovie.id, { autoplay: true, startIndex: 0 });
  }
}

export const player = new PlayerEngine();
