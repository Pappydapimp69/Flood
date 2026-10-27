import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateIsland, stats, fingerprint } from '../shared/terrain.js';
import { createWorld, addRiver, step, surfaceAt, cellIndex, riverFingerprint, DT, TICK_HZ } from '../shared/river.js';
import { buildTerrainMesh, buildSea, buildSeabed, applyCarve, resetCarve, drainLake, VERT } from './terrainMesh.js';
import { Ribbon } from './ribbon.js';
import { createInput } from './input.js';

// Test/debug surface. Tests poll this instead of waiting on wall-clock time.
const dbg = (window.__flood = { ready: false, error: null, frames: 0, steers: [] });

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || 1;
const PLAYER = 'you';

function fail(msg) {
  dbg.error = msg;
  const el = document.getElementById('fallback');
  el.textContent = msg;
  el.hidden = false;
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  fail('WebGL is not available in this browser.');
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const SKY = new THREE.Color('#b3cfe0');
const scene = new THREE.Scene();
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 30000, 120000);

const terrain = generateIsland(seed);
const W = terrain.worldSize;

const terrainMesh = buildTerrainMesh(terrain);
scene.add(terrainMesh);
scene.add(buildSeabed(terrain));
scene.add(buildSea(W));
scene.add(new THREE.HemisphereLight('#dbeaf5', '#5b5040', 1.1));
const sun = new THREE.DirectionalLight('#fff3dc', 2.2);
sun.position.set(-W * 0.6, W * 0.5, -W * 0.3);
scene.add(sun);

const ribbon = new Ribbon();
scene.add(ribbon.mesh);
const head = new THREE.Mesh(
  new THREE.SphereGeometry(1, 20, 12),
  new THREE.MeshPhongMaterial({ color: '#e9f7fb', emissive: '#3c7f95', transparent: true, opacity: 0.9 }),
);
scene.add(head);

