// River simulation. Authoritative, fixed-tick, shared by client and server.
// Rules: no transcendental Math; integer steering input; render never writes here.

import { SEA_LEVEL, downhill, findLakes, MinHeap, generateIsland } from './terrain.js';
import { stream } from './rng.js';

export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;

export const TUNE = {
  turnStep: 0.11, // radians per tick at full steer, at starting size
  minSpeed: 18, // m/s, water always creeps
  baseSpeed: 45, // m/s on level ground at starting size
  slopeSpeed: 1400, // extra m/s per unit downhill slope
  maxSpeed: 200,
  speedEase: 0.12, // share of the way to target speed per tick, at starting size
  climb: 1.5, // metres the head may sit above the lowest point it has reached
  pool: 0.3, // metres a blocked head's water rises per tick...
  pondMax: 3, // ...but only this far: water fills a dent, it doesn't climb a hill
  slideMin: 0.15, // heading share along the contour needed to slide past a slope
  width: 110, // channel width at starting size, metres
  depth: 7, // channel depth at starting size, metres
  maxWidth: 420,
  // Mass. Volume is in litres; size = (volume / start) ^ 1/4. More mass: more
  // momentum (slower to speed up, slow down and turn), faster flow, deeper cuts.
  startVolume: 1_000_000,
  trickle: 25, // litres gained per metre of trail: longer trails hold more water
  speedPerSize: 0.4, // speed multiplier gained per unit of size above 1
  // Lakes are reservoirs. Every river flowing into a lake adds its discharge;
  // every river that has passed through takes water out through its own outlet,
  // which erodes with the flow. A lake's level only falls when more flows out
  // than in, and a lake below full is a basin heads pool in until it refills.
  lakeBase: 120_000, // capacity of any lake, litres...
  lakePerCell: 9_000, // ...plus this per lake cell...
  lakeCellCap: 400, // ...counting at most this many cells
  discharge: 3000, // litres per tick a river delivers downstream, times size squared
  outletStart: 1, // metres an outlet is cut when a river leaves a lake
  outletK: 1500, // litres per tick an outlet carries per metre of erosion, at size 1
  erodeK: 0.0028, // metres of outlet erosion per 1000 L that flow through it, times size
  outletMax: 12, // metres
  lakeFloor: 0.15, // a lake can drain to this share once its deepest outlet is fully cut
  joinShare: 0.06, // share of a lake's water you take at once when you join it
  fullAt: 0.999, // a lake this full is level ground you flow across
  maxPoolTicks: 900, // guaranteed exit: after 45 s pooled, the basin tops up and spills
  trailErode: 0.04, // metres your whole channel deepens per 10 ticks, times size, for good
  trailPasses: 20, // ticks to sweep a whole trail once (a slice of it each tick)
  // Dry basins: a few lakes start empty and must be filled by the rivers that
  // run into them before anyone can flow across.
  basins: 5,
  basinMinCells: 15,
  basinMaxCells: 260,
  // The drop: every river falls for 30 s from high above the island, steering
  // (turn, and faster or slower) to choose where it lands. It lands on the
  // nearest cell of the start contour: every start is at the same elevation.
  dropTicks: 600,
  dropAlt: 6000, // metres above the ground at the start
  glideSpeed: 140, // m/s sideways while falling (x0.5 slowed, x1.5 hurried)
  zoneSlack: 300, // metres a falling drop may stray from the landing ring
  glideTurn: 0.1, // radians per tick while falling: a full circle in about 3 s
  startElevation: 0.75, // share of the highest peak
  startTolerance: 0.02,
  fairReach: 0.04, // starts sit within 4% of the same route length to the sea // +- share of the peak
  // Lava: a few flows down from the high ground. Water crossing lava boils off
  // and slows, and the lava it touches cools into a rock ridge.
  lavaFlows: 2,
  lavaLength: 70,
  steam: 0.006,
  steamFloor: 1.15,
  lavaSlow: 0.6,
  damHeight: 4,
  // Contact is a depth tug-of-war: the deeper water siphons the shallower.
  junctionK: 0.3, // share of a cut river's discharge that flows on into the river that cut it
  siphonRate: 0.012,
  siphonCap: 0.015,
  siphonDeadband: 0.05,
  floor: 0.4, // below this share of the starting volume a river dries up and is out
  contactDepth: 1,
  liveTicks: 300, // a drained river's channel stays live this long, then it's a dry bed
  graceTicks: 100,
  gracePerRiver: 2,
  spawnGap: 1200,
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
  const { label: lakeOf, lakes } = findLakes(terrain);
  const world = {
    terrain,
    dist: distanceToSea(terrain, downhill), // along the fill's downhill tree
    reach: descentDistance(terrain), // shortest route water can take (HUD, standings, bots)
    lakeOf, lakes,
    lakeCap: Float64Array.from(lakes, (l) => lakeGain(l)), // litres when full
    lakeVol: Float64Array.from(lakes, (l) => lakeGain(l)), // litres now
    lakeIn: new Float64Array(lakes.length), // litres per tick flowing in, last tick
    lakeOut: new Float64Array(lakes.length), // litres per tick flowing out, last tick
    lakeOutlet: lakeOutlets(terrain, lakeOf, lakes), // cell just past each lake's spill point
    events: [], // for presentation, see step()
    digs: [], // channel digs queued during a tick, applied together at its end
    junctions: new Map(), // 'from|to' -> { from, to, until }: a cut channel's water flowing on into the cutter
    carve: new Float32Array(n * n), owner: new Int32Array(n * n).fill(-1), dugAt: new Int32Array(n * n), tick: 0, rivers: [], dirty: [],
  };
  world.lava = new Uint8Array(n * n); // 1 where lava flows
  world.cooled = []; // cells that turned from lava to rock, for presentation
  world.rock = new Float32Array(n * n); // metres of cooled rock on top of the ground
  world.basins = makeBasins(world);
  makeLava(world);
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
  const spawn = dropZone(world);
  const cands = world.lakes.filter((l) => l.cells >= TUNE.basinMinCells && l.cells <= TUNE.basinMaxCells && world.lakeOutlet[l.id] >= 0);
  const picked = [];
  while (picked.length < TUNE.basins && cands.length) {
    const l = cands.splice(Math.floor(r() * cands.length), 1)[0];
    let nearSpawn = false;
    for (let k = 0; k < world.lakeOf.length && !nearSpawn; k++) if (world.lakeOf[k] === l.id && spawn.has(k)) nearSpawn = true;
    if (nearSpawn) continue;
    picked.push(l.id);
    world.lakeVol[l.id] = 0;
  }
  return picked;
}

