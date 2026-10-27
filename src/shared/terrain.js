// Island generator. Pure data, no three.js — the server will run this too.
// Rules: deterministic from (seed, size); no transcendental Math feeding state.

import { hash2 } from './rng.js';

export const SEA_LEVEL = 0;
// Filled cells deeper than this count as lakes; shallower fills read as flats.
export const LAKE_MIN_DEPTH = 2;
const FILL_EPS = 0.01; // metres; keeps every filled cell strictly above its outlet

// Defaults: a ~48 km square map with an island ~40 km tall, peaks near 2 km.
export const DEFAULTS = { size: 512, worldSize: 48000, maxHeight: 2100, seaDepth: 220 };

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

// Raw height field: an elongated north-south island with a mountain spine
// set west of centre, a narrow northern cape and noisy coasts.
function rawHeight(u, v, seed, maxHeight, seaDepth) {
  // u, v in [-1, 1]; v = -1 is north.
  const wx = u + 0.18 * (fbm(u * 2.2, v * 2.2, seed + 11, 4) - 0.5);
  const wy = v + 0.18 * (fbm(u * 2.2 + 5, v * 2.2 - 3, seed + 23, 4) - 0.5);

  // Cape: the north narrows to a finger.
  const capeK = smooth(-0.35, -0.95, wy);
  const halfW = lerp(0.5, 0.16, capeK);
  const ex = (wx + 0.05 * capeK) / halfW, ey = wy / 0.88;
  let d2 = ex * ex + ey * ey;
  d2 += 0.55 * (fbm(u * 5, v * 5, seed + 31, 5) - 0.5);
  const land = smooth(1.0, 0.55, d2);

  // Spine: strongest along a line west of centre, fading to the coasts.
  const sx = (wx + 0.12) / 0.42;
  const spine = clamp01(1 - sx * sx) * smooth(1.05, 0.25, ey * ey);
  const peaks = ridged(u * 3.1, v * 3.1, seed + 47, 6);
  const hills = fbm(u * 6, v * 6, seed + 59, 5);

  // A dome under everything tilts the interior seaward, so only a few basins
  // survive the fill as lakes instead of every valley floor.
  const dome = clamp01(1 - d2);
  const elev = 0.02 + 0.1 * hills * dome + 0.3 * dome + 0.65 * spine * peaks;
  // Both branches meet at -0.15 * seaDepth where land reaches 0.
  if (land > 0) return lerp(-seaDepth * 0.15, elev * maxHeight, smooth(0.0, 0.35, land));
  // Reach full depth before the map edge so the seabed outside matches.
  const deep = Math.max(smooth(1.0, 2.2, d2), smooth(0.75, 0.97, Math.max(Math.abs(u), Math.abs(v))));
  return -seaDepth * lerp(0.15, 1, deep);
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
  for (let y = 0; y < n; y++) {
    const v = (y / (n - 1)) * 2 - 1;
    for (let x = 0; x < n; x++) {
      const u = (x / (n - 1)) * 2 - 1;
      height[y * n + x] = rawHeight(u, v, seed, maxHeight, seaDepth);
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
