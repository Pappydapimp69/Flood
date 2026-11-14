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

// Island shape, drawn from the seed: a long, walled ski slope with three
// summits side by side across its top end. Which way it points, its length, its width and how it
// tapers. No trig (the direction is a
// unit vector from sqrt), so every machine builds the same island.
// A mixed course (owner, 2026-11-09): below the summits the slope runs through four sections in an
// order set by the island: a slalom (the gates), a gorge (the corridor pinches to under half), a
// switchback (the corridor winds side to side) and terraces (flat benches and drops).
const SECTION = { from: 0.32, len: 0.15 };
function sectionsOf(seed) {
  const r = stream(seed, 'sections'), kinds = ['slalom', 'gorge', 'switchback', 'terraces'];
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  return kinds.map((kind, i) => ({ kind, t0: SECTION.from + i * SECTION.len }));
}
export const sectionsOfExport = (seed) => sectionsOf(seed);
// Spines (owner, 2026-11-12: ridges and canyons must shape the course): a wall of rock running down
// the slope through the switchback and the terraces, taller than any head or Gouge passes, so the
// course forks round its prow into two valleys and a river commits to one for the whole stretch.
// It stands well off the centre line: the far side is a narrow canyon where water runs fast
// (the speed rule saturates on any slope, so without that every route ran at one pace and the
// walls changed no result); the near side is the wide valley the trough leads into unsteered.
function spinesOf(seed) {
  if (!ISLAND.spines) return [];
  const r = stream(seed, 'spines'), out = [];
  for (const sec of sectionsOf(seed)) {
    if (sec.kind !== 'switchback' && sec.kind !== 'terraces') continue; // the slalom's gates and the gorge are squeezes already
    const side = r() < 0.5 ? -1 : 1, v = side * (SPINE.off[0] + (SPINE.off[1] - SPINE.off[0]) * r()), slant = (r() * 2 - 1) * SPINE.slant;
    if (out.length < ISLAND.spines) out.push({ t0: sec.t0 + 0.01, len: SECTION.len - 0.02, v, slant });
  }
  return out;
}
// Ridges (owner, 2026-11-14: obstacles are a slight ridge running side to side, not cones in one spot):
// low banks of pebble under turf laid across the slope, slanted down toward one gap near a wall. A river
// that meets one goes round along it to the gap, grinds through it (turf wears fast, pebble at a quarter of
// that rate: TUNE.pebbleWear), or times a skill to crest it: the low one Surge clears, the tall one needs
// Gouge or a long grind. One above the sections, one in the middle of each of the switchback and the terraces.
const RIDGE = { thick: 0.008, open: 0.5, slant: 0.03, turf: 2, heights: [18, 45, 30] };
function ridgesOf(seed) {
  if (!ISLAND.ridges) return [];
  const r = stream(seed, 'ridges'), secs = sectionsOf(seed);
  const at = [0.25, ...secs.filter((x) => x.kind === 'switchback' || x.kind === 'terraces').map((x) => x.t0 + SECTION.len / 2)];
  return at.map((t, i) => ({ t: t + 0.01 * (r() * 2 - 1), side: (i % 2 ? 1 : -1) * (r() < 0.5 ? 1 : -1), height: RIDGE.heights[i % RIDGE.heights.length] }));
}
const slalomT = (seed, i) => { const sl = sectionsOf(seed).find((x) => x.kind === 'slalom'); return sl.t0 + SECTION.len * (i + 0.5) / GATES(); };
const fract = (x) => x - Math.floor(x);
const windowAt = (t, t0) => { const u = clamp01((t - t0) / SECTION.len); return 16 * u * u * (1 - u) * (1 - u); }; // 0 at the ends, 1 mid

