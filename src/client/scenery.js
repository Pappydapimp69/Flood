import * as THREE from 'three';
import { VERT } from './terrainMesh.js';
import { hash2 } from '../shared/rng.js';

// Cosmetic scenery: trees and the glow of lava. Nothing here touches the sim.

const cellPos = (t, k) => {
  const n = t.size;
  return [((k % n) / (n - 1) - 0.5) * t.worldSize, (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize];
};

// Two-tier pine: a narrow cone on a wider one, one non-indexed geometry.
function pineGeometry() {
  const a = new THREE.ConeGeometry(1, 0.62, 7).translate(0, 0.38, 0).toNonIndexed();
  const b = new THREE.ConeGeometry(0.72, 0.55, 7).translate(0, 0.72, 0).toNonIndexed();
  const trunk = new THREE.CylinderGeometry(0.1, 0.14, 0.2, 5).translate(0, 0.1, 0).toNonIndexed();
  const geo = new THREE.BufferGeometry();
  for (const name of ['position', 'normal']) {
    const parts = [a, b, trunk].map((g) => g.attributes[name].array);
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    geo.setAttribute(name, new THREE.BufferAttribute(out, 3));
  }
  return geo;
}

// Trees: one tall stand per forest cell of the game (world.trees), pines on
// the upper slope, round broadleaf trees mixed in lower down. Tall enough to
// hide what's ahead from a low chase camera.
export function buildTrees(world, max) {
  const t = world.terrain, n = t.size;
  const pines = [], broad = [];
  for (let k = 0; k < n * n; k++) {
    if (!world.trees[k]) continue;
    (t.height[k] < 600 && hash2(k, 21, t.seed) < 0.45 ? broad : pines).push(k);
  }
  const thin = (list, cap) => (list.length > cap ? list.filter((_, i) => (i * cap) % list.length < cap) : list);
  const pk = thin(pines, Math.round(max * 0.85)), bk = thin(broad, Math.round(max * 0.15));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const place = (mesh, list, scale, tint) => {
    const byCell = new Map();
    list.forEach((k, i) => {
      const [x, z] = cellPos(t, k);
      const size = 0.7 + hash2(k, 7, t.seed) * 0.6;
      p.set(x + (hash2(k, 1, t.seed) - 0.5) * t.cell, t.height[k] * VERT - 3, z + (hash2(k, 2, t.seed) - 0.5) * t.cell);
      s.set(scale[0] * size, scale[1] * size, scale[0] * size);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(k, 5, t.seed) * 6.283);
      mesh.setMatrixAt(i, m.compose(p, q, s));
      tint(c, k);
      mesh.setColorAt(i, c);
      byCell.set(k, i);
    });
    mesh.userData.byCell = byCell;
    return mesh;
  };
  const pine = place(new THREE.InstancedMesh(pineGeometry(), new THREE.MeshLambertMaterial({ color: '#ffffff' }), Math.max(1, pk.length)), pk, [80, 290],
    (col, k) => col.setHSL(0.3 + hash2(k, 3, t.seed) * 0.05, 0.38, 0.13 + hash2(k, 4, t.seed) * 0.07));
  const leaf = place(new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1).translate(0, 1.1, 0), new THREE.MeshLambertMaterial({ color: '#ffffff' }), Math.max(1, bk.length)), bk, [85, 120],
    (col, k) => col.setHSL(0.22 + hash2(k, 3, t.seed) * 0.06, 0.4, 0.2 + hash2(k, 4, t.seed) * 0.08));
  pine.count = pk.length; leaf.count = bk.length;
  pine.add(leaf);
  pine.name = 'trees';
  pine.userData.parts = [pine, leaf];
  return pine;
}

