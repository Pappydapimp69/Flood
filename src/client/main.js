import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateIsland, stats, fingerprint, findLakes } from '../shared/terrain.js';
import { createWorld, rollIsland, addRiver, step, surfaceAt, cellIndex, riverFingerprint, standings, isRacing, dropZone, landingCell, keepInZone, dischargeOf, headOf, spawnBand, DT, TICK_HZ, TUNE } from '../shared/river.js';
import { createBot, botSteer } from '../shared/bot.js';
import { decodeFrame, FP_EVERY, FINISH_WINDOW } from '../shared/protocol.js';
import { buildTerrainMesh, buildSeabed, applyCarve, resetCarve, setLakeLevel, highlightZone, VERT } from './terrainMesh.js';
import { buildSea, buildLakes, makeSurge, makeSpray, updateSpray, burstSpray, tickWater } from './water.js';
import { Ribbon } from './ribbon.js';
import { createInput } from './input.js';
import { connect } from './net.js';
import { createAudio } from './audio.js';
import { buildTrees, buildRocks, clearTrees, clearAround, buildLava, coolLava, pulseLava } from './scenery.js';

// Test/debug surface. Tests poll this instead of waiting on wall-clock time.
const dbg = (window.__flood = { ready: false, error: null, frames: 0, steers: [], prints: new Map() });

const params = new URLSearchParams(location.search);
// Stamped with the commit at deploy (see .github/workflows/pages.yml); shown small, so a stale cache is visible.
const BUILD = '__BUILD__';
document.getElementById('build').textContent = BUILD.startsWith('__') ? 'dev' : `build ${BUILD}`;
const PLAYER = 'you';

function fail(msg) {
  dbg.error = msg;
  const el = document.getElementById('fallback');
  el.textContent = msg;
  el.hidden = false;
}

// Phones and tablets: no MSAA and a lower pixel-ratio cap; fill rate is the bottleneck there.
const lowPower = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
// ?lite (tests on software rendering): quarter-resolution, no trees or boulders.
const lite = new URLSearchParams(location.search).has('lite');
const maxRatio = lite ? 0.5 : lowPower ? 1.5 : 2;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: !lowPower, powerPreference: 'high-performance' });
} catch (e) {
  fail('WebGL is not available in this browser.');
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio));
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
let terrain, terrainMesh, seabed, sea, lakesMesh, W;
function useIsland(seed, made) {
  if (terrain?.seed === seed) return;
  for (const m of [terrainMesh, seabed, sea, lakesMesh]) if (m) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  terrain = made ?? generateIsland(seed);
  W = terrain.worldSize;
  terrainMesh = buildTerrainMesh(terrain);
  seabed = buildSeabed(terrain);
  sea = buildSea(terrain);
  lakesMesh = buildLakes(terrain, findLakes(terrain).label);
  scene.add(terrainMesh, seabed, sea, lakesMesh);
  sun.position.set(-W * 0.6, W * 0.5, -W * 0.3);
  Object.assign(dbg, { seed, fingerprint: fingerprint(terrain), stats: stats(terrain) });
}

// Every river has its own colour: its comet in the drop and its line on the map
// (the water itself is the same turquoise for all, as in the trailer).
const PLAYER_COLOR = '#3fd8ff';
const BOT_COLORS = ['#ff5fa2', '#ffd23f', '#7cff6b', '#ff6b3d', '#b36bff', '#ff3f5f', '#3fffbf', '#ffa53f', '#6b8cff', '#e8ff3f', '#ff8fd8', '#9fff3f',
  '#ff4fd8', '#3f9fff', '#ffcf8f', '#8fffe0'];
// Rival names in solo, in the trailer's spirit.
const BOT_NAMES = ['riverboi', 'mizu_chan', 'LaCascade', 'torrent99', 'xX_Delta_Xx', 'drip.exe', 'ruisseau_', 'rio_loco', 'Wasserfall', 'brookling',
  'tide.pod', 'Niagara_fan', 'oxbow', 'rapids_', 'el_arroyo', 'flumen', 'creekz', 'deltaforce', 'h2whoa', 'meander'];
const headGeo = new THREE.SphereGeometry(1, 20, 12);
const UP = new THREE.Vector3(0, 1, 0), tailDir = new THREE.Vector3();
const streakGeo = new THREE.CylinderGeometry(0.15, 1, 1, 8, 1, true).translate(0, 0.5, 0);
// Where your drop will touch down if you keep this heading: a ring on the start contour.
const marker = new THREE.Mesh(
  new THREE.RingGeometry(0.7, 1, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#7ff0ff', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
);
marker.renderOrder = 2;
marker.visible = false;
// Drop guidance, all hidden once you land: a light beam standing on the
// landing spot (visible from the sky), the line your fall will follow, and an
// arrow on your drop showing which way it's heading.
const guideMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0), guideMat('#7ff0ff', 0.28));
beam.material.side = THREE.DoubleSide;
const course = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3)),
  new THREE.LineDashedMaterial({ color: '#eaffff', dashSize: 160, gapSize: 110, transparent: true, opacity: 0.9, depthTest: false }));
course.renderOrder = 3;
// A flat arrow lying level, pointing +z before it's turned to the heading.
const arrowShape = new THREE.Shape([[-0.22, -1], [0.22, -1], [0.22, 0.1], [0.6, 0.1], [0, 1], [-0.6, 0.1], [-0.22, 0.1]].map(([x, y]) => new THREE.Vector2(x, y)));
const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape).rotateX(Math.PI / 2), guideMat('#ffe36b', 0.95));
arrow.material.side = THREE.DoubleSide;
arrow.renderOrder = 3;
arrow.material.depthTest = false;
// The landing area itself: every start cell glows, a band round the summit.
const zoneDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
  color: '#8ff6ff', size: 140, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false,
}));
zoneDots.renderOrder = 2;
function buildZoneDots() {
  const n = terrain.size, cells = [...dropZone(world)], pos = new Float32Array(cells.length * 3);
  cells.forEach((k, i) => {
    const x = ((k % n) / (n - 1) - 0.5) * W, z = (Math.floor(k / n) / (n - 1) - 0.5) * W;
    pos.set([x, surfaceAt(world, x, z) * VERT + 25, z], i * 3);
  });
  zoneDots.geometry.dispose();
  zoneDots.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
}
const guides = [marker, beam, course, arrow, zoneDots];
for (const g of guides) g.visible = false;

