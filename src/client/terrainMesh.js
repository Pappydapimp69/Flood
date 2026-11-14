import * as THREE from 'three';
import { SEA_LEVEL, LAKE_MIN_DEPTH } from '../shared/terrain.js';

// Render-only vertical exaggeration; game logic always uses true metres.
export const VERT = 2.4;

// Biome colours, after the trailer: olive grass with dry yellow patches, dark
// forest floor, grey-brown rock and scree high up and on steep ground, pale
// sand at the coast. The shader below adds slope rock and fine detail.
const C = {
  deep: new THREE.Color('#1d4d5e'),
  shallow: new THREE.Color('#6fa59a'),
  sand: new THREE.Color('#cdbb8a'),
  maquis: new THREE.Color('#77843f'),
  forest: new THREE.Color('#4a5a2c'),
  rock: new THREE.Color('#8a8172'),
  snow: new THREE.Color('#d8d6cf'),
  lake: new THREE.Color('#3f8f9f'),
};

const tmp = new THREE.Color();
const CANYON = new THREE.Color(0x3a5560);
// Ridges are turf over pebble. They read at speed by a pale crest line and a shaded lee (in flat light a
// slope shows no bumps until you are on them; cross courses paint their take-offs: bs flood-71, flood-74).
const CREST = new THREE.Color('#d9d08a');
const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// rugged: Summit Rush's peak, bare rock from about 1,100 m and on any steep ground (the trailer's grey crags).
function colorAt(h, slope, lakeDepth, out, rugged = false) {
  if (lakeDepth > LAKE_MIN_DEPTH) return out.copy(C.lake);
  if (rugged && h > SEA_LEVEL) {
    out.copy(C.sand).lerp(C.maquis, ss(4, 30, h)).lerp(C.forest, ss(150, 500, h) * (1 - ss(900, 1300, h)));
    out.lerp(C.rock, Math.max(ss(1000, 1500, h), ss(0.22, 0.5, slope)));
    return out.lerp(C.snow, ss(2450, 2650, h) * (1 - ss(0.5, 0.9, slope)));
  }
  if (h <= SEA_LEVEL) return out.copy(C.shallow).lerp(C.deep, ss(0, 120, -h)).lerp(C.sand, ss(-8, 0, h) * 0.6);
  out.copy(C.sand).lerp(C.maquis, ss(4, 30, h));
  out.lerp(C.forest, ss(250, 700, h) * (1 - ss(1700, 2100, h)));
  out.lerp(C.rock, Math.max(ss(1900, 2400, h), ss(0.45, 0.9, slope)));
  return out.lerp(C.snow, ss(2700, 2850, h) * (1 - ss(0.7, 1.1, slope)));
}

const BED = new THREE.Color('#7a6a55');

// ---- Baked light. The sun never moves and the ground is a height grid, so cast shadows and
// the shade in hollows are worked out once per island and multiplied into the vertex colours:
// no shadow maps, nothing per frame (the game already drops resolution on phones).
// sunOf: unit vector toward the sun for an island, low (about 27 degrees) and from the side of its
// course, a little from behind the start, so shadows rake across the run. (A fixed compass sun
// stood behind the summits on some islands and put the whole start in their shadow.)
export function sunOf(t) {
  const ax = t.axis?.x ?? 0, az = t.axis?.y ?? 1; // down the course
  const v = [-az * 0.95 - ax * 0.2, 0.5, ax * 0.95 - az * 0.2], l = Math.hypot(...v);
  return v.map((c) => c / l);
}
const SHADOW = [0.4, 0.48, 0.66]; // a fully shadowed colour keeps this much: cool, lit only by the sky
const TREE_SHADOW = 240; // metres (displayed) a tree stands over its cell, for the shadow it throws

