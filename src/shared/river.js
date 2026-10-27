// River simulation. Authoritative, fixed-tick, shared by client and server.
// Rules: no transcendental Math; integer steering input; render never writes here.

import { SEA_LEVEL, LAKE_MIN_DEPTH, downhill, findLakes } from './terrain.js';
import { stream } from './rng.js';

export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;

export const TUNE = {
  turnStep: 0.11, // radians per tick at full steer, at starting size
  minSpeed: 18, // m/s, water always creeps
  baseSpeed: 45,
  slopeSpeed: 1400, // extra m/s per unit downhill slope
  maxSpeed: 200,
  speedEase: 0.12, // fraction of the way to target speed per tick
  bend: 9, // how hard steep ground pulls the heading downhill
  climb: 1.5, // metres the head may sit above the lowest point it has reached
  flat: 0.004, // slopes below this count as flat; the flow field takes over
  lakePull: 0.05, // heading pull per tick toward the outlet on lakes and flats
  pool: 0.3, // metres a blocked head rises per tick, until it spills over
  stallTicks: 100, // no progress toward the sea for this long -> guided flow
  guideTicks: 60, // how long guided flow lasts
  width: 110, // channel width at starting size, metres
  depth: 7, // channel depth at starting size, metres
  maxWidth: 420,
  // Growth. Volume is in litres; size = (volume / start) ^ 1/4.
  startVolume: 1_000_000,
  trickle: 25, // litres gained per metre travelled (rain and side streams)
  lakeBase: 120_000, // litres for swallowing any lake...
  lakePerCell: 9_000, // ...plus this per lake cell...
  lakeCellCap: 400, // ...counting at most this many cells
  // A tapped lake drains through your channel instead of arriving at once: its
  // outlet erodes, so the share flowing out per tick ramps up, then the lake
  // runs dry. About 90% arrives within 40 s.
  drainStart: 0.0015, // share of what's left per tick when first tapped...
  drainEnd: 0.006, // ...rising to this as the outlet erodes...
  erodeTicks: 400, // ...over 20 s
  drainFloor: 1000, // litres; below this the rest arrives at once (no endless tail)
  // Dry basins: a few lakes start empty. A head that runs into one must fill it
  // before it can spill on, paying water and time; what it leaves is a
  // reservoir anyone else can tap.
  basins: 5, // dry basins per map (fewer if the map has few mid-size lakes)
  basinMinCells: 15,
  basinMaxCells: 260,
  basinCost: 0.3, // filling costs at most this share of your current water...
  basinFloorMargin: 1.25, // ...and never takes you below 1.25x the elimination floor
  fillRate: 0.004, // share of starting water poured in per tick, times your size
  fillMaxTicks: 240, // guaranteed exit: after 12 s you spill whatever is in
  reservoirKeep: 0.8, // share of the poured water left for others to tap
  // The drop: every river starts as a drop falling from the sky over its fair
  // spawn, and can glide to choose where it lands, inside the wide fair band.
  dropTicks: 120, // 6 s of fall
  dropAlt: 3000, // metres above the ground at the start
  glideSpeed: 160, // m/s sideways while falling
  glideTurn: 0.035, // heading change per tick at full steer (a held turn is a wide arc)
  // Bigger rivers are faster but turn slower, so the leader can't simply snowball.
  speedPerSize: 0.25, // max speed multiplier gained per unit of size above 1
  // Contact is a depth tug-of-war: where a head touches a rival's head or live
  // channel, the deeper water siphons the shallower each tick. Depth comes from
  // mass and speed, so a small river racing down a slope can out-cut a big slow one.
  siphonRate: 0.012, // share of the loser's water per tick at a 100% depth lead
  siphonCap: 0.015, // most a river can lose to all contacts in one tick
  siphonDeadband: 0.05, // depth leads under 5% move nothing
  floor: 0.4, // below this share of the starting volume a river dries up and is out
  contactDepth: 1, // metres of channel that counts as a rival's water
  liveTicks: 300, // only channel dug in the last 15 s is live water; older is a dry bed
  graceTicks: 100, // no contact for anyone in their first 5 s...
  gracePerRiver: 2, // ...plus 0.1 s per river in the race, since big lobbies spawn closer
  spawnGap: 2500, // metres between spawns where the band allows
};

// Size from volume without transcendental Math: two square roots.
export function sizeOf(volume) {
  return Math.sqrt(Math.sqrt(volume / TUNE.startVolume));
}

export function lakeGain(lake) {
  return TUNE.lakeBase + TUNE.lakePerCell * Math.min(lake.cells, TUNE.lakeCellCap);
}

