import * as THREE from 'three';
import { VERT } from './terrainMesh.js';
import { surfaceAt } from '../shared/river.js';

const MAX_POINTS = 8000;

// Water strip drawn along a river's path, plus a live end at the head.
// Reads sim state only; never writes it.
export class Ribbon {
  constructor(color = '#3fa7cf') {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array((MAX_POINTS + 1) * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    // Lit materials need normals; the strip is near-flat, so straight up is fine.
    const nor = new Float32Array(this.pos.length);
    for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    const idx = new Uint32Array(MAX_POINTS * 6);
    for (let i = 0; i < MAX_POINTS; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      // Counter-clockwise seen from above, so the strip faces up.
      idx.set([a, c, b, b, c, d], i * 6);
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
      color, emissive: '#0d3646', shininess: 40, specular: '#5f93a6', transparent: true, opacity: 0.92,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.written = 0;
    this.sideY = []; // per point [left, right] water heights, fixed when the point is laid
  }

  // Write vertices for path points [from, path.length) and the live head.
  update(world, river, headX, headZ) {
    const path = river.path;
    const count = Math.min(path.length, MAX_POINTS);
    const from = Math.max(0, this.written - 1);
    for (let i = from; i < count; i++) this.writePoint(world, river, i, path[i].x, path[i].z, path[i].water);
    this.written = count;
    const last = path[count - 1];
    this.writePoint(world, river, count, headX, headZ, last.water, true);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.setDrawRange(0, count * 6);
  }

  writePoint(world, river, i, x, z, water, live = false) {
    const path = river.path;
    const prev = path[Math.max(0, Math.min(i, path.length) - 1)];
    const next = live ? null : path[i + 1];
    let dx, dz;
    if (live || !next) { dx = x - prev.x; dz = z - prev.z; }
    else if (i === 0) { dx = next.x - x; dz = next.z - z; }
    else { dx = next.x - prev.x; dz = next.z - prev.z; }
    const len = Math.hypot(dx, dz) || 1;
    const half = (live ? prev.w : path[i].w) * 0.5;
    const px = (-dz / len) * half, pz = (dx / len) * half;
    let ys = this.sideY[i];
    if (!ys || live) {
      // Follow the lower bank on side slopes so the strip never floats.
      // Banks are read as undug ground (this river's own channel ignored).
      const l = Math.min(water, surfaceAt(world, x + px, z + pz, river.idx) + 1.5);
      const r = Math.min(water, surfaceAt(world, x - px, z - pz, river.idx) + 1.5);
      ys = [l, r];
      if (!live) this.sideY[i] = ys;
    }
    const o = i * 6;
    this.pos[o] = x + px; this.pos[o + 1] = ys[0] * VERT + 2; this.pos[o + 2] = z + pz;
    this.pos[o + 3] = x - px; this.pos[o + 4] = ys[1] * VERT + 2; this.pos[o + 5] = z - pz;
  }

  reset() {
    this.written = 0;
    this.sideY = [];
    this.geo.setDrawRange(0, 0);
  }
}
