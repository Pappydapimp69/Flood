// Wire format. JSON text messages; the race itself is just inputs.
//
// The server runs the authoritative sim and stamps every river's steer into
// numbered frames. Each client runs the same deterministic sim on those frames,
// so positions never travel the wire and a reconnect is a replay of the log.
//
// client -> server
//   { t: 'hello', token?, name? }       join (token resumes a seat)
//   { t: 'in', s, f? }                  steer -1 | 0 | 1; f: hurry +1 / slow -1 the drop
//   { t: 'fp', k, fp }                  sim fingerprint after tick k
// server -> client
//   { t: 'welcome', token, id }
//   { t: 'lobby', players, startsIn }   seconds until the race starts
//   { t: 'start', seed, ids, names, you, log }   log: frames already played
//   { t: 'f', k, i }                    frame for tick k; i: one char per id (steer x forward)
//   { t: 'end', standings }             ids, best first
//   { t: 'resync' }                     fingerprint mismatch: say hello again

// One char per river: steer (-1, 0, 1) by forward (-1, 0, 1). The f = 0 row is
// the old '-0+' so a frame of plain steering reads the same.
const CHARS = ['abc', '-0+', 'xyz'];
const DECODE = new Map();
for (let f = -1; f <= 1; f++) for (let s = -1; s <= 1; s++) DECODE.set(CHARS[f + 1][s + 1], f ? { s, f } : s);

const unit = (v) => Math.max(-1, Math.min(1, v | 0));

// steers: id -> steer number or { s, f }.
export function encodeFrame(ids, steers) {
  let out = '';
  for (const id of ids) {
    const v = steers.get(id);
    const s = unit(v && typeof v === 'object' ? v.s : v), f = unit(v && typeof v === 'object' ? v.f : 0);
    out += CHARS[f + 1][s + 1];
  }
  return out;
}

export function decodeFrame(ids, chars) {
  const m = new Map();
  for (let i = 0; i < ids.length; i++) m.set(ids[i], DECODE.get(chars[i]) ?? 0);
  return m;
}

export const FP_EVERY = 100; // ticks between fingerprint checks
export const FINISH_WINDOW = 20 * 90; // ticks the race runs on after the first river reaches the sea
