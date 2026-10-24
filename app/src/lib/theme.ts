export const colors = {
  bg: '#0d0d10',
  card: '#1a1a20',
  border: '#2a2a33',
  text: '#f2f2f5',
  muted: '#8c8c99',
  accent: '#f5b301',
  danger: '#ff5c5c',
  ok: '#3ecf6e',
};

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}小时${m}分` : `${m}分${s % 60}秒`;
}

export function formatSize(bytes: number): string {
  return bytes > 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

/** 83 -> "1:23", 3723 -> "1:02:03" */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
