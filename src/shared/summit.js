// Summit Rush's island (docs/summit-rush.md): one jagged peak in the middle of a ring of mountains, ravines running
// off it in every direction that join, as real ones do, into three trunk valleys, and each trunk leaving through
// its own gorge (a breach in the ring) to the sea. Pure data, deterministic, no transcendental Math feeding state.
//
// The ravines are carved by stream-power erosion (dh/dt = U - K sqrt(A) S, solved implicitly a step at a time:
// Braun and Willett 2013) on a coarse grid over the basin. Only the three breaches are open at its edge, so every
// ravine has to find its way to one of them: twelve ravines become three valleys, and the rivers in them meet on
// the way down (a mass start funnelled into narrow ground: bs flood-93). What a river plays on down there is laid
// on the carved ground: lake bowls and rock bars along the channels (a string of lakes held by rock bars is what a
// glaciated valley has: paternoster lakes), and boulder fields beside them.

import { stream } from './rng.js';
import { lerp, clamp01, smooth, fbm, ridged } from './noise.js';
import { fillDepressions, MinHeap } from './terrain.js';

export const SUMMIT_ISLAND = {
  top: 2700, // the peak, metres
  lip: 520, // each trunk valley's floor where it leaves the basin through its breach
  cone: 17500, // the basin's radius: the ring of mountains stands here, metres from the peak
  rim: 900, // the ring's crest over the lip, at least
  coast: 27000, // the outer slope reaches the sea about here
  breachHalf: { slot: 180, lakes: 480, wide: 340, stacks: 360 }, // each breach's half-width, by its kind
  wall: 140, // a breach's walls over its floor
  grid: 150, steps: 120, // the erosion grid across the basin, and how many steps it runs
  lakes: 36, bars: 10, fields: 9, // what is laid along the channels: lake bowls, rock bars, boulder fields
  barHeights: [18, 45, 30], barTurf: 2, // a rock bar's crest over the channel (Surge clears the low one, the tall needs Gouge or a grind)
};
const S = SUMMIT_ISLAND;
const BREACHES = 3;
const TURN = { c: -0.5, s: Math.sqrt(3) / 2 }; // a third of a turn
// Sixteen points round a unit circle (exact halves and square roots: no trigonometry feeds the ground).
const RING = (() => { const h = Math.SQRT1_2, a = Math.sqrt(2 + Math.SQRT2) / 2, b = Math.sqrt(2 - Math.SQRT2) / 2; return [[1, 0], [a, b], [h, h], [b, a], [0, 1], [-b, a], [-h, h], [-a, b], [-1, 0], [-a, -b], [-h, -h], [-b, -a], [0, -1], [b, -a], [h, -h], [a, -b]]; })();
const OUTLET = 900; // half the width of a breach's opening in the basin's edge, metres

