// Noise and easing shared by the island generators. Deterministic, no transcendental Math.
import { hash2 } from './rng.js';

export const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = fade(x - xi), v = fade(y - yi);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fbm(x, y, seed, octaves) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, seed + o * 1013);
    norm += amp;
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.7;
    amp *= 0.5;
  }
  return sum / norm;
}

export function ridged(x, y, seed, octaves) {
  let sum = 0, amp = 0.5, norm = 0, prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(2 * valueNoise(x, y, seed + o * 7919) - 1);
    n *= n;
    sum += amp * n * prev;
    norm += amp;
    prev = n;
    x = x * 2.11 + 3.3;
    y = y * 2.11 + 41.9;
    amp *= 0.5;
  }
  return sum / norm;
}

