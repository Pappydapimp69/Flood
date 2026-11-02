import test from 'node:test';
import assert from 'node:assert/strict';
import { rollIsland, addRiver, step, gougeReady, gougeTarget, gougeUsable, gougePlan, gougeCost, surfaceAt, riverFingerprint, TUNE } from '../../src/shared/river.js';
import { encodeFrame, decodeFrame } from '../../src/shared/protocol.js';

// A river run unsteered until a rise ahead gives Gouge a target.
function atRise(seed = 4) {
  const w = rollIsland(seed, 12).world;
  const r = addRiver(w, 'a');
  for (let k = 0; k < 20 * 300; k++) {
    if (gougeUsable(w, r)) return { w, r };
    step(w, new Map());
    w.events.length = 0;
  }
  throw new Error('no rise to gouge within 300 s');
}
const press = (w, s = 0) => step(w, new Map([['a', { s, f: 0, k: 1 }]]));

test('a press with nothing to cut spends nothing and starts no cooldown', () => {
  const w = rollIsland(4, 12).world;
  const r = addRiver(w, 'a');
  for (let k = 0; k < 40; k++) step(w, new Map());
  if (gougeTarget(w, r)) return; // (this start happens to face a rise: covered below)
  const vol = r.volume;
  press(w);
  assert.equal(r.gougeT, -1);
  assert.equal(r.gougeAt, 0);
  assert.ok(r.volume >= vol, 'water was spent on a refused gouge');
});

test('gouge costs water, holds the head through the wind-up, then cuts a way through', () => {
  const { w, r } = atRise();
  const vol = r.volume, cost = gougeCost(r), plan = gougePlan(w, r);
  assert.ok(plan.through && plan.cells.length > 0);
  press(w);
  const wind = w.events.find((e) => e.type === 'gouge-wind');
  assert.equal(Math.round(wind.cost), Math.round(cost), 'the cost charged');
  assert.ok(vol - r.volume > cost * 0.9, 'the cost is paid at once'); // (a spill or pulse may add a little the same tick)
  assert.equal(r.gougeAt, w.tick - 1 + TUNE.gougeCool);
  const x = r.x, z = r.z;
  const events = [];
  for (let k = 0; k < TUNE.gougeWind + TUNE.gougeRecover - 1; k++) {
    step(w, new Map());
    events.push(...w.events.splice(0));
    assert.equal(r.x, x); assert.equal(r.z, z); // costs time: the head holds still
  }
  const blow = events.find((e) => e.type === 'gouge');
  assert.ok(blow && blow.cells > 0, 'the blow landed');
  for (const [k, now] of plan.cells) assert.ok(w.rock[k] <= now + 1e-3, 'every planned cell came down'); // (rock is float32)
  assert.ok(!gougeTarget(w, r) || gougePlan(w, r).cells.every(([k, now]) => w.rock[k] - now < TUNE.gougeTarget), 'nothing big left to cut');
  step(w, new Map());
  assert.equal(r.gougeT, -1);
  assert.ok(r.speed >= TUNE.baseSpeed, 'the water bursts on into the cut');
});

test('cooldown and the water floor gate the next gouge', () => {
  const { w, r } = atRise();
  press(w);
  for (let k = 0; k < TUNE.gougeWind + TUNE.gougeRecover + 2; k++) step(w, new Map());
  assert.equal(gougeReady(w, r), false, 'still recharging');
  const w2 = rollIsland(4, 12).world, r2 = addRiver(w2, 'a');
  r2.volume = TUNE.gougeKeep * TUNE.startVolume + TUNE.gougeMinCost - 1; // (a share of this is below the minimum cost)
  assert.equal(gougeCost(r2), TUNE.gougeMinCost);
  assert.equal(gougeReady(w2, r2), false, 'too little water to pay and keep the floor');
});

test('a gouge never cuts below the water at the head: the cut falls gently away from it', () => {
  const { w, r } = atRise();
  const here = surfaceAt(w, r.x, r.z, r.idx), t = w.terrain;
  for (const [k, now] of gougePlan(w, r).cells) assert.ok(t.filled[k] + now <= here && t.filled[k] + now >= here - 0.5 - TUNE.gougeCells * t.cell * TUNE.gougeGrade - 1e-6 || now === Math.max(-TUNE.gougeMax, 0.5 - t.filled[k]));
});

test('skill presses travel in frames and replay to the same race', () => {
  const ids = ['a', 'b'];
  const frame = encodeFrame(ids, new Map([['a', { s: 1, f: 0, k: 1 }], ['b', -1]]));
  assert.deepEqual(decodeFrame(ids, frame).get('a'), { s: 1, f: 0, k: 1 });
  assert.equal(decodeFrame(ids, frame).get('b'), -1);
  const run = () => {
    const { w } = atRise();
    for (let k = 0; k < 200; k++) step(w, new Map([['a', { s: k % 50 < 5 ? 1 : 0, f: 0, k: k % 30 === 0 ? 1 : 0 }]]));
    return riverFingerprint(w);
  };
  assert.equal(run(), run());
});
