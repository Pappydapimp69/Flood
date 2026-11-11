import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateIsland, stats, fingerprint, findLakes, TUTORIAL as COURSE } from '../shared/terrain.js';
import { createWorld, rollIsland, addRiver, isLive, step, predictPath, gougeReady, gougeTarget, gougeCost, surgeReady, surfaceAt, cellIndex, riverFingerprint, standings, isRacing, dropZone, landingCell, keepInZone, skyBase, startLine, pastLine, descentLane, laneHalf, dischargeOf, headOf, widthOf, spawnBand, heatFront, slopeT, lakeLevel, lakeVolAt, skyClouds, DT, TICK_HZ, TUNE } from '../shared/river.js';
import { createBot, botSteer, flowFrom } from '../shared/bot.js';
import { decodeFrame, FP_EVERY, FINISH_WINDOW } from '../shared/protocol.js';
import { buildTerrainMesh, buildSeabed, applyCarve, resetCarve, setLakeLevel, highlightZone, markBeach, VERT } from './terrainMesh.js';
import { buildSea, buildLakes, makeSurge, makeSpray, updateSpray, burstSpray, tickWater } from './water.js';
import { Ribbon } from './ribbon.js';
import { createInput } from './input.js';
import { connect } from './net.js';
import { createAudio } from './audio.js';
import { alphaWanted, createFeedback } from './feedback.js';
import { buildTrees, buildRocks, clearTrees, clearAround, buildLava, coolLava, pulseLava, treeFade } from './scenery.js';

// Test/debug surface. Tests poll this instead of waiting on wall-clock time.
const dbg = (window.__flood = { ready: false, error: null, frames: 0, steers: [], prints: new Map() });

const params = new URLSearchParams(location.search);
// Stamped with the commit at deploy (see .github/workflows/pages.yml); shown small, so a stale cache is visible.
const BUILD = '__BUILD__';
document.getElementById('build').textContent = BUILD.startsWith('__') ? 'dev' : `build ${BUILD}`;
// A browser can keep an old index.html for ten minutes (GitHub Pages' cache),
// and with it the old build. Ask, uncached, which build is live; if it's newer,
// load it under a fresh URL (once: the ?v= marks the reload).
if (!BUILD.startsWith('__')) {
  fetch('./version.txt', { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).then((live) => {
    live = live.trim();
    if (live && live !== BUILD && params.get('v') !== live) { params.set('v', live); location.replace(`${location.pathname}?${params}`); }
  }).catch(() => {});
}
const PLAYER = 'you';
// Alpha feedback mode (?alpha): logs each race, a form for opinions, a report to copy.
// Opening it pauses a solo race.
const fb = alphaWanted(params) ? createFeedback({ build: BUILD.startsWith('__') ? 'dev' : BUILD }) : null;

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
// Adaptive resolution: a device that can't hold about 40 fps renders fewer pixels, in steps,
// never below a pixel ratio of 0.75 (phones) or 1 (desktops). Fill rate grows with the ratio
// squared (Brain seven#E98). Off in automated browsers, whose software GL is always slow.
let ratioScale = 1, slowEma = 1 / 60, slowCheck = 0;
const ratioFloor = lowPower ? 0.75 : 1;
const adaptive = new URLSearchParams(location.search).has('adaptive') || (!lite && !navigator.webdriver);
function adaptResolution(dt) {
  if (!adaptive || dt <= 0 || dt > 1 || document.hidden) return; // over 1 s: a stall or a hidden tab, not the GPU
  slowEma += (dt - slowEma) * 0.05;
  if ((slowCheck += dt) < 2) return;
  slowCheck = 0;
  const ratio = Math.min(window.devicePixelRatio, maxRatio) * ratioScale;
  if (slowEma > 1 / 40 && ratio > ratioFloor + 0.01) {
    ratioScale = Math.max(ratioFloor / Math.min(window.devicePixelRatio, maxRatio), ratioScale * 0.85);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio) * ratioScale);
    renderer.setSize(window.innerWidth, window.innerHeight);
    slowEma = 1 / 45; // give the new size a fair start
  }
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: !lowPower, powerPreference: 'high-performance' });
} catch (e) {
  fail('WebGL is not available in this browser.');
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio) * ratioScale);
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const SKY = new THREE.Color('#b3cfe0');
const scene = new THREE.Scene();
scene.background = SKY;
// Aerial perspective: haze thickens exponentially with distance, as real air does
// (Koschmieder: contrast exp(-3.912 d / V), 2% left at the visibility V; Brain
// seven#E107: linear fog keeps the middle distance far too clear and flattens depth).
// Three's FogExp2 is exp(-(k d)^2); patch it to the physical exp(-k d).
const VISIBILITY = 30000; // metres
const fogChunk = THREE.ShaderChunk.fog_fragment.replace(
  'float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );',
  'float fogFactor = 1.0 - exp( - fogDensity * vFogDepth );');
const fogPatched = fogChunk !== THREE.ShaderChunk.fog_fragment;
THREE.ShaderChunk.fog_fragment = fogChunk;
// (If a Three update changed the chunk, the squared form still reaches 2% at the visibility.)
scene.fog = new THREE.FogExp2(SKY, fogPatched ? 3.912 / VISIBILITY : Math.sqrt(3.912) / VISIBILITY);
const fogBase = scene.fog.density;
// Haze lives in the lowest air (an aerosol scale height of about 1.5 km), so looking down from
// a falling drop crosses far less of it than a view along the ground: thin the fog with height.
// At 7 km up the island read as a grey wash (descent audit, 2026-11-09).
const HAZE_HEIGHT = 1500;
let hazeK = 1;
function hazeFor(alt, dt) {
  const want = alt > 0 ? HAZE_HEIGHT / (HAZE_HEIGHT + alt) : 1;
  hazeK += (want - hazeK) * Math.min(1, dt * 2);
  if (scene.fog) scene.fog.density = fogBase * hazeK;
}
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
  const n = terrain.size, cells = startLine(world).cells, pos = new Float32Array(cells.length * 3); // the start line
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
const shadowGeo = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), stemGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
const skyY = () => skyBase(world) * VERT; // falling drops and drop clouds count their height from the start line's
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
  // Falling: a shadow on the ground under the drop and a thin stem down to it,
  // so where it is over the ground (and over the clouds' shadows) reads at once.
  const shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: mine ? 0.45 : 0.25, depthWrite: false }));
  const stem = new THREE.Mesh(stemGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: mine ? 0.55 : 0.25, depthWrite: false }));
  scene.add(ribbon.mesh, head, streak, surge, spray, shadow, stem);
  return { r, ribbon, head, streak, surge, spray, line, shadow, stem, color, prev: { x: r.x, z: r.z }, mx: r.dx, mz: r.dz };
}

const camera = new THREE.PerspectiveCamera(55, 1, 20, 400000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = 1.45;
controls.minDistance = 2000;
controls.maxDistance = 48000 * 2.5;
controls.enabled = false;

let baseFov = 55;
function fitCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  // Keep the horizontal view wide in portrait, so phones see the banks too.
  camera.fov = baseFov = aspect < 1 ? Math.min(85, (2 * Math.atan(Math.tan((55 * Math.PI) / 360) / aspect) * 180) / Math.PI) : 55;
  camera.updateProjectionMatrix();
  // Re-read the pixel ratio: zoom, OS scaling or a new monitor change it after load.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio) * ratioScale);
  renderer.setSize(window.innerWidth, window.innerHeight);
}
fitCamera();
addEventListener('resize', fitCamera);

const input = createInput(renderer.domElement);
// Once a controller shows up, say how to use it.
input.onPad = () => {
  padSeen = true;
  document.getElementById('help').textContent = 'Controller: left stick steers (falling: left / right turns, up dives, down floats) · right stick up / down: falling, the same; once landed it looks around, up for a raised view · A: gouge (select / race again in menus) · RB: surge · X: sound';
};
const audio = createAudio();
const muteBtn = document.getElementById('mute');
const showMute = () => { muteBtn.textContent = audio.muted ? '🔇' : audio.blocked ? '🔈 click for sound' : '🔊'; };
// A gamepad press can't start sound in a browser: say so until a click or key wakes it.
setInterval(showMute, 1000);
muteBtn.onclick = () => { audio.toggle(); showMute(); };
document.getElementById('mapbtn').onclick = () => pendingActions.push('map');
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
  skill: document.getElementById('skill'),
  skillNote: document.querySelector('#skill small'),
  surge: document.getElementById('surge'),
  surgeNote: document.querySelector('#surge small'),
};
// The skill button: a tap works like Space / E / pad B.
hud.skill.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); input.pressSkill(); });
hud.surge.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); input.pressSurge(); });
let gougeShakeAt = 0; // ms: when your own gouge landed (the camera jolts)

const BOTS = Math.max(0, Math.min(40, Number(params.get('bots') ?? 11)));

// A race: the world plus what draws it. `river` is null when spectating.
let trees, rocks, lava; // scenery for the current race
let world, river, entries = [], bots = [], focus, names = {}, acc = 0, mapView, endShown, mode, raceOver, finalShown;
let recordBanked = false, recordNotes = [];
let paused = false; // solo: the race clock stops; online: just the menu over a running race
// Settings, kept in this browser.
const settings = (() => { try { return { preview: true, shake: true, ...JSON.parse(localStorage.getItem('flood.settings') || '{}') }; } catch { return { preview: true, shake: true }; } })();
const saveSettings = () => { try { localStorage.setItem('flood.settings', JSON.stringify(settings)); } catch { /* no storage */ } }; // this race's results banked into flood.record yet; personal bests it set
// The end of the race: once the first river reaches the sea, the rest have
// FINISH_WINDOW to follow it; whole seconds left (null before that).
const firstFinish = () => Math.min(...world.rivers.filter((r) => r.finished).map((r) => r.finishTick));
function finishLeft() {
  const f = firstFinish();
  return Number.isFinite(f) ? Math.max(0, Math.ceil((FINISH_WINDOW - (world.tick - f)) / TICK_HZ)) : null;
}

// Metres between a river and the heat front behind it (Infinity before it starts).
function heatGap(r) {
  const f = heatFront(world), t = world.terrain;
  return f === -Infinity ? Infinity : (slopeT(world, r.x, r.z) - f) * 2 * t.long * (t.worldSize / 2);
}

// Weather: the heat front as a glowing wall of shimmering air across the
// island, and a storm as a dark cloud with a curtain of rain under it.
let heatWall = null;
function updateWeather(time) {
  const t = world.terrain;
  if (!heatWall) {
    const mat = new THREE.MeshBasicMaterial({ color: '#ff6a2a', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, fog: false });
    heatWall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    heatWall.renderOrder = 3;
    scene.add(heatWall);
  }
  const front = heatFront(world);
  heatWall.visible = front > -Infinity && front < 1.05 && !mapView;
  if (heatWall.visible) {
    const half = t.worldSize / 2, u = (front * 2 * t.long - t.long) * half;
    heatWall.position.set(t.axis.x * u, 2600 * VERT * 0.5, t.axis.y * u);
    heatWall.scale.set(t.worldSize * 0.6, 2600 * VERT, 1);
    heatWall.rotation.set(0, Math.atan2(t.axis.x, t.axis.y), 0);
    heatWall.material.opacity = 0.18 + 0.06 * Math.sin(time * 3);
  }
}
// A flash round the screen edge: gold when you win a hit, red when you lose one.
const edgeEl = document.getElementById('edge');
function flashEdge(color) {
  if (!edgeEl) return;
  edgeEl.style.boxShadow = `inset 0 0 80px 24px ${color}`;
  edgeEl.classList.remove('on'); void edgeEl.offsetWidth; edgeEl.classList.add('on');
}

// The altimeter: while falling, a bar down the left edge with your height and
// the clouds ahead at theirs, so you can see at a glance whether to dive or float.
const altEl = document.getElementById('alti');
function showAltimeter() {
  if (!altEl) return;
  const me = river, on = !!me?.dropping && !mapView;
  altEl.hidden = !on;
  if (!on) return;
  const base = skyBase(world), gnd = surfaceAt(world, me.x, me.z) - base, top = TUNE.dropAlt * 1.05, bot = Math.min(0, gnd);
  const y = (h) => `${(100 * (1 - (h - bot) / (top - bot))).toFixed(1)}%`;
  const ax = me.dx, az = me.dz;
  const marks = skyClouds(world).filter((c) => !c.low && c.water > 0 && (c.x - me.x) * ax + (c.z - me.z) * az > -200 && Math.hypot(c.x - me.x, c.z - me.z) < 3500)
    .map((c) => { const level = Math.abs(c.alt - me.alt) <= TUNE.cloudDepth; return `<i class="cl${level ? ' lv' : ''}" style="top:${y(c.alt)}" title="cloud"></i>`; }).join('');
  const html = `<b style="top:${y(gnd)}" class="gnd"></b>${marks}<em style="top:${y(me.alt)}">${Math.round(me.alt - gnd)} m${me.draft ? '<br>slipstream' : ''}</em>`;
  if (altEl.innerHTML !== html) altEl.innerHTML = html;
}

