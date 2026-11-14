// Summit Rush's island (docs/summit-rush.md): one jagged peak in the middle, ravines running off it in every
// direction, a moat round the mountain that every ravine pours into over a waterfall, and four breaches through
// the moat's outer rim to the sea. Pure data, deterministic, no transcendental Math feeding state.
//
// The ravines are carved by stream-power erosion (dh/dt = U - K sqrt(A) S, solved implicitly a step at a time:
// Braun and Willett 2013) on a coarse grid over the cone, so they branch and join the way real ones do; the moat,
// the waterfalls and the breaches are drawn in, so every island has them.

import { stream } from './rng.js';
import { lerp, clamp01, smooth, fbm, ridged } from './noise.js';
import { fillDepressions, MinHeap } from './terrain.js';

export const SUMMIT_ISLAND = {
  top: 2700, // the peak, metres
  lip: 760, // the cone's edge, where the ravines pour over into the moat
  cone: 17500, // the cone's radius: the moat's inner edge, metres from the peak
  moat: 1400, moatFloor: 520, moatRise: 110, // the moat's width, its floor at a breach, how much higher it stands midway between two
  rim: 1100, // the rim's crest over the moat floor
  coast: 27000, // the outer slope reaches the sea about here
  breachHalf: { slot: 180, lakes: 480, wide: 340, stacks: 360 }, // each breach's half-width, by its kind
  wall: 140, // a breach's walls over its floor
  grid: 150, steps: 120, // the erosion grid across the cone, and how many steps it runs
};
const S = SUMMIT_ISLAND;
const BREACHES = 3, HALF_GAP_COS = 0.5; // cos of half the angle between two breaches (60 degrees)
const TURN = { c: -0.5, s: Math.sqrt(3) / 2 }; // a third of a turn