// The game surface: filled terrain minus every carved channel.
export function createWorld(terrain) {
  const n = terrain.size;
  // owner: which river last dug each cell. A river never feels its own channel
  // (it would sit at the bottom of its own trench and stall), only rivals'.
  // flow: unit direction from each cell to its downhill neighbour on the filled
  // surface. On lakes and flats the bilinear gradient is ~0, so this is what
  // carries water to the outlet.
  const flow = new Float32Array(n * n * 2);
  for (let i = 0; i < n * n; i++) {
    const d = downhill(terrain, i);
    if (d < 0) continue;
    const fx = (d % n) - (i % n), fz = Math.floor(d / n) - Math.floor(i / n);
    const inv = fx && fz ? 0.7071067811865476 : 1;
    flow[i * 2] = fx * inv;
    flow[i * 2 + 1] = fz * inv;
  }
  const { label: lakeOf, lakes } = findLakes(terrain);
  const world = {
    terrain, flow, dist: distanceToSea(terrain, downhill),
    lakeOf, lakes,
    lakeTaken: new Int32Array(lakes.length).fill(-1), // river draining each lake, -1 if none
    lakeTapTick: new Int32Array(lakes.length).fill(-1), // tick its current tap began
    lakeLeft: Float64Array.from(lakes, (l) => lakeGain(l)), // litres still in it
    lakeDry: new Uint8Array(lakes.length), // 1 while a dry basin is unfilled
    basinFill: new Float64Array(lakes.length), // litres poured into a dry basin so far
    lakeOutlet: lakeOutlets(terrain, lakeOf, lakes), // cell just past each lake's spill point
    events: [], // for presentation: lake captures and merges, see step()
    digs: [], // channel digs queued during a tick, applied together at its end
    carve: new Float32Array(n * n), owner: new Int32Array(n * n).fill(-1), dugAt: new Int32Array(n * n), tick: 0, rivers: [], dirty: [],
  };
  world.basins = makeBasins(world);
  return world;
}

// Surface seen by river `self` (-1 = everyone's channels, for rendering).
// The cell each lake spills into: the first cell outside it on the fill's
// downhill tree, from the lowest-lying lake cell that drains out.
function lakeOutlets(t, lakeOf, lakes) {
  const out = new Int32Array(lakes.length).fill(-1), best = new Float64Array(lakes.length).fill(Infinity);
  for (let k = 0; k < lakeOf.length; k++) {
    const l = lakeOf[k];
    if (l < 0) continue;
    const d = downhill(t, k);
    if (d >= 0 && lakeOf[d] !== l && t.filled[k] < best[l]) { best[l] = t.filled[k]; out[l] = d; }
  }
  return out;
}

// Pick the dry basins: mid-size lakes, chosen by a seeded stream so every
// client and the server agree. Kept off spawn cells.
export function makeBasins(world) {
  const r = stream(world.terrain.seed, 'basins');
  const spawn = new Set(spawnBand(world).cells);
  const cands = world.lakes.filter((l) => l.cells >= TUNE.basinMinCells && l.cells <= TUNE.basinMaxCells && world.lakeOutlet[l.id] >= 0);
  const picked = [];
  while (picked.length < TUNE.basins && cands.length) {
    const l = cands.splice(Math.floor(r() * cands.length), 1)[0];
    let nearSpawn = false;
    for (let k = 0; k < world.lakeOf.length && !nearSpawn; k++) if (world.lakeOf[k] === l.id && spawn.has(k)) nearSpawn = true;
    if (nearSpawn) continue;
    picked.push(l.id);
    world.lakeDry[l.id] = 1;
    world.lakeLeft[l.id] = 0;
  }
  return picked;
}

export function surfaceAt(world, wx, wz, self = -1) {
  const t = world.terrain, n = t.size;
  const gx = (wx / t.worldSize + 0.5) * (n - 1);
  const gy = (wz / t.worldSize + 0.5) * (n - 1);
  const x0 = gx < 0 ? 0 : gx > n - 2 ? n - 2 : Math.floor(gx);
  const y0 = gy < 0 ? 0 : gy > n - 2 ? n - 2 : Math.floor(gy);
  const fx = Math.min(1, Math.max(0, gx - x0)), fy = Math.min(1, Math.max(0, gy - y0));
  const i = y0 * n + x0, f = t.filled, c = world.carve, o = world.owner;
  // A river doesn't feel its own channel, nor a rival's live water (crossing that
  // costs water instead, see resolveContacts); old dry beds are ordinary ground.
  const cv = (k) => (self >= 0 && o[k] >= 0 && (o[k] === self || world.tick - world.dugAt[k] < TUNE.liveTicks) ? 0 : c[k]);
  const a = f[i] - cv(i), b = f[i + 1] - cv(i + 1), d = f[i + n] - cv(i + n), e = f[i + n + 1] - cv(i + n + 1);
  return (a + (b - a) * fx) + ((d + (e - d) * fx) - (a + (b - a) * fx)) * fy;
}

