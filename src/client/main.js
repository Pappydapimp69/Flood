import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateIsland, stats, fingerprint } from '../shared/terrain.js';
import { buildTerrainMesh, buildSea, buildSeabed } from './terrainMesh.js';

// Test/debug surface. Tests poll this instead of waiting on wall-clock time.
const dbg = (window.__flood = { ready: false, error: null, frames: 0 });

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || 1;

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
scene.fog = new THREE.Fog(SKY, 40000, 160000);

const terrain = generateIsland(seed);
const W = terrain.worldSize;

scene.add(buildTerrainMesh(terrain));
scene.add(buildSeabed(terrain));
scene.add(buildSea(W));
scene.add(new THREE.HemisphereLight('#dbeaf5', '#5b5040', 1.1));
const sun = new THREE.DirectionalLight('#fff3dc', 2.2);
sun.position.set(-W * 0.6, W * 0.5, -W * 0.3);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 50, 400000);
camera.position.set(W * 0.55, W * 0.55, W * 0.75);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = 1.45;
controls.minDistance = 2000;
controls.maxDistance = W * 2.5;
controls.update();

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const s = stats(terrain);
document.getElementById('seed').textContent = `seed ${seed}`;
Object.assign(dbg, { seed, fingerprint: fingerprint(terrain), stats: s, renderer, scene, camera });

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  dbg.frames++;
  dbg.calls = renderer.info.render.calls;
  if (dbg.frames === 2) dbg.ready = true;
});
