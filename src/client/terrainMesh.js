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

export function buildTerrainMesh(t) {
  const n = t.size, W = t.worldSize;
  const geo = new THREE.PlaneGeometry(W, W, n - 1, n - 1);
  geo.rotateX(-Math.PI / 2); // row 0 = north (-z), matching the grid
  const pos = geo.attributes.position;
  const colors = new Float32Array(n * n * 3);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const lakeDepth = t.filled[i] - t.height[i];
      const h = lakeDepth > LAKE_MIN_DEPTH ? t.filled[i] : t.height[i];
      pos.setY(i, h * VERT);
      const hx = t.height[y * n + Math.min(n - 1, x + 1)] - t.height[y * n + Math.max(0, x - 1)];
      const hy = t.height[Math.min(n - 1, y + 1) * n + x] - t.height[Math.max(0, y - 1) * n + x];
      const slope = Math.hypot(hx, hy) / (2 * t.cell);
      colorAt(h, slope, lakeDepth, tmp).toArray(colors, i * 3);
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  return mesh;
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
