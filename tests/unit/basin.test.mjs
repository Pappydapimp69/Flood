import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, dropZone, dischargeOf, TUNE } from '../../src/shared/river.js';

const t1 = generateIsland(1);
const cellPos = (w, k) => {
  const n = w.terrain.size;
  return { x: ((k % n) / (n - 1) - 0.5) * w.terrain.worldSize, z: (Math.floor(k / n) / (n - 1) - 0.5) * w.terrain.worldSize };
};
const inBasin = (w) => cellPos(w, w.lakeOf.indexOf(w.basins[0]));

test('a few dry basins, the same on every run, off the start contour', () => {
  const a = createWorld(t1), b = createWorld(t1);
  assert.deepEqual(a.basins, b.basins);
  assert.ok(a.basins.length >= 1 && a.basins.length <= TUNE.basins);
  const zone = dropZone(a);
  for (const l of a.basins) {
    assert.equal(a.lakeVol[l], 0);
    for (let k = 0; k < a.lakeOf.length; k++) if (a.lakeOf[k] === l) assert.ok(!zone.has(k));
  }
});

test('a dry basin: the head pools and the basin rises by the river\'s discharge', () => {
  const w = createWorld(t1);
  const lake = w.basins[0];
  const r = addRiver(w, 'a', inBasin(w));
  step(w, new Map());
  assert.equal(r.pooled, lake);
  const x = r.x, z = r.z, v0 = w.lakeVol[lake];
  step(w, new Map());
  assert.equal(r.x, x, 'head moved while pooled');
  assert.equal(r.z, z);
  assert.ok(Math.abs(w.lakeVol[lake] - v0 - dischargeOf(r)) < 1, 'rise is not the discharge');
});

test('two rivers fill a basin about twice as fast, then both flow on', () => {
  const run = (n) => {
    const w = createWorld(t1);
    const at = inBasin(w);
    const rs = Array.from({ length: n }, (_, i) => addRiver(w, `r${i}`, at));
    for (let k = 0; k < 40; k++) step(w, new Map());
    const filled = w.lakeVol[w.basins[0]];
    for (let k = 0; k < TUNE.maxPoolTicks + 5 && rs.some((r) => r.pooled >= 0); k++) step(w, new Map());
    assert.ok(rs.every((r) => r.pooled < 0), 'still pooled');
    assert.ok(w.lakeVol[w.basins[0]] >= w.lakeCap[w.basins[0]] * TUNE.fullAt);
    assert.equal(w.events.filter((e) => e.type === 'spill').length, n);
    return filled;
  };
  const one = run(1), two = run(2);
  assert.ok(two > one * 1.7, `in 2 s one river put in ${one | 0} L, two ${two | 0} L`);
});

test('pooling has a guaranteed exit', () => {
  const w = createWorld(t1);
  const r = addRiver(w, 'a', inBasin(w));
  r.volume = 1; r.size = 0.04; // a trickle that could never fill it
  for (let k = 0; k <= TUNE.maxPoolTicks + 2; k++) step(w, new Map());
  assert.equal(r.pooled, -1);
});
