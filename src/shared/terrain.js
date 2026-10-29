// Island generator. Pure data, no three.js — the server will run this too.
// Rules: deterministic from (seed, size); no transcendental Math feeding state.

import { hash2, stream } from './rng.js';

export const SEA_LEVEL = 0;
// Filled cells deeper than this count as lakes; shallower fills read as flats.
export const LAKE_MIN_DEPTH = 2;
const FILL_EPS = 0.01; // metres; keeps every filled cell strictly above its outlet

// Defaults: a 64 km square map, a ski-slope island about 40 km long, a summit near 3 km.
export const DEFAULTS = { size: 640, worldSize: 64000, maxHeight: 2400, seaDepth: 220 };

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = fade(x - xi), v = fade(y - yi);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function fbm(x, y, seed, octaves) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, seed + o * 1013);
    norm += amp;
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.7;
    amp *= 0.5;
  }
  return sum / norm;
}

function ridged(x, y, seed, octaves) {
  let sum = 0, amp = 0.5, norm = 0, prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(2 * valueNoise(x, y, seed + o * 7919) - 1);
    n *= n;
    sum += amp * n * prev;
    norm += amp;
    prev = n;
    x = x * 2.11 + 3.3;
    y = y * 2.11 + 41.9;
    amp *= 0.5;
  }
  return sum / norm;
}

// Island shape, drawn from the seed: a long, narrow ski slope. Which way it
// points, its length, its width and how it tapers. No trig (the direction is a
// unit vector from sqrt), so every machine builds the same island.
function shapeOf(seed) {
  const r = stream(seed, 'shape');
  let ax = r() * 2 - 1, ay = r() * 2 - 1;
  const len = Math.sqrt(ax * ax + ay * ay) || 1;
  ax /= len; ay /= len;
  return {
    ax, ay, // down the slope: summit end at -long, sea end at +long
    long: 0.62 + 0.06 * r(), // half-length along the axis (fits the map in any direction)
    wide: 0.17 + 0.05 * r(), // half-width of the corridor
    taper: 0.25 + 0.2 * r(), // how much the width wanders along the slope
    warp: 0.05 + 0.04 * r(),
    wall: 0.08 + 0.03 * r(), // side walls, as a share of the top height
  };
}

// Raw height field: a long corridor falling from a summit at one end to the
// sea at the other, walled along both sides so every river runs the same way
// and meets the others, with hills, dips and gullies down its floor.
function rawHeight(x, y, seed, maxHeight, seaDepth, S) {
  // x, y in [-1, 1]; u runs down the slope, v across it.
  const u = x * S.ax + y * S.ay, v = -x * S.ay + y * S.ax;
  const wu = u + S.warp * (fbm(x * 2.2, y * 2.2, seed + 11, 4) - 0.5);
  const wv = v + S.warp * (fbm(x * 2.2 + 5, y * 2.2 - 3, seed + 23, 4) - 0.5);
  const t = (wu + S.long) / (2 * S.long); // 0 at the summit end, 1 at the sea end
  // Width wanders and tapers at both ends.
  const halfW = S.wide * (1 + S.taper * (fbm(t * 3.1, 0.5, seed + 31, 3) - 0.5) * 2) * (0.75 + 0.25 * smooth(0.0, 0.2, t)) * (1 - 0.3 * smooth(0.85, 1.0, t));
  const side = Math.abs(wv) / halfW; // 0 down the middle, 1 at the wall tops
  if (side > 1 || t < -0.03 || t > 1.08) {
    // Outside the slope: cliffs into deep sea.
    const out = Math.max(side - 1, -t, t - 1.08, 0);
    return -seaDepth * lerp(0.35, 1, smooth(0, 0.25, out));
  }
  const peaks = ridged(x * 3.1, y * 3.1, seed + 47, 6);
  const hills = fbm(x * 7, y * 7, seed + 59, 5);
  // The floor falls the whole way to the sea, a little steeper near the top.
  const tt = clamp01(t);
  const a = 1 - tt; // no pow (transcendental): a blend of a and a squared
  let floor = maxHeight * 0.9 * a * (0.7 + 0.3 * a) - 40 * smooth(0.9, 1.05, t);
  // Hills, dips and gullies down the floor, stronger high up.
  floor += (hills - 0.5) * (90 + 140 * (1 - tt)) + (peaks - 0.4) * 120 * (1 - tt);
  // A gentle trough down the middle so water gathers toward the centre line.
  floor += 60 * side * side;
  // Walls along both sides, high enough that no river climbs out.
  const wall = smooth(0.62, 0.97, side) * maxHeight * S.wall * (1 + 0.8 * (1 - tt)) * (0.8 + 0.4 * peaks);
  // The summit: a small flat-topped peak at the top end, above the walls: the
  // start, every spot on it the same height.
  const su = (t - 0.06) * (2 * S.long), sv = wv;
  const c = clamp01(1 - (su * su + sv * sv) / 0.006);
  const top = maxHeight * 1.2;
  const h = floor + wall;
  return c > 0.6 ? top : lerp(h, top, smooth(0, 0.6, c));
}

