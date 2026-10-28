import * as THREE from 'three';
import { SEA_LEVEL } from '../shared/terrain.js';
import { VERT } from './terrainMesh.js';

// Water looks, after the trailer: opaque turquoise, darker where deep, pale and
// foamy where shallow, white foam at every edge, and streaks that run with
// the flow. Render-only: nothing here reads back into the sim.

// Shared GLSL: cheap value noise and a two-octave foam pattern.
export const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm2(vec2 p) { return 0.65 * vnoise(p) + 0.35 * vnoise(p * 2.3 + 7.1); }
`;

export const WATER = {
  deep: new THREE.Color('#1b97b2'),
  mid: new THREE.Color('#25aec2'),
  shallow: new THREE.Color('#66d3d6'),
  foam: new THREE.Color('#f2fbfb'),
  ocean: new THREE.Color('#0d4c79'),
};

// ---------------------------------------------------------------- lakes ------

const lakeVertex = /* glsl */ `
  attribute float depth;
  varying float vDepth;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vDepth = depth;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const lakeFragment = /* glsl */ `
  uniform vec3 uDeep, uMid, uShallow, uFoam, uSun;
  uniform float uTime;
  varying float vDepth;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  ${NOISE}
  void main() {
    vec2 p = vWorld.xz * 0.006;
    float n = fbm2(p + vec2(uTime * 0.05, uTime * 0.03));
    float d = vDepth;
    vec3 col = mix(uShallow, uMid, smoothstep(0.5, 5.0, d));
    col = mix(col, uDeep, smoothstep(10.0, 60.0, d) * 0.7);
    // Ripple shading and glints.
    col *= 0.9 + 0.2 * n;
    vec3 v = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(v.y, 0.0), 3.0);
    col = mix(col, vec3(0.75, 0.88, 0.92), fres * 0.35);
    float glint = smoothstep(0.82, 0.97, fbm2(vWorld.xz * 0.03 + uTime * 0.4)) * 0.35;
    // Foam where the water meets the shore, broken up by noise.
    float shore = 1.0 - smoothstep(0.05, 0.7, d + (n - 0.5) * 0.4);
    col = mix(col, uFoam, clamp(shore + glint, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`;

function waterUniforms(extra = {}) {
  return THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uDeep: { value: WATER.deep }, uMid: { value: WATER.mid }, uShallow: { value: WATER.shallow },
    uFoam: { value: WATER.foam }, uTime: { value: 0 }, uSun: { value: new THREE.Vector3(-0.6, 0.5, -0.3).normalize() },
    ...extra,
  }]);
}

