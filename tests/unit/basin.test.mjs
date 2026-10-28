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

test('a dry basin: nobody waits; the head flows on and the basin rises by its discharge', () => {
  const w = createWorld(t1);
  const lake = w.basins[0];
  const r = addRiver(w, 'a', inBasin(w));
  step(w, new Map());
  assert.equal(r.pooled, -1, 'the head was held in the basin');
  assert.equal(r.inLake, lake);
  const x = r.x, z = r.z, v0 = w.lakeVol[lake];
  step(w, new Map());
  assert.ok(Math.hypot(r.x - x, r.z - z) > 0.5, 'head stopped in the basin');
  if (r.inLake === lake) assert.ok(Math.abs(w.lakeVol[lake] - v0 - dischargeOf(r)) < 1, 'rise is not the discharge');
});

test('two rivers in a basin fill it about twice as fast', () => {
  const run = (n) => {
    const w = createWorld(t1);
    const at = inBasin(w);
    const rs = Array.from({ length: n }, (_, i) => addRiver(w, `r${i}`, at));
    step(w, new Map());
    const v0 = w.lakeVol[w.basins[0]];
    for (const r of rs) Object.assign(r, at, { speed: 0 }); // hold them over the basin for one tick
    step(w, new Map());
    return w.lakeVol[w.basins[0]] - v0;
  };
  const one = run(1), two = run(2);
  assert.ok(two > one * 1.7, `in one tick one river put in ${one | 0} L, two ${two | 0} L`);
});

test('momentum carries across level water instead of dropping to a crawl', () => {
  const w = createWorld(t1);
  const lake = w.lakes.filter((l) => w.lakeVol[l.id] > 0).reduce((a, b) => (b.cells > a.cells ? b : a));
  const r = addRiver(w, 'a', cellPos(w, w.lakeOf.indexOf(lake.id)));
  r.speed = 180;
  step(w, new Map());
  for (let k = 0; k < 10 && r.inLake === lake.id; k++) step(w, new Map());
  assert.ok(r.speed > 150, `speed fell to ${r.speed | 0} on the lake`);
});