// Priority-flood (Barnes 2014) with epsilon: raises every inland pit to its
// spill level so steepest descent from any land cell reaches the sea.
// Sea connected to the map edge keeps its depth.
function fillDepressions(h, n) {
  const filled = new Float32Array(h);
  const done = new Uint8Array(n * n);
  const heap = new MinHeap(n * 4);
  for (let i = 0; i < n; i++) {
    for (const idx of [i, (n - 1) * n + i, i * n, i * n + n - 1]) {
      if (!done[idx]) { done[idx] = 1; heap.push(filled[idx], idx); }
    }
  }
  while (heap.size) {
    const c = heap.pop();
    const hc = filled[c], cx = c % n, cy = (c - cx) / n;
    for (let dy = -1; dy <= 1; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= n) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        if ((dx === 0 && dy === 0) || x < 0 || x >= n) continue;
        const k = y * n + x;
        if (done[k]) continue;
        done[k] = 1;
        const hk = filled[k];
        if (!(hk <= SEA_LEVEL && hc <= SEA_LEVEL)) {
          const floor = Math.fround(Math.max(hc, SEA_LEVEL) + FILL_EPS);
          if (hk < floor) filled[k] = floor;
        }
        heap.push(filled[k], k);
      }
    }
  }
  return filled;
}

export function generateIsland(seed = 1, opts = {}) {
  const { size: n, worldSize, maxHeight, seaDepth } = { ...DEFAULTS, ...opts };
  const height = new Float32Array(n * n);
  const shape = shapeOf(seed);
  for (let y = 0; y < n; y++) {
    const v = (y / (n - 1)) * 2 - 1;
    for (let x = 0; x < n; x++) {
      const u = (x / (n - 1)) * 2 - 1;
      height[y * n + x] = rawHeight(u, v, seed, maxHeight, seaDepth, shape);
    }
  }
  const filled = fillDepressions(height, n);
  return { seed, size: n, worldSize, cell: worldSize / (n - 1), maxHeight, height, filled };
}

// Steepest-descent neighbour on the filled surface, or -1 at the sea.
export function downhill(t, idx) {
  const { size: n, filled } = t;
  if (filled[idx] <= SEA_LEVEL) return -1;
  const cx = idx % n, cy = (idx - cx) / n;
  let best = -1, bestDrop = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= n) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx;
      if ((dx === 0 && dy === 0) || x < 0 || x >= n) continue;
      const k = y * n + x;
      // Diagonals are ~1.414 cells away; compare drop per distance without sqrt.
      const drop = (filled[idx] - filled[k]) * (dx && dy ? 0.7071 : 1);
      if (drop > bestDrop) { bestDrop = drop; best = k; }
    }
  }
  return best;
}

