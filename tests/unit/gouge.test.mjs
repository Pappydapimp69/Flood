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

test('gouge costs water, holds the head through the wind-up, then boosts it for 3 s', () => {
  const { w, r } = atRise();
  const vol = r.volume, cost = gougeCost(r);
  press(w);
  assert.equal(Math.round(w.events.find((e) => e.type === 'gouge-wind').cost), Math.round(cost));
  assert.ok(vol - r.volume > cost * 0.9, 'paid at once');
  const x = r.x, z = r.z;
  for (let k = 0; k < TUNE.gougeWind - 1; k++) { step(w, new Map()); assert.equal(r.x, x); assert.equal(r.z, z); }
  assert.equal(r.boost, TUNE.gougeBoost, 'the boost starts at the slam');
  assert.ok(r.speed >= TUNE.baseSpeed * TUNE.gougeSpeed, 'it bursts on');
  for (let k = 0; k < TUNE.gougeBoost; k++) step(w, new Map());
  assert.equal(r.boost, 0, 'the boost lasts gougeBoost ticks');
});

test('boosted, a head climbs a rise that stopped it', () => {
  const { w, r } = atRise();
  const h0 = surfaceAt(w, r.x, r.z, r.idx);
  press(w);
  for (let k = 0; k < TUNE.gougeWind + TUNE.gougeBoost; k++) step(w, new Map());
  assert.ok(surfaceAt(w, r.x, r.z, r.idx) > h0 + 10, 'it did not climb');
});

test('cooldown is 10 s from the press, and the water floor still gates it', () => {
  const { w, r } = atRise();
  press(w);
  const at = w.tick;
  for (let k = 0; k < TUNE.gougeWind + TUNE.gougeBoost + 2; k++) step(w, new Map());
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
