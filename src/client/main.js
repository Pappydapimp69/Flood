import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateIsland, stats, fingerprint } from '../shared/terrain.js';
import { createWorld, addRiver, step, surfaceAt, cellIndex, riverFingerprint, standings, isRacing, lakeGain, DT, TICK_HZ, TUNE } from '../shared/river.js';
import { createBot, botSteer } from '../shared/bot.js';
import { decodeFrame, FP_EVERY, FINISH_WINDOW } from '../shared/protocol.js';
import { buildTerrainMesh, buildSea, buildSeabed, applyCarve, resetCarve, setLakeLevel, VERT } from './terrainMesh.js';
import { Ribbon } from './ribbon.js';
import { createInput } from './input.js';
import { connect } from './net.js';
import { createAudio } from './audio.js';

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

// Phones and tablets: no MSAA and a lower pixel-ratio cap; fill rate is the bottleneck there.
const lowPower = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
const maxRatio = lowPower ? 1.5 : 2;

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
  const ribbon = new Ribbon(color, mine);
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
  // Re-read the pixel ratio: zoom, OS scaling or a new monitor change it after load.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
}
fitCamera();
addEventListener('resize', fitCamera);

const input = createInput(renderer.domElement);
// Once a controller shows up, say how to use it.
input.onPad = () => {
  document.getElementById('help').textContent = 'Controller: stick or D-pad steers · A: select / race again · Y: map · X: sound';
};
const audio = createAudio();
const muteBtn = document.getElementById('mute');
const showMute = () => { muteBtn.textContent = audio.muted ? '🔇' : '🔊'; };
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
let world, river, entries = [], bots = [], focus, names = {}, acc = 0, mapView, endShown, mode, raceOver, finalShown;
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
  raceOver = false;
  finalShown = false;
  pendingActions.length = 0; // presses from the menu don't carry into the race
  lakeShown.clear();
  showHint();
  document.getElementById('hud').hidden = false;
  resetCarve(terrainMesh);
  updateLakes(); // dry basins show as dry from the first frame
  hud.banner.hidden = true;
  hud.feed.textContent = '';
  const y = surfaceAt(world, focus.x, focus.z) * VERT;
  camDir.set(focus.dx, focus.dz).normalize();
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

