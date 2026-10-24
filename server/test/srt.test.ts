import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampToDuration, mergeOverlaps, parseSrt } from '../src/srt.ts';

const SAMPLE = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> there.\r\n\r\n' +
  '2\r\n00:00:02,000 --> 00:00:03,000\r\n{\\an8}General Kenobi!\r\n\r\n' +
  '3\r\n00:00:05,000 --> 00:00:06,000\r\nLine one\r\nline two\r\n\r\n' +
  '4\r\n00:00:07,000 --> 00:00:06,000\r\nbroken\r\n\r\n' +
  '5\r\n00:00:10.5 --> 00:00:12.25\r\n[MUSIC]\r\n';

test('parseSrt handles BOM, CRLF, tags, multi-line and invalid cues', () => {
  const cues = parseSrt(SAMPLE);
  assert.equal(cues.length, 4);
  assert.deepEqual(cues[0], { start: 1, end: 2.5, text: 'Hello there.' });
  assert.equal(cues[1].text, 'General Kenobi!');
  assert.equal(cues[2].text, 'Line one line two');
  assert.deepEqual(cues[3], { start: 10.5, end: 12.25, text: '[MUSIC]' });
});

test('mergeOverlaps merges only overlapping cues', () => {
  const merged = mergeOverlaps(parseSrt(SAMPLE));
  assert.equal(merged.length, 3);
  assert.deepEqual(merged[0], { start: 1, end: 3, text: 'Hello there. General Kenobi!' });
  assert.equal(merged[1].start, 5);
});

test('clampToDuration trims and drops cues beyond audio', () => {
  const out = clampToDuration(mergeOverlaps(parseSrt(SAMPLE)), 11);
  assert.equal(out.length, 3);
  assert.equal(out[2].end, 11);
});