// Bilinear sample in world metres (origin at map centre, +z south).
export function sampleHeight(t, wx, wz, field = t.height) {
  const n = t.size;
  const gx = (wx / t.worldSize + 0.5) * (n - 1);
  const gy = (wz / t.worldSize + 0.5) * (n - 1);
  const x0 = Math.max(0, Math.min(n - 2, Math.floor(gx)));
  const y0 = Math.max(0, Math.min(n - 2, Math.floor(gy)));
  const fx = clamp01(gx - x0), fy = clamp01(gy - y0);
  const i = y0 * n + x0;
  return lerp(lerp(field[i], field[i + 1], fx), lerp(field[i + n], field[i + n + 1], fx), fy);
}

export function stats(t) {
  const { size: n, height, filled } = t;
  let land = 0, lake = 0, peak = -Infinity;
  for (let i = 0; i < n * n; i++) {
    if (filled[i] > SEA_LEVEL) land++;
    if (filled[i] - height[i] > LAKE_MIN_DEPTH) lake++;
    if (height[i] > peak) peak = height[i];
  }
  return { landFraction: land / (n * n), lakeCells: lake, peak };
}

// Stable fingerprint of the generated surface (FNV over the float bits).
export function fingerprint(t) {
  const bits = new Uint32Array(t.filled.buffer, t.filled.byteOffset, t.filled.length);
  let h = 0x811c9dc5;
  for (let i = 0; i < bits.length; i++) h = Math.imul(h ^ bits[i], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class MinHeap {
  constructor(cap) {
    this.k = new Float64Array(cap);
    this.v = new Int32Array(cap);
    this.size = 0;
  }
  grow() {
    const k = new Float64Array(this.k.length * 2), v = new Int32Array(this.v.length * 2);
    k.set(this.k); v.set(this.v);
    this.k = k; this.v = v;
  }
  // Ties break on index so the fill order is fully deterministic.
  less(a, b) { return this.k[a] < this.k[b] || (this.k[a] === this.k[b] && this.v[a] < this.v[b]); }
  swap(a, b) {
    const k = this.k[a]; this.k[a] = this.k[b]; this.k[b] = k;
    const v = this.v[a]; this.v[a] = this.v[b]; this.v[b] = v;
  }
  push(key, val) {
    if (this.size === this.k.length) this.grow();
    let i = this.size++;
    this.k[i] = key; this.v[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p); i = p;
    }
  }
  pop() {
    const top = this.v[0];
    const last = --this.size;
    if (last > 0) {
      this.k[0] = this.k[last]; this.v[0] = this.v[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < last && this.less(l, m)) m = l;
        if (r < last && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
}

// Lakes: connected groups of cells filled deeper than LAKE_MIN_DEPTH (8-way),
// labelled in index order so ids are stable. volume is in cubic metres.
export function findLakes(t) {
  const { size: n, height, filled, cell } = t;
  const label = new Int32Array(n * n).fill(-1);
  const lakes = [];
  const queue = new Int32Array(n * n);
  for (let s = 0; s < n * n; s++) {
    if (label[s] >= 0 || filled[s] - height[s] <= LAKE_MIN_DEPTH) continue;
    const id = lakes.length;
    let head = 0, tail = 0, volume = 0, sx = 0, sy = 0;
    queue[tail++] = s;
    label[s] = id;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % n, cy = (c - cx) / n;
      volume += (filled[c] - height[c]) * cell * cell;
      sx += cx; sy += cy;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const k = y * n + x;
          if (label[k] < 0 && filled[k] - height[k] > LAKE_MIN_DEPTH) { label[k] = id; queue[tail++] = k; }
        }
      }
    }
    lakes.push({ id, cells: tail, volume, gx: sx / tail, gy: sy / tail });
  }
  return { label, lakes };
}
