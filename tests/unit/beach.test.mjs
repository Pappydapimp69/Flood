import test from 'node:test';
import assert from 'node:assert/strict';
import { rollIsland, addRiver, step, cellIndex, TUNE } from '../../src/shared/river.js';
import { SEA_LEVEL } from '../../src/shared/terrain.js';

test('only the one beach ends the race; the wrong coast carries you to it', () => {
  const w = rollIsland(8, 12).world, t = w.terrain, n = t.size;
  // A sea cell next to land, far from the beach.
  let start = -1, far = 0;
  for (let k = 0; k < n * n; k++) {
    if (t.filled[k] > SEA_LEVEL || w.beach[k] || w.seaNext[k] < 0) continue;
    const x = ((k % n) / (n - 1) - 0.5) * t.worldSize, z = (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize;
    const d = Math.hypot(x - w.beachAt.x, z - w.beachAt.z);
    if (d > 8000 && d < 12000 && d > far) { far = d; start = k; }
  }
  assert.ok(start >= 0, 'no wrong-coast sea cell found');
  const at = { x: ((start % n) / (n - 1) - 0.5) * t.worldSize, z: (Math.floor(start / n) / (n - 1) - 0.5) * t.worldSize };
  const r = addRiver(w, 'a', at);
  const events = [];
  for (let k = 0; k < 20 * 200 && !r.finished; k++) { step(w, new Map([['a', 1]])); events.push(...w.events.splice(0)); }
  assert.ok(events.some((e) => e.type === 'offcourse'), 'no wrong-beach warning');
  assert.ok(r.finished, `never reached the beach from ${Math.round(far)} m away`);
  assert.equal(w.beach[cellIndex(t, r.x, r.z)], 1, 'finished somewhere other than the beach');
  assert.ok(r.finishTick / 20 >= far / TUNE.seaCurrent * 0.5, 'the wrong coast cost no time');
});