// Lava flows: from a few high cells, down the fill's downhill tree, three
// cells wide, stopping before lakes and low ground. Seeded, so all agree.
export function makeLava(world) {
  const t = world.terrain, n = t.size;
  const r = stream(t.seed, 'lava');
  let peak = 0;
  for (let i = 0; i < n * n; i++) if (t.height[i] > peak) peak = t.height[i];
  const spawn = dropZone(world);
  for (let f = 0; f < TUNE.lavaFlows; f++) {
    let c = -1;
    for (let tries = 0; tries < 400 && c < 0; tries++) {
      const k = Math.floor(r() * n * n);
      if (t.height[k] > peak * 0.7 && world.lakeOf[k] < 0 && !spawn.has(k)) c = k;
    }
    for (let step = 0; c >= 0 && step < TUNE.lavaLength; step++) {
      if (world.lakeOf[c] >= 0 || t.filled[c] < 150) break;
      const cx = c % n, cy = (c - cx) / n;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 1 || y < 1 || x >= n - 1 || y >= n - 1) continue;
        const k = y * n + x;
        if (world.lakeOf[k] < 0 && !spawn.has(k)) world.lava[k] = 1;
      }
      c = downhill(t, c);
    }
  }
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
  const cv = (k) => (self >= 0 && o[k] >= 0 && (o[k] === self || isLive(world, k)) ? 0 : c[k]);
  const rk = world.rock;
  const a = f[i] + rk[i] - cv(i), b = f[i + 1] + rk[i + 1] - cv(i + 1), d = f[i + n] + rk[i + n] - cv(i + n), e = f[i + n + 1] + rk[i + n + 1] - cv(i + n + 1);
  return (a + (b - a) * fx) + ((d + (e - d) * fx) - (a + (b - a) * fx)) * fy;
}

