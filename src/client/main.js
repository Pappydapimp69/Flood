import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateIsland, stats, fingerprint } from '../shared/terrain.js';
import { createWorld, addRiver, step, surfaceAt, cellIndex, riverFingerprint, standings, isRacing, DT, TICK_HZ } from '../shared/river.js';
import { createBot, botSteer } from '../shared/bot.js';
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

const PLAYER_COLOR = '#45d2ff';
const BOT_COLORS = ['#4f8fd0', '#4fb39a', '#7d84d8', '#3fa8b8', '#6c95e8', '#58a77f', '#9480d8', '#3f93c4', '#6fae8f', '#8496e0', '#4c9aa8'];
const headGeo = new THREE.SphereGeometry(1, 20, 12);

// One render entry per river: ribbon, head and last-tick position for interpolation.
function makeEntry(r, i) {
  const mine = r.id === PLAYER;
  const color = mine ? PLAYER_COLOR : BOT_COLORS[i % BOT_COLORS.length];
  const ribbon = new Ribbon(color);
  const head = new THREE.Mesh(headGeo, new THREE.MeshPhongMaterial({
    color: mine ? '#f2fcff' : '#dfeff5', emissive: mine ? '#2aa6d6' : '#2e5d6e', transparent: true, opacity: 0.92,
  }));
  scene.add(ribbon.mesh, head);
  return { r, ribbon, head, prev: { x: r.x, z: r.z } };
}

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
  rank: document.getElementById('rank'),
  pop: document.getElementById('pop'),
  feed: document.getElementById('feed'),
  banner: document.getElementById('banner'),
};

const BOTS = Math.max(0, Math.min(40, Number(params.get('bots') ?? 11)));
let world, river, entries, bots, focus, acc, mapView, endShown;
function newRun() {
  if (entries) for (const e of entries) { scene.remove(e.ribbon.mesh, e.head); e.ribbon.geo.dispose(); e.head.material.dispose(); }
  world = createWorld(terrain);
  // Add in sorted id order so spawns are reproducible.
  const ids = [PLAYER, ...Array.from({ length: BOTS }, (_, i) => `bot${String(i + 1).padStart(2, '0')}`)].sort();
  for (const id of ids) addRiver(world, id);
  river = world.rivers.find((r) => r.id === PLAYER);
  bots = world.rivers.filter((r) => r !== river).map((r) => createBot(world, r));
  entries = world.rivers.map(makeEntry);
  focus = river;
  acc = 0;
  endShown = false;
  resetCarve(terrainMesh);
  hud.banner.hidden = true;
  hud.feed.textContent = '';
  const y = surfaceAt(world, river.x, river.z) * VERT;
  camera.position.set(river.x - river.dx * 1500, y + 1400, river.z - river.dz * 1500);
  camTarget.set(river.x, y, river.z);
}

const camTarget = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camDir = new THREE.Vector2(0, -1);
newRun();

const nameOf = (r) => (r.id === PLAYER ? 'You' : r.id);
function feed(text) {
  const li = document.createElement('div');
  li.textContent = text;
  hud.feed.prepend(li);
  while (hud.feed.children.length > 4) hud.feed.lastChild.remove();
  setTimeout(() => li.remove(), 5000);
}

