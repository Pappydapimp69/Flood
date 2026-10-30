// River simulation. Authoritative, fixed-tick, shared by client and server.
// Rules: no transcendental Math; integer steering input; render never writes here.

import { SEA_LEVEL, downhill, findLakes, MinHeap, generateIsland } from './terrain.js';
import { stream } from './rng.js';
import { plantForest } from './forest.js';

export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;

export const TUNE = {
  turnStep: 0.06, // radians per tick at full steer, at starting size
  minSpeed: 18, // m/s, water always creeps
  baseSpeed: 45, // m/s on level ground at starting size
  slopeSpeed: 1400, // extra m/s per unit downhill slope
  maxSpeed: 200,
  speedEase: 0.12, // share of the way to target speed per tick, at starting size
  climb: 1.5, // metres any head can rise over before it is blocked, before its head height
  headPerSize: 2, // metres the water stands at the head per unit of size: what it can push over
  headLook: 150,
  climbSpeed: 40, // m/s: below this a head aimed uphill can't run up the slope // metres ahead a rise is judged against the head // metres the head may sit above the lowest point it has reached
  bankCut: 0.5, // metres a head on a lake cuts into the bank it's pushing on, per tick, times size
  cutMax: 40, // metres above the lake, times size: the highest rim a head can cut through
  cutTicks: 120, // a bank still not cut through after 6 s: make for the lake's lowest exit
  pool: 0.15, // metres a stuck head's water rises per tick, times size: the hollow fills, then spills
  slideMin: 0.15,
  flatSlope: 0.004, // below this the ground counts as flat: follow the fill's route out
  fallSlope: 0.04, // slope (m per m) at which the fall line pulls the water at full strength
  fallDrift: 0.15, // aimed downhill or across: how much the slope pulls the water down
  fallUphill: 0.6, // aimed uphill: how much it pulls the water down once the uphill part is gone // heading share along the contour needed to slide past a slope
  width: 110, // channel width at starting size, metres
  depth: 7, // channel depth at starting size, metres
  maxWidth: 420,
  // Mass. Volume is in litres; size = (volume / start) ^ 1/4. More mass: more
  // momentum (slower to speed up, slow down and turn), faster flow, deeper cuts.
  startVolume: 1_000_000,
  trickle: 25, // litres gained per metre of trail: longer trails hold more water
  speedPerSize: 1, // speed multiplier gained per unit of size above 1: twice the size, twice the speed
  // Lakes are reservoirs. They hold still until water flows in: every river
  // pouring in raises the level (its own volume holds while its head is in).
  // A river leaving cuts an outlet as deep as its head; water over that lip
  // drains out to it (weir law, head^1.5, times outlet width) and erodes the
  // outlet deeper, slower as it deepens. Above its rim a lake spills into an
  // ownerless channel that dries up once the level drops back.
  lakeBase: 120_000, // capacity of any lake, litres...
  lakePerCell: 9_000, // ...plus this per lake cell...
  lakeCellCap: 400, // ...counting at most this many cells
  lakeStart: 0.95, // every lake starts this full
  discharge: 3000, // litres per tick a river delivers downstream, times size squared
  outletK: 3000, // litres per tick an outlet carries at 1 m of water over its lip, starting width
  erodeK: 0.002, // metres an outlet erodes per tick, per metre of water over its lip, times the river's size
  outletMax: 40, // metres: most water over a lip that counts
  spillK: 4000, // litres per tick a lake spills at 1 m over its rim
  spillDepth: 2, // metres a spill cuts its channel (it never erodes)
  spillWidth: 50, // metres
  spillCells: 160, // longest spill channel, cells
  shallowWater: 0.3, // metres of standing water that count as under water (no digging)
  levelGlide: 0.997, // on level water or flats, speed fades only this much per tick: momentum carries
  joinShare: 0, // nothing taken at once on joining: only what flows out is added
  fullAt: 0.999, // a lake this full is level ground you flow across
  maxPoolTicks: 200, // guaranteed exit: after 10 s pooled, the basin tops up and spills
  trailErode: 0.0004, // metres a channel tile erodes per tick, per metre of water over it, times size...
  slopeErode: 0.04, // ...and once more for every this much slope (steep ground cuts canyons)
  trailPasses: 20, // ticks between outlet recuts
  headSpared: 4, // path points nearest the head that pulses don't erode
  stuckNet: 4, // metres: moved less than this in stuckTicks, it's stuck...
  stuckTicks: 6, // ...(0.3 s)...
  stuckWear: 0.5, // ...and wears the ground the way it's pushing down this many metres a tick, times size...
  stuckWearCells: 3, // ...this many cells out along its heading
  stuckWearMax: 40, // metres the ground can be worn down
  massEase: 0.04, // share of the way a river's momentum moves to its new size each tick
  stallTicks: 20, stallMin: 30, stallNet: 0.35, // moved over 30 m in 1 s but under 35% of it net: going nowhere
  routeDrop: 1.5, // metres a head following the fill route must fall before it goes back to its heading // path points nearest the head that don't erode // ticks to sweep a whole trail once (a slice of it each tick)
  // Dry basins: a few lakes start empty and must be filled by the rivers that
  // run into them before anyone can flow across.
  basins: 0, // no dry basins: every lake on the map is full
  basinMinCells: 15,
  basinMaxCells: 260,
  // The drop: every river falls for 30 s from high above the island, steering
  // (turn, and faster or slower) to choose where it lands. It lands on the
  // nearest cell of the start contour: every start is at the same elevation.
  dropTicks: 600,
  dropAlt: 6000, // metres above the ground at the start
  glideSpeed: 140, // m/s sideways while falling (x0.5 slowed, x1.5 hurried)
  settleTicks: 60, // the last 3 s of a fall glide onto the touchdown spot
  zoneSlack: 300, // metres a falling drop may stray from the landing ring
  glideTurn: 0.1, // radians per tick while falling: a full circle in about 3 s
  startElevation: 0.91, // starts ring each summit cone this far up its peak
  startTolerance: 0.006, // starts within ±0.6% of the peak's height of each other
  fairReach: 0.025, // and within ±2.5% of the same route length to the sea // +- share of the peak
  // Lava: a few flows down from the high ground. Water crossing lava boils off
  // and slows, and the lava it touches cools into a rock ridge.
  lavaFlows: 2,
  lavaLength: 70,
  steam: 0.006,
  steamFloor: 1.15,
  lavaSlow: 0.6,
  damHeight: 4,
  // Trees: what a river must be to knock a stand flat, and how tall a stand
  // stands to one that can't.
  treeBreak: 1.3,
  treeHeight: 14,
  // The heat front: from heatStart ticks (counted from the start of the drop)
  // a heat wave rolls down the mountain at heatSpeed m/s. It never touches a
  // river: the lakes behind it slowly dry out.
  heatStart: 600 + 20 * 50,
  heatSpeed: 155,
  heatEvery: 60, // every 3 s...
  heatLake: 40_000, // ...each lake behind the front loses this many litres (inflow still fills it)
  // Pulses: a river's water comes down its channel in waves. Every
  // pulseEvery ticks (more for bigger rivers) a pulse leaves the source with
  // the water gathered since the last; it runs down the channel at pulseSpeed
  // times the river's speed, eroding every stretch it passes, filling any low
  // lake on the way and losing a share wherever a rival has cut in, and the
  // river grows by what reaches its head.
  pulseEvery: [[3_000_000, 20], [8_000_000, 40], [Infinity, 60]], // [below this volume, ticks]
  pulseSpeed: 3,
  surge: 1.2, // a pulse reaching the head adds up to this many times base speed...
  surgeShare: 0.03, // ...the full surge once it brings this share of the river's volume...
  surgeCap: 1.35, // ...up to this many times its usual top speed
  surgeLift: 1.5, // metres a head running at base speed can carry up a rise (grows with speed squared)...
  surgeLiftMax: 25, // ...up to this
  // Storms: every stormEvery ticks from stormStart, a storm blows in from one
  // side of the island ahead of the pack and sweeps across to the other,
  // raining stormRain litres per tick into every river head under it and
  // filling every lake it passes over.
  stormStart: 600 + 20 * 40,
  stormEvery: 20 * 35,
  stormRadius: 1300,
  stormRain: 9000,
  stormLakeRain: 15, // litres per tick per lake cell for a lake under a storm
  stormSpan: 9000, // metres either side of the slope's centre line a storm starts and ends
  stormSpeed: [100, 150], // m/s a storm sweeps across the island...
  stormDrift: [15, 40], // ...while drifting this fast down the slope
  // Contact is a depth tug-of-war: the deeper water siphons the shallower.
  siphonRate: 0.012,
  siphonCap: 0.015,
  siphonDeadband: 0.05,
  floor: 0.4, // below this share of the starting volume a river dries up and is out
  contactDepth: 1,
  liveTicks: 300, // a drained river's channel stays live this long, then it's a dry bed
  graceTicks: 100,
  gracePerRiver: 2,
  spawnGap: 600,
};

