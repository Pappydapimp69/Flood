import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, heatFront, slopeT, riverFingerprint, cellIndex, TUNE } from '../../src/shared/river.js';

const t5 = generateIsland(5);

test('the heat front rolls down the mountain and boils off a river it catches', () => {
  const w = createWorld(t5);
  const r = addRiver(w, 'a');
  assert.equal(heatFront(w), -Infinity);
  // Hold the river at its start while the front comes down.
  const at = { x: r.x, z: r.z };
  let first = -1;
  for (let k = 0; k < TUNE.heatStart + 20 * 60 && !r.out; k++) {
    Object.assign(r, at, { speed: 0 });
    step(w, new Map());
    if (first < 0 && w.events.some((e) => e.type === 'scorch' && e.river === r.idx)) first = w.tick;
    w.events.length = 0;
  }
  assert.ok(first >= TUNE.heatStart, 'scorched before the heat started');
  assert.ok(heatFront(w) > slopeT(w, at.x, at.z), 'front did not pass the river');
  assert.equal(r.out?.how, 'heat', 'the river held at the summit was not boiled away');
});

test('a river ahead of the heat front is untouched by it', () => {
  const w = createWorld(t5);
  const r = addRiver(w, 'a');
  w.tick = TUNE.heatStart + 20;
  const v0 = r.volume;
  step(w, new Map());
  assert.ok(slopeT(w, r.x, r.z) > heatFront(w));
  assert.ok(!w.events.some((e) => e.type === 'scorch'), 'scorched ahead of the front');
  assert.ok(r.volume >= v0);
});

test('storms open ahead of the pack and rain into rivers under them', () => {
  const w = createWorld(t5);
  const r = addRiver(w, 'a');
  w.tick = TUNE.stormStart;
  step(w, new Map());
  const s = w.storm;
  assert.ok(s, 'no storm at stormStart');
  assert.ok(slopeT(w, s.x, s.z) > slopeT(w, r.x, r.z), 'storm opened behind the pack');
  assert.ok(w.terrain.filled[cellIndex(w.terrain, s.x, s.z)] > 0, 'storm over the sea');
  // Under it, a river gains the rain on top of what it gathers anyway.
  Object.assign(r, { x: s.x, z: s.z });
  const v0 = r.volume;
  step(w, new Map());
  assert.ok(r.volume - v0 >= TUNE.stormRain * 0.99 || r.inLake >= 0, `gained ${r.volume - v0}`);
  // It ends on time.
  while (w.tick < s.until + 1) step(w, new Map());
  assert.equal(w.storm, null);
});

test('weather is deterministic', () => {
  const run = () => {
    const w = createWorld(t5);
    for (let i = 0; i < 4; i++) addRiver(w, `p${i}`);
    w.tick = TUNE.stormStart - 40;
    for (let k = 0; k < 400; k++) step(w, new Map());
    return riverFingerprint(w) + JSON.stringify(w.storm);
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
