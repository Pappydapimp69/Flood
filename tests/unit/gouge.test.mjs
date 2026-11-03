import test from 'node:test';
import assert from 'node:assert/strict';
import { rollIsland, addRiver, step, gougeReady, gougeTarget, gougeCost, surfaceAt, riverFingerprint, TUNE } from '../../src/shared/river.js';
import { encodeFrame, decodeFrame } from '../../src/shared/protocol.js';

// A river run unsteered until a rise ahead stops it that the boost can carry it over.
function atRise(seed = 4) {
  const w = rollIsland(seed, 12).world;
  const r = addRiver(w, 'a');
  for (let k = 0; k < 20 * 300; k++) {
    if (gougeReady(w, r) && gougeTarget(w, r)) return { w, r };
    step(w, new Map());
    w.events.length = 0;
  }
  throw new Error('no rise within 300 s');
}
const press = (w, s = 0) => step(w, new Map([['a', { s, f: 0, k: 1 }]]));

test('gouge never stops the head: it keeps its momentum and adds speed and size for 3 s', async () => {
  const { sizeOf } = await import('../../src/shared/river.js');
  const w = rollIsland(4, 12).world, r = addRiver(w, 'a');
  for (let k = 0; k < 120; k++) step(w, new Map());
  const vol = r.volume, cost = gougeCost(r), v0 = r.speed, x = r.x, z = r.z;
  press(w);
  assert.equal(Math.round(w.events.find((e) => e.type === 'gouge-wind').cost), Math.round(cost));
  assert.ok(vol - r.volume > cost * 0.9, 'paid at once');
  assert.ok(Math.hypot(r.x - x, r.z - z) > 1, 'the head paused');
  assert.ok(r.speed >= v0 + TUNE.baseSpeed * TUNE.gougeAdd - 1e-9, `speed ${v0} -> ${r.speed}: not added to`);
  assert.ok(Math.abs(r.size - (sizeOf(r.volume) + TUNE.gougeGrow)) < 1e-9, 'no added size');
  for (let k = 0; k < TUNE.gougeBoost - 2; k++) { step(w, new Map()); assert.ok(r.speed >= r.boostSpeed - 1e-9, 'lost the boosted speed'); }
  step(w, new Map()); step(w, new Map());
  assert.equal(r.boost, 0, 'the boost lasts gougeBoost ticks');
  assert.ok(Math.abs(r.size - sizeOf(r.volume)) < 1e-9, 'the added size stayed');
});

test('boosted, a head climbs a rise that stopped it', () => {
  const { w, r } = atRise();
  const h0 = surfaceAt(w, r.x, r.z, r.idx);
  press(w);
  for (let k = 0; k < TUNE.gougeBoost; k++) step(w, new Map());
  assert.ok(surfaceAt(w, r.x, r.z, r.idx) > h0 + 10, 'it did not climb');
});

test('cooldown is 10 s from the press, and the water floor still gates it', () => {
  const { w, r } = atRise();
  press(w);
  const at = w.tick;
  for (let k = 0; k < TUNE.gougeBoost + 2; k++) step(w, new Map());
  assert.equal(gougeReady(w, r), false, 'still recharging');
  assert.equal(r.gougeAt, at - 1 + TUNE.gougeCool);
  const w2 = rollIsland(4, 12).world, r2 = addRiver(w2, 'a');
  r2.volume = TUNE.gougeKeep * TUNE.startVolume + TUNE.gougeMinCost - 1;
  assert.equal(gougeReady(w2, r2), false, 'too little water to pay and keep the floor');
});

test('skill presses travel in frames and replay to the same race', () => {
  const ids = ['a', 'b'];
  const frame = encodeFrame(ids, new Map([['a', { s: 1, f: 0, k: 1 }], ['b', -1]]));
  assert.deepEqual(decodeFrame(ids, frame).get('a'), { s: 1, f: 0, k: 1 });
  const run = () => {
    const { w } = atRise();
    for (let k = 0; k < 300; k++) step(w, new Map([['a', { s: k % 50 < 5 ? 1 : 0, f: 0, k: k % 40 === 0 ? 1 : 0 }]]));
    return riverFingerprint(w);
  };
  assert.equal(run(), run());
});

test('surge: keeps the head momentum and adds speed at once, pays water, and recharges', async () => {
  const { surgeReady } = await import('../../src/shared/river.js');
  const w = rollIsland(4, 12).world, r = addRiver(w, 'a');
  for (let k = 0; k < 60; k++) step(w, new Map());
  assert.ok(surgeReady(w, r));
  const vol = r.volume, x = r.x, v0 = r.speed;
  step(w, new Map([['a', { s: 0, f: 0, u: 1 }]]));
  assert.ok(w.events.some((e) => e.type === 'surge'), 'no surge');
  assert.ok(vol - r.volume > TUNE.gougeMinCost * 0.9, 'paid');
  assert.notEqual(r.x, x, 'the head paused');
  assert.ok(r.speed >= v0 + TUNE.baseSpeed * TUNE.surgeAdd - 1e-9, `speed ${v0} -> ${r.speed}`);
  for (let k = 0; k < 5; k++) step(w, new Map());
  assert.ok(r.speed >= r.surgeSpeed - 1e-9, `surging at ${r.speed}`);
  assert.equal(surgeReady(w, r), false, 'recharging');
  const frame = encodeFrame(['a'], new Map([['a', { s: -1, f: 0, u: 1 }]]));
  assert.deepEqual(decodeFrame(['a'], frame).get('a'), { s: -1, f: 0, u: 1 });
});

test('the route preview runs the real rules on a copy and changes nothing', async () => {
  const { predictPath } = await import('../../src/shared/river.js');
  const w = rollIsland(8, 12).world, r = addRiver(w, 'a');
  for (let k = 0; k < 100; k++) step(w, new Map());
  const fp = riverFingerprint(w), x = r.x, path = predictPath(w, r, 200, 4);
  assert.equal(riverFingerprint(w), fp, 'the preview changed the world');
  assert.equal(r.x, x);
  assert.ok(path.length >= 40, `only ${path.length} points`);
  // Unsteered, the river then runs along the path the preview drew (a pulse
  // arriving can change how fast, not where): every 20 ticks it is within 60 m
  // of the preview's line, while it is still within the preview's length.
  const len = path.reduce((a, p, i) => a + (i ? Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z) : 0), 0), t0 = r.travelled;
  let worst = 0;
  for (let k = 0; k < 200 && r.travelled - t0 < len * 0.9; k++) {
    step(w, new Map());
    if (k % 20 === 19) worst = Math.max(worst, Math.min(...path.map((p) => Math.hypot(p.x - r.x, p.z - r.z))));
  }
  assert.ok(worst < 60, `${Math.round(worst)} m off the previewed line`);
});
