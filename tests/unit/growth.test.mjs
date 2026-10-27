import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland, findLakes, LAKE_MIN_DEPTH } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, spawnBand, spawnPoint, sizeOf, lakeGain, cellIndex, TUNE, TICK_HZ } from '../../src/shared/river.js';

const t42 = generateIsland(42);

test('lakes label exactly the deep filled cells', () => {
  const { label, lakes } = findLakes(t42);
  assert.ok(lakes.length > 10);
  for (let i = 0; i < label.length; i++) {
    assert.equal(label[i] >= 0, t42.filled[i] - t42.height[i] > LAKE_MIN_DEPTH, `cell ${i}`);
  }
  const counts = new Array(lakes.length).fill(0);
  for (const l of label) if (l >= 0) counts[l]++;
  lakes.forEach((l, i) => assert.equal(counts[i], l.cells));
});

test('size is the fourth root of relative volume', () => {
  assert.equal(sizeOf(TUNE.startVolume), 1);
  assert.ok(Math.abs(sizeOf(TUNE.startVolume * 16) - 2) < 1e-12);
});

test('a lake is swallowed once, by the first river to reach it', () => {
  const w = createWorld(t42);
  const lake = w.lakes.reduce((a, b) => (b.cells > a.cells ? b : a));
  const n = t42.size;
  const at = { x: (lake.gx / (n - 1) - 0.5) * t42.worldSize, z: (lake.gy / (n - 1) - 0.5) * t42.worldSize };
  // Centroid may sit outside an odd-shaped lake; find a real cell of it instead.
  let k = cellIndex(t42, at.x, at.z);
  if (w.lakeOf[k] !== lake.id) k = w.lakeOf.indexOf(lake.id);
  const p = { x: ((k % n) / (n - 1) - 0.5) * t42.worldSize, z: (Math.floor(k / n) / (n - 1) - 0.5) * t42.worldSize };
  const a = addRiver(w, 'a', p), b = addRiver(w, 'b', p);
  step(w, new Map());
  assert.equal(w.lakeTaken[lake.id], a.idx);
  assert.ok(a.volume >= TUNE.startVolume + lakeGain(lake));
  assert.ok(b.volume < TUNE.startVolume + lakeGain(lake), 'second river also got the lake');
  assert.equal(w.events.filter((e) => e.lake === lake.id).length, 1);
});

test('spawns are fair: every spawn sits in one narrow distance-to-sea band', () => {
  for (const seed of [1, 2, 3, 42, 1337]) {
    const w = createWorld(generateIsland(seed));
    const band = spawnBand(w);
    assert.ok(band.hi / band.lo < 1.25, `seed ${seed} band ${band.lo | 0}-${band.hi | 0}`);
    for (let i = 0; i < 20; i++) {
      const p = spawnPoint(w, `p${i}`);
      const d = w.dist[cellIndex(w.terrain, p.x, p.z)];
      assert.ok(d >= band.lo - 1 && d <= band.hi + 1, `seed ${seed} p${i} at ${d}`);
    }
  }
});

test('a run gathers water and finishes bigger than it started', () => {
  const w = createWorld(t42);
  const r = addRiver(w, 'p1');
  for (let k = 0; k < TICK_HZ * 900 && !r.finished; k++) step(w, new Map([['p1', (k >> 5) & 1 ? 1 : -1]]));
  assert.ok(r.finished);
  assert.ok(r.volume > TUNE.startVolume * 1.5, `volume ${r.volume}`);
  assert.ok(r.path.at(-1).w > r.path[0].w, 'channel did not widen');
});