// The cone's ravines: stream-power erosion on a coarse grid, from a rough dome under even uplift, with the disc's
// edge as the fixed base level. Returns heights normalised 0 (edge) to 1 (peak).
function erodeCone(seed) {
  const m = S.grid, c = (2 * S.cone) / (m - 1), N = m * m;
  const h = new Float64Array(N), base = new Uint8Array(N), U = new Float64Array(N);
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    const k = y * m + x, px = x * c - S.cone, py = y * c - S.cone, r = Math.sqrt(px * px + py * py) / S.cone;
    if (r >= 0.985) { base[k] = 1; continue; }
    // A rough dome to start from, and uplift that varies a little, so the ravines don't come out as even spokes.
    // A concave cone, roughened and warped, so the first channels wander instead of running down the grid lines.
    const wx = px + 3000 * (fbm(px / 7000, py / 7000, seed + 3, 3) - 0.5), wy = py + 3000 * (fbm(px / 7000 + 9, py / 7000, seed + 4, 3) - 0.5);
    h[k] = (1 - r) * Math.sqrt(1 - r) + 0.12 * (fbm(wx / 3000, wy / 3000, seed + 5, 5) - 0.5);
    U[k] = 0.75 + 0.5 * fbm(px / 6000, py / 6000, seed + 9, 3);
  }
  const rec = new Int32Array(N), dist = new Float64Array(N), A = new Float64Array(N), stack = new Int32Array(N);
  const donors = new Int32Array(N * 8), nd = new Int32Array(N);
  const K = 0.04, dt = 1, D = [c, c * Math.SQRT2], pick = stream(seed, 'summit-flow'), lap = new Float64Array(N);
  for (let it = 0; it < S.steps; it++) {
    fillPits(h, base, m);
    // Each cell drains to its steepest lower neighbour (or, in a pit, its lowest one).
    nd.fill(0);
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
      const k = y * m + x;
      rec[k] = k; dist[k] = c;
      if (base[k]) continue;
      // Stochastic steepest descent: a lower neighbour is picked with odds by its slope, which breaks up the
      // eight grid directions plain steepest descent locks channels onto.
      let total = 0, low = -1, lh = Infinity, ld = c;
      const cand = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= m || yy >= m) continue;
        const j = yy * m + xx, d = D[dx && dy ? 1 : 0], s = (h[k] - h[j]) / d;
        if (s > 0) { cand.push(j, d, s); total += s; }
        if (h[j] < lh) { lh = h[j]; low = j; ld = d; }
      }
      let r = low, rd = ld;
      if (total > 0) {
        let u = pick() * total;
        for (let i = 0; i < cand.length; i += 3) { r = cand[i]; rd = cand[i + 1]; if ((u -= cand[i + 2]) <= 0) break; }
      }
      rec[k] = r; dist[k] = rd;
      donors[r * 8 + nd[r]++] = k;
    }
    // Downstream first: from every base cell, through its donors.
    let top = 0;
    for (let k = 0; k < N; k++) if (rec[k] === k) {
      let q = top; stack[top++] = k;
      for (; q < top; q++) { const a = stack[q]; for (let i = 0; i < nd[a]; i++) stack[top++] = donors[a * 8 + i]; }
    }
    // Drainage area, gathered upstream to downstream.
    A.fill(1);
    for (let i = top - 1; i >= 0; i--) { const k = stack[i]; if (rec[k] !== k) A[rec[k]] += A[k]; }
    // Uplift and incision, solved implicitly downstream to upstream (stable at any step).
    for (let i = 0; i < top; i++) {
      const k = stack[i];
      if (base[k]) { h[k] = 0; continue; }
      const r = rec[k], F = (K * dt * Math.sqrt(A[k]) * c) / dist[k];
      h[k] = (h[k] + dt * U[k] * 0.01 + F * h[r]) / (1 + F);
    }
    // Hillslope creep: rounds the ridges between channels, so ravines widen and merge as on a real slope.
    for (let y = 1; y < m - 1; y++) for (let x = 1; x < m - 1; x++) { const k = y * m + x; lap[k] = base[k] ? 0 : h[k - 1] + h[k + 1] + h[k - m] + h[k + m] - 4 * h[k]; }
    for (let k = 0; k < N; k++) h[k] += 0.08 * lap[k];
  }
  let peak = 0;
  for (let k = 0; k < N; k++) peak = Math.max(peak, h[k]);
  for (let k = 0; k < N; k++) h[k] /= peak || 1;
  return { h, m, c };
}

// Raise every pit to just above its spill point (priority flood from the base cells), so all water reaches the
// edge: a pit left in place drains nowhere, and everything above it would never erode.
function fillPits(h, base, m) {
  const done = new Uint8Array(m * m), heap = new MinHeap(m * 4);
  for (let k = 0; k < m * m; k++) if (base[k]) { done[k] = 1; heap.push(h[k], k); }
  while (heap.size) {
    const c = heap.pop(), cx = c % m, cy = (c - cx) / m;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if ((!dx && !dy) || x < 0 || y < 0 || x >= m || y >= m) continue;
      const k = y * m + x;
      if (done[k]) continue;
      done[k] = 1;
      if (h[k] <= h[c]) h[k] = h[c] + 1e-7;
      heap.push(h[k], k);
    }
  }
}

// Bilinear sample of the eroded cone at (px, py) metres from the peak.
function coneAt(E, px, py) {
  const gx = (px + S.cone) / E.c, gy = (py + S.cone) / E.c;
  const x0 = Math.max(0, Math.min(E.m - 2, Math.floor(gx))), y0 = Math.max(0, Math.min(E.m - 2, Math.floor(gy)));
  const fx = clamp01(gx - x0), fy = clamp01(gy - y0), i = y0 * E.m + x0, h = E.h;
  return lerp(lerp(h[i], h[i + 1], fx), lerp(h[i + E.m], h[i + E.m + 1], fx), fy);
}

