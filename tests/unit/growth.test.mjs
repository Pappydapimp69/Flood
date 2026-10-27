import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland, findLakes, LAKE_MIN_DEPTH } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, spawnBand, spawnPoint, sizeOf, cellIndex, TUNE, TICK_HZ } from '../../src/shared/river.js';
import { createBot, botSteer } from '../../src/shared/bot.js';

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

// The biggest lake of seed 42 that starts full, a cell inside it and its spill point.
function bigLake(w) {
  const lake = w.lakes.filter((l) => w.lakeVol[l.id] > 0).reduce((a, b) => (b.cells > a.cells ? b : a));
  const n = t42.size;
  const pos = (c) => ({ x: ((c % n) / (n - 1) - 0.5) * t42.worldSize, z: (Math.floor(c / n) / (n - 1) - 0.5) * t42.worldSize });
  return { lake, inside: pos(w.lakeOf.indexOf(lake.id)), outCell: w.lakeOutlet[lake.id], pos };
}

test('entering a full lake adds to it and does not drain it', () => {
  const w = createWorld(t42);
  const { lake, inside } = bigLake(w);
  const r = addRiver(w, 'a', inside);
  for (let k = 0; k < 20; k++) step(w, new Map());
  assert.equal(r.pooled, -1, 'pooled in a full lake');
  assert.ok(w.lakeVol[lake.id] >= w.lakeCap[lake.id] * TUNE.fullAt, 'a head in the lake drained it');
  assert.ok(w.lakeIn[lake.id] > 0, 'no inflow from the river in it');
});

test('leaving a lake: mass jumps at once, an outlet opens, water keeps coming and erodes it', () => {
  const w = createWorld(t42);
  const { lake, inside, outCell, pos } = bigLake(w);
  const r = addRiver(w, 'a', inside);
  step(w, new Map());
  const v0 = r.volume, lv = w.lakeVol[lake.id];
  Object.assign(r, pos(outCell)); // put the head out through the spill point
  step(w, new Map());
  const join = w.events.find((e) => e.type === 'join' && e.lake === lake.id);
  assert.ok(join, 'no join event');
  assert.ok(Math.abs(join.gain - lv * TUNE.joinShare) < 1);
  assert.ok(r.volume > v0 + join.gain * 0.99, 'mass did not jump on joining');
  const o = r.via.get(lake.id);
  assert.ok(o, 'no outlet');
  const e0 = o.e;
  for (let k = 0; k < 40; k++) step(w, new Map());
  assert.ok(r.inflow > 0, 'no water flowing out to the river');
  assert.ok(o.e > e0, 'the outlet did not erode');
});

test('a lake only falls when more flows out than in, and not below its outlet floor', () => {
  const w = createWorld(t42);
  const { lake, inside, outCell, pos } = bigLake(w);
  const r = addRiver(w, 'a', inside);
  step(w, new Map());
  Object.assign(r, pos(outCell));
  for (let k = 0; k < 6; k++) step(w, new Map());
  assert.ok(w.lakeVol[lake.id] >= w.lakeCap[lake.id] * 0.9, 'drained with a fresh outlet');
  // Cut the outlet deep and make the river heavy: outflow beats inflow and the level drops.
  r.via.get(lake.id).e = TUNE.outletMax;
  r.volume = TUNE.startVolume * 16; r.size = 2;
  for (let k = 0; k < 400; k++) step(w, new Map());
  assert.ok(w.lakeVol[lake.id] < w.lakeCap[lake.id] * 0.9, 'a deep outlet did not drain it');
  assert.ok(w.lakeVol[lake.id] >= w.lakeCap[lake.id] * TUNE.lakeFloor - 1, 'drained below the outlet floor');
});

test('every start is at the same elevation', () => {
  for (const seed of [1, 2, 3, 42, 1337]) {
    const w = createWorld(generateIsland(seed));
    const band = spawnBand(w);
    let peak = 0;
    for (const h of w.terrain.height) peak = Math.max(peak, h);
    for (let i = 0; i < 12; i++) {
      const p = spawnPoint(w, `p${i}`);
      const h = w.terrain.height[cellIndex(w.terrain, p.x, p.z)];
      assert.ok(Math.abs(h - band.target) <= peak * 0.06, `seed ${seed} p${i} at ${h}, target ${band.target}`);
    }
  }
});

test('in a bot race several rivers reach the sea, and the winner grew on the way', () => {
  for (const seed of [1, 2]) {
    const w = createWorld(generateIsland(seed));
    for (let i = 0; i < 12; i++) addRiver(w, `b${String(i).padStart(2, '0')}`);
    const bots = w.rivers.map((r) => createBot(w, r));
    for (let k = 0; k < TICK_HZ * 600 && w.rivers.filter((r) => r.finished).length < 3; k++) {
      step(w, new Map(bots.map((b) => [b.river.id, botSteer(w, b)])));
    }
    const fin = w.rivers.filter((r) => r.finished).sort((a, b) => a.finishTick - b.finishTick);
    assert.ok(fin.length >= 3, `seed ${seed}: only ${fin.length} reached the sea`);
    assert.ok(fin[0].volume > TUNE.startVolume * 1.1, `seed ${seed}: winner volume ${fin[0].volume}`);
  }
});
