import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateIsland, stats, fingerprint } from '../shared/terrain.js';
import { createWorld, addRiver, step, surfaceAt, cellIndex, riverFingerprint, standings, isRacing, DT, TICK_HZ } from '../shared/river.js';
import { createBot, botSteer } from '../shared/bot.js';
import { decodeFrame, FP_EVERY } from '../shared/protocol.js';
import { buildTerrainMesh, buildSea, buildSeabed, applyCarve, resetCarve, drainLake, VERT } from './terrainMesh.js';
import { Ribbon } from './ribbon.js';
import { createInput } from './input.js';
import { connect } from './net.js';

// Test/debug surface. Tests poll this instead of waiting on wall-clock time.
const dbg = (window.__flood = { ready: false, error: null, frames: 0, steers: [], prints: new Map() });

const params = new URLSearchParams(location.search);
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
scene.add(new THREE.HemisphereLight('#dbeaf5', '#5b5040', 1.1));
const sun = new THREE.DirectionalLight('#fff3dc', 2.2);
scene.add(sun);

// The island changes per race online, so its meshes are rebuilt on demand.
let terrain, terrainMesh, seabed, sea, W;
function useIsland(seed) {
  if (terrain?.seed === seed) return;
  for (const m of [terrainMesh, seabed, sea]) if (m) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  terrain = generateIsland(seed);
  W = terrain.worldSize;
  terrainMesh = buildTerrainMesh(terrain);
  seabed = buildSeabed(terrain);
  sea = buildSea(W);
  scene.add(terrainMesh, seabed, sea);
  sun.position.set(-W * 0.6, W * 0.5, -W * 0.3);
  Object.assign(dbg, { seed, fingerprint: fingerprint(terrain), stats: stats(terrain) });
}

const PLAYER_COLOR = '#45d2ff';
const BOT_COLORS = ['#4f8fd0', '#4fb39a', '#7d84d8', '#3fa8b8', '#6c95e8', '#58a77f', '#9480d8', '#3f93c4', '#6fae8f', '#8496e0', '#4c9aa8'];
const headGeo = new THREE.SphereGeometry(1, 20, 12);

// One render entry per river: ribbon, head and last-tick position for interpolation.
function makeEntry(r, i) {
  const mine = r === river;
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
controls.maxDistance = 48000 * 2.5;
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
  menu: document.getElementById('menu'),
  status: document.getElementById('status'),
};

const BOTS = Math.max(0, Math.min(40, Number(params.get('bots') ?? 11)));

// A race: the world plus what draws it. `river` is null when spectating.
let world, river, entries = [], bots = [], focus, names = {}, acc = 0, mapView, endShown, mode;
// Online: frames from the server, consumed in order; ids give each char's river.
let net, ids = [], frames = [], nextFrame = 0, endTable = null;

function beginRace(seed, raceIds, me) {
  for (const e of entries) { scene.remove(e.ribbon.mesh, e.head); e.ribbon.geo.dispose(); e.head.material.dispose(); }
  useIsland(seed);
  world = createWorld(terrain);
  for (const id of raceIds) addRiver(world, id); // sorted ids: reproducible spawns
  river = world.rivers.find((r) => r.id === me) ?? null;
  focus = river ?? world.rivers[0];
  entries = world.rivers.map(makeEntry);
  acc = 0;
  endShown = false;
  endTable = null;
  resetCarve(terrainMesh);
  hud.banner.hidden = true;
  hud.feed.textContent = '';
  const y = surfaceAt(world, focus.x, focus.z) * VERT;
  camera.position.set(focus.x - focus.dx * 1500, y + 1400, focus.z - focus.dz * 1500);
  camTarget.set(focus.x, y, focus.z);
}

function newRun() {
  mode = 'solo';
  const seed = Number(params.get('seed')) || 1;
  const all = [PLAYER, ...Array.from({ length: BOTS }, (_, i) => `bot${String(i + 1).padStart(2, '0')}`)].sort();
  names = {};
  beginRace(seed, all, PLAYER);
  bots = world.rivers.filter((r) => r !== river).map((r) => createBot(world, r));
}