// The descent lane's walls: two glowing curtains in the sky narrowing to the
// start line, shown while you fall, so being stopped at an edge reads as a wall.
let laneMesh = null, laneWorld = null;
function updateLane() {
  if (laneWorld !== world) {
    if (laneMesh) { scene.remove(laneMesh); laneMesh.geometry.dispose(); laneMesh.material.dispose(); }
    laneWorld = world;
    const lane = descentLane(world), ax = terrain.axis.x, az = terrain.axis.y, segs = 24, pos = [], idx = [];
    const lo = skyY() - 600, hi = skyY() + TUNE.dropAlt + 1500;
    for (const side of [-1, 1]) for (let i = 0; i <= segs; i++) {
      const d = (lane.run * 1.15 * i) / segs, u = lane.uLine - d, lat = lane.c + side * laneHalf(lane, d);
      const x = ax * u - az * lat, z = az * u + ax * lat, base = pos.length / 3;
      pos.push(x, lo, z, x, hi, z);
      if (i) idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    laneMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#7fd8ff', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    scene.add(laneMesh);
  }
  laneMesh.visible = !!river?.dropping && !mapView;
}

// Rain clouds in the sky during the drop: puffs of white, gone once taken.
let skyMeshes = null, skyWorld = null, cloudShadows = [];
let cloudGot = 0, cloudSaidAt = 0;
function updateSkyClouds() {
  if (skyWorld !== world) {
    if (skyMeshes) for (const m of skyMeshes) { scene.remove(m); m.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); }
    for (const s of cloudShadows) if (s) { scene.remove(s); s.material.dispose(); }
    skyWorld = world; cloudGot = 0;
    // A drop cloud's shadow on the ground: line your own shadow up with it.
    cloudShadows = skyClouds(world).map((c) => {
      if (c.low) return null;
      const s = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ color: '#0a2030', transparent: true, opacity: 0.28, depthWrite: false }));
      scene.add(s);
      return s;
    });
    const mat = new THREE.MeshLambertMaterial({ color: '#f4f8ff', transparent: true, opacity: 0.92 });
    skyMeshes = skyClouds(world).map((c, i) => {
      const g = new THREE.Group();
      for (let j = 0; j < 5; j++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mat);
        const a = (j / 5) * Math.PI * 2 + i;
        puff.position.set(Math.cos(a) * 0.45, (j % 2) * 0.25, Math.sin(a) * 0.45);
        puff.scale.setScalar(0.55 + 0.1 * (j % 3));
        g.add(puff);
      }
      g.scale.set(TUNE.cloudRadius, c.low ? 220 : TUNE.cloudDepth, TUNE.cloudRadius);
      if (c.low) {
        // A grey-bellied rain cloud with a shaft of rain to the ground: water here.
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, c.alt / 220, 20, 1, true),
          new THREE.MeshBasicMaterial({ color: '#8fc4ea', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
        shaft.position.y = -c.alt / 440;
        g.add(shaft);
      }
      g.position.set(c.x, (c.low ? surfaceAt(world, c.x, c.z) * VERT : skyY()) + c.alt, c.z);
      scene.add(g);
      return g;
    });
  }
  const falling = world.rivers.some((r) => r.dropping);
  // (Lite mode, for tests and weak machines, skips the low clouds' big translucent shafts.)
  skyClouds(world).forEach((c, i) => {
    const m = skyMeshes[i];
    if (c.low) { m.visible = c.taken < 0 && !lite; return; }
    // Drop clouds shrink and rise as rivers inside drain them.
    m.visible = c.water > 0 && c.taken < 0 && falling && !mapView;
    const rad = c.radius ?? TUNE.cloudRadius;
    m.scale.set(rad, TUNE.cloudDepth * Math.max(0.4, rad / TUNE.cloudRadius), rad);
    m.position.y = skyY() + c.alt;
    const sh = cloudShadows[i];
    if (sh) { sh.visible = m.visible; sh.position.set(c.x, surfaceAt(world, c.x, c.z) * VERT + 10, c.z); sh.scale.set(rad, 1, rad); }
  });
}

// The map: straight down on the island from above the middle of the run, the
// summits at the top of the screen and the finish beach at the bottom, the
// whole slope in view (it was a far orbit: the island filled a tenth of it).
const mapFog = scene.fog;
function frameMap() {
  const top = spawnBand(world).top, n = terrain.size;
  const sx = ((top % n) / (n - 1) - 0.5) * W, sz = (Math.floor(top / n) / (n - 1) - 0.5) * W;
  const bx = world.beachAt.x, bz = world.beachAt.z, cx = (sx + bx) / 2, cz = (sz + bz) / 2;
  const half = Math.hypot(bx - sx, bz - sz) / 2 * 1.35, ax = (bx - sx) / (2 * half / 1.35 || 1), az = (bz - sz) / (2 * half / 1.35 || 1);
  const fov = (camera.fov * Math.PI) / 180, aspect = camera.aspect || 1;
  const fit = Math.max(half, (half * 0.6) / Math.min(1, aspect)); // the run is long; leave the width room on tall screens
  const h = fit / Math.tan(fov / 2);
  const y = surfaceAt(world, cx, cz) * VERT;
  controls.target.set(cx, y, cz);
  // A slight lean from the beach side keeps 'up' on screen pointing to the summits.
  camera.position.set(cx + ax * h * 0.08, y + h, cz + az * h * 0.08);
  camera.lookAt(controls.target);
  controls.update();
}
// On the map, the finish is a big gold disc you can't miss.
const finishDisc = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));
finishDisc.renderOrder = 6;
finishDisc.visible = false;
scene.add(finishDisc);

// The finish: red and white posts along the one beach that ends the race
// (two instanced meshes: one draw call per colour, however long the beach).
let finishFlags = null;
function placeFinishFlags() {
  if (finishFlags) { scene.remove(finishFlags); finishFlags.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); }
  finishFlags = new THREE.Group();
  const t = world.terrain, n = t.size, spots = [];
  for (const k of world.beachLand) {
    const x = ((k % n) / (n - 1) - 0.5) * t.worldSize, z = (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize;
    if (spots.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 600 ** 2)) continue;
    spots.push({ x, z });
  }
  const geo = new THREE.CylinderGeometry(22, 22, 160, 8), m4 = new THREE.Matrix4();
  for (const [colour, parity] of [['#ffffff', 0], ['#e63946', 1]]) {
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: colour }), spots.length * 2);
    let i = 0;
    for (const p of spots) {
      const g = surfaceAt(world, p.x, p.z) * VERT;
      for (let j = parity; j < 4; j += 2) inst.setMatrixAt(i++, m4.makeTranslation(p.x, g + 80 + j * 160, p.z));
    }
    inst.count = i;
    finishFlags.add(inst);
  }
  scene.add(finishFlags);
  finishDisc.scale.setScalar(TUNE.beachRadius * 1.1);
  finishDisc.position.set(world.beachAt.x, 60, world.beachAt.z);
}

// Storm clouds follow their storms across the island (height easing over the hills).
const stormClouds = new Map();
function followStorm() {
  for (const s of world.storms) {
    let c = stormClouds.get(s.id);
    if (!c) {
      c = new THREE.Group();
      const cloud = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.1, 0.18, 32), new THREE.MeshLambertMaterial({ color: '#3d4652', transparent: true, opacity: 0.85 }));
      const rain = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 1, 32, 1, true), new THREE.MeshBasicMaterial({ color: '#9fc6e8', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      rain.position.y = -0.5;
      c.add(cloud, rain);
      c.scale.set(s.radius, 2600, s.radius);
      c.position.set(s.x, surfaceAt(world, s.x, s.z) * VERT + 2600, s.z);
      scene.add(c);
      stormClouds.set(s.id, c);
    }
    c.scale.x = c.scale.z = s.radius; // shrinks as it rains out
    const ground = surfaceAt(world, s.x, s.z) * VERT, y = c.position.y;
    c.position.set(s.x, y + (ground + 2600 - y) * 0.03, s.z);
  }
  for (const [id, c] of stormClouds) {
    if (world.storms.some((s) => s.id === id)) continue;
    scene.remove(c);
    c.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    stormClouds.delete(id);
  }
}

// Lake overflow: one water strip per spill channel, shown while it runs.
const spillRibbons = new Map();
function updateSpills(time) {
  const t = world.terrain, n = t.size;
  for (const [lake, sp] of world.spills) {
    let sr = spillRibbons.get(lake);
    if (!sr) {
      const path = sp.path.map((k) => {
        const x = ((k % n) / (n - 1) - 0.5) * t.worldSize, z = (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize;
        return { x, z, w: TUNE.spillWidth, water: surfaceAt(world, x, z) + 0.6, tick: 0 };
      });
      if (path.length < 2) continue;
      sr = { ribbon: new Ribbon('#7fd3e0'), river: { path, out: null, idx: -1 } };
      scene.add(sr.ribbon.mesh);
      spillRibbons.set(lake, sr);
    }
    sr.ribbon.mesh.visible = sp.on;
    if (sp.on) { const last = sr.river.path[sr.river.path.length - 1]; sr.ribbon.update(world, sr.river, last.x, last.z, time); }
  }
}

// Online: frames from the server, consumed in order; ids give each char's river.
let net, ids = [], frames = [], nextFrame = 0, endTable = null;

// rolled: a world already built for this seed (solo rolls it), else built here.
function beginRace(seed, raceIds, me, rolled) {
  recordBanked = false; recordNotes = [];
  for (const e of entries) {
    scene.remove(e.ribbon.mesh, e.head, e.streak, e.surge, e.spray, e.line, e.shadow, e.stem);
    e.shadow.material.dispose(); e.stem.material.dispose();
    if (e.pond) { scene.remove(e.pond); e.pond.geometry.dispose(); e.pond.material.dispose(); }
    e.line.geometry.dispose(); e.line.material.dispose();
    e.ribbon.geo.dispose(); e.head.material.dispose(); e.streak.material.dispose();
    e.surge.material.dispose(); e.spray.geometry.dispose(); e.spray.material.dispose();
  }
  for (const sr of spillRibbons.values()) { scene.remove(sr.ribbon.mesh); sr.ribbon.geo.dispose(); }

  spillRibbons.clear();
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
  startCoach();
  if (coach) hud.hint.hidden = true; // the coach teaches the same things, one at a time
  document.getElementById('hud').hidden = false;
  resetCarve(terrainMesh);
  markBeach(terrainMesh, world.beachLand);
  placeFinishFlags();
  updateLakes(); // dry basins show as dry from the first frame
  for (const g of guides) if (!g.parent) scene.add(g);
  buildZoneDots();
  for (const m of [trees, rocks, lava]) if (m) {
    scene.remove(m);
    m.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); o.dispose?.(); });
  }
  trees = buildTrees(world, lite ? 0 : lowPower ? 6000 : 12000);
  rocks = buildRocks(world, lite ? 0 : lowPower ? 1200 : 3500);
  scene.add(rocks);
  lava = buildLava(world);
  scene.add(trees, lava);
  if (river?.dropping) highlightZone(terrainMesh, startLine(world).set, true);
  hud.banner.hidden = true;
  hud.feed.textContent = '';
  fb?.raceStart({ seed, kind: tutorial ? 'tutorial' : 'race', of: world.rivers.length });
  audio.track('race');
  finishShown = false;
  finishEl.classList.remove('on');
  // Opening shot: from low on the island, the rivers raining onto the summit.
  introUntil = river?.dropping && !params.has('nointro') ? performance.now() + (TUNE.dropCalm / TICK_HZ) * 1000 : 0;
  const y = surfaceAt(world, focus.x, focus.z) * VERT;
  camDir.set(focus.dx, focus.dz).normalize();
  camYaw = 0;
  camera.position.set(focus.x - focus.dx * 1500, y + 1400, focus.z - focus.dz * 1500);
  camTarget.set(focus.x, y, focus.z);
}

