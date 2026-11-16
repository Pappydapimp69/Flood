// Landslide timing in bot races: when the slope cracks, when it falls, when the dam closes, how long it takes
// to fill and burst, and how long rivers sit trapped behind it. To judge whether the set piece is fair.
// Usage: node tools/slide-times.mjs [--rivers 12] [--training] <seed>...
//   --training: the Training map (course 'slide', start on the line); otherwise a solo ski race with the slide.
import { rollIsland, addRiver, step, isRacing, TICK_HZ, inBasin } from '../src/shared/river.js';
import { createBot, botSteer } from '../src/shared/bot.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i < 0 ? def : args.splice(i, 2)[1]; };
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && !!args.splice(i, 1); };
const count = Number(opt('rivers', 12)), training = flag('training');
const LIMIT = 400 * TICK_HZ;

export function slideRace(seed) {
  const { world: w } = training ? rollIsland(seed, Math.min(count, 12), 40, 'slide') : rollIsland(seed, Math.min(count, 12), 40, undefined, { slide: true });
  if (!w.slide) return { seed, slide: false };
  const rivers = Array.from({ length: count }, (_, i) => addRiver(w, `b${String(i).padStart(2, '0')}`, undefined, { drop: !training }));
  const bots = rivers.map((r) => createBot(w, r));
  const at = {}, trapped = new Map();
  while (w.tick < LIMIT && rivers.some(isRacing) && w.slide.state !== 'done') {
    step(w, new Map(bots.map((b) => [b.river.id, botSteer(w, b)])));
    for (const e of w.events) if (e.type === 'slide' && e.phase && at[e.phase] == null) at[e.phase] = w.tick / TICK_HZ;
    w.events.length = 0;
    if (w.slide.state === 'dammed') for (const r of rivers) if (isRacing(r) && !r.dropping && inBasin(w, w.slide, r.x, r.z)) trapped.set(r.idx, (trapped.get(r.idx) ?? 0) + 1);
  }
  const s = w.slide, t = trapped.size ? [...trapped.values()].map((v) => v / TICK_HZ).sort((a, b) => a - b) : [];
  const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  return { seed: w.terrain.seed, cracking: r1(at.cracking), falling: r1(at.falling), dammed: r1(at.dammed), burst: r1(at.burst),
    warn: r1(at.falling - at.cracking), closing: r1(at.dammed - at.falling), filling: r1(at.burst - at.dammed),
    trapped: t.length, trappedMedian: r1(t[t.length >> 1]), trappedMost: r1(t[t.length - 1]), capM: s.cap ? Math.round(s.cap / 1e6) : null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const seed of args.map(Number)) {
    const r = slideRace(seed);
    if (r.slide === false) { console.log(`seed ${seed}: no slide`); continue; }
    console.log(`seed ${r.seed}: cracks ${r.cracking} s, falls ${r.falling} s (warning ${r.warn} s), dam ${r.dammed} s (closing ${r.closing} s), burst ${r.burst} s (filling ${r.filling} s, cap ${r.capM}M); ${r.trapped} trapped, median ${r.trappedMedian} s, longest ${r.trappedMost} s`);
  }
}
