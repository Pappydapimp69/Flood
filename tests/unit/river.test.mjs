import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, riverFingerprint, surfaceAt, cellIndex, TICK_HZ, TUNE } from '../../src/shared/river.js';

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

// Erosion is forever: the whole trail keeps deepening, start included.
test('the start of a trail keeps eroding long after the head has left', () => {
  const w = createWorld(islands.get(2));
  const r = addRiver(w, 'p1');
  for (let k = 0; k < 200; k++) step(w, new Map());
  const p = r.path[1], c = cellIndex(w.terrain, p.x, p.z);
  const d0 = w.carve[c];
  for (let k = 0; k < 400 && !r.finished; k++) step(w, new Map());
  assert.ok(w.carve[c] > d0 + 0.5, `start went ${d0} -> ${w.carve[c]}`);
});

test('digging stays on land and never cuts below sea level', () => {
  const { w } = run(2, 'wiggle');
  const t = w.terrain;
  let dug = 0;
  for (let i = 0; i < w.carve.length; i++) {
    if (w.carve[i] <= 0) continue;
    dug++;
    assert.ok(t.filled[i] > 0, 'dug the sea');
    assert.ok(t.height[i] + w.rock[i] - w.carve[i] >= -0.01, `cell ${i} cut below sea level`);
  }
  assert.ok(dug > 100, `only ${dug} cells dug`);
});

// Water runs downhill on its own: a river nobody steers keeps flowing, it
// doesn't sit at a crawl against a rise or rock in a hollow.
test('a river left alone keeps flowing', async () => {
  const { rollIsland } = await import('../../src/shared/river.js');
  let crawl = 0, all = 0;
  for (const seed of [7, 345678]) {
    const { world: w } = rollIsland(seed, 12);
    for (let i = 0; i < 12; i++) addRiver(w, `p${String(i).padStart(2, '0')}`, undefined, { drop: true });
    for (let k = 0; k < TUNE.dropTicks + TICK_HZ * 90; k++) {
      step(w, new Map());
      if (k < TUNE.dropTicks + TICK_HZ * 5) continue;
      for (const r of w.rivers) if (isRacingRiver(r)) { all++; if (r.speed <= TUNE.minSpeed + 1) crawl++; }
    }
    for (const r of w.rivers) if (!r.out) assert.ok(r.travelled > 3000, `${seed} ${r.id} only went ${r.travelled | 0} m in 90 s`);
  }
  assert.ok(crawl / all < 0.12, `crawling ${(100 * crawl / all).toFixed(0)}% of the time`);
});
const isRacingRiver = (r) => !r.finished && !r.out && r.pooled < 0;

test('on a lake the river runs straight across the water and digs nothing', async () => {
  const { rollIsland } = await import('../../src/shared/river.js');
  const { world: w } = rollIsland(42, 12);
  const t = w.terrain, n = t.size;
  // A big full lake, and a cell well inside it.
  const lake = w.lakes.filter((l) => w.lakeVol[l.id] > 0).reduce((a, b) => (b.cells > a.cells ? b : a));
  let best = -1, bestIn = -1;
  for (let k = 0; k < w.lakeOf.length; k++) {
    if (w.lakeOf[k] !== lake.id) continue;
    let inside = 0;
    for (let r = 1; r < 30 && w.lakeOf[k + r] === lake.id && w.lakeOf[k - r] === lake.id; r++) inside = r;
    if (inside > bestIn) { bestIn = inside; best = k; }
  }
  const x0 = ((best % n) / (n - 1) - 0.5) * t.worldSize - bestIn * t.cell * 0.8, z0 = (Math.floor(best / n) / (n - 1) - 0.5) * t.worldSize;
  const r = addRiver(w, 'a', { x: x0, z: z0 });
  r.dx = 1; r.dz = 0; // straight east across the lake
  for (let k = 0; k < 60; k++) step(w, new Map());
  const mx = r.x - x0, mz = r.z - z0, d = Math.hypot(mx, mz);
  assert.ok(d > 80, `barely moved: ${d}`);
  assert.ok(mx / d > 0.98, `wandered off its heading on the lake: (${(mx / d).toFixed(2)}, ${(mz / d).toFixed(2)})`);
  for (let k = 0; k < w.carve.length; k++) if (w.lakeOf[k] === lake.id) assert.equal(w.carve[k], 0, 'dug the lake bed');
});

test('aimed across a slope the water goes where it is aimed, aimed uphill it never climbs', () => {
  const w = createWorld(islands.get(2));
  const r = addRiver(w, 'a');
  for (let k = 0; k < 40; k++) step(w, new Map());
  // Turn the heading across the fall line and follow it for a moment.
  const g = { x: -r.dx, z: -r.dz };
  r.dx = -g.z; r.dz = g.x;
  const x0 = r.x, z0 = r.z, h0 = surfaceAt(w, r.x, r.z, r.idx);
  for (let k = 0; k < 10; k++) step(w, new Map());
  const mx = r.x - x0, mz = r.z - z0, d = Math.hypot(mx, mz) || 1;
  assert.ok((mx * r.dx + mz * r.dz) / d > 0.8, 'did not go where it was aimed');
  assert.ok(surfaceAt(w, r.x, r.z, r.idx) <= h0 + TUNE.climb, 'climbed');
});
