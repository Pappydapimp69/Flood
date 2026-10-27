import * as THREE from 'three';
import { SEA_LEVEL, LAKE_MIN_DEPTH } from '../shared/terrain.js';

// Render-only vertical exaggeration; game logic always uses true metres.
export const VERT = 2.4;

const C = {
  deep: new THREE.Color('#1d4d5e'),
  shallow: new THREE.Color('#6fa59a'),
  sand: new THREE.Color('#d9c79b'),
  maquis: new THREE.Color('#6b8a3e'),
  forest: new THREE.Color('#3e5c2a'),
  rock: new THREE.Color('#8b8173'),
  snow: new THREE.Color('#f1f1ee'),
  lake: new THREE.Color('#4f93a8'),
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
  out.lerp(C.forest, ss(250, 700, h) * (1 - ss(1300, 1600, h)));
  out.lerp(C.rock, Math.max(ss(1100, 1500, h), ss(0.45, 0.9, slope)));
  return out.lerp(C.snow, ss(1600, 1780, h) * (1 - ss(0.7, 1.1, slope)));
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
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.userData = { t, base, baseColors: colors.slice(), pristineColors: colors.slice() };
  for (let i = 0; i < n * n; i++) setNormal(mesh, i);
  return mesh;
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
export function applyCarve(mesh, carve, dirty) {
  if (!dirty.length) return;
  const { t, base, baseColors } = mesh.userData, n = t.size;
  const geo = mesh.geometry, pos = geo.attributes.position, col = geo.attributes.color;
  const touched = new Set();
  let lo = Infinity, hi = -Infinity;
  for (const k of dirty) {
    pos.setY(k, (base[k] - carve[k]) * VERT);
    const w = Math.min(1, Math.max(0, carve[k] - 1.5) / 4);
    tmp.fromArray(baseColors, k * 3).lerp(BED, w).toArray(col.array, k * 3);
    for (const o of [0, -1, 1, -n, n]) touched.add(k + o);
  }
  for (const k of touched) {
    if (k < 0 || k >= n * n) continue;
    setNormal(mesh, k);
    if (k < lo) lo = k;
    if (k > hi) hi = k;
  }
  // Ranges accumulate across ticks; three clears them after each upload.
  for (const a of [pos, col, geo.attributes.normal]) {
    a.addUpdateRange(lo * a.itemSize, (hi - lo + 1) * a.itemSize);
    a.needsUpdate = true;
  }
}

const MUD = new THREE.Color('#8f7f5c');

// A swallowed lake dries to a mudflat. The game surface keeps its level (so
// drainage still holds); only the look changes.
export function drainLake(mesh, lakeOf, lake) {
  const { baseColors } = mesh.userData;
  const col = mesh.geometry.attributes.color;
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < lakeOf.length; k++) {
    if (lakeOf[k] !== lake) continue;
    MUD.toArray(col.array, k * 3);
    MUD.toArray(baseColors, k * 3);
    if (k < lo) lo = k;
    if (k > hi) hi = k;
  }
  if (lo > hi) return;
  col.addUpdateRange(lo * 3, (hi - lo + 1) * 3);
  col.needsUpdate = true;
}

export function resetCarve(mesh) {
  const { t, base, baseColors } = mesh.userData, n = t.size;
  const geo = mesh.geometry, pos = geo.attributes.position;
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
