import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, riverFingerprint, surfaceAt, TICK_HZ, TUNE } from '../../src/shared/river.js';

const SEEDS = [1, 2, 3, 42, 1337];
const islands = new Map(SEEDS.map((s) => [s, generateIsland(s)]));
const LIMIT = TICK_HZ * 900;

const policies = {
  none: () => 0,
  left: () => -1,
  right: () => 1,
  wiggle: (t) => ((t >> 5) & 1 ? 1 : -1),
};

function run(seed, policy, id = 'p1') {
  const w = createWorld(islands.get(seed));
  const r = addRiver(w, id);
  for (let t = 0; t < LIMIT && !r.finished; t++) step(w, new Map([[id, policies[policy](t)]]));
  return { w, r };
}

// No auto-steering: without input the heading never turns, whatever the ground does.
test('the game never steers: no input, no change of heading', () => {
  for (const seed of SEEDS) {
    const w = createWorld(islands.get(seed));
    const r = addRiver(w, 'p1');
    const dx = r.dx, dz = r.dz;
    for (let t = 0; t < TICK_HZ * 60 && !r.finished; t++) step(w, new Map());
    assert.equal(r.dx, dx, `seed ${seed}: heading x changed`);
    assert.equal(r.dz, dz, `seed ${seed}: heading z changed`);
  }
});

test('water never climbs: the head stays within the climb and pond allowance of its lowest point', () => {
  const w = createWorld(islands.get(2));
  const r = addRiver(w, 'p1');
  let lowest = Infinity;
  for (let t = 0; t < TICK_HZ * 120 && !r.finished; t++) {
    step(w, new Map([['p1', (t >> 6) & 1 ? 1 : -1]]));
    const h = surfaceAt(w, r.x, r.z, r.idx);
    lowest = Math.min(lowest, h);
    assert.ok(h <= lowest + TUNE.climb + TUNE.pondMax + 0.5, `climbed to ${h - lowest} m above its lowest point`);
  }
});

test('same inputs give the same run', () => {
  assert.equal(riverFingerprint(run(42, 'wiggle').w), riverFingerprint(run(42, 'wiggle').w));
});

test('steering changes where the river goes', () => {
  const ends = new Set(['left', 'right', 'none'].map((p) => {
    const { r } = run(42, p);
    return `${Math.round(r.x / 500)},${Math.round(r.z / 500)}`;
  }));
  assert.ok(ends.size >= 2, `all policies ended at ${[...ends]}`);
});

test('digging stays bounded and only on land', () => {
  const { w, r } = run(2, 'wiggle');
  const t = w.terrain;
  const cap = TUNE.depth * 3 * r.size * 1.42; // max cutting depth: final size at top speed
  let dug = 0;
  for (let i = 0; i < w.carve.length; i++) {
    assert.ok(w.carve[i] >= 0 && w.carve[i] <= cap, `carve ${w.carve[i]} at ${i} (cap ${cap})`);
    if (w.carve[i] > 0) { dug++; assert.ok(t.filled[i] > 0, 'dug the sea'); }
  }
  assert.ok(dug > 100, `only ${dug} cells dug`);
});
