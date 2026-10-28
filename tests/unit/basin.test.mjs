import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, TUNE } from '../../src/shared/river.js';

const t1 = generateIsland(1);
const cellPos = (w, k) => {
  const n = w.terrain.size;
  return { x: ((k % n) / (n - 1) - 0.5) * w.terrain.worldSize, z: (Math.floor(k / n) / (n - 1) - 0.5) * w.terrain.worldSize };
};

test('every lake is full, and stays full however much the rivers draw off', () => {
  const w = createWorld(t1);
  assert.equal(w.basins.length, 0);
  for (const l of w.lakes) assert.equal(w.lakeVol[l.id], w.lakeCap[l.id]);
  const lake = w.lakes.reduce((a, b) => (b.cells > a.cells ? b : a));
  const r = addRiver(w, 'a', cellPos(w, w.lakeOf.indexOf(lake.id)));
  step(w, new Map());
  r.inLake = -1;
  r.via.set(lake.id, { cell: w.lakeOutlet[lake.id], e: TUNE.outletMax, born: 0 });
  r.volume = TUNE.startVolume * 81; r.size = 3;
  const v0 = r.volume;
  for (let k = 0; k < 200; k++) step(w, new Map());
  assert.equal(w.lakeVol[lake.id], w.lakeCap[lake.id], 'the lake dropped');
  assert.ok(r.volume > v0, 'the outlet carried nothing');
});

test('momentum carries across level water instead of dropping to a crawl', () => {
  const w = createWorld(t1);
  const lake = w.lakes.filter((l) => w.lakeVol[l.id] > 0).reduce((a, b) => (b.cells > a.cells ? b : a));
  const r = addRiver(w, 'a', cellPos(w, w.lakeOf.indexOf(lake.id)));
  r.speed = 180;
  step(w, new Map());
  for (let k = 0; k < 10 && r.inLake === lake.id; k++) step(w, new Map());
  assert.ok(r.speed > 150, `speed fell to ${r.speed | 0} on the lake`);
});

test('lakes are not traps: a river skates across and leaves over the bank it reaches, still fast', async () => {
  const { rollIsland, cellIndex } = await import('../../src/shared/river.js');
  let ok = 0, n = 0;
  const { world: base } = rollIsland(11, 12);
  const t = base.terrain, N = t.size;
  for (const lake of base.lakes.filter((l) => l.cells > 40).sort((a, b) => b.cells - a.cells).slice(0, 5)) {
    const cx = (lake.gx / (N - 1) - 0.5) * t.worldSize, cz = (lake.gy / (N - 1) - 0.5) * t.worldSize;
    if (base.lakeOf[cellIndex(t, cx, cz)] !== lake.id) continue;
    for (const [ux, uz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const w = createWorld(t);
      const r = addRiver(w, 'a', { x: cx - ux * 150, z: cz - uz * 150 });
      r.dx = ux; r.dz = uz; r.speed = 180;
      let exit = 0;
      for (let k = 0; k < 800 && !exit; k++) { step(w, new Map()); if (w.lakeOf[cellIndex(t, r.x, r.z)] < 0) exit = r.speed; }
      n++;
      if (exit > 100) ok++;
    }
  }
  assert.ok(n >= 8 && ok / n >= 0.9, `${ok}/${n} crossings left the lake still fast`);
});

test('no digging or erosion under standing water: only the banks erode', async () => {
  const { rollIsland, underWater } = await import('../../src/shared/river.js');
  const { createBot, botSteer } = await import('../../src/shared/bot.js');
  const { world: w } = rollIsland(11, 12);
  for (let i = 0; i < 12; i++) addRiver(w, `p${String(i).padStart(2, '0')}`, undefined, { drop: true });
  const bots = w.rivers.map((r) => createBot(w, r));
  for (let k = 0; k < 20 * 120; k++) step(w, new Map(bots.map((b) => [b.river.id, botSteer(w, b)])));
  let dug = 0;
  for (let k = 0; k < w.carve.length; k++) {
    if (w.carve[k] <= 0) continue;
    dug++;
    assert.ok(!underWater(w, k), `cell ${k} under water was dug ${w.carve[k]} m`);
  }
  assert.ok(dug > 500, `only ${dug} cells dug at all`);
});
