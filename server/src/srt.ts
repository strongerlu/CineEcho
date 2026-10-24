export interface Cue {
  start: number;
  end: number;
  text: string;
}

const TIME_RE =
  /(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

function toSeconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

export function cleanText(raw: string): string {
  return raw
    .replace(/\{[^}]*\}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSrt(input: string): Cue[] {
  const content = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues: Cue[] = [];
  for (const block of content.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const timeIdx = lines.findIndex((l) => TIME_RE.test(l));
    if (timeIdx < 0) continue;
    const m = TIME_RE.exec(lines[timeIdx])!;
    const start = toSeconds(m[1], m[2], m[3], m[4]);
    const end = toSeconds(m[5], m[6], m[7], m[8]);
    if (!(end > start)) continue;
    const text = cleanText(lines.slice(timeIdx + 1).join(' '));
    cues.push({ start, end, text });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/** Merge overlapping cues so the same audio is never played twice. Adjacent (non-overlapping) cues stay separate. */
export function mergeOverlaps(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    const last = out[out.length - 1];
    if (last && c.start < last.end) {
      last.end = Math.max(last.end, c.end);
      if (c.text) last.text = last.text ? `${last.text} ${c.text}` : c.text;
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

/** Clamp cues to the audio length, dropping cues that start after it ends. */
export function clampToDuration(cues: Cue[], duration: number): Cue[] {
  return cues
    .filter((c) => c.start < duration)
    .map((c) => ({ ...c, end: Math.min(c.end, duration) }))
    .filter((c) => c.end - c.start >= 0.05);
}
