// Wire format. JSON text messages; the race itself is just inputs.
//
// The server runs the authoritative sim and stamps every river's steer into
// numbered frames. Each client runs the same deterministic sim on those frames,
// so positions never travel the wire and a reconnect is a replay of the log.
//
// client -> server
//   { t: 'hello', token?, name? }       join (token resumes a seat)
//   { t: 'in', s, f?, k?, u? }          steer -1 | 0 | 1; f: hurry +1 / slow -1 the drop; k: 1 Gouge, u: 1 Surge pressed
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
const DECODE = new Map();
for (let f = -1; f <= 1; f++) for (let s = -1; s <= 1; s++) {
  DECODE.set(CHARS[f + 1][s + 1], f ? { s, f } : s);
  DECODE.set(SKILL[f + 1][s + 1], { s, f, k: 1 });
  DECODE.set(SURGE[f + 1][s + 1], { s, f, u: 1 });
}

const unit = (v) => Math.max(-1, Math.min(1, v | 0));

// steers: id -> steer number or { s, f, k }.
export function encodeFrame(ids, steers) {
  let out = '';
  for (const id of ids) {
    const v = steers.get(id), o = v && typeof v === 'object';
    const s = unit(o ? v.s : v), f = unit(o ? v.f : 0);
    out += (o && v.k ? SKILL : o && v.u ? SURGE : CHARS)[f + 1][s + 1];
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
