// Bot race: whole fields of bots on one course, to measure a course or a rule change.
// Each race: rivers, how long the first finish took after landing, finishers, knockouts,
// knockouts within a second of the first touch, and how close rivals run (the median distance to
// the nearest rival, and the share of river-seconds with one within 400 m).
// Usage: node tools/bot-race.mjs [--course summit] [--rivers 30] [--drop] [--json] <seed>...
import { rollIsland, addRiver, step, isRacing, TICK_HZ } from '../src/shared/river.js';
import { createBot, botSteer } from '../src/shared/bot.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i < 0 ? def : args.splice(i, 2)[1]; };
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && !!args.splice(i, 1); };
const course = opt('course', undefined), count = Number(opt('rivers', 12)), drop = flag('drop'), json = flag('json');
const LIMIT = 600 * TICK_HZ, AFTER = 60 * TICK_HZ; // the race ends a minute after the first finisher

export function race(seed) {
  const { world: w } = rollIsland(seed, Math.min(count, 12), 40, course);
  const ids = Array.from({ length: count }, (_, i) => `b${String(i).padStart(2, '0')}`);
  const rivers = ids.map((id) => addRiver(w, id, undefined, { drop }));
  const bots = rivers.map((r) => createBot(w, r));
  let first = -1, near = 0, samples = 0, quick = 0;
  const gaps = [], touched = new Map(); // river idx -> tick of its first contact
  while (w.tick < LIMIT && rivers.some(isRacing) && (first < 0 || w.tick - first < AFTER)) {
    step(w, new Map(bots.map((b) => [b.river.id, botSteer(w, b)])));
    for (const e of w.events) if (e.type === 'siphon' && !touched.has(e.from)) touched.set(e.from, w.tick);
    w.events.length = 0; // the game's client clears them each frame
    if (first < 0 && rivers.some((r) => r.finished)) first = w.tick;
    if (w.tick % TICK_HZ) continue;
    const live = rivers.filter((r) => isRacing(r) && !r.dropping);
    for (const r of live) {
      let d = Infinity;
      for (const o of live) if (o !== r) d = Math.min(d, Math.hypot(o.x - r.x, o.z - r.z));
      if (d === Infinity) continue;
      gaps.push(d); samples++; if (d < 400) near++;
    }
  }
  for (const r of rivers) if (r.out && touched.has(r.idx) && r.out.tick - touched.get(r.idx) <= TICK_HZ) quick++;
  gaps.sort((a, b) => a - b);
  const times = rivers.filter((r) => r.finished).map((r) => (r.finishTick - r.born) / TICK_HZ).sort((a, b) => a - b); // from its own landing
  return { seed: w.terrain.seed, course: course ?? 'ski', valleys: w.terrain.valleys, rivers: count,
    first: times.length ? Math.round(times[0]) : null, median: times.length ? Math.round(times[times.length >> 1]) : null, finishers: rivers.filter((r) => r.finished).length,
    out: rivers.filter((r) => r.out).length, quickOut: quick, nearest: Math.round(gaps[gaps.length >> 1] ?? 0), within400: +(near / Math.max(1, samples)).toFixed(2) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = args.map(Number).map(race);
  if (json) console.log(JSON.stringify(rows));
  else for (const r of rows) console.log(`seed ${r.seed} ${r.course}${r.valleys ? ` (${r.valleys.join(' ')})` : ''}, ${r.rivers} rivers: fastest ${r.first ?? '-'} s, median finisher ${r.median ?? '-'} s, ${r.finishers} finished, ${r.out} out (${r.quickOut} within 1 s of first contact), nearest rival median ${r.nearest} m, within 400 m ${Math.round(r.within400 * 100)}%`);
}
