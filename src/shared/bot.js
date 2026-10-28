// Bot rivers. A bot only produces steering input, the same input a player
// sends, from the same state a player can see (map, channels, lakes, heads).
// Deterministic: decisions read the world at tick start, and each bot's
// randomness comes from its own id-keyed stream.

import { stream } from './rng.js';
import { surfaceAt, cellIndex, isRacing, isLive, widthOf, TUNE } from './river.js';

const OFFSETS = [-1.6, -0.7, -0.35, 0, 0.35, 0.7, 1.6]; // sideways share added to heading; + = left
export const TUNE_BOT = { margin: 0.2, sight: 2500, step: 120, steps: 10 };

// Trace the water from r holding heading (hx, hz): each step runs down the
// local fall line bent toward the heading, until it would climb out of reach.
function flowFrom(world, r, hx, hz) {
  const h = world.terrain.cell * 2, out = [];
  let x = r.x, z = r.z, d = 0;
  const ceiling = r.low + TUNE.climb + 4;
  for (let i = 0; i < TUNE_BOT.steps; i++) {
    const gx = (surfaceAt(world, x + h, z, r.idx) - surfaceAt(world, x - h, z, r.idx)) / (2 * h);
    const gz = (surfaceAt(world, x, z + h, r.idx) - surfaceAt(world, x, z - h, r.idx)) / (2 * h);
    const gl = Math.sqrt(gx * gx + gz * gz);
    // Same rule as moveRiver: aimed downhill or across, it goes where it's
    // aimed with a slight drift down; aimed uphill, the uphill part is dropped.
    let mx = hx, mz = hz;
    const k = cellIndex(world.terrain, x, z), lake = world.lakeOf[k];
    if (gl >= TUNE.flatSlope && !(lake >= 0 && world.lakeVol[lake] > 0)) {
      const wf = Math.min(1, gl / TUNE.fallSlope), fx = -gx / gl, fz = -gz / gl, up = hx * fx + hz * fz;
      if (up < 0) { mx -= up * fx; mz -= up * fz; }
      mx += fx * wf * (up < 0 ? TUNE.fallUphill : TUNE.fallDrift);
      mz += fz * wf * (up < 0 ? TUNE.fallUphill : TUNE.fallDrift);
      const ml = Math.sqrt(mx * mx + mz * mz) || 1;
      mx /= ml; mz /= ml;
    }
    const nx = x + mx * TUNE_BOT.step, nz = z + mz * TUNE_BOT.step;
    if (surfaceAt(world, nx, nz, r.idx) > ceiling) { out.push({ x, z, d, blocked: true }); return out; }
    x = nx; z = nz; d += TUNE_BOT.step;
    out.push({ x, z, d });
  }
  return out;
}

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
    let hx = r.dx + r.dz * a, hz = r.dz - r.dx * a;
    const hl = Math.sqrt(hx * hx + hz * hz);
    hx /= hl; hz /= hl;
    // Where would the water actually go holding this heading? It runs down
    // the fall line bent toward the heading (see moveRiver), so trace it.
    const path = flowFrom(world, r, hx, hz);
    const end = path[path.length - 1];
    const travelled = Math.max(TUNE_BOT.step, end.d);
    let score = -Math.abs(a) * 0.12; // mild preference for going straight
    score += ((here - world.reach[cellIndex(t, end.x, end.z)]) / travelled) * 2; // progress toward the sea
    if (end.blocked) score -= 0.6;
    const dx = (end.x - r.x) / (end.d || 1), dz = (end.z - r.z) / (end.d || 1);
    for (const p of path) {
      const w = 1 - p.d / 2000; // nearer matters more
      const k = cellIndex(t, p.x, p.z);
      const lake = world.lakeOf[k];
      if (lake >= 0 && !r.via.has(lake)) {
        // A full lake you haven't joined pays at once and keeps paying; one below
        // full holds you until the rivers in it fill it, so only big rivers take it on.
        const full = world.lakeVol[lake] >= world.lakeCap[lake] * TUNE.fullAt;
        score += (full ? (0.6 + bot.skill) * w : -(1.6 - 0.5 * Math.min(2, r.size - 1)) * w) / path.length * 3;
      }
      if (world.lava[k]) score -= (3 * w) / path.length * 3; // lava boils water off
      const o = world.owner[k];
      if (o >= 0 && o !== r.idx && world.carve[k] > TUNE.contactDepth && isLive(world, k)) {
        const owner = world.rivers[o];
        // Contact is a depth contest: avoid live water dug deeper than we cut,
        // and cross shallow channels on purpose to siphon them.
        if (isRacing(owner)) score += (world.carve[k] > r.depth * 0.95 ? -4 * w : world.carve[k] < r.depth * 0.8 ? bot.aggression * 0.8 * w : 0) / path.length * 3;
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