// Fair spawns: high ground whose downhill distance to the sea sits in one
// narrow band, so nobody starts a short hop from the coast. Cached per world.
export function spawnBand(world) {
  if (world.band) return world.band;
  const t = world.terrain, n = t.size;
  let peak = 0;
  for (let i = 0; i < n * n; i++) if (t.height[i] > peak) peak = t.height[i];
  const cands = [];
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = (i - x) / n;
    if (x < 8 || y < 8 || x >= n - 8 || y >= n - 8) continue;
    if (t.height[i] > peak * 0.45 && t.filled[i] - t.height[i] < 0.5) cands.push(i);
  }
  // Band: +-8% around the 75th percentile of distance among high cells, widened
  // only if too few cells qualify. Long runs, roughly equal for everyone.
  const ds = cands.map((i) => world.dist[i]).sort((a, b) => a - b);
  const mid = ds[Math.floor(ds.length * 0.75)];
  let spread = 0.08, cells;
  do {
    const lo = mid * (1 - spread), hi = mid * (1 + spread);
    cells = cands.filter((i) => world.dist[i] >= lo && world.dist[i] <= hi);
    world.band = { lo, hi, cells };
    spread += 0.04;
  } while (cells.length < 300 && spread < 0.5);
  // Fallback for crowded lobbies: twice the spread.
  const wlo = mid * (1 - spread * 2), whi = mid * (1 + spread * 2);
  world.band.wide = cands.filter((i) => world.dist[i] >= wlo && world.dist[i] <= whi);
  return world.band;
}

// Keyed by player id. Keeps clear of rivers already placed, so add rivers in
// a fixed order (sorted ids) when the result must be reproducible.
export function spawnPoint(world, id) {
  const t = world.terrain, n = t.size;
  const band = spawnBand(world);
  const r = stream(t.seed, `spawn:${id}`);
  const others = world.rivers.map((o) => o.spawn);
  let best = null, bestGap = -1;
  for (let tries = 0; tries < 120; tries++) {
    // Half the tries in the fair band, then a wider one if it is crowded.
    const cells = tries < 60 ? band.cells : band.wide;
    const i = cells[Math.floor(r() * cells.length)];
    const p = { x: ((i % n) / (n - 1) - 0.5) * t.worldSize, z: (Math.floor(i / n) / (n - 1) - 0.5) * t.worldSize };
    let gap = Infinity;
    for (const o of others) gap = Math.min(gap, (o.x - p.x) ** 2 + (o.z - p.z) ** 2);
    if (gap >= TUNE.spawnGap * TUNE.spawnGap) return p;
    if (gap > bestGap) { bestGap = gap; best = p; }
  }
  return best;
}

// opts.drop: start as a falling drop (the game); without it the river starts on
// the ground at once (tests and tools).
export function addRiver(world, id, at = spawnPoint(world, id), opts = {}) {
  const idx = world.rivers.length;
  const g = gradient(world, at.x, at.z, idx);
  const len = Math.sqrt(g.x * g.x + g.z * g.z) || 1;
  const river = {
    id,
    idx,
    x: at.x, z: at.z,
    spawn: { x: at.x, z: at.z }, // where it was placed (drops may land elsewhere)
    dx: -g.x / len, dz: -g.z / len,
    speed: TUNE.minSpeed,
    volume: TUNE.startVolume,
    size: 1,
    depth: TUNE.depth,
    lakes: 0,
    inflow: 0, // litres per tick arriving from tapped lakes
    filling: null, // { lake, need, ticks } while pooling in a dry basin
    low: Infinity, // lowest surface reached; water can't climb far above it
    best: Infinity, // best distance-to-sea so far, for stall detection
    stall: 0,
    guided: 0,
    guidedTicks: 0, // total, for tuning: physics should rarely need the guard
    travelled: 0,
    finished: false,
    finishTick: -1,
    out: null, // { by, tick } once drained below the floor by a rival
    born: world.tick,
    dropping: opts.drop ? TUNE.dropTicks : 0, // ticks of fall left
    alt: opts.drop ? TUNE.dropAlt : 0, // metres above the ground while falling
    path: [],
  };
  world.rivers.push(river);
  if (!river.dropping) {
    pushPathPoint(world, river);
    applyDigs(world);
  } else {
    // Glide around the island's middle at first: the fair zone is a ring at an
    // even distance from the sea, so this runs along it rather than off it.
    const cl = Math.sqrt(at.x * at.x + at.z * at.z) || 1;
    river.dx = -at.z / cl; river.dz = at.x / cl;
  }
  return river;
}