// Size from volume without transcendental Math: two square roots.
// Size is the cube root of relative volume, as for real water: eight times the
// water is twice the size. Newton's method from sqrt, a fixed number of steps,
// so every machine gets the same bits (no cbrt/pow).
export function sizeOf(volume) {
  const v = Math.max(1e-9, volume / TUNE.startVolume);
  let x = v > 1 ? Math.sqrt(v) : 1;
  for (let i = 0; i < 12; i++) x = (2 * x + v / (x * x)) / 3;
  return x;
}

export function lakeGain(lake) {
  return TUNE.lakeBase + TUNE.lakePerCell * Math.min(lake.cells, TUNE.lakeCellCap);
}

// The game surface: filled terrain minus every carved channel.
export function createWorld(terrain, { forest = true } = {}) {
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
    lakeVol: Float64Array.from(lakes, (l) => lakeGain(l) * TUNE.lakeStart), // litres now
    lakeFlow: new Float64Array(lakes.length), // litres of rivers' water poured in and not yet out again
    lakePending: new Float64Array(lakes.length), // litres arriving next tick (outlets and spills into lakes)
    spills: new Map(), // lake -> { path: [cells], flow, on }: overflow over the rim, owned by nobody
    lakeIn: new Float64Array(lakes.length), // litres per tick flowing in, last tick
    lakeOut: new Float64Array(lakes.length), // litres per tick flowing out, last tick
    lakeOutlet: lakeOutlets(terrain, lakeOf, lakes), // cell just past each lake's spill point
    ...lakeLevels(terrain, lakeOf, lakes), // lakeBrim, lakeBed: surface when full, lowest point
    events: [], // for presentation, see step()
    digs: [], // channel digs queued during a tick, applied together at its end
    storms: [], // { id, x, z, vx, vz, radius, until }: storms sweeping across the island
    junctions: new Map(), // 'from|to' -> { from, to, until }: a cut channel's water flowing on into the cutter
    carve: new Float32Array(n * n), owner: new Int32Array(n * n).fill(-1), dugAt: new Int32Array(n * n), tick: 0, rivers: [], dirty: [],
  };
  world.lava = new Uint8Array(n * n); // 1 where lava flows
  world.cooled = []; // cells that turned from lava to rock, for presentation
  world.rock = new Float32Array(n * n); // metres of cooled rock on top of the ground
  world.basins = makeBasins(world);
  makeLava(world);
  if (forest) addForest(world);
  return world;
}

// The forest, planted once the island is settled (rerolls skip it).
export function addForest(world) {
  const band = spawnBand(world);
  ({ trees: world.trees, round: world.roundReach } = plantForest(world, band.ring, band.cells, TUNE.climb));
  world.felled = []; // cells whose trees a river knocked down, for presentation
  world.treeRock = Float32Array.from(world.rock, (v, k) => v + (world.trees[k] ? TUNE.treeHeight : 0)); // the ground as a small river feels it
  return world;
}

// Surface seen by river `self` (-1 = everyone's channels, for rendering).
// Each lake's surface when full (its brim, the fill level) and its lowest bed
// point. In between, the level is taken as linear in the water it holds.
function lakeLevels(t, lakeOf, lakes) {
  const lakeBrim = new Float64Array(lakes.length).fill(Infinity), lakeBed = new Float64Array(lakes.length).fill(Infinity);
  for (let k = 0; k < lakeOf.length; k++) {
    const l = lakeOf[k];
    if (l < 0) continue;
    if (t.filled[k] < lakeBrim[l]) lakeBrim[l] = t.filled[k];
    if (t.height[k] < lakeBed[l]) lakeBed[l] = t.height[k];
  }
  return { lakeBrim, lakeBed };
}

// Under standing water: a lake, or the shallow fringe around one (or any filled
// hollow) under the lake-depth threshold. Rivers don't dig or erode there; only
// the dry banks do.
export function underWater(world, k) {
  const t = world.terrain;
  return world.lakeOf[k] >= 0 || t.filled[k] - t.height[k] > TUNE.shallowWater;
}

// Water surface: bed when empty, rim when full, above the rim past full.
export function lakeLevel(world, lake) {
  return world.lakeBed[lake] + lakeSpan(world, lake) * (world.lakeVol[lake] / world.lakeCap[lake]);
}
const lakeSpan = (world, lake) => Math.max(0.5, world.lakeBrim[lake] - world.lakeBed[lake]);
// Litres a lake holds at a given surface level.
const lakeVolAt = (world, lake, level) => Math.max(0, world.lakeCap[lake] * (level - world.lakeBed[lake]) / lakeSpan(world, lake));

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
  // To a river too small to knock them down, a stand of trees is a rise.
  const rk = self >= 0 && world.rivers[self] && world.rivers[self].size < TUNE.treeBreak ? world.treeRock : world.rock;
  const a = f[i] + rk[i] - cv(i), b = f[i + 1] + rk[i + 1] - cv(i + 1), d = f[i + n] + rk[i + n] - cv(i + n), e = f[i + n + 1] + rk[i + n + 1] - cv(i + n + 1);
  return (a + (b - a) * fx) + ((d + (e - d) * fx) - (a + (b - a) * fx)) * fy;
}

// Start contours: one round each of the three summits, every start at the
// same elevation (a share of the peak, within a small tolerance), on open
// ground, on the downhill side of its peak. Cached per world.
export function spawnBand(world) {
  if (world.band) return world.band;
  const t = world.terrain, n = t.size, h = t.height, ax = t.axis.x, ay = t.axis.y;
  const groups = [], ring = [];
  for (const top of t.summits) {
    const peak = h[top], tx = top % n, ty = (top - tx) / n;
    const target = peak * TUNE.startElevation;
    let tol = peak * TUNE.startTolerance, cells;
    do {
      // The summit's own slopes: everything connected to its top that stays
      // above the start contour.
      const near = new Uint8Array(n * n), queue = [top];
      near[top] = 1;
      cells = [];
      while (queue.length) {
        const c = queue.pop(), cx = c % n, cy = (c - cx) / n;
        if (Math.abs(h[c] - target) <= tol && t.filled[c] - h[c] < 0.5 && (cx - tx) * ax + (cy - ty) * ay >= 0) cells.push(c);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 8 || y < 8 || x >= n - 8 || y >= n - 8) continue;
          const k = y * n + x;
          if (!near[k] && h[k] >= target - tol) { near[k] = 1; queue.push(k); }
        }
      }
      tol *= 1.5;
    } while (cells.length < 40 && tol < peak * 0.02);
    cells.sort((a, b) => a - b);
    // Fair paths: of those, the ones as far from the sea as this summit's
    // median, by the shortest route water can take.
    const reach = world.reach;
    const sorted = cells.map((c) => reach[c]).sort((a, b) => a - b);
    const mid = sorted[sorted.length >> 1];
    groups.push(cells.filter((c) => Math.abs(reach[c] - mid) <= mid * TUNE.fairReach));
    ring.push(...cells);
  }
  const fair = groups.flat().sort((a, b) => a - b);
  // ring: the contours, which falling drops glide along; cells: their fair
  // spots, where they touch down; groups: those spots per summit.
  world.band = { target: h[t.summits[1]] * TUNE.startElevation, cells: fair, wide: fair, groups, ring, top: t.summits[1] };
  return world.band;
}

