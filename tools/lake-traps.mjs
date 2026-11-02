// Lake-trap census: headless races, 12 rivers (8 bots, 4 unsteered), 600 s.
// Merges visits to the same lake less than 3 s apart, reports stalls over 15 s
// with how far the lake sits below its brim, and rivers still in a lake at the end.
// Usage: node tools/lake-traps.mjs 4 5 8 11 43 99 126 314 780 2024
import { rollIsland, addRiver, step, isRacing, lakeLevel, TICK_HZ } from '../src/shared/river.js';
import { createBot, botSteer } from '../src/shared/bot.js';

const seeds = process.argv.slice(2).map(Number);
const ids = Array.from({ length: 12 }, (_, i) => `r${String(i).padStart(2, '0')}`);
const PASSIVE = new Set(['r00', 'r03', 'r06', 'r09']);
const GAP = 3 * TICK_HZ;
let rivers = 0, fin = 0;
const stalls = [], trapped = [];
for (const seed of seeds) {
  const { world: w } = rollIsland(seed, 12);
  const bots = new Map();
  for (const id of ids) { const r = addRiver(w, id); if (!PASSIVE.has(id)) bots.set(id, createBot(w, r)); }
  const st = new Map(ids.map((id) => [id, { lake: -1, start: 0, last: 0, x: 0, z: 0, deficit: 0 }]));
  const close = (r, s) => {
    const secs = (s.last - s.start) / TICK_HZ;
    if (secs > 15) stalls.push({ seed: w.terrain.seed, id: r.id, bot: !PASSIVE.has(r.id), lake: s.lake, secs: +secs.toFixed(1), deficitAtEntry: +s.deficit.toFixed(1), net: Math.round(Math.hypot(r.x - s.x, r.z - s.z)) });
  };
  for (let k = 0; k < TICK_HZ * 600 && w.rivers.some(isRacing); k++) {
    const inp = new Map();
    for (const [id, b] of bots) inp.set(id, botSteer(w, b));
    step(w, inp);
    for (const r of w.rivers) {
      if (!isRacing(r) || r.inLake < 0) continue;
      const s = st.get(r.id);
      if (r.inLake === s.lake && w.tick - s.last <= GAP) { s.last = w.tick; continue; }
      if (s.lake >= 0) close(r, s);
      Object.assign(s, { lake: r.inLake, start: w.tick, last: w.tick, x: r.x, z: r.z, deficit: w.lakeBrim[r.inLake] - lakeLevel(w, r.inLake) });
    }
  }
  for (const r of w.rivers) {
    const s = st.get(r.id);
    if (s.lake >= 0) close(r, s);
    rivers++;
    if (r.finishTick >= 0) fin++;
    else if (isRacing(r) && r.inLake >= 0) trapped.push({ seed: w.terrain.seed, id: r.id, bot: !PASSIVE.has(r.id), lake: r.inLake, deficit: +(w.lakeBrim[r.inLake] - lakeLevel(w, r.inLake)).toFixed(1) });
  }
}
const long = stalls.filter((s) => s.secs > 60);
console.log(`rivers ${rivers} · finished ${fin} · in a lake at the end ${trapped.length} · lake stalls >15 s ${stalls.length} · >60 s ${long.length}`);
console.log(`>60 s stalls entered with lake >=5 m below brim: ${long.filter((s) => s.deficitAtEntry >= 5).length}/${long.length}`);
for (const s of long) console.log(JSON.stringify(s));
for (const t of trapped) console.log('trapped', JSON.stringify(t));