// While falling: steer a glide, but only over the wide fair band, so a landing
// is never closer to the sea than the fair spread allows.
function glide(world, r, steer) {
  if (steer) {
    const a = TUNE.glideTurn * -steer;
    const dx = r.dx + r.dz * a, dz = r.dz - r.dx * a;
    r.dx = dx; r.dz = dz;
    normalize(r);
  }
  const nx = r.x + r.dx * TUNE.glideSpeed * DT, nz = r.z + r.dz * TUNE.glideSpeed * DT;
  const zone = dropZone(world), t = world.terrain;
  // At the zone's edge, slide along it instead of stopping dead.
  if (zone.has(cellIndex(t, nx, nz))) { r.x = nx; r.z = nz; }
  else if (zone.has(cellIndex(t, nx, r.z))) r.x = nx;
  else if (zone.has(cellIndex(t, r.x, nz))) r.z = nz;
  r.dropping--;
  r.alt = (TUNE.dropAlt * r.dropping) / TUNE.dropTicks;
  if (r.dropping <= 0) land(world, r);
}

export function dropZone(world) {
  if (!world.dropZone) world.dropZone = new Set(spawnBand(world).wide);
  return world.dropZone;
}

// Touchdown: the river starts here, flowing downhill, with its spawn grace from now.
function land(world, r) {
  r.dropping = 0;
  r.alt = 0;
  const g = gradient(world, r.x, r.z, r.idx);
  const len = Math.sqrt(g.x * g.x + g.z * g.z);
  if (len > 1e-9) { r.dx = -g.x / len; r.dz = -g.z / len; }
  r.born = world.tick;
  r.low = Infinity;
  r.speed = TUNE.minSpeed;
  pushPathPoint(world, r);
  world.events.push({ type: 'land', river: r.idx, tick: world.tick });
}

export const isRacing = (r) => !r.finished && !r.out;

function gradient(world, x, z, self) {
  const h = world.terrain.cell;
  return {
    x: (surfaceAt(world, x + h, z, self) - surfaceAt(world, x - h, z, self)) / (2 * h),
    z: (surfaceAt(world, x, z + h, self) - surfaceAt(world, x, z - h, self)) / (2 * h),
  };
}

function normalize(r) {
  const len = Math.sqrt(r.dx * r.dx + r.dz * r.dz);
  if (len > 1e-9) { r.dx /= len; r.dz /= len; }
}

// One authoritative tick. inputs: Map<id, steer>, steer an integer in [-1, 1]
// (negative = turn left as seen looking along the flow).
//
// Phases, so the result never depends on the order rivers were added:
// 1. every racing river moves against last tick's surface;
// 2. contacts resolve (deeper siphons shallower), judged on last tick's channels;
// 3. lakes go to the biggest river touching them;
// 4. this tick's channel digs are applied, in id order.
export function step(world, inputs) {
  for (const r of world.rivers) {
    if (!isRacing(r)) continue;
    moveRiver(world, r, inputs);
  }
  resolveContacts(world);
  resolveLakes(world);
  drainLakes(world);
  applyDigs(world);
  world.tick++;
}