// One render entry per river: ribbon, head and last-tick position for interpolation.
function makeEntry(r, i) {
  const mine = r === river;
  const color = mine ? PLAYER_COLOR : BOT_COLORS[i % BOT_COLORS.length];
  const ribbon = new Ribbon(color, mine);
  // Falling, a river is a comet: a bright head in its colour and a glowing tail.
  const head = new THREE.Mesh(headGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.45) }));
  const streak = new THREE.Mesh(streakGeo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: mine ? 0.95 : 0.85, depthWrite: false,
  }));
  // Its course on the map: a line in its colour.
  const line = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color, depthTest: false, side: THREE.DoubleSide }));
  line.renderOrder = 6;
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  // On the ground the head is a foaming surge throwing spray, as in the trailer.
  const surge = makeSurge(mine), spray = makeSpray();
  scene.add(ribbon.mesh, head, streak, surge, spray);
  return { r, ribbon, head, streak, surge, spray, line, color, prev: { x: r.x, z: r.z }, mx: r.dx, mz: r.dz };
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
  // Re-read the pixel ratio: zoom, OS scaling or a new monitor change it after load.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
}
fitCamera();
addEventListener('resize', fitCamera);

const input = createInput(renderer.domElement);
// Once a controller shows up, say how to use it.
input.onPad = () => {
  document.getElementById('help').textContent = 'Controller: left stick steers (up / down while falling) · right stick turns the camera · A: select / race again · Y: map · X: sound';
};
const audio = createAudio();
const muteBtn = document.getElementById('mute');
const showMute = () => { muteBtn.textContent = audio.muted ? '🔇' : audio.blocked ? '🔈 click for sound' : '🔊'; };
// A gamepad press can't start sound in a browser: say so until a click or key wakes it.
setInterval(showMute, 1000);
muteBtn.onclick = () => { audio.toggle(); showMute(); };
showMute();
const hud = {
  dist: document.getElementById('dist'),
  time: document.getElementById('time'),
  litres: document.getElementById('litres'),
  depth: document.getElementById('depth'),
  drain: document.getElementById('drain'),
  drainText: document.getElementById('drain-text'),
  rank: document.getElementById('rank'),
  pop: document.getElementById('pop'),
  feed: document.getElementById('feed'),
  banner: document.getElementById('banner'),
  menu: document.getElementById('menu'),
  status: document.getElementById('status'),
  hint: document.getElementById('hint'),
};

const BOTS = Math.max(0, Math.min(40, Number(params.get('bots') ?? 11)));

// A race: the world plus what draws it. `river` is null when spectating.
let trees, rocks, lava; // scenery for the current race
let world, river, entries = [], bots = [], focus, names = {}, acc = 0, mapView, endShown, mode, raceOver, finalShown;
// Online: frames from the server, consumed in order; ids give each char's river.
let net, ids = [], frames = [], nextFrame = 0, endTable = null;

// rolled: a world already built for this seed (solo rolls it), else built here.
function beginRace(seed, raceIds, me, rolled) {
  for (const e of entries) {
    scene.remove(e.ribbon.mesh, e.head, e.streak, e.surge, e.spray, e.line);
    e.line.geometry.dispose(); e.line.material.dispose();
    e.ribbon.geo.dispose(); e.head.material.dispose(); e.streak.material.dispose();
    e.surge.material.dispose(); e.spray.geometry.dispose(); e.spray.material.dispose();
  }
  useIsland(seed, rolled?.terrain);
  world = rolled?.terrain === terrain ? rolled : createWorld(terrain);
  for (const id of raceIds) addRiver(world, id, undefined, { drop: !params.has('nodrop') }); // sorted ids: reproducible spawns
  river = world.rivers.find((r) => r.id === me) ?? null;
  focus = river ?? world.rivers[0];
  entries = world.rivers.map(makeEntry);
  acc = 0;
  endShown = false;
  endTable = null;
  raceOver = false;
  finalShown = false;
  pendingActions.length = 0; // presses from the menu don't carry into the race
  lakeShown.clear();
  showHint();
  document.getElementById('hud').hidden = false;
  resetCarve(terrainMesh);
  updateLakes(); // dry basins show as dry from the first frame
  for (const g of guides) if (!g.parent) scene.add(g);
  buildZoneDots();
  for (const m of [trees, rocks, lava]) if (m) {
    scene.remove(m);
    m.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); o.dispose?.(); });
  }
  trees = buildTrees(world, lite ? 0 : lowPower ? 2500 : 7000);
  rocks = buildRocks(world, lite ? 0 : lowPower ? 1200 : 3500);
  scene.add(rocks);
  lava = buildLava(world);
  scene.add(trees, lava);
  if (river?.dropping) highlightZone(terrainMesh, dropZone(world), true);
  hud.banner.hidden = true;
  hud.feed.textContent = '';
  audio.track('race');
  finishShown = false;
  finishEl.classList.remove('on');
  // Opening shot: from low on the island, the rivers raining onto the summit.
  introUntil = river?.dropping && !params.has('nointro') ? performance.now() + 4500 : 0;
  const y = surfaceAt(world, focus.x, focus.z) * VERT;
  camDir.set(focus.dx, focus.dz).normalize();
  camYaw = 0;
  camera.position.set(focus.x - focus.dx * 1500, y + 1400, focus.z - focus.dz * 1500);
  camTarget.set(focus.x, y, focus.z);
}

