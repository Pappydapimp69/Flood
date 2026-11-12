import test from 'node:test';
import assert from 'node:assert/strict';
import { rollIsland, addRiver, step, riverFingerprint } from '../../src/shared/river.js';
import { createLookahead, lookaheadSteer } from '../../src/shared/lookahead.js';

// A landed race: two rivers, run until both are on the ground.
function landed(seed = 4) {
  const { world: w } = rollIsland(seed, 2);
  const a = addRiver(w, 'a'); addRiver(w, 'b');
  for (let k = 0; k < 2000 && w.rivers.some((r) => r.dropping); k++) step(w, new Map());
  assert.ok(!a.dropping, 'landed');
  return { w, a };
}

test('planning never touches the real world: the trials run in copies', () => {
  const { w, a } = landed();
  const before = riverFingerprint(w), tick = w.tick;
  const agent = createLookahead(w, a, { horizon: 40 });
  const s = lookaheadSteer(w, agent);
  assert.ok(agent.trials === agent.tune.plans.length, 'every plan tried');
  assert.ok(s === -1 || s === 0 || s === 1, 'a legal steer');
  assert.equal(w.tick, tick);
  assert.equal(riverFingerprint(w), before);
});

test('the same world gives the same plan, and a copy of the world plays on identically', () => {
  const x = landed(), y = landed();
  const ax = createLookahead(x.w, x.a, { horizon: 40 }), ay = createLookahead(y.w, y.a, { horizon: 40 });
  for (let k = 0; k < 60; k++) {
    const sx = lookaheadSteer(x.w, ax), sy = lookaheadSteer(y.w, ay);
    assert.equal(sx, sy);
    step(x.w, new Map([['a', sx]])); step(y.w, new Map([['a', sy]]));
  }
  assert.equal(riverFingerprint(x.w), riverFingerprint(y.w));
  const copy = structuredClone(x.w);
  for (let k = 0; k < 100; k++) { step(x.w, new Map()); step(copy, new Map()); }
  assert.equal(riverFingerprint(copy), riverFingerprint(x.w), 'a trial world is a faithful copy');
});

test('falling, it keeps its hands off like the rivers it is measured against', () => {
  const { world: w } = rollIsland(4, 2);
  const a = addRiver(w, 'a', undefined, { drop: true });
  const agent = createLookahead(w, a);
  assert.ok(a.dropping);
  assert.equal(lookaheadSteer(w, agent), 0);
  assert.equal(agent.trials, 0);
});