function newRun() {
  if (tutorial) return newTutorial();
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
  input.onChange = (st) => { if (river && isRacing(river)) { const p = dropPitch(); net?.steer(st, performance.now(), true, p.f, p.g); } };
  input.onSkill = () => { if (river && isRacing(river) && !river.dropping) net?.skill(input.sample()); };
  input.onSurge = () => { if (river && isRacing(river) && !river.dropping) net?.surge(input.sample()); };
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
// The opening shot runs until this time (ms). It can't be skipped (owner, 2026-11-11): the sim
// takes no steering until it ends (TUNE.dropCalm), so a skip only showed a drop you couldn't fly.
let introUntil = 0;
let lastCamMode = ''; // the camera's current view; a change is a cut
let camRise = 0; // 0..1: how far the right stick has raised the view
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
    if (tmpV.z > 1 || Math.abs(tmpV.x) > 1 || Math.abs(tmpV.y) > 1) { el.hidden = true; return; } // off screen: no tag
    el.hidden = false;
    const t = river ? threatOf(o.e.r) : 0;
    el.className = o.e.r.dropping ? 'drop' : t > 0 ? 'threat' : t < 0 ? 'prey' : '';
    el.textContent = o.e.r.dropping ? nameOf(o.e.r) : `${nameOf(o.e.r)} ${t > 0 ? '▲' : t < 0 ? '▼' : river ? '=' : ''}`;
    placeTag(el, tmpV.x, tmpV.y);
  });
}

// Rain-cloud markers: every untaken slope cloud within 5 km, with its water and
// distance, pinned to the screen edge when it's off screen (Brain: seen at 2 km
// a cloud gave about 6 s to steer for; at 5 km it becomes a detour you can weigh).
const cloudTagPool = [];
function placeCloudTags() {
  const me = river;
  const near = mapView || !me ? [] : skyClouds(world)
    .filter((c) => (me.dropping ? !c.low && c.water > 0 && c.alt < me.alt + TUNE.cloudDepth : c.low && c.taken < 0))
    .map((c) => ({ c, d: Math.hypot(c.x - me.x, c.z - me.z) }))
    .filter((o) => o.d < 5000)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  while (cloudTagPool.length < near.length) {
    const el = document.createElement('div');
    tagBox.append(el);
    cloudTagPool.push(el);
  }
  cloudTagPool.forEach((el, i) => {
    const o = near[i];
    if (!o) { el.hidden = true; return; }
    tmpV.set(o.c.x, (o.c.low ? surfaceAt(world, o.c.x, o.c.z) * VERT : skyY()) + o.c.alt, o.c.z).project(camera);
    // Behind the camera, or off screen: pin it to the nearest edge, pointing out.
    let x = tmpV.x, y = tmpV.y, edge = '';
    if (tmpV.z > 1) { x = -x; y = -y; }
    if (tmpV.z > 1 || Math.abs(x) > 0.92 || Math.abs(y) > 0.85) {
      const k = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.85);
      x /= k; y /= k;
      edge = Math.abs(x) >= 0.91 ? (x > 0 ? ' ▶' : ' ◀') : y > 0 ? ' ▲' : ' ▼';
    }
    el.hidden = false;
    // Falling, say how far below you it is: from above, height can't be seen.
    const dh = me.dropping ? me.alt - o.c.alt : 0, level = me.dropping && Math.abs(dh) <= TUNE.cloudDepth;
    el.className = level ? 'cloud level' : 'cloud';
    el.textContent = me.dropping
      ? `☁ +${Math.round(o.c.water / 1000)}k L · ${level ? 'your height: fly in!' : `${Math.abs(Math.round(dh / 100) * 100)} m ${dh > 0 ? 'below' : 'above'}`}${edge}`
      : `☁ +${Math.round(o.c.water / 1000)}k L · ${(o.d / 1000).toFixed(1)} km${edge}`;
    placeTag(el, x, y);
  });
}

// Put a tag above a screen point (x, y in -1..1), whole on screen: a tag is
// centred on its point, so near an edge half of it used to fall off.
// Tags placed this frame step up past any they would cover, so they never stack into a blur.
let tagFrame = -1;
const tagRects = [];
function placeTag(el, x, y) {
  if (tagFrame !== dbg.frames) { tagFrame = dbg.frames; tagRects.length = 0; }
  const w = el.offsetWidth, h = el.offsetHeight, m = 8;
  const ml = document.body.classList.contains('falling') ? 56 : m; // falling: clear of the altimeter on the left
  const px = Math.min(innerWidth - m - w / 2, Math.max(ml + w / 2, ((x + 1) / 2) * innerWidth));
  let py = Math.min(innerHeight - m, Math.max(m + h, ((1 - y) / 2) * innerHeight));
  for (let i = 0; i < 8; i++) {
    const hit = tagRects.find((r) => Math.abs(r.x - px) < (r.w + w) / 2 + 2 && Math.abs(r.y - py) < (r.h + h) / 2 + 1);
    if (!hit) break;
    py = hit.y - (hit.h + h) / 2 - 2;
  }
  if (py < m + h) { el.hidden = true; return; } // no room left above: skip it this frame
  tagRects.push({ x: px, y: py, w, h });
  el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%)`;
}

// The preview's channel markers (see showFlow): ▲ red, their channel is deeper (it drains you);
// ▼ green, shallower (you drain it); = grey, too close to call. Symbols as well as colour.
let crossMarks = [];
const crossTagPool = [];
function placeCrossTags(on) {
  const marks = on ? crossMarks.slice(0, 4) : [];
  while (crossTagPool.length < marks.length) { const el = document.createElement('div'); tagBox.append(el); crossTagPool.push(el); }
  crossTagPool.forEach((el, i) => {
    const m = marks[i];
    if (!m) { el.hidden = true; return; }
    tmpV.set(m.x, surfaceAt(world, m.x, m.z) * VERT + 40, m.z).project(camera);
    if (tmpV.z > 1 || Math.abs(tmpV.x) > 1 || Math.abs(tmpV.y) > 1) { el.hidden = true; return; }
    const lead = (m.theirs - m.mine) / Math.max(m.mine, 0.5), rival = world.rivers[m.o];
    const t = lead > TUNE.siphonDeadband ? 1 : lead < -TUNE.siphonDeadband ? -1 : 0;
    el.hidden = false;
    el.className = t > 0 ? 'threat' : t < 0 ? 'prey' : '';
    el.textContent = `${t > 0 ? '▲ deeper' : t < 0 ? '▼ shallower' : '= even'}${m.n >= 12 ? ' · ride' : ''} · ${nameOf(rival)}`;
    placeTag(el, tmpV.x, tmpV.y);
  });
}

// Lake markers: the lakes ahead, seen through the trees, with how full each
// is and whether it already feeds you. (Bots read the same lakes.)
const lakeTagPool = [];
function placeLakeTags() {
  const t = world.terrain, n = t.size, me = river;
  const near = mapView || !me || me.dropping ? [] : world.lakes
    .map((l) => ({ l, x: (l.gx / (n - 1) - 0.5) * t.worldSize, z: (l.gy / (n - 1) - 0.5) * t.worldSize }))
    .map((o) => ({ ...o, d: Math.hypot(o.x - me.x, o.z - me.z) }))
    .filter((o) => o.d < 4500 && o.d > 200 && (o.x - me.x) * me.dx + (o.z - me.z) * me.dz > 0)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
  while (lakeTagPool.length < near.length) {
    const el = document.createElement('div');
    tagBox.append(el);
    lakeTagPool.push(el);
  }
  lakeTagPool.forEach((el, i) => {
    const o = near[i];
    if (!o) { el.hidden = true; return; }
    tmpV.set(o.x, surfaceAt(world, o.x, o.z) * VERT + 60, o.z).project(camera);
    if (tmpV.z > 1) { el.hidden = true; return; }
    const full = world.lakeVol[o.l.id] / world.lakeCap[o.l.id], mine = me.via.has(o.l.id);
    // What it's worth to you: the water standing above an outlet you'd cut
    // now (your depth below its surface), which drains out to you.
    const worth = Math.max(0, world.lakeVol[o.l.id] - lakeVolAt(world, o.l.id, lakeLevel(world, o.l.id) - me.depth));
    el.hidden = false;
    el.className = `lake${full < 0.5 ? ' dry' : ''}${mine ? ' mine' : ''}`;
    el.textContent = mine ? `your lake · feeding you · ${Math.round(full * 100)}%` : `lake ≈ +${fmtL(worth)} · ${(o.d / 1000).toFixed(1)} km`;
    placeTag(el, tmpV.x, tmpV.y);
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

// ---- The Tutorial's training course ----
// Its own fixed map (terrain.js TUTORIAL), three bots, and stations down the
// middle: reach each one's trigger and the race stops, the camera flies to it
// and a card explains what to do there; gold beacons lead the way.
const TUT_SIZE = { size: 400, worldSize: 40000 };
let tcourse = { next: 0, beacons: null };
const coursePoint = (t, v = 0) => {
  const T = world.terrain, half = T.worldSize / 2, u = (t * 2 * T.long - T.long) * half;
  return { x: T.axis.x * u - T.axis.y * v, z: T.axis.y * u + T.axis.x * v };
};
const STATIONS = [
  { key: 'lake', at: COURSE.lake, trig: COURSE.lake - 0.07, title: 'Station 1 · The lake',
    html: () => 'Straight ahead is a <b>lake</b>. Flow into it: your water pours in and raises it until it spills over the far bank. Cut the outlet and <b>everything that drains through it feeds you</b>. Lakes are the biggest source of water.' },
  { key: 'unlock:surge', at: COURSE.surge, trig: COURSE.surge - 0.04, unlock: 'surge', title: 'Station 2 · Surge',
    html: () => `On the flat, water slows down. <b>SURGE</b> (${key('RB', 'Q', 'the SURGE button')}) adds a 2 s burst of speed on top of what you have. It costs a little water. Out on the real course it unlocks once you hold ${(TUNE.surgeUnlock / 1e6).toFixed(1)}M L, or as soon as you fall far behind the leader; here it's yours now. <b>Use it now.</b>` },
  { key: 'unlock:gouge', at: COURSE.ridge, trig: COURSE.ridge - 0.05, unlock: 'gouge', title: 'Station 3 · Gouge',
    html: () => `A <b>rock ridge</b> blocks the run. Its only gap is far off by the left wall. <b>GOUGE</b> (${key('A', 'Space', 'the GOUGE button')}) lets you climb over rises for 3 s. Press it <b>as you reach the ridge</b>. Using either skill puts <b>both</b> on cooldown, so time it. (Real course: it unlocks at ${(TUNE.gougeUnlock / 1e6).toFixed(1)}M L.)` },
  { key: 'storm', at: COURSE.storm, trig: COURSE.storm - 0.06, storm: true, title: 'Station 4 · A storm',
    html: () => 'Storms build from water that evaporates off the rivers. Under one, rain pours into <b>your head and your channel</b>. It shrinks as it rains out and drifts as it goes. <b>Steer under it.</b>' },
  { key: 'finish-run', at: 0.97, trig: 0.88, title: 'Last stretch',
    html: () => 'The <b>gold beach</b> is the finish: the only one. Get there first. Other rivers can cut your channel and steal your water, and you can steal theirs, so keep your channel deeper.' },
];
function newTutorial() {
  mode = 'solo';
  const all = [PLAYER, 'bot01', 'bot02', 'bot03'].sort();
  names = Object.fromEntries(all.filter((id) => id !== PLAYER).map((id, i) => [id, BOT_NAMES[i % BOT_NAMES.length]]));
  const t = terrain?.seed === COURSE.seed ? terrain : generateIsland(COURSE.seed, { course: 'tutorial', ...TUT_SIZE });
  const tw = createWorld(t, { lava: false }); // no lava on the training course
  tw.dropScale = 0.5; // and a 40 s descent: the drop lessons take about 20 s (Brain flood#E126: no dead air)
  beginRace(COURSE.seed, all, PLAYER, tw);
  bots = world.rivers.filter((r) => r !== river).map((r) => createBot(world, r));
  tcourse = { next: 0, beacons: new THREE.Group() };
  for (const s of STATIONS) {
    const p = coursePoint(s.at), g = surfaceAt(world, p.x, p.z) * VERT;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 2400, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffcf3a', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    b.position.set(p.x, g + 1200, p.z);
    tcourse.beacons.add(b);
  }
  scene.add(tcourse.beacons);
}
function clearCourse() {
  if (!tcourse.beacons) return;
  scene.remove(tcourse.beacons);
  tcourse.beacons.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  tcourse.beacons = null;
}
// Each frame: reach a station's trigger and its lesson plays.
function watchCourse() {
  if (!tcourse.beacons) return;
  if (!tutorial || world.terrain.course !== 'tutorial') { clearCourse(); return; }
  if (!river || river.dropping) return;
  if (river.finished || river.out) { tutorial = false; return; } // "Race again" after it is a normal race
  const t = slopeT(world, river.x, river.z);
  // A beacon stands until you pass its station; the next one pulses.
  const nextUp = STATIONS.findIndex((s) => s.at > t - 0.01);
  tcourse.beacons.children.forEach((b, i) => {
    b.visible = STATIONS[i].at > t - 0.01;
    b.material.opacity = i === nextUp ? 0.4 + 0.2 * Math.sin(performance.now() / 300) : 0.18;
  });
  const s = STATIONS[tcourse.next];
  if (!s || t < s.trig) return;
  tcourse.next++;
  if (coach) coach.stage = tcourse.next;
  if (s.unlock) { river[`${s.unlock}On`] = true; river.gougeAt = river.surgeAt = world.tick; }
  const p = coursePoint(s.at);
  if (s.storm) {
    // A storm over the station, drifting slowly across it (tutorial-made: not from the sky store).
    const water = TUNE.stormMaxWater, life = 20 * 70;
    world.storms.push({ id: world.tick * 4 + 3, x: p.x - 1500, z: p.z, vx: 30, vz: 10, until: world.tick + life, radius: TUNE.stormRadius, water, water0: water, drizzle: water / life });
  }
  taught.delete(s.key);
  teach(s.key, s.title, s.html(), p.x, p.z, s.storm ? 3.2 : 1); // a storm is seen from above its cloud
}

