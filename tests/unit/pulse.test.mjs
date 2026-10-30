import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, pulseEvery, cellIndex, TUNE } from '../../src/shared/river.js';

const t5 = generateIsland(5);

test('pulses leave the source every 1, 2 or 3 s as the river grows', () => {
  assert.equal(pulseEvery({ volume: TUNE.startVolume }), 20);
  assert.equal(pulseEvery({ volume: 4_000_000 }), 40);
  assert.equal(pulseEvery({ volume: 9_000_000 }), 60);
  const w = createWorld(t5);
  const r = addRiver(w, 'a');
  const released = [];
  for (let k = 0; k < 100; k++) {
    step(w, new Map());
    for (const e of w.events.splice(0)) if (e.type === 'pulse' && e.river === r.idx) released.push(e.tick);
  }
  assert.deepEqual(released.slice(0, 4), [0, 20, 40, 60]);
});

test('a river grows only when a pulse reaches its head, by the water it gathered', () => {
  const w = createWorld(t5);
  const r = addRiver(w, 'a');
  let grew = 0, swelled = 0;
  for (let k = 0; k < 400; k++) {
    const v = r.volume;
    step(w, new Map());
    const sw = w.events.filter((e) => e.type === 'swell' && e.river === r.idx);
    w.events.length = 0;
    if (r.volume > v) {
      grew++;
      assert.ok(sw.length > 0, `grew ${r.volume - v} L at tick ${w.tick} with no pulse arriving`);
    }
    swelled += sw.length;
  }
  assert.ok(grew > 5 && swelled > 5, `grew on ${grew} ticks, ${swelled} pulses arrived`);
});

test('pulses run faster than the head and erode the channel they pass', () => {
  const w = createWorld(t5);
  const r = addRiver(w, 'a');
  for (let k = 0; k < 200; k++) step(w, new Map());
  const p = r.path[3], c = cellIndex(w.terrain, p.x, p.z);
  const d0 = w.carve[c];
  // Every pulse released catches the head: none is still running long after.
  for (let k = 0; k < 400 && !r.finished; k++) step(w, new Map());
  assert.ok(w.carve[c] > d0, `a stretch near the source did not erode (${d0} -> ${w.carve[c]})`);
  const head = r.path[r.path.length - 1].s;
  for (const q of r.pulses) assert.ok(head - q.s < TUNE.pulseSpeed * r.speed * 400 * (1 / 20) + 1e4, 'a pulse fell hopelessly behind');
});

test('a low lake on the channel soaks up a pulse until it is back up to the outlet', async () => {
  const { lakeLevel } = await import('../../src/shared/river.js');
  const w = createWorld(t5);
  const r = addRiver(w, 'a');
  for (let k = 0; k < 30; k++) step(w, new Map());
  // A lake the channel runs through, drained well below this river's outlet.
  const at = r.path[Math.floor(r.path.length / 2)], lakeCell = cellIndex(w.terrain, at.x, at.z);
  const lake = w.lakes.reduce((a, b) => (b.cells > a.cells ? b : a));
  w.lakeOf[lakeCell] = lake.id; // the channel crosses it here
  r.via.set(lake.id, { cell: lakeCell, e: 0, w: TUNE.width, born: 0, at: 0 });
  w.lakeVol[lake.id] = 0;
  r.feeds.set(0, 500_000);
  r.pulseAt = w.tick;
  let soaked = 0;
  for (let k = 0; k < 200 && !soaked; k++) {
    step(w, new Map());
    soaked = w.events.filter((e) => e.type === 'soak' && e.river === r.idx).reduce((a, e) => a + e.amount, 0);
    w.events.length = 0;
  }
  assert.ok(soaked > 0, 'the low lake took nothing from the pulse');
  step(w, new Map()); // what it took lands in the lake
  assert.ok(lakeLevel(w, lake.id) > w.lakeBed[lake.id], 'the lake did not rise');
});

test('a rival cut into your channel takes a share of every pulse that passes it', () => {
  const w = createWorld(t5);
  const a = addRiver(w, 'a'), b = addRiver(w, 'b', { x: a.x + 3000, z: a.z });
  for (let k = 0; k < 60; k++) step(w, new Map());
  const mid = a.path[Math.floor(a.path.length / 2)];
  w.junctions.set(`${a.id}|${b.id}`, { from: a, to: b, until: w.tick + 1000, share: 0.6, s: mid.s, at: 0 });
  a.feeds.set(0, 1_000_000);
  a.pulseAt = w.tick;
  let taken = 0, b0 = 0;
  for (let k = 0; k < 200 && !taken; k++) {
    step(w, new Map());
    taken = w.events.filter((e) => e.type === 'siphon' && e.how === 'junction' && e.from === a.idx).reduce((s, e) => s + e.amount, 0);
    w.events.length = 0;
  }
  assert.ok(taken >= 600_000 * 0.99, `the cut took ${taken} of a 1,000,000 L pulse at a 60% share`);
  // It waits at the cutter's channel for (or already rides) its next pulse.
  b0 = (b.feeds.get(0) ?? 0) + b.pulses.reduce((m, p) => Math.max(m, p.amount), 0);
  assert.ok(b0 >= taken * 0.99, 'the water taken did not reach the cutter');
});
