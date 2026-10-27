// Seeded, integer-only randomness. Shared by client and (later) server, so
// nothing here may use transcendental Math — those differ across runtimes.

// sfc32: four 32-bit state words. Save/restore the words, not a draw count.
export function sfc32(a, b, c, d) {
  const s = new Uint32Array([a, b, c, d]);
  const next = () => {
    const t = (((s[0] + s[1]) | 0) + s[3]) | 0;
    s[3] = (s[3] + 1) | 0;
    s[0] = s[1] ^ (s[1] >>> 9);
    s[1] = (s[2] + (s[2] << 3)) | 0;
    s[2] = (s[2] << 21) | (s[2] >>> 11);
    s[2] = (s[2] + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  next.state = () => Array.from(s);
  next.restore = (w) => s.set(w);
  return next;
}

// Stream keyed by a stable name, so adding a consumer never shifts another.
export function stream(seed, name) {
  let h = hashStr(name);
  const r = sfc32(seed >>> 0, h, hash2(seed, h), 0x9e3779b9);
  for (let i = 0; i < 12; i++) r();
  return r;
}

export function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// Integer lattice hash -> [0, 1).
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
