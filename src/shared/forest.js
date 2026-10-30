// Forest: tall pine stands down the slope, part of the game, not decoration.
// A small river can't push through trees: to it a stand is ground treeHeight
// higher, so its water runs round the groves (or fills up behind one and
// spills over). A river big enough knocks them flat wherever its water goes.
// Seeded and integer-hashed, so every machine plants the same forest.

import { hash2 } from './rng.js';
import { MinHeap, SEA_LEVEL } from './terrain.js';

export const FOREST = {
  treeLine: 2100, // no trees above this (the summits and their start rings stay bare)
  low: 40, // nor this close to the sea
  maxSlope: 0.5, // nor on cliffs
  density: 0.56, // forest noise above this grows a stand...
  fill: 2.2, // ...this thickly
  upper: 1.4, // stands are denser this much on the upper slope, thinning toward the sea
  startClear: 6, // cells kept clear round every start
  detour: 1.15, // a start whose way to the sea round the trees is this much longer gets a lane cut
};

// Forest density from smooth noise: dense stands and open glades.
function forestAt(seed, x, y) {
  const smooth = (s, o) => {
    const gx = x / s, gy = y / s, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const v = (a, b) => hash2(ix + a, iy + b, seed + o);
    const u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
    return (v(0, 0) * (1 - u) + v(1, 0) * u) * (1 - w) + (v(0, 1) * (1 - u) + v(1, 1) * u) * w;
  };
  return smooth(14, 31) * 0.65 + smooth(5, 37) * 0.35;
}

// Plant the forest for a world: world.trees[k] = 1 where a stand grows.
// ring: start contour cells, kept clear; starts: the fair start cells, each of
// which must still reach the sea round the trees (judged against world.reach).
export function plantForest(world, ring, starts, climb) {
  const t = world.terrain, n = t.size, h = t.height, trees = new Uint8Array(n * n);
  const clear = new Uint8Array(n * n);
  for (const s of ring) {
    const sx = s % n, sy = (s - sx) / n, rc = FOREST.startClear;
    for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
      const x = sx + dx, y = sy + dy;
      if (x >= 0 && y >= 0 && x < n && y < n) clear[y * n + x] = 1;
    }
  }
  for (let y = 2; y < n - 2; y++) for (let x = 2; x < n - 2; x++) {
    const k = y * n + x, hk = h[k];
    if (hk < FOREST.low || hk > FOREST.treeLine || clear[k] || world.lakeOf[k] >= 0 || world.lava[k] || t.filled[k] - hk > 0.3) continue;
    const slope = Math.sqrt((h[k + 1] - h[k - 1]) ** 2 + (h[k + n] - h[k - n]) ** 2) / (2 * t.cell);
    if (slope > FOREST.maxSlope) continue;
    const up = 1 + (FOREST.upper - 1) * Math.min(1, hk / FOREST.treeLine);
    const fade = hk > FOREST.treeLine - 400 ? (FOREST.treeLine - hk) / 400 : 1;
    const dens = forestAt(t.seed, x, y) * up * fade;
    if (dens > FOREST.density && hash2(x, y, t.seed + 13) < (dens - FOREST.density + 0.06) * FOREST.fill) trees[k] = 1;
  }
  // The density alone can't promise a way through, so check it: every start
  // must reach the sea round the trees, not much further than over open
  // ground. Where one can't, cut a lane down its shortest route and check again.
  let round;
  for (let pass = 0; pass < 6; pass++) {
    round = reachRound(t, trees, climb);
    const stuck = starts.filter((s) => !(round[s] <= world.reach[s] * FOREST.detour));
    if (!stuck.length) break;
    for (const s of stuck) lane(world, trees, s, climb);
    round = reachRound(t, trees, climb);
  }
  // round: each cell's shortest way to the sea round the trees, the way out
  // a small river follows when it's blocked.
  return { trees, round: Float32Array.from(round, (d) => (Number.isFinite(d) ? d : -1)) };
}

// Shortest water route to the sea from every cell, never through a stand.
function reachRound(t, trees, climb) {
  const n = t.size, f = t.filled, dist = new Float64Array(n * n).fill(Infinity), heap = new MinHeap(n * 4);
  for (let i = 0; i < n * n; i++) if (f[i] <= SEA_LEVEL) { dist[i] = 0; heap.push(0, i); }
  while (heap.size) {
    const a = heap.pop(), da = dist[a], ax = a % n, ay = (a - ax) / n;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = ax + dx, y = ay + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const b = y * n + x;
      if (trees[b] || f[b] <= SEA_LEVEL || f[a] > f[b] + climb) continue;
      const d = da + t.cell * (dx && dy ? 1.4142135623730951 : 1);
      if (d < dist[b]) { dist[b] = d; heap.push(d, b); }
    }
  }
  return dist;
}

// Clear a lane three cells wide from cell s to the sea along the shortest
// water route (down world.reach, the route the detour is judged against).
function lane(world, trees, s, climb) {
  const t = world.terrain, n = t.size, reach = world.reach;
  for (let k = s, i = 0; k >= 0 && reach[k] > 0 && i < n * 4; i++) {
    const kx = k % n, ky = (k - kx) / n;
    let next = -1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = kx + dx, y = ky + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const j = y * n + x;
      trees[j] = 0;
      // (A reach of 0 off the sea is a cell water can't get out of, not the sea.)
      const r = t.filled[j] <= SEA_LEVEL ? 0 : reach[j] > 0 ? reach[j] : Infinity;
      if ((dx || dy) && t.filled[j] <= t.filled[k] + climb && r < reach[k] && (next < 0 || r < (t.filled[next] <= SEA_LEVEL ? 0 : reach[next]))) next = j;
    }
    k = next;
  }
}
