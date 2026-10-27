import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland, downhill, stats, fingerprint, sampleHeight, SEA_LEVEL } from '../../src/shared/terrain.js';

const SEEDS = [1, 2, 3, 42, 1337];
const islands = new Map(SEEDS.map((s) => [s, generateIsland(s)]));

test('same seed gives the same island; different seeds differ', () => {
  assert.equal(fingerprint(generateIsland(1)), fingerprint(islands.get(1)));
  const prints = new Set(SEEDS.map((s) => fingerprint(islands.get(s))));
  assert.equal(prints.size, SEEDS.length);
});

test('map edge is open sea', () => {
  for (const t of islands.values()) {
    const n = t.size;
    for (let i = 0; i < n; i++) {
      for (const k of [i, (n - 1) * n + i, i * n, i * n + n - 1]) assert.ok(t.filled[k] <= SEA_LEVEL, `edge cell ${k} is land`);
    }
  }
});

test('island is a sensible size and height', () => {
  for (const [seed, t] of islands) {
    const s = stats(t);
    assert.ok(s.landFraction > 0.15 && s.landFraction < 0.45, `seed ${seed} land ${s.landFraction}`);
    assert.ok(s.peak > 1000 && s.peak < t.maxHeight * 1.1, `seed ${seed} peak ${s.peak}`);
    assert.ok(s.lakeCells / (s.landFraction * t.size * t.size) < 0.15, `seed ${seed} is mostly lake`);
  }
});

// The core promise of the map: from anywhere on land, downhill reaches the sea.
test('every land cell drains to the sea by strict descent', () => {
  for (const [seed, t] of islands) {
    const n = t.size;
    const reaches = new Int8Array(n * n); // 0 unknown, 1 reaches sea
    for (let i = 0; i < n * n; i++) {
      if (t.filled[i] <= SEA_LEVEL) reaches[i] = 1;
    }
    for (let start = 0; start < n * n; start++) {
      const path = [];
      let c = start;
      while (!reaches[c]) {
        path.push(c);
        const d = downhill(t, c);
        assert.notEqual(d, -1, `seed ${seed}: cell ${c} is a pit at ${t.filled[c]}`);
        assert.ok(t.filled[d] < t.filled[c], `seed ${seed}: no strict descent at ${c}`);
        assert.ok(path.length < n * n, 'descent loops');
        c = d;
      }
      for (const p of path) reaches[p] = 1;
    }
  }
});

test('sampleHeight matches grid points and the map centre is land', () => {
  const t = islands.get(1);
  const n = t.size;
  const wx = (100 / (n - 1) - 0.5) * t.worldSize, wz = (200 / (n - 1) - 0.5) * t.worldSize;
  assert.ok(Math.abs(sampleHeight(t, wx, wz) - t.height[200 * n + 100]) < 1e-3);
  assert.ok(sampleHeight(t, 0, 0, t.filled) > SEA_LEVEL);
});