const camera = new THREE.PerspectiveCamera(55, 1, 20, 400000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = 1.45;
controls.minDistance = 2000;
controls.maxDistance = W * 2.5;
controls.enabled = false;

function fitCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  // Keep the horizontal view wide in portrait, so phones see the banks too.
  camera.fov = aspect < 1 ? Math.min(85, (2 * Math.atan(Math.tan((55 * Math.PI) / 360) / aspect) * 180) / Math.PI) : 55;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
fitCamera();
addEventListener('resize', fitCamera);

const input = createInput(renderer.domElement);
const hud = {
  dist: document.getElementById('dist'),
  time: document.getElementById('time'),
  litres: document.getElementById('litres'),
  pop: document.getElementById('pop'),
  banner: document.getElementById('banner'),
};

let world, river, prev, acc, mapView, finishedShown;
function newRun() {
  world = createWorld(terrain);
  river = addRiver(world, PLAYER);
  prev = { x: river.x, z: river.z };
  acc = 0;
  finishedShown = false;
  resetCarve(terrainMesh);
  ribbon.reset();
  hud.banner.hidden = true;
  const y = surfaceAt(world, river.x, river.z) * VERT;
  camera.position.set(river.x - river.dx * 1500, y + 1400, river.z - river.dz * 1500);
  camTarget.set(river.x, y, river.z);
}

const camTarget = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camDir = new THREE.Vector2(0, -1);
newRun();

function tick() {
  for (const a of input.takeActions()) {
    if (a === 'map') {
      mapView = !mapView;
      controls.enabled = mapView;
      if (mapView) { controls.target.set(0, 0, 0); camera.position.set(W * 0.4, W * 0.7, W * 0.6); }
    } else if ((a === 'restart' || a === 'tap') && river.finished) {
      newRun();
      return;
    }
  }
  const steer = dbg.forceSteer ?? input.sample();
  dbg.steers.push(steer);
  if (dbg.steers.length > 200) dbg.steers.shift();
  prev = { x: river.x, z: river.z };
  step(world, new Map([[PLAYER, steer]]));
  applyCarve(terrainMesh, world.carve, world.dirty.splice(0));
  for (const e of world.events.splice(0)) {
    if (e.type !== 'lake') continue;
    drainLake(terrainMesh, world.lakeOf, e.lake);
    if (e.river === river.idx) showPop(`+${fmtL(e.gain)}`);
  }
}

const fmtL = (v) => `${Math.round(v).toLocaleString('en-US')} L`;
let popTimer;
function showPop(text) {
  hud.pop.textContent = text;
  hud.pop.classList.remove('show');
  void hud.pop.offsetWidth; // restart the animation
  hud.pop.classList.add('show');
  clearTimeout(popTimer);
  popTimer = setTimeout(() => hud.pop.classList.remove('show'), 1600);
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let last = performance.now();
renderer.setAnimationLoop(() => {
  // One clock for both ends (the rAF timestamp can predate a performance.now() start).
  const now = performance.now();
  const frameDt = Math.max(0, Math.min(0.25, (now - last) / 1000));
  last = now;
  // Fixed-step sim, decoupled from frame rate; render interpolates between ticks.
  acc += frameDt;
  while (acc >= DT) { tick(); acc -= DT; }
  const alpha = acc / DT;
  const hx = prev.x + (river.x - prev.x) * alpha, hz = prev.z + (river.z - prev.z) * alpha;
  const hy = surfaceAt(world, hx, hz, river.idx) * VERT;

  head.position.set(hx, hy + 8, hz);
  head.scale.set(70 * river.size, 25 * river.size, 70 * river.size);
  ribbon.update(world, river, hx, hz);

  if (mapView) {
    controls.update();
  } else {
    // Chase camera: behind and above the head, eased so turns feel smooth.
    const k = 1 - Math.exp(-frameDt * 2.5);
    camDir.lerp(new THREE.Vector2(river.dx, river.dz), k).normalize();
    const want = new THREE.Vector3(hx - camDir.x * 1300, Math.max(hy, 0) + 1100, hz - camDir.y * 1300);
    // Stay above the ground along the whole sightline, not just at the camera.
    for (let f = 0.25; f <= 1; f += 0.25) {
      const g = surfaceAt(world, hx - camDir.x * 1300 * f, hz - camDir.y * 1300 * f) * VERT;
      want.y = Math.max(want.y, g + 250 + 400 * f);
    }
    camera.position.lerp(want, k);
    camera.position.y = Math.max(camera.position.y, surfaceAt(world, camera.position.x, camera.position.z) * VERT + 150);
    camTarget.lerp(new THREE.Vector3(hx + camDir.x * 600, hy, hz + camDir.y * 600), 1 - Math.exp(-frameDt * 6));
    camera.lookAt(camLook.copy(camTarget));
  }

  const toSea = world.dist[cellIndex(terrain, river.x, river.z)];
  hud.dist.textContent = `${(toSea / 1000).toFixed(2)} km to sea`;
  const secs = (river.finished ? river.finishTick : world.tick) / TICK_HZ;
  hud.time.textContent = fmtTime(secs);
  hud.litres.textContent = fmtL(river.volume);
  if (river.finished && !finishedShown) {
    finishedShown = true;
    hud.banner.innerHTML = `<b>You reached the sea</b><span>${fmtTime(secs)} · ${(river.travelled / 1000).toFixed(1)} km · ${fmtL(river.volume)}</span><span>${river.lakes} lake${river.lakes === 1 ? '' : 's'} swallowed</span><small>Tap or press R to flow again</small>`;
    hud.banner.hidden = false;
  }

  renderer.render(scene, camera);
  dbg.frames++;
  dbg.calls = renderer.info.render.calls;
  if (dbg.frames === 2) dbg.ready = true;
});

Object.assign(dbg, {
  seed, fingerprint: fingerprint(terrain), stats: stats(terrain), renderer, scene, camera,
  riverFingerprint: () => riverFingerprint(world),
  newRun,
});
// Live getters (Object.assign would copy today's values, not the getters).
Object.defineProperties(dbg, {
  world: { get: () => world },
  river: { get: () => river },
});