// Start contour: every start sits at the same elevation (a share of the
// highest peak, within a small tolerance), on open ground. Cached per world.
export function spawnBand(world) {
  if (world.band) return world.band;
  const t = world.terrain, n = t.size, h = t.height;
  let top = 0;
  for (let i = 1; i < n * n; i++) if (h[i] > h[top]) top = i;
  const peak = h[top];
  const target = peak * TUNE.startElevation;
  let tol = peak * TUNE.startTolerance, cells;
  do {
    // The highest summit's own slopes: everything connected to the top that
    // stays above the start contour. Starts ring the summit, nowhere else.
    const near = new Uint8Array(n * n), queue = [top];
    near[top] = 1;
    cells = [];
    while (queue.length) {
      const c = queue.pop(), cx = c % n, cy = (c - cx) / n;
      if (Math.abs(h[c] - target) <= tol && t.filled[c] - h[c] < 0.5) cells.push(c);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 8 || y < 8 || x >= n - 8 || y >= n - 8) continue;
        const k = y * n + x;
        if (!near[k] && h[k] >= target - tol) { near[k] = 1; queue.push(k); }
      }
    }
    tol *= 1.5;
  } while (cells.length < 200 && tol < peak * 0.2);
  cells.sort((a, b) => a - b);
  // Fair paths: of those, keep the ones as far from the sea as the median, by
  // the shortest route water can take, widening until most of the ring is in.
  const reach = world.reach;
  const sorted = cells.map((c) => reach[c]).sort((a, b) => a - b);
  const mid = sorted[sorted.length >> 1];
  let fair = [];
  for (let band = TUNE.fairReach; fair.length < cells.length * 0.6 && band < 0.5; band *= 1.25) {
    fair = cells.filter((c) => Math.abs(reach[c] - mid) <= mid * band);
  }
  world.band = { target, cells: fair, wide: fair, reach: mid, top };
  return world.band;
}

// How many rivers the start ring can seat at least spawnGap apart (greedy, in
// index order). A map that can't seat everyone gets rerolled.
export function seats(world) {
  const t = world.terrain, n = t.size, gap2 = TUNE.spawnGap * TUNE.spawnGap;
  const placed = [];
  for (const c of spawnBand(world).cells) {
    const x = ((c % n) / (n - 1) - 0.5) * t.worldSize, z = (Math.floor(c / n) / (n - 1) - 0.5) * t.worldSize;
    if (placed.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 >= gap2)) placed.push({ x, z });
  }
  return placed.length;
}

// The island for a race: from `seed`, the next seed and the next until the
// summit ring seats every river. Returns the seed used and its fresh world.
export function rollIsland(seed, rivers, tries = 40) {
  let world;
  for (let i = 0; i < tries; i++, seed = (seed % 1_000_000) + 1) {
    world = createWorld(generateIsland(seed));
    if (seats(world) >= rivers) break;
  }
  return { seed: world.terrain.seed, world };
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
    const cells = band.cells;
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
    lakes: 0, // lakes joined
    inflow: 0, // litres per tick arriving from lakes through your outlets
    via: new Map(), // lake -> { cell, e (metres eroded), born } for lakes you flowed through
    inLake: -1, // lake the head is in now
    pooled: -1, // lake the head is pooled in (below full), or -1
    pooledTicks: 0,
    low: Infinity, // lowest surface reached; water can't climb far above it
    ponded: 0, // metres the local pool has risen above the ground
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
    // Start the fall heading toward the island's middle.
    const cl = Math.sqrt(at.x * at.x + at.z * at.z) || 1;
    river.dx = -at.x / cl; river.dz = -at.z / cl;
  }
  return river;
}

