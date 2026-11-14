// Descent check: where each comet starts (over land or sea), and how many sky clouds the bots
// never reach during the drop. Usage: node tools/descent-check.mjs <seed>...
import { rollIsland, addRiver, step, skyClouds, cellIndex, TICK_HZ } from '../src/shared/river.js';
import { createBot, botSteer } from '../src/shared/bot.js';

for (const seed of process.argv.slice(2).map(Number)) {
  const { world: w } = rollIsland(seed, 12);
  const rivers = Array.from({ length: 12 }, (_, i) => addRiver(w, `r${i}`, undefined, { drop: true }));
  const t = w.terrain;
  const overSea = rivers.filter((r) => t.height[cellIndex(t, r.x, r.z)] <= 0).length;
  const bots = rivers.map((r) => createBot(w, r, 0.8));
  const clouds = skyClouds(w);
  let turned = 0;
  const was = rivers.map((r) => r.dropping);
  while (rivers.some((r) => r.dropping) && w.tick < 400 * TICK_HZ) {
    step(w, new Map(bots.map((b, i) => [rivers[i].id, botSteer(w, b)])));
    rivers.forEach((r, i) => { // the heading on the tick it lands
      if (was[i] && !r.dropping && r.dx * t.axis.x + r.dz * t.axis.y < 0.5 - 1e-6) turned++;
      was[i] = r.dropping;
    });
  }
  const untouched = clouds.filter((c) => c.water >= c.water0 - 1).length;
  console.log(`seed ${seed}: comets over sea ${overSea}/12, clouds untouched ${untouched}/${clouds.length}, landed past 60deg ${turned}`);
}
