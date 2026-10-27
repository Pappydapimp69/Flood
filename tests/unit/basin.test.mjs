import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, lakeGain, TUNE } from '../../src/shared/river.js';

const t1 = generateIsland(1);

function intoBasin(w) {
  const lake = w.basins[0];
  const n = t1.size, k = w.lakeOf.indexOf(lake);
  return { lake, at: { x: ((k % n) / (n - 1) - 0.5) * t1.worldSize, z: (Math.floor(k / n) / (n - 1) - 0.5) * t1.worldSize } };
}

test('a few dry basins, the same on every run, none on a spawn', () => {
  const a = createWorld(t1), b = createWorld(t1);
  assert.deepEqual(a.basins, b.basins);
  assert.ok(a.basins.length >= 1 && a.basins.length <= TUNE.basins);
  for (const l of a.basins) {
    assert.equal(a.lakeDry[l], 1);
    assert.equal(a.lakeLeft[l], 0, 'a dry basin has nothing to tap');
    assert.ok(a.lakeOutlet[l] >= 0 && a.lakeOf[a.lakeOutlet[l]] !== l, 'outlet is outside the basin');
  }
});

test('running into a dry basin: stop, pay water, fill, spill at the outlet', () => {
  const w = createWorld(t1);
  const { lake, at } = intoBasin(w);
  const r = addRiver(w, 'a', at);
  step(w, new Map());
  assert.ok(r.filling, 'did not start filling');
  const v0 = r.volume, x0 = r.x, z0 = r.z;
  step(w, new Map());
  assert.equal(r.x, x0, 'head moved while filling');
  assert.equal(r.z, z0);
  assert.ok(r.volume < v0, 'filling cost nothing');
  let k = 0;
  while (r.filling && k++ < TUNE.fillMaxTicks + 5) step(w, new Map());
  assert.equal(r.filling, null, 'never spilled');
  assert.ok(k <= TUNE.fillMaxTicks + 1, 'filling ran past its guaranteed exit');
  assert.equal(w.lakeDry[lake], 0);
  assert.ok(w.lakeLeft[lake] > 0, 'no reservoir left');
  assert.ok(Math.abs(w.lakeLeft[lake] - w.basinFill[lake] * TUNE.reservoirKeep) < 1);
  assert.ok(w.basinFill[lake] <= lakeGain(w.lakes[lake]) + 1);
  assert.notEqual(w.lakeOf[headCell(w, r)], lake, 'head is still inside the basin');
});

test('filling never pushes a river below its safety margin over the floor', () => {
  const w = createWorld(t1);
  const { at } = intoBasin(w);
  const r = addRiver(w, 'a', at);
  r.volume = TUNE.floor * TUNE.startVolume * 1.3;
  for (let k = 0; k < TUNE.fillMaxTicks + 5; k++) step(w, new Map());
  assert.ok(!r.out, 'filling drained the river out');
  assert.ok(r.volume >= TUNE.floor * TUNE.startVolume * TUNE.basinFloorMargin - 1);
});

test('the reservoir a filler leaves can be tapped by someone else', () => {
  const w = createWorld(t1);
  const { lake, at } = intoBasin(w);
  addRiver(w, 'a', at);
  while (!w.events.some((e) => e.type === 'spill')) step(w, new Map());
  const b = addRiver(w, 'b', at);
  step(w, new Map());
  assert.equal(w.lakeTaken[lake], b.idx);
  assert.ok(b.inflow > 0);
});

function headCell(w, r) {
  const n = w.terrain.size;
  const x = Math.round((r.x / w.terrain.worldSize + 0.5) * (n - 1)), y = Math.round((r.z / w.terrain.worldSize + 0.5) * (n - 1));
  return y * n + x;
}
