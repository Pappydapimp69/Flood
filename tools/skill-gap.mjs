// Skill gap: does steering decide the race? One steered river among eleven that
// never steer, on the same island from the same seat, once per kind of steering:
//   still: it never steers either (the baseline: what the seat alone is worth)
//   bot:   the game's bot (steering and skills, from what a player can see)
//   look:  the look-ahead planner (src/shared/lookahead.js; steering only, sees the whole sim)
// A game that rewards skill puts the strong agent near first whatever the seat
// (relative algorithm performance: Nielsen, Barros, Togelius, Nelson 2015).
// Usage: node tools/skill-gap.mjs [--seats 2,8] [--agents still,bot,look] [--json] <seed>...
import { rollIsland, addRiver, step, standings, isRacing, TICK_HZ } from '../src/shared/river.js';
import { createBot, botSteer } from '../src/shared/bot.js';
import { createLookahead, lookaheadSteer } from '../src/shared/lookahead.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i < 0 ? def : args.splice(i, 2)[1]; };
const seats = opt('seats', '2,8').split(',').map(Number);
const agents = opt('agents', 'still,bot,look').split(',');
const json = args.includes('--json') && args.splice(args.indexOf('--json'), 1);
const seeds = args.map(Number);
const ids = Array.from({ length: 12 }, (_, i) => `r${String(i).padStart(2, '0')}`);
const LIMIT = 600 * TICK_HZ, AFTER = 180 * TICK_HZ; // the race ends 3 minutes after the first finisher

export function race(seed, seat, kind) {
  const { world: w } = rollIsland(seed, ids.length);
  const rivers = ids.map((id) => addRiver(w, id)), me = rivers[seat];
  const drive = kind === 'bot' ? ((b) => () => botSteer(w, b))(createBot(w, me, 0.95))
    : kind === 'look' ? ((a) => () => lookaheadSteer(w, a))(createLookahead(w, me)) : () => 0;
  let first = -1;
  while (w.tick < LIMIT && rivers.some(isRacing) && (first < 0 || w.tick - first < AFTER)) {
    step(w, new Map([[me.id, drive()]]));
    if (first < 0 && rivers.some((r) => r.finished)) first = w.tick;
  }
  return { seed: w.terrain.seed, seat, kind, place: standings(w).indexOf(me) + 1,
    secs: me.finished ? me.finishTick / TICK_HZ : null, out: !!me.out, water: Math.round(me.volume / 1000) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = [];
  for (const seed of seeds) for (const seat of seats) for (const kind of agents) {
    const row = race(seed, seat, kind);
    rows.push(row);
    if (!json) console.error(`seed ${row.seed} seat ${seat} ${kind}: place ${row.place}${row.secs ? `, ${row.secs} s` : row.out ? ', drained' : ', did not finish'}`);
  }
  if (json) console.log(JSON.stringify(rows));
  else for (const kind of agents) {
    const mine = rows.filter((r) => r.kind === kind), n = mine.length;
    const mean = (mine.reduce((s, r) => s + r.place, 0) / n).toFixed(1);
    const beat = mine.filter((r) => { const b = rows.find((x) => x.kind === 'still' && x.seed === r.seed && x.seat === r.seat); return b && r.place < b.place; }).length;
    console.log(`${kind}: mean place ${mean} of ${ids.length} over ${n} races, won ${mine.filter((r) => r.place === 1).length}, finished ${mine.filter((r) => r.secs).length}` +
      (kind === 'still' ? '' : `, placed better than the same seat unsteered in ${beat}`));
  }
}