function shapeOf(seed) {
  const r = stream(seed, 'shape');
  let ax = r() * 2 - 1, ay = r() * 2 - 1;
  const len = Math.sqrt(ax * ax + ay * ay) || 1;
  ax /= len; ay /= len;
  return {
    ax, ay, // down the slope: summit end at -long, sea end at +long
    long: 0.62 + 0.06 * r(), // half-length along the axis (fits the map in any direction)
    shift: ISLAND.shift, // the whole island sits this far toward the sea end, for room behind the start
    wide: (0.17 + 0.05 * r()) * ISLAND.wide, // half-width of the corridor
    gap: 0.08 + 0.01 * r(), // how far the outer summits stand from the middle one
    taper: (0.25 + 0.2 * r()) * ISLAND.taper, // how much the width wanders along the slope
    warp: (0.05 + 0.04 * r()) * ISLAND.warp,
    wall: 0.08 + 0.03 * r(), // side walls, as a share of the top height
    // Lake basins: bowls sunk into the slope below the summits, which the
    // fill turns into lakes. Where along (t) and across (v, share of the
    // half-width) each sits, and its radius.
    lakes: Array.from({ length: LAKES() }, (_, i) => ({
      t: 0.2 + (0.7 * (i + r())) / LAKES(),
      v: (r() * 2 - 1) * 0.55,
      rad: 0.018 + 0.025 * r(),
    })),
    // Gates down the lower slope: rock ridges across the run, each a V
    // pointing downhill with one gap at its tip, the gaps alternating sides.
    // Water hitting an arm slides along it to the gap, slowly; a river aimed
    // at the gap early keeps its speed, and everyone squeezes through the
    // same notch.
    sections: sectionsOf(seed),
    spines: spinesOf(seed),
    ridges: ridgesOf(seed),
    gates: Array.from({ length: GATES() }, (_, i) => ({
      t: ISLAND.mixed ? slalomT(seed, i) : 0.4 + (0.5 * (i + 0.3 + 0.4 * r())) / GATES(),
      v: (i % 2 ? 1 : -1) * (0.4 + 0.25 * r()), // a slalom: gaps 0.4-0.65 out to alternate sides (was 0.2-0.5; 0.5-0.7 left a river facing a cliff on one island; owner 2026-11-09)
    })),
  };
}

// The Tutorial's training course: one fixed, straight run, built to teach.
// Down the middle: a lake at 0.30, a flat for Surge at 0.42, a rock ridge
// across the run at 0.55 (its only gap is hard against the left wall, so
// Gouge is the way over), open slope for a storm at 0.70, then the beach.
export const TUTORIAL = { seed: 9_999_001, lake: 0.3, surge: 0.42, ridge: 0.55, storm: 0.7 };
function tutorialShape() {
  return {
    ax: 0, ay: 1, long: 0.62, wide: 0.19, gap: 0.085, taper: 0.05, warp: 0, wall: 0.1,
    lakes: [{ t: TUTORIAL.lake, v: 0, rad: 0.03 }, { t: 0.8, v: 0.45, rad: 0.02 }],
    gates: [{ t: TUTORIAL.ridge, v: -0.85 }],
  };
}