// 1 where the sun reaches the ground, 0 in full shadow, soft at the edge. H: displayed heights.
// extra: metres added to cells that hold something tall (trees); it shades others, never itself.
function sunLit(SUN, n, cell, H, extra = null) {
  const hz = Math.hypot(SUN[0], SUN[2]), dx = SUN[0] / hz, dy = SUN[2] / hz, rise = (cell * SUN[1]) / hz;
  let top = -Infinity;
  for (let i = 0; i < n * n; i++) top = Math.max(top, H[i] + (extra ? extra[i] : 0));
  const out = new Float32Array(n * n).fill(1);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, h0 = H[i] + 3;
    if (H[i] < -20) continue; // deep seabed: under the sea surface anyway
    let lit = 1;
    for (let s = 1; s < 140; s++) {
      const ray = h0 + rise * s;
      if (ray > top) break;
      const px = x + dx * s, py = y + dy * s;
      if (px < 0 || py < 0 || px > n - 1 || py > n - 1) break;
      const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1), fx = px - x0, fy = py - y0;
      let g = (H[y0 * n + x0] * (1 - fx) + H[y0 * n + x1] * fx) * (1 - fy) + (H[y1 * n + x0] * (1 - fx) + H[y1 * n + x1] * fx) * fy;
      if (extra) g += extra[Math.round(py) * n + Math.round(px)];
      const clear = (ray - g) / (s * cell * 0.09); // a near miss is half shade: the penumbra widens with distance
      if (clear < lit) { lit = clear; if (lit <= 0) { lit = 0; break; } }
    }
    out[i] = lit;
  }
  return out;
}

// How open the sky is over each cell: 1 on a ridge or a plain, lower in gullies and at the foot of walls.
function skyOpen(n, cell, H) {
  const out = new Float32Array(n * n), dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    let sum = 0;
    for (const [ax, ay] of dirs) {
      let m = 0;
      for (const d of [1, 2, 4, 7]) {
        const px = Math.min(n - 1, Math.max(0, x + ax * d)), py = Math.min(n - 1, Math.max(0, y + ay * d));
        m = Math.max(m, (H[py * n + px] - H[i]) / (d * cell * Math.hypot(ax, ay)));
      }
      sum += m / (1 + m); // slope to the horizon that way, squashed to 0..1
    }
    out[i] = 1 - 0.75 * (sum / 8);
  }
  return out;
}

const litTint = (lit, c) => SHADOW[c] + (1 - SHADOW[c]) * lit;

// Trees throw shadows too (a pine stands about 250 m over its 100 m cell): darken the ground
// they shade. cells: the cells that hold a drawn tree. Once per island.
export function castTrees(mesh, cells) {
  const ud = mesh.userData, n = ud.t.size;
  if (ud.treesCast) return;
  ud.treesCast = true;
  const extra = new Float32Array(n * n);
  let any = false;
  for (const k of cells) { extra[k] = TREE_SHADOW; any = true; }
  if (!any) return;
  const lit = sunLit(ud.sun, n, ud.t.cell, ud.shown, extra), sh = mesh.geometry.attributes.shade;
  for (let i = 0; i < n * n; i++) {
    if (lit[i] >= ud.lit[i] - 0.01) continue;
    const l = ud.lit[i] + (lit[i] - ud.lit[i]) * 0.8; // a little light gets through the branches
    for (let c = 0; c < 3; c++) sh.array[i * 3 + c] = litTint(l, c) * ud.open[i];
  }
  sh.needsUpdate = true;
}

// Damp or dry, from the lie of the land: +1 in a hollow or beside a lake (lush), -1 on a
// crest or a spur (dry, stony). The ground's colour follows it, so the eye reads the relief.
function dampness(n, cell, H, lakeDepth) {
  const out = new Float32Array(n * n), R = 3;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    let sum = 0, near = 0;
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const k = Math.min(n - 1, Math.max(0, y + ay * R)) * n + Math.min(n - 1, Math.max(0, x + ax * R));
      sum += H[k];
      if (lakeDepth[Math.min(n - 1, Math.max(0, y + ay * 2)) * n + Math.min(n - 1, Math.max(0, x + ax * 2))] > LAKE_MIN_DEPTH) near = 1;
    }
    out[i] = Math.max(near * 0.85, Math.max(-1, Math.min(1, (sum / 8 - H[i]) / 55)));
  }
  return out;
}