function moveRiver(world, r, inputs) {
  if (r.dropping) return glide(world, r, Math.max(-1, Math.min(1, inputs?.get(r.id) | 0)));
  if (r.filling) return fillBasin(world, r);
  {
    const steer = Math.max(-1, Math.min(1, inputs?.get(r.id) | 0));
    if (steer) {
      // Turn by adding a sideways component, then renormalising (angle = atan(a)).
      // Bigger rivers turn slower. Left of heading (dx, dz) is (dz, -dx).
      const a = (TUNE.turnStep / r.size) * -steer;
      const dx = r.dx + r.dz * a, dz = r.dz - r.dx * a;
      r.dx = dx; r.dz = dz;
      normalize(r);
    }

    const me = r.idx;
    const t = world.terrain;
    const ci = cellIndex(t, r.x, r.z);
    // Stall guard: small bowls in the bilinear surface can trap a head that
    // the fill already drained. After a while without progress, follow the
    // fill's flow tree cell by cell, which always reaches the sea.
    const dist = world.dist[ci];
    if (dist < r.best - 1) { r.best = dist; r.stall = 0; }
    else if (++r.stall > TUNE.stallTicks && !r.guided) { r.guided = TUNE.guideTicks; r.stall = 0; }
    if (r.guided) {
      r.guided--;
      r.guidedTicks++;
      guidedStep(world, r, ci);
      afterMove(world, r);
      return;
    }

    const here = surfaceAt(world, r.x, r.z, me);
    const g = gradient(world, r.x, r.z, me);
    const gl = Math.sqrt(g.x * g.x + g.z * g.z);
    if (here < r.low) r.low = here;
    const onLake = t.filled[ci] - t.height[ci] > LAKE_MIN_DEPTH;
    if (gl < TUNE.flat || onLake) {
      // Lakes and flats: drift toward the outlet along the flow field.
      r.dx += world.flow[ci * 2] * TUNE.lakePull;
      r.dz += world.flow[ci * 2 + 1] * TUNE.lakePull;
      normalize(r);
    } else {
      // Steep ground bends the flow downhill; gentle ground leaves it to the player.
      const pull = Math.min(0.5, TUNE.bend * gl * DT);
      r.dx += (-g.x / gl) * pull;
      r.dz += (-g.z / gl) * pull;
      normalize(r);
    }

    const along = -(g.x * r.dx + g.z * r.dz); // downhill slope along the heading
    const top = TUNE.maxSpeed * (1 + TUNE.speedPerSize * (r.size - 1));
    const target = Math.max(TUNE.minSpeed, Math.min(top, TUNE.baseSpeed + TUNE.slopeSpeed * along));
    r.speed += (target - r.speed) * TUNE.speedEase;
    r.depth = depthOf(r);

    let nx = r.x + r.dx * r.speed * DT, nz = r.z + r.dz * r.speed * DT;
    const ceiling = r.low + TUNE.climb;
    if (surfaceAt(world, nx, nz, me) > ceiling) {
      // Water can't climb: head for the downhill neighbour cell and creep.
      const d = downhill(t, ci);
      if (d >= 0) {
        const n = t.size;
        const tx = ((d % n) / (n - 1) - 0.5) * t.worldSize, tz = (Math.floor(d / n) / (n - 1) - 0.5) * t.worldSize;
        r.dx = tx - r.x; r.dz = tz - r.z;
        normalize(r);
      }
      r.speed = TUNE.minSpeed;
      nx = r.x + r.dx * r.speed * DT;
      nz = r.z + r.dz * r.speed * DT;
      if (surfaceAt(world, nx, nz, me) > ceiling) {
        // Still blocked: pool. The level rises each tick until it spills, so a
        // head can never stall forever.
        nx = r.x; nz = r.z;
        r.low += TUNE.pool;
      }
    }
    moveTo(world, r, nx, nz);
    afterMove(world, r);
  }
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// Bigger first; equal volumes fall back to id so ties never depend on order.
const biggerFirst = (a, b) => b.volume - a.volume || byId(a, b);

function resolveContacts(world) {
  const grace = TUNE.graceTicks + TUNE.gracePerRiver * world.rivers.length;
  const rs = world.rivers.filter((r) => isRacing(r) && !r.dropping && world.tick - r.born >= grace);
  if (rs.length < 2) return;
  cutTaps(world, rs);
  const { carve, owner } = world;
  // Contacts from last tick's channels and this tick's heads: [a, aDepth, b, bDepth, how].
  const contacts = new Map();
  const add = (a, da, b, db, how) => {
    const [p, dp, q, dq] = byId(a, b) < 0 ? [a, da, b, db] : [b, db, a, da];
    const key = `${p.id}|${q.id}`;
    const prev = contacts.get(key);
    // Two touches between the same pair: keep the bigger depth gap.
    if (!prev || Math.abs(dp - dq) > Math.abs(prev[1] - prev[3])) contacts.set(key, [p, dp, q, dq, how]);
  };
  const live = new Set(rs.map((r) => r.idx));
  for (const a of rs) {
    // Head in a rival's live channel: the channel's water is as deep as it was dug.
    const k = cellIndex(world.terrain, a.x, a.z);
    const o = owner[k];
    if (o >= 0 && o !== a.idx && live.has(o) && carve[k] > TUNE.contactDepth && isLive(world, k)) {
      add(a, a.depth, world.rivers[o], carve[k], 'channel');
    }
    // Heads touching.
    for (const b of rs) {
      if (b.idx <= a.idx) continue;
      const reach = (widthOf(a) + widthOf(b)) / 2;
      const dx = a.x - b.x, dz = a.z - b.z;
      if (dx * dx + dz * dz < reach * reach) add(a, a.depth, b, b.depth, 'head');
    }
  }
  if (!contacts.size) return;
  // Amounts come from volumes at the start of the phase, so order can't matter.
  const start = new Map(rs.map((r) => [r, r.volume]));
  const lost = new Map(), top = new Map();
  const flows = [];
  for (const key of [...contacts.keys()].sort()) {
    const [p, dp, q, dq, how] = contacts.get(key);
    const [win, dw, lose, dl] = dp >= dq ? [p, dp, q, dq] : [q, dq, p, dp];
    const lead = (dw - dl) / Math.max(dl, 0.5);
    if (lead < TUNE.siphonDeadband) continue;
    const amount = start.get(lose) * TUNE.siphonRate * Math.min(1, lead);
    flows.push({ win, lose, amount, how });
    lost.set(lose, (lost.get(lose) ?? 0) + amount);
  }
  for (const f of flows) {
    // Scale down evenly if one river is being drained from several sides at once.
    const total = lost.get(f.lose), cap = start.get(f.lose) * TUNE.siphonCap;
    const amount = total > cap ? (f.amount * cap) / total : f.amount;
    grow(f.lose, -amount);
    grow(f.win, amount);
    world.events.push({ type: 'siphon', from: f.lose.idx, to: f.win.idx, amount, how: f.how, tick: world.tick });
    if (!top.has(f.lose) || amount > top.get(f.lose).amount) top.set(f.lose, { by: f.win, amount });
  }
  for (const r of [...top.keys()].sort(byId)) {
    if (r.volume >= TUNE.floor * TUNE.startVolume) continue;
    const by = top.get(r).by;
    r.out = { by: by.id, tick: world.tick };
    world.events.push({ type: 'merge', winner: by.idx, loser: r.idx, gain: 0, how: 'drained', tick: world.tick });
  }
}

// Touching a full, untapped lake taps it: from then on it drains into you
// (drainLakes). Several heads in one tick: the biggest gets it.
function resolveLakes(world) {
  const claims = new Map();
  for (const r of world.rivers) {
    if (!isRacing(r) || r.dropping) continue;
    const lake = world.lakeOf[cellIndex(world.terrain, r.x, r.z)];
    if (lake < 0 || world.lakeTaken[lake] >= 0 || world.lakeLeft[lake] <= 0) continue;
    const prev = claims.get(lake);
    if (!prev || biggerFirst(r, prev) < 0) claims.set(lake, r);
  }
  for (const lake of [...claims.keys()].sort((a, b) => a - b)) {
    const r = claims.get(lake);
    world.lakeTaken[lake] = r.idx;
    world.lakeTapTick[lake] = world.tick;
    r.lakes++;
    world.events.push({ type: 'tap', lake, river: r.idx, left: world.lakeLeft[lake], tick: world.tick });
  }
}

// Each tapped lake pours a growing share of what's left into its tapper.
// A tapper that is drained dry hands its lakes to whoever drained it; one that
// reached the sea lets them go, so another river can tap the rest.
function drainLakes(world) {
  for (const r of world.rivers) r.inflow = 0;
  for (let lake = 0; lake < world.lakes.length; lake++) {
    let idx = world.lakeTaken[lake];
    if (idx < 0) continue;
    let r = world.rivers[idx];
    if (r.out) {
      const by = world.rivers.find((o) => o.id === r.out.by);
      if (by && isRacing(by)) moveTap(world, lake, by, 'out');
      else releaseTap(world, lake);
      continue;
    }
    if (r.finished) { releaseTap(world, lake); continue; }
    const age = world.tick - world.lakeTapTick[lake];
    const rate = TUNE.drainStart + (TUNE.drainEnd - TUNE.drainStart) * Math.min(1, age / TUNE.erodeTicks);
    let amount = world.lakeLeft[lake] * rate;
    if (world.lakeLeft[lake] - amount < TUNE.drainFloor) amount = world.lakeLeft[lake];
    world.lakeLeft[lake] -= amount;
    grow(r, amount);
    r.inflow += amount;
    if (world.lakeLeft[lake] <= 0) {
      world.lakeLeft[lake] = 0;
      world.lakeTaken[lake] = -1;
      world.events.push({ type: 'emptied', lake, river: r.idx, tick: world.tick });
    }
  }
}

function moveTap(world, lake, to, how) {
  const from = world.lakeTaken[lake];
  world.lakeTaken[lake] = to.idx;
  world.lakeTapTick[lake] = world.tick; // the new outlet starts eroding afresh
  to.lakes++;
  world.events.push({ type: 'tapcut', lake, from, to: to.idx, how, tick: world.tick });
}

function releaseTap(world, lake) {
  world.events.push({ type: 'release', lake, from: world.lakeTaken[lake], tick: world.tick });
  world.lakeTaken[lake] = -1;
}

// A head cutting deeper than a rival's channel, in a stretch dug after that
// rival tapped a lake, has cut between the lake and its tapper: the flow is now
// the cutter's. Judged on last tick's channels, rivers in id order.
function cutTaps(world, rs) {
  for (const a of [...rs].sort(byId)) {
    const k = cellIndex(world.terrain, a.x, a.z);
    const o = world.owner[k];
    if (o < 0 || o === a.idx || a.depth <= world.carve[k] * (1 + TUNE.siphonDeadband)) continue;
    for (let lake = 0; lake < world.lakes.length; lake++) {
      if (world.lakeTaken[lake] === o && world.lakeTapTick[lake] <= world.dugAt[k]) moveTap(world, lake, a, 'cut');
    }
  }
}

export function isLive(world, k) {
  return world.tick - world.dugAt[k] < TUNE.liveTicks;
}

// Cutting depth from mass (size) and speed: 0.7x when crawling, up to 1.42x at
// top speed. Linear, so it stays deterministic everywhere.
export function depthOf(r) {
  return TUNE.depth * r.size * (0.7 + 0.6 * Math.min(1.2, r.speed / TUNE.maxSpeed));
}

export function widthOf(r) {
  return Math.min(TUNE.maxWidth, TUNE.width * r.size);
}

// Finish order, then racers by distance left, then the absorbed (latest out first).
export function standings(world) {
  const fin = world.rivers.filter((r) => r.finished).sort((a, b) => a.finishTick - b.finishTick || biggerFirst(a, b));
  const left = (r) => world.dist[cellIndex(world.terrain, r.x, r.z)];
  const racing = world.rivers.filter(isRacing).sort((a, b) => left(a) - left(b) || byId(a, b));
  const out = world.rivers.filter((r) => r.out).sort((a, b) => b.out.tick - a.out.tick || biggerFirst(a, b));
  return [...fin, ...racing, ...out];
}

function moveTo(world, r, nx, nz) {
  const half = world.terrain.worldSize / 2;
  nx = Math.max(-half, Math.min(half, nx));
  nz = Math.max(-half, Math.min(half, nz));
  const mx = nx - r.x, mz = nz - r.z;
  const moved = Math.sqrt(mx * mx + mz * mz);
  r.travelled += moved;
  r.x = nx; r.z = nz;
  grow(r, moved * TUNE.trickle);
}

// Pool in a dry basin: the head stops, and what it pours in is its cost.
function startFilling(world, r, lake) {
  const room = lakeGain(world.lakes[lake]) - world.basinFill[lake];
  const floorRoom = r.volume - TUNE.floor * TUNE.startVolume * TUNE.basinFloorMargin;
  const need = Math.max(0, Math.min(room, r.volume * TUNE.basinCost, floorRoom));
  r.filling = { lake, need, ticks: 0 };
  r.speed = 0;
  world.events.push({ type: 'pool', lake, river: r.idx, need, tick: world.tick });
}

function fillBasin(world, r) {
  const f = r.filling, lake = f.lake;
  f.ticks++;
  if (world.lakeDry[lake]) {
    const pour = Math.min(f.need, TUNE.fillRate * TUNE.startVolume * r.size, lakeGain(world.lakes[lake]) - world.basinFill[lake]);
    f.need -= pour;
    grow(r, -pour);
    world.basinFill[lake] += pour;
  }
  const full = world.basinFill[lake] >= lakeGain(world.lakes[lake]) - 1;
  if (full || f.need <= 0 || f.ticks >= TUNE.fillMaxTicks || !world.lakeDry[lake]) spill(world, r, lake);
  r.depth = depthOf(r);
}

// Breach: the basin becomes a reservoir and the head carries on from its outlet.
function spill(world, r, lake) {
  const t = world.terrain, n = t.size;
  if (world.lakeDry[lake]) {
    world.lakeDry[lake] = 0;
    world.lakeLeft[lake] = world.basinFill[lake] * TUNE.reservoirKeep;
    world.events.push({ type: 'spill', lake, river: r.idx, left: world.lakeLeft[lake], tick: world.tick });
  }
  const o = world.lakeOutlet[lake];
  const x = ((o % n) / (n - 1) - 0.5) * t.worldSize, z = (Math.floor(o / n) / (n - 1) - 0.5) * t.worldSize;
  const mx = x - r.x, mz = z - r.z, len = Math.sqrt(mx * mx + mz * mz) || 1;
  r.dx = mx / len; r.dz = mz / len;
  r.x = x; r.z = z;
  r.low = surfaceAt(world, x, z, r.idx);
  r.best = world.dist[o];
  r.speed = TUNE.minSpeed;
  r.filling = null;
  pushPathPoint(world, r);
}

function grow(r, litres) {
  r.volume += litres;
  r.size = sizeOf(r.volume);
}

function guidedStep(world, r, ci) {
  const t = world.terrain, n = t.size;
  const d = downhill(t, ci);
  if (d < 0) return;
  const tx = ((d % n) / (n - 1) - 0.5) * t.worldSize, tz = (Math.floor(d / n) / (n - 1) - 0.5) * t.worldSize;
  r.dx = tx - r.x; r.dz = tz - r.z;
  normalize(r);
  r.speed = TUNE.minSpeed * 2;
  r.depth = depthOf(r);
  moveTo(world, r, r.x + r.dx * r.speed * DT, r.z + r.dz * r.speed * DT);
  r.low = Math.min(r.low, surfaceAt(world, r.x, r.z, r.idx));
}

function afterMove(world, r) {
  const lake = world.lakeOf[cellIndex(world.terrain, r.x, r.z)];
  if (lake >= 0 && world.lakeDry[lake]) startFilling(world, r, lake);
  const last = r.path[r.path.length - 1];
  const lx = r.x - last.x, lz = r.z - last.z;
  if (lx * lx + lz * lz >= (world.terrain.cell * 0.75) ** 2) pushPathPoint(world, r);
  if (world.terrain.filled[cellIndex(world.terrain, r.x, r.z)] <= SEA_LEVEL) {
    r.finished = true;
    r.finishTick = world.tick;
    pushPathPoint(world, r);
  }
}

export function cellIndex(t, wx, wz) {
  const n = t.size;
  const x = Math.max(0, Math.min(n - 1, Math.round((wx / t.worldSize + 0.5) * (n - 1))));
  const y = Math.max(0, Math.min(n - 1, Math.round((wz / t.worldSize + 0.5) * (n - 1))));
  return y * n + x;
}

// Record a path point and queue the channel under it: a flat-bottomed trench
// at (centre surface - depth), feathered at the banks.
function pushPathPoint(world, r) {
  const t = world.terrain;
  // Bed depth is measured from undug ground, so passes never stack into a pit.
  const centre = surfaceAt(world, r.x, r.z, r.idx);
  const width = widthOf(r), depth = r.depth;
  const bed = Math.min(centre, sampleFilled(t, r.x, r.z)) - depth;
  r.path.push({ x: r.x, z: r.z, water: centre - depth * 0.3, w: width, tick: world.tick });
  world.digs.push({ r, x: r.x, z: r.z, width, depth, bed });
}

function applyDigs(world) {
  const digs = world.digs.sort((a, b) => byId(a.r, b.r));
  world.digs = [];
  for (const d of digs) dig(world, d);
}

function dig(world, { r, x: px, z: pz, width, depth, bed }) {
  const t = world.terrain, n = t.size, cell = t.cell;
  const rad = width / 2, feather = cell * 0.6;
  const gx = (px / t.worldSize + 0.5) * (n - 1), gy = (pz / t.worldSize + 0.5) * (n - 1);
  const reach = Math.ceil((rad + feather) / cell);
  const cx = Math.round(gx), cy = Math.round(gy);
  for (let y = cy - reach; y <= cy + reach; y++) {
    if (y < 1 || y >= n - 1) continue;
    for (let x = cx - reach; x <= cx + reach; x++) {
      if (x < 1 || x >= n - 1) continue;
      const ddx = (x - gx) * cell, ddy = (y - gy) * cell;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d > rad + feather) continue;
      const k = y * n + x;
      const ground = t.filled[k];
      if (ground <= SEA_LEVEL) continue;
      const w = d <= rad ? 1 : 1 - (d - rad) / feather;
      const want = (ground - bed) * w; // carve down to the bed, less at the banks
      if (want > world.carve[k]) {
        world.carve[k] = Math.min(want, depth * 3);
        world.owner[k] = r.idx;
        world.dirty.push(k);
      }
      // Refresh the live-water clock where this river still owns the cell.
      if (world.owner[k] === r.idx && want > TUNE.contactDepth) world.dugAt[k] = world.tick;
    }
  }
}

