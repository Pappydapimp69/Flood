import * as THREE from 'three';
import { VERT } from './terrainMesh.js';
import { hash2 } from '../shared/rng.js';

// Cosmetic scenery: trees and the glow of lava. Nothing here touches the sim.

const cellPos = (t, k) => {
  const n = t.size;
  return [((k % n) / (n - 1) - 0.5) * t.worldSize, (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize];
};

// Trees on a jittered grid (plain random scatter clumps), drawn as two
// instanced meshes. Kept off water, lava, steep rock and high ground, and
// thinned at the edges of the forest band.
export function buildTrees(world, max) {
  const t = world.terrain, n = t.size;
  const spots = [];
  const step = 2;
  for (let y = 2; y < n - 2; y += step) for (let x = 2; x < n - 2; x += step) {
    const jx = Math.min(n - 3, x + Math.floor(hash2(x, y, t.seed + 5) * step));
    const jy = Math.min(n - 3, y + Math.floor(hash2(y, x, t.seed + 9) * step));
    const k = jy * n + jx, h = t.height[k];
    if (h < 25 || h > 1250 || world.lakeOf[k] >= 0 || world.lava[k]) continue;
    const slope = Math.hypot(t.height[k + 1] - t.height[k - 1], t.height[k + n] - t.height[k - n]) / (2 * t.cell);
    if (slope > 0.55) continue;
    const forest = h < 250 ? (h - 25) / 225 : h > 1000 ? (1250 - h) / 250 : 1;
    if (hash2(jx, jy, t.seed + 13) > 0.55 * forest) continue;
    spots.push(k);
  }
  // Even thinning down to the budget, keeping the jitter's spread.
  const keep = spots.length > max ? spots.filter((_, i) => (i * max) % spots.length < max) : spots;
  const cone = new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(cone, new THREE.MeshLambertMaterial({ color: '#2f5524' }), keep.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const byCell = new Map();
  keep.forEach((k, i) => {
    const [x, z] = cellPos(t, k);
    const size = 0.7 + hash2(k, 7, t.seed) * 0.6;
    p.set(x + (hash2(k, 1, t.seed) - 0.5) * t.cell, t.height[k] * VERT - 4, z + (hash2(k, 2, t.seed) - 0.5) * t.cell);
    s.set(45 * size, 140 * size, 45 * size);
    mesh.setMatrixAt(i, m.compose(p, q, s));
    mesh.setColorAt(i, new THREE.Color().setHSL(0.27 + hash2(k, 3, t.seed) * 0.06, 0.45, 0.2 + hash2(k, 4, t.seed) * 0.1));
    byCell.set(k, i);
  });
  mesh.name = 'trees';
  mesh.userData.byCell = byCell;
  return mesh;
}

// Trees in a dug channel or on cooled lava are gone.
export function clearTrees(mesh, cells, carve) {
  const byCell = mesh.userData.byCell, m = new THREE.Matrix4();
  let changed = false;
  for (const k of cells) {
    const i = byCell.get(k);
    if (i === undefined || carve[k] < 2) continue;
    mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
    byCell.delete(k);
    changed = true;
  }
  if (changed) mesh.instanceMatrix.needsUpdate = true;
}

// Lava: a glowing quad per lava cell, pulsing; cooled cells go dark.
export function buildLava(world) {
  const t = world.terrain, n = t.size;
  const cells = [];
  for (let k = 0; k < n * n; k++) if (world.lava[k]) cells.push(k);
  const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: '#ff5a1c', transparent: true, opacity: 0.9, depthWrite: false });
  const mesh = new THREE.InstancedMesh(quad, mat, Math.max(1, cells.length));
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(t.cell * 1.15, 1, t.cell * 1.15);
  const byCell = new Map();
  cells.forEach((k, i) => {
    const [x, z] = cellPos(t, k);
    p.set(x, t.height[k] * VERT + 3, z);
    mesh.setMatrixAt(i, m.compose(p, q, s));
    byCell.set(k, i);
  });
  mesh.count = cells.length;
  mesh.renderOrder = 1;
  mesh.name = 'lava';
  mesh.userData.byCell = byCell;
  return mesh;
}

export function coolLava(mesh, cells) {
  const m = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const k of cells) {
    const i = mesh.userData.byCell.get(k);
    if (i !== undefined) mesh.setMatrixAt(i, m);
  }
  if (cells.length) mesh.instanceMatrix.needsUpdate = true;
}

export function pulseLava(mesh, time) {
  mesh.material.color.setHSL(0.04 + 0.015 * Math.sin(time * 2.1), 1, 0.5 + 0.06 * Math.sin(time * 3.3));
}
