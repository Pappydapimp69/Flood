// Bot rivers. A bot only produces steering input, the same input a player
// sends, from the same state a player can see (map, channels, lakes, heads).
// Deterministic: decisions read the world at tick start, and each bot's
// randomness comes from its own id-keyed stream.

import { stream } from './rng.js';
import { surfaceAt, cellIndex, isRacing, isLive, widthOf, liftOf, skyClouds, gougeUsable, gougeTarget, surgeReady, calm, DT, TUNE } from './river.js';
import { downhill } from './terrain.js';

// Each bot has a personality: what it weighs, besides running downhill.
// racer: downhill first. grower: detours for full lakes. hunter: goes after smaller rivers.
// (None knows where the finish is until it sees the finish beach.)
export const PERSONAS = [
  { name: 'racer', down: 2, lake: 0.6, hunt: 0.4, fear: 1 },
  { name: 'grower', down: 1.5, lake: 2.2, hunt: 0.5, fear: 1 },
  { name: 'hunter', down: 1.5, lake: 0.8, hunt: 2.2, fear: 0.6 },
];

// Headings a bot weighs: straight and up to 30 degrees either side (all it can see).
const OFFSETS = [-Math.tan(Math.PI / 6), -0.35, -0.17, 0, 0.17, 0.35, Math.tan(Math.PI / 6)]; // sideways share added to heading; + = left
// 2026-11-06 race pass (12 bots, seeds 4 5 8 11, median finish): 206 s as it was; skills whenever ready
// + heading along the mapped route (aim 1) + deciding every 2 ticks + half the fear of deeper rivals: 182 s.
// Steering alone (route traces, pursuit, think, hands-off) moved it under 4%, inside the noise.
export const TUNE_BOT = { margin: 0.2, sight: 2500, step: 120, steps: 10, route: false, look: 3000, think: 2, surgeEager: false, handsOff: true, pursue: 0, aim: 0, aimLook: 1000, danger: 2, skills: true,
  // Line of sight for finding a way: this far ahead (within 30 degrees either side),
  // a quarter less through trees and half as far past a ridge. No map, no view of the finish.
  view: 1200, viewTrees: 0.75, viewRidge: 0.5, eye: 8, course: 0.6,
  // In the descent: chase one drop for at most chase ticks (x0.5 to x1.5 by aggression) or chaseHits hits, then leave it be for spare ticks.
  chase: 240, chaseHits: 2, spare: 600 };

// The shortest water route to the beach from (x, z), as the map shows it: step
// to the neighbour nearest the beach (world.toBeach) until `metres` are covered.
export function beachRoute(world, x, z, metres) {
  const t = world.terrain, n = t.size;
  let k = cellIndex(t, x, z), d = 0;
  while (d < metres) {
    const cx = k % n, cy = (k - cx) / n;
    let best = k, bv = world.toBeach[k];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = cx + dx, yy = cy + dy;
      if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const kk = yy * n + xx;
      if (world.toBeach[kk] < bv || (world.toBeach[kk] === bv && kk < best)) { bv = world.toBeach[kk]; best = kk; }
    }
    if (best === k) break;
    d += t.cell * ((best % n !== cx && Math.floor(best / n) !== cy) ? Math.SQRT2 : 1);
    k = best;
  }
  return { x: ((k % n) / (n - 1) - 0.5) * t.worldSize, z: (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize };
}