// Gamepad actions that work outside a race too: menu focus and confirm,
// "Race again" on the results card, mute.
function menuActions() {
  const keep = [];
  for (const a of input.takeActions()) {
    const menuOpen = !hud.menu.hidden;
    const again = document.getElementById('again');
    if (!splash.hidden) { if (a === 'confirm') leaveSplash(); continue; }
    if (lesson && a === 'confirm') { endLesson(); continue; }
    if (a === 'mute') { audio.toggle(); showMute(); }
    else if (!pauseEl.hidden && (a === 'up' || a === 'down' || a === 'confirm')) {
      // Pause menu on a pad: up / down move between its controls, A presses (ticks a box, presses a button).
      const ctl = [...pauseEl.querySelectorAll('button:not([hidden]), input')];
      const i = ctl.indexOf(document.activeElement);
      if (a === 'confirm') { if (i >= 0) ctl[i].click(); else ctl[0]?.focus(); }
      else ctl[i < 0 ? 0 : (i + (a === 'down' ? 1 : ctl.length - 1)) % ctl.length]?.focus();
    }
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

// Phones: steer with ◀ ▶ under the left thumb; while falling, ▲ DIVE / ▼ FLOAT under the right.
const touchUI = lowPower;
document.body.classList.toggle('touch', touchUI);
const tpad = document.getElementById('tpad'), tfly = document.getElementById('tfly');
input.bind(document.getElementById('t-left'), 'left');
input.bind(document.getElementById('t-right'), 'right');
input.bind(document.getElementById('t-dive'), 'fwd');
input.bind(document.getElementById('t-float'), 'back');
const calmNow = () => performance.now() < introUntil; // the opening shot: nobody steers yet

// Landscape only on phones (owner, 2026-11-11). Browsers can lock it only in fullscreen
// (Android); everywhere else a "turn your phone" card covers the game and a solo race waits.
const portrait = matchMedia('(orientation: portrait)');
const mustRotate = () => touchUI && portrait.matches;
function goLandscape() {
  if (!touchUI) return;
  const el = document.documentElement;
  const full = document.fullscreenElement ? Promise.resolve() : (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? Promise.reject());
  full.then(() => screen.orientation?.lock?.('landscape')).catch(() => { /* iPhone: no fullscreen; the card asks instead */ });
}
const showRotate = () => document.body.classList.toggle('rotate', mustRotate());
portrait.addEventListener?.('change', showRotate);
showRotate();

// Pause: Esc / P / Start. Resume, restart (solo), volumes, preview and shake.
const pauseEl = document.getElementById('pause');
function setPaused(on) {
  paused = on && !!world;
  pauseEl.hidden = !paused;
  if (paused) {
    const v = audio.volumes;
    document.getElementById('vol-music').value = v.music;
    document.getElementById('vol-sfx').value = v.sfx;
    document.getElementById('opt-preview').checked = settings.preview;
    document.getElementById('opt-shake').checked = settings.shake;
    document.getElementById('restart').hidden = mode !== 'solo';
    document.getElementById('resume').focus();
  }
}
document.getElementById('resume').onclick = () => setPaused(false);
document.getElementById('restart').onclick = () => { setPaused(false); newRun(); };
document.getElementById('to-menu').onclick = () => location.reload();
if (fb) {
  const b = document.createElement('button');
  b.id = 'fb-pause'; b.textContent = 'Send feedback';
  b.onclick = () => { setPaused(false); fb.open(); };
  document.getElementById('to-menu').before(b);
}
document.getElementById('vol-music').oninput = (e) => audio.setVolumes({ music: Number(e.target.value) });
document.getElementById('vol-sfx').oninput = (e) => audio.setVolumes({ sfx: Number(e.target.value) });
document.getElementById('opt-preview').onchange = (e) => { settings.preview = e.target.checked; saveSettings(); };
document.getElementById('opt-shake').onchange = (e) => { settings.shake = e.target.checked; saveSettings(); };

function handleActions() {
  for (const a of pendingActions.splice(0)) {
    if (a === 'pause') { setPaused(!paused); continue; }
    // (The map, Y / M, is off for now: the right stick's raised view does its job. frameMap stays for later.)
    if (a === 'map') continue;
    if ((a === 'restart' || a === 'tap') && mode === 'solo' && river && !isRacing(river)) {
      newRun();
      return true;
    }
  }
  return false;
}

// Falling, up and down mean the same on every input (owner, 2026-11-11): keys ↑ ↓, either
// stick or the D-pad up / down, a drag up / down. Up dives: full throttle, falling faster.
// Down floats: no throttle, falling slower. Neither: cruise at full glide like the bots
// (players cruised at half and were passed and out-landed by every bot, owner 2026-11-09).
function dropPitch(aim = null) {
  if (!river?.dropping) return { f: 0, g: 0 };
  const p = Math.sign(aim ? aim.f : dbg.forceFwd ?? (input.forward() + input.glide()));
  return { f: p, g: p === 0 ? 1 : p };
}

// This tick's input: steer, plus dive / float while falling.
let touchTurn = 0;
function sampleSteer() {
  let steer = dbg.forceSteer ?? input.sample();
  // Falling, the drag stick flies the drop (see dragAim).
  const aim = river?.dropping && dbg.forceSteer === undefined ? dragAim() : null;
  if (aim) steer = aim.s;
  // Phones turn 20% slower (owner, 2026-11-11): every fifth tick of a held touch turn goes
  // straight. Steering stays an integer per tick, the sim's rule, so replays and online agree.
  if (steer && !aim && dbg.forceSteer === undefined && input.touchSteer()) { if (++touchTurn % 5 === 0) steer = 0; }
  else touchTurn = 0;
  const { f, g } = dropPitch(aim);
  if (coach) { if (f) coach.fell = true; if (g > 0) coach.glided = true; }
  dbg.steers.push(steer);
  watchCoach(steer);
  if (dbg.steers.length > 200) dbg.steers.shift();
  const k = dbg.forceSkill ? 1 : input.takeSkill(), u = k ? 0 : input.takeSurge();
  return f || g || k || u ? { s: steer, f, g, k, u } : steer;
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

// The drag stick on a phone: left / right turns, up dives, down floats (see dropPitch),
// the same as the keys and the pad; let go and it cruises.
const STICK_MIN = 18, STICK_FAR = 70; // pixels
function dragAim() {
  const d = input.drag();
  if (!d) return null;
  if (Math.hypot(d.dx, d.dy) < STICK_MIN) return { s: 0, f: 0, g: 0 }; // finger down, barely moved: cruise
  const nx = Math.max(-1, Math.min(1, d.dx / STICK_FAR)), ny = Math.max(-1, Math.min(1, -d.dy / STICK_FAR)); // ny: up is +
  const s = Math.abs(nx) > 0.35 ? Math.sign(nx) : 0; // right turns right (+1), as the keys and the pad do
  const pitch = ny > 0.4 ? 1 : ny < -0.4 ? -1 : 0;
  return { s, f: pitch };
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

// Same rule as the server: everyone stops once nobody is racing, or 3 min
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
// Only the net counts: with each rival, water won minus water lost, so you never
// see "gaining" and "draining" from the same contact at once.
let tugNet = 0;
function tugFeedback(now) {
  if (now - tug.shownAt >= 500) {
    tug.shownAt = now;
    const net = new Map();
    for (const [k, v] of tug.gain) net.set(k, (net.get(k) ?? 0) + v);
    for (const [k, v] of tug.loss) net.set(k, (net.get(k) ?? 0) - v);
    tugNet = 0;
    let best = null, worst = null;
    for (const [k, v] of net) {
      tugNet += v;
      if (!best || v > best[1]) best = [k, v];
      if (!worst || v < worst[1]) worst = [k, v];
    }
    if (tugNet < 0 && worst) hud.drainText.textContent = `${nameOf(world.rivers[worst[0]])} is cutting deeper — it's draining you`;
    if (steamed > 0) { showPop(`Lava! Boiling off ${fmtL(steamed)}`); steamed = 0; }
    else if (tugNet > 0 && best) showPop(`+${fmtL(tugNet)} from ${nameOf(world.rivers[best[0]])}`);
    tug.gain.clear();
    tug.loss.clear();
  }
  const draining = river && isRacing(river) && world.tick - tug.lastTick < 12 && tugNet < 0;
  hud.drain.classList.toggle('on', !!draining);
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
  clearTrees(trees, world.felled.splice(0));
  clearTrees(rocks, dirty, world.carve);
  const cooled = world.cooled.splice(0);
  if (cooled.length) { coolLava(lava, cooled); clearTrees(trees, cooled, world.rock); }
  if (world.tick % 10 === 0) updateLakes();
  for (const e of world.events.splice(0)) {
    if (e.type === 'land') {
      const en = entries[e.river], lr = world.rivers[e.river];
      if (en) burstSpray(en.spray, lr.x, surfaceAt(world, lr.x, lr.z) * VERT, lr.z, 1.2, 70);
      if (river && e.river === river.idx) {
        highlightZone(terrainMesh, startLine(world).set, false); audio.splash(1.2);
        teach('beach', 'The finish', 'You landed, and now you are a <b>river</b>. Race downhill to <b>this gold beach</b>: it is the only finish. Other beaches just carry you here on the current.', world.beachAt.x, world.beachAt.z);
        teach('ribbon', 'Your route', 'The <b>white ribbon</b> ahead of you shows where your water will run if you hold this heading. Steer to change it.', lr.x, lr.z);
      }
    } else if (e.type === 'offcourse') {
      if (river && e.river === river.idx) showPop('Wrong beach — the current carries you to the finish');
    } else if (e.type === 'surge-wind') {
      if (river && e.river === river.idx && coach) coach.surged = true;
      if (river && e.river === river.idx) showPop(`Surge! −${fmtL(e.cost)}`);
    } else if (e.type === 'surge') {
      const en = entries[e.river], gr = world.rivers[e.river];
      if (en) { en.slamAt = performance.now(); burstSpray(en.spray, gr.x, surfaceAt(world, gr.x, gr.z) * VERT, gr.z, 1.2 * gr.size, 40); }
      if (river && e.river === river.idx) { audio.splash(1.4); gougeShakeAt = performance.now() - 250; }
    } else if (e.type === 'gouge-wind') {
      if (river && e.river === river.idx && coach) coach.gouged = true;
      const en = entries[e.river];
      if (en) en.gougeAt = performance.now();
      if (river && e.river === river.idx) showPop(`Gouge! −${fmtL(e.cost)}`);
    } else if (e.type === 'gouge') {
      // The slam: spray thrown up all round, the camera jolts, the boost is on.
      const en = entries[e.river], gr = world.rivers[e.river];
      if (en) { en.slamAt = performance.now(); burstSpray(en.spray, gr.x, surfaceAt(world, gr.x, gr.z) * VERT, gr.z, 1.8 * gr.size, 60); }
      if (river && e.river === river.idx) { audio.gouge(gr.size); gougeShakeAt = performance.now(); showPop('Boosted — climb anything for 3 s'); }
      else if (river && en && Math.hypot(gr.x - river.x, gr.z - river.z) < 3000) audio.gouge(0.5);
    } else if (e.type === 'pool') {
      if (river && e.river === river.idx) { showPop('Lake — your water pours in and raises it'); teach('lake', 'A lake', 'Your water pours into the lake and raises it until it spills over the far bank. Cut the outlet and <b>everything that drains through it feeds you</b>. Lakes are the biggest source of water.', river.x, river.z); }
    } else if (e.type === 'pond') {
      if (river && e.river === river.idx) showPop('Stuck — your water fills the hollow until it spills');
    } else if (e.type === 'overflow') {
      if (e.on) feed('A lake is overflowing — its spill is free water');
    } else if (e.type === 'join') {
      if (river && e.river === river.idx) { showPop('Outlet cut · what drains through it feeds you'); audio.lake(); }
    } else if (e.type === 'junction') {
      const from = world.rivers[e.from], to = world.rivers[e.to];
      if (to === river) showPop(`You cut into ${nameOf(from)} — its water flows into you`);
      if (from === river) showPop(`${nameOf(to)} cut your channel — your water runs into it!`);
      if (to === river) teach(`cut:${e.from}>${e.to}`, `You cut into ${nameOf(from)}`, `Your channel crossed <b>${nameOf(from)}</b>'s right here. Yours is <b>deeper</b>, so their water now drains into you at this junction for as long as the cut stays open. Bigger rivers dig deeper channels and win junctions.`, e.x, e.z);
      if (from === river) teach(`cut:${e.from}>${e.to}`, `${nameOf(to)} cut your channel`, `<b>${nameOf(to)}</b>'s channel crossed yours right here. Theirs is <b>deeper</b>, so <b>your</b> water now drains into them at this junction. Grow bigger (lakes, clouds, storms) before you cross a bigger river, or steer clear of it.`, e.x, e.z);
      feed(`${nameOf(to)} cut into ${nameOf(from)}`);
    } else if (e.type === 'steam') {
      if (river && e.river === river.idx) { steamed += e.amount; audio.hiss(); }
    } else if (e.type === 'siphon' && river) {
      // Tally the tug-of-war; the render loop turns it into feedback.
      if (e.to === river.idx) { tug.gain.set(e.from, (tug.gain.get(e.from) ?? 0) + e.amount); audio.bubble(); }
      if (e.from === river.idx) tug.loss.set(e.to, (tug.loss.get(e.to) ?? 0) + e.amount);
      tug.lastTick = world.tick;
    } else if (e.type === 'press') {
      // A skill pressing through a rise: spray thrown up ahead, and the ground gives.
      const pr = world.rivers[e.river], en = entries[e.river];
      if (en) burstSpray(en.spray, pr.x + pr.dx * 60, surfaceAt(world, pr.x, pr.z) * VERT, pr.z + pr.dz * 60, 1.6 * pr.size, 50);
      if (river && e.river === river.idx) { showPop('Pressing through — eroding the rise'); audio.gouge(pr.size); gougeShakeAt = performance.now() - 150; }
    } else if (e.type === 'bump') {
      // Two drops collided: spray where they met, and say what it cost you.
      const ra = world.rivers[e.a], rb = world.rivers[e.b], en = entries[e.a];
      if (en) burstSpray(en.spray, e.x, skyY() + (ra.alt ?? 0), e.z, 1.4, 50);
      const mine = river === ra ? [rb, e.lossA, e.lossB, e.gainA ?? 0] : river === rb ? [ra, e.lossB, e.lossA, e.gainB ?? 0] : null;
      if (mine) {
        const won = mine[3] > 0;
        showPop(won ? `You hit ${nameOf(mine[0])}! +${fmtL(mine[3] - mine[1])}` : `${nameOf(mine[0])} hit you! −${fmtL(mine[1])}`);
        flashEdge(won ? '#ffcf3a' : '#ff5a4a');
        audio.splash(1.3); gougeShakeAt = performance.now() - 200;
        teach('bump', 'Bumping', 'Drops that collide knock each other off course. Whoever hits with more momentum (more water, more speed into the other) <b>wins</b>: the loser spills water and the winner soaks most of it up. Ram lighter drops; dodge heavier ones.', e.x, e.z);
      }
    } else if (e.type === 'unlock') {
      if (river && e.river === river.idx && world.terrain.course !== 'tutorial') teach(`unlock:${e.skill}`, e.skill === 'gouge' ? 'Gouge unlocked' : 'Surge unlocked', e.skill === 'gouge' ? `You're big enough for <b>GOUGE</b> (${key('A', 'Space', 'the GOUGE button')}): for 3 s you climb over rises that would stop you. It costs some water, and using it puts <b>both</b> skills on cooldown.` : `${e.why === 'behind' ? "You're far behind the leader, so you get" : "You're big enough for"} <b>SURGE</b> (${key('RB', 'Q', 'the SURGE button')}): a 2 s burst of speed on top of what you have. It costs some water, and using it puts <b>both</b> skills on cooldown.`, river.x, river.z);
      if (river && e.river === river.idx) { showPop(e.skill === 'gouge' ? 'GOUGE unlocked — A / SPACE to boost over a rise' : 'SURGE unlocked — RB / Q for a speed burst'); audio.splash(1); }
    } else if (e.type === 'cloud') {
      // A cloud drains a little every tick: add it up, say it twice a second.
      if (river && e.river === river.idx) {
        if (coach) coach.clouded = true;
        if (river.dropping) teach('cloud', 'A rain cloud', 'Inside a cloud its water <b>pours into you</b>, shared equally with anyone else inside. It shrinks and rises as it empties. Water you carry makes you heavier: you fall faster and turn slower.', river.x, river.z);
        cloudGot += e.amount;
        const now = performance.now();
        if (now - cloudSaidAt > 500) { cloudSaidAt = now; showPop(`+${fmtL(cloudGot)} from a rain cloud`); audio.splash(0.5); }
      }
    } else if (e.type === 'heat') {
      showPop('A heat wave is rolling down the mountain — the lakes behind it are drying up');
      feed('The heat front is coming: lakes behind it dry out');
    } else if (e.type === 'storm') {
      if (e.on) teach('storm', 'A storm', 'Storms form from water that evaporates off the rivers. Under one, rain pours into <b>your head and your channel</b>. It shrinks as it rains out and drifts as it goes, so chase it.', e.x, e.z);
      if (e.on) { feed('A storm breaks over the slope ahead — free water'); if (river && isRacing(river)) showPop('Storm ahead! Get under it to soak up the rain'); }
    } else if (e.type === 'swell') {
      // A pulse reached a head: it swells, more for a bigger slug of water.
      const en = entries[e.river];
      if (en && e.amount > 0) { en.swellAt = performance.now(); en.swell = Math.min(0.5, e.amount / (en.r.volume * 0.04 + 1)); }
      // A lake's water reaching you is the payoff: say so, loudly.
      if (en && river && e.river === river.idx && e.lake >= 0 && e.amount > 20_000) {
        showPop(`+${fmtL(e.amount)} from a lake`);
        burstSpray(en.spray, en.r.x, surfaceAt(world, en.r.x, en.r.z) * VERT, en.r.z, 1 + Math.min(2, e.amount / 500_000), 90);
        audio.lake();
      }
    } else if (e.type === 'soak') {
      const en = entries[e.river];
      if (en && river && e.river === river.idx && e.amount > 50_000) showPop('A low lake on your channel is soaking up your water');
    } else if (e.type === 'merge') {
      const w = world.rivers[e.winner], l = world.rivers[e.loser];
      if (w === river) { showPop(`You drained ${nameOf(l)} dry`); audio.merge(true); teach(`merge:${e.loser}`, `You drained ${nameOf(l)}`, `All of <b>${nameOf(l)}</b>'s water ran into you: it is out of the race.`, l.x, l.z); }
      if (l === river) teach('drained', 'You were drained', `<b>${nameOf(w)}</b> took all your water. Next time, keep away from bigger rivers until you have grown.`, river.x, river.z);
      if (l === river) audio.merge(false);
      feed(`${nameOf(w)} drained ${nameOf(l)} dry`);
      // Spectate whoever drained the river we were watching.
      if (l === focus) focus = w;
    }
  }
  if (focus.out) focus = world.rivers.find((r) => r.id === focus.out.by) ?? focus;
}

const fmtL = (v) => `${Math.round(v).toLocaleString('en-US')} L`;

// The skill button reads the same two gates the sim and the bots do: ready
// (recharged, enough water) and a target (ground ahead to cut).
let gougeHintAt = -1e9;
function updateSkill() {
  const show = !!river && isRacing(river) && !river.dropping && !mapView;
  if (touchUI) {
    tpad.hidden = !river || !isRacing(river) || mapView || calmNow();
    tfly.hidden = !river?.dropping || mapView || calmNow();
  }
  hud.skill.hidden = !show;
  hud.surge.hidden = !show || !TUNE.surgeOn;
  if (!show) return;
  const left = Math.max(0, river.gougeAt - world.tick);
  const busy = river.gougeT >= 0 || river.boost > 0, ready = gougeReady(world, river);
  const state = !river.gougeOn ? 'dry' : busy ? 'busy' : left ? 'cool' : !ready ? 'dry' : 'go';
  hud.skill.dataset.state = state;
  hud.skill.style.setProperty('--cool', river.gougeOn && left && !busy ? Math.min(1, left / (river.coolLen ?? TUNE.gougeCool)).toFixed(3) : 0);
  const note = !river.gougeOn ? `unlocks at ${fmtL(TUNE.gougeUnlock)}` : river.boost > 0 ? `boosted · ${(river.boost / TICK_HZ).toFixed(1)} s`
    : state === 'cool' ? `ready in ${Math.ceil(left / TICK_HZ)} s` : state === 'dry' ? 'need more water'
    : `climb boost · −${Math.round(gougeCost(river) / 1000)}k L`;
  if (hud.skillNote.textContent !== note) hud.skillNote.textContent = note;
  // Surge: its own button, same two gates.
  const sLeft = Math.max(0, (river.surgeAt ?? 0) - world.tick), sBusy = river.surgeT >= 0, sReady = surgeReady(world, river);
  const sState = !river.surgeOn ? 'dry' : sBusy ? 'busy' : sLeft ? 'cool' : !sReady ? 'dry' : 'go';
  hud.surge.hidden = !show || !TUNE.surgeOn;
  hud.surge.dataset.state = sState;
  hud.surge.style.setProperty('--cool', river.surgeOn && sLeft && !sBusy ? Math.min(1, sLeft / (river.coolLen ?? TUNE.surgeCool)).toFixed(3) : 0);
  const sNote = !river.surgeOn ? `unlocks at ${fmtL(TUNE.surgeUnlock)}` : sBusy ? 'surging!' : sState === 'cool' ? `ready in ${Math.ceil(sLeft / TICK_HZ)} s`
    : sState === 'dry' ? 'need more water' : `speed burst · −${Math.round(Math.max(TUNE.gougeMinCost, river.volume * TUNE.surgeShare) / 1000)}k L`;
  if (hud.surgeNote.textContent !== sNote) hud.surgeNote.textContent = sNote;
  // A rise the boost would carry you over: say so, the moment it stops you.
  if (state === 'go' && river.speed < TUNE.climbSpeed && gougeTarget(world, river) && performance.now() - gougeHintAt > 8000) {
    gougeHintAt = performance.now();
    showPop(lowPower ? 'Blocked — tap GOUGE to climb over' : 'Blocked — press SPACE / A to GOUGE over it');
  }
}
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
  // Stars against paired baselines from this very race (Brain: anchor stars to
  // named baselines, not a pooled cut): 1 reached the beach, 2 beat the middle
  // bot to it, 3 first to the beach. Records are banked once per race.
  let stars = '', recordLine = '';
  if (river) {
    const botTimes = world.rivers.filter((r) => r !== river && r.finished).map((r) => r.finishTick).sort((a, b) => a - b);
    const midBot = botTimes.length ? botTimes[botTimes.length >> 1] : Infinity;
    const n = !river.finished ? 0 : place === 1 ? 3 : river.finishTick <= midBot ? 2 : 1;
    stars = `<span class="stars" title="1: reached the beach · 2: beat the middle of the field · 3: first">${'★'.repeat(n)}${'☆'.repeat(3 - n)}</span>`;
    if (!recordBanked) { recordBanked = true; bankRecord({ place, finished: river.finished, secs, volume: river.volume, stars: n }); }
    const rec = loadRecord(), pb = recordNotes.length ? `<em>${recordNotes.join(' · ')}</em>` : '';
    recordLine = `<span class="record">${pb}${rec.races} race${rec.races === 1 ? '' : 's'} · ${rec.wins} win${rec.wins === 1 ? '' : 's'} · best ${rec.bestPlace ? ordinal(rec.bestPlace) : '—'}${rec.bestTime ? ` · fastest ${fmtTime(rec.bestTime)}` : ''} · ★ ${rec.stars}</span>`;
  }
  const again = mode === 'solo'
    ? `<button id="again">Race again</button>`
    : `<small>${final ? 'Next race starts soon' : 'The race goes on — watch it out'}</small>`;
  if (river && fb) {
    const result = river.finished ? 'sea' : river.out ? 'drained' : final ? 'time' : null;
    if (result) fb.raceEnd({ result, place, of: world.rivers.length, secs, volume: river.volume, lakes: river.lakes,
      by: river.out ? nameOf(world.rivers.find((r) => r.id === river.out.by)) : undefined });
  }
  const fbBtn = fb ? '<button id="fb-results" class="fb-results">Send feedback</button>' : '';
  hud.banner.innerHTML = `<b>${head}</b>${stars}${sub}${recordLine}<ol>${list}</ol>${final || !river ? '' : '<small>Final results when the race ends</small>'}${again}${fbBtn}`;
  hud.banner.hidden = false;
  document.getElementById('again')?.addEventListener('click', () => newRun());
  document.getElementById('fb-results')?.addEventListener('click', () => fb.open());
}
const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Your record across races, kept in this browser (flood.record). Personal bests
// are noted on the results the race they're set.
function loadRecord() {
  const blank = { races: 0, wins: 0, finishes: 0, stars: 0, bestPlace: 0, bestTime: 0, mostWater: 0 };
  try { return { ...blank, ...JSON.parse(localStorage.getItem('flood.record') || '{}') }; } catch { return blank; }
}
function bankRecord({ place, finished, secs, volume, stars }) {
  const r = loadRecord();
  recordNotes = [];
  r.races++; r.stars += stars;
  if (finished) r.finishes++;
  if (place === 1 && finished) r.wins++;
  if (!r.bestPlace || place < r.bestPlace) { if (r.races > 1) recordNotes.push('best place yet!'); r.bestPlace = place; }
  if (finished && (!r.bestTime || secs < r.bestTime)) { if (r.bestTime) recordNotes.push('fastest yet!'); r.bestTime = secs; }
  if (volume > r.mostWater) { if (r.mostWater) recordNotes.push('most water yet!'); r.mostWater = Math.round(volume); }
  try { localStorage.setItem('flood.record', JSON.stringify(r)); } catch { /* private mode: nothing kept */ }
}

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
// Tutorial lessons: the race stops, the camera flies to where it happened,
// and a card explains it; A / Space / Enter / a click carries on.
const lessonEl = document.getElementById('lesson');
let lesson = null; const lessonQueue = [], taught = new Set();
function teach(key, title, html, x, z, far = 1) {
  if (!tutorial || mode !== 'solo' || taught.has(key)) return;
  taught.add(key);
  lessonQueue.push({ title, html, x, z, far });
  if (!lesson) nextLesson();
}
function nextLesson() {
  lesson = lessonQueue.shift() ?? null;
  lessonEl.hidden = !lesson;
  if (!lesson) return;
  coachEl.hidden = true; // one thing at a time
  lessonEl.querySelector('h3').textContent = lesson.title;
  lessonEl.querySelector('p').innerHTML = lesson.html;
  lessonEl.querySelector('small').textContent = `${key('A', 'Space / Enter', 'Tap')} to carry on`;
  lesson.shownAt = performance.now();
}
function endLesson() {
  if (!lesson || performance.now() - lesson.shownAt < 600) return; // a held button doesn't skip it
  input.takeSkill(); input.takeSurge(); // the press that closed it fires nothing
  nextLesson();
}
lessonEl.onclick = endLesson;
addEventListener('keydown', (e) => { if (lesson && (e.code === 'Enter' || e.code === 'Space')) { endLesson(); e.preventDefault(); } });

// First-race coach: one step at a time; each step's words and its pass test
// live together (Brain: a prompt and its check derived from one source can't
// drift apart). Done once per browser (flood.coached); ?nocoach skips it.
// The Tutorial (menu) runs the longer TUTORIAL list every time.
const key = (pad, kb, touch) => (lowPower ? touch : padSeen ? pad : kb);
const COACH = [
  { text: () => `Steer with <b>${key('the left stick', '← →', 'the ◀ ▶ buttons')}</b>`, pass: (c) => c.steered > 8 },
  { text: () => 'The <b>white ribbon</b> shows where your water will go', pass: (c) => c.secs > 5 },
  { text: () => `Only the <b>gold beach</b> ends the race${key(' · <b>right stick</b> looks around, <b>up</b> for a view ahead', '', '')}`, pass: (c) => c.secs > 8 },
  { text: () => 'Flow into <b>lakes</b> and out over their bank: their water feeds you', pass: (c) => river.lakes > 0 || c.secs > 14 },
  { text: () => `A rise in the way? <b>GOUGE</b> (${key('A', 'Space', 'tap')}) climbs over it`, pass: (c) => c.gouged || c.secs > 16 },
  { text: () => `Slow on the flat? <b>SURGE</b> (${key('RB', 'Q', 'tap')}) bursts ahead`, pass: (c) => c.surged || c.secs > 16 },
];
const TUTORIAL = [
  { drop: true, text: () => `${key('Turn with the <b>left stick ← →</b>', 'Turn your falling drop with <b>← →</b>', 'Turn your falling drop with <b>◀ ▶</b>')}`, pass: (c) => c.steered > 8 },
  { drop: true, text: () => `${key('<b>Stick ↑</b> dives, <b>↓</b> floats', '', '<b>▲ DIVE</b> to fall faster, <b>▼ FLOAT</b> to stay up')}`, pass: (c) => c.glided || lowPower || !padSeen },
  { drop: true, text: () => `<b>${key('Right stick ↑ ↓', 'W / S', '▲ ▼')}</b>: <b>↑</b> descends faster, <b>↓</b> slows the descent, like flaps (clouds sit at different heights)`, pass: (c) => c.fell },
  { drop: true, text: () => 'Fly into a <b>white cloud</b> for free water', pass: (c) => c.clouded },
  { text: () => `Steer with <b>${key('the left stick', '← →', 'the ◀ ▶ buttons')}</b>: follow the <b>gold beacon</b>`, pass: (c) => c.steered > 8 || c.stage >= 1 },
  { text: () => 'Follow the <b>gold beacons</b> down the course', pass: (c) => c.stage >= 2 },
  { text: () => `<b>SURGE</b> now: <b>${key('RB', 'Q', 'tap SURGE')}</b>`, pass: (c) => c.surged || c.stage >= 3 },
  { text: () => 'Follow the beacon to the <b>rock ridge</b>', pass: (c) => c.stage >= 3 },
  { text: () => `At the ridge: <b>GOUGE</b> with <b>${key('A', 'Space', 'tap GOUGE')}</b>`, pass: (c) => c.gouged || c.stage >= 4 },
  { text: () => 'Steer <b>under the storm</b>', pass: (c) => river.rained > c.since || c.stage >= 5 },
  { text: () => 'Race to the <b>gold beach</b>!', pass: () => false },
];
let padSeen = false, tutorial = false, coachSteps = COACH;
const coachEl = document.getElementById('coach');
let coach = null; // { step, since (tick), steered, mapped, gouged, surged, glided, fell, clouded }
function startCoach() {
  let done = params.has('nocoach') && !tutorial;
  try { done ||= !tutorial && localStorage.getItem('flood.coached') === '1'; } catch { /* no storage */ }
  coachSteps = tutorial ? TUTORIAL : COACH;
  taught.clear(); lessonQueue.length = 0; lesson = null; lessonEl.hidden = true;
  coach = done ? null : { stage: 0, step: 0, since: 0, steered: 0, mapped: false, gouged: false, surged: false, glided: false, fell: false, clouded: false };
  coachEl.hidden = true;
}
function watchCoach(steer) {
  if (!coach || !river || !isRacing(river) || lesson) { coachEl.hidden = true; return; }
  // Drop steps show while falling; once landed, any left are skipped.
  while (!river.dropping && coachSteps[coach.step]?.drop) { coach.step++; coach.since = world.tick; coach.steered = 0; }
  const s = coachSteps[coach.step];
  if (!s || (river.dropping && !s.drop)) { coachEl.hidden = true; if (s) return; }
  if (!s) { coach = null; return; }
  if (!coach.since) coach.since = world.tick;
  if (steer) coach.steered++;
  const c = { ...coach, secs: (world.tick - coach.since) / TICK_HZ };
  if (s.pass(c)) {
    coach.step++; coach.since = world.tick; coach.steered = 0;
    if (coach.step >= coachSteps.length) {
      coach = null; coachEl.hidden = true; tutorial = false;
      try { localStorage.setItem('flood.coached', '1'); } catch { /* no storage */ }
      return;
    }
    if (river.dropping && !coachSteps[coach.step].drop) { coachEl.hidden = true; return; }
  }
  const html = `${coachSteps[coach.step].text()}<small>${tutorial ? 'Tutorial · ' : ''}${coach.step + 1} / ${coachSteps.length}</small>`;
  if (coachEl.innerHTML !== html) coachEl.innerHTML = html;
  coachEl.hidden = false;
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
// Route preview: where your water will actually go in the next 10 s if you
// let go of the stick, from the real movement rules run on a copy of your
// river (median error 9 m at 1 km, 45 m at 3 km). A ribbon on the ground:
// white where it runs, yellow where it slows, orange where it finds its way
// round a rise, red where it would stall.
const PREVIEW_PTS = 50;
const flowLine = (() => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PREVIEW_PTS * 2 * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PREVIEW_PTS * 2 * 3), 3));
  const idx = [];
  for (let i = 1; i < PREVIEW_PTS; i++) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthTest: false, side: THREE.DoubleSide }));
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
})();
const KIND = { run: [1, 1, 1], slow: [1, 0.85, 0.3], route: [1, 0.55, 0.15], stuck: [1, 0.2, 0.15] };
let flowAt = 0;
function showFlow(now) {
  const me = river;
  const on = !!me && isRacing(me) && !me.dropping && me.gougeT < 0 && !mapView && settings.preview;
  flowLine.visible = on;
  placeCrossTags(on);
  if (!on || now - flowAt < 250) return;
  flowAt = now;
  const path = [{ x: me.x, z: me.z, kind: 'run' }, ...predictPath(world, me, (PREVIEW_PTS - 1) * 4, 4)].slice(0, PREVIEW_PTS);
  // Where the preview crosses or runs along a rival's live channel: one marker each, deeper or shallower than
  // your head will be there (owner, 2026-11-09). Along it for 12+ points (about 2.4 s) is a ride, not a cut.
  crossMarks = [];
  for (const p of path) {
    const last = crossMarks[crossMarks.length - 1];
    if (!p.cross) { if (last) last.open = false; continue; }
    if (last?.open && last.o === p.cross.o) { last.n++; continue; }
    crossMarks.push({ x: p.x, z: p.z, ...p.cross, n: 1, open: true });
  }
  const pos = flowLine.geometry.attributes.position, col = flowLine.geometry.attributes.color;
  const half = Math.max(18, widthOf(me) * 0.18);
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, p = path[i];
    const y = surfaceAt(world, p.x, p.z) * VERT + 14, fade = 1 - (i / PREVIEW_PTS) * 0.6;
    pos.setXYZ(2 * i, p.x - (dz / l) * half, y, p.z + (dx / l) * half);
    pos.setXYZ(2 * i + 1, p.x + (dz / l) * half, y, p.z - (dx / l) * half);
    const c = KIND[p.kind] ?? KIND.run;
    col.setXYZ(2 * i, c[0] * fade, c[1] * fade, c[2] * fade);
    col.setXYZ(2 * i + 1, c[0] * fade, c[1] * fade, c[2] * fade);
  }
  flowLine.geometry.setDrawRange(0, Math.max(0, (path.length - 1) * 6));
  pos.needsUpdate = col.needsUpdate = true;
}

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
  beam.visible = false; // (the tall beam blocked the comet chase view; the ring on the ground marks the touchdown)
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
  // Fly on straight on this heading until it crosses the start line: that's where it touches down.
  let q = { x: river.x, z: river.z };
  const stepM = (river.glideV ?? TUNE.glideSpeed) * DT * 4;
  for (let i = 0; i < 400 && !pastLine(world, q.x, q.z); i++) q = { x: q.x + river.dx * stepM, z: q.z + river.dz * stepM };
  const px = q.x, pz = q.z, x = px, z = pz;
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
  dbg.marker = { x, z };
}

