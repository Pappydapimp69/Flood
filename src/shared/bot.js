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
  if (r.dropping) return botGlide(world, bot);
  // Stuck against a rise (barely moved in 2 s): turn toward the fall line,
  // the way a player would. The game itself never steers.
  if (world.tick % 40 === 0) {
    bot.stuck = bot.lastTravelled !== undefined && r.travelled - bot.lastTravelled < 60;
    bot.lastTravelled = r.travelled;
  }
  if (bot.stuck && r.pooled < 0) {
    const h = world.terrain.cell;
    const gx = surfaceAt(world, r.x + h, r.z, r.idx) - surfaceAt(world, r.x - h, r.z, r.idx);
    const gz = surfaceAt(world, r.x, r.z + h, r.idx) - surfaceAt(world, r.x, r.z - h, r.idx);
    // Fall line (-gx, -gz) relative to heading: on the left if cross > 0.
    const cross = -gx * r.dz - -gz * r.dx;
    const ahead = -gx * r.dx + -gz * r.dz;
    // Turn until roughly facing downhill, then hold straight (a stale turn would spin).
    bot.steer = ahead < 0.99 * Math.sqrt(gx * gx + gz * gz) ? (cross > 0 ? -1 : 1) : 0;
    bot.next = world.tick + bot.think;
    return bot.steer;
  }
  if (world.tick < bot.next) return bot.steer;
  bot.next = world.tick + bot.think;

  const t = world.terrain;
  const here = world.reach[cellIndex(t, r.x, r.z)];
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
      score += ((here - world.reach[k]) / L) * 2 * w; // progress toward the sea
      if (surfaceAt(world, x, z, r.idx) > r.low + TUNE.climb + 8) score -= 2 * w; // uphill wall
      const lake = world.lakeOf[k];
      if (lake >= 0 && !r.via.has(lake)) {
        // A full lake you haven't joined pays at once and keeps paying; one below
        // full holds you until the rivers in it fill it, so only big rivers take it on.
        const full = world.lakeVol[lake] >= world.lakeCap[lake] * TUNE.fullAt;
        score += full ? (0.6 + bot.skill) * w : -(1.6 - 0.5 * Math.min(2, r.size - 1)) * w;
      }
      if (world.lava[k]) score -= 3 * w; // lava boils water off
            const o = world.owner[k];
      if (o >= 0 && o !== r.idx && world.carve[k] > TUNE.contactDepth && isLive(world, k)) {
        const owner = world.rivers[o];
        // Contact is a depth contest: avoid live water dug deeper than we cut,
        // and cross shallow channels on purpose to siphon them.
        if (isRacing(owner)) score += world.carve[k] > r.depth * 0.95 ? -4 * w : world.carve[k] < r.depth * 0.8 ? bot.aggression * 0.8 * w : 0;
      }
    }
    for (const o of rivals) {
      const ox = o.x - r.x, oz = o.z - r.z;
      const d = Math.sqrt(ox * ox + oz * oz);
      if (d > TUNE_BOT.sight) continue;
      const toward = (ox * dx + oz * dz) / (d || 1); // -1..1
      const near = 1 - d / TUNE_BOT.sight;
      const danger = o.depth > r.depth * 0.95 ? -4 : o.depth < r.depth * 0.8 ? bot.aggression * 1.2 : 0;
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

// Falling: drift away from the nearest other drop, so bots land spread out.
function botGlide(world, bot) {
  const r = bot.river;
  let near = null, best = Infinity;
  for (const o of world.rivers) {
    if (o === r || !isRacing(o)) continue;
    const d = (o.x - r.x) ** 2 + (o.z - r.z) ** 2;
    if (d < best) { best = d; near = o; }
  }
  if (!near || best > 3000 * 3000) return 0;
  // Which side of our heading is it on? Turn the other way.
  const side = (near.x - r.x) * r.dz - (near.z - r.z) * r.dx; // > 0: on the left
  return side > 0 ? 1 : -1;
}