function sampleFilled(t, wx, wz) {
  return t.filled[cellIndex(t, wx, wz)];
}

// Remaining downhill distance to the sea from every cell (static, ignores carving).
export function distanceToSea(t, downhill) {
  const n = t.size, dist = new Float32Array(n * n).fill(-1);
  const chain = [];
  for (let i = 0; i < n * n; i++) {
    let c = i;
    while (dist[c] < 0) {
      const d = downhill(t, c);
      if (d < 0) { dist[c] = 0; break; }
      chain.push(c);
      c = d;
    }
    while (chain.length) {
      const k = chain.pop();
      const d = downhill(t, k);
      const diag = d % n !== k % n && Math.floor(d / n) !== Math.floor(k / n);
      dist[k] = dist[d] + t.cell * (diag ? 1.4142135623730951 : 1);
    }
  }
  return dist;
}

// Canonical fingerprint of authoritative river state (positions rounded to cm).
export function riverFingerprint(world) {
  let h = 0x811c9dc5;
  const mix = (v) => { h = Math.imul(h ^ (v | 0), 0x01000193); };
  mix(world.tick);
  for (const r of [...world.rivers].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    mix(Math.round(r.x * 100)); mix(Math.round(r.z * 100)); mix(r.finishTick); mix(r.path.length); mix(Math.round(r.volume));
    mix(r.out ? r.out.tick : -1);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