function goOnline(name) {
  mode = 'online';
  input.onChange = (st) => { if (river && isRacing(river)) net?.steer(st, performance.now(), true); };
  if (!terrain) { useIsland(1); camera.position.set(W * 0.45, W * 0.6, W * 0.7); camera.lookAt(0, 0, 0); }
  status('Connecting…');
  net = connect({
    name,
    onStatus: (s) => { if (s === 'lost') status('Connection lost — rejoining…'); },
    onMessage: (m) => {
      if (m.t === 'lobby') status(`Lobby · ${m.players} player${m.players === 1 ? '' : 's'} · race starts in ${m.startsIn}s`);
      else if (m.t === 'start') {
        status('');
        ids = m.ids;
        names = m.names;
        beginRace(m.seed, ids, m.you);
        bots = [];
        frames = m.log.slice();
        nextFrame = 0;
      } else if (m.t === 'f') {
        // frames[k] is tick k's frame; nextFrame is the next one to apply.
        if (world && m.k === frames.length) frames.push(m.i);
      } else if (m.t === 'end') {
        endTable = m.standings;
      }
    },
  });
}

function status(text) {
  hud.status.textContent = text;
  hud.status.hidden = !text;
}

const camTarget = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camDir = new THREE.Vector2(0, -1);
const nameOf = (r) => (r === river ? 'You' : names[r.id] ?? r.id);
function feed(text) {
  const li = document.createElement('div');
  li.textContent = text;
  hud.feed.prepend(li);
  while (hud.feed.children.length > 4) hud.feed.lastChild.remove();
  setTimeout(() => li.remove(), 5000);
}

function handleActions() {
  for (const a of input.takeActions()) {
    if (a === 'map') {
      mapView = !mapView;
      controls.enabled = mapView;
      if (mapView) { controls.target.set(0, 0, 0); camera.position.set(W * 0.4, W * 0.7, W * 0.6); }
    } else if ((a === 'restart' || a === 'tap') && mode === 'solo' && river && !isRacing(river)) {
      newRun();
      return true;
    }
  }
  return false;
}

function sampleSteer() {
  const steer = dbg.forceSteer ?? input.sample();
  dbg.steers.push(steer);
  if (dbg.steers.length > 200) dbg.steers.shift();
  return steer;
}

function soloTick() {
  if (handleActions()) return;
  // Bots decide from the same start-of-tick state, then everyone steps together.
  const inputs = new Map([[PLAYER, sampleSteer()]]);
  for (const b of bots) inputs.set(b.river.id, dbg.botsOff ? 0 : botSteer(world, b));
  advance(inputs);
}

function onlineTick() {
  advance(decodeFrame(ids, frames[nextFrame++]));
  if (world.tick % FP_EVERY === 0) {
    const fp = riverFingerprint(world);
    dbg.prints.set(world.tick, fp);
    net.fingerprint(world.tick, fp);
  }
}