export function buildTerrainMesh(t) {
  const n = t.size, W = t.worldSize;
  const geo = new THREE.PlaneGeometry(W, W, n - 1, n - 1);
  geo.rotateX(-Math.PI / 2); // row 0 = north (-z), matching the grid
  const pos = geo.attributes.position;
  const colors = new Float32Array(n * n * 3);
  // base: displayed height before any channel is dug (lakes show their surface).
  const base = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const lakeDepth = t.filled[i] - t.height[i];
      const h = lakeDepth > LAKE_MIN_DEPTH ? t.filled[i] : t.height[i];
      base[i] = h;
      pos.setY(i, h * VERT);
      const hx = t.height[y * n + Math.min(n - 1, x + 1)] - t.height[y * n + Math.max(0, x - 1)];
      const hy = t.height[Math.min(n - 1, y + 1) * n + x] - t.height[Math.max(0, y - 1) * n + x];
      const slope = Math.hypot(hx, hy) / (2 * t.cell);
      colorAt(h, slope, lakeDepth, tmp, t.course === 'summit');
      if (t.fast?.[i] && lakeDepth <= LAKE_MIN_DEPTH) tmp.multiplyScalar(0.72).lerp(CANYON, 0.28); // canyon floor: dark wet rock, so the fast lane reads from afar
      if (t.ridge?.[i] > 0 && lakeDepth <= LAKE_MIN_DEPTH) {
        const face = t.ridgeFace[i];
        if (face === 0) tmp.lerp(CREST, 0.6); else tmp.multiplyScalar(face > 0 ? 0.7 : 1.08);
      }
      tmp.toArray(colors, i * 3);
    }
  }
  // Bake the light in: cast shadows go cool and dark, hollows lose some sky.
  const sun = sunOf(t), shown = Float32Array.from(base, (h) => h * VERT), lit = sunLit(sun, n, t.cell, shown), open = skyOpen(n, t.cell, shown);
  const shade = new Float32Array(n * n * 3);
  for (let i = 0; i < n * n; i++) for (let c = 0; c < 3; c++) shade[i * 3 + c] = litTint(lit[i], c) * open[i];
  geo.setAttribute('shade', new THREE.BufferAttribute(shade, 3)); // light, kept apart from the colours: the shader reads those as ground cover
  const lakeD = Float32Array.from(base, (_, i) => t.filled[i] - t.height[i]);
  geo.setAttribute('damp', new THREE.BufferAttribute(dampness(n, t.cell, shown, lakeD), 1));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = terrainMaterial(t.course === 'summit');
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.userData = { t, base, pristineBase: base.slice(), baseColors: colors.slice(), pristineColors: colors.slice(), shown, lit, open, sun };
  for (let i = 0; i < n * n; i++) setNormal(mesh, i);
  return mesh;
}

