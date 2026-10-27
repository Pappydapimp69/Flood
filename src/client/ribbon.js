import * as THREE from 'three';
import { VERT } from './terrainMesh.js';
import { surfaceAt, TUNE } from '../shared/river.js';

const MAX_POINTS = 8000;

// Flowing water: stripes scroll along the path, foam at the banks, and water
// older than the live window fades to a still, darker dry-bed tint so players
// can see which channel is dangerous (the same rule the sim uses for contact).
const vertex = /* glsl */ `
  attribute float along;
  attribute float side;
  attribute float born;
  varying float vAlong;
  varying float vSide;
  varying float vBorn;
  #include <fog_pars_vertex>
  void main() {
    vAlong = along;
    vSide = side;
    vBorn = born;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uTick;
  uniform float uLive;
  uniform float uMine;
  varying float vAlong;
  varying float vSide;
  varying float vBorn;
  #include <fog_pars_fragment>
  void main() {
    float age = uTick - vBorn;
    float live = 1.0 - smoothstep(uLive * 0.8, uLive, age);
    float flow = vAlong * 0.02 - uTime * 2.2;
    float ripple = 0.5 + 0.5 * sin(flow + sin(vAlong * 0.007 + vSide * 2.0) * 1.7);
    float streak = smoothstep(0.82, 1.0, ripple) * live;
    float foam = smoothstep(0.72, 1.0, abs(vSide)) * (0.55 + 0.45 * ripple) * live;
    vec3 still = mix(uColor, vec3(0.32, 0.36, 0.34), 0.55);
    vec3 col = mix(still, uColor, live);
    col = mix(col, vec3(0.92, 0.98, 1.0), streak * 0.35 + foam * 0.6);
    col += uMine * live * 0.06;
    gl_FragColor = vec4(col, mix(0.7, 0.95, live));
    #include <fog_fragment>
  }
`;

// Water strip drawn along a river's path, plus a live end at the head.
// Reads sim state only; never writes it.
export class Ribbon {
  constructor(color = '#3fa7cf', mine = false) {
    const geo = new THREE.BufferGeometry();
    const n = (MAX_POINTS + 1) * 2;
    this.pos = new Float32Array(n * 3);
    this.along = new Float32Array(n);
    this.side = new Float32Array(n);
    this.born = new Float32Array(n);
    for (let i = 0; i < n; i++) this.side[i] = i % 2 ? -1 : 1;
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('along', new THREE.BufferAttribute(this.along, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('side', new THREE.BufferAttribute(this.side, 1));
    geo.setAttribute('born', new THREE.BufferAttribute(this.born, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(MAX_POINTS * 6);
    for (let i = 0; i < MAX_POINTS; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      // Counter-clockwise seen from above, so the strip faces up.
      idx.set([a, c, b, b, c, d], i * 6);
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uTick: { value: 0 },
      uLive: { value: TUNE.liveTicks },
      uMine: { value: mine ? 1 : 0 },
    }]);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vertex, fragmentShader: fragment,
      transparent: true, fog: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.written = 0;
    this.sideY = []; // per point [left, right] water heights, fixed when the point is laid
    this.dist = []; // per point distance along the path, metres
  }

  // Write vertices for path points [from, path.length) and the live head.
  update(world, river, headX, headZ, time) {
    const path = river.path;
    if (!path.length) { this.geo.setDrawRange(0, 0); return; } // still falling
    const count = Math.min(path.length, MAX_POINTS);
    const from = Math.max(0, this.written - 1);
    for (let i = from; i < count; i++) this.writePoint(world, river, i, path[i].x, path[i].z, path[i].water, path[i].tick);
    this.written = count;
    const last = path[count - 1];
    // An absorbed river stops at its last laid point; no live end.
    const live = !river.out;
    if (live) this.writePoint(world, river, count, headX, headZ, last.water, world.tick, true);
    for (const a of ['position', 'along', 'born']) this.geo.attributes[a].needsUpdate = true;
    this.geo.setDrawRange(0, (live ? count : count - 1) * 6);
    this.uniforms.uTime.value = time;
    this.uniforms.uTick.value = world.tick;
    // The whole trail stays live while the river pours; drained, it dries.
    this.uniforms.uLive.value = river.out ? TUNE.liveTicks : 1e9;
  }

  writePoint(world, river, i, x, z, water, born, live = false) {
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
    const d = i === 0 ? 0 : (this.dist[i - 1] ?? 0) + Math.hypot(x - prev.x, z - prev.z);
    if (!live) this.dist[i] = d;
    const o = i * 6;
    this.pos[o] = x + px; this.pos[o + 1] = ys[0] * VERT + 2; this.pos[o + 2] = z + pz;
    this.pos[o + 3] = x - px; this.pos[o + 4] = ys[1] * VERT + 2; this.pos[o + 5] = z - pz;
    this.along[i * 2] = this.along[i * 2 + 1] = d;
    this.born[i * 2] = this.born[i * 2 + 1] = born;
  }

  reset() {
    this.written = 0;
    this.sideY = [];
    this.dist = [];
    this.geo.setDrawRange(0, 0);
  }
}
