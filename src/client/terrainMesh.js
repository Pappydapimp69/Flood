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
const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function colorAt(h, slope, lakeDepth, out) {
  if (lakeDepth > LAKE_MIN_DEPTH) return out.copy(C.lake);
  if (h <= SEA_LEVEL) return out.copy(C.shallow).lerp(C.deep, ss(0, 120, -h)).lerp(C.sand, ss(-8, 0, h) * 0.6);
  out.copy(C.sand).lerp(C.maquis, ss(4, 30, h));
  out.lerp(C.forest, ss(250, 700, h) * (1 - ss(1700, 2100, h)));
  out.lerp(C.rock, Math.max(ss(1900, 2400, h), ss(0.45, 0.9, slope)));
  return out.lerp(C.snow, ss(2700, 2850, h) * (1 - ss(0.7, 1.1, slope)));
}

const BED = new THREE.Color('#7a6a55');

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
      colorAt(h, slope, lakeDepth, tmp).toArray(colors, i * 3);
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = terrainMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.userData = { t, base, pristineBase: base.slice(), baseColors: colors.slice(), pristineColors: colors.slice() };
  for (let i = 0; i < n * n; i++) setNormal(mesh, i);
  return mesh;
}

// Lambert with procedural detail: steep ground turns to banded rock, the
// grass breaks into dry yellow and dark patches, and fine scree/grit noise
// shows close up and fades out with distance so it never shimmers.
function terrainMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNorm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNorm;
        float th(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(th(i), th(i + vec2(1, 0)), u.x), mix(th(i + vec2(0, 1)), th(i + vec2(1, 1)), u.x), u.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float dist = length(cameraPosition - vWPos);
          float near = 1.0 - smoothstep(1500.0, 6000.0, dist);
          float slope = 1.0 - clamp(vWNorm.y, 0.0, 1.0);
          float macro = tn(vWPos.xz * 0.0012) * 0.6 + tn(vWPos.xz * 0.004) * 0.4;
          float wet = step(0.02, diffuseColor.b - diffuseColor.r); // lake and sea beds keep their colour
          // Rock on steep ground, banded along the height.
          float band = 0.5 + 0.5 * sin(vWPos.y * 0.09 + tn(vWPos.xz * 0.01) * 6.0);
          vec3 rock = mix(vec3(0.42, 0.39, 0.35), vec3(0.62, 0.58, 0.52), band * 0.6 + macro * 0.4);
          float rockMix = smoothstep(0.32, 0.62, slope + (macro - 0.5) * 0.25) * (1.0 - wet);
          // Grass patches: dry yellow and dark green.
          vec3 g = diffuseColor.rgb;
          float green = g.g - max(g.r, g.b);
          vec3 dry = vec3(0.72, 0.66, 0.36), dark = g * 0.72;
          float patchy = smoothstep(0.55, 0.75, macro) * step(0.04, green);
          g = mix(g, dry, patchy * 0.45);
          g = mix(g, dark, smoothstep(0.35, 0.15, macro) * step(0.04, green) * 0.6);
          vec3 col = mix(g, rock, rockMix);
          // Close-up grit and scree.
          float grit = tn(vWPos.xz * 0.06) * 0.5 + tn(vWPos.xz * 0.17) * 0.5;
          col *= mix(1.0, 0.74 + 0.5 * grit, near);
          // Contour lines every 10 m of height (every 50 m a little stronger),
          // close up, so rises and dips read at a glance.
          float hm = vWPos.y / ${VERT.toFixed(2)} / 10.0;
          float cl = 1.0 - min(1.0, abs(fract(hm - 0.5) - 0.5) / max(fwidth(hm), 1e-4));
          float major = step(0.5, 1.0 - abs(fract(hm / 5.0 + 0.1) - 0.1) * 10.0);
          float contour = cl * (0.12 + 0.1 * major) * (1.0 - smoothstep(2000.0, 7000.0, dist)) * (1.0 - wet);
          col *= 1.0 - contour;
          diffuseColor.rgb = col;
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
    if (rock?.[k]) { ROCK.toArray(baseColors, k * 3); }
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