// While falling: turn, and hurry (+1) or slow (-1) the glide, anywhere over the map.
function glide(world, r, steer, fwd) {
  if (steer) {
    const a = TUNE.glideTurn * -steer;
    const dx = r.dx + r.dz * a, dz = r.dz - r.dx * a;
    r.dx = dx; r.dz = dz;
    normalize(r);
  }
  const v = TUNE.glideSpeed * (1 + 0.5 * fwd);
  const p = keepInZone(world, r.x + r.dx * v * DT, r.z + r.dz * v * DT);
  r.x = p.x;
  r.z = p.z;
  r.dropping--;
  r.alt = (TUNE.dropAlt * r.dropping) / TUNE.dropTicks;
  if (r.dropping <= 0) land(world, r);
}

// A falling drop stays over the landing ring: never more than zoneSlack from
// its start ground, so every player lands on equal ground and touchdown is
// right where the drop is.
export function keepInZone(world, x, z) {
  const t = world.terrain, n = t.size, k = landingCell(world, x, z);
  const cx = ((k % n) / (n - 1) - 0.5) * t.worldSize, cz = (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize;
  const dx = x - cx, dz = z - cz, d = Math.sqrt(dx * dx + dz * dz);
  if (d <= TUNE.zoneSlack) return { x, z };
  return { x: cx + (dx * TUNE.zoneSlack) / d, z: cz + (dz * TUNE.zoneSlack) / d };
}

export function dropZone(world) {
  if (!world.dropZone) world.dropZone = new Set(spawnBand(world).cells);
  return world.dropZone;
}

// Where a drop above (x, z) touches down: the nearest start-contour cell.
// Searched in square rings, ties broken by index, so every client agrees.
export function landingCell(world, x, z) {
  const t = world.terrain, n = t.size, zone = dropZone(world);
  const c = cellIndex(t, x, z);
  if (zone.has(c)) return c;
  const cx = c % n, cy = (c - cx) / n;
  let best = -1, bestD = Infinity;
  for (let rad = 1; rad < n; rad++) {
    // Just the ring's edge: top and bottom rows, then the two side columns.
    for (let i = 0; i < 8 * rad; i++) {
      const side = i < 2 * (2 * rad + 1) ? (i & 1) : 2 + (i & 1);
      const j = side < 2 ? (i >> 1) - rad : ((i - 2 * (2 * rad + 1)) >> 1) - rad + 1;
      const dx = side < 2 ? j : side === 2 ? -rad : rad;
      const dy = side < 2 ? (side === 0 ? -rad : rad) : j;
      const x2 = cx + dx, y2 = cy + dy;
      if (x2 < 0 || y2 < 0 || x2 >= n || y2 >= n) continue;
      const k = y2 * n + x2;
      if (!zone.has(k)) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD || (d === bestD && k < best)) { bestD = d; best = k; }
    }
    // A cell found in ring rad can only be beaten within ring ceil(rad * sqrt 2).
    if (best >= 0 && rad * rad >= bestD) break;
  }
  return best >= 0 ? best : c;
}