// Boulders: low-poly rocks scattered over rocky and steep ground and the
// high slopes, bigger and denser up high, as on the trailer's scree.
export function buildRocks(world, max) {
  const t = world.terrain, n = t.size, spots = [];
  for (let y = 2; y < n - 2; y++) for (let x = 2; x < n - 2; x++) {
    const k = y * n + x, h = t.height[k];
    if (h < 60 || world.lakeOf[k] >= 0 || world.lava[k] || t.filled[k] - h > 0.5) continue;
    const slope = Math.hypot(t.height[k + 1] - t.height[k - 1], t.height[k + n] - t.height[k - n]) / (2 * t.cell);
    const want = Math.min(1, slope * 1.4 + Math.max(0, h - 700) / 900);
    if (hash2(x, y, t.seed + 71) < want * 0.35) spots.push(k);
  }
  const keep = spots.length > max ? spots.filter((_, i) => (i * max) % spots.length < max) : spots;
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), Math.max(1, keep.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), e = new THREE.Euler();
  const byCell = new Map();
  keep.forEach((k, i) => {
    const [x, z] = cellPos(t, k);
    const size = 6 + Math.pow(hash2(k, 8, t.seed), 3) * 38;
    p.set(x + (hash2(k, 1, t.seed) - 0.5) * t.cell, t.height[k] * VERT + size * 0.2, z + (hash2(k, 2, t.seed) - 0.5) * t.cell);
    e.set(hash2(k, 3, t.seed) * 3, hash2(k, 4, t.seed) * 6, hash2(k, 5, t.seed) * 3);
    s.set(size * (0.8 + hash2(k, 6, t.seed) * 0.6), size * (0.5 + hash2(k, 9, t.seed) * 0.4), size * (0.8 + hash2(k, 10, t.seed) * 0.6));
    mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e), s));
    const g = 0.26 + hash2(k, 11, t.seed) * 0.16;
    mesh.setColorAt(i, c.setRGB(g * 1.05, g, g * 0.9));
    byCell.set(k, i);
  });
  mesh.count = keep.length;
  mesh.name = 'rocks';
  mesh.userData = { byCell, parts: null };
  mesh.userData.parts = [mesh];
  return mesh;
}

// Trees (and boulders) in a dug channel or on cooled lava are gone; with no
// depth given (felled trees), every listed cell goes.
export function clearTrees(group, cells, carve = null) {
  const m = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const mesh of group.userData.parts ?? [group]) {
    const byCell = mesh.userData.byCell;
    let changed = false;
    for (const k of cells) {
      const i = byCell.get(k);
      if (i === undefined || (carve && carve[k] < 2)) continue;
      mesh.setMatrixAt(i, m);
      byCell.delete(k);
      changed = true;
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  }
}

// Lava: an overlapping soft-edged patch per lava cell, so the flow reads as one
// glowing stream: dark crust broken by bright moving cracks. Cooled cells vanish
// (the rock they leave is drawn by the terrain).
export function buildLava(world) {
  const t = world.terrain, n = t.size;
  const cells = [];
  for (let k = 0; k < n * n; k++) if (world.lava[k]) cells.push(k);
  const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: '#ff5a1c', transparent: true, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = mat.userData.uTime = { value: 0 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vUv2;\nvarying vec3 vW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUv2 = uv;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        varying vec2 vUv2;
        varying vec3 vW;
        float lh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float ln(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(lh(i), lh(i + vec2(1, 0)), u.x), mix(lh(i + vec2(0, 1)), lh(i + vec2(1, 1)), u.x), u.y); }`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        float edge = 1.0 - smoothstep(0.3, 0.5, length(vUv2 - 0.5));
        vec2 p = vW.xz * 0.012;
        float flow = ln(p + vec2(uTime * 0.15, uTime * 0.07)) * 0.6 + ln(p * 3.1 - uTime * 0.2) * 0.4;
        float crack = smoothstep(0.5, 0.66, flow);
        float hot = smoothstep(0.62, 0.8, flow);
        vec3 crust = vec3(0.13, 0.04, 0.03), glow = mix(vec3(0.82, 0.12, 0.03), vec3(1.0, 0.55, 0.12), hot);
        vec4 diffuseColor = vec4(mix(crust, glow, 0.2 + 0.8 * crack), edge * 0.95);`);
  };
  const mesh = new THREE.InstancedMesh(quad, mat, Math.max(1, cells.length));
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(t.cell * 2.1, 1, t.cell * 2.1);
  const byCell = new Map();
  cells.forEach((k, i) => {
    const [x, z] = cellPos(t, k);
    p.set(x, t.height[k] * VERT + 3 + (i % 7) * 0.3, z);
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
  if (mesh.material.userData.uTime) mesh.material.userData.uTime.value = time;
}

// Clear trees and boulders under a river's water: everything within radius r
// (metres) of (x, z), so the channel never has trees standing in it.
export function clearAround(meshes, t, x, z, r) {
  const n = t.size, cx = Math.round((x / t.worldSize + 0.5) * (n - 1)), cy = Math.round((z / t.worldSize + 0.5) * (n - 1));
  const rc = Math.ceil(r / t.cell), m = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const group of meshes) for (const mesh of group.userData.parts ?? [group]) {
    let changed = false;
    for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
      if ((dx * dx + dy * dy) * t.cell * t.cell > r * r) continue;
      const k = (cy + dy) * n + cx + dx, i = mesh.userData.byCell.get(k);
      if (i === undefined) continue;
      mesh.setMatrixAt(i, m);
      mesh.userData.byCell.delete(k);
      changed = true;
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  }
}
