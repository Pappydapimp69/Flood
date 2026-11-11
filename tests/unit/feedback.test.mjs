import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, QUESTIONS } from '../../src/client/feedback.js';

const log = {
  races: [
    { seed: 4242, kind: 'tutorial', of: 4, result: 'sea', place: 1, secs: 151, volume: 1.4e6, lakes: 2, fps: { avg: 58, low: 41 } },
    { seed: 77, kind: 'race', of: 12, result: 'drained', place: 9, secs: 95, volume: 3.9e5, lakes: 0, by: 'riverboi' },
    { seed: 78, kind: 'race', of: 12, result: 'restarted' },
    { seed: 79, kind: 'race', of: 12, result: 'playing' },
  ],
  totals: { races: 3, wins: 0, tutorials: 1 },
  errors: [{ at: '12:00:01', msg: 'boom (main.js:10)' }],
};

test('report carries answers, every question, measured races, device and errors', () => {
  const r = buildReport({ build: 'abc1234', when: '2026-11-11 10:00', device: 'iOS · Safari', log, answers: { name: 'Sam', fun: '4', bugs: 'camera clipped' } });
  assert.match(r, /build abc1234/);
  assert.match(r, /From: Sam/);
  assert.match(r, /How fun was it\?\n  4/);
  assert.match(r, /camera clipped/);
  for (const q of QUESTIONS) assert.ok(r.includes(q.label), q.id);
  assert.match(r, /Did you know what to do\?\n  \(skipped\)/);
  assert.match(r, /tutorial · island 4242 · reached the sea 1st of 4 · 2:31 · 1\.40M L water · 2 lakes · 58 fps avg, 41 low/);
  assert.match(r, /drained by riverboi \(9th of 12\)/);
  assert.match(r, /restarted before the end/);
  assert.match(r, /left before the end/);
  assert.match(r, /3 races, 0 wins, 1 tutorial$/m);
  assert.match(r, /iOS · Safari/);
  assert.match(r, /boom \(main\.js:10\)/);
});

test('an empty log still makes a readable report', () => {
  const r = buildReport({ build: 'dev', when: 'now', device: 'x', log: null, answers: null });
  assert.match(r, /none yet/);
  assert.doesNotMatch(r, /Errors/);
});