// Raw height field: a long corridor falling from a summit at one end to the
// sea at the other, walled along both sides so every river runs the same way
// and meets the others, with hills, dips and gullies down its floor.
function rawHeight(x, y, seed, maxHeight, seaDepth, S) {
  // x, y in [-1, 1]; u runs down the slope, v across it.
  const u = x * S.ax + y * S.ay - (S.shift ?? 0), v = -x * S.ay + y * S.ax; // shift: the island sits toward the sea end
  lastFast = 0;
  const wu = u + S.warp * (fbm(x * 2.2, y * 2.2, seed + 11, 4) - 0.5);
  let wv = v + S.warp * (fbm(x * 2.2 + 5, y * 2.2 - 3, seed + 23, 4) - 0.5);
  const t = (wu + S.long) / (2 * S.long); // 0 at the summit end, 1 at the sea end
  // Width wanders and tapers at both ends.
  let halfW = S.wide * (1 + S.taper * (fbm(t * 3.1, 0.5, seed + 31, 3) - 0.5) * 2) * (0.75 + 0.25 * smooth(0.0, 0.2, t)) * (1 - 0.3 * smooth(0.85, 1.0, t));
  // The mixed course's gorge and switchback bend the corridor itself.
  for (const sec of ISLAND.mixed ? S.sections ?? [] : []) {
    const w = windowAt(t, sec.t0);
    if (!w) continue;
    if (sec.kind === 'gorge') halfW *= 1 - 0.55 * w;
    if (sec.kind === 'switchback') { const q = fract((t - sec.t0) / SECTION.len), tri = 1 - 4 * Math.abs(q - 0.5); wv -= 0.3 * halfW * w * tri * (3 - 2 * Math.abs(tri)) / 2; } // one long S (0.6 and two bends crowded rivers into the bends: 26 of 37 non-finishers)
  }
  // Wide enough at the top for three summits side by side inside the walls.
  const topW = ((S.gap + SUMMIT.room) / 0.62) * (1 - smooth(0.15, 0.35, t));
  const side = Math.abs(wv) / Math.max(halfW, topW); // 0 down the middle, 1 at the wall tops
  inCourse = !(side > 1 || t < -0.03 || t > 1.08);
  lastT = t; lastSide = side;
  if (!inCourse) {
    // Behind and beside the summits: the mountain's far side, falling away to
    // the sea. Scenery only: no spawns, no landings, no lakes (the course mask).
    const bt = clamp01((SUMMIT.at + 0.02 - t) / BACK.len); // 0 at the summits, 1 at the far shore
    const sideB = Math.abs(wv) / (Math.max(halfW, topW) * (1 + BACK.spread * bt));
    if (t < SUMMIT.at + 0.12 && t > -BACK.len && sideB < 1.6) {
      const crest = SUMMIT.top * maxHeight * 0.95;
      const rough = ridged(x * 3.4, y * 3.4, seed + 71, 5);
      const along = (1 - bt) * (1 - bt) * (0.75 + 0.3 * rough); // high near the peaks, down to the shore
      const across = 1 - smooth(0.9, 1.6, sideB); // falls away to the sides
      const edge = 1 - smooth(0.82, 0.95, Math.max(Math.abs(x), Math.abs(y))); // always open sea at the map edge
      const land = (crest * along * across + 160 * (rough - 0.5) * across) * edge - 30 * (1 - edge);
      if (land > 0) return land;
    }
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
  // Terraces: flat benches, then a drop, about every 3% of the slope.
  for (const sec of ISLAND.mixed ? S.sections ?? [] : []) {
    if (sec.kind !== 'terraces' || !windowAt(tt, sec.t0)) continue;
    floor += maxHeight * 0.9 * 0.03 * 0.8 * (fract((tt - sec.t0) / 0.03) - 0.5) * Math.min(1, windowAt(tt, sec.t0) * 2);
  }
  // A gentle trough down the middle so water gathers toward the centre line.
  floor += ISLAND.trough * side * side;
  // Walls along both sides, high enough that no river climbs out.
  const wall = smooth(0.62, 0.97, side) * maxHeight * S.wall * (1 + 0.8 * (1 - tt)) * (0.8 + 0.4 * peaks);
  // The summits: one cone at the top of each lane, all the same height, with
  // an even grade all round (no flat top to stall on). The starts ring them.
  const su = (t - SUMMIT.at) * (2 * S.long), so = S.gap;
  let cone = -Infinity;
  for (const c of [-so, 0, so]) {
    const sv = wv - c;
    cone = Math.max(cone, SUMMIT.top * maxHeight - SUMMIT.grade * Math.sqrt(su * su + sv * sv));
  }
  // Walls stand on top of the cones too, and close the slope off behind the
  // summits, so all water runs down toward the sea end.
  // Near the top the walls stand as high as the summits, so no water off a
  // summit can spill over the side or back.
  const crest = SUMMIT.top * maxHeight * 0.995;
  const tall = smooth(0.62, 0.97, side) * crest * (1 - smooth(0.15, 0.4, t));
  const back = smooth(SUMMIT.at - 0.04, -0.02, t) * crest;
  let h = Math.max(Math.max(floor, cone) + wall, tall, back);
  // Gates: a ridge GATE.height tall, GATE.thick wide, along each V's arms,
  // open for GATE.gap either side of its tip.
  const sv = wv / halfW;
  for (const G of S.gates) {
    const off = Math.abs(sv - G.v);
    if (off < GATE.gap) continue;
    const d = (t - (G.t - GATE.spread * off)) * (2 * S.long) / GATE.thick;
    if (d > -1 && d < 1) h += GATE.height * (1 - d * d) * (0.8 + 0.4 * peaks);
  }
  // Ridges: across from one wall to RIDGE.open of the half-width on the gap's side, slanting down toward
  // the gap, rounded in section and easing out at the gap end.
  lastRidge = 0; lastRidgeD = 0;
  for (const R of S.ridges ?? []) {
    const reach = sv * R.side; // 1 toward the gap's wall, -1 toward the far wall
    if (reach > RIDGE.open) continue;
    const d = (t - (R.t + RIDGE.slant * (reach + 1) / 2)) * (2 * S.long) / RIDGE.thick;
    if (d <= -1 || d >= 1) continue;
    const lift = R.height * (1 - d * d) * smooth(RIDGE.open, RIDGE.open - 0.08, reach);
    h += lift;
    if (lift > lastRidge) { lastRidge = lift; lastRidgeD = d; }
  }
  // Lake basins: deep enough to hold water against the slope they sit on.
  for (const L of S.lakes) {
    const du = (t - L.t) * (2 * S.long), dv = wv - L.v * halfW;
    const q = (du * du + dv * dv) / (L.rad * L.rad);
    if (q < 1) h -= (40 + 2200 * L.rad) * (1 - q) * (1 - q);
  }
  // Spines: on top of everything (a lake bowl under one never notches it), steep-sided,
  // rising to full height over the first and last share of their run (the prow and the stern).
  for (const P of S.spines ?? []) {
    const q = (t - P.t0) / P.len;
    if (q <= 0 || q >= 1) continue;
    const c = P.v + P.slant * (q - 0.5), d = (sv - c) / SPINE.thick;
    // The wide valley is dammed part-way down, from the spine to the corridor wall: the water behind
    // it is a long lake (grow there, and cut your way out), while the canyon on the other side runs clear.
    const dq = (q - SPINE.damAt) * P.len * (2 * S.long) / SPINE.damThick;
    if (SPINE.dam && dq > -1 && dq < 1 && (sv - c) * Math.sign(P.v) < 0) h += SPINE.dam * (1 - dq * dq) * (0.9 + 0.2 * peaks);
    // The chute: a thin strip along the foot of the spine on its canyon side, where the water runs fast
    // (TUNE.canyonBoost). Thin on purpose: with the whole canyon fast, unsteered rivers fell into it by
    // their seat and won 6 of 12 test races; a strip has to be steered onto and held.
    const off = (sv - c) * Math.sign(P.v);
    if (off >= SPINE.thick * 0.8 && off < SPINE.thick + SPINE.chute) { lastFast = S.spines.indexOf(P) + 1; lastQ = q; }
    if (d <= -1 || d >= 1) continue;
    h += SPINE.height * (1 - d * d * d * d) * Math.min(1, q / SPINE.prow, (1 - q) / SPINE.prow) * (0.85 + 0.3 * peaks);
  }
  return h;
}

// Summit cones: peak height as a share of maxHeight, and metres of drop per
// unit of map half-width (32 km) away from the peak: an even grade.
// Island shape settings (exported so tuning passes can try others; defaults keep every island as it was).
// 2026-11-02 map pass: more lakes and a wider, winding corridor. wide 1.5 or warp 2 put
// a fifth of the start cells nearer another summit than their own; 1.3 / 1.5 keeps all of them.
export const ISLAND = { shift: 0.16, ridges: true, mixed: true, lakes: 20, gates: 5, spines: 0, // spines: wall ridges that fork the course (0: none). Off 2026-11-13: they changed no race result and left a bot unable to finish (seed 43); mixed: the four-section course (4 test races: finishes 8.3 -> 10.8, knockouts 3.25 -> 1.25)
  wide: 1.3, taper: 2, warp: 1.5, trough: 200 };
// trough: metres the floor rises toward the walls (was 60). 200 pulls routes toward the centre line so rivals
// cross each other's channels more: contacts +17% on two fresh sets of islands (12 and 16 races), finishes held.
const LAKES = () => ISLAND.lakes; // lake basins down the slope
const GATES = () => ISLAND.gates; // rock gates across the lower slope
const GATE = { height: 45, thick: 0.007, gap: 0.12, spread: 0.06 };
// height: metres (the tallest boulder is 220, a Gouge lifts a head 80). thick: half-width, as a share of the
// corridor's. off: how far off the centre line it stands. slant: how far it drifts across over its run. prow: share of its run it rises over.
// dam: metres (under a Gouge's 80, over any plain head), damAt: how far down the spine's run, damThick: half-width down the slope.
const SPINE = { height: 300, thick: 0.05, off: [0.12, 0.3], slant: 0.2, // (0.3-0.42 out and 0.08 slant left one bot run in 12 unable to finish: back as first measured)
  prow: 0.1, chute: 0.06, dam: 0, damAt: 0.65, damThick: 0.006 };
// dam is off: at 60 it floods the wide valley into one lake of 2,000 to 3,000 cells (10M L), and rivers skate across it,
// so unsteered rivers finished as often and as fast as without it (61 of 120, median 254 s vs 262 s; 2026-11-12).

const SUMMIT = { top: 1.2, grade: 7500, at: 0.1, room: 0.06 };
// The land behind the start line (scenery): how far back it runs (in slope lengths) and how much wider it spreads.
const BACK = { len: 0.45, spread: 0.8 }; // (len 0.2 until 2026-11-14: with the faster glide the comets started over the sea; with 0.45 and ISLAND.shift every one starts over the mountain)
let inCourse = true, lastT = 0, lastSide = 0, lastFast = 0, lastQ = 0, lastRidge = 0, lastRidgeD = 0; // set by rawHeight for the cell it just made
// Boulder outcrops down the course: rock no river passes over, Gouge or not
// (taller than any boosted head reaches). Baked into the ground before the
// fill, so water's routes, the map's distances and the bots all go round them.
// Rock domes of mixed height (owner: obstacles to plan for and overcome, not walls): half small (crest them
// with speed or Surge), a third medium (Gouge or a big river), the rest tall (go round).
export const BOULDERS = { count: 40, gap: 1100, from: 0.2, to: 0.93, side: 0.6, kinds: [[0.5, 10, 25, 2], [0.35, 40, 80, 3], [0.15, 150, 220, 3]] };

// The three peaks' cells, where each summit cone stands highest.
function summitCells(height, n, S) {
  const so = S.gap;
  const u = -S.long + SUMMIT.at * 2 * S.long + (S.shift ?? 0);
  return [-so, 0, so].map((v) => {
    const x = u * S.ax - v * S.ay, y = u * S.ay + v * S.ax;
    const cx = Math.round((x + 1) / 2 * (n - 1)), cy = Math.round((y + 1) / 2 * (n - 1));
    let best = cy * n + cx;
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
      const xx = cx + dx, yy = cy + dy;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const kk = yy * n + xx;
      if (height[kk] > height[best]) best = kk;
    }
    return best;
  });
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

function placeBoulders(seed, n, cell, height, mask, along, across) {
  const rng = stream(seed, 'boulders'), out = [];
  for (let tries = 0; tries < BOULDERS.count * 40 && out.length < BOULDERS.count; tries++) {
    const k = Math.floor(rng() * n * n), cx = k % n, cy = (k - cx) / n;
    if (!mask[k] || height[k] <= 5 || along[k] < BOULDERS.from || along[k] > BOULDERS.to || across[k] > BOULDERS.side) continue;
    if (out.some((b) => Math.hypot(b.cx - cx, b.cy - cy) * cell < BOULDERS.gap)) continue;
    let pick = rng(), kind = BOULDERS.kinds[0];
    for (const kd of BOULDERS.kinds) { if (pick < kd[0]) { kind = kd; break; } pick -= kd[0]; }
    const h = kind[1] + rng() * (kind[2] - kind[1]), rad = kind[3] + rng(); // a dome, rad cells across its half
    const R = Math.ceil(rad);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx, y = cy + dy, q = (dx * dx + dy * dy) / (rad * rad);
      if (q >= 1 || x < 1 || y < 1 || x >= n - 1 || y >= n - 1) continue;
      height[y * n + x] += h * (1 - q) * (1 - q) * (1 + 0.15 * (rng() - 0.5)); // rounded, a little rough
    }
    out.push({ cx, cy, rad, h });
  }
  return out;
}