// The basin's ravines: stream-power erosion on a coarse grid, from a rough dome, with only the three breaches'
// openings as the fixed base level, so the drainage gathers into three valleys. Returns heights normalised
// 0 (a breach) to 1 (the peak), and the drainage it ended with (area and receiver per cell) to lay features along.
export function erodeCone(seed, Sh) {
  const m = S.grid, c = (2 * S.cone) / (m - 1), N = m * m;
  const h = new Float64Array(N), base = new Uint8Array(N), off = new Uint8Array(N), U = new Float64Array(N);
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    const k = y * m + x, px = x * c - S.cone, py = y * c - S.cone, r = Math.sqrt(px * px + py * py) / S.cone;
    if (r >= 1.02) { off[k] = 1; continue; } // outside the basin: no ground, no water
    let open = false, gate = 0;
    for (const b of Sh.breaches) { const al = px * b.x + py * b.y, ac = Math.abs(-px * b.y + py * b.x); if (al > 0) { gate = Math.max(gate, 1 - smooth(OUTLET, OUTLET * 4, ac)); if (ac < OUTLET) open = true; } }
    if (r >= 0.985 && open) { base[k] = 1; continue; }
    // A rough dome to start from, and uplift that varies a little, so the ravines don't come out as even spokes.
    // A concave cone, roughened and warped, so the first channels wander instead of running down the grid lines.
    const wx = px + 3000 * (fbm(px / 7000, py / 7000, seed + 3, 3) - 0.5), wy = py + 3000 * (fbm(px / 7000 + 9, py / 7000, seed + 4, 3) - 0.5);
    // Three valleys: the ground starts lower along each breach's bearing and higher on the divides between them,
    // more so further out, so water off the peak bends toward a valley floor long before the ring (left to a
    // plain dome it runs straight out and gathers in a ditch at the ring's foot: every river alone again).
    const wl = Math.sqrt(wx * wx + wy * wy) || 1;
    let nd = -2;
    for (const b of Sh.breaches) nd = Math.max(nd, (wx * b.x + wy * b.y) / wl);
    const divide = clamp01((1 - nd) * 3), dv = divide * divide * (3 - 2 * divide), rr = Math.min(r, 1);
    const dome = Math.max(0, 1 - r);
    h[k] = 1.4 * dome * Math.sqrt(dome) + 0.12 * (fbm(wx / 3000, wy / 3000, seed + 5, 5) - 0.5) + 0.6 * rr * dv;
    // Uplift: more on the divides and on the ring of mountains, except where a breach leaves.
    U[k] = (0.6 + 0.5 * fbm(px / 6000, py / 6000, seed + 9, 3)) * (0.55 + 0.9 * dv * rr + 2.4 * dome * dome) + 1.6 * smooth(0.85, 1, r) * (1 - gate);
  }
  const rec = new Int32Array(N), dist = new Float64Array(N), A = new Float64Array(N), stack = new Int32Array(N);
  const donors = new Int32Array(N * 8), nd = new Int32Array(N);
  const K = 0.04, dt = 1, D = [c, c * Math.SQRT2], pick = stream(seed, 'summit-flow'), lap = new Float64Array(N);
  for (let it = 0; it < S.steps; it++) {
    fillPits(h, base, m, off);
    // Each cell drains to its steepest lower neighbour (or, in a pit, its lowest one).
    nd.fill(0);
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
      const k = y * m + x;
      rec[k] = k; dist[k] = c;
      if (base[k] || off[k]) continue;
      // Stochastic steepest descent: a lower neighbour is picked with odds by its slope, which breaks up the
      // eight grid directions plain steepest descent locks channels onto.
      let total = 0, low = -1, lh = Infinity, ld = c;
      const cand = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= m || yy >= m) continue;
        const j = yy * m + xx, d = D[dx && dy ? 1 : 0], s = (h[k] - h[j]) / d;
        if (off[j]) continue;
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
    for (let k = 0; k < N; k++) if (rec[k] === k && !off[k]) {
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
    for (let y = 1; y < m - 1; y++) for (let x = 1; x < m - 1; x++) { const k = y * m + x; lap[k] = base[k] || off[k] || off[k - 1] || off[k + 1] || off[k - m] || off[k + m] ? 0 : h[k - 1] + h[k + 1] + h[k - m] + h[k + m] - 4 * h[k]; }
    for (let k = 0; k < N; k++) h[k] += 0.05 * lap[k];
  }
  let peak = 0;
  for (let k = 0; k < N; k++) peak = Math.max(peak, h[k]);
  for (let k = 0; k < N; k++) h[k] /= peak || 1;
  return { h, m, c, A, rec, off };
}

