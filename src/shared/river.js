// River simulation. Authoritative, fixed-tick, shared by client and server.
// Rules: no transcendental Math; integer steering input; render never writes here.

import { SEA_LEVEL, LAKE_MIN_DEPTH, downhill } from './terrain.js';
import { stream } from './rng.js';

export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;

export const TUNE = {
  turnStep: 0.11, // radians per tick at full steer
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
  width: 110, // channel width, metres
  depth: 7, // channel depth, metres
};

// cos/sin of TUNE.turnStep, as literals so no runtime transcendental is needed.
const TURN_C = 0.9939560979566968;
const TURN_S = 0.10977830083717481;

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
  return { terrain, flow, dist: distanceToSea(terrain, downhill), carve: new Float32Array(n * n), owner: new Int32Array(n * n).fill(-1), tick: 0, rivers: [], dirty: [] };
}

// Surface seen by river `self` (-1 = everyone's channels, for rendering).
export function surfaceAt(world, wx, wz, self = -1) {
  const t = world.terrain, n = t.size;
  const gx = (wx / t.worldSize + 0.5) * (n - 1);
  const gy = (wz / t.worldSize + 0.5) * (n - 1);
  const x0 = gx < 0 ? 0 : gx > n - 2 ? n - 2 : Math.floor(gx);
  const y0 = gy < 0 ? 0 : gy > n - 2 ? n - 2 : Math.floor(gy);
  const fx = Math.min(1, Math.max(0, gx - x0)), fy = Math.min(1, Math.max(0, gy - y0));
  const i = y0 * n + x0, f = t.filled, c = world.carve, o = world.owner;
  const cv = (k) => (self >= 0 && o[k] === self ? 0 : c[k]);
  const a = f[i] - cv(i), b = f[i + 1] - cv(i + 1), d = f[i + n] - cv(i + n), e = f[i + n + 1] - cv(i + n + 1);
  return (a + (b - a) * fx) + ((d + (e - d) * fx) - (a + (b - a) * fx)) * fy;
}

// Pick a spawn high on the spine, keyed by player id so spawns are stable.
export function spawnPoint(world, id) {
  const t = world.terrain, n = t.size;
  const r = stream(t.seed, `spawn:${id}`);
  let peak = 0;
  for (let i = 0; i < n * n; i++) if (t.height[i] > peak) peak = t.height[i];
  for (let tries = 0; tries < 4000; tries++) {
    const x = 8 + Math.floor(r() * (n - 16)), y = 8 + Math.floor(r() * (n - 16));
    const h = t.filled[y * n + x];
    if (h > peak * 0.55 && h - t.height[y * n + x] < 0.5) {
      return { x: (x / (n - 1) - 0.5) * t.worldSize, z: (y / (n - 1) - 0.5) * t.worldSize };
    }
  }
  return { x: 0, z: 0 };
}

export function addRiver(world, id, at = spawnPoint(world, id)) {
  const idx = world.rivers.length;
  const g = gradient(world, at.x, at.z, idx);
  const len = Math.sqrt(g.x * g.x + g.z * g.z) || 1;
  const river = {
    id,
    idx,
    x: at.x, z: at.z,
    dx: -g.x / len, dz: -g.z / len,
    speed: TUNE.minSpeed,
    low: Infinity, // lowest surface reached; water can't climb far above it
    best: Infinity, // best distance-to-sea so far, for stall detection
    stall: 0,
    guided: 0,
    guidedTicks: 0, // total, for tuning: physics should rarely need the guard
    travelled: 0,
    finished: false,
    finishTick: -1,
    path: [],
  };
  pushPathPoint(world, river);
  world.rivers.push(river);
  return river;
}

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
export function step(world, inputs) {
  for (const r of world.rivers) {
    if (r.finished) continue;
    const steer = Math.max(-1, Math.min(1, inputs?.get(r.id) | 0));
    if (steer) {
      const s = -TURN_S * steer; // rotation [[c, s], [-s, c]]; steer -1 turns left
      const dx = r.dx * TURN_C + r.dz * s, dz = -r.dx * s + r.dz * TURN_C;
      r.dx = dx; r.dz = dz;
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
      continue;
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
    const target = Math.max(TUNE.minSpeed, Math.min(TUNE.maxSpeed, TUNE.baseSpeed + TUNE.slopeSpeed * along));
    r.speed += (target - r.speed) * TUNE.speedEase;

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
  world.tick++;
}

function moveTo(world, r, nx, nz) {
  const half = world.terrain.worldSize / 2;
  nx = Math.max(-half, Math.min(half, nx));
  nz = Math.max(-half, Math.min(half, nz));
  const mx = nx - r.x, mz = nz - r.z;
  r.travelled += Math.sqrt(mx * mx + mz * mz);
  r.x = nx; r.z = nz;
}

function guidedStep(world, r, ci) {
  const t = world.terrain, n = t.size;
  const d = downhill(t, ci);
  if (d < 0) return;
  const tx = ((d % n) / (n - 1) - 0.5) * t.worldSize, tz = (Math.floor(d / n) / (n - 1) - 0.5) * t.worldSize;
  r.dx = tx - r.x; r.dz = tz - r.z;
  normalize(r);
  r.speed = TUNE.minSpeed * 2;
  moveTo(world, r, r.x + r.dx * r.speed * DT, r.z + r.dz * r.speed * DT);
  r.low = Math.min(r.low, surfaceAt(world, r.x, r.z, r.idx));
}

function afterMove(world, r) {
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

// Record a path point and dig the channel under it: a flat-bottomed trench at
// (centre surface - depth), feathered at the banks.
function pushPathPoint(world, r) {
  const t = world.terrain, n = t.size, cell = t.cell;
  // Bed depth is measured from undug ground, so passes never stack into a pit.
  const centre = surfaceAt(world, r.x, r.z, r.idx);
  const bed = Math.min(centre, sampleFilled(t, r.x, r.z)) - TUNE.depth;
  r.path.push({ x: r.x, z: r.z, water: centre - TUNE.depth * 0.3, tick: world.tick });

  const rad = TUNE.width / 2, feather = cell * 0.6;
  const gx = (r.x / t.worldSize + 0.5) * (n - 1), gy = (r.z / t.worldSize + 0.5) * (n - 1);
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
        world.carve[k] = Math.min(want, TUNE.depth * 3);
        world.owner[k] = r.idx;
        world.dirty.push(k);
      }
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
    mix(Math.round(r.x * 100)); mix(Math.round(r.z * 100)); mix(r.finishTick); mix(r.path.length);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