// Lambert with procedural detail: steep ground turns to banded rock, the
// grass breaks into dry yellow and dark patches, and fine scree/grit noise
// shows close up and fades out with distance so it never shimmers.
function terrainMaterial(rugged = false) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // The ground the detail patch draws instead (x0, z0, x1, z1 in world metres; empty when there is none).
  const cut = (mat.userData.cut = { value: new THREE.Vector4(0, 0, 0, 0) });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCut = cut;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 shade;\nattribute float damp;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\nvarying vec3 vShade;\nvarying float vDamp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNorm = normalize(mat3(modelMatrix) * objectNormal);\nvShade = shade;\nvDamp = damp;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNorm;
        varying vec3 vShade;
        varying float vDamp;
        uniform vec4 uCut;
        float th(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(th(i), th(i + vec2(1, 0)), u.x), mix(th(i + vec2(0, 1)), th(i + vec2(1, 1)), u.x), u.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vWPos.x > uCut.x && vWPos.x < uCut.z && vWPos.z > uCut.y && vWPos.z < uCut.w) discard;
        {
          float dist = length(cameraPosition - vWPos);
          float near = 1.0 - smoothstep(1500.0, 6000.0, dist);
          float slope = 1.0 - clamp(vWNorm.y, 0.0, 1.0);
          float macro = tn(vWPos.xz * 0.0012) * 0.6 + tn(vWPos.xz * 0.004) * 0.4;
          float wet = step(0.02, diffuseColor.b - diffuseColor.r); // lake and sea beds keep their colour
          // Rock on steep ground, banded along the height.
          float band = 0.5 + 0.5 * sin(vWPos.y * 0.09 + tn(vWPos.xz * 0.01) * 6.0);
          vec3 rock = mix(vec3(0.42, 0.39, 0.35), vec3(0.62, 0.58, 0.52), band * 0.6 + macro * 0.4);
          ${rugged ? `// Summit Rush: darker, harder rock, broken by joints running down the face (the trailer's grey crags).
          float joint = tn(vec2((vWPos.x + vWPos.z) * 0.035, vWPos.y * 0.004)) * 0.6 + tn(vec2((vWPos.x - vWPos.z) * 0.011, vWPos.y * 0.002) + 9.0) * 0.4;
          rock = mix(vec3(0.21, 0.2, 0.19), vec3(0.47, 0.43, 0.38), band * 0.45 + macro * 0.25 + joint * 0.3) * (0.72 + 0.5 * smoothstep(0.35, 0.6, joint));` : ''}
          // Ground cover follows the lie of the land (vDamp: hollows and lake shores damp, crests dry),
          // broken up by noise at three sizes: lush green where water gathers, dry straw on the
          // crests, rust bracken on the drier slopes, pale tussock in patches, bare stone on spurs.
          vec3 g = diffuseColor.rgb;
          float land = step(0.04, g.g - max(g.r, g.b)); // grass and scrub (not sand, rock, snow or a bed)
          float n2 = tn(vWPos.xz * 0.0031 + 17.0), n3 = tn(vWPos.xz * 0.011 + 41.0);
          float dampK = clamp(vDamp * 1.1 + (0.5 - macro) * 1.2, -1.0, 1.0);
          g = mix(g, vec3(0.33, 0.41, 0.15), land * 0.65); // a brighter meadow green under it all (the old base read as mud once lit)
          // Hard, broken edges (height-blend style): each cover wins where its measure, pushed about by
          // fine detail noise, crosses a threshold, in a narrow band, instead of fading across hundreds
          // of metres. The band widens with distance so the edges never shimmer.
          float grit = tn(vWPos.xz * 0.06) * 0.5 + tn(vWPos.xz * 0.17) * 0.5;
          float brk = (tn(vWPos.xz * 0.019 + 7.0) - 0.5) * 0.6 + (grit - 0.5) * 0.5;
          float e = mix(0.22, 0.035, near);
          #define EDGE(v, t) smoothstep(-e, e, (v) - (t) + brk * 0.55)
          g = mix(g, vec3(0.27, 0.47, 0.15), land * EDGE(dampK, 0.3) * 0.8);
          g = mix(g, vec3(0.71, 0.63, 0.32), land * EDGE(-dampK, 0.3) * 0.7);
          g = mix(g, vec3(0.50, 0.33, 0.18), land * EDGE(n2, 0.68) * (1.0 - EDGE(dampK, 0.2)) * 0.65);
          g = mix(g, vec3(0.62, 0.66, 0.36), land * EDGE(n3, 0.74) * 0.4);
          // High ground is stone by its vertex colour: break it with alpine turf where it is damp or sheltered, and pale lichen.
          float upland = (1.0 - land) * (1.0 - wet) * smoothstep(${(1500 * VERT).toFixed(1)}, ${(1900 * VERT).toFixed(1)}, vWPos.y) * (1.0 - smoothstep(${(2500 * VERT).toFixed(1)}, ${(2750 * VERT).toFixed(1)}, vWPos.y));
          g = mix(g, vec3(0.36, 0.42, 0.17), upland * EDGE(macro * 0.7 + n2 * 0.3 + vDamp * 0.35, ${rugged ? '0.85' : '0.5'}) * 0.8); // the summit keeps its turf to the wettest hollows
          g = mix(g, vec3(0.60, 0.58, 0.47), upland * EDGE(n3, 0.76) * 0.45);
          float rockMix = max(smoothstep(${rugged ? '0.2, 0.45' : '0.32, 0.62'}, slope + (macro - 0.5) * 0.25), land * smoothstep(0.55, 1.0, -vDamp) * EDGE(n3, 0.58) * 0.7) * (1.0 - wet);
          vec3 col = mix(g, rock, rockMix);
          // Close-up grit and scree, and tufts in the grass nearer still.
          col *= mix(1.0, 0.74 + 0.5 * grit, near);
          col *= mix(1.0, 0.8 + 0.4 * tn(vWPos.xz * 0.45), land * (1.0 - rockMix) * (1.0 - smoothstep(300.0, 1800.0, dist)));
          // Contour lines every 10 m of height (every 50 m a little stronger),
          // close up, so rises and dips read at a glance.
          float hm = vWPos.y / ${VERT.toFixed(2)} / 10.0;
          float cl = 1.0 - min(1.0, abs(fract(hm - 0.5) - 0.5) / max(fwidth(hm), 1e-4));
          float major = step(0.5, 1.0 - abs(fract(hm / 5.0 + 0.1) - 0.1) * 10.0);
          float contour = cl * (0.12 + 0.1 * major) * (1.0 - smoothstep(2000.0, 7000.0, dist)) * (1.0 - wet);
          col *= 1.0 - contour;
          diffuseColor.rgb = col * vShade; // the baked light: cast shadows and hollows
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Rocky relief the 100 m grid can't carry: bump the lighting normal by
          // a noise height, strong on steep rock, gentle on grass, off in the
          // distance. One noise sample; its slope comes from screen-space
          // derivatives (standard bump mapping), so it costs little per pixel.
          float dist = length(cameraPosition - vWPos);
          if (dist < 9000.0) {
            float near = 1.0 - smoothstep(2500.0, 9000.0, dist);
            float slope = 1.0 - clamp(vWNorm.y, 0.0, 1.0);
            float k = (0.35 + 1.4 * smoothstep(0.25, 0.6, slope)) * near * 14.0;
            float h = (tn(vWPos.xz * 0.012) * 0.65 + tn(vWPos.xz * 0.04) * 0.35) * k;
            vec3 sx = dFdx(vWPos), sy = dFdy(vWPos), vn = normalize(vWNorm);
            vec3 r1 = cross(sy, vn), r2 = cross(vn, sx);
            float det = dot(sx, r1);
            vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
            vec3 wn = normalize(abs(det) * vn - grad);
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          }
        }`);
  };
  return mat;
}

// Normal from central differences of the displayed heights.
function setNormal(mesh, i) {
  const { t } = mesh.userData, n = t.size;
  const pos = mesh.geometry.attributes.position, nor = mesh.geometry.attributes.normal;
  const x = i % n, y = (i - x) / n;
  const l = pos.getY(y * n + Math.max(0, x - 1)), r = pos.getY(y * n + Math.min(n - 1, x + 1));
  const u = pos.getY(Math.max(0, y - 1) * n + x), d = pos.getY(Math.min(n - 1, y + 1) * n + x);
  const nx = (l - r) / (2 * t.cell), nz = (u - d) / (2 * t.cell);
  const len = Math.hypot(nx, 1, nz);
  nor.setXYZ(i, nx / len, 1 / len, nz / len);
}

// Lower dug cells and tint their beds. dirty: cell indices from the sim.
const ROCK = new THREE.Color('#3b3633');

// rock: metres of cooled lava on top of the ground (raised and dark).
export function applyCarve(mesh, carve, dirty, rock) {
  if (!dirty.length) return;
  const { t, base, baseColors } = mesh.userData, n = t.size;
  const geo = mesh.geometry, pos = geo.attributes.position, col = geo.attributes.color;
  const touched = new Set();
  let lo = Infinity, hi = -Infinity;
  for (const k of dirty) {
    pos.setY(k, (base[k] + (rock?.[k] ?? 0) - carve[k]) * VERT);
    if (rock?.[k] > 0) { ROCK.toArray(baseColors, k * 3); } // cooled lava (worn ground keeps its colour)
    const w = Math.min(1, Math.max(0, carve[k] - 1.5) / 4);
    tmp.fromArray(baseColors, k * 3).lerp(BED, w).toArray(col.array, k * 3);
    for (const o of [0, -1, 1, -n, n]) touched.add(k + o);
  }
  const ks = [];
  for (const k of touched) {
    if (k < 0 || k >= n * n) continue;
    setNormal(mesh, k);
    ks.push(k);
  }
  // Upload only the runs that changed (merged when close), not one span from
  // the first to the last: channels all over the map would otherwise resend
  // most of the terrain every tick. Ranges accumulate across ticks; three
  // clears them after each upload.
  ks.sort((a, b) => a - b);
  for (let i = 0; i < ks.length;) {
    let j = i;
    while (j + 1 < ks.length && ks[j + 1] - ks[j] <= 64) j++;
    for (const a of [pos, col, geo.attributes.normal]) a.addUpdateRange(ks[i] * a.itemSize, (ks[j] - ks[i] + 1) * a.itemSize);
    i = j + 1;
  }
  for (const a of [pos, col, geo.attributes.normal]) a.needsUpdate = true;
}

const MUD = new THREE.Color('#8f7f5c');

// A draining lake: its water sinks toward the bed and its colour fades to mud
// as `full` goes from 1 to 0. Display only — the game surface keeps the lake's
// spill level, so drainage still holds.
export function setLakeLevel(mesh, lakeOf, carve, lake, full) {
  const { t, base, pristineBase, pristineColors, baseColors } = mesh.userData, n = t.size;
  const cells = lakeCellsOf(mesh, lakeOf, lake);
  if (!cells.length) return;
  const geo = mesh.geometry, pos = geo.attributes.position, col = geo.attributes.color;
  const keep = 0.25 + 0.75 * full; // never quite to the bed: a drained lake reads as a mudflat
  const touched = new Set();
  let lo = Infinity, hi = -Infinity;
  for (const k of cells) {
    base[k] = t.height[k] + (pristineBase[k] - t.height[k]) * keep;
    pos.setY(k, (base[k] - carve[k]) * VERT);
    tmp.fromArray(pristineColors, k * 3).lerp(MUD, 1 - full).toArray(baseColors, k * 3);
    tmp.toArray(col.array, k * 3);
    for (const o of [0, -1, 1, -n, n]) touched.add(k + o);
    if (k < lo) lo = k;
    if (k > hi) hi = k;
  }
  for (const k of touched) if (k >= 0 && k < n * n) setNormal(mesh, k);
  for (const a of [pos, col, geo.attributes.normal]) {
    a.addUpdateRange(Math.max(0, lo - n) * a.itemSize, (hi - lo + 2 * n + 1) * a.itemSize);
    a.needsUpdate = true;
  }
}

function lakeCellsOf(mesh, lakeOf, lake) {
  const ud = mesh.userData;
  if (!ud.lakeCells) {
    ud.lakeCells = new Map();
    for (let k = 0; k < lakeOf.length; k++) {
      if (lakeOf[k] < 0) continue;
      if (!ud.lakeCells.has(lakeOf[k])) ud.lakeCells.set(lakeOf[k], []);
      ud.lakeCells.get(lakeOf[k]).push(k);
    }
  }
  return ud.lakeCells.get(lake) ?? [];
}

// The finish beach: a warm gold wash on its shore cells, kept in the base
// colours so carving and lake updates leave it on (resetCarve restores pristine).
const BEACH = new THREE.Color('#ffd166');
export function markBeach(mesh, cells) {
  const { baseColors } = mesh.userData;
  const col = mesh.geometry.attributes.color;
  for (const k of cells) {
    tmp.fromArray(baseColors, k * 3).lerp(BEACH, 0.7).toArray(baseColors, k * 3);
    for (let c = 0; c < 3; c++) col.array[k * 3 + c] = baseColors[k * 3 + c];
  }
  col.clearUpdateRanges();
  col.needsUpdate = true;
}

// Show (or clear) the landing zone while you fall: a cyan wash over its cells.
const ZONE = new THREE.Color('#5fe0ff');
export function highlightZone(mesh, cells, on) {
  const { baseColors } = mesh.userData;
  const col = mesh.geometry.attributes.color;
  for (const k of cells) {
    if (on) tmp.fromArray(baseColors, k * 3).lerp(ZONE, 0.35).toArray(col.array, k * 3);
    else for (let c = 0; c < 3; c++) col.array[k * 3 + c] = baseColors[k * 3 + c];
  }
  col.clearUpdateRanges();
  col.needsUpdate = true;
}

export function resetCarve(mesh) {
  const { t, base, baseColors } = mesh.userData, n = t.size;
  const geo = mesh.geometry, pos = geo.attributes.position;
  base.set(mesh.userData.pristineBase);
  for (let i = 0; i < n * n; i++) pos.setY(i, base[i] * VERT);
  baseColors.set(mesh.userData.pristineColors);
  geo.attributes.color.array.set(baseColors);
  for (let i = 0; i < n * n; i++) setNormal(mesh, i);
  for (const a of [pos, geo.attributes.color, geo.attributes.normal]) {
    a.clearUpdateRanges();
    a.needsUpdate = true;
  }
}

// Seabed beyond the map edge, so the square border never shows through the sea.
export function buildSeabed(t) {
  const geo = new THREE.PlaneGeometry(t.worldSize * 8, t.worldSize * 8);
  geo.rotateX(-Math.PI / 2);
  const bed = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: C.deep }));
  bed.position.y = -t.height.reduce((m, h) => Math.max(m, -h), 0) * VERT - 2;
  bed.name = 'seabed';
  return bed;
}

export function buildSea(worldSize) {
  const geo = new THREE.PlaneGeometry(worldSize * 8, worldSize * 8);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhongMaterial({
    color: '#2b7393', transparent: true, opacity: 0.8, shininess: 30, specular: '#3d6f80', depthWrite: false,
  });
  const sea = new THREE.Mesh(geo, mat);
  sea.position.y = SEA_LEVEL + 1;
  sea.renderOrder = 1;
  sea.name = 'sea';
  return sea;
}

// ---- The detail patch (Summit Rush): the ground near the camera, finer than the 100 m grid ----
// The game's ground holds one height per 100 m, so from a camera 50 m up a mountainside is smooth domes. The patch
// is a finer mesh (15 m) that follows the camera and draws the ground there instead: the same surface as the big
// mesh (its heights, channels, lakes, colours, light, sampled triangle by triangle), plus relief the grid cannot
// hold, strong on steep dry rock, gentle on grass, none in water or a river's channel, and none at its edges, so it
// meets the big mesh without a seam. The big mesh skips drawing under it. Draw only: the sim never sees it.
const PATCH = { n: 161, step: 15 }; // vertices a side, metres between them: 2.4 km across
export function buildDetailPatch(terrainMesh) {
  const { t } = terrainMesh.userData, n = PATCH.n;
  const geo = new THREE.PlaneGeometry(1, 1, n - 1, n - 1);
  geo.rotateX(-Math.PI / 2);
  for (const [name, size] of [['color', 3], ['shade', 3], ['damp', 1]]) geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array(n * n * size), size));
  const mesh = new THREE.Mesh(geo, terrainMaterial(t.course === 'summit'));
  mesh.name = 'detail';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.userData = { at: null, rel: new Float32Array(n * n) };
  return mesh;
}

// Sample attribute `a` (itemSize s, component c) of the big mesh at grid point (gx, gy), on the same triangle the
// big mesh draws there (PlaneGeometry splits each square from (x, y+1) to (x+1, y)).
function onGrid(arr, s, c, m, gx, gy) {
  const x0 = Math.max(0, Math.min(m - 2, Math.floor(gx))), y0 = Math.max(0, Math.min(m - 2, Math.floor(gy)));
  const fx = Math.min(1, Math.max(0, gx - x0)), fy = Math.min(1, Math.max(0, gy - y0));
  const A = arr[(y0 * m + x0) * s + c], B = arr[((y0 + 1) * m + x0) * s + c], C = arr[((y0 + 1) * m + x0 + 1) * s + c], D = arr[(y0 * m + x0 + 1) * s + c];
  return fx + fy <= 1 ? A + (D - A) * fx + (B - A) * fy : C + (B - C) * (1 - fx) + (D - C) * (1 - fy);
}

const pn = (x, y) => { // smooth value noise, 0..1
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
  const h = (a, b) => { let q = Math.imul(a, 374761393) + Math.imul(b, 668265263); q = Math.imul(q ^ (q >>> 13), 1274126177); return ((q ^ (q >>> 16)) >>> 0) / 4294967296; };
  return (h(ix, iy) * (1 - u) + h(ix + 1, iy) * u) * (1 - w) + (h(ix, iy + 1) * (1 - u) + h(ix + 1, iy + 1) * u) * w;
};
// Rock relief in metres per unit of amplitude: ridged noise at 90 and 35 m, cut into ledges (strata) on rock.
function relief(x, z, rock) {
  const r1 = 1 - Math.abs(pn(x / 90, z / 90) * 2 - 1), r2 = 1 - Math.abs(pn(x / 35 + 17, z / 35) * 2 - 1);
  let h = r1 * r1 * 0.7 + r2 * r2 * 0.3 - 0.35;
  if (rock > 0) { const q = h * 4; h = (Math.floor(q) + Math.pow(q - Math.floor(q), 4)) / 4 * rock + h * (1 - rock); }
  return h;
}

// Move the patch to cover (cx, cz) and rebuild it from the big mesh as it is now (channels and lakes included).
export function placeDetailPatch(patch, terrainMesh, cx, cz, carve) {
  const { t } = terrainMesh.userData, m = t.size, n = PATCH.n, st = PATCH.step, half = ((n - 1) / 2) * st;
  const ox = Math.round(cx / st) * st - half, oz = Math.round(cz / st) * st - half; // snapped to world grid: the relief never swims
  const big = terrainMesh.geometry.attributes, pos = patch.geometry.attributes.position, nor = patch.geometry.attributes.normal;
  const bigY = big.position.array, bigC = big.color.array, bigS = big.shade.array, bigD = big.damp.array;
  const col = patch.geometry.attributes.color.array, sha = patch.geometry.attributes.shade.array, dmp = patch.geometry.attributes.damp.array;
  const toG = (w) => (w / t.worldSize + 0.5) * (m - 1);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, x = ox + i * st, z = oz + j * st, gx = toG(x), gy = toG(z);
    let y = onGrid(bigY, 3, 1, m, gx, gy);
    // How much relief here: by slope and height, none where water stands or a river has cut, none at the edges.
    const cx0 = Math.max(0, Math.min(m - 1, Math.round(gx))), cy0 = Math.max(0, Math.min(m - 1, Math.round(gy))), c = cy0 * m + cx0;
    let dry = t.filled[c] - t.height[c] < 0.3 && t.height[c] > 2 ? 1 : 0;
    if (dry && carve) for (let dy = -1; dy <= 1 && dry; dy++) for (let dx = -1; dx <= 1; dx++) { const q = (cy0 + dy) * m + cx0 + dx; if (carve[q] > 0) { dry = 0; break; } }
    const sx = (onGrid(bigY, 3, 1, m, gx + 0.5, gy) - onGrid(bigY, 3, 1, m, gx - 0.5, gy)) / (t.cell * VERT), sz = (onGrid(bigY, 3, 1, m, gx, gy + 0.5) - onGrid(bigY, 3, 1, m, gx, gy - 0.5)) / (t.cell * VERT);
    const slope = Math.sqrt(sx * sx + sz * sz), rock = Math.min(1, Math.max(0, (slope - 0.2) / 0.3));
    const edge = Math.min(i, j, n - 1 - i, n - 1 - j) / (n * 0.12), fade = Math.min(1, edge) ** 2;
    const amp = dry * fade * (4 + 22 * rock) * VERT;
    y += amp * relief(x, z, rock);
    pos.setXYZ(k, x, y, z);
    for (let q = 0; q < 3; q++) { col[k * 3 + q] = onGrid(bigC, 3, q, m, gx, gy); sha[k * 3 + q] = onGrid(bigS, 3, q, m, gx, gy); }
    dmp[k] = onGrid(bigD, 1, 0, m, gx, gy);
  }
  // Normals from the patch's own heights.
  const P = pos.array;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, l = P[(j * n + Math.max(0, i - 1)) * 3 + 1], r = P[(j * n + Math.min(n - 1, i + 1)) * 3 + 1];
    const u = P[(Math.max(0, j - 1) * n + i) * 3 + 1], d = P[(Math.min(n - 1, j + 1) * n + i) * 3 + 1];
    const nx = (l - r) / (2 * st), nz = (u - d) / (2 * st), len = Math.hypot(nx, 1, nz);
    nor.setXYZ(k, nx / len, 1 / len, nz / len);
  }
  for (const a of ['position', 'normal', 'color', 'shade', 'damp']) patch.geometry.attributes[a].needsUpdate = true;
  patch.geometry.computeBoundingSphere();
  // The big mesh stops drawing just inside the patch's edge (the edges meet on the same surface).
  terrainMesh.material.userData.cut.value.set(ox + st, oz + st, ox + 2 * half - st, oz + 2 * half - st);
  patch.userData.at = { x: ox + half, z: oz + half };
  patch.visible = true;
}

export function hideDetailPatch(patch, terrainMesh) {
  if (!patch?.visible) return;
  patch.visible = false;
  patch.userData.at = null;
  terrainMesh.material.userData.cut.value.set(0, 0, 0, 0);
}