let last = performance.now(), sendAcc = 0;
renderer.setAnimationLoop(() => {
  // One clock for both ends (the rAF timestamp can predate a performance.now() start).
  const now = performance.now();
  const frameDt = Math.max(0, Math.min(0.25, (now - last) / 1000));
  adaptResolution((now - last) / 1000);
  last = now;
  input.poll();
  menuActions();
  if (!world) { renderer.render(scene, camera); return; }
  // Fixed-step sim, decoupled from frame rate; render interpolates between ticks.
  acc += frameDt;
  if (mode === 'solo') {
    if (paused || lesson || fb?.isOpen || mustRotate()) { handleActions(); acc = 0; }
    else while (acc >= DT && !lesson) { soloTick(); acc -= DT; }
    if (lesson) acc = 0;
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
      if (river && isRacing(river)) { const v = sampleSteer(); net.steer(v.s ?? v, now, false, v.f ?? 0, v.g ?? 0); }
    }
  }
  const alpha = Math.min(1, acc / DT);

  let fx = 0, fz = 0, fy = 0;
  const intro0 = now < introUntil && !mapView; // comets drawn fat for the long opening shot
  for (const e of entries) {
    const r = e.r;
    const hx = e.prev.x + (r.x - e.prev.x) * alpha, hz = e.prev.z + (r.z - e.prev.z) * alpha;
    // A falling drop sits its altitude above the ground (true metres, not exaggerated).
    const ground = surfaceAt(world, hx, hz, r.idx) * VERT;
    const hy = r.dropping ? skyY() + (r.alt - (r.alt - (e.prevAlt ?? r.alt)) * (1 - alpha)) : ground;
    e.shadow.visible = e.stem.visible = !!r.dropping && !r.out && !mapView;
    if (e.shadow.visible) {
      const s = 110 * Math.max(1, r.size);
      e.shadow.position.set(hx, ground + 12, hz); e.shadow.scale.set(s, 1, s);
      e.stem.position.set(hx, ground, hz); e.stem.scale.set(r === river ? 9 : 5, Math.max(1, hy - ground), r === river ? 9 : 5);
    }
    const big = mapView ? 6 : 1; // heads read as markers on the map
    // Falling: a stretched drop with its streak. Flowing: the surge.
    e.head.visible = !r.out && (!!r.dropping || mapView);
    e.head.position.set(hx, hy + 8, hz);
    e.streak.visible = !!r.dropping && !mapView;
    if (r.dropping) {
      // The tail points back along the fall: up, and against the glide.
      // (Your own tail is short and trails back along the flight: seen from behind, a long one stood up as a pillar.)
      tailDir.set(-r.dx * (r.glideV ?? TUNE.glideSpeed), TUNE.dropAlt / (TUNE.dropTicks / TICK_HZ), -r.dz * (r.glideV ?? TUNE.glideSpeed)).normalize();
      e.streak.quaternion.setFromUnitVectors(UP, tailDir);
      e.streak.position.set(hx, hy, hz);
      const mine = r === river && !intro0, wide = intro0 ? 110 : mine ? 22 : 26;
      e.streak.scale.set(wide, mine ? 260 : 1200, wide);
    }
    if (r.dropping) e.head.scale.set((intro0 ? 120 : 40) * big, (intro0 ? 120 : 40) * big, (intro0 ? 120 : 40) * big);
    else {
      // A pulse arriving swells the head for a moment.
      const sw = e.swellAt ? Math.max(0, 1 - (now - e.swellAt) / 700) * (e.swell ?? 0) : 0;
      e.head.scale.set(55 * r.size * big * (1 + sw), 30 * r.size * big * (1 + 1.6 * sw), 55 * r.size * big * (1 + sw));
    }
    const flowing = !r.dropping && !r.out && !mapView;
    e.surge.visible = flowing;
    if (flowing) {
      // Face the way the water actually moves (eased), not the raw heading.
      const vx = r.x - e.prev.x, vz = r.z - e.prev.z, vl = Math.hypot(vx, vz);
      if (vl > 0.5) { e.mx += (vx / vl - e.mx) * 0.2; e.mz += (vz / vl - e.mz) * 0.2; }
      const ml = Math.hypot(e.mx, e.mz) || 1;
      const s = r.size * (r.finished ? 1.4 : 1);
      // Gouge: the water rears up and draws back while it winds up, then
      // slams flat and long when the blow lands.
      const wind = 0; // (Gouge no longer winds up: it adds to the head at once)
      const slam = e.slamAt ? Math.max(0, 1 - (now - e.slamAt) / 450) : 0;
      const rear = wind * wind, quiver = wind > 0.6 ? Math.sin(now / 22) * 0.06 * wind : 0;
      const lift = r.boost > 0 ? Math.min(1, r.boost / 10) * (0.9 + 0.1 * Math.sin(now / 60)) : 0; // boosted: a tall standing wave
      const dash = r.surgeT >= 0 ? 1 : 0; // surging: long and low
      e.surge.position.set(hx - e.mx * 40 * s * rear, hy + 6 * s + 70 * s * rear * (1 - slam) + 40 * s * lift, hz - e.mz * 40 * s * rear);
      e.surge.scale.set(95 * s * (1 - 0.25 * rear + 0.35 * slam + quiver + 0.3 * lift - 0.15 * dash), 46 * s * (1 + 1.8 * rear - 0.5 * slam + 1.6 * lift - 0.3 * dash), 120 * s * (1 - 0.3 * rear + 0.8 * slam + 0.3 * lift + 1.2 * dash));
      e.surge.rotation.set(0, Math.atan2(e.mx / ml, e.mz / ml), 0);
    }
    updateSpray(e.spray, hx, hy, hz, e.mx, e.mz, 1 + (r.size - 1) * 2, Math.min(1, r.speed / 200), frameDt, flowing && !r.finished);    e.screen = isRacing(r) ? [hx, hy + 30 * r.size, hz] : null;
    e.ribbon.update(world, r, hx, hz, now / 1000);
    // A stuck river's water pools round its head, rising until it spills.
    if (r.filling && !r.dropping) {
      if (!e.pond) {
        e.pond = new THREE.Mesh(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#3fb6cf', transparent: true, opacity: 0.85 }));
        scene.add(e.pond);
      }
      const depth = Math.max(0, r.low - surfaceAt(world, r.x, r.z, r.idx));
      const rad = widthOf(r) * (0.8 + Math.min(2.5, depth / 6));
      e.pond.visible = true;
      e.pond.position.set(hx, r.low * VERT + 1, hz);
      e.pond.scale.set(rad, 1, rad);
    } else if (e.pond) e.pond.visible = false;
    // Nothing stands in the water: clear trees and boulders along each new stretch.
    while ((e.cleared ?? 0) < r.path.length) {
      const q = r.path[e.cleared ?? 0];
      clearAround([rocks], terrain, q.x, q.z, q.w * 0.7); // trees fall only where the game knocks them down
      e.cleared = (e.cleared ?? 0) + 1;
    }
    if (r === focus) { fx = hx; fz = hz; fy = hy; }
  }

  placeTags();
  placeLakeTags();
  placeCloudTags();
  pulseLava(lava, now / 1000);
  updateSpills(now / 1000);
  updateWeather(now / 1000);
  updateSkyClouds();
  updateLane();
  followStorm();
  tickWater([sea, lakesMesh, ...entries.map((e) => e.surge)], now / 1000);
  showMarker(now, fx, fy, fz);
  showDownhill(now);
  showFlow(now);
  showStick();
  watchCourse();
  const intro = now < introUntil && !mapView && !!river?.dropping;
  document.body.classList.toggle('intro', intro);
  updateMapLines(now);
  // Changing view (map, a lesson, the drop, landing, spectating someone else,
  // the finish) is a hard CUT, never a camera flight across the island: the
  // new shot starts already in place (owner: "none of that weird zooming
  // around"; Brain FILM kernel: a view swap is a cut). Within a view the
  // camera still eases as it follows.
  const camMode = lesson && lesson.x !== undefined && !mapView ? `lesson:${lesson.title}` : mapView ? 'map' : intro ? 'intro'
    : `${focus.dropping ? 'drop' : focus.finished ? 'done' : 'chase'}:${focus.id}`;
  const cut = camMode !== lastCamMode;
  lastCamMode = camMode;
  if (lesson && lesson.x !== undefined && !mapView) {
    // A lesson: a still shot over the spot, high and to the south of it, looking down on it.
    const g = surfaceAt(world, lesson.x, lesson.z) * VERT, f = lesson.far ?? 1;
    camera.position.set(lesson.x + 700 * f, g + 1500 * f, lesson.z + 1700 * f);
    camLook.set(lesson.x, g, lesson.z);
    camera.lookAt(camLook);
  } else if (mapView) {
    controls.update();
  } else if (intro) {
    // The opening shot: high behind the comets as they come in over the far
    // side of the mountains, looking ahead along their path to the peaks and
    // the slope beyond. It closes in on the pack, then the chase view takes over.
    const top = spawnBand(world).top, n = terrain.size;
    const tx = ((top % n) / (n - 1) - 0.5) * W, tz = (Math.floor(top / n) / (n - 1) - 0.5) * W, th = terrain.height[top] * VERT;
    const ax = terrain.axis.x, az = terrain.axis.y; // down the slope
    const t = 1 - (introUntil - now) / ((TUNE.dropCalm / TICK_HZ) * 1000), run = TUNE.cometRun * TUNE.glideSpeed * TUNE.dropTicks / TICK_HZ * (world.dropScale ?? 1);
    const back = run + 5000 - 3500 * t, above = skyY() + TUNE.dropAlt + 2600 - 1600 * t;
    camera.position.set(tx - ax * back, above, tz - az * back);
    camera.lookAt(tx + ax * 2000, th, tz + az * 2000);
    camTarget.set(tx, th, tz);
  } else if (focus.dropping) {
    // Falling: a comet chase. Behind the drop and a little above it, always
    // looking down the slope (it never turns with the drop: no yaw, Brain T182),
    // so the clouds ahead sit at their true height beside you and the ground
    // shadows (yours and theirs) show where you are over it.
    // It turns with the drop again, so steering reads, but never faster than
    // 52 deg/s, matched to how fast a drop turns (Brain T182: visually induced sickness peaks at 60 deg/s).
    if (cut) camDir.set(focus.dx, focus.dz).normalize();
    else {
      const ang = Math.atan2(camDir.x * focus.dz - camDir.y * focus.dx, camDir.x * focus.dx + camDir.y * focus.dz);
      const turn = Math.sign(ang) * Math.min(Math.abs(ang) * (1 - Math.exp(-frameDt * 6)), 0.91 * frameDt); // up to 52 deg/s: as fast as a drop turns, under T182's 60
      camDir.rotateAround(new THREE.Vector2(0, 0), turn).normalize();
      dbg.dropYawRate = Math.max(dbg.dropYawRate ?? 0, Math.abs(turn) / Math.max(frameDt, 1e-3));
    }
    const ax = camDir.x, az = camDir.y, back = 800, up = 280; // close behind: the ground and the clouds rush past
    const k = cut ? 1 : 1 - Math.exp(-frameDt * 4);
    camera.position.lerp(new THREE.Vector3(fx - ax * back, fy + up, fz - az * back), k);
    camTarget.lerp(new THREE.Vector3(fx + ax * 900, fy - 220, fz + az * 900), k);
    camera.lookAt(camLook.copy(camTarget));
    camYaw = 0;
    showAltimeter();
    // A bump jolts the view.
    const jolt = gougeShakeAt ? Math.max(0, 1 - (now - gougeShakeAt) / 500) : 0;
    if (jolt > 0 && settings.shake) { camera.position.x += (Math.random() - 0.5) * 90 * jolt; camera.position.y += (Math.random() - 0.5) * 60 * jolt; }
    if (Math.abs(camera.fov - baseFov) > 0.05) { camera.fov += (baseFov - camera.fov) * k; camera.updateProjectionMatrix(); }
  } else {
    // Chase camera. It must never fight the player: it follows the river's
    // course over the last few hundred metres (not the head's tick-to-tick heading,
    // which gravity tugs constantly), ignores small changes, turns slowly, and
    // only its height reacts quickly (up fast, down slowly, so it doesn't bob).
    // Right stick swings the camera round; let go and it eases back behind.
    // Right stick (once landed): sideways looks up to 30 degrees left or right
    // and drifts back to centre when let go; up raises the camera and tilts it
    // down for a look far ahead.
    const look = input.look(), riseIn = input.rise();
    const yawWant = look * 0.52;
    camYaw += (yawWant - camYaw) * (1 - Math.exp(-frameDt * (look ? 5 : 2.5)));
    camRise += (riseIn - camRise) * (1 - Math.exp(-frameDt * (riseIn > camRise ? 4 : 3)));
    const course = courseOf(focus, fx, fz);
    if (cut) { camDir.set(course.x, course.y).normalize(); camYaw = 0; } // a new shot starts behind the river
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
    // Pulls back only a little as the river grows, so a big river fills more
    // of the screen and the ground rushes past faster.
    // On the ground it sits low (about 10 degrees down) so the land recedes to the horizon.
    // (Closer than it was, 1.2 km: the ground near the river now slides past fast enough to read as speed.)
    const back = (falling ? 1300 : done ? 700 : 330 + 40 * sz) + 900 * camRise, up = (falling ? 1100 : done ? 2600 : 110 + 25 * sz) + 2400 * camRise;
    const want = new THREE.Vector3(fx - view.x * back, Math.max(fy, 0) + up, fz - view.y * back);
    // Stay above the ground along the whole sightline, not just at the camera.
    for (let f = 0.25; f <= 1; f += 0.25) {
      const g = surfaceAt(world, fx - view.x * back * f, fz - view.y * back * f) * VERT;
      want.y = Math.max(want.y, g + 45 + 70 * f);
    }
    const kXZ = cut ? 1 : 1 - Math.exp(-frameDt * 5);
    camera.position.x += (want.x - camera.position.x) * kXZ;
    camera.position.z += (want.z - camera.position.z) * kXZ;
    const kY = cut ? 1 : 1 - Math.exp(-frameDt * (want.y > camera.position.y ? 3 : 0.6));
    camera.position.y += (want.y - camera.position.y) * kY;
    camera.position.y = Math.max(camera.position.y, surfaceAt(world, camera.position.x, camera.position.z) * VERT + 150);
    const ahead = (falling ? 600 : done ? 2200 : 420 + 60 * sz) + 2600 * camRise;
    camTarget.lerp(new THREE.Vector3(fx + view.x * ahead, fy, fz + view.y * ahead), cut ? 1 : 1 - Math.exp(-frameDt * 6));
    camera.lookAt(camLook.copy(camTarget));
    // Trees standing between the camera and the head fade out (not while falling or finished).
    treeFade.cam.value.copy(camera.position);
    treeFade.focus.value.set(fx, fy + 30, fz);
    treeFade.radius.value = falling || done ? 0 : 220 + 60 * sz;
    // Power: the view widens with speed, and a big, fast river shakes it.
    const fast = falling || done ? 0 : Math.min(1, (focus.speed ?? 0) / 260);
    const fov = baseFov * (1 + 0.22 * fast);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * (cut ? 1 : 1 - Math.exp(-frameDt * 3)); camera.updateProjectionMatrix(); }
    const jolt = gougeShakeAt ? Math.max(0, 1 - (now - gougeShakeAt) / 500) : 0;
    const shake = falling || done ? 0 : Math.max(Math.min(18, 14 * Math.max(0, sz - 1) * fast + 3 * fast * fast), 45 * jolt * jolt);
    if (shake > 0.5 && settings.shake) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      camera.position.z += (Math.random() - 0.5) * shake;
    }
  }

  const table = standings(world);
  const alive = world.rivers.filter(isRacing).length;
  const me = river ?? focus;
  const place = table.indexOf(me) + 1;
  // Trailer HUD: big rank (#4/12), km to sea, litres.
  // Falling, a place means nothing yet (you are last until you land): show who has landed instead.
  const landed = world.rivers.filter((r) => !r.dropping).length;
  const rankHtml = !river ? `<small>SPECTATING</small><em>${alive} flowing</em>`
    : river.dropping ? `<small>IN THE SKY</small><em>${landed} of ${world.rivers.length} landed</em>`
    : `#${place}<small>/${world.rivers.length}</small><em>${alive} flowing</em>`;
  if (hud.rank.innerHTML !== rankHtml) hud.rank.innerHTML = rankHtml;
  hud.rank.className = !river || river.dropping ? '' : place === 1 ? 'top' : place <= 4 ? 'mid' : 'low';
  document.body.classList.toggle('falling', !!river?.dropping); // the footer's race controls hide while falling
  const toSea = world.toBeach[cellIndex(terrain, focus.x, focus.z)];
  const distHtml = focus !== river ? `<small>WATCHING</small> ${escapeHtml(nameOf(focus))}`
    : river.dropping ? `FALLING<small> · ${Math.ceil(river.dropping / TICK_HZ)} S</small>`
    : toSea >= 1e8 ? `<small>FIND A WAY DOWN</small>` : `${(toSea / 1000).toFixed(2)}<small> KM TO THE BEACH</small>`;
  if (hud.dist.innerHTML !== distHtml) hud.dist.innerHTML = distHtml;
  const secs = (river?.finished ? river.finishTick : world.tick) / TICK_HZ;
  hud.time.textContent = fmtTime(secs);
  hud.litres.textContent = fmtL(me.volume);
  // The water network feeding you: lakes through your outlets, rivers you cut into.
  const feeds = me.via.size;
  let tribs = 0;
  for (const j of world.junctions.values()) if (j.to === me) tribs++;
  const fedBy = [feeds && `${feeds} lake${feeds === 1 ? '' : 's'}`, tribs && `${tribs} river${tribs === 1 ? '' : 's'}`].filter(Boolean).join(' + ');
  const basin = me.inLake;
  hud.depth.textContent = me.dropping ? (lowPower ? '◀ ▶ turn · ▲ dive to low clouds · ▼ float: stay up for clouds' : '← → steer · ↑ dive to low clouds · ↓ float: stay up for clouds')
    : basin >= 0
    ? `pouring into the lake · ${Math.floor(100 * world.lakeVol[basin] / world.lakeCap[basin])}% full` + (world.lakeVol[basin] > world.lakeCap[basin] ? ' · overflowing' : '')
    : finishLeft() !== null && isRacing(me) ? `${nameOf(world.rivers.find((r) => r.finished && r.finishTick === firstFinish()))} reached the sea · ${finishLeft()} s left to get there`
    : me.inLake >= 0 && heatGap(me) < 0 ? 'the heat front is drying this lake'
    : `pouring ${fmtL(dischargeOf(me) * TICK_HZ + me.inflow * TICK_HZ)}/s · head ${headOf(me).toFixed(1)} m · cutting ${me.depth.toFixed(1)} m` + (fedBy ? ` · fed by ${fedBy}` : '');
  updateSkill();
  // In a rival's live channel: say once that it's slower, not a slipstream
  // (Brain: following the leader finished 8 of 24 against 20 of 24).
  if (river && isRacing(river) && !river.dropping) {
    const k = cellIndex(terrain, river.x, river.z), o = world.owner[k];
    if (o >= 0 && o !== river.idx && isLive(world, k)) caption('draft', `In ${escapeHtml(nameOf(world.rivers[o]))}'s channel: <b>their water drags at you</b>, it's no slipstream`);
  }
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

  const hazeView = river ?? focus;
  hazeFor(hazeView?.dropping && !mapView ? hazeView.alt ?? 0 : 0, frameDt);
  renderer.render(scene, camera);
  if (river && isRacing(river)) fb?.frame(frameDt);
  dbg.frames++;
  dbg.calls = renderer.info.render.calls;
  if (dbg.frames === 2) dbg.ready = true;
});