// Touchdown on the start contour: the river starts here, its grace from now.
function land(world, r) {
  const t = world.terrain, n = t.size;
  const k = landingCell(world, r.x, r.z);
  r.x = ((k % n) / (n - 1) - 0.5) * t.worldSize;
  r.z = (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize;
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

// Inputs: Map<id, steer> with steer -1 | 0 | 1, or Map<id, { s, f }> where f
// (-1 | 0 | 1) slows or hurries a falling drop.
function readInput(v) {
  if (v && typeof v === 'object') return { s: clampUnit(v.s), f: clampUnit(v.f) };
  return { s: clampUnit(v), f: 0 };
}
const clampUnit = (v) => Math.max(-1, Math.min(1, v | 0));

// One authoritative tick. Phases, so the result never depends on the order
// rivers were added:
// 1. every racing river moves against last tick's surface;
// 2. contacts resolve (deeper siphons shallower), judged on last tick's channels;
// 3. water moves between rivers and lakes;
// 4. channel digs and erosion are applied, in id order.
export function step(world, inputs) {
  for (const r of world.rivers) {
    if (!isRacing(r)) continue;
    moveRiver(world, r, readInput(inputs?.get(r.id)));
  }
  resolveContacts(world);
  hydrology(world);
  erodeTrails(world);
  applyDigs(world);
  world.tick++;
}

// No auto-steering: only the player turns the head. Gravity sets the speed
// (downhill along the heading is fast, across a slope slow); water can't go
// uphill, so a heading into a rise slides along the contour if it can, or the
// water ponds a little and then waits for the player to turn.
function moveRiver(world, r, { s: steer, f: fwd }) {
  if (r.dropping) return glide(world, r, steer, fwd);
  if (steer) {
    // Turn by adding a sideways component, then renormalising (angle = atan(a)).
    // Heavier rivers turn slower. Left of heading (dx, dz) is (dz, -dx).
    const a = (TUNE.turnStep / r.size) * -steer;
    const dx = r.dx + r.dz * a, dz = r.dz - r.dx * a;
    r.dx = dx; r.dz = dz;
    normalize(r);
  }
  if (r.pooled >= 0) {
    // Pooled in a lake below full: the water rises; the head waits.
    r.pooledTicks++;
    r.speed = 0;
    r.depth = depthOf(r);
    return;
  }
  const me = r.idx;
  const here = surfaceAt(world, r.x, r.z, me);
  const g = gradient(world, r.x, r.z, me);
  const gl = Math.sqrt(g.x * g.x + g.z * g.z);
  if (here < r.low) { r.low = here; r.ponded = 0; }

  const mass = 1 + TUNE.speedPerSize * (r.size - 1);
  const along = -(g.x * r.dx + g.z * r.dz); // downhill slope along the heading
  const target = Math.max(TUNE.minSpeed, Math.min(TUNE.maxSpeed * mass, TUNE.baseSpeed * mass + TUNE.slopeSpeed * along));
  r.speed += (target - r.speed) * (TUNE.speedEase / r.size); // momentum: heavy water changes speed slowly
  r.depth = depthOf(r);

  const ceiling = r.low + TUNE.climb;
  let mx = r.dx, mz = r.dz, v = r.speed;
  let nx = r.x + mx * v * DT, nz = r.z + mz * v * DT;
  if (surfaceAt(world, nx, nz, me) > ceiling && gl > 1e-6) {
    // Slide along the contour, on the side the heading points to.
    const ux = g.x / gl, uz = g.z / gl, d = r.dx * ux + r.dz * uz;
    const sx = r.dx - d * ux, sz = r.dz - d * uz, sl = Math.sqrt(sx * sx + sz * sz);
    if (sl > TUNE.slideMin) {
      mx = sx / sl; mz = sz / sl; v = r.speed * sl;
      nx = r.x + mx * v * DT; nz = r.z + mz * v * DT;
    }
  }
  if (surfaceAt(world, nx, nz, me) > ceiling) {
    // Blocked head-on: the water finds its way around small lumps at a creep,
    // down the slope right here (the heading stays the player's). If even that
    // rises, it ponds a little against the rise and slows.
    const h = 5;
    const fx = surfaceAt(world, r.x - h, r.z, me) - surfaceAt(world, r.x + h, r.z, me);
    const fz = surfaceAt(world, r.x, r.z - h, me) - surfaceAt(world, r.x, r.z + h, me);
    const fl = Math.sqrt(fx * fx + fz * fz);
    const cx = fl > 1e-6 ? r.x + (fx / fl) * TUNE.minSpeed * DT : r.x;
    const cz = fl > 1e-6 ? r.z + (fz / fl) * TUNE.minSpeed * DT : r.z;
    if (fl > 1e-6 && surfaceAt(world, cx, cz, me) <= ceiling) {
      nx = cx; nz = cz;
      r.speed = Math.min(r.speed, TUNE.minSpeed);
    } else {
      nx = r.x; nz = r.z;
      if (r.ponded < TUNE.pondMax) { r.low += TUNE.pool; r.ponded += TUNE.pool; }
      r.speed *= 0.8;
    }
  }
  moveTo(world, r, nx, nz);
  afterMove(world, r);
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// Bigger first; equal volumes fall back to id so ties never depend on order.
const biggerFirst = (a, b) => b.volume - a.volume || byId(a, b);

function resolveContacts(world) {
  const grace = TUNE.graceTicks + TUNE.gracePerRiver * world.rivers.length;
  const rs = world.rivers.filter((r) => isRacing(r) && !r.dropping && world.tick - r.born >= grace);
  if (rs.length < 2) return;
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
  const cuts = []; // heads in a rival's live channel: [a, aDepth, owner, channelDepth]
  for (const a of rs) {
    // Head in a rival's live channel: the channel's water is as deep as it was dug.
    const k = cellIndex(world.terrain, a.x, a.z);
    const o = owner[k];
    if (o >= 0 && o !== a.idx && live.has(o) && carve[k] > TUNE.contactDepth && isLive(world, k)) {
      cuts.push([a, a.depth, world.rivers[o], carve[k]]);
    }
    // Heads touching.
    for (const b of rs) {
      if (b.idx <= a.idx) continue;
      const reach = (widthOf(a) + widthOf(b)) / 2;
      const dx = a.x - b.x, dz = a.z - b.z;
      if (dx * dx + dz * dz < reach * reach) add(a, a.depth, b, b.depth, 'head');
    }
  }
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
  // A cut through a rival's channel joins the two: water runs on from the
  // shallower into the deeper for as long as the cut stays live.
  for (const [a, da, b, db] of cuts) {
    const [win, dw, lose, dl] = da >= db ? [a, da, b, db] : [b, db, a, da];
    if ((dw - dl) / Math.max(dl, 0.5) < TUNE.siphonDeadband) continue;
    const jk = `${lose.id}|${win.id}`;
    if (!world.junctions.has(jk)) world.events.push({ type: 'junction', from: lose.idx, to: win.idx, tick: world.tick });
    world.junctions.set(jk, { from: lose, to: win, until: world.tick + TUNE.liveTicks });
  }
  for (const jk of [...world.junctions.keys()].sort()) {
    const j = world.junctions.get(jk);
    if (world.tick >= j.until || !start.has(j.from) || !start.has(j.to)) { world.junctions.delete(jk); continue; }
    const amount = dischargeOf(j.from) * TUNE.junctionK;
    flows.push({ win: j.to, lose: j.from, amount, how: 'junction' });
    lost.set(j.from, (lost.get(j.from) ?? 0) + amount);
  }
  if (!flows.length) return;
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

// Water between rivers and lakes, once per tick:
// - every river delivers its discharge (a share of its volume) into the lake its
//   head is in and into every lake it has flowed through;
// - each lake pours out through the outlets of the rivers that left it, each
//   outlet carrying more the deeper it has eroded and the heavier its river;
// - a full lake passes on at least what comes in; it only drains when its
//   outlets carry more than its inflow, and never below what its deepest
//   outlet has cut down to; while a head is pooled in it, nothing leaves;
// - what flows through an outlet erodes it, so more flow means more erosion,
//   more water for that river, more mass, faster, deeper.
function hydrology(world) {
  const L = world.lakes.length, cap = world.lakeCap, vol = world.lakeVol;
  const inflow = new Float64Array(L), pooledIn = new Uint8Array(L);
  const outlets = []; // [lake, river, outlet]
  const flowing = world.rivers.filter((r) => isRacing(r) && !r.dropping).sort(byId);
  for (const r of flowing) {
    r.inflow = 0;
    const q = dischargeOf(r);
    if (r.inLake >= 0) inflow[r.inLake] += q;
    if (r.pooled >= 0) pooledIn[r.pooled] = 1;
    for (const [lake, o] of r.via) {
      if (lake !== r.inLake) inflow[lake] += q;
      outlets.push([lake, r, o]);
    }
  }
  const capOf = (r, o) => TUNE.outletK * o.e * r.size;
  const want = new Float64Array(L), deepest = new Float64Array(L);
  for (const [lake, r, o] of outlets) {
    want[lake] += capOf(r, o);
    if (o.e > deepest[lake]) deepest[lake] = o.e;
  }
  const shares = new Map();
  for (let lake = 0; lake < L; lake++) {
    world.lakeIn[lake] = inflow[lake];
    world.lakeOut[lake] = 0;
    if (!inflow[lake] && !want[lake]) continue;
    vol[lake] += inflow[lake];
    let out = 0;
    if (!pooledIn[lake] && want[lake] > 0) {
      const floor = cap[lake] * Math.max(TUNE.lakeFloor, 1 - deepest[lake] / TUNE.outletMax);
      const over = Math.max(0, vol[lake] - cap[lake]);
      // Spill what's over the brim, and up to what the outlets can carry above their sill.
      out = Math.max(over, Math.min(want[lake], Math.max(0, vol[lake] - floor)));
    }
    vol[lake] -= out;
    if (vol[lake] > cap[lake]) vol[lake] = cap[lake]; // brim-full with nowhere to go: the rest runs off
    world.lakeOut[lake] = out;
    if (out > 0) shares.set(lake, out / want[lake]);
  }
  for (const [lake, r, o] of outlets) {
    const share = shares.get(lake);
    if (!share) continue;
    const q = capOf(r, o) * share;
    grow(r, q);
    r.inflow += q;
    o.e = Math.min(TUNE.outletMax, o.e + (TUNE.erodeK * q * r.size) / 1000);
  }
  // Pooled heads go free once their lake is full again (or after the guaranteed wait).
  for (const r of flowing) {
    if (r.pooled < 0) continue;
    const lake = r.pooled;
    if (vol[lake] >= cap[lake] * TUNE.fullAt || r.pooledTicks >= TUNE.maxPoolTicks) {
      vol[lake] = Math.max(vol[lake], cap[lake]);
      r.pooled = -1;
      r.pooledTicks = 0;
      r.low = Infinity;
      world.events.push({ type: 'spill', lake, river: r.idx, tick: world.tick });
    }
  }
}

// Erosion is forever: every river's whole trail keeps deepening as long as it
// pours, faster for heavier rivers, never below sea level. A trail is swept a
// slice per tick, all of it every trailPasses ticks. Outlets are recut to how
// far they have eroded. Cells are marked for redraw every quarter metre.
function erodeTrails(world) {
  const t = world.terrain, n = t.size, ticks = TUNE.trailPasses;
  const phase = world.tick % ticks;
  // Each cell erodes once per sweep, however many path points cross it.
  if (!world.erodedAt) world.erodedAt = new Int32Array(n * n);
  const sweep = Math.floor(world.tick / ticks) + 1;
  for (const r of world.rivers.filter((o) => !o.out && !o.dropping).sort(byId)) {
    const add = (TUNE.trailErode * r.size * ticks) / 10;
    const per = Math.ceil(r.path.length / ticks);
    const end = Math.min(r.path.length, (phase + 1) * per);
    for (let i = phase * per; i < end; i++) {
      const p = r.path[i];
      const c = cellIndex(t, p.x, p.z), cx = c % n, cy = (c - cx) / n;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const k = (cy + dy) * n + cx + dx;
        if (k < 0 || k >= n * n || world.owner[k] !== r.idx || t.filled[k] <= SEA_LEVEL || world.erodedAt[k] === sweep) continue;
        world.erodedAt[k] = sweep;
        const was = world.carve[k];
        // Deep canyons cut slower, but never stop.
        const v = Math.min(t.height[k] + world.rock[k] - SEA_LEVEL - 0.5, was + add / (1 + was / (TUNE.depth * 3)));
        if (v <= was) continue;
        world.carve[k] = v;
        if (Math.floor(v * 4) !== Math.floor(was * 4)) world.dirty.push(k);
      }
    }
    if (phase || !isRacing(r)) continue;
    for (const [, o] of r.via) {
      const x = ((o.cell % n) / (n - 1) - 0.5) * t.worldSize, z = (Math.floor(o.cell / n) / (n - 1) - 0.5) * t.worldSize;
      world.digs.push({ r, x, z, width: widthOf(r), depth: o.e, bed: t.filled[o.cell] - o.e });
    }
  }
}

// Litres per tick a river delivers into lakes downstream of it: heavier rivers
// carry more (size squared), so they fill basins faster.
export function dischargeOf(r) {
  return TUNE.discharge * r.size * r.size;
}

export function isLive(world, k) {
  // A trail is live for as long as its river pours (finished ones included);
  // once a river is drained out its channel dries after liveTicks.
  const o = world.owner[k];
  if (o < 0) return false;
  const r = world.rivers[o];
  return !r.out || world.tick - Math.max(world.dugAt[k], r.out.tick) < TUNE.liveTicks;
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
  const left = (r) => world.reach[cellIndex(world.terrain, r.x, r.z)];
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

function joinLake(world, r, lake, cell) {
  if (r.via.has(lake)) return; // already has an outlet from this lake
  r.via.set(lake, { cell, e: TUNE.outletStart, born: world.tick });
  r.lakes++;
  // Joining a lake adds its water to yours at once, then keeps flowing.
  // A full lake's surge comes off the brim: it doesn't lower the lake (a lake
  // only falls when more flows out than in).
  const take = world.lakeVol[lake] * TUNE.joinShare;
  grow(r, take);
  world.events.push({ type: 'join', lake, river: r.idx, gain: take, tick: world.tick });
}

function grow(r, litres) {
  r.volume += litres;
  r.size = sizeOf(r.volume);
}

function afterMove(world, r) {
  const here = cellIndex(world.terrain, r.x, r.z);
  if (world.lava[here]) {
    // Boiling off: water and speed, but lava alone never knocks a river out.
    const floor = TUNE.floor * TUNE.startVolume * TUNE.steamFloor;
    const boil = Math.max(0, Math.min(r.volume * TUNE.steam, r.volume - floor));
    if (boil > 0) grow(r, -boil);
    r.speed *= TUNE.lavaSlow;
    world.events.push({ type: 'steam', river: r.idx, amount: boil, tick: world.tick });
  }
  // Lakes: entering one pours your water in (and pools you if it isn't full);
  // leaving one cuts your outlet from it, and its water starts flowing to you.
  const lake = world.lakeOf[here];
  if (lake !== r.inLake) {
    if (r.inLake >= 0) joinLake(world, r, r.inLake, here);
    r.inLake = lake;
    // Back in a lake you already drain: you run through it to your own outlet.
    if (lake >= 0 && !r.via.has(lake) && world.lakeVol[lake] < world.lakeCap[lake] * TUNE.fullAt) {
      r.pooled = lake;
      r.pooledTicks = 0;
      world.events.push({ type: 'pool', lake, river: r.idx, tick: world.tick });
    }
  }
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
      if (world.lava[k]) {
        // Water meets lava: it cools into rock instead of being dug.
        world.lava[k] = 0;
        world.rock[k] = Math.max(world.rock[k], TUNE.damHeight);
        world.dirty.push(k);
        world.cooled.push(k);
        continue;
      }
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

// Shortest distance from each cell to the sea along any route water can flow
// (each step at most TUNE.climb uphill on the filled surface). A steered river
// can cut across the fill tree, so fair spawns must be measured by this.
export function descentDistance(t) {
  const n = t.size, f = t.filled;
  const dist = new Float64Array(n * n).fill(Infinity);
  const heap = new MinHeap(n * 4);
  for (let i = 0; i < n * n; i++) if (f[i] <= SEA_LEVEL) { dist[i] = 0; heap.push(0, i); }
  while (heap.size) {
    const a = heap.pop(), da = dist[a];
    const ax = a % n, ay = (a - ax) / n;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = ax + dx, y = ay + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const b = y * n + x;
      if (f[b] <= SEA_LEVEL || f[a] > f[b] + TUNE.climb) continue; // water can't flow b -> a
      const d = da + t.cell * (dx && dy ? 1.4142135623730951 : 1);
      if (d < dist[b]) { dist[b] = d; heap.push(d, b); }
    }
  }
  return Float32Array.from(dist, (d) => (Number.isFinite(d) ? d : 0));
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
    mix(r.out ? r.out.tick : -1); mix(r.pooled); mix(r.via.size);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