function shapeOf(seed) {
  const r = stream(seed, 'summit');
  let ax = r() * 2 - 1, ay = r() * 2 - 1;
  const len = Math.sqrt(ax * ax + ay * ay) || 1;
  ax /= len; ay /= len;
  // Three breaches a third of a turn apart, each nudged a little, of three of the four kinds.
  const kinds = ['slot', 'lakes', 'wide', 'stacks'];
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  const breaches = [];
  let dx = ax, dy = ay;
  for (let i = 0; i < BREACHES; i++) {
    const j = (r() * 2 - 1) * 0.12, bx = dx - dy * j, by = dy + dx * j, l = Math.sqrt(bx * bx + by * by);
    breaches.push({ kind: kinds[i], x: bx / l, y: by / l, half: S.breachHalf[kinds[i]], wob: 500 + 700 * r(), seedOff: Math.floor(r() * 1000),
      lakes: kinds[i] === 'lakes' ? [0.25, 0.55].map((q) => q + 0.1 * r()) : [] });
    [dx, dy] = [dx * TURN.c - dy * TURN.s, dx * TURN.s + dy * TURN.c];
  }
  const moatLakes = Array.from({ length: 3 }, () => { const a = r() * 2 - 1, b = r() * 2 - 1, l = Math.sqrt(a * a + b * b) || 1; return { x: a / l, y: b / l, rad: 450 + 250 * r() }; });
  // Sea stacks off the stacks breach's mouth.
  const sb = breaches.find((b) => b.kind === 'stacks');
  const stacks = !sb ? [] : Array.from({ length: 6 }, () => {
    const along = S.coast + 600 + 1400 * r(), side = (r() * 2 - 1) * 1600;
    return { x: sb.x * along - sb.y * side, y: sb.y * along + sb.x * side, rad: 90 + 70 * r(), h: 70 + 90 * r() };
  });
  return { breaches, moatLakes, stacks };
}

