// Course map: a picture of one island from above, to check a course's shape by eye.
// Hillshaded ground, sea, lakes (blue), the course mask's edge (dark), the start ring cells (red),
// the start line (yellow) and the finish beach (gold).
// Usage: node tools/course-map.mjs [--course summit] [--out file.ppm] <seed>
import { writeFileSync } from 'node:fs';
import { generateIsland, SEA_LEVEL } from '../src/shared/terrain.js';
import { createWorld, spawnBand, startLine } from '../src/shared/river.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i < 0 ? def : args.splice(i, 2)[1]; };
const course = opt('course', undefined), out = opt('out', 'course.ppm');
const seed = Number(args[0] ?? 1);
const t = generateIsland(seed, course ? { course } : {});
const w = createWorld(t, { forest: false, lava: false });
const n = t.size, band = spawnBand(w), line = startLine(w), ring = new Set(band.ring), fair = new Set(band.cells);
const px = Buffer.alloc(n * n * 3);
let peak = 1;
for (let k = 0; k < n * n; k++) peak = Math.max(peak, t.height[k]);
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
  const k = y * n + x, h = t.filled[k];
  let c;
  if (h <= SEA_LEVEL) c = w.beach?.[k] ? [230, 190, 60] : [20, 50, 90];
  else {
    const gx = t.height[Math.min(k + 1, n * n - 1)] - t.height[Math.max(k - 1, 0)], gy = t.height[Math.min(k + n, n * n - 1)] - t.height[Math.max(k - n, 0)];
    const shade = Math.max(0.25, Math.min(1.2, 0.8 - (gx + gy) / (4 * t.cell) * 3));
    const e = t.height[k] / peak;
    c = [90 + 120 * e, 120 + 90 * e, 70 + 80 * e].map((v) => v * shade);
    if (t.filled[k] - t.height[k] > 2) c = [60, 120, 200];
    if (t.mask && !t.mask[k]) c = c.map((v) => v * 0.55);
    if (line.set.has(k)) c = [255, 240, 0];
    if (ring.has(k)) c = fair.has(k) ? [255, 40, 40] : [160, 40, 40];
  }
  px.set(c.map((v) => Math.max(0, Math.min(255, v | 0))), k * 3);
}
writeFileSync(out, Buffer.concat([Buffer.from(`P6 ${n} ${n} 255\n`), px]));
console.log(`${out}: seed ${t.seed}${course ? ` (${course})` : ''}, start line ${(line.L / 1000).toFixed(1)} km by water to the beach, ${band.cells.length} fair start cells in ${band.groups.length} groups`);