function tick() {
  for (const a of input.takeActions()) {
    if (a === 'map') {
      mapView = !mapView;
      controls.enabled = mapView;
      if (mapView) { controls.target.set(0, 0, 0); camera.position.set(W * 0.4, W * 0.7, W * 0.6); }
    } else if ((a === 'restart' || a === 'tap') && !isRacing(river)) {
      newRun();
      return;
    }
  }
  const steer = dbg.forceSteer ?? input.sample();
  dbg.steers.push(steer);
  if (dbg.steers.length > 200) dbg.steers.shift();
  // Bots decide from the same start-of-tick state, then everyone steps together.
  const inputs = new Map([[PLAYER, steer]]);
  for (const b of bots) inputs.set(b.river.id, dbg.botsOff ? 0 : botSteer(world, b));
  for (const e of entries) e.prev = { x: e.r.x, z: e.r.z };
  step(world, inputs);
  applyCarve(terrainMesh, world.carve, world.dirty.splice(0));
  for (const e of world.events.splice(0)) {
    if (e.type === 'lake') {
      drainLake(terrainMesh, world.lakeOf, e.lake);
      if (e.river === river.idx) showPop(`+${fmtL(e.gain)}`);
    } else if (e.type === 'merge') {
      const w = world.rivers[e.winner], l = world.rivers[e.loser];
      if (w === river) showPop(`Absorbed ${nameOf(l)} +${fmtL(e.gain)}`);
      feed(`${nameOf(w)} absorbed ${nameOf(l)}`);
      // Spectate whoever absorbed the river we were watching.
      if (l === focus) focus = w;
    }
  }
  if (focus.out) focus = world.rivers.find((r) => r.id === focus.out.by) ?? focus;
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
const ordinal = (n) => `#${n}`;

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

  let fx = 0, fz = 0, fy = 0;
  for (const e of entries) {
    const r = e.r;
    const hx = e.prev.x + (r.x - e.prev.x) * alpha, hz = e.prev.z + (r.z - e.prev.z) * alpha;
    const hy = surfaceAt(world, hx, hz, r.idx) * VERT;
    e.head.visible = !r.out;
    e.head.position.set(hx, hy + 8, hz);
    e.head.scale.set(70 * r.size, 25 * r.size, 70 * r.size);
    e.ribbon.update(world, r, hx, hz);
    if (r === focus) { fx = hx; fz = hz; fy = hy; }
  }

  if (mapView) {
    controls.update();
  } else {
    // Chase camera: behind and above the head, eased so turns feel smooth.
    const k = 1 - Math.exp(-frameDt * 2.5);
    camDir.lerp(new THREE.Vector2(focus.dx, focus.dz), k).normalize();
    const want = new THREE.Vector3(fx - camDir.x * 1300, Math.max(fy, 0) + 1100, fz - camDir.y * 1300);
    // Stay above the ground along the whole sightline, not just at the camera.
    for (let f = 0.25; f <= 1; f += 0.25) {
      const g = surfaceAt(world, fx - camDir.x * 1300 * f, fz - camDir.y * 1300 * f) * VERT;
      want.y = Math.max(want.y, g + 250 + 400 * f);
    }
    camera.position.lerp(want, k);
    camera.position.y = Math.max(camera.position.y, surfaceAt(world, camera.position.x, camera.position.z) * VERT + 150);
    camTarget.lerp(new THREE.Vector3(fx + camDir.x * 600, fy, fz + camDir.y * 600), 1 - Math.exp(-frameDt * 6));
    camera.lookAt(camLook.copy(camTarget));
  }

  const table = standings(world);
  const place = table.indexOf(river) + 1;
  const alive = world.rivers.filter(isRacing).length;
  hud.rank.textContent = `${ordinal(place)}/${world.rivers.length} · ${alive} flowing`;
  const toSea = world.dist[cellIndex(terrain, river.x, river.z)];
  hud.dist.textContent = river.out ? `Watching ${nameOf(focus)}` : `${(toSea / 1000).toFixed(2)} km to sea`;
  const secs = (river.finished ? river.finishTick : world.tick) / TICK_HZ;
  hud.time.textContent = fmtTime(secs);
  hud.litres.textContent = fmtL(river.volume);
  if (!isRacing(river) && !endShown) {
    endShown = true;
    const head = river.finished
      ? place === 1 ? 'You reached the sea first!' : `You reached the sea ${ordinal(place)}`
      : `Absorbed by ${river.out.by}`;
    hud.banner.innerHTML = `<b>${head}</b><span>${ordinal(place)} of ${world.rivers.length} · ${fmtTime(secs)} · ${fmtL(river.volume)}</span><span>${river.lakes} lake${river.lakes === 1 ? '' : 's'} swallowed</span><small>Tap or press R to race again</small>`;
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
  focus: { get: () => focus },
});
