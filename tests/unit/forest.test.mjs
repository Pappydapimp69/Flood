import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, spawnBand, surfaceAt, cellIndex, TUNE } from '../../src/shared/river.js';
import { FOREST } from '../../src/shared/forest.js';

const t7 = generateIsland(7);

test('the forest is seeded, moderate, and grows only where it should', () => {
  const a = createWorld(t7), b = createWorld(generateIsland(7));
  assert.deepEqual(a.trees, b.trees, 'two machines planted different forests');
  const t = a.terrain, band = spawnBand(a), ring = new Set(band.ring);
  let land = 0, trees = 0;
  for (let k = 0; k < a.trees.length; k++) {
    if (t.filled[k] > 0) land++;
    if (!a.trees[k]) continue;
    trees++;
    assert.ok(t.height[k] <= FOREST.treeLine, `tree above the tree line at ${k}`);
    assert.ok(a.lakeOf[k] < 0 && !a.lava[k], `tree in water or lava at ${k}`);
    assert.ok(!ring.has(k), `tree on a start at ${k}`);
  }
  assert.ok(trees / land > 0.05 && trees / land < 0.35, `forest covers ${(trees / land).toFixed(3)} of the land`);
});

test('every start reaches the sea round the trees, never much further than over open ground', async () => {
  const { MinHeap, SEA_LEVEL } = await import('../../src/shared/terrain.js');
  for (const seed of [1, 7, 42]) {
    const w = createWorld(generateIsland(seed));
    const t = w.terrain, n = t.size, f = t.filled;
    // Same rule as the sim's descent distance, with every stand impassable.
    const dist = new Float64Array(n * n).fill(Infinity), heap = new MinHeap(n * 4);
    for (let i = 0; i < n * n; i++) if (f[i] <= SEA_LEVEL) { dist[i] = 0; heap.push(0, i); }
    while (heap.size) {
      const c = heap.pop(), cx = c % n, cy = (c - cx) / n;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy, k = y * n + x;
        if ((!dx && !dy) || x < 0 || y < 0 || x >= n || y >= n || w.trees[k] || f[k] <= SEA_LEVEL || f[c] > f[k] + TUNE.climb) continue;
        const d = dist[c] + t.cell * (dx && dy ? Math.SQRT2 : 1);
        if (d < dist[k]) { dist[k] = d; heap.push(d, k); }
      }
    }
    for (const s of spawnBand(w).cells) assert.ok(dist[s] <= w.reach[s] * FOREST.detour + 1, `seed ${seed}: start ${s} is walled in by trees`);
  }
});

// A stand on open, gently sloping ground with clear ground up the slope from it.
function standAhead(w) {
  const t = w.terrain, n = t.size;
  const pos = (k) => ({ x: ((k % n) / (n - 1) - 0.5) * t.worldSize, z: (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize });
  for (let k = n * 40; k < n * (n - 40); k++) {
    if (!w.trees[k] || !w.trees[k + 1] || !w.trees[k + 2]) continue;
    const up = k - 4; // four cells west, aimed east into the stand
    if (w.trees[up] || w.trees[up + 1] || w.lakeOf[up] >= 0 || t.filled[up] - t.filled[k] < 2 || t.filled[up] - t.filled[k] > 30) continue;
    return { from: pos(up), stand: k, pos };
  }
  return null;
}

test('a small river is turned by a stand of trees; a big one knocks it flat', () => {
  const w0 = createWorld(t7);
  const s = standAhead(w0);
  assert.ok(s, 'no stand found to aim at');
  const run = (size) => {
    const w = createWorld(t7);
    const r = addRiver(w, 'a', s.from);
    r.volume = TUNE.startVolume * size ** 3; r.size = size;
    r.dx = 1; r.dz = 0;
    let entered = false;
    for (let k = 0; k < 60; k++) {
      step(w, new Map());
      if (cellIndex(w.terrain, r.x, r.z) === s.stand) entered = true;
    }
    return { entered, felled: !w.trees[s.stand] };
  };
  const small = run(1);
  assert.ok(!small.felled, 'a small river knocked the stand down');
  assert.ok(!small.entered, 'a small river ran straight through the stand');
  const big = run(TUNE.treeBreak + 0.3);
  assert.ok(big.felled, 'a big river left the stand standing');
  // To the small river the stand stands treeHeight taller; to the big one it doesn't.
  const w = createWorld(t7);
  const a = addRiver(w, 'a', s.from), b = addRiver(w, 'b', s.pos(s.stand - 40 * w.terrain.size));
  b.size = TUNE.treeBreak + 0.3;
  const p = s.pos(s.stand);
  assert.ok(Math.abs(surfaceAt(w, p.x, p.z, a.idx) - surfaceAt(w, p.x, p.z, b.idx) - TUNE.treeHeight) < 0.01);
});
