// Bot rivers. A bot only produces steering input, the same input a player
// sends, from the same state a player can see (map, channels, lakes, heads).
// Deterministic: decisions read the world at tick start, and each bot's
// randomness comes from its own id-keyed stream.

import { stream } from './rng.js';
import { surfaceAt, cellIndex, isRacing, isLive, widthOf, TUNE } from './river.js';

const OFFSETS = [-0.7, -0.35, 0, 0.35, 0.7]; // sideways share added to heading; + = left
const REACH = [250, 600, 1100]; // metres ahead to sample
export const TUNE_BOT = { margin: 0.35, sight: 2500 };

export function createBot(world, river, skill) {
  const rng = stream(world.terrain.seed, `bot:${river.id}`);
  return {
    river,
    rng,
    skill: skill ?? 0.45 + rng() * 0.5, // 0..1: less noise, more lake-seeking
    aggression: rng(), // appetite for chasing smaller rivals
    think: 4 + Math.floor(rng() * 4), // ticks between decisions
    next: 0,
    steer: 0,
  };
}

export function botSteer(world, bot) {
  const r = bot.river;
  if (!isRacing(r)) return 0;
  if (world.tick < bot.next) return bot.steer;
  bot.next = world.tick + bot.think;

  const t = world.terrain;
  const here = world.dist[cellIndex(t, r.x, r.z)];
  const rivals = world.rivers.filter((o) => o !== r && isRacing(o));
  const scores = new Map();
  for (const a of OFFSETS) {
    // Heading turned toward the left by a (left of (dx, dz) is (dz, -dx)).
    let dx = r.dx + r.dz * a, dz = r.dz - r.dx * a;
    const len = Math.sqrt(dx * dx + dz * dz);
    dx /= len; dz /= len;
    let score = -Math.abs(a) * 0.15; // mild preference for going straight
    for (const L of REACH) {
      const x = r.x + dx * L, z = r.z + dz * L;
      const k = cellIndex(t, x, z);
      const w = 1 - L / 2000; // nearer samples matter more
      score += ((here - world.dist[k]) / L) * 2 * w; // progress toward the sea
      if (surfaceAt(world, x, z, r.idx) > r.low + TUNE.climb + 8) score -= 2 * w; // uphill wall
      const lake = world.lakeOf[k];
      if (lake >= 0 && world.lakeTaken[lake] < 0) score += (0.6 + bot.skill) * w;
      const o = world.owner[k];
      if (o >= 0 && o !== r.idx && world.carve[k] > TUNE.contactDepth && isLive(world, k)) {
        const owner = world.rivers[o];
        // Avoid anything that might be bigger; only cut off clearly smaller rivers.
        if (isRacing(owner)) score += owner.volume > r.volume * 0.8 ? -4 * w : owner.volume < r.volume * 0.75 ? bot.aggression * 0.8 * w : 0;
      }
    }
    for (const o of rivals) {
      const ox = o.x - r.x, oz = o.z - r.z;
      const d = Math.sqrt(ox * ox + oz * oz);
      if (d > TUNE_BOT.sight) continue;
      const toward = (ox * dx + oz * dz) / (d || 1); // -1..1
      const near = 1 - d / TUNE_BOT.sight;
      const danger = o.volume > r.volume * 0.8 ? -4 : o.volume < r.volume * 0.75 ? bot.aggression * 1.2 : 0;
      score += danger * toward * near * (1 + widthOf(o) / 400);
    }
    score += (bot.rng() - 0.5) * (1 - bot.skill) * 1.2;
    scores.set(a, score);
  }
  // Gravity already steers well; only turn for a clear gain over going straight.
  let best = scores.get(0) + TUNE_BOT.margin, choice = 0;
  for (const [a, sc] of scores) if (sc > best) { best = sc; choice = a; }
  bot.steer = choice > 0 ? -1 : choice < 0 ? 1 : 0;
  return bot.steer;
}
