// Wire format. JSON text messages; the race itself is just inputs.
//
// The server runs the authoritative sim and stamps every river's steer into
// numbered frames. Each client runs the same deterministic sim on those frames,
// so positions never travel the wire and a reconnect is a replay of the log.
//
// client -> server
//   { t: 'hello', token?, name? }       join (token resumes a seat)
//   { t: 'in', s, f?, g?, k?, u? }      steer -1 | 0 | 1; f: hurry +1 / slow -1 the fall; g: glide faster +1 / slower -1; k: 1 Gouge, u: 1 Surge pressed
//   { t: 'fp', k, fp }                  sim fingerprint after tick k
// server -> client
//   { t: 'welcome', token, id }
//   { t: 'lobby', players, startsIn }   seconds until the race starts
//   { t: 'start', seed, ids, names, you, log }   log: frames already played
//   { t: 'f', k, i }                    frame for tick k; i: one char per id (steer x forward x skill)
//   { t: 'end', standings }             ids, best first
//   { t: 'resync' }                     fingerprint mismatch: say hello again

// One char per river: steer (-1, 0, 1) by forward (-1, 0, 1), and the same nine
// in capitals with the skill pressed. The f = 0 row is the old '-0+' so a frame
// of plain steering reads the same.
const CHARS = ['abc', '-0+', 'xyz'];
const SKILL = ['ABC', 'DEF', 'XYZ'];
const SURGE = ['GHI', 'JKL', 'MNO']; // the second skill, Surge (a frame carries one skill press)
// Falling, the left stick's up / down glides faster or slower (g): g = 0 is the
// table above, g = -1 / +1 take 27 more chars each from this pool.
const POOL = 'defghijklmnopqrstuvwPQRSTUVW123456789!#$%&()*,./:;<=>?@[]^_{|}~';
const ENCODE = new Map(), DECODE = new Map();
let next = 0;
for (const g of [0, -1, 1]) for (const kind of ['', 'k', 'u']) for (let f = -1; f <= 1; f++) for (let s = -1; s <= 1; s++) {
  const ch = g ? POOL[next++] : (kind === 'k' ? SKILL : kind === 'u' ? SURGE : CHARS)[f + 1][s + 1];
  const v = { s, f };
  if (kind) v[kind] = 1;
  if (g) v.g = g;
  ENCODE.set(`${s},${f},${g},${kind}`, ch);
  DECODE.set(ch, !kind && !g && !f ? s : v);
}

const unit = (v) => Math.max(-1, Math.min(1, v | 0));

// steers: id -> steer number or { s, f, k }.
export function encodeFrame(ids, steers) {
  let out = '';
  for (const id of ids) {
    const v = steers.get(id), o = v && typeof v === 'object';
    const s = unit(o ? v.s : v), f = unit(o ? v.f : 0), g = unit(o ? v.g : 0);
    out += ENCODE.get(`${s},${f},${g},${o && v.k ? 'k' : o && v.u ? 'u' : ''}`);
  }
  return out;
}

export function decodeFrame(ids, chars) {
  const m = new Map();
  for (let i = 0; i < ids.length; i++) m.set(ids[i], DECODE.get(chars[i]) ?? 0);
  return m;
}

export const FP_EVERY = 100; // ticks between fingerprint checks
export const FINISH_WINDOW = 20 * 180; // ticks the race runs on after the first river reaches the sea
