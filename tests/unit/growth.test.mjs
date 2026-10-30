import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland, findLakes, LAKE_MIN_DEPTH } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, spawnBand, spawnPoint, sizeOf, cellIndex, lakeLevel, TUNE, TICK_HZ } from '../../src/shared/river.js';
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

test('size is the cube root of relative volume', () => {
  assert.equal(sizeOf(TUNE.startVolume), 1);
  assert.ok(Math.abs(sizeOf(TUNE.startVolume * 8) - 2) < 1e-12);
});

// The biggest lake of seed 42 that starts full, a cell inside it and its spill point.
function bigLake(w) {
  const lake = w.lakes.filter((l) => w.lakeVol[l.id] > 0).reduce((a, b) => (b.cells > a.cells ? b : a));
  const n = t42.size;
  const pos = (c) => ({ x: ((c % n) / (n - 1) - 0.5) * t42.worldSize, z: (Math.floor(c / n) / (n - 1) - 0.5) * t42.worldSize });
  return { lake, inside: pos(w.lakeOf.indexOf(lake.id)), outCell: w.lakeOutlet[lake.id], pos };
}

test('a head in a lake raises it and keeps its own volume', () => {
  const w = createWorld(t42);
  const { lake, inside } = bigLake(w);
  const r = addRiver(w, 'a', inside);
  step(w, new Map());
  const l0 = w.lakeVol[lake.id];
  let poured = 0;
  for (let k = 0; k < 40 && r.inLake === lake.id; k++) {
    const v = r.volume;
    step(w, new Map());
    poured = Math.max(poured, w.lakeIn[lake.id]);
    if (r.inLake === lake.id) assert.equal(r.volume, v, 'the river grew while its head was in the lake');
  }
  assert.ok(w.lakeVol[lake.id] > l0, 'the lake did not rise');
  assert.ok(poured > 0, 'no inflow from the river in it'); // in pulses, not every tick
});

test('leaving a lake: mass jumps at once, an outlet opens, water keeps coming and erodes it', () => {
  const w = createWorld(t42);
  const { lake, inside, outCell, pos } = bigLake(w);
  const r = addRiver(w, 'a', inside);
  step(w, new Map());
  const level = lakeLevel(w, lake.id);
  Object.assign(r, pos(outCell)); // put the head out through the spill point
  step(w, new Map());
  const join = w.events.find((e) => e.type === 'join' && e.lake === lake.id);
  assert.ok(join, 'no join event');
  const o = r.via.get(lake.id);
  assert.ok(o, 'no outlet');
  // Cut down from the water the head floated on (or the bank, if lower).
  const lip = t42.filled[outCell] - o.e;
  assert.ok(Math.abs(lip - (Math.min(t42.filled[outCell], level) - r.depth)) < r.depth * 0.5, `lip ${lip} vs level ${level}`);
  const e0 = o.e;
  let fed = 0;
  for (let k = 0; k < 40; k++) { step(w, new Map()); fed = Math.max(fed, r.inflow); }
  assert.ok(fed > 0, 'no water flowing out to the river');
  assert.ok(o.e > e0, 'the outlet did not erode');
});

test('water leaves only over a lip below the surface, never over a high bank', async () => {
  const { inside, pos, lake } = bigLake(createWorld(t42));
  // An outlet on a bank above the lake carries nothing, however heavy the river.
  const w2 = createWorld(t42);
  const b = addRiver(w2, 'b', inside);
  step(w2, new Map());
  let bank = -1;
  for (let k = 0; k < w2.lakeOf.length && bank < 0; k++) {
    if (w2.lakeOf[k] >= 0 || t42.filled[k] < w2.lakeBrim[lake.id] + 1 || t42.filled[k] > w2.lakeBrim[lake.id] + 1.4) continue;
    const n = t42.size;
    if ([1, -1, n, -n].some((d) => w2.lakeOf[k + d] === lake.id)) bank = k;
  }
  assert.ok(bank >= 0, 'no high bank found');
  Object.assign(b, pos(bank));
  b.via.set(lake.id, { cell: bank, e: 0.5, w: TUNE.width, born: 0 });
  b.inLake = -1;
  b.volume = TUNE.startVolume * 16; b.size = 2;
  const v0 = w2.lakeVol[lake.id];
  step(w2, new Map());
  assert.equal(w2.lakeOut[lake.id], 0, 'water left over a lip above the lake');
  assert.ok(w2.lakeVol[lake.id] >= v0, 'the lake drained over a high bank');
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

test('the island is rerolled until the summit ring seats every river', async () => {
  const { rollIsland, seats, spawnBand } = await import('../../src/shared/river.js');
  const { world } = rollIsland(4, 12);
  assert.ok(seats(world) >= 12, `only ${seats(world)} seats`);
  // Three summits, each with its own ring of starts on its own slopes, and
  // rivers dealt evenly round them.
  const t = world.terrain, band = spawnBand(world), n = t.size;
  assert.equal(t.summits.length, 3);
  assert.equal(band.groups.length, 3);
  band.groups.forEach((cells, i) => {
    const s = t.summits[i], sx = s % n, sy = (s - sx) / n;
    assert.ok(cells.length > 0, `summit ${i} has no starts`);
    for (const c of cells) {
      assert.ok(t.height[c] > t.height[s] * 0.8, `start cell ${c} far below its summit`);
      assert.ok(Math.hypot((c % n) - sx, Math.floor(c / n) - sy) < 40, `start cell ${c} far from its summit`);
    }
  });
  for (let i = 0; i < 12; i++) addRiver(world, `p${String(i).padStart(2, '0')}`);
  const per = [0, 0, 0];
  for (const r of world.rivers) {
    const k = cellIndex(t, r.x, r.z);
    per[band.groups.findIndex((g) => g.includes(k))]++;
  }
  assert.deepEqual(per, [4, 4, 4]);
});
