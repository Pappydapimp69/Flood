import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, heatFront, slopeT, riverFingerprint, cellIndex, TUNE } from '../../src/shared/river.js';

const t5 = generateIsland(5);

test('the heat front never touches a river: every 3 s each lake behind it loses a set amount', async () => {
  const { lakeLevel } = await import('../../src/shared/river.js');
  const w = createWorld(t5);
  const r = addRiver(w, 'a');
  assert.equal(heatFront(w), -Infinity);
  // Far enough on that the front has passed some lakes.
  w.tick = TUNE.heatStart + TUNE.heatEvery * 40;
  const t = w.terrain, n = t.size;
  const behind = w.lakes.filter((l) => slopeT(w, (l.gx / (n - 1) - 0.5) * t.worldSize, (l.gy / (n - 1) - 0.5) * t.worldSize) < heatFront(w));
  const ahead = w.lakes.filter((l) => !behind.includes(l));
  assert.ok(behind.length > 0 && ahead.length > 0, `${behind.length} lakes behind, ${ahead.length} ahead`);
  void lakeLevel;
  const before = Float64Array.from(w.lakeVol);
  const v0 = r.volume;
  r.out = { by: 'test', tick: 0 }; // out of the race, so it pours nothing in
  for (let k = 0; k < TUNE.heatEvery; k++) step(w, new Map());
  for (const l of behind) assert.equal(before[l.id] - w.lakeVol[l.id], Math.min(before[l.id], TUNE.heatLake), `lake ${l.id} behind the front`);
  for (const l of ahead) assert.equal(w.lakeVol[l.id], before[l.id], `lake ${l.id} ahead of the front dried`);
  assert.equal(r.volume, v0, 'the heat touched a river');
  assert.ok(!r.out?.how, 'the heat knocked a river out');
});

test('water pouring in still counts against the heat: a fed lake behind the front holds up', () => {
  const w = createWorld(t5);
  w.tick = TUNE.heatStart + TUNE.heatEvery * 40;
  const t = w.terrain, n = t.size;
  const lake = w.lakes.find((l) => slopeT(w, (l.gx / (n - 1) - 0.5) * t.worldSize, (l.gy / (n - 1) - 0.5) * t.worldSize) < heatFront(w));
  w.lakeVol[lake.id] = w.lakeCap[lake.id] * 0.5; // well under its rim, so nothing spills
  const v0 = w.lakeVol[lake.id];
  for (let k = 0; k < TUNE.heatEvery; k++) { w.lakePending[lake.id] += 2000; step(w, new Map()); }
  assert.equal(Math.round(w.lakeVol[lake.id] - v0), TUNE.heatEvery * 2000 - Math.min(v0, TUNE.heatLake));
});

test('storms sweep across the island ahead of the pack and rain into rivers under them', () => {
  const w = createWorld(t5);
  const r = addRiver(w, 'a');
  w.tick = TUNE.stormStart;
  step(w, new Map());
  const s = w.storms[0];
  assert.ok(s, 'no storm at stormStart');
  assert.ok(slopeT(w, s.x, s.z) > slopeT(w, r.x, r.z), 'storm opened behind the pack');
  // It blows in from one side and sweeps across: halfway through its life it's over the island.
  const mid = { x: s.x + s.vx * ((s.until - w.tick) / 2) / 20, z: s.z + s.vz * ((s.until - w.tick) / 2) / 20 };
  assert.ok(w.terrain.filled[cellIndex(w.terrain, mid.x, mid.z)] > 0, 'storm never crosses the island');
  // Under it, a river gains the rain on top of what it gathers anyway (put
  // the storm over the river, out on the slope, for this).
  Object.assign(s, { x: r.x, z: r.z });
  const v0 = r.volume;
  step(w, new Map());
  assert.ok(r.volume - v0 >= TUNE.stormRain * 0.99 || r.inLake >= 0, `gained ${r.volume - v0}`);
  // It ends on time.
  while (w.tick < s.until + 1) step(w, new Map());
  assert.equal(w.storms.length, 0);
});

test('weather is deterministic', () => {
  const run = () => {
    const w = createWorld(t5);
    for (let i = 0; i < 4; i++) addRiver(w, `p${i}`);
    w.tick = TUNE.stormStart - 40;
    for (let k = 0; k < 400; k++) step(w, new Map());
    return riverFingerprint(w) + JSON.stringify(w.storms);
  };
  assert.equal(run(), run());
});

test('every start still reaches the sea through the rock gates', async () => {
  const { spawnBand } = await import('../../src/shared/river.js');
  for (const seed of [4, 8]) {
    const w = createWorld(generateIsland(seed));
    for (const c of spawnBand(w).cells) assert.ok(w.reach[c] > 0 && Number.isFinite(w.reach[c]), `seed ${seed}: start ${c} can't reach the sea`);
  }
});
