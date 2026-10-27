import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, riverFingerprint, TICK_HZ } from '../../src/shared/river.js';

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

// The game's promise: whatever the player does, the water reaches the sea.
test('every seed and steering policy reaches the sea', () => {
  for (const seed of SEEDS) {
    for (const p of Object.keys(policies)) {
      const { r } = run(seed, p);
      assert.ok(r.finished, `seed ${seed} policy ${p} never reached the sea (travelled ${r.travelled | 0} m)`);
      // Holding one direction forever circles, which is what the stall guard is
      // for; normal play should rarely need it.
      const cap = p === 'left' || p === 'right' ? 0.4 : 0.2;
      assert.ok(r.guidedTicks / r.finishTick < cap, `seed ${seed} ${p}: guided ${r.guidedTicks}/${r.finishTick} ticks`);
    }
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
  const { w } = run(2, 'wiggle');
  const t = w.terrain;
  let dug = 0;
  for (let i = 0; i < w.carve.length; i++) {
    assert.ok(w.carve[i] >= 0 && w.carve[i] <= 21, `carve ${w.carve[i]} at ${i}`);
    if (w.carve[i] > 0) { dug++; assert.ok(t.filled[i] > 0, 'dug the sea'); }
  }
  assert.ok(dug > 100, `only ${dug} cells dug`);
});