function newRun() {
  mode = 'solo';
  // A fresh island every race, unless ?seed pins one.
  const want = Number(params.get('seed')) || 1 + Math.floor(Math.random() * 1_000_000);
  const all = [PLAYER, ...Array.from({ length: BOTS }, (_, i) => `bot${String(i + 1).padStart(2, '0')}`)].sort();
  names = Object.fromEntries(all.filter((id) => id !== PLAYER).map((id, i) => [id, BOT_NAMES[i % BOT_NAMES.length]]));
  // Reroll until the summit ring seats everyone.
  const { seed, world: rolled } = rollIsland(want, all.length);
  beginRace(seed, all, PLAYER, rolled);
  bots = world.rivers.filter((r) => r !== river).map((r) => createBot(world, r));
}

let everOpen = false;
function goOnline(name) {
  mode = 'online';
  input.onChange = (st) => { if (river && isRacing(river)) net?.steer(st, performance.now(), true, river.dropping ? input.forward() : 0); };
  if (!terrain) { useIsland(1); camera.position.set(W * 0.45, W * 0.6, W * 0.7); camera.lookAt(0, 0, 0); }
  status('Connecting…');
  net = connect({
    name,
    onStatus: (s) => {
      if (s === 'open') everOpen = true;
      if (s === 'lost') status(everOpen ? 'Connection lost — rejoining…' : 'No game server here — run it with npm run server · retrying…');
    },
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

// The direction a river has actually been going: from a point ~400 m back
// along its path to the head. Falls back to its heading at the start.
function courseOf(r, hx, hz) {
  const p = r.path;
  for (let i = p.length - 1; i >= 0; i--) {
    const dx = hx - p[i].x, dz = hz - p[i].z, d = Math.hypot(dx, dz);
    if (d >= 400) return new THREE.Vector2(dx / d, dz / d);
  }
  return new THREE.Vector2(r.dx, r.dz);
}

const camTarget = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camDir = new THREE.Vector2(0, -1);
// Right stick: a look offset around the head, eased back behind it once released.
let camYaw = 0, lookIdle = 0;
// The opening shot runs until this time (ms); any key, click or steer skips it.
let introUntil = 0;
for (const ev of ['keydown', 'pointerdown']) addEventListener(ev, () => { introUntil = 0; });
// 1: cuts deeper than you (touching it drains you), -1: shallower (you drain
// it), 0: too close to call — the same deadband the sim uses.
function threatOf(r) {
  const lead = Math.abs(r.depth - river.depth) / Math.max(Math.min(r.depth, river.depth), 0.5);
  if (lead <= TUNE.siphonDeadband) return 0;
  return r.depth > river.depth ? 1 : -1;
}

// Name tags over the nearest rivals, so you know who is who and who is bigger.
const tagBox = document.getElementById('tags');
const tagPool = [];
const tmpV = new THREE.Vector3();
function placeTags() {
  const near = entries
    .filter((e) => e.screen && e.r !== river)
    .map((e) => ({ e, d: Math.hypot(e.r.x - focus.x, e.r.z - focus.z) }))
    .filter((o) => o.d < (o.e.r.dropping ? 20000 : 5000) && !mapView)
    .sort((a, b) => a.d - b.d)
    .slice(0, river?.dropping ? 14 : 8);
  while (tagPool.length < near.length) {
    const el = document.createElement('div');
    tagBox.append(el);
    tagPool.push(el);
  }
  tagPool.forEach((el, i) => {
    const o = near[i];
    if (!o) { el.hidden = true; return; }
    tmpV.set(...o.e.screen).project(camera);
    if (tmpV.z > 1) { el.hidden = true; return; }
    el.hidden = false;
    const t = river ? threatOf(o.e.r) : 0;
    el.className = o.e.r.dropping ? 'drop' : t > 0 ? 'threat' : t < 0 ? 'prey' : '';
    el.textContent = o.e.r.dropping ? nameOf(o.e.r) : `${nameOf(o.e.r)} ${t > 0 ? '▲' : t < 0 ? '▼' : river ? '=' : ''}`;
    el.style.transform = `translate(${((tmpV.x + 1) / 2) * innerWidth}px, ${((1 - tmpV.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
  });
}

const nameOf = (r) => (r === river ? 'You' : names[r.id] ?? r.id);
function feed(text) {
  const li = document.createElement('div');
  li.textContent = text;
  hud.feed.prepend(li);
  while (hud.feed.children.length > 4) hud.feed.lastChild.remove();
  setTimeout(() => li.remove(), 5000);
}

// Gamepad actions that work outside a race too: menu focus and confirm,
// "Race again" on the results card, mute.
function menuActions() {
  const keep = [];
  for (const a of input.takeActions()) {
    const menuOpen = !hud.menu.hidden;
    const again = document.getElementById('again');
    if (!splash.hidden) { if (a === 'confirm') leaveSplash(); continue; }
    if (a === 'mute') { audio.toggle(); showMute(); }
    else if (menuOpen && (a === 'up' || a === 'down')) {
      const btns = [...hud.menu.querySelectorAll('button:not([hidden])')];
      const i = btns.indexOf(document.activeElement);
      btns[i < 0 ? 0 : (i + (a === 'down' ? 1 : btns.length - 1)) % btns.length].focus();
    } else if (a === 'confirm' && menuOpen) {
      const focused = hud.menu.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON';
      (focused ? document.activeElement : document.getElementById('play-solo')).click();
    } else if (a === 'confirm' && again && !hud.banner.hidden) again.click();
    else if (a !== 'confirm' && a !== 'up' && a !== 'down') keep.push(a);
  }
  pendingActions.push(...keep);
}
const pendingActions = [];

function handleActions() {
  for (const a of pendingActions.splice(0)) {
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

// This tick's input: steer, plus hurry / slow while falling.
function sampleSteer() {
  let steer = dbg.forceSteer ?? input.sample();
  let f = river?.dropping ? (dbg.forceFwd ?? input.forward()) : 0;
  // Falling, a drag aims the drop: it turns toward the dragged direction on
  // screen; a long drag dives faster, a short one glides slower.
  const aim = river?.dropping && dbg.forceSteer === undefined ? dragAim() : null;
  if (aim) { steer = aim.s; f = aim.f; }
  dbg.steers.push(steer);
  if (dbg.steers.length > 200) dbg.steers.shift();
  return f ? { s: steer, f } : steer;
}

// Draw the drag stick while it aims the drop.
const stickEl = document.getElementById('stick'), knobEl = stickEl.firstElementChild;
function showStick() {
  const d = river?.dropping && !mapView ? input.drag() : null;
  stickEl.classList.toggle('on', !!d);
  if (!d) return;
  const len = Math.hypot(d.dx, d.dy), k = Math.min(1, 56 / (len || 1));
  stickEl.style.transform = `translate(${d.x0}px, ${d.y0}px)`;
  knobEl.style.transform = `translate(${d.dx * k}px, ${d.dy * k}px)`;
  stickEl.classList.toggle('far', len > STICK_FAR);
}

// The drag stick, read against the camera: screen up is the way the camera looks.
// The aim is locked on the ground when the drag points somewhere new (the camera
// swings round behind the drop as it turns, so re-reading it every tick would
// keep turning); the drop turns until it faces the locked aim, then holds.
const STICK_MIN = 18, STICK_FAR = 70; // pixels
let aimLock = null; // { ang (screen angle of the drag), x, z (world direction) }
function dragAim() {
  const d = input.drag();
  if (!d) { aimLock = null; return null; }
  const len = Math.hypot(d.dx, d.dy);
  if (len < STICK_MIN) return { s: 0, f: -1 }; // finger down, barely moved: hold course and glide slow
  const ang = Math.atan2(d.dx, -d.dy);
  if (!aimLock || Math.abs(Math.atan2(Math.sin(ang - aimLock.ang), Math.cos(ang - aimLock.ang))) > 0.17) {
    const fx = camTarget.x - camera.position.x, fz = camTarget.z - camera.position.z, fl = Math.hypot(fx, fz) || 1;
    const ux = fx / fl, uz = fz / fl; // screen up, on the ground; screen right is (-uz, ux)
    const wx = -uz * d.dx + ux * -d.dy, wz = ux * d.dx + uz * -d.dy, wl = Math.hypot(wx, wz) || 1;
    aimLock = { ang, x: wx / wl, z: wz / wl };
  }
  const cross = river.dx * aimLock.z - river.dz * aimLock.x, dot = river.dx * aimLock.x + river.dz * aimLock.z;
  // Steering left (-1) turns the heading toward negative cross; within ~6 degrees, hold.
  const s = dot > 0.995 ? 0 : cross < 0 ? -1 : 1;
  return { s, f: len > STICK_FAR ? 1 : 0 };
}

function soloTick() {
  if (handleActions() || raceOver) return;
  // Bots decide from the same start-of-tick state, then everyone steps together.
  const inputs = new Map([[PLAYER, sampleSteer()]]);
  for (const b of bots) inputs.set(b.river.id, dbg.botsOff ? 0 : botSteer(world, b));
  advance(inputs);
  if (raceIsOver(world)) raceOver = true;
}

function onlineTick() {
  advance(decodeFrame(ids, frames[nextFrame++]));
  if (world.tick % FP_EVERY === 0) {
    const fp = riverFingerprint(world);
    dbg.prints.set(world.tick, fp);
    net.fingerprint(world.tick, fp);
  }
}

// Same rule as the server: everyone stops once nobody is racing, or 90 s
// after the first river reaches the sea.
function raceIsOver(w) {
  if (!w.rivers.some(isRacing)) return true;
  const first = Math.min(...w.rivers.filter((r) => r.finished).map((r) => r.finishTick));
  return Number.isFinite(first) && w.tick - first >= FINISH_WINDOW;
}

// Water won and lost to rivals since the last feedback update, by rival index.
const tug = { gain: new Map(), loss: new Map(), lastTick: -1, shownAt: 0 };

// Every half second: a pop for water you siphoned, a red edge and a warning
// while someone is siphoning you.
let steamed = 0;
function tugFeedback(now) {
  const draining = river && isRacing(river) && world.tick - tug.lastTick < 6 && tug.loss.size > 0;
  hud.drain.classList.toggle('on', !!draining);
  if (now - tug.shownAt < 500) return;
  tug.shownAt = now;
  const top = (m) => [...m].sort((a, b) => b[1] - a[1])[0];
  if (draining) {
    const [who] = top(tug.loss);
    hud.drainText.textContent = `${nameOf(world.rivers[who])} is cutting deeper — it's draining you`;
  }
  if (steamed > 0) { showPop(`Lava! Boiling off ${fmtL(steamed)}`); steamed = 0; return; }
  if (tug.gain.size) {
    const total = [...tug.gain.values()].reduce((a, b) => a + b, 0);
    const [who] = top(tug.gain);
    showPop(`+${fmtL(total)} from ${nameOf(world.rivers[who])}`);
  }
  tug.gain.clear();
  tug.loss.clear();
}

// Lake levels follow the water each holds; redrawn in small steps.
const lakeShown = new Map();
function updateLakes() {
  const { lakes, lakeVol, lakeCap } = world;
  for (let i = 0; i < lakes.length; i++) {
    const full = Math.min(1, lakeVol[i] / lakeCap[i]);
    const was = lakeShown.get(i) ?? 1;
    if (Math.abs(was - full) < 0.03 && !(full >= 0.999 && was < 0.999) && !(full === 0 && was !== 0)) continue;
    lakeShown.set(i, full);
    setLakeLevel(terrainMesh, world.lakeOf, world.carve, i, full);
  }
}

function advance(inputs) {
  for (const e of entries) { e.prev = { x: e.r.x, z: e.r.z }; e.prevAlt = e.r.alt; }
  step(world, inputs);
  const dirty = world.dirty.splice(0);
  applyCarve(terrainMesh, world.carve, dirty, world.rock);
  clearTrees(trees, dirty, world.carve);
  clearTrees(rocks, dirty, world.carve);
  const cooled = world.cooled.splice(0);
  if (cooled.length) { coolLava(lava, cooled); clearTrees(trees, cooled, world.rock); }
  if (world.tick % 10 === 0) updateLakes();
  for (const e of world.events.splice(0)) {
    if (e.type === 'land') {
      const en = entries[e.river], lr = world.rivers[e.river];
      if (en) burstSpray(en.spray, lr.x, surfaceAt(world, lr.x, lr.z) * VERT, lr.z, 1.2, 70);
      if (river && e.river === river.idx) { highlightZone(terrainMesh, dropZone(world), false); audio.splash(1.2); }
    } else if (e.type === 'pool') {
      if (river && e.river === river.idx) showPop('Basin — your water pours in as you flow across');
    } else if (e.type === 'spill') {
      if (river && e.river === river.idx) showPop('Full — spilling on, and the lake keeps feeding you');
      feed(`${nameOf(world.rivers[e.river])} filled a basin`);
    } else if (e.type === 'join') {
      if (river && e.river === river.idx) { showPop('Lake joined · its outflow now feeds you, shared by depth'); audio.lake(); }
    } else if (e.type === 'junction') {
      const from = world.rivers[e.from], to = world.rivers[e.to];
      if (to === river) showPop(`You cut into ${nameOf(from)} — its water flows into you`);
      if (from === river) showPop(`${nameOf(to)} cut your channel — your water runs into it!`);
      feed(`${nameOf(to)} cut into ${nameOf(from)}`);
    } else if (e.type === 'steam') {
      if (river && e.river === river.idx) { steamed += e.amount; audio.hiss(); }
    } else if (e.type === 'siphon' && river) {
      // Tally the tug-of-war; the render loop turns it into feedback.
      if (e.to === river.idx) { tug.gain.set(e.from, (tug.gain.get(e.from) ?? 0) + e.amount); audio.bubble(); }
      if (e.from === river.idx) tug.loss.set(e.to, (tug.loss.get(e.to) ?? 0) + e.amount);
      tug.lastTick = world.tick;
    } else if (e.type === 'merge') {
      const w = world.rivers[e.winner], l = world.rivers[e.loser];
      if (w === river) { showPop(`You drained ${nameOf(l)} dry`); audio.merge(true); }
      if (l === river) audio.merge(false);
      feed(`${nameOf(w)} drained ${nameOf(l)} dry`);
      // Spectate whoever drained the river we were watching.
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

function showResults(table, final) {
  if (final || !river || !isRacing(river)) audio.track('menu');
  const secs = (river?.finished ? river.finishTick : world.tick) / TICK_HZ;
  const place = river ? table.indexOf(river) + 1 : 0;
  let head = 'Race over';
  if (river?.finished) head = place === 1 ? 'You reached the sea first!' : `You reached the sea ${ordinal(place)}`;
  else if (river?.out) head = `Drained dry by ${nameOf(world.rivers.find((r) => r.id === river.out.by))}`;
  else if (river && final) head = `Time's up — ${ordinal(place)}`;
  const status = (r) => r.finished ? `sea · ${fmtTime(r.finishTick / TICK_HZ)}`
    : r.out ? `drained by ${nameOf(world.rivers.find((o) => o.id === r.out.by))}` : 'still flowing';
  const rows = table.slice(0, 5);
  if (river && place > 5) rows.push(river);
  const list = rows.map((r) => `<li class="${r === river ? 'me' : ''}"><span>${ordinal(table.indexOf(r) + 1)} ${escapeHtml(nameOf(r))}</span><span>${status(r)}</span></li>`).join('');
  const sub = river ? `<span>${ordinal(place)} of ${world.rivers.length} · ${fmtTime(secs)} · ${fmtL(river.volume)} · ${river.lakes} lake${river.lakes === 1 ? '' : 's'}</span>` : '';
  const again = mode === 'solo'
    ? `<button id="again">Race again</button>`
    : `<small>${final ? 'Next race starts soon' : 'The race goes on — watch it out'}</small>`;
  hud.banner.innerHTML = `<b>${head}</b>${sub}<ol>${list}</ol>${final || !river ? '' : '<small>Final results when the race ends</small>'}${again}`;
  hud.banner.hidden = false;
  document.getElementById('again')?.addEventListener('click', () => newRun());
}
const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let hintTimer;
function showHint() {
  let seen = false;
  try { seen = localStorage.getItem('flood.hint') === '1'; localStorage.setItem('flood.hint', '1'); } catch { /* no storage */ }
  if (seen || params.has('nohint')) return;
  hud.hint.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hud.hint.hidden = true; }, 9000);
}

// The trailer's lines, each shown once, at the moment it describes.
const captionEl = document.getElementById('caption'), finishEl = document.getElementById('finish');
const captionSeen = new Set();
let captionOff = 0;
function caption(key, html) {
  if (captionSeen.has(key) || params.has('nocaptions')) return;
  captionSeen.add(key);
  captionEl.innerHTML = html;
  captionEl.classList.add('on');
  captionOff = performance.now() + 2800;
}
let finishShown = false;
function watchCaptions(now, place) {
  if (now > captionOff) captionEl.classList.remove('on');
  if (!river) return;
  if (!river.dropping && river.path.length > 1 && world.tick - river.born > 10) caption('goal', 'Be the first <b>to the sea</b>');
  if (river.lakes > 0) caption('lakes', 'Swallow lakes to grow <b>stronger</b>');
  if (!river.dropping && isRacing(river) && world.tick - river.born > 200) {
    for (const r of world.rivers) {
      if (r === river || !isRacing(r) || r.dropping) continue;
      if (Math.hypot(r.x - river.x, r.z - river.z) < 1800 && threatOf(r) > 0) { caption('rivals', 'Plan your route well or rivals <b>cut you off</b>'); break; }
    }
  }
  // Reaching the sea: the place, huge, as in the trailer's ending.
  if (river.finished && !finishShown) {
    finishShown = true;
    finishEl.textContent = `#${place}`;
    finishEl.classList.toggle('other', place !== 1);
    finishEl.classList.add('on');
    audio.finish(place === 1);
    setTimeout(() => finishEl.classList.remove('on'), 3200);
  }
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ordinal = (n) => `#${n}`;

// Which way is downhill? The game never steers, so when your heading is off
// the fall line a green chevron on the ground and an arrow on screen say
// which way to turn. Fall line over ~300 m, so small bumps don't flicker it.
const downEl = document.getElementById('downhill');
const chevron = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([[-0.8, -0.2], [0, 0.6], [0.8, -0.2], [0.8, -0.65], [0, 0.15], [-0.8, -0.65]].map(([x, y]) => new THREE.Vector2(x, y)))).rotateX(Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#9cff7a', transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
chevron.renderOrder = 3;
chevron.visible = false;
scene.add(chevron);
let downAt = 0, downTurn = 0;
function showDownhill(now) {
  const me = river;
  const on = !!me && isRacing(me) && !me.dropping && me.pooled < 0 && !mapView;
  chevron.visible = on && downTurn !== 0;
  if (!on) { downEl.hidden = true; return; }
  if (now - downAt > 200) {
    downAt = now;
    const R = 300, h = (x, z) => surfaceAt(world, x, z, me.idx);
    const gx = h(me.x + R, me.z) - h(me.x - R, me.z), gz = h(me.x, me.z + R) - h(me.x, me.z - R);
    const len = Math.hypot(gx, gz);
    if (len < 0.5) { downTurn = 0; } // flat: nothing to say
    else {
      const fx = -gx / len, fz = -gz / len;
      const dot = me.dx * fx + me.dz * fz, cross = me.dx * fz - me.dz * fx;
      // Steering left (-1) turns the heading toward negative cross.
      downTurn = dot > 0.9 ? 0 : cross < 0 ? -1 : 1;
      chevron.userData.dir = [fx, fz];
    }
    downEl.hidden = downTurn === 0;
    downEl.textContent = downTurn < 0 ? '◀ downhill' : downTurn > 0 ? 'downhill ▶' : '';
  }
  if (downTurn) {
    const [fx, fz] = chevron.userData.dir, sc = 150 * me.size;
    const x = me.x + fx * 260 * me.size, z = me.z + fz * 260 * me.size;
    chevron.position.set(x, surfaceAt(world, x, z) * VERT + 30, z);
    chevron.scale.set(sc, sc, sc);
    chevron.rotation.set(0, Math.atan2(fx, fz), 0);
  }
}

// The map view draws every river's course as a line in its colour.
let mapLinesAt = 0;
function updateMapLines(now) {
  for (const e of entries) e.line.visible = mapView && e.r.path.length > 1;
  if (!mapView || now - mapLinesAt < 400) return;
  mapLinesAt = now;
  for (const e of entries) {
    const p = e.r.path;
    if (p.length < 2) continue;
    // A flat strip wide enough to read at map scale.
    const half = e.r === river ? 420 : 300, pos = new Float32Array(p.length * 6), idx = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      const y = surfaceAt(world, p[i].x, p[i].z) * VERT + 120;
      pos.set([p[i].x - (dz / l) * half, y, p[i].z + (dx / l) * half, p[i].x + (dz / l) * half, y, p[i].z - (dx / l) * half], i * 6);
      if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    }
    e.line.geometry.dispose();
    e.line.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
    e.line.geometry.setIndex(idx);
    e.line.geometry.computeBoundingSphere();
  }
}

// While falling: ring the start-contour cell you'd land on holding this
// heading, stand a beam on it, draw your course there and point your drop.
let markerAt = 0;
function showMarker(now, hx, hy, hz) {
  const on = !!river?.dropping && isRacing(river) && !mapView && now >= introUntil;
  for (const g of guides) g.visible = on;
  if (!on) return;
  // The arrow follows the drop every frame, just ahead of it.
  const sz = 220;
  arrow.position.set(hx + river.dx * 380, hy - 60, hz + river.dz * 380);
  arrow.scale.set(sz, sz, sz);
  arrow.rotation.set(0, Math.atan2(river.dx, river.dz), 0);
  const pulse = 1 + 0.12 * Math.sin(now / 160);
  if (now - markerAt < 120) { marker.scale.x = marker.scale.z = marker.userData.sc * pulse; return; }
  markerAt = now;
  const left = river.dropping / TICK_HZ;
  const n = terrain.size;
  // Fly the rest of the fall on this heading, held inside the landing ring as the sim does.
  let q = { x: river.x, z: river.z };
  const stepM = (TUNE.glideSpeed * left) / 30;
  for (let i = 0; i < 30; i++) q = keepInZone(world, q.x + river.dx * stepM, q.z + river.dz * stepM);
  const px = q.x, pz = q.z;
  const k = landingCell(world, px, pz);
  const x = ((k % n) / (n - 1) - 0.5) * W, z = (Math.floor(k / n) / (n - 1) - 0.5) * W;
  const gy = surfaceAt(world, x, z) * VERT;
  marker.position.set(x, gy + 30, z);
  marker.userData.sc = 250 + 900 * Math.min(1, left / 10); // shrinks as touchdown nears
  marker.scale.set(marker.userData.sc * pulse, 1, marker.userData.sc * pulse);
  beam.position.set(x, gy, z);
  beam.scale.set(90, Math.max(800, hy - gy + 600), 90);
  // Course: from under the drop, along its heading, then to where it lands.
  const pos = course.geometry.attributes.position;
  const ux = river.x, uz = river.z;
  pos.setXYZ(0, ux, surfaceAt(world, ux, uz) * VERT + 40, uz);
  pos.setXYZ(1, px, surfaceAt(world, px, pz) * VERT + 40, pz);
  pos.setXYZ(2, x, gy + 40, z);
  pos.needsUpdate = true;
  course.geometry.computeBoundingSphere();
  course.computeLineDistances();
  dbg.marker = { x, z, k };
}

let last = performance.now(), sendAcc = 0;
renderer.setAnimationLoop(() => {
  // One clock for both ends (the rAF timestamp can predate a performance.now() start).
  const now = performance.now();
  const frameDt = Math.max(0, Math.min(0.25, (now - last) / 1000));
  last = now;
  input.poll();
  menuActions();
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
    if (sendAcc >= DT) {
      sendAcc = 0;
      if (river && isRacing(river)) { const v = sampleSteer(); net.steer(v.s ?? v, now, false, v.f ?? 0); }
    }
  }
  const alpha = Math.min(1, acc / DT);

  let fx = 0, fz = 0, fy = 0;
  const intro0 = now < introUntil && !mapView; // comets drawn fat for the long opening shot
  for (const e of entries) {
    const r = e.r;
    const hx = e.prev.x + (r.x - e.prev.x) * alpha, hz = e.prev.z + (r.z - e.prev.z) * alpha;
    // A falling drop sits its altitude above the ground (true metres, not exaggerated).
    const hy = surfaceAt(world, hx, hz, r.idx) * VERT + (r.dropping ? (r.alt - (r.alt - (e.prevAlt ?? r.alt)) * (1 - alpha)) : 0);
    const big = mapView ? 6 : 1; // heads read as markers on the map
    // Falling: a stretched drop with its streak. Flowing: the surge.
    e.head.visible = !r.out && (!!r.dropping || mapView);
    e.head.position.set(hx, hy + 8, hz);
    e.streak.visible = !!r.dropping && !mapView;
    if (r.dropping) {
      // The tail points back along the fall: up, and against the glide.
      tailDir.set(-r.dx * TUNE.glideSpeed, TUNE.dropAlt / (TUNE.dropTicks / TICK_HZ), -r.dz * TUNE.glideSpeed).normalize();
      e.streak.quaternion.setFromUnitVectors(UP, tailDir);
      e.streak.position.set(hx, hy, hz);
      const wide = intro0 ? 110 : r === river ? 34 : 26;
      e.streak.scale.set(wide, 1900, wide);
    }
    if (r.dropping) e.head.scale.set((intro0 ? 120 : 40) * big, (intro0 ? 120 : 40) * big, (intro0 ? 120 : 40) * big);
    else e.head.scale.set(55 * r.size * big, 30 * r.size * big, 55 * r.size * big);
    const flowing = !r.dropping && !r.out && !mapView;
    e.surge.visible = flowing;
    if (flowing) {
      // Face the way the water actually moves (eased), not the raw heading.
      const vx = r.x - e.prev.x, vz = r.z - e.prev.z, vl = Math.hypot(vx, vz);
      if (vl > 0.5) { e.mx += (vx / vl - e.mx) * 0.2; e.mz += (vz / vl - e.mz) * 0.2; }
      const ml = Math.hypot(e.mx, e.mz) || 1;
      const s = r.size * (r.finished ? 1.4 : 1);
      e.surge.position.set(hx, hy + 6 * s, hz);
      e.surge.scale.set(95 * s, 46 * s, 120 * s);
      e.surge.rotation.set(0, Math.atan2(e.mx / ml, e.mz / ml), 0);
    }
    updateSpray(e.spray, hx, hy, hz, e.mx, e.mz, r.size, Math.min(1, r.speed / 200), frameDt, flowing && !r.finished);    e.screen = isRacing(r) ? [hx, hy + 30 * r.size, hz] : null;
    e.ribbon.update(world, r, hx, hz, now / 1000);
    // Nothing stands in the water: clear trees and boulders along each new stretch.
    while ((e.cleared ?? 0) < r.path.length) {
      const q = r.path[e.cleared ?? 0];
      clearAround([trees, rocks], terrain, q.x, q.z, q.w * 0.7);
      e.cleared = (e.cleared ?? 0) + 1;
    }
    if (r === focus) { fx = hx; fz = hz; fy = hy; }
  }

  placeTags();
  pulseLava(lava, now / 1000);
  tickWater([sea, lakesMesh, ...entries.map((e) => e.surge)], now / 1000);
  showMarker(now, fx, fy, fz);
  showDownhill(now);
  showStick();
  const intro = now < introUntil && !mapView && !!river?.dropping;
  document.body.classList.toggle('intro', intro);
  updateMapLines(now);
  if (mapView) {
    controls.update();
  } else if (intro) {
    // Low on the island, looking up at the summit with the comets coming in.
    const top = spawnBand(world).top, n = terrain.size;
    const tx = ((top % n) / (n - 1) - 0.5) * W, tz = (Math.floor(top / n) / (n - 1) - 0.5) * W, th = terrain.height[top] * VERT;
    let ax = river.spawn.x - tx, az = river.spawn.z - tz;
    const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    const t = 1 - (introUntil - now) / 4500;
    const dist = 14000 - 2500 * t;
    camera.position.set(tx + ax * dist, 0, tz + az * dist);
    camera.position.y = Math.max(th * 0.55, surfaceAt(world, camera.position.x, camera.position.z) * VERT + 900) + 400 * t;
    camera.lookAt(tx, th + 3200 - 1500 * t, tz);
    camTarget.set(tx, th, tz);
  } else {
    // Chase camera. It must never fight the player: it follows the river's
    // course over the last few hundred metres (not the head's tick-to-tick heading,
    // which gravity tugs constantly), ignores small changes, turns slowly, and
    // only its height reacts quickly (up fast, down slowly, so it doesn't bob).
    // Right stick swings the camera round; let go and it eases back behind.
    const look = input.look();
    if (look) { camYaw = Math.max(-Math.PI, Math.min(Math.PI, camYaw + look * frameDt * 2.2)); lookIdle = 0; }
    else if ((lookIdle += frameDt) > 1.5) camYaw *= Math.exp(-frameDt * 1.5);
    const course = courseOf(focus, fx, fz);
    const ang = Math.atan2(camDir.x * course.y - camDir.y * course.x, camDir.x * course.x + camDir.y * course.y);
    // Falling, the camera swings with every turn so aiming reads at once.
    const falling = !!focus.dropping;
    const DEAD = falling ? 0 : 0.21; // ~12 degrees on the ground
    if (Math.abs(ang) > DEAD) {
      const turn = (Math.abs(ang) - DEAD) * Math.sign(ang) * (1 - Math.exp(-frameDt * (falling ? 6 : 1.2)));
      camDir.rotateAround(new THREE.Vector2(0, 0), turn).normalize();
    }
    const view = camDir.clone().rotateAround(new THREE.Vector2(0, 0), camYaw);
    // Low and close behind the surge, like the trailer; it pulls back as the
    // river grows, and sits high while falling.
    const sz = focus.size ?? 1;
    // Reaching the sea, it rises high over the surf, as in the trailer's ending.
    const done = !!focus.finished;
    const back = falling ? 1300 : done ? 700 : 560 + 160 * sz, up = falling ? 1100 : done ? 2600 : 300 + 110 * sz;
    const want = new THREE.Vector3(fx - view.x * back, Math.max(fy, 0) + up, fz - view.y * back);
    // Stay above the ground along the whole sightline, not just at the camera.
    for (let f = 0.25; f <= 1; f += 0.25) {
      const g = surfaceAt(world, fx - view.x * back * f, fz - view.y * back * f) * VERT;
      want.y = Math.max(want.y, g + 120 + 220 * f);
    }
    const kXZ = 1 - Math.exp(-frameDt * 5);
    camera.position.x += (want.x - camera.position.x) * kXZ;
    camera.position.z += (want.z - camera.position.z) * kXZ;
    const kY = 1 - Math.exp(-frameDt * (want.y > camera.position.y ? 3 : 0.6));
    camera.position.y += (want.y - camera.position.y) * kY;
    camera.position.y = Math.max(camera.position.y, surfaceAt(world, camera.position.x, camera.position.z) * VERT + 150);
    const ahead = falling ? 600 : done ? 2200 : 380 + 80 * sz;
    camTarget.lerp(new THREE.Vector3(fx + view.x * ahead, fy, fz + view.y * ahead), 1 - Math.exp(-frameDt * 6));
    camera.lookAt(camLook.copy(camTarget));
  }

  const table = standings(world);
  const alive = world.rivers.filter(isRacing).length;
  const me = river ?? focus;
  const place = table.indexOf(me) + 1;
  // Trailer HUD: big rank (#4/12), km to sea, litres.
  const rankHtml = river ? `#${place}<small>/${world.rivers.length}</small><em>${alive} flowing</em>` : `<small>SPECTATING</small><em>${alive} flowing</em>`;
  if (hud.rank.innerHTML !== rankHtml) hud.rank.innerHTML = rankHtml;
  hud.rank.className = !river ? '' : place === 1 ? 'top' : place <= 4 ? 'mid' : 'low';
  const toSea = world.reach[cellIndex(terrain, focus.x, focus.z)];
  const distHtml = focus !== river ? `<small>WATCHING</small> ${escapeHtml(nameOf(focus))}`
    : river.dropping ? `FALLING<small> · ${Math.ceil(river.dropping / TICK_HZ)} S</small>`
    : `${(toSea / 1000).toFixed(2)}<small> KM TO SEA</small>`;
  if (hud.dist.innerHTML !== distHtml) hud.dist.innerHTML = distHtml;
  const secs = (river?.finished ? river.finishTick : world.tick) / TICK_HZ;
  hud.time.textContent = fmtTime(secs);
  hud.litres.textContent = fmtL(me.volume);
  // The water network feeding you: lakes through your outlets, rivers you cut into.
  const feeds = me.via.size;
  let tribs = 0;
  for (const j of world.junctions.values()) if (j.to === me) tribs++;
  const fedBy = [feeds && `${feeds} lake${feeds === 1 ? '' : 's'}`, tribs && `${tribs} river${tribs === 1 ? '' : 's'}`].filter(Boolean).join(' + ');
  const basin = me.inLake >= 0 && world.lakeVol[me.inLake] < world.lakeCap[me.inLake] * TUNE.fullAt ? me.inLake : -1;
  hud.depth.textContent = me.dropping ? (lowPower ? 'drag to aim · drag far to dive faster · land on the glowing ring' : '← → steer · ↑ ↓ speed (or drag) · land on the glowing ring')
    : basin >= 0
    ? `pouring into a basin · ${Math.min(99, Math.floor(100 * world.lakeVol[basin] / world.lakeCap[basin]))}% full`
    : `pouring ${fmtL(dischargeOf(me) * TICK_HZ + me.inflow * TICK_HZ)}/s · head ${headOf(me).toFixed(1)} m · cutting ${me.depth.toFixed(1)} m` + (fedBy ? ` · fed by ${fedBy}` : '');
  watchCaptions(now, place);
  tugFeedback(now);
  if (river && !isRacing(river) && !endShown && (!river.finished || world.tick - river.finishTick > 3 * TICK_HZ)) {
    endShown = true;
    showResults(table, false);
  }
  const over = mode === 'solo' ? raceOver : endTable && nextFrame >= frames.length;
  if (over && !finalShown) {
    finalShown = true;
    showResults(table, true);
  }
  audio.update(Math.min(1, (river?.speed ?? 0) / 220), !!river && isRacing(river) && !river.dropping, river?.size ?? 1, river?.dropping ? river.dropping / TUNE.dropTicks : 0);

  renderer.render(scene, camera);
  dbg.frames++;
  dbg.calls = renderer.info.render.calls;
  if (dbg.frames === 2) dbg.ready = true;
});

Object.assign(dbg, {
  renderer, scene, camera, audio,
  nameOf: (id) => names[id] ?? id, // display name for a river id (rivals have names in solo)
  riverFingerprint: () => riverFingerprint(world),
  newRun,
});

// Start: ?seed / ?solo / ?bots go straight to a solo race, ?online joins the server,
// otherwise show the menu.
const splash = document.getElementById('splash');
function leaveSplash() {
  if (splash.hidden) return;
  splash.hidden = true;
  audio.music();
  hud.menu.hidden = false;
  document.getElementById('play-solo').focus();
}
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
else {
  // Splash first: the press that leaves it starts the music, then the menu.
  useIsland(1 + Math.floor(Math.random() * 1_000_000));
  camera.position.set(W * 0.45, W * 0.6, W * 0.7); camera.lookAt(0, 0, 0);
  splash.hidden = false;
  for (const ev of ['keydown', 'pointerdown']) addEventListener(ev, leaveSplash);
}
// Live getters (Object.assign would copy today's values, not the getters).
Object.defineProperties(dbg, {
  world: { get: () => world },
  river: { get: () => river },
  focus: { get: () => focus },
  camYaw: { get: () => camYaw },
});
