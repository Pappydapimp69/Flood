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
  return grounded(geo);
}

// Darker toward the ground (the light a tree's own branches and its neighbours keep off its
// foot): the cheapest thing that makes a tree stand on the ground instead of floating over it.
function grounded(geo) {
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.count; i++) { lo = Math.min(lo, pos.getY(i)); hi = Math.max(hi, pos.getY(i)); }
  for (let i = 0; i < pos.count; i++) { const u = (pos.getY(i) - lo) / (hi - lo), g = 0.42 + 0.58 * Math.min(1, u * 1.6); col[i * 3] = g; col[i * 3 + 1] = g; col[i * 3 + 2] = g; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Trees between the chase camera and the river head dither away (screen-door,
// so no sorting), so a low camera keeps its depth without losing the river.
// main.js sets treeFade.cam / treeFade.focus each frame (radius 0 turns it off).
export const treeFade = { cam: { value: new THREE.Vector3() }, focus: { value: new THREE.Vector3() }, radius: { value: 0 } };
function seeThrough(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { fadeCam: treeFade.cam, fadeFocus: treeFade.focus, fadeRadius: treeFade.radius });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFadeWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFadeWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFadeWorld;\nuniform vec3 fadeCam, fadeFocus;\nuniform float fadeRadius;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (fadeRadius > 0.0) {
    vec3 seg = fadeFocus - fadeCam; float len2 = max(dot(seg, seg), 1.0);
    float t = clamp(dot(vFadeWorld - fadeCam, seg) / len2, 0.0, 1.0);
    float d = length(vFadeWorld - (fadeCam + seg * t));
    float keep = smoothstep(fadeRadius * 0.6, fadeRadius, d) + step(0.92, t); // the near side of the head only
    float dither = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
    if (keep < dither) discard;
  }`);
  };
}

// Trees: one tall stand per forest cell of the game (world.trees), pines on
// the upper slope, round broadleaf trees mixed in lower down. Tall enough to
// hide what's ahead from a low chase camera.
// lit: the terrain's baked sunlight per cell (terrainMesh userData.lit), so a stand in a hill's shadow is dark too.
const shadeBy = (col, lit, k) => { const l = lit ? lit[k] : 1; return col.setRGB(col.r * (0.4 + 0.6 * l), col.g * (0.48 + 0.52 * l), col.b * (0.62 + 0.38 * l)); };
export function buildTrees(world, max, lit = null) {
  const t = world.terrain, n = t.size;
  const pines = [], broad = [];
  for (let k = 0; k < n * n; k++) {
    if (!world.trees[k]) continue;
    (t.height[k] < 600 && hash2(k, 21, t.seed) < 0.45 ? broad : pines).push(k);
  }
  const thin = (list, cap) => (list.length > cap ? list.filter((_, i) => (i * cap) % list.length < cap) : list);
  const pk = thin(pines, Math.round(max * 0.85)), bk = thin(broad, Math.round(max * 0.15));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  // One instanced mesh per map chunk and kind, each with its own bounds, so
  // the stands off screen are culled instead of all drawn every frame.
  const group = new THREE.Group(), parts = [], CHUNKS = 8, size = Math.ceil(n / CHUNKS);
  const pineGeo = pineGeometry(), leafGeo = grounded(new THREE.IcosahedronGeometry(1, 1).translate(0, 1.1, 0));
  const pineMat = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true }), leafMat = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true });
  for (const mat of [pineMat, leafMat]) seeThrough(mat);
  const place = (list, geo, mat, scale, tint) => {
    const chunks = new Map();
    for (const k of list) {
      const ck = Math.floor(Math.floor(k / n) / size) * CHUNKS + Math.floor((k % n) / size);
      if (!chunks.has(ck)) chunks.set(ck, []);
      chunks.get(ck).push(k);
    }
    for (const ck of [...chunks.keys()].sort((a, b) => a - b)) {
      const cells = chunks.get(ck), mesh = new THREE.InstancedMesh(geo, mat, cells.length), byCell = new Map();
      cells.forEach((k, i) => {
        const [x, z] = cellPos(t, k);
        const sz = 0.7 + hash2(k, 7, t.seed) * 0.6;
        p.set(x + (hash2(k, 1, t.seed) - 0.5) * t.cell, t.height[k] * VERT - 3, z + (hash2(k, 2, t.seed) - 0.5) * t.cell);
        s.set(scale[0] * sz, scale[1] * sz, scale[0] * sz);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(k, 5, t.seed) * 6.283);
        mesh.setMatrixAt(i, m.compose(p, q, s));
        tint(c, k);
        mesh.setColorAt(i, shadeBy(c, lit, k));
        byCell.set(k, i);
      });
      mesh.computeBoundingSphere();
      mesh.userData.byCell = byCell;
      group.add(mesh);
      parts.push(mesh);
    }
  };
  place(pk, pineGeo, pineMat, [80, 290], (col, k) => col.setHSL(0.3 + hash2(k, 3, t.seed) * 0.05, 0.38, 0.13 + hash2(k, 4, t.seed) * 0.07));
  place(bk, leafGeo, leafMat, [85, 120], (col, k) => col.setHSL(0.22 + hash2(k, 3, t.seed) * 0.06, 0.4, 0.2 + hash2(k, 4, t.seed) * 0.08));
  group.name = 'trees';
  group.userData.parts = parts;
  group.userData.cells = [...pk, ...bk]; // the cells that hold a drawn tree (for their shadows on the ground)
  return group;
}

// Boulders: low-poly rocks scattered over rocky and steep ground and the
// high slopes, bigger and denser up high, as on the trailer's scree.
export function buildRocks(world, max, lit = null) {
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
    mesh.setColorAt(i, shadeBy(c.setRGB(g * 1.05, g, g * 0.9), lit, k));
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

// ---- Summit Rush's rock (docs/summit-rush.md): what the trailer's mountain is made of ----
// The game's ground is one height per 100 m, which close up is smooth domes. The rock a low camera needs is
// drawn here: shards standing along the crests between ravines and round the peak, scree and boulders on the
// boulder fields and rock bars the sim plays on, a few standing stones on the spurs, and an arch over a gorge.
// All of it is cleared under a river's water like the trees are.

// A crag: a six-sided block tapering to a broken top, its points pushed about so no two faces line up. Flat shaded.
function shardGeometry(seed) {
  const g = new THREE.CylinderGeometry(0.3, 1, 1, 6, 3).translate(0, 0.5, 0), pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.round(x * 50), b = Math.round(y * 50), c = Math.round(z * 50);
    const j = (o) => hash2(a * 7 + b * 131 + o, c * 17 + b, seed) - 0.5;
    pos.setXYZ(i, x + j(1) * 0.5 * (1 - y * 0.4), y + j(2) * 0.3 * (y > 0.01 ? 1 : 0), z + j(3) * 0.5 * (1 - y * 0.4));
  }
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return grounded(flat);
}
// A boulder: a dodecahedron squashed and knocked about.
function boulderGeometry(seed) {
  const g = new THREE.DodecahedronGeometry(1, 0), pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.round(x * 50), b = Math.round(y * 50), c = Math.round(z * 50);
    const k = 0.78 + 0.44 * hash2(a * 7 + b * 131, c * 17 + b, seed);
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return grounded(g);
}

// Stratified rock colour: grey-brown, banded by height, a little warmer low down (the trailer's crags).
function rockTint(col, t, k, h, o = 0) {
  const band = 0.5 + 0.5 * Math.sin(h * 0.045 + hash2(k, 31 + o, t.seed) * 2), g = 0.2 + 0.11 * band + 0.07 * hash2(k, 32 + o, t.seed);
  return col.setRGB(g * (1.06 + 0.06 * (1 - band)), g, g * (0.9 - 0.05 * band));
}

export function buildCrags(world, max, lit = null) {
  const t = world.terrain, n = t.size, H = t.height, group = new THREE.Group();
  group.name = 'crags';
  group.userData.parts = [];
  if (!max) return group;
  const dry = (k) => world.lakeOf[k] < 0 && t.filled[k] - H[k] < 0.5 && H[k] > 30;
  // Rock comes in clusters that thin out from their middles, never evenly (bs flood-98): a smooth field about
  // 700 m across, 0 between outcrops and 1 in the middle of one.
  const field = (x, y, o) => {
    const gx = x / 7, gy = y / 7, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
    const v = (a, b) => hash2(ix + a, iy + b, t.seed + o);
    const f = (v(0, 0) * (1 - u) + v(1, 0) * u) * (1 - w) + (v(0, 1) * (1 - u) + v(1, 1) * u) * w;
    return Math.min(1, Math.max(0, (f - 0.42) * 3.2));
  };
  // How far a cell stands over the ground round it (a crest between ravines) and how steep it is.
  const crags = [], scree = [], stones = [];
  for (let y = 5; y < n - 5; y++) for (let x = 5; x < n - 5; x++) {
    const k = y * n + x, h = H[k];
    if (!t.mask[k] && h < 500) continue;
    if (!dry(k)) continue;
    const round = (H[k - 3] + H[k + 3] + H[k - 3 * n] + H[k + 3 * n] + H[k - 3 * n - 3] + H[k - 3 * n + 3] + H[k + 3 * n - 3] + H[k + 3 * n + 3]) / 8;
    const crest = h - round, slope = Math.hypot(H[k + 1] - H[k - 1], H[k + n] - H[k - n]) / (2 * t.cell);
    const r = hash2(x, y, t.seed + 91);
    // Shards on the crests and on any high steep rock, thicker toward the peak.
    const high = Math.min(1, Math.max(0, (h - 900) / 1300));
    const wantCrag = (crest > 14 ? 0.3 + 0.5 * high : 0) + (slope > 0.38 ? 0.3 + 0.4 * Math.min(1, (slope - 0.38) * 2.5) : 0) + (h > 2000 ? 0.3 : 0);
    const out = field(x, y, 97) * (0.35 + 0.65 * high) + (h > 2000 ? 0.5 : 0); // the outcrop this cell is in; the peak is all rock
    if (r < wantCrag * Math.max(out, slope > 0.5 ? 0.45 : 0) * 1.6) crags.push([k, crest, high, slope, out]); // a real wall is rock all along
    // Scree: on the rock bars and the sim's boulder domes, and in the ravine floors (hollows), most of all up high.
    const bar = t.ridge?.[k] > 0, hollow = crest < -10;
    // Small rock gathers round the big: under an outcrop, and in the tight ground of a ravine floor.
    const wantScree = (bar ? 0.95 : 0) + (hollow ? 0.3 + 0.3 * high : 0) * field(x, y, 99) * 1.6 + (slope > 0.3 ? 0.12 : 0) + 0.55 * out * Math.min(1, wantCrag * 2);
    if (hash2(x, y, t.seed + 93) < wantScree) scree.push([k, bar ? 1.5 : 1, 0]);
    if (hash2(x, y, t.seed + 94) < wantScree * 0.6) scree.push([k, 0.7, 1]);
    // Standing stones: rare, on gentle spurs in the middle heights.
    if (crest > 8 && slope < 0.2 && h > 650 && h < 1500 && hash2(x, y, t.seed + 95) < 0.012) stones.push([k, crest, 0]);
  }
  for (const b of t.boulders ?? []) {
    // A boulder field's dome is a pile of big blocks, not a smooth hill.
    const R = Math.ceil(b.rad);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const k = (b.cy + dy) * n + b.cx + dx;
      if (dx * dx + dy * dy <= b.rad * b.rad && dry(k)) { scree.push([k, 2.2, 2]); scree.push([k, 1.6, 3]); }
    }
  }
  const thin = (list, cap) => (list.length > cap ? list.filter((_, i) => (i * cap) % list.length < cap) : list);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), e = new THREE.Euler();
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true, flatShading: true });
  seeThrough(mat);
  const CH = 8, size = Math.ceil(n / CH);
  // One instanced mesh per map chunk and layer (a cell holds at most one rock per layer, so the channel clearing can find it).
  const place = (list, geo, layer, put) => {
    const chunks = new Map();
    for (const it of list) {
      if ((it.length > 4 ? it[4] : it[2]) !== layer) continue;
      const k = it[0], ck = Math.floor(Math.floor(k / n) / size) * CH + Math.floor((k % n) / size);
      if (!chunks.has(ck)) chunks.set(ck, []);
      chunks.get(ck).push(it);
    }
    for (const ck of [...chunks.keys()].sort((a, b) => a - b)) {
      const items = chunks.get(ck), mesh = new THREE.InstancedMesh(geo, mat, items.length), byCell = new Map();
      let i = 0;
      for (const it of items) {
        if (byCell.has(it[0])) continue;
        put(it, layer);
        mesh.setMatrixAt(i, m.compose(p, q, s));
        mesh.setColorAt(i, shadeBy(c, lit, it[0]));
        byCell.set(it[0], i++);
      }
      mesh.count = i;
      mesh.computeBoundingSphere();
      mesh.userData.byCell = byCell;
      group.add(mesh);
      group.userData.parts.push(mesh);
    }
  };
  const spot = (k, o, sink) => { const [x, z] = cellPos(t, k); p.set(x + (hash2(k, 1 + o, t.seed) - 0.5) * t.cell * 0.9, H[k] * VERT - sink, z + (hash2(k, 2 + o, t.seed) - 0.5) * t.cell * 0.9); };
  const shards = [shardGeometry(t.seed + 1), shardGeometry(t.seed + 2)];
  const cragList = thin(crags, max).map((it, i) => [it[0], it[1], it[2], it[3], i % 2, it[4]]);
  for (let layer = 0; layer < 2; layer++) place(cragList, shards[layer], layer, ([k, crest, high, slope, , out]) => {
    // On a wall, a buttress: broad and leaning out of the face. On a crest or the peak, a tooth.
    const face = slope > 0.38 && crest <= 14;
    // Biggest in the middle of its outcrop, a third of each sunk in the ground (bs flood-99).
    const tall = Math.min(150, (30 + 50 * hash2(k, 8, t.seed) + 70 * out * (0.4 + 0.6 * high)) * (face ? 0.8 : 1.2)), wide = tall * (face ? 0.8 + 0.5 * hash2(k, 9, t.seed) : 0.4 + 0.3 * hash2(k, 9, t.seed));
    spot(k, 0, tall * 0.3);
    e.set((hash2(k, 3, t.seed) - 0.5) * 0.5, hash2(k, 4, t.seed) * 6.283, (hash2(k, 5, t.seed) - 0.5) * 0.5);
    q.setFromEuler(e);
    s.set(wide, tall, wide * (0.7 + 0.6 * hash2(k, 10, t.seed)));
    rockTint(c, t, k, H[k]);
  });
  const blocks = [boulderGeometry(t.seed + 3), boulderGeometry(t.seed + 4)];
  const screeCap = thin(scree.filter((it) => it[2] < 2), max * 2).concat(scree.filter((it) => it[2] >= 2));
  for (let layer = 0; layer < 4; layer++) place(screeCap, blocks[layer % 2], layer, ([k, big], L) => {
    const size = (5 + 30 * hash2(k, 8 + L, t.seed) ** 3) * big + (L >= 2 ? 14 : 0);
    spot(k, L * 5, -size * 0.25);
    e.set(hash2(k, 3 + L, t.seed) * 3, hash2(k, 4 + L, t.seed) * 6.283, hash2(k, 5 + L, t.seed) * 3);
    q.setFromEuler(e);
    s.set(size * (0.8 + hash2(k, 6 + L, t.seed) * 0.7), size * (0.5 + hash2(k, 9 + L, t.seed) * 0.45), size * (0.8 + hash2(k, 10 + L, t.seed) * 0.7));
    rockTint(c, t, k, H[k], L);
  });
  // Standing stones: one tall block each, upright, bigger than anything near it (a landmark to steer by).
  place(thin(stones, 40), blocks[0], 0, ([k]) => {
    const tall = 110 + 150 * hash2(k, 8, t.seed);
    spot(k, 0, tall * 0.15);
    q.setFromEuler(e.set((hash2(k, 3, t.seed) - 0.5) * 0.25, hash2(k, 4, t.seed) * 6.283, (hash2(k, 5, t.seed) - 0.5) * 0.25));
    s.set(tall * 0.38, tall, tall * 0.34);
    rockTint(c, t, k, H[k]);
  });
  return group;
}

// The arch: a span of rock over one breach's gorge, a third of the way out to the sea, which every river in that
// valley runs under (the ground holds one height per point, so the arch is drawn, not terrain).
export function buildArch(world) {
  const t = world.terrain, n = t.size, group = new THREE.Group();
  group.name = 'arch';
  const b = (t.breaches ?? []).find((x) => x.kind !== 'stacks') ?? t.breaches?.[0];
  if (!b) return group;
  const at = (x, z) => t.height[Math.max(0, Math.min(n - 1, Math.round((z / t.worldSize + 0.5) * (n - 1)))) * n + Math.max(0, Math.min(n - 1, Math.round((x / t.worldSize + 0.5) * (n - 1))))];
  // The gorge's middle at this distance out: the lowest ground across the breach's bearing.
  const along = 20500;
  let mid = 0, low = Infinity;
  for (let a = -2600; a <= 2600; a += 50) { const h = at(b.x * along - b.z * a, b.z * along + b.x * a); if (h < low) { low = h; mid = a; } }
  // Its walls: where the ground first stands well over the floor on each side.
  const wall = (dir) => { for (let a = 100; a < 1500; a += 50) if (at(b.x * along - b.z * (mid + dir * a), b.z * along + b.x * (mid + dir * a)) > low + 70) return a; return 700; };
  const half = Math.max(wall(-1), wall(1)) + 120, cx = b.x * along - b.z * mid, cz = b.z * along + b.x * mid;
  const geo = new THREE.TorusGeometry(half, 1, 7, 18, Math.PI), pos = geo.attributes.position;
  // A torus with a tube of 1, fattened unevenly into rock: thick at the feet, thinner over the middle.
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ang = Math.atan2(y, x), rx = Math.cos(ang) * half, ry = Math.sin(ang) * half;
    const thick = (150 - 70 * Math.sin(ang)) * (0.75 + 0.5 * hash2(Math.round(ang * 9), Math.round(z * 3) + Math.round((Math.hypot(x, y) - half) * 3) * 7, t.seed + 5));
    pos.setXYZ(i, rx + (x - rx) * thick, (ry + (y - ry) * thick) * 0.62, z * thick * 1.5);
  }
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  const col = new Float32Array(flat.attributes.position.count * 3), c = new THREE.Color();
  for (let i = 0; i < col.length / 3; i++) {
    const y = flat.attributes.position.getY(i), tri = Math.floor(i / 3), g = 0.4 + 0.12 * Math.sin(y * 0.05) + 0.08 * hash2(tri, 3, t.seed);
    c.setRGB(g * 1.12, g, g * 0.84).toArray(col, i * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(flat, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.position.set(cx, low * VERT - 30, cz);
  mesh.rotation.y = Math.atan2(b.x, b.z); // the span lies across the gorge
  group.add(mesh);
  group.userData.at = { x: cx, z: cz, half };
  return group;
}