// How many rivers the start rings can seat at least spawnGap apart (greedy, in
// index order), split evenly over the three summits. A map that can't seat
// everyone gets rerolled.
export function seats(world) {
  const t = world.terrain, n = t.size, gap2 = TUNE.spawnGap * TUNE.spawnGap;
  const per = spawnBand(world).groups.map((cells) => {
    const placed = [];
    for (const c of cells) {
      const x = ((c % n) / (n - 1) - 0.5) * t.worldSize, z = (Math.floor(c / n) / (n - 1) - 0.5) * t.worldSize;
      if (placed.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 >= gap2)) placed.push({ x, z });
    }
    return placed.length;
  });
  return Math.min(...per) * per.length;
}

// The island for a race: from `seed`, the next seed and the next until the
// summit ring seats every river. Returns the seed used and its fresh world.
export function rollIsland(seed, rivers, tries = 40) {
  let world;
  for (let i = 0; i < tries; i++, seed = (seed % 1_000_000) + 1) {
    world = createWorld(generateIsland(seed), { forest: false });
    if (seats(world) >= rivers) break;
  }
  return { seed: world.terrain.seed, world: addForest(world) };
}

// Keyed by player id. Keeps clear of rivers already placed, so add rivers in
// a fixed order (sorted ids) when the result must be reproducible.
export function spawnPoint(world, id) {
  const t = world.terrain, n = t.size;
  const band = spawnBand(world);
  const r = stream(t.seed, `spawn:${id}`);
  const others = world.rivers.map((o) => o.spawn);
  // Rivers are dealt round the three summits in the order they're added.
  const cells = band.groups[world.rivers.length % band.groups.length];
  let best = null, bestGap = -1;
  for (let tries = 0; tries < 120; tries++) {
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
    leftLake: -1, // the last lake the head left
    cut: 0, cutTicks: 0, cutAt: -1, cutLake: -1,
    stuck: false, stuckAt: 0, stuckX: 0, stuckZ: 0, // a head on a lake cutting its way out through a bank
    exitPath: null, exitStep: 0,
    pulses: [], // { s (metres down the path), i (next path point), amount, flow, every, erode, lakes passed }
    feeds: new Map(), // path index -> litres waiting to leave there with the next pulse
    pulseAt: 0, // tick the next pulse leaves
    exit: -1, // cell of the lake exit a blocked head on a lake is making for, or -1
    route: null, // level where the head was blocked: it's following the fill route out until it runs lower
    netAt: 0, netX: 0, netZ: 0, netT: 0, // where it was a moment ago, to tell going nowhere from flowing
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
  // The last seconds ease the drop onto the fair spot it will touch down on.
  if (r.dropping <= TUNE.settleTicks) {
    const t = world.terrain, n = t.size, k = landingCell(world, r.x, r.z);
    const kx = ((k % n) / (n - 1) - 0.5) * t.worldSize, kz = (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize;
    r.x += (kx - r.x) / r.dropping;
    r.z += (kz - r.z) / r.dropping;
  }
  r.dropping--;
  r.alt = (TUNE.dropAlt * r.dropping) / TUNE.dropTicks;
  if (r.dropping <= 0) land(world, r);
}

// A falling drop stays over the landing ring: never more than zoneSlack from
// the summit contour, so it can glide all the way round but never out to a
// coast, and touches down on the fair spot nearest where it is.
export function keepInZone(world, x, z) {
  if (!world.ringZone) world.ringZone = new Set(spawnBand(world).ring);
  const t = world.terrain, n = t.size, k = landingCell(world, x, z, world.ringZone);
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
export function landingCell(world, x, z, zone = dropZone(world)) {
  const t = world.terrain, n = t.size;
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
  weather(world);
  hydrology(world);
  pulses(world);
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
    // A bigger river answers the stick as well as a small one: more water is
    // more control, not less. Left of heading (dx, dz) is (dz, -dx).
    const a = TUNE.turnStep * -steer;
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

  // Where the water goes. On a lake or a flat it runs level, straight where
  // it's aimed. On a slope it goes where it's aimed too, as long as that's
  // downhill or across (with a slight drift down); aimed uphill, the uphill
  // part is dropped and it runs along and down the slope instead, because
  // water never climbs. The heading itself only ever turns when the player steers.
  //
  // Blocked, water doesn't stall or rock against the rise: it fills the hollow
  // and spills out at its lowest point, along the terrain's fill route
  // (priority flood), which leads to the sea without climbing. Once on that
  // route it stays on it until it has run clearly lower than where it was
  // blocked, or the player steers. (Choosing afresh each tick, it would step
  // back toward the rise and rock in place.)
  const tt = world.terrain, cHere = cellIndex(tt, r.x, r.z), onLake = world.lakeOf[cHere] >= 0;
  // On a lake the head floats on its water: as the lake rises past its rim,
  // the head rises with it and can top higher banks.
  if (onLake) r.low = Math.max(r.low, lakeLevel(world, world.lakeOf[cHere]));
  // Off the route again once it has run clearly lower and the heading no longer
  // points back up the slope (or the player steers): otherwise a heading aimed
  // uphill would climb, block and fall back forever.
  if (r.route !== null) {
    const aimUp = gl > 1e-6 ? (g.x * r.dx + g.z * r.dz) / gl : 0; // > 0: heading points uphill
    if (steer || (here < r.route - TUNE.routeDrop && aimUp < 0.2)) r.route = null;
  }
  // Going nowhere (moving, but back and forth, as across a valley floor when
  // aimed up it): take the fill route out too.
  if (world.tick - r.netAt >= TUNE.stallTicks) {
    const moved = r.travelled - r.netT, net = Math.sqrt((r.x - r.netX) ** 2 + (r.z - r.netZ) ** 2);
    if (r.route === null && moved > TUNE.stallMin && net < moved * TUNE.stallNet) r.route = here;
    r.netAt = world.tick; r.netX = r.x; r.netZ = r.z; r.netT = r.travelled;
  }
  // Barely gone anywhere in a moment, however it's steered: it's stuck. A
  // rushing river can't stop, so it holds still while its water pools and
  // wears away the ground the way it is pushing (see below), until a way opens.
  if (world.tick - r.stuckAt >= TUNE.stuckTicks) {
    const net = Math.sqrt((r.x - r.stuckX) ** 2 + (r.z - r.stuckZ) ** 2);
    if (!r.stuck && net < TUNE.stuckNet && !onLake && r.exit < 0 && !r.cut) r.stuck = true;
    r.stuckAt = world.tick; r.stuckX = r.x; r.stuckZ = r.z;
  }
  const routeDir = () => {
    const n = tt.size, d = wayOut(world, r, cellIndex(tt, r.x, r.z));
    if (d < 0) return null;
    const ex = ((d % n) / (n - 1) - 0.5) * tt.worldSize - r.x, ez = (Math.floor(d / n) / (n - 1) - 0.5) * tt.worldSize - r.z;
    const el = Math.sqrt(ex * ex + ez * ez);
    return el > 1e-6 ? { x: ex / el, z: ez / el } : null;
  };
  // Cutting out of a lake: until the head is through the rim and running
  // below the lake, it goes where it's aimed (the slope doesn't turn it back).
  if (r.cutLake >= 0 && (onLake || here < lakeLevel(world, r.cutLake) - 1)) r.cutLake = -1;
  let mx = r.dx, mz = r.dz;
  if (r.route !== null) {
    const d = routeDir();
    if (d) { mx = d.x; mz = d.z; } else r.route = null;
  } else if (!onLake && r.cutLake < 0 && gl >= TUNE.flatSlope) {
    const fx = -g.x / gl, fz = -g.z / gl, wf = Math.min(1, gl / TUNE.fallSlope);
    const up = mx * fx + mz * fz; // > 0: aimed downhill
    // Aimed uphill, a rise the head stands taller than is no obstacle while the
    // water still has the speed to run up it: it goes where it's aimed. A rise
    // above the head, or running out of speed, drops the uphill part.
    const over = up < 0 && (-up * gl * TUNE.headLook > liftOf(r) || r.speed < TUNE.climbSpeed);
    let bx = mx, bz = mz;
    if (over) { bx -= up * fx; bz -= up * fz; } // drop the uphill part
    if (up >= 0 || over) {
      bx += fx * wf * (over ? TUNE.fallUphill : TUNE.fallDrift);
      bz += fz * wf * (over ? TUNE.fallUphill : TUNE.fallDrift);
    }
    const bl = Math.sqrt(bx * bx + bz * bz);
    if (bl > 1e-6) { mx = bx / bl; mz = bz / bl; }
  }
  // Momentum takes up new water over a second or two, so a pulse arriving
  // swells the river's pace instead of jolting it.
  r.mass = (r.mass ?? 1) + (1 + TUNE.speedPerSize * (r.size - 1) - (r.mass ?? 1)) * TUNE.massEase;
  const mass = r.mass;
  const along = onLake ? 0 : -(g.x * mx + g.z * mz); // downhill slope along the way the water goes; a lake is level
  // Level water (a lake, a flat) doesn't push or brake: what you carry in
  // carries on, fading slowly, never below the base speed.
  const level = onLake || gl < TUNE.flatSlope;
  const target = level ? Math.max(TUNE.baseSpeed * mass, Math.min(TUNE.maxSpeed * mass, r.speed * TUNE.levelGlide))
    : Math.max(TUNE.minSpeed, Math.min(TUNE.maxSpeed * mass, (TUNE.baseSpeed + TUNE.slopeSpeed * along) * mass));
  // Momentum: more water surges up to speed just as fast, but holds it
  // longer, slowing down only slowly.
  r.speed += (target - r.speed) * (target > r.speed ? TUNE.speedEase : TUNE.speedEase / r.size);
  r.depth = depthOf(r);

  // More water stands taller at the head: rises that would stop a small river
  // don't stop a big one.
  let ceiling = r.low + TUNE.climb + liftOf(r);
  let v = r.speed;
  let nx = r.x + mx * v * DT, nz = r.z + mz * v * DT;
  if (r.stuck) {
    // Free as soon as the way it's aimed, or the way out, is open: it goes
    // that way (the heading first) and the pool runs out after it.
    const step = Math.max(TUNE.minSpeed, TUNE.baseSpeed * mass) * DT * 3, d = routeDir();
    const ways = [{ x: r.dx, z: r.dz }, d].filter(Boolean);
    const open = ways.find((w) => surfaceAt(world, r.x + w.x * step, r.z + w.z * step, me) <= ceiling);
    if (open) {
      r.stuck = false;
      r.stuckAt = world.tick; r.stuckX = r.x; r.stuckZ = r.z;
      mx = open.x; mz = open.z;
      v = r.speed = Math.max(r.speed, TUNE.baseSpeed * mass);
      nx = r.x + mx * v * DT; nz = r.z + mz * v * DT;
    } else {
      // Held: the pool keeps rising, and the water wears away the ground the
      // way it's pushing.
      r.low = Math.max(r.low, here) + TUNE.pool * r.size;
      wearAhead(world, r);
      r.speed = TUNE.minSpeed;
      if (!r.filling) world.events.push({ type: 'pond', river: r.idx, tick: world.tick });
      r.filling = true;
      r.depth = depthOf(r);
      return;
    }
  }
  // On a lake with no bank low enough to climb, the head makes for the lake's
  // lowest exit, its natural spill point or any river's outlet (a rival's too:
  // riding it out cuts into their channel). Nobody is trapped by a lake that
  // has drained below its rim.
  // First, though, a head pushed against a bank cuts its own way out: it
  // erodes the bank where it's aimed, faster for a bigger river, and once the
  // cut is down to its water it flows out there, cutting a new outlet. Only
  // a bank too high to cut in cutTicks sends it to the lowest exit.
  // (The shallow fringe round a lake counts: the head is still in its water.)
  const shore = onLake ? world.lakeOf[cHere] : r.cutLake >= 0 ? r.cutLake : underWater(world, cHere) ? r.leftLake : -1;
  // Judged where the player aims, not where the slope would turn the water.
  const px = r.x + r.dx * Math.max(v * DT, tt.cell * 0.5), pz = r.z + r.dz * Math.max(v * DT, tt.cell * 0.5);
  const ahead = shore >= 0 && r.exit < 0 ? surfaceAt(world, px, pz, me) : -Infinity;
  if (ahead > ceiling) {
    const at = cellIndex(tt, px, pz);
    const ax = at % tt.size, ay = (at - ax) / tt.size, bx = r.cutAt % tt.size, by = (r.cutAt - bx) / tt.size;
    if (r.cutAt < 0 || Math.abs(ax - bx) > 2 || Math.abs(ay - by) > 2) { r.cut = 0; r.cutTicks = 0; } // a new spot
    r.cutAt = at;
    r.cut += TUNE.bankCut * r.size;
    r.cutTicks++;
    r.cutLake = onLake ? -1 : shore; // on the rim: keep cutting the way it's aimed
    if (ahead - lakeLevel(world, shore) > TUNE.cutMax * r.size) {
      // A hill, not a rim: no cutting through that. Make for the lowest exit.
      setExit(world, r, shore); r.cut = 0; r.cutTicks = 0; r.cutAt = -1; r.cutLake = -1;
    } else if (r.cut >= ahead - ceiling) {
      // Through: the water runs out over the cut.
      r.low = ahead - TUNE.climb - liftOf(r) + 0.01;
      ceiling = r.low + TUNE.climb + liftOf(r);
      mx = r.dx; mz = r.dz; nx = px; nz = pz; // out through the cut, the way it's aimed
      r.cutLake = shore;
      r.cut = 0; r.cutTicks = 0; r.cutAt = -1;
    } else {
      world.digs.push({ r, x: px, z: pz, width: widthOf(r), depth: r.cut, bed: ahead - r.cut });
      if (r.cutTicks === 1) world.events.push({ type: 'cut', river: r.idx, tick: world.tick });
      if (r.cutTicks > TUNE.cutTicks) { setExit(world, r, shore); r.cut = 0; r.cutTicks = 0; r.cutAt = -1; r.cutLake = -1; }
      else {
        r.speed = Math.min(r.speed, TUNE.baseSpeed * mass);
        r.depth = depthOf(r);
        return;
      }
    }
  } else if (shore < 0) { r.cut = 0; r.cutTicks = 0; r.cutAt = -1; }
  if (r.exit >= 0) {
    // Along the water to the exit (never straight across a headland).
    const n = tt.size;
    let k = r.exitPath[r.exitStep], ex, ez, el;
    for (;;) {
      ex = ((k % n) / (n - 1) - 0.5) * tt.worldSize - r.x; ez = (Math.floor(k / n) / (n - 1) - 0.5) * tt.worldSize - r.z;
      el = Math.sqrt(ex * ex + ez * ez);
      if (el > tt.cell * 0.75 || r.exitStep >= r.exitPath.length - 1) break;
      k = r.exitPath[++r.exitStep];
    }
    if (el > tt.cell * 0.75) {
      v = Math.max(TUNE.baseSpeed * mass * 3, r.speed); // the lake's current carries it to the exit
      r.speed = v;
      const s = Math.min(v * DT, el);
      moveTo(world, r, r.x + (ex / el) * s, r.z + (ez / el) * s);
      afterMove(world, r);
      return;
    }
    // Through: the water stands at the exit now and runs on downhill.
    r.exit = -1; r.exitPath = null;
    r.low = Math.max(r.low, surfaceAt(world, r.x, r.z, me));
    r.route = r.low;
    const d = routeDir();
    if (d) { mx = d.x; mz = d.z; nx = r.x + mx * v * DT; nz = r.z + mz * v * DT; }
  }
  if (r.route === null && surfaceAt(world, nx, nz, me) > ceiling && gl > 1e-6) {
    // Slide along the contour, on the side the water is going.
    const ux = g.x / gl, uz = g.z / gl, d = mx * ux + mz * uz;
    const sx = mx - d * ux, sz = mz - d * uz, sl = Math.sqrt(sx * sx + sz * sz);
    if (sl > TUNE.slideMin) {
      mx = sx / sl; mz = sz / sl; v = r.speed * sl;
      nx = r.x + mx * v * DT; nz = r.z + mz * v * DT;
    }
  }
  if (r.route === null && surfaceAt(world, nx, nz, me) > ceiling) {
    const d = routeDir();
    if (d) {
      r.route = here;
      // Momentum carries on: blocked, the water swings off along its way out
      // at the speed it had (on a lake, at least base speed).
      v = onLake ? Math.max(TUNE.baseSpeed * mass, r.speed) : Math.max(TUNE.minSpeed, r.speed);
      r.speed = v;
      nx = r.x + d.x * v * DT; nz = r.z + d.z * v * DT;
    } else {
      nx = r.x; nz = r.z;
      r.speed *= 0.8;
    }
  }
  if (r.route !== null) {
    // Stuck in a hollow: a rushing river can't stop, so its water fills the
    // hollow, rising each tick, and the head waits until it spills over.
    const rise = surfaceAt(world, nx, nz, me) - ceiling, fill = TUNE.pool * r.size;
    if (rise > fill) {
      r.low += fill;
      r.speed = Math.min(r.speed, TUNE.minSpeed);
      if (!r.filling) world.events.push({ type: 'pond', river: r.idx, tick: world.tick });
      r.filling = true;
      r.depth = depthOf(r);
      return;
    }
    if (rise > 0) r.low += rise;
  }
  r.filling = false;
  // Running up a rise spends momentum (what lets it top the rise, see
  // liftOf): every metre climbed costs speed, so a long climb slows it
  // right down, and running down gives it back through the slope.
  const rise = surfaceAt(world, nx, nz, me) - here;
  if (rise > 0 && !onLake) {
    const v2 = r.speed * r.speed - (rise * TUNE.baseSpeed * TUNE.baseSpeed) / TUNE.surgeLift;
    r.speed = Math.max(TUNE.minSpeed, Math.sqrt(Math.max(0, v2)));
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
      cuts.push([a, a.depth, world.rivers[o], carve[k], k]); // head depth vs the channel as cut right here
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
  // The cut point on each river's channel: pulses coming down the shallower
  // one lose a share there to the deeper (see pulses()).
  for (const [a, da, b, db, k] of cuts) {
    const [win, dw, lose, dl] = da >= db ? [a, da, b, db] : [b, db, a, da];
    if ((dw - dl) / Math.max(dl, 0.5) < TUNE.siphonDeadband) continue;
    const jk = `${lose.id}|${win.id}`;
    world.junctions.delete(`${win.id}|${lose.id}`); // the deeper side flipped: water runs one way only
    if (!world.junctions.has(jk)) world.events.push({ type: 'junction', from: lose.idx, to: win.idx, tick: world.tick });
    world.junctions.set(jk, { from: lose, to: win, until: world.tick + TUNE.liveTicks, share: dw / (dw + dl), s: nearestS(world, lose, k), at: nearestIndex(world, win, k) });
  }
  for (const jk of [...world.junctions.keys()].sort()) {
    const j = world.junctions.get(jk);
    if (world.tick >= j.until || !isRacing(j.from) || !isRacing(j.to)) world.junctions.delete(jk);
  }
  if (!flows.length) return;
  // Net each pair to one flow, so a pair never trades water both ways in a tick.
  const net = new Map();
  for (const f of flows) {
    const fwd = byId(f.win, f.lose) < 0;
    const key = fwd ? `${f.win.id}|${f.lose.id}` : `${f.lose.id}|${f.win.id}`;
    const n = net.get(key) ?? { p: fwd ? f.win : f.lose, q: fwd ? f.lose : f.win, amount: 0, how: f.how };
    n.amount += fwd ? f.amount : -f.amount;
    net.set(key, n);
  }
  flows.length = 0;
  lost.clear();
  for (const key of [...net.keys()].sort()) {
    const n = net.get(key);
    if (n.amount === 0) continue;
    const [win, lose] = n.amount > 0 ? [n.p, n.q] : [n.q, n.p];
    const amount = Math.abs(n.amount);
    flows.push({ win, lose, amount, how: n.how });
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

// How far down the slope a point is: 0 at the summit end, 1 at the sea end.
export function slopeT(world, x, z) {
  const t = world.terrain, u = (x * t.axis.x + z * t.axis.y) / (t.worldSize / 2);
  return (u + t.long) / (2 * t.long);
}

// Where the heat front stands (as slopeT), or -Infinity before it starts.
export function heatFront(world) {
  const ticks = world.tick - TUNE.heatStart;
  if (ticks < 0) return -Infinity;
  const t = world.terrain;
  return -0.02 + (ticks * TUNE.heatSpeed * DT) / (2 * t.long * (t.worldSize / 2));
}

// Weather, once per tick: the heat front dries the lakes it has passed;
// storms rain into whatever is under them. Placed from the state of
// the race and a seeded stream, so every machine agrees.
function weather(world) {
  const front = heatFront(world);
  const racing = world.rivers.filter((r) => isRacing(r) && !r.dropping).sort(byId);
  if (front > -Infinity) {
    if (world.tick === TUNE.heatStart) world.events.push({ type: 'heat', tick: world.tick });
    if ((world.tick - TUNE.heatStart) % TUNE.heatEvery === 0) {
      const t = world.terrain, n = t.size;
      for (const l of world.lakes) {
        const x = (l.gx / (n - 1) - 0.5) * t.worldSize, z = (l.gy / (n - 1) - 0.5) * t.worldSize;
        if (slopeT(world, x, z) >= front || world.lakeVol[l.id] <= 0) continue;
        const dry = Math.min(world.lakeVol[l.id], TUNE.heatLake);
        world.lakeVol[l.id] -= dry;
        world.events.push({ type: 'evaporate', lake: l.id, amount: dry, tick: world.tick });
      }
    }
  }
  // Storms: each one blows in from one side of the island ahead of the pack
  // and sweeps right across it to the other, drifting down the slope as it
  // goes, raining into every river head and lake under it.
  if (world.tick >= TUNE.stormStart && (world.tick - TUNE.stormStart) % TUNE.stormEvery === 0 && racing.length) {
    const rng = stream(world.terrain.seed, `storm:${world.tick}`);
    const ts = racing.map((r) => slopeT(world, r.x, r.z)).sort((a, b) => a - b);
    const tAt = Math.min(0.95, ts[ts.length >> 1] + 0.05 + 0.12 * rng());
    const t = world.terrain, ax = t.axis.x, az = t.axis.y, half = t.worldSize / 2;
    const u = (tAt * 2 * t.long - t.long) * half;
    const from = rng() < 0.5 ? -1 : 1, span = TUNE.stormSpan;
    const x = ax * u - az * span * from, z = az * u + ax * span * from;
    const across = -from * (TUNE.stormSpeed[0] + (TUNE.stormSpeed[1] - TUNE.stormSpeed[0]) * rng());
    const along = TUNE.stormDrift[0] + (TUNE.stormDrift[1] - TUNE.stormDrift[0]) * rng();
    const ticks = Math.ceil(((2 * span) / Math.abs(across)) * TICK_HZ);
    const s = { id: world.tick, x, z, vx: ax * along - az * across, vz: az * along + ax * across, until: world.tick + ticks, radius: TUNE.stormRadius };
    world.storms.push(s);
    world.events.push({ type: 'storm', on: true, id: s.id, x, z, radius: s.radius, tick: world.tick });
  }
  const t = world.terrain, n = t.size;
  for (const s of [...world.storms]) {
    if (world.tick >= s.until) {
      world.storms.splice(world.storms.indexOf(s), 1);
      world.events.push({ type: 'storm', on: false, id: s.id, tick: world.tick });
      continue;
    }
    s.x += s.vx * DT;
    s.z += s.vz * DT;
    const r2 = s.radius * s.radius;
    for (const r of racing) {
      if ((r.x - s.x) ** 2 + (r.z - s.z) ** 2 > r2) continue;
      if (r.inLake >= 0) world.lakePending[r.inLake] += TUNE.stormRain;
      else grow(r, TUNE.stormRain);
      r.rained = world.tick;
    }
    // Lakes under it fill, more the more of them it covers.
    for (const l of world.lakes) {
      const lx = (l.gx / (n - 1) - 0.5) * t.worldSize, lz = (l.gy / (n - 1) - 0.5) * t.worldSize;
      const reach = s.radius + Math.sqrt(l.cells) * t.cell * 0.5;
      if ((lx - s.x) ** 2 + (lz - s.z) ** 2 > reach * reach) continue;
      world.lakePending[l.id] += TUNE.stormLakeRain * Math.min(l.cells, TUNE.lakeCellCap);
    }
  }
}

// Water between rivers and lakes, once per tick. A lake is a reservoir:
// - every river pours its discharge into the lake its head is in and into every
//   lake upstream of it that it flowed through; the river's own volume holds
//   while its head is in a lake (the lake is part of its body);
// - a lake drains through the outlets of the rivers that left it: each lip is
//   the ground where the outlet was cut, minus how deep it's cut. Only water
//   standing over a lip flows out, by weir law (head^1.5, times outlet width),
//   so a deeper or wider outlet takes more, whoever got there first; what
//   flows through erodes the outlet deeper, faster with more water over the
//   lip and a bigger river, slowing as the lake falls to the lip; a river's
//   own water passing through is no gain, only what drains out beyond it;
// - more in than out and the level rises, past the lips and past the rim:
//   over the rim it spills into a channel nobody owns, which runs dry once the
//   level falls back. A river whose head is in a spill channel takes its water;
// - you grow only by what leaves through your outlets, never by stored water.
function hydrology(world) {
  const L = world.lakes.length, cap = world.lakeCap, vol = world.lakeVol, t = world.terrain;
  const inflow = world.lakePending;
  world.lakePending = new Float64Array(L);
  const outlets = []; // [lake, river, outlet]
  const flowing = world.rivers.filter((r) => isRacing(r) && !r.dropping).sort(byId);
  for (const r of flowing) {
    r.inflow = 0;
    // (Rivers pour into lakes in pulses, see pulses().)
    for (const [lake, o] of r.via) {
      if (lake === r.inLake) continue; // your own head is in it: you don't drain it
      outlets.push([lake, r, o]);
    }
  }
  const give = (r, q) => {
    // Water reaching a river whose head is in a lake goes into that lake.
    if (r.inLake >= 0) world.lakePending[r.inLake] += q;
    else { grow(r, q); r.inflow += q; }
  };
  const want = new Float64Array(L), lowLip = new Float64Array(L).fill(Infinity);
  for (let lake = 0; lake < L; lake++) { vol[lake] += inflow[lake]; world.lakeIn[lake] = inflow[lake]; }
  const open = [];
  for (const [lake, r, o] of outlets) {
    const lip = t.filled[o.cell] - o.e;
    const h = Math.min(TUNE.outletMax, lakeLevel(world, lake) - lip);
    if (h <= 0) continue;
    const q = TUNE.outletK * (o.w / TUNE.width) * h * Math.sqrt(h);
    open.push([lake, r, o, q, h]);
    want[lake] += q;
    if (lip < lowLip[lake]) lowLip[lake] = lip;
  }
  // No outlet drains a lake below its own lip: the total is capped by the
  // water standing over the lowest open lip.
  const scale = new Float64Array(L).fill(1);
  for (let lake = 0; lake < L; lake++) {
    if (!want[lake]) continue;
    const avail = vol[lake] - lakeVolAt(world, lake, lowLip[lake]);
    if (want[lake] > avail) scale[lake] = Math.max(0, avail) / want[lake];
  }
  const out = new Float64Array(L);
  for (const [lake, r, o, w, h] of open) {
    const q = w * scale[lake];
    if (q <= 0) continue;
    vol[lake] -= q;
    out[lake] += q;
    // Rivers' water passing through is already theirs: only what drains out
    // beyond it (the lake's stored water, rain) makes you bigger.
    // (Rivers' water passing through is on account at the lake: it flows
    // out again first, and only the lake's own water beyond it is a gain.)
    const through = Math.min(q, world.lakeFlow[lake]);
    world.lakeFlow[lake] -= through;
    const gain = q - through;
    // It joins the river at the outlet and comes down with the next pulse.
    if (gain > 0) { feed(r, o.at ?? 0, gain); r.inflow += gain; }
    // Erosion follows the water over the lip and the river's volume: a high
    // lake and a big river cut fast; as the lake drops to the lip it slows.
    o.e = Math.min(t.filled[o.cell] - SEA_LEVEL - 0.5, o.e + TUNE.erodeK * h * r.size);
  }
  // Over the rim: spill.
  for (let lake = 0; lake < L; lake++) {
    const hs = lakeLevel(world, lake) - world.lakeBrim[lake];
    let sp = world.spills.get(lake);
    if (hs <= 0 || world.lakeOutlet[lake] < 0) {
      if (sp?.on) { sp.on = false; sp.flow = 0; world.events.push({ type: 'overflow', lake, on: false, tick: world.tick }); }
      world.lakeOut[lake] = out[lake];
      continue;
    }
    if (!sp) { sp = spillChannel(world, lake); world.spills.set(lake, sp); }
    if (!sp.on) { sp.on = true; world.events.push({ type: 'overflow', lake, on: true, tick: world.tick }); }
    const q = Math.min(vol[lake] - cap[lake], TUNE.spillK * hs * Math.sqrt(hs));
    vol[lake] -= q;
    sp.flow = q;
    out[lake] += q;
    world.lakeOut[lake] = out[lake];
    // Rivers with their head in the spill channel share it by depth; the rest
    // runs on into the lake (if any) the channel ends in.
    const taps = flowing.filter((r) => r.inLake < 0 && sp.cells.has(cellIndex(t, r.x, r.z)));
    const dsum = taps.reduce((a, r) => a + r.depth, 0);
    for (const r of taps) give(r, (q * r.depth) / dsum);
    if (!taps.length && sp.into >= 0) world.lakePending[sp.into] += q;
  }
}

// A lake's spill channel: from its spill point down the fill's downhill tree
// to the sea, the next lake, or spillCells long. Cut once, shallow, owned by
// nobody; it never erodes, so it stays a temporary channel.
function spillChannel(world, lake) {
  const t = world.terrain, n = t.size, path = [], cells = new Set();
  let k = world.lakeOutlet[lake], into = -1;
  while (k >= 0 && path.length < TUNE.spillCells) {
    if (world.lakeOf[k] >= 0 && world.lakeOf[k] !== lake) { into = world.lakeOf[k]; break; }
    if (t.filled[k] <= SEA_LEVEL) break;
    path.push(k);
    k = downhill(t, k);
  }
  const rad = Math.max(1, Math.round(TUNE.spillWidth / 2 / t.cell));
  for (const c of path) {
    const cx = c % n, cy = (c - cx) / n;
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 1 || y < 1 || x >= n - 1 || y >= n - 1 || dx * dx + dy * dy > rad * rad) continue;
      const j = y * n + x;
      cells.add(j);
      if (world.owner[j] >= 0 || underWater(world, j) || t.filled[j] <= SEA_LEVEL) continue;
      const v = Math.min(TUNE.spillDepth * (1 - (dx * dx + dy * dy) / (rad * rad + 1)), t.height[j] - SEA_LEVEL - 0.5);
      if (v > world.carve[j]) { world.carve[j] = v; world.dirty.push(j); }
    }
  }
  return { path, cells, into, flow: 0, on: false };
}

// Water waiting at a point of a river's channel for the next pulse.
function feed(r, at, litres) {
  if (litres > 0) r.feeds.set(at, (r.feeds.get(at) ?? 0) + litres);
}

// The path point of river r nearest cell k (searching back from the head).
function nearestIndex(world, r, k) {
  const t = world.terrain, n = t.size;
  const kx = ((k % n) / (n - 1) - 0.5) * t.worldSize, kz = (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize;
  let best = Math.max(0, r.path.length - 1), bd = Infinity;
  for (let i = r.path.length - 1; i >= 0; i--) {
    const d = (r.path[i].x - kx) ** 2 + (r.path[i].z - kz) ** 2;
    if (d < bd) { bd = d; best = i; }
    if (bd < t.cell * t.cell && d > bd * 100) break;
  }
  return best;
}
const nearestS = (world, r, k) => r.path[nearestIndex(world, r, k)]?.s ?? 0;

export function pulseEvery(r) {
  for (const [below, ticks] of TUNE.pulseEvery) if (r.volume < below) return ticks;
  return TUNE.pulseEvery[TUNE.pulseEvery.length - 1][1];
}

// Pulses, once per tick: release, run down the channel, arrive.
function pulses(world) {
  const t = world.terrain, n = t.size;
  const cutsOf = new Map();
  for (const jk of [...world.junctions.keys()].sort()) {
    const j = world.junctions.get(jk);
    if (!cutsOf.has(j.from)) cutsOf.set(j.from, []);
    cutsOf.get(j.from).push(j);
  }
  for (const r of world.rivers.filter((o) => isRacing(o) && !o.dropping && o.path.length).sort(byId)) {
    const head = r.path[r.path.length - 1].s;
    // Release: the source's pulse carries the river's flow for the interval
    // (what it pours into lakes) and the water gathered since the last one;
    // water waiting further down (lake outlets, rivals' cuts) leaves there.
    if (world.tick >= r.pulseAt) {
      const every = pulseEvery(r);
      r.pulseAt = world.tick + every;
      r.pulses.push({ s: 0, i: 0, amount: r.feeds.get(0) ?? 0, flow: dischargeOf(r) * every, every, erode: true, lakes: [] });
      for (const [at, litres] of [...r.feeds].sort((a, b) => a[0] - b[0])) {
        if (at === 0) continue;
        const p = r.path[Math.min(at, r.path.length - 1)];
        r.pulses.push({ s: p.s, i: Math.min(at, r.path.length - 1), amount: litres, flow: 0, every, erode: false, lakes: [] });
      }
      r.feeds.clear();
      world.events.push({ type: 'pulse', river: r.idx, tick: world.tick });
    }
    const v = TUNE.pulseSpeed * Math.max(r.speed, TUNE.baseSpeed);
    const cuts = cutsOf.get(r) ?? [];
    const flow = 0.7 * depthOf(r);
    const keep = [];
    for (const p of r.pulses) {
      const s0 = p.s, s1 = s0 + v * DT;
      // Every path point passed this tick.
      while (p.i < r.path.length && r.path[p.i].s <= s1) {
        const q = r.path[p.i++], c = cellIndex(t, q.x, q.z);
        // (The head itself doesn't erode: a head that stops can't dig itself a pit.)
        if (p.erode && p.i <= r.path.length - TUNE.headSpared) erodeAt(world, r, c, flow, p.every);
        const lake = world.lakeOf[c];
        if (lake >= 0 && !p.lakes.includes(lake) && lake !== r.inLake) {
          // Into a lake on the way: it pours the river's flow in, and if
          // the lake stands below this river's outlet it soaks up the pulse
          // until it's back up to the lip.
          p.lakes.push(lake);
          world.lakePending[lake] += p.flow;
          world.lakeFlow[lake] += p.flow; // river water passing through, no one's gain
          const o = r.via.get(lake);
          if (o && p.amount > 0) {
            const short = lakeVolAt(world, lake, t.filled[o.cell] - o.e) - world.lakeVol[lake] - world.lakePending[lake];
            if (short > 0) {
              const take = Math.min(p.amount, short);
              p.amount -= take;
              world.lakePending[lake] += take;
              world.events.push({ type: 'soak', river: r.idx, lake, amount: take, tick: world.tick });
            }
          }
        }
      }
      // A rival's cut on the way takes its share.
      for (const j of cuts) {
        if (j.s <= s0 || j.s > s1 || p.amount <= 0) continue;
        const take = p.amount * j.share;
        p.amount -= take;
        feed(j.to, j.at, take);
        world.events.push({ type: 'siphon', from: r.idx, to: j.to.idx, amount: take, how: 'junction', tick: world.tick });
      }
      p.s = s1;
      if (s1 < head) { keep.push(p); continue; }
      // At the head: the river swells (or, with its head in a lake, the lake does).
      if (r.inLake >= 0) { world.lakePending[r.inLake] += p.flow + p.amount; world.lakeFlow[r.inLake] += p.flow; }
      else if (p.amount > 0) {
        grow(r, p.amount);
        // The wave hits the head and shoves it on: a surge of speed, bigger
        // the more water the pulse brings against what the river already
        // carries, past its usual top speed for a moment; its momentum then
        // carries it (heavy water slows only slowly).
        const shove = TUNE.surge * TUNE.baseSpeed * Math.min(1, p.amount / (r.volume * TUNE.surgeShare));
        r.speed = Math.min(r.speed + shove, TUNE.maxSpeed * (r.mass ?? 1) * TUNE.surgeCap);
      }
      world.events.push({ type: 'swell', river: r.idx, amount: p.amount, tick: world.tick });
    }
    r.pulses = keep;
  }
}

// A pulse passing erodes the channel: by the water over each cell (the
// river's flow depth, shallower at the banks), the river's size and the slope
// there, for the whole interval since the last pulse. Big rivers on steep
// ground carve canyons; small ones on the flats barely scour.
function erodeAt(world, r, c, flow, every) {
  const t = world.terrain, n = t.size, cx = c % n, cy = (c - cx) / n;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const k = (cy + dy) * n + cx + dx;
    if (k < 0 || k >= n * n || world.owner[k] !== r.idx || t.filled[k] <= SEA_LEVEL || underWater(world, k)) continue;
    if (world.erodedBy?.[k] === world.tick) continue; // once a tick, however many points cross it
    (world.erodedBy ??= new Int32Array(n * n).fill(-1))[k] = world.tick;
    const was = world.carve[k];
    const f = t.filled, kx = k % n;
    const sx = (f[kx < n - 1 ? k + 1 : k] - f[kx > 0 ? k - 1 : k]) / (2 * t.cell);
    const sz = (f[k + n < n * n ? k + n : k] - f[k - n >= 0 ? k - n : k]) / (2 * t.cell);
    const slope = Math.sqrt(sx * sx + sz * sz);
    const add = TUNE.trailErode * every * Math.min(flow, was) * r.size * (1 + slope / TUNE.slopeErode);
    // Deep canyons cut slower, but never stop.
    const v = Math.min(t.height[k] + world.rock[k] - SEA_LEVEL - 0.5, was + add / (1 + was / (TUNE.depth * 3)));
    if (v <= was) continue;
    world.carve[k] = v;
    if (Math.floor(v * 4) !== Math.floor(was * 4)) world.dirty.push(k);
  }
}

// Erosion is forever: every river's whole channel keeps deepening as long as
// it pours, a pulse at a time, never below sea level.
function erodeTrails(world) {
  // The channel erodes as pulses pass (see erodeAt). Outlets are recut to
  // how far they have eroded, every trailPasses ticks.
  if (world.tick % TUNE.trailPasses) return;
  const t = world.terrain, n = t.size;
  for (const r of world.rivers.filter((o) => isRacing(o) && !o.dropping).sort(byId)) {
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
// How tall the water stands at the head, metres: it grows with volume (as
// size, the fourth root), so a bigger river pushes over rises a small one can't.
// How high the water can run up a rise: the head's height plus what its
// speed carries it (fast water surges over bumps, slow water stops at them).
export function liftOf(r) {
  const v = (r.speed ?? 0) / TUNE.baseSpeed;
  return headOf(r) + Math.min(TUNE.surgeLiftMax, TUNE.surgeLift * v * v);
}

export function headOf(r) {
  return TUNE.headPerSize * r.size * r.size; // grows fast: a big river plows over banks a small one can't
}

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
  // In a lake the river's volume holds: its water goes into the lake.
  // What a longer channel gathers comes down it from the source, in pulses.
  if (world.lakeOf[cellIndex(world.terrain, nx, nz)] < 0) feed(r, 0, moved * TUNE.trickle);
}

// Send a head on a lake to its lowest exit, by a path over the lake's water
// (lake and its shallow fringe), found breadth-first so every machine agrees.
function setExit(world, r, lake) {
  const t = world.terrain, n = t.size, goal = lowestExit(world, lake, r);
  if (goal < 0) return;
  const start = cellIndex(t, r.x, r.z), from = new Map([[start, -1]]), queue = [start];
  // Over the water, or ground no higher than the head can stand on.
  const top = Math.max(r.low, lakeLevel(world, lake)) + TUNE.climb + headOf(r);
  const wet = (k) => world.lakeOf[k] === lake || (world.lakeOf[k] < 0 && underWater(world, k)) || t.filled[k] + world.rock[k] <= top;
  let end = -1;
  for (let q = 0; q < queue.length && end < 0; q++) {
    const c = queue[q], cx = c % n, cy = (c - cx) / n;
    for (let dy = -1; dy <= 1 && end < 0; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy, k = y * n + x;
      if ((!dx && !dy) || x < 0 || y < 0 || x >= n || y >= n || from.has(k)) continue;
      if (k === goal) { from.set(k, c); end = k; break; }
      if (!wet(k)) continue;
      from.set(k, c);
      queue.push(k);
    }
  }
  const path = [];
  for (let k = end >= 0 ? end : goal; k >= 0; k = from.get(k) ?? -1) path.push(k);
  path.reverse();
  r.exit = goal; r.exitPath = path; r.exitStep = 0;
}

// Where water blocked at cell c runs next: down the fill's downhill tree, or,
// for a river too small to knock trees down, down the shortest way to the
// sea round the stands (the fill's tree runs straight through them).
function wayOut(world, r, c) {
  const t = world.terrain, round = world.roundReach;
  if (!round || r.size >= TUNE.treeBreak || round[c] < 0) return downhill(t, c);
  const n = t.size, cx = c % n, cy = (c - cx) / n;
  let best = -1, bd = round[c];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = cx + dx, y = cy + dy;
    if ((!dx && !dy) || x < 0 || y < 0 || x >= n || y >= n) continue;
    const k = y * n + x;
    if (round[k] < 0 || round[k] >= bd || t.filled[k] > t.filled[c] + TUNE.climb) continue;
    bd = round[k]; best = k;
  }
  return best >= 0 ? best : downhill(t, c);
}

// A lake's lowest way out: its spill point or the lip of any outlet cut from it.
function lowestExit(world, lake, self) {
  const f = world.terrain.filled;
  let best = world.lakeOutlet[lake], low = best >= 0 ? f[best] : Infinity;
  for (const o of world.rivers) {
    if (o === self) continue; // not back to where it already failed to get out
    const ot = o.via.get(lake);
    if (ot && f[ot.cell] - ot.e < low) { low = f[ot.cell] - ot.e; best = ot.cell; }
  }
  return best;
}

function joinLake(world, r, lake, cell) {
  if (r.via.has(lake)) return; // already has an outlet from this lake
  // The head floats on the lake, so it cuts its outlet down from the water it
  // rides on (or the bank, if lower): a river leaving a drained lake cuts a
  // lower outlet. As wide as the head; from then on only the water through it
  // deepens it.
  const ground = world.terrain.filled[cell];
  const lip = Math.max(SEA_LEVEL + 0.5, Math.min(ground, lakeLevel(world, lake)) - r.depth);
  r.via.set(lake, { cell, e: Math.max(0, ground - lip), w: widthOf(r), born: world.tick, at: Math.max(0, r.path.length - 1) });
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
  // Lakes: entering one pours your water in; a basin below full fills from
  // every river running into it, but nobody waits for it: the head flows on
  // across at its momentum. Leaving one cuts your outlet from it, and its
  // water starts flowing to you.
  const lake = world.lakeOf[here];
  if (lake !== r.inLake) {
    if (r.inLake >= 0) { joinLake(world, r, r.inLake, here); r.leftLake = r.inLake; }
    r.inLake = lake;
    if (lake >= 0 && !r.via.has(lake)) {
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
  const last = r.path[r.path.length - 1];
  const s = last ? last.s + Math.sqrt((r.x - last.x) ** 2 + (r.z - last.z) ** 2) : 0;
  r.path.push({ x: r.x, z: r.z, water: centre - depth * 0.3, w: width, tick: world.tick, s });
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
      if (underWater(world, k)) continue; // rivers run over lakes, not through their beds: only banks erode
      if (world.trees[k]) {
        // A big river knocks the trees flat; a small one's water stops at them.
        if (r.size < TUNE.treeBreak) continue;
        fell(world, k);
      }
      if (world.lava[k]) {
        // Water meets lava: it cools into rock instead of being dug.
        world.lava[k] = 0;
        world.rock[k] = Math.max(world.rock[k], TUNE.damHeight);
        world.treeRock[k] = world.rock[k] + (world.trees[k] ? TUNE.treeHeight : 0);
        world.dirty.push(k);
        world.cooled.push(k);
        continue;
      }
      const w = d <= rad ? 1 : 1 - (d - rad) / feather;
      const want = (ground - bed) * w; // carve down to the bed, less at the banks
      if (want > world.carve[k]) {
        world.carve[k] = Math.min(want, depth * 3, Math.max(0, t.height[k] + world.rock[k] - SEA_LEVEL - 0.5)); // never below the sea
        world.owner[k] = r.idx;
        world.dirty.push(k);
      }
      // Refresh the live-water clock where this river still owns the cell.
      if (world.owner[k] === r.idx && want > TUNE.contactDepth) world.dugAt[k] = world.tick;
    }
  }
}

// A stuck river wears away the ground the way it's pushing: a strip as wide
// as the river, out a few cells along its heading, strongest nearest the head,
// down toward its pool's level (never below the sea). Its own spot isn't worn:
// that would only sink it deeper. Worn ground is lower for everyone (it's the
// land, not a channel), so in time the head breaks through where it's aimed.
function wearAhead(world, r) {
  const t = world.terrain, n = t.size, floor = r.low - TUNE.climb;
  const half = Math.max(t.cell * 0.6, widthOf(r) / 2), seen = new Set([cellIndex(t, r.x, r.z)]);
  for (let i = 1; i <= TUNE.stuckWearCells; i++) {
    const cx = r.x + r.dx * t.cell * i, cz = r.z + r.dz * t.cell * i, strength = 1 - (i - 1) / TUNE.stuckWearCells;
    for (let s = -half; s <= half; s += t.cell * 0.5) {
      const k = cellIndex(t, cx + r.dz * s, cz - r.dx * s);
      if (seen.has(k)) continue;
      seen.add(k);
      if (world.lakeOf[k] >= 0 || t.filled[k] <= SEA_LEVEL) continue;
      const ground = t.filled[k] + world.rock[k];
      if (ground <= floor) continue;
      const wear = Math.min(ground - floor, TUNE.stuckWear * r.size * strength);
      const lowest = Math.max(-TUNE.stuckWearMax, SEA_LEVEL + 0.5 - t.filled[k]);
      const was = world.rock[k], now = Math.max(lowest, was - wear);
      if (now >= was) continue;
      world.rock[k] = now;
      world.treeRock[k] += now - was;
      world.dirty.push(k);
    }
  }
}

function fell(world, k) {
  world.trees[k] = 0;
  world.treeRock[k] = world.rock[k];
  world.felled.push(k);
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