Object.assign(dbg, {
  renderer, scene, camera, audio,
  nameOf: (id) => names[id] ?? id, // display name for a river id (rivals have names in solo)
  riverFingerprint: () => riverFingerprint(world),
  newRun,
  fb,
});

// Start: ?seed / ?solo / ?bots go straight to a solo race, ?online joins the server,
// otherwise show the menu.
const splash = document.getElementById('splash');
// The studio card shows from page load (over the load itself); a direct start skips it.
const studio = document.getElementById('studio');
if (params.has('online') || params.has('seed') || params.has('solo') || params.has('bots')) studio.hidden = true;
let splashLeftAt = -1e9;
function leaveSplash() {
  // Nothing goes through until the studio card has faded all the way out (owner, 2026-11-11).
  if (splash.hidden || !studio.hidden) return;
  goLandscape(); // a press is the gesture fullscreen needs
  splash.hidden = true;
  splashLeftAt = performance.now();
  audio.music();
  hud.menu.hidden = false;
  // New players land on the Tutorial; anyone who has played lands on Play solo.
  let played = false;
  try { played = localStorage.getItem('flood.coached') === '1'; } catch { /* no storage */ }
  const first = document.getElementById(played ? 'play-solo' : 'play-tutorial');
  first.focus(); markSel(first);
}
const nameBox = document.getElementById('name');
try { nameBox.value = localStorage.getItem('flood.name') ?? ''; } catch { /* no storage */ }
const pickName = () => {
  const n = nameBox.value.trim().slice(0, 12);
  try { localStorage.setItem('flood.name', n); } catch { /* no storage */ }
  return n;
};
// The selected menu button is marked by a class, not :focus, so it shows even
// when the window itself isn't focused (a pad user who never clicked).
const markSel = (el) => { for (const b of hud.menu.querySelectorAll('button')) b.classList.toggle('sel', b === el); };
hud.menu.addEventListener('focusin', (e) => { if (e.target.tagName === 'BUTTON') markSel(e.target); });
hud.menu.addEventListener('mouseover', (e) => { if (e.target.tagName === 'BUTTON') e.target.focus(); });
// Arrow keys move through the menu too (the pad's D-pad already does).
addEventListener('keydown', (e) => {
  if (hud.menu.hidden || (e.code !== 'ArrowUp' && e.code !== 'ArrowDown')) return;
  const btns = [...hud.menu.querySelectorAll('button:not([hidden])')];
  const i = btns.indexOf(document.activeElement);
  btns[i < 0 ? 0 : (i + (e.code === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length].focus();
  e.preventDefault();
});
const fresh = () => performance.now() - splashLeftAt < 500; // the press that left the splash
document.getElementById('play-solo').onclick = () => {
  if (fresh()) return; tutorial = false; hud.menu.hidden = true; newRun(); };
document.getElementById('play-tutorial').onclick = () => {
  if (fresh()) return; tutorial = true; hud.menu.hidden = true; newTutorial(); };
document.getElementById('play-online').onclick = () => { hud.menu.hidden = true; goOnline(pickName()); };
if (params.has('online')) { hud.menu.hidden = true; goOnline(params.get('name') ?? ''); }
else if (params.has('seed') || params.has('solo') || params.has('bots')) { hud.menu.hidden = true; newRun(); }
else {
  // Splash first: the press that leaves it starts the music, then the menu.
  useIsland(1 + Math.floor(Math.random() * 1_000_000));
  camera.position.set(W * 0.45, W * 0.6, W * 0.7); camera.lookAt(0, 0, 0);
  splash.hidden = false;
  // The studio card plays over it first; presses wait until it has faded out. It shows from the
  // HTML (Brain flood#E116), so its fade may already be over by the time this runs.
  const studioDone = () => { studio.hidden = true; };
  if (getComputedStyle(studio).visibility === 'hidden') studioDone();
  studio.addEventListener('animationend', studioDone);
  setTimeout(studioDone, 3200); // cleanup, if the animation event never comes
  for (const ev of ['keydown', 'pointerdown']) addEventListener(ev, leaveSplash);
}
// Live getters (Object.assign would copy today's values, not the getters).
Object.defineProperties(dbg, {
  world: { get: () => world },
  river: { get: () => river },
  focus: { get: () => focus },
  camYaw: { get: () => camYaw },
  cam: { get: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z, tx: camTarget.x, ty: camTarget.y, tz: camTarget.z, fov: camera.fov }) },
});
