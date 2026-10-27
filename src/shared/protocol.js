// Wire format. JSON text messages; the race itself is just inputs.
//
// The server runs the authoritative sim and stamps every river's steer into
// numbered frames. Each client runs the same deterministic sim on those frames,
// so positions never travel the wire and a reconnect is a replay of the log.
//
// client -> server
//   { t: 'hello', token?, name? }       join (token resumes a seat)
//   { t: 'in', s }                      steer -1 | 0 | 1
//   { t: 'fp', k, fp }                  sim fingerprint after tick k
// server -> client
//   { t: 'welcome', token, id }
//   { t: 'lobby', players, startsIn }   seconds until the race starts
//   { t: 'start', seed, ids, names, you, log }   log: frames already played
//   { t: 'f', k, i }                    frame for tick k; i: one char per id
//   { t: 'end', standings }             ids, best first
//   { t: 'resync' }                     fingerprint mismatch: say hello again

export const STEER_CHARS = { '-1': '-', 0: '0', 1: '+' };
export const CHAR_STEER = { '-': -1, 0: 0, '+': 1 };

export function encodeFrame(ids, steers) {
  let s = '';
  for (const id of ids) s += STEER_CHARS[steers.get(id) | 0];
  return s;
}

export function decodeFrame(ids, chars) {
  const m = new Map();
  for (let i = 0; i < ids.length; i++) m.set(ids[i], CHAR_STEER[chars[i]] ?? 0);
  return m;
}

export const FP_EVERY = 100; // ticks between fingerprint checks
export const FINISH_WINDOW = 20 * 90; // ticks the race runs on after the first river reaches the sea