// One mesh for every lake and the shallow standing water around it, at the
// fill (brim) level, carrying the water depth per vertex for colour and foam.
export function buildLakes(t, lakeOf, shallow = 1) {
  const n = t.size, W = t.worldSize, cell = t.cell;
  const wet = (k) => lakeOf[k] >= 0 || t.filled[k] - t.height[k] > shallow;
  const pos = [], depth = [], idx = [];
  const vid = new Int32Array(n * n).fill(-1);
  const vert = (k) => {
    if (vid[k] >= 0) return vid[k];
    const x = k % n, y = (k - x) / n;
    vid[k] = pos.length / 3;
    pos.push((x / (n - 1) - 0.5) * W, t.filled[k] * VERT + 1.5, (y / (n - 1) - 0.5) * W);
    depth.push(Math.max(0, t.filled[k] - t.height[k]));
    return vid[k];
  };
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const k = y * n + x;
      if (t.filled[k] <= SEA_LEVEL) continue;
      // A quad is drawn when any corner holds water; dry corners get the
      // neighbouring water level, so the surface meets the shore flat.
      const ks = [k, k + 1, k + n, k + n + 1];
      if (!ks.some(wet)) continue;
      const [a, b, c, d] = ks.map(vert);
      idx.push(a, c, b, b, c, d);
    }
  }
  // Dry corners sit at the lake level of their wet neighbours, depth 0 (foam).
  for (let k = 0; k < n * n; k++) {
    const v = vid[k];
    if (v < 0 || wet(k)) continue;
    let lvl = -Infinity;
    const x = k % n, y = (k - x) / n;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const kk = yy * n + xx;
      if (wet(kk)) lvl = Math.max(lvl, t.filled[kk]);
    }
    if (lvl > -Infinity) { pos[v * 3 + 1] = lvl * VERT + 1.5; depth[v] = 0; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({ uniforms: waterUniforms(), vertexShader: lakeVertex, fragmentShader: lakeFragment, fog: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'lakes';
  mesh.renderOrder = 1;
  mesh.userData.cell = cell;
  return mesh;
}

// ------------------------------------------------------------------ sea ------

const seaVertex = /* glsl */ `
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const seaFragment = /* glsl */ `
  uniform sampler2D uDepth;
  uniform float uWorld, uTime;
  uniform vec3 uOcean, uMid, uShallow, uFoam;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  ${NOISE}
  void main() {
    vec2 uv = vWorld.xz / uWorld + 0.5;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    float d = mix(220.0, texture2D(uDepth, uv).r * 255.0, inside); // metres below sea level
    float n = fbm2(vWorld.xz * 0.004 + vec2(uTime * 0.03, -uTime * 0.02));
    vec3 col = mix(uShallow, uMid, smoothstep(2.0, 22.0, d));
    col = mix(col, uOcean, smoothstep(25.0, 140.0, d));
    col *= 0.93 + 0.14 * n;
    // Surf: white lines rolling in toward the coast, only in the shallows.
    float wave = sin(d * 0.9 - uTime * 1.6 + n * 3.0);
    float surf = smoothstep(0.86, 1.0, wave) * (1.0 - smoothstep(4.0, 16.0, d));
    float edge = 1.0 - smoothstep(0.0, 2.2, d + (n - 0.5) * 2.0);
    col = mix(col, uFoam, clamp(surf * 0.85 + edge, 0.0, 1.0));
    vec3 v = normalize(cameraPosition - vWorld);
    col = mix(col, vec3(0.62, 0.78, 0.86), pow(1.0 - max(v.y, 0.0), 4.0) * 0.4);
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`;

// The sea: depth from the terrain (stored as metres below sea level, 0-255),
// so shallows glow turquoise, deep water goes navy and surf rolls at the coast.
export function buildSea(t) {
  const n = t.size, data = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) data[i] = Math.max(0, Math.min(255, Math.round(-t.height[i])));
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(t.worldSize * 8, t.worldSize * 8, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: waterUniforms({ uDepth: { value: tex }, uWorld: { value: t.worldSize }, uOcean: { value: WATER.ocean } }),
    vertexShader: seaVertex, fragmentShader: seaFragment, fog: true,
  });
  const sea = new THREE.Mesh(geo, mat);
  sea.position.y = SEA_LEVEL + 1;
  sea.renderOrder = 0;
  sea.name = 'sea';
  return sea;
}

// ---------------------------------------------------------------- surge ------

// The head of a river: a churning turquoise-and-white surge, not a ball.
// A squashed sphere pushed outward by moving noise, foamier on top and at the
// front, plus a spray of droplets thrown up and back.
const surgeVertex = /* glsl */ `
  uniform float uTime;
  varying vec3 vN;
  varying float vFoam;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  ${NOISE}
  void main() {
    vec3 p = position;
    float t = uTime * 1.8;
    float bump = fbm2(p.xz * 2.2 + vec2(t, -t * 0.7)) * 0.55 + fbm2(p.xy * 3.1 - t) * 0.25;
    float front = smoothstep(-0.2, 1.0, p.z);   // +z is the way it flows
    p += normal * bump * (0.35 + 0.4 * front);
    p.y *= 0.55 + 0.35 * front;
    vN = normalize(normalMatrix * normal);
    vFoam = clamp(bump * 0.9 + max(position.y, 0.0) * 0.45 + front * 0.25 - 0.25, 0.0, 1.0);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const surgeFragment = /* glsl */ `
  uniform vec3 uMid, uShallow, uFoam;
  uniform float uTime, uGlow;
  varying vec3 vN;
  varying float vFoam;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  ${NOISE}
  void main() {
    float n = fbm2(vWorld.xz * 0.05 + uTime * 0.8);
    float light = 0.65 + 0.35 * max(dot(vN, normalize(vec3(-0.4, 0.8, 0.3))), 0.0);
    vec3 col = mix(uMid, uShallow, n * 0.8) * light;
    // White crests and broken foam over a turquoise body.
    float crest = smoothstep(0.5, 0.8, vFoam + (n - 0.5) * 0.6);
    col = mix(col, uFoam, crest * 0.9);
    col += uGlow * 0.08;
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`;

const surgeGeo = new THREE.SphereGeometry(1, 28, 18);
export function makeSurge(mine) {
  const mat = new THREE.ShaderMaterial({
    uniforms: waterUniforms({ uGlow: { value: mine ? 1 : 0 } }),
    vertexShader: surgeVertex, fragmentShader: surgeFragment, fog: true,
  });
  const mesh = new THREE.Mesh(surgeGeo, mat);
  mesh.renderOrder = 3;
  return mesh;
}

// Spray: a ring buffer of droplets per head, thrown up and back, falling.
const SPRAY = 70;
export function makeSpray() {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(SPRAY * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({ color: '#f4fdff', size: 14, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  pts.userData = { vel: new Float32Array(SPRAY * 3), life: new Float32Array(SPRAY), next: 0 };
  return pts;
}

// Advance one head's spray by dt seconds; emits more the faster and bigger it runs.
export function updateSpray(pts, x, y, z, dx, dz, size, speed01, dt, on) {
  const { vel, life } = pts.userData;
  const pos = pts.geometry.attributes.position.array;
  const emit = on ? Math.min(SPRAY, Math.round((6 + 30 * speed01) * size * dt * 6)) : 0;
  for (let e = 0; e < emit; e++) {
    const i = pts.userData.next;
    pts.userData.next = (i + 1) % SPRAY;
    const side = (Math.random() - 0.5) * 2;
    const r = 40 * size;
    pos[i * 3] = x + dx * r * 0.6 + dz * side * r;
    pos[i * 3 + 1] = y + 10 * size;
    pos[i * 3 + 2] = z + dz * r * 0.6 - dx * side * r;
    const up = (60 + Math.random() * 90) * Math.sqrt(size);
    vel[i * 3] = -dx * (30 + 80 * speed01) + dz * side * 40;
    vel[i * 3 + 1] = up;
    vel[i * 3 + 2] = -dz * (30 + 80 * speed01) - dx * side * 40;
    life[i] = 0.6 + Math.random() * 0.5;
  }
  for (let i = 0; i < SPRAY; i++) {
    if (life[i] <= 0) { pos[i * 3 + 1] = -1e5; continue; }
    life[i] -= dt;
    vel[i * 3 + 1] -= 260 * dt;
    pos[i * 3] += vel[i * 3] * dt;
    pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
    pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
  }
  pts.material.size = 34 + 22 * size;
  pts.geometry.attributes.position.needsUpdate = true;
}

// A splash: throw n droplets out in every direction at once (landing, joining).
export function burstSpray(pts, x, y, z, size, n = 60) {
  const { vel, life } = pts.userData;
  const pos = pts.geometry.attributes.position.array;
  for (let e = 0; e < n; e++) {
    const i = pts.userData.next;
    pts.userData.next = (i + 1) % SPRAY;
    const a = Math.random() * 6.283, sp = (80 + Math.random() * 160) * size;
    pos[i * 3] = x; pos[i * 3 + 1] = y + 10; pos[i * 3 + 2] = z;
    vel[i * 3] = Math.cos(a) * sp; vel[i * 3 + 1] = (150 + Math.random() * 200) * Math.sqrt(size); vel[i * 3 + 2] = Math.sin(a) * sp;
    life[i] = 0.8 + Math.random() * 0.6;
  }
}

export function tickWater(meshes, time) {
  for (const m of meshes) if (m?.material?.uniforms?.uTime) m.material.uniforms.uTime.value = time;
}