// Raise every pit to just above its spill point (priority flood from the base cells), so all water reaches the
// edge: a pit left in place drains nowhere, and everything above it would never erode.
function fillPits(h, base, m, off) {
  const done = new Uint8Array(m * m), heap = new MinHeap(m * 4);
  for (let k = 0; k < m * m; k++) if (base[k]) { done[k] = 1; heap.push(h[k], k); }
  while (heap.size) {
    const c = heap.pop(), cx = c % m, cy = (c - cx) / m;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if ((!dx && !dy) || x < 0 || y < 0 || x >= m || y >= m) continue;
      const k = y * m + x;
      if (done[k] || off[k]) continue;
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

export function shapeOf(seed) {
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
  // Sea stacks off the stacks breach's mouth.
  const sb = breaches.find((b) => b.kind === 'stacks');
  const stacks = !sb ? [] : Array.from({ length: 6 }, () => {
    const along = S.coast + 600 + 1400 * r(), side = (r() * 2 - 1) * 1600;
    return { x: sb.x * along - sb.y * side, y: sb.y * along + sb.x * side, rad: 90 + 70 * r(), h: 70 + 90 * r() };
  });
  return { breaches, stacks };
}

// Height at (px, py) metres from the map's centre (the peak). Sets `info` for the cell: on the course or not,
// and how far out it is (0 at the peak, 1 at the sea).
const info = { course: false, along: 0 };
function heightAt(E, Sh, seed, seaDepth, px, py) {
  const r = Math.sqrt(px * px + py * py), ux = r ? px / r : 1, uy = r ? py / r : 0;
  const rough = ridged(px / 3200, py / 3200, seed + 47, 5), crag = ridged(px / 900, py / 900, seed + 53, 4), hills = fbm(px / 1500, py / 1500, seed + 59, 4) - 0.5;
  info.course = false; info.along = clamp01(r / (S.coast + 1000));
  // The nearest breach, by direction (the largest dot product).
  let near = Sh.breaches[0], nd = -2;
  for (const b of Sh.breaches) { const d = ux * b.x + uy * b.y; if (d > nd) { nd = d; near = b; } }
  const along = px * near.x + py * near.y, across = -px * near.y + py * near.x;
  // The basin's own ground at this bearing (clamped to its edge): the eroded ravines, rock standing out of the
  // high ground and the ridges between ravines (not out of their floors, which stay clean for the water).
  const q = r / S.cone, k = q > 0.985 ? 0.985 / q : 1;
  const e = coneAt(E, px * k, py * k), qq = Math.min(q, 1);
  let basin = S.lip + (S.top - S.lip) * e + 18 * hills;
  basin += 260 * (rough - 0.4) * e * e + 40 * (crag - 0.45) * smooth(0.3, 0.7, e); // crags high up
  basin += 260 * smooth(0.12, 0, qq) * (rough - 0.3); // spires round the summit
  basin = Math.max(basin, S.lip + 2);
  let h;
  if (r < S.cone) {
    // Inside: the carved ground as it is (the erosion's own uplift at the edge is the ring of mountains).
    h = basin;
    info.course = true;
  } else {
    // Outside: the ring's crest just past the basin's edge, then its outer slope down to a ragged coast.
    const coastR = S.coast + 2500 * (fbm(ux * 3 + 7, uy * 3 - 2, seed + 71, 4) - 0.5);
    const rimTop = Math.max(basin + 60, S.lip + S.rim + 260 * (rough - 0.5) + 50 * (crag - 0.5));
    const fall = 1 - smooth(S.cone + 1600, coastR, r);
    h = lerp(basin, rimTop, smooth(S.cone, S.cone + 1400, r)) * fall * (0.35 + 0.65 * fall) + 60 * hills * (1 - fall) - 40 * smooth(coastR - 400, coastR + 400, r);
    if (r > coastR + 300) h = Math.min(h, -seaDepth * lerp(0.2, 1, smooth(coastR, coastR + 6000, r)));
  }
  // The breach this way: a gorge from the trunk valley's end out to the sea, winding a little.
  if (along > S.cone * 0.93) {
    const coastR = S.coast + 2500 * (fbm(ux * 3 + 7, uy * 3 - 2, seed + 71, 4) - 0.5);
    const wob = near.wob * (fbm(along / 4000, near.seedOff, seed + 13, 2) - 0.5) * 2 * smooth(S.cone + 800, S.cone + 3800, along);
    const be = Math.abs(across - wob) / (along < S.cone ? Math.max(near.half, OUTLET * 0.6) : near.half);
    const g = clamp01((along - S.cone) / (coastR - S.cone));
    let floor = lerp(S.lip - 2, -25, g * (0.4 + 0.6 * g)) + 5 * hills;
    floor = Math.max(-25, Math.min(floor, h - 35)); // always a gorge: its floor stays under the slope it cuts
    for (const lq of near.lakes) { const d = (g - lq) * (coastR - S.cone) / 500; if (d * d < 1) floor -= 40 * (1 - d * d); }
    if (be < 2.6) {
      const gorge = be < 1 ? floor + 20 * be * be : lerp(floor + 20, Math.max(h, floor + 20 + S.wall * (0.8 + 0.4 * rough)), smooth(1, 2.6, be));
      if (gorge < h) { h = gorge; if (be < 1.2) info.course = true; }
    }
  }
  // Sea stacks: rock pillars standing off the stacks breach's mouth.
  for (const st of Sh.stacks) {
    const d2 = ((px - st.x) ** 2 + (py - st.y) ** 2) / (st.rad * st.rad);
    if (d2 < 1) h = Math.max(h, st.h * (1 - d2 * d2 * d2) + 20 * rough);
  }
  if (h <= 0) info.course = false;
  return h;
}

// Where things go along the carved channels: sites picked from the erosion's own drainage (cells that gather
// enough ground to be a ravine or a trunk), far enough apart, each with the way its water runs.
function channelSites(E, seed) {
  const { m, c, A, rec, off } = E, r = stream(seed, 'summit-sites'), cand = [];
  for (let k = 0; k < m * m; k++) {
    if (off[k] || A[k] < 25) continue;
    const px = (k % m) * c - S.cone, py = Math.floor(k / m) * c - S.cone, q = Math.sqrt(px * px + py * py) / S.cone;
    if (q < 0.2 || q > 0.88) continue;
    // Which way the water runs here: four cells down the channel.
    let d = k;
    for (let i = 0; i < 4; i++) d = rec[d];
    const dx = (d % m) - (k % m), dy = Math.floor(d / m) - Math.floor(k / m), l = Math.sqrt(dx * dx + dy * dy);
    if (l < 2) continue;
    cand.push({ x: px, y: py, dx: dx / l, dy: dy / l, area: A[k], q });
  }
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  const take = (count, gap, taken, ok = () => true) => {
    const out = [];
    for (const s of cand) {
      if (out.length >= count) break;
      if (!ok(s) || [...taken, ...out].some((o) => (o.x - s.x) ** 2 + (o.y - s.y) ** 2 < gap * gap)) continue;
      out.push(s);
    }
    return out;
  };
  // Lakes go where the most water runs (a trunk or a big ravine), so most rivers meet several on the way down:
  // dropped on any channel, most sat on side ravines few rivers took (2 swallowed a race against the ski slope's 6).
  const lakes = take(S.lakes, 1250, [], (s) => s.area >= 80);
  const bars = take(S.bars, 2000, lakes, (s) => s.q > 0.3);
  const fields = take(S.fields, 2400, [...lakes, ...bars], (s) => s.q > 0.3);
  return { lakes, bars, fields, r };
}

// Lay the features on the fine grid. Lake bowls are sunk (the fill makes them lakes); rock bars are raised
// across the channel to one crest height, with a gap at one end; boulders are rock domes in fields.
function layFeatures(E, seed, n, worldSize, height, mask, ridge, ridgeFace) {
  const { lakes, bars, fields, r } = channelSites(E, seed), cell = worldSize / (n - 1), boulders = [];
  const at = (m) => Math.round((m / worldSize + 0.5) * (n - 1));
  const stamp = (x, y, radM, fn) => {
    const cx = at(x), cy = at(y), R = Math.ceil(radM / cell);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = cx + dx, yy = cy + dy;
      if (xx < 1 || yy < 1 || xx >= n - 1 || yy >= n - 1) continue;
      fn(yy * n + xx, (xx / (n - 1) - 0.5) * worldSize - x, (yy / (n - 1) - 0.5) * worldSize - y);
    }
  };
  for (const s of lakes) {
    const big = s.area > 400, rad = (big ? 430 : 270) + 150 * r(), depth = (big ? 45 : 32) + 12 * r();
    // A tarn: a bowl cut level into the slope, longer along the valley than across it. Its floor hangs from the
    // lowest point of its own edge (the lip the water leaves over), so the uphill side becomes a headwall and the
    // bowl holds water on any slope (a bowl merely sunk into a slope drains straight out of its low side).
    const ex = (a, b) => [s.x + a * rad * 1.4 * s.dx - b * rad * s.dy, s.y + a * rad * 1.4 * s.dy + b * rad * s.dx];
    let lip = Infinity;
    for (let i = 0; i < 16; i++) { const [x, y] = ex(RING[i][0], RING[i][1]); lip = Math.min(lip, height[at(y) * n + at(x)]); }
    stamp(s.x, s.y, rad * 1.5, (k, ox, oy) => {
      if (!mask[k]) return;
      const a = (ox * s.dx + oy * s.dy) / (rad * 1.4), b = (-ox * s.dy + oy * s.dx) / rad, d2 = a * a + b * b;
      if (d2 < 1) height[k] = Math.min(height[k], lip - depth * (1 - d2) * (1 - d2));
    });
  }
  bars.forEach((s, i) => {
    const H = S.barHeights[i % S.barHeights.length], half = 500 + 300 * r(), thick = 110, side = r() < 0.5 ? -1 : 1;
    const crest = height[at(s.y) * n + at(s.x)] + H;
    stamp(s.x, s.y, half + thick, (k, ox, oy) => {
      if (!mask[k]) return;
      const a = ox * s.dx + oy * s.dy, b = (-ox * s.dy + oy * s.dx) * side;
      if (Math.abs(a) > thick || Math.abs(b) > half) return;
      if (b > 150 && b < 150 + 1.6 * cell) return; // the gap, just off the channel's middle
      const up = Math.min(H, (crest - height[k]) * (1 - 0.35 * smooth(thick * 0.4, thick, Math.abs(a))));
      if (up < 1) return;
      height[k] += up; ridge[k] = up; ridgeFace[k] = a < -thick * 0.3 ? -1 : a > thick * 0.3 ? 1 : 0;
    });
  });
  // Boulder fields: rock domes of mixed height beside the channel (half low: crest them with speed or Surge;
  // a third medium: Gouge or a big river; the rest tall: go round), never one on top of another.
  const kinds = [[0.55, 10, 25, 1.3], [0.35, 40, 75, 1.7], [0.1, 110, 170, 2.2]];
  for (const s of fields) {
    for (let j = 0, tries = 0; j < 7 && tries < 40; tries++) {
      const bx = s.x + (r() * 2 - 1) * 900, by = s.y + (r() * 2 - 1) * 900, cx = at(bx), cy = at(by);
      if (cx < 3 || cy < 3 || cx >= n - 3 || cy >= n - 3 || !mask[cy * n + cx] || ridge[cy * n + cx] > 0) continue;
      if (boulders.some((b) => Math.hypot(b.cx - cx, b.cy - cy) < 4.5)) continue;
      let pick = r(), kind = kinds[0];
      for (const kd of kinds) { if (pick < kd[0]) { kind = kd; break; } pick -= kd[0]; }
      const h = kind[1] + r() * (kind[2] - kind[1]), rad = kind[3] + 0.6 * r();
      stamp(bx, by, rad * cell, (k, ox, oy) => {
        const d2 = (ox * ox + oy * oy) / (rad * rad * cell * cell);
        if (d2 < 1) height[k] += h * (1 - d2) * (1 - d2);
      });
      boulders.push({ cx, cy, rad, h });
      j++;
    }
  }
  return boulders;
}

export function generateSummit(seed, { n, worldSize, seaDepth }) {
  const Sh = shapeOf(seed), E = erodeCone(seed, Sh);
  const height = new Float32Array(n * n), mask = new Uint8Array(n * n), along = new Float32Array(n * n), across = new Float32Array(n * n);
  const ridge = new Float32Array(n * n), ridgeFace = new Int8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x, px = (x / (n - 1) - 0.5) * worldSize, py = (y / (n - 1) - 0.5) * worldSize;
    height[k] = heightAt(E, Sh, seed, seaDepth, px, py);
    mask[k] = info.course ? 1 : 0;
    along[k] = info.along;
  }
  const boulders = layFeatures(E, seed, n, worldSize, height, mask, ridge, ridgeFace);
  // The peak: the highest ground near the middle (the ring's crags can't take it).
  let top = (n >> 1) * n + (n >> 1);
  const R = Math.round(4000 / (worldSize / (n - 1)));
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const k = ((n >> 1) + dy) * n + (n >> 1) + dx; if (height[k] > height[top]) top = k; }
  // Puddles: a hollow of a few cells that the rock noise left is not a lake to swallow (they were three quarters
  // of the island's lakes, each announcing itself as it overflowed). Level them, and keep the lakes that are meant.
  let filled = fillDepressions(height, n);
  const seen = new Uint8Array(n * n);
  let levelled = false;
  for (let k0 = 0; k0 < n * n; k0++) {
    if (seen[k0] || !(filled[k0] - height[k0] > 0.3) || height[k0] <= 0) continue;
    const pit = [k0];
    seen[k0] = 1;
    for (let i = 0; i < pit.length; i++) {
      const c = pit[i], cx = c % n, cy = (c - cx) / n;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy, k = y * n + x;
        if (x < 0 || y < 0 || x >= n || y >= n || seen[k] || !(filled[k] - height[k] > 0.3)) continue;
        seen[k] = 1; pit.push(k);
      }
    }
    if (pit.length <= 6) { for (const k of pit) height[k] = filled[k]; levelled = true; }
  }
  if (levelled) filled = fillDepressions(height, n);
  return {
    seed, course: 'summit', mask, boulders, fast: new Uint8Array(n * n), canyons: [], ridge, ridgeFace, ridgeTurf: S.barTurf,
    size: n, worldSize, cell: worldSize / (n - 1), maxHeight: S.top, height, filled, along, across,
    summits: [top], centre: { x: 0, z: 0 }, breaches: Sh.breaches.map((b) => ({ kind: b.kind, x: b.x, z: b.y })),
    // No single downhill direction: the sim reads each spot's own way to the sea (courseDir in river.js).
    axis: { x: 0, y: 1 }, long: 0.5, shift: 0,
  };
}