function advance(inputs) {
  for (const e of entries) e.prev = { x: e.r.x, z: e.r.z };
  step(world, inputs);
  applyCarve(terrainMesh, world.carve, world.dirty.splice(0));
  for (const e of world.events.splice(0)) {
    if (e.type === 'lake') {
      drainLake(terrainMesh, world.lakeOf, e.lake);
      if (river && e.river === river.idx) showPop(`+${fmtL(e.gain)}`);
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

let last = performance.now(), sendAcc = 0;
renderer.setAnimationLoop(() => {
  // One clock for both ends (the rAF timestamp can predate a performance.now() start).
  const now = performance.now();
  const frameDt = Math.max(0, Math.min(0.25, (now - last) / 1000));
  last = now;
  if (!world) { renderer.render(scene, camera); return; }
  // Fixed-step sim, decoupled from frame rate; render interpolates between ticks.
  acc += frameDt;
  if (mode === 'solo') {
    while (acc >= DT) { soloTick(); acc -= DT; }
  } else {
    handleActions();
    // Online: one frame per tick of time, but only frames we have. A backlog
    // (joining late, reconnecting, a stall) is replayed fast, a bounded chunk per frame.
    const backlog = frames.length - nextFrame;
    if (backlog > 4) { for (let i = 0; i < Math.min(backlog - 2, 400); i++) onlineTick(); acc = 0; }
    while (acc >= DT && nextFrame < frames.length) { onlineTick(); acc -= DT; }
    if (nextFrame >= frames.length) acc = Math.min(acc, DT); // starved: wait, don't bank time
    sendAcc += frameDt;
    if (sendAcc >= DT) { sendAcc = 0; if (river && isRacing(river)) net.steer(sampleSteer(), now); }
  }
  const alpha = Math.min(1, acc / DT);

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
  const alive = world.rivers.filter(isRacing).length;
  const me = river ?? focus;
  const place = table.indexOf(me) + 1;
  hud.rank.textContent = river ? `${ordinal(place)}/${world.rivers.length} · ${alive} flowing` : `Spectating · ${alive} flowing`;
  const toSea = world.dist[cellIndex(terrain, focus.x, focus.z)];
  hud.dist.textContent = focus !== river ? `Watching ${nameOf(focus)}` : `${(toSea / 1000).toFixed(2)} km to sea`;
  const secs = (river?.finished ? river.finishTick : world.tick) / TICK_HZ;
  hud.time.textContent = fmtTime(secs);
  hud.litres.textContent = fmtL(me.volume);
  if (river && !isRacing(river) && !endShown) {
    endShown = true;
    const head = river.finished
      ? place === 1 ? 'You reached the sea first!' : `You reached the sea ${ordinal(place)}`
      : `Absorbed by ${nameOf(world.rivers.find((r) => r.id === river.out.by))}`;
    const again = mode === 'solo' ? 'Tap or press R to race again' : 'Next race starts after this one';
    hud.banner.innerHTML = `<b>${head}</b><span>${ordinal(place)} of ${world.rivers.length} · ${fmtTime(secs)} · ${fmtL(river.volume)}</span><span>${river.lakes} lake${river.lakes === 1 ? '' : 's'} swallowed</span><small>${again}</small>`;
    hud.banner.hidden = false;
  }
  if (endTable && mode === 'online' && nextFrame >= frames.length) {
    const winner = endTable[0];
    status(`Race over — ${winner === river?.id ? 'you won!' : `${names[winner] ?? winner} won`} · next race soon`);
    endTable = null;
  }

  renderer.render(scene, camera);
  dbg.frames++;
  dbg.calls = renderer.info.render.calls;
  if (dbg.frames === 2) dbg.ready = true;
});

Object.assign(dbg, {
  renderer, scene, camera,
  riverFingerprint: () => riverFingerprint(world),
  newRun,
});

// Start: ?seed / ?solo / ?bots go straight to a solo race, ?online joins the server,
// otherwise show the menu.
const nameBox = document.getElementById('name');
try { nameBox.value = localStorage.getItem('flood.name') ?? ''; } catch { /* no storage */ }
const pickName = () => {
  const n = nameBox.value.trim().slice(0, 12);
  try { localStorage.setItem('flood.name', n); } catch { /* no storage */ }
  return n;
};
document.getElementById('play-solo').onclick = () => { hud.menu.hidden = true; newRun(); };
document.getElementById('play-online').onclick = () => { hud.menu.hidden = true; goOnline(pickName()); };
if (params.has('online')) { hud.menu.hidden = true; goOnline(params.get('name') ?? ''); }
else if (params.has('seed') || params.has('solo') || params.has('bots')) { hud.menu.hidden = true; newRun(); }
else { useIsland(1); camera.position.set(W * 0.45, W * 0.6, W * 0.7); camera.lookAt(0, 0, 0); }
// Live getters (Object.assign would copy today's values, not the getters).
Object.defineProperties(dbg, {
  world: { get: () => world },
  river: { get: () => river },
  focus: { get: () => focus },
});