// Trace the water from r holding heading (hx, hz) (the player's flow guide uses it too): each step runs down the
// local fall line bent toward the heading, until it would climb out of reach.
// Where the water will actually go holding heading (hx, hz), for about `metres`
// (the route preview): the same steering rule as flowFrom, but past a rise it
// can't climb it follows the fill's downhill tree round it, as the sim's escape
// route does, instead of stopping. Each point: { x, z, d, kind } with kind
// 'run' (going where aimed), 'slide' (bent along the slope) or 'route' (blocked,
// finding its way round). end: distance to the beach at the last point.
export function routeAhead(world, r, hx, hz, metres = 3000) {
  const t = world.terrain, n = t.size, step = TUNE_BOT.step, h = t.cell * 2, out = [];
  let x = r.x, z = r.z, d = 0, low = Math.min(r.low ?? Infinity, surfaceAt(world, x, z, r.idx));
  const lift = liftOf(r);
  while (d < metres) {
    const here = surfaceAt(world, x, z, r.idx);
    if (here < low) low = here;
    const k = cellIndex(t, x, z);
    if (world.beach?.[k] && t.filled[k] <= 0) break;
    const gx = (surfaceAt(world, x + h, z, r.idx) - surfaceAt(world, x - h, z, r.idx)) / (2 * h);
    const gz = (surfaceAt(world, x, z + h, r.idx) - surfaceAt(world, x, z - h, r.idx)) / (2 * h);
    const gl = Math.sqrt(gx * gx + gz * gz);
    let mx = hx, mz = hz, kind = 'run';
    const lake = world.lakeOf[k];
    if (gl >= TUNE.flatSlope && !(lake >= 0 && world.lakeVol[lake] > 0)) {
      const wf = Math.min(1, gl / TUNE.fallSlope), fx = -gx / gl, fz = -gz / gl, up = hx * fx + hz * fz;
      const over = up < 0 && -up * gl * TUNE.headLook > lift;
      if (over) { mx -= up * fx; mz -= up * fz; kind = 'slide'; }
      if (up >= 0 || over) { mx += fx * wf * (over ? TUNE.fallUphill : TUNE.fallDrift); mz += fz * wf * (over ? TUNE.fallUphill : TUNE.fallDrift); }
      const ml = Math.sqrt(mx * mx + mz * mz) || 1;
      mx /= ml; mz /= ml;
    }
    let nx = x + mx * step, nz = z + mz * step;
    if (surfaceAt(world, nx, nz, r.idx) > low + TUNE.climb + lift) {
      // Blocked: round the rise along the fill's downhill tree.
      const dn = downhill(t, k);
      if (dn < 0) break;
      nx = ((dn % n) / (n - 1) - 0.5) * t.worldSize; nz = (Math.floor(dn / n) / (n - 1) - 0.5) * t.worldSize;
      kind = 'route';
    }
    const sl = Math.hypot(nx - x, nz - z) || step;
    x = nx; z = nz; d += sl;
    out.push({ x, z, d, kind });
  }
  const last = out[out.length - 1] ?? { x: r.x, z: r.z };
  return { path: out, end: world.toBeach?.[cellIndex(t, last.x, last.z)] ?? 0 };
}

export function flowFrom(world, r, hx, hz) {
  const h = world.terrain.cell * 2, out = [];
  let x = r.x, z = r.z, d = 0;
  const ceiling = r.low + TUNE.climb + liftOf(r) + 4;
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
      const over = up < 0 && (-up * gl * TUNE.headLook > liftOf(r) || r.speed < TUNE.climbSpeed);
      if (over) { mx -= up * fx; mz -= up * fz; }
      if (up >= 0 || over) {
        mx += fx * wf * (over ? TUNE.fallUphill : TUNE.fallDrift);
        mz += fz * wf * (over ? TUNE.fallUphill : TUNE.fallDrift);
      }
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

// A tick phase 0..9 from the river's id (never its index: that depends on the
// order rivers were added, and the race must not).
const idPhase = (id) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 10; return h; };

export function createBot(world, river, skill) {
  const rng = stream(world.terrain.seed, `bot:${river.id}`);
  return {
    river,
    rng,
    skill: skill ?? 0.45 + rng() * 0.5, // 0..1: less noise, more lake-seeking
    aggression: rng(), // appetite for chasing smaller rivals
    think: 4 + Math.floor(rng() * 4), // ticks between decisions
    persona: PERSONAS[Math.floor(rng() * PERSONAS.length)],
    next: 0,
    steer: 0,
  };
}