let everOpen = false;
function goOnline(name) {
  mode = 'online';
  input.onChange = (st) => { if (river && isRacing(river)) net?.steer(st, performance.now(), true); };
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
    .filter((o) => o.d < 5000 && !mapView)
    .sort((a, b) => a.d - b.d)
    .slice(0, 8);
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
    el.className = t > 0 ? 'threat' : t < 0 ? 'prey' : '';
    el.textContent = `${nameOf(o.e.r)} ${t > 0 ? '▲' : t < 0 ? '▼' : river ? '=' : ''}`;
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
    if (a === 'mute') { audio.toggle(); showMute(); }
    else if (menuOpen && (a === 'up' || a === 'down')) {
      const btns = [...hud.menu.querySelectorAll('button')];
      const i = btns.indexOf(document.activeElement);
      btns[i < 0 ? 0 : (i + (a === 'down' ? 1 : btns.length - 1)) % btns.length].focus();
    } else if (a === 'confirm' && menuOpen) {
      const focused = hud.menu.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON';
      (focused ? document.activeElement : document.getElementById('play-online')).click();
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

function sampleSteer() {
  const steer = dbg.forceSteer ?? input.sample();
  dbg.steers.push(steer);
  if (dbg.steers.length > 200) dbg.steers.shift();
  return steer;
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
  if (tug.gain.size) {
    const total = [...tug.gain.values()].reduce((a, b) => a + b, 0);
    const [who] = top(tug.gain);
    showPop(`+${fmtL(total)} from ${nameOf(world.rivers[who])}`);
  }
  tug.gain.clear();
  tug.loss.clear();
}

// Lake levels follow how much water is left; redrawn in small steps.
const lakeShown = new Map();
function updateLakes() {
  const { lakes, lakeLeft } = world;
  for (let i = 0; i < lakes.length; i++) {
    // A dry basin shows how far it has been filled; any other lake what's left.
    const full = (world.lakeDry[i] ? world.basinFill[i] : lakeLeft[i]) / lakeGain(lakes[i]);
    const was = lakeShown.get(i) ?? 1;
    if (Math.abs(was - full) < 0.04 && !(full === 0 && was !== 0)) continue;
    lakeShown.set(i, full);
    setLakeLevel(terrainMesh, world.lakeOf, world.carve, i, full);
  }
}

function advance(inputs) {
  for (const e of entries) e.prev = { x: e.r.x, z: e.r.z };
  step(world, inputs);
  applyCarve(terrainMesh, world.carve, world.dirty.splice(0));
  if (world.tick % 10 === 0) updateLakes();
  for (const e of world.events.splice(0)) {
    if (e.type === 'pool') {
      if (river && e.river === river.idx) showPop('Dry basin — filling it before you can spill on');
    } else if (e.type === 'spill') {
      if (river && e.river === river.idx) showPop(`Breached! ${fmtL(e.left)} left behind as a reservoir`);
      feed(`${nameOf(world.rivers[e.river])} filled a basin`);
    } else if (e.type === 'tap') {
      if (river && e.river === river.idx) { showPop(`Lake tapped · ${fmtL(e.left)} flowing in`); audio.lake(); }
    } else if (e.type === 'tapcut') {
      const from = world.rivers[e.from], to = world.rivers[e.to];
      if (e.how === 'cut' && to === river) showPop(`You cut ${nameOf(from)} off its lake`);
      if (e.how === 'cut' && from === river) showPop(`${nameOf(to)} cut you off your lake!`);
      if (e.how === 'cut') feed(`${nameOf(to)} cut ${nameOf(from)} off a lake`);
    } else if (e.type === 'siphon' && river) {
      // Tally the tug-of-war; the render loop turns it into feedback.
      if (e.to === river.idx) tug.gain.set(e.from, (tug.gain.get(e.from) ?? 0) + e.amount);
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

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ordinal = (n) => `#${n}`;

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
    const big = mapView ? 6 : 1; // heads read as markers on the map
    e.head.scale.set(70 * r.size * big, 25 * r.size * big, 70 * r.size * big);
    // Threat at a glance: red heads would absorb you, green ones you can absorb.
    if (river && r !== river) {
      const t = threatOf(r);
      e.head.material.emissive.set(t > 0 ? '#a8281c' : t < 0 ? '#2f8a3a' : '#7a6a1c');
      e.head.material.color.set(t > 0 ? '#ffb3a8' : t < 0 ? '#c9f5c4' : '#f5e9b0');
    }
    e.screen = isRacing(r) ? [hx, hy + 30 * r.size, hz] : null;
    e.ribbon.update(world, r, hx, hz, now / 1000);
    if (r === focus) { fx = hx; fz = hz; fy = hy; }
  }

  placeTags();
  if (mapView) {
    controls.update();
  } else {
    // Chase camera. It must never fight the player: it follows the river's
    // course over the last few hundred metres (not the head's tick-to-tick heading,
    // which gravity tugs constantly), ignores small changes, turns slowly, and
    // only its height reacts quickly (up fast, down slowly, so it doesn't bob).
    const course = courseOf(focus, fx, fz);
    const ang = Math.atan2(camDir.x * course.y - camDir.y * course.x, camDir.x * course.x + camDir.y * course.y);
    const DEAD = 0.21; // ~12 degrees
    if (Math.abs(ang) > DEAD) {
      const turn = (Math.abs(ang) - DEAD) * Math.sign(ang) * (1 - Math.exp(-frameDt * 1.2));
      camDir.rotateAround(new THREE.Vector2(0, 0), turn).normalize();
    }
    const back = 1300, want = new THREE.Vector3(fx - camDir.x * back, Math.max(fy, 0) + 1100, fz - camDir.y * back);
    // Stay above the ground along the whole sightline, not just at the camera.
    for (let f = 0.25; f <= 1; f += 0.25) {
      const g = surfaceAt(world, fx - camDir.x * back * f, fz - camDir.y * back * f) * VERT;
      want.y = Math.max(want.y, g + 250 + 400 * f);
    }
    const kXZ = 1 - Math.exp(-frameDt * 5);
    camera.position.x += (want.x - camera.position.x) * kXZ;
    camera.position.z += (want.z - camera.position.z) * kXZ;
    const kY = 1 - Math.exp(-frameDt * (want.y > camera.position.y ? 3 : 0.6));
    camera.position.y += (want.y - camera.position.y) * kY;
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
  const taps = world.lakeTaken.reduce((n, t) => n + (t === me.idx ? 1 : 0), 0);
  hud.depth.textContent = me.filling
    ? `filling a basin · ${Math.round(100 * world.basinFill[me.filling.lake] / lakeGain(world.lakes[me.filling.lake]))}%`
    : `cutting ${me.depth.toFixed(1)} m deep` + (me.inflow > 0 ? ` · +${fmtL(me.inflow * TICK_HZ)}/s from ${taps} lake${taps === 1 ? '' : 's'}` : '');
  tugFeedback(now);
  if (river && !isRacing(river) && !endShown) {
    endShown = true;
    showResults(table, false);
  }
  const over = mode === 'solo' ? raceOver : endTable && nextFrame >= frames.length;
  if (over && !finalShown) {
    finalShown = true;
    showResults(table, true);
  }
  audio.update(Math.min(1, (river?.speed ?? 0) / 220), !!river && isRacing(river));

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