export function generateIsland(seed = 1, opts = {}) {
  const { size: n, worldSize, maxHeight, seaDepth, course } = { ...DEFAULTS, ...opts };
  const height = new Float32Array(n * n), mask = new Uint8Array(n * n); // mask: 1 on the race slope, 0 on scenery and sea
  const along = new Float32Array(n * n), across = new Float32Array(n * n);
  const fast = new Uint8Array(n * n), mouths = []; // fast: canyon floor (which spine's, from 1); mouths: where each canyon opens
  const ridge = new Float32Array(n * n), ridgeFace = new Int8Array(n * n); // metres of ridge bank; -1 its uphill face, 1 its lee
  const shape = opts.course === 'tutorial' ? tutorialShape() : shapeOf(seed);
  for (let y = 0; y < n; y++) {
    const v = (y / (n - 1)) * 2 - 1;
    for (let x = 0; x < n; x++) {
      const u = (x / (n - 1)) * 2 - 1;
      height[y * n + x] = rawHeight(u, v, seed, maxHeight, seaDepth, shape);
      mask[y * n + x] = inCourse ? 1 : 0;
      along[y * n + x] = lastT; across[y * n + x] = lastSide;
      if (inCourse && lastRidge > 0.5) { ridge[y * n + x] = lastRidge; ridgeFace[y * n + x] = lastRidgeD < -0.25 ? -1 : lastRidgeD > 0.25 ? 1 : 0; }
      if (inCourse && lastFast && height[y * n + x] > SEA_LEVEL) {
        fast[y * n + x] = lastFast;
        if (lastQ > 0.08 && lastQ < 0.2) { const m = (mouths[lastFast - 1] ??= { x: 0, y: 0, n: 0 }); m.x += x; m.y += y; m.n++; }
      }
    }
  }
  const boulders = opts.course === 'tutorial' || opts.boulders === false ? [] : placeBoulders(seed, n, worldSize / (n - 1), height, mask, along, across);
  const filled = fillDepressions(height, n);
  // Where each canyon opens, in world metres (bots and the map aim for it from far off, as a player's eye does).
  const canyons = mouths.filter(Boolean).map((m) => ({ x: (m.x / m.n / (n - 1) - 0.5) * worldSize, z: (m.y / m.n / (n - 1) - 0.5) * worldSize }));
  return { seed, course, mask, boulders, fast, canyons, ridge, ridgeFace, ridgeTurf: RIDGE.turf, size: n, worldSize, cell: worldSize / (n - 1), maxHeight, height, filled,
    summits: summitCells(height, n, shape), axis: { x: shape.ax, y: shape.ay }, long: shape.long, shift: shape.shift ?? 0 };
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
    if (label[s] >= 0 || filled[s] - height[s] <= LAKE_MIN_DEPTH || (t.mask && !t.mask[s])) continue; // no lakes on the scenery
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
          if (label[k] < 0 && filled[k] - height[k] > LAKE_MIN_DEPTH && (!t.mask || t.mask[k])) { label[k] = id; queue[tail++] = k; }
        }
      }
    }
    lakes.push({ id, cells: tail, volume, gx: sx / tail, gy: sy / tail });
  }
  return { label, lakes };
}