export function botSteer(world, bot) {
  const r = bot.river;
  if (!isRacing(r)) return 0;
  if (r.dropping) return botGlide(world, bot);
  // Gouge, through the same button and gates as a player: when a rise has
  // slowed the head and there is ground ahead to cut (checked twice a second).
  // (Not with a deeper rival beside it: the wind-up holds the head still, and
  // a rival in reach siphons 23% of its water while it waits (Brain G2).)
  const exposed = world.tick % 5 === 0 && world.rivers.some((o) => o !== r && isRacing(o) && !o.dropping && o.depth > r.depth && (o.x - r.x) ** 2 + (o.z - r.z) ** 2 < 400 * 400);
  if (!exposed && world.tick % 10 === idPhase(r.id) && r.gougeT < 0 && r.speed < TUNE.climbSpeed && gougeUsable(world, r)) {
    return { s: bot.steer ?? 0, f: 0, k: 1 };
  }
  // Surge on the flat, where the water has slowed and nothing rises ahead.
  if (!exposed && world.tick % 10 === (idPhase(r.id) + 5) % 10 && (TUNE_BOT.skills || r.speed < TUNE.baseSpeed * (TUNE_BOT.surgeEager ? 2 : 1.2)) && r.inLake < 0 && surgeReady(world, r) && !gougeTarget(world, r)) {
    return { s: bot.steer ?? 0, f: 0, u: 1 };
  }
  // Going nowhere (moving, but back and forth, or not at all) for 2 s: let
  // go of the stick for a few seconds so the water finds its own way out, the
  // way a player would. The game itself never steers.
  if (TUNE_BOT.handsOff && world.tick % 40 === 0) {
    if (bot.at) {
      const moved = r.travelled - bot.at.t, net = Math.sqrt((r.x - bot.at.x) ** 2 + (r.z - bot.at.z) ** 2);
      if (r.pooled < 0 && net < Math.max(40, moved * 0.35)) bot.hands = world.tick + 60;
    }
    bot.at = { x: r.x, z: r.z, t: r.travelled };
  }
  if (world.tick < (bot.hands ?? -1)) { bot.steer = 0; return 0; }
  if (world.tick < bot.next) return bot.steer;
  bot.next = world.tick + (TUNE_BOT.think || bot.think);

  const t = world.terrain;
  if (TUNE_BOT.pursue) {
    // Map reading: aim at a point that far ahead along the shortest water route to the beach.
    const p = beachRoute(world, r.x, r.z, TUNE_BOT.pursue);
    const d = Math.hypot(p.x - r.x, p.z - r.z) || 1, cross = r.dx * (p.z - r.z) - r.dz * (p.x - r.x);
    bot.steer = Math.abs(cross) < d * 0.05 ? 0 : cross < 0 ? -1 : 1;
    return bot.steer;
  }
  const P = bot.persona ?? PERSONAS[0]; // water knows downhill, not where the finish is
  const goal = TUNE_BOT.aim ? beachRoute(world, r.x, r.z, TUNE_BOT.aimLook) : null; // where the map says the route goes
  const rivals = world.rivers.filter((o) => o !== r && isRacing(o));
  const scores = new Map();
  for (const a of OFFSETS) {
    // Heading turned toward the left by a (left of (dx, dz) is (dz, -dx)).
    let hx = r.dx + r.dz * a, hz = r.dz - r.dx * a;
    const hl = Math.sqrt(hx * hx + hz * hz);
    hx /= hl; hz /= hl;
    // Where would the water actually go holding this heading? It runs down
    // the fall line bent toward the heading (see moveRiver), so trace it.
    const sight = sightAlong(world, r, hx, hz), seen = sight.d;
    const path = (TUNE_BOT.route ? routeAhead(world, r, hx, hz, TUNE_BOT.look).path : flowFrom(world, r, hx, hz)).filter((p) => p.d <= seen);
    if (!path.length) path.push({ x: r.x, z: r.z, d: 0, blocked: true });
    const end = path[path.length - 1];
    const travelled = Math.max(TUNE_BOT.step, end.d);
    let score = -Math.abs(a) * 0.12; // mild preference for going straight
    // Downhill: how far the water drops along what it can see, per metre (a 4% grade scores 1).
    // (The ground it can see, out to the end of its sight along this heading, filled level over pits.)
    const far = t.filled[cellIndex(t, r.x + hx * seen, r.z + hz * seen)];
    score += P.down * Math.max(-1, Math.min(2, (t.filled[cellIndex(t, r.x, r.z)] - far) / seen / 0.04));
    if (sight.beach >= 0) score += 3 * (1 - sight.beach / TUNE_BOT.view); // the finish beach in sight: go for it
    // Which way the course runs (the way every drop flew in, down the mountain), not where it ends.
    score += TUNE_BOT.course * (hx * t.axis.x + hz * t.axis.y);
    if (sight.lake >= 0) score += P.lake * 0.5 * Math.max(-1, Math.min(1, (sight.full - 0.6) * 3)) * (1 - sight.lake / TUNE_BOT.view); // a full lake in sight pays, a low one costs
    if (end.blocked) score -= 0.6;
    if (goal) { const gx = goal.x - r.x, gz = goal.z - r.z, gl = Math.hypot(gx, gz) || 1; score += TUNE_BOT.aim * (hx * gx + hz * gz) / gl; } // heading along the mapped route
    const dx = (end.x - r.x) / (end.d || 1), dz = (end.z - r.z) / (end.d || 1);
    for (const p of path) {
      const w = 1 - p.d / 2000; // nearer matters more
      const k = cellIndex(t, p.x, p.z);
      const lake = world.lakeOf[k];
      if (lake >= 0 && !r.via.has(lake)) {
        // A full lake pays (its stored water drains out to you through your
        // outlet); a low one costs, since your water goes into filling it first.
        const full = world.lakeVol[lake] / world.lakeCap[lake];
        score += (P.lake * (0.6 + bot.skill) * w * Math.max(-1, Math.min(1, (full - 0.85) * 6))) / path.length * 3;
      }
      if (world.lava[k]) score -= (3 * w) / path.length * 3; // lava boils water off
      const o = world.owner[k];
      if (o >= 0 && o !== r.idx && world.carve[k] > TUNE.contactDepth && isLive(world, k)) {
        const owner = world.rivers[o];
        // Contact is a depth contest: avoid live water dug deeper than we cut,
        // and cross shallow channels on purpose to siphon them.
        if (isRacing(owner)) score += (world.carve[k] > r.depth * 0.95 ? -P.fear * TUNE_BOT.danger * w : world.carve[k] < r.depth * 0.8 ? P.hunt * bot.aggression * 0.8 * w : 0) / path.length * 3;
      }
    }
    for (const o of rivals) {
      const ox = o.x - r.x, oz = o.z - r.z;
      const d = Math.sqrt(ox * ox + oz * oz);
      if (d > TUNE_BOT.sight) continue;
      const toward = (ox * dx + oz * dz) / (d || 1); // -1..1
      const near = 1 - d / TUNE_BOT.sight;
      const danger = o.depth > r.depth * 0.95 ? -P.fear * TUNE_BOT.danger : o.depth < r.depth * 0.8 ? P.hunt * bot.aggression * 1.2 : 0;
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

// How far a bot can see along heading (hx, hz): TUNE_BOT.view, a quarter less
// if trees stand in the way, half as far if the ground rises above its eye (a ridge);
// and how far off the finish beach is, if it can see it (-1 if not).
function sightAlong(world, r, hx, hz) {
  const t = world.terrain, eye = surfaceAt(world, r.x, r.z, r.idx) + TUNE_BOT.eye, stepM = t.cell * 2;
  let trees = false, ridge = false, beach = -1, lake = -1, full = 0;
  for (let d = stepM; d <= TUNE_BOT.view; d += stepM) {
    const x = r.x + hx * d, z = r.z + hz * d, k = cellIndex(t, x, z);
    const reach = TUNE_BOT.view * (trees ? TUNE_BOT.viewTrees : 1) * (ridge ? TUNE_BOT.viewRidge : 1);
    if (d > reach) break;
    if (beach < 0 && world.beach?.[k]) beach = d; // the finish beach, seen
    const lk = world.lakeOf[k];
    if (lake < 0 && lk >= 0 && !r.via.has(lk)) { lake = d; full = world.lakeVol[lk] / world.lakeCap[lk]; } // the first new lake it can see
    if (world.trees?.[k]) trees = true;
    if (t.filled[k] > eye) ridge = true;
  }
  return { d: TUNE_BOT.view * (trees ? TUNE_BOT.viewTrees : 1) * (ridge ? TUNE_BOT.viewRidge : 1), beach, lake, full };
}

// Falling: drift away from the nearest other drop, so bots land spread out.
function botGlide(world, bot) {
  const r = bot.river, ax = world.terrain.axis.x, az = world.terrain.axis.y;
  // A drop it can beat close by: ram it (the harder hitter wins the spill). An
  // aggressive bot also takes on drops its own size and a little heavier, and
  // looks further for them: the descent is a fight, not a queue.
  // A chase has a time limit: after it, that drop is left alone for a while and the
  // bot looks for another in range. Bumped by some other drop, it turns on that one.
  const bold = bot.aggression ?? 0.5, reachM = 700 + 900 * bold, now = world.tick;
  const spared = (bot.spared ??= new Map());
  const fair = (o) => o !== r && o.dropping && isRacing(o) && !calm(o) && !calm(r) && Math.abs(o.alt - r.alt) <= TUNE.bumpDepth * 2 && (o.x - r.x) ** 2 + (o.z - r.z) ** 2 <= reachM * reachM && now >= (spared.get(o.id) ?? -1);
  let prey = null;
  if (r.hitBy && now - r.hitBy.tick < 10 && r.hitBy.id !== bot.prey?.id) {
    const o = world.rivers.find((x) => x.id === r.hitBy.id);
    if (o && fair(o)) bot.prey = { id: o.id, until: now + TUNE_BOT.chase * (0.5 + bold) };
  }
  if (bot.prey) {
    const o = world.rivers.find((x) => x.id === bot.prey.id);
    // A hit it landed on its target (the target's hitBy names it): two and it moves on.
    if (o?.hitBy?.id === r.id && o.hitBy.tick !== bot.prey.lastHit) { bot.prey.lastHit = o.hitBy.tick; bot.prey.hits = (bot.prey.hits ?? 0) + 1; }
    if (now >= bot.prey.until || (bot.prey.hits ?? 0) >= TUNE_BOT.chaseHits || !o || !fair(o)) { spared.set(bot.prey.id, now + TUNE_BOT.spare); bot.prey = null; } else prey = o;
  }
  if (!prey) {
    let pd = Infinity;
    for (const o of world.rivers) {
      if (!fair(o) || o.volume > r.volume * (0.98 + 0.2 * bold)) continue;
      const d = (o.x - r.x) ** 2 + (o.z - r.z) ** 2;
      if (d < pd && (o.x - r.x) * ax + (o.z - r.z) * az > -200) { pd = d; prey = o; }
    }
    if (prey) bot.prey = { id: prey.id, until: now + TUNE_BOT.chase * (0.5 + bold) };
  }
  // Diving onto it from above closes the gap (a dive is faster): a drop flying straight ahead is still catchable.
  // Under it: float up to its height first (out of bump height, a chase never lands).
  if (prey) return { s: turnTo(r, prey.x, prey.z), f: r.alt > prey.alt + 40 ? 1 : r.alt < prey.alt - TUNE.bumpDepth * 0.6 ? -1 : 0, g: 1 };
  // A rain cloud ahead it can still reach: go for it (crowds and all: that's where the fight is).
  let cloud = null, cd = Infinity, fast = false;
  for (const c of skyClouds(world)) {
    if (c.low || !(c.water > 0) || c.alt > r.alt + TUNE.cloudDepth) continue;
    if ((c.x - r.x) * ax + (c.z - r.z) * az < 0) continue; // behind it: no turning back
    const ticks = Math.max(0, r.alt - c.alt) / (TUNE.dropAlt / TUNE.dropTicks);
    const d = Math.hypot(c.x - r.x, c.z - r.z), reach = ticks * TUNE.glideSpeed * 1.8 * DT;
    if (d < reach + 600 && d < cd) { cd = d; cloud = c; fast = d > 400; }
  }
  if (cloud) {
    // Height too: dive or float toward the cloud's.
    const f = r.alt > cloud.alt + TUNE.cloudDepth * 0.5 ? 1 : r.alt < cloud.alt - TUNE.cloudDepth * 0.5 ? -1 : 0;
    return { s: turnTo(r, cloud.x, cloud.z), f, g: fast ? 1 : 0 };
  }
  // Nothing to chase: fly down the slope to the start line, stick all the way
  // (as fast as a player can: a bot left at the base glide falls behind the pack).
  const cross = r.dx * az - r.dz * ax, dot = r.dx * ax + r.dz * az;
  return { s: dot > 0.97 ? 0 : cross < 0 ? -1 : 1, f: 0, g: 1 };
}
const turnTo = (r, x, z) => {
  const d = Math.hypot(x - r.x, z - r.z) || 1, cross = r.dx * (z - r.z) - r.dz * (x - r.x);
  return Math.abs(cross) < d * 0.1 ? 0 : cross < 0 ? -1 : 1;
};
