// Course counts: what happens to a river over a race, per river, from a field of bots: the course's own
// features (boulders, ridge cells, lakes) and every sim event (lakes pooled, siphons, bumps, surges...), plus how
// much it turns. To tell an empty course from a full one: compare a course against the ski slope's numbers.
// Usage: node tools/course-counts.mjs [--course summit] <seed>...
import { rollIsland, addRiver, step, isRacing, TICK_HZ } from '../src/shared/river.js';
import { createBot, botSteer } from '../src/shared/bot.js';
const args = process.argv.slice(2), ci = args.indexOf('--course'), courseArg = ci < 0 ? undefined : args.splice(ci, 2)[1];
for (const course of [courseArg]) for (const seed of args.length ? args.map(Number) : [1, 2, 3]) {
  const { world: w } = rollIsland(seed, 12, 40, course);
  const t = w.terrain; let ridgeCells = 0, fastCells = 0; for (let k = 0; k < t.size * t.size; k++) { if (t.ridge[k] > 0) ridgeCells++; if (t.fast[k]) fastCells++; }
  const rivers = Array.from({ length: 30 }, (_, i) => addRiver(w, `b${String(i).padStart(2, '0')}`, undefined, { drop: true }));
  const bots = rivers.map((r) => createBot(w, r));
  const ev = {}; let first = -1, turn = 0, n = 0; const ph = rivers.map((r) => Math.atan2(r.dz, r.dx));
  while (w.tick < 600 * TICK_HZ && rivers.some(isRacing) && (first < 0 || w.tick - first < 60 * TICK_HZ)) {
    step(w, new Map(bots.map((b) => [b.river.id, botSteer(w, b)])));
    for (const e of w.events) ev[e.type] = (ev[e.type] || 0) + 1; w.events.length = 0;
    if (first < 0 && rivers.some((r) => r.finished)) first = w.tick;
    rivers.forEach((r, i) => { if (!isRacing(r) || r.dropping) return; const a = Math.atan2(r.dz, r.dx); let d = a - ph[i]; d = Math.atan2(Math.sin(d), Math.cos(d)); turn += Math.abs(d); n++; ph[i] = a; });
  }
  console.log(course ?? 'ski', seed, `boulders ${t.boulders.length} canyons ${t.canyons.length} ridgeCells ${ridgeCells} fastCells ${fastCells} lakes ${w.lakes?.length ?? '?'}; turning deg/s per river ${(turn / n * TICK_HZ * 57.3).toFixed(1)}; events per river: ${Object.entries(ev).map(([k, v]) => `${k} ${(v / 30).toFixed(1)}`).join(', ')}`);
}