// Height at (px, py) metres from the map's centre (the peak). Sets `info` for the cell: on the course or not,
// and how far out it is (0 at the peak, 1 at the sea).
const info = { course: false, along: 0 };
function heightAt(E, Sh, seed, seaDepth, px, py) {
  const r = Math.sqrt(px * px + py * py), ux = r ? px / r : 1, uy = r ? py / r : 0;
  const rough = ridged(px / 3200, py / 3200, seed + 47, 5), hills = fbm(px / 1500, py / 1500, seed + 59, 4) - 0.5;
  info.course = false; info.along = clamp01(r / (S.coast + 1000));
  // The nearest breach, by direction (the largest dot product), and the moat floor: lowest at a breach.
  let near = Sh.breaches[0], nd = -2;
  for (const b of Sh.breaches) { const d = ux * b.x + uy * b.y; if (d > nd) { nd = d; near = b; } }
  const moatFloor = S.moatFloor + S.moatRise * clamp01((1 - nd) / (1 - HALF_GAP_COS));
  // The cone: the eroded ravines, the peak jagged with rock, the edge at the lip.
  if (r < S.cone) {
    const e = coneAt(E, px, py), q = r / S.cone;
    let h = S.lip + (S.top - S.lip) * e + 220 * (rough - 0.4) * (1 - q) * (1 - q) + 18 * hills;
    h += 260 * smooth(0.12, 0, q) * (rough - 0.3); // spires round the summit
    info.course = true;
    return Math.max(h, S.lip + 4); // the cone's foot stays above the lip, so the waterfall is a real step down
  }
  // Out from the cone: the moat, the rim, the outer slope to the sea.
  const out = r - S.cone;
  const coastR = S.coast + 2500 * (fbm(ux * 3 + 7, uy * 3 - 2, seed + 71, 4) - 0.5);
  const rimTop = S.moatFloor + S.rim + 200 * (rough - 0.5);
  const fall = 1 - smooth(S.cone + S.moat, coastR, r);
  let ground = out < S.moat ? rimTop : rimTop * fall * fall + 60 * hills - 40 * smooth(coastR - 400, coastR + 400, r);
  if (r > coastR + 300) ground = Math.min(ground, -seaDepth * lerp(0.2, 1, smooth(coastR, coastR + 6000, r)));
  // The moat: a trough round the mountain, its floor sloping toward the breaches, a few lakes in it.
  const me = Math.abs(out - S.moat / 2) / (S.moat / 2);
  let moat = moatFloor + (me < 1 ? 12 * me * me : 12 + 700 * smooth(1, 1.6, me)) + 6 * hills;
  for (const L of Sh.moatLakes) {
    const cx = L.x * (S.cone + S.moat / 2), cy = L.y * (S.cone + S.moat / 2), d2 = ((px - cx) ** 2 + (py - cy) ** 2) / (L.rad * L.rad);
    if (d2 < 1) moat -= 45 * (1 - d2) * (1 - d2);
  }
  if (me < 1) info.course = true;
  let h = Math.min(ground, moat);
  // The breach this way: a gorge from the moat out to the sea, winding a little.
  const along = px * near.x + py * near.y, across = -px * near.y + py * near.x;
  if (along > S.cone) {
    const wob = near.wob * (fbm(along / 4000, near.seedOff, seed + 13, 2) - 0.5) * 2 * smooth(S.cone + S.moat, S.cone + S.moat + 3000, along);
    const be = Math.abs(across - wob) / near.half;
    const q = clamp01((along - S.cone - S.moat / 2) / (coastR - S.cone - S.moat / 2));
    let floor = lerp(S.moatFloor - 2, -25, q * (0.4 + 0.6 * q)) + 5 * hills;
    for (const lq of near.lakes) { const d = (q - lq) * (coastR - S.cone) / 500; if (d * d < 1) floor -= 40 * (1 - d * d); }
    const gorge = floor + (be < 1 ? 20 * be * be : 20 + S.wall * (0.8 + 0.4 * rough) * smooth(1, 1.5, be));
    if (gorge < h) { h = gorge; if (be < 1.2) info.course = true; }
  }
  // Sea stacks: rock pillars standing off the stacks breach's mouth.
  for (const st of Sh.stacks) {
    const d2 = ((px - st.x) ** 2 + (py - st.y) ** 2) / (st.rad * st.rad);
    if (d2 < 1) h = Math.max(h, st.h * (1 - d2 * d2 * d2) + 20 * rough);
  }
  if (h <= 0) info.course = false;
  return h;
}

export function generateSummit(seed, { n, worldSize, seaDepth }) {
  const E = erodeCone(seed), Sh = shapeOf(seed);
  const height = new Float32Array(n * n), mask = new Uint8Array(n * n), along = new Float32Array(n * n), across = new Float32Array(n * n);
  let top = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x, px = (x / (n - 1) - 0.5) * worldSize, py = (y / (n - 1) - 0.5) * worldSize;
    height[k] = heightAt(E, Sh, seed, seaDepth, px, py);
    mask[k] = info.course ? 1 : 0;
    along[k] = info.along;
    if (height[k] > height[top]) top = k;
  }
  const filled = fillDepressions(height, n);
  return {
    seed, course: 'summit', mask, boulders: [], fast: new Uint8Array(n * n), canyons: [], ridge: new Float32Array(n * n), ridgeFace: new Int8Array(n * n), ridgeTurf: 0,
    size: n, worldSize, cell: worldSize / (n - 1), maxHeight: S.top, height, filled, along, across,
    summits: [top], centre: { x: 0, z: 0 }, breaches: Sh.breaches.map((b) => ({ kind: b.kind, x: b.x, z: b.y })),
    // No single downhill direction: the sim reads each spot's own way to the sea (courseDir in river.js).
    axis: { x: 0, y: 1 }, long: 0.5, shift: 0,
  };
}
