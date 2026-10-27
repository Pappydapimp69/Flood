import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startServer } from '../../src/server/server.mjs';
import { Room } from '../../src/server/room.js';
import { generateIsland } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, riverFingerprint } from '../../src/shared/river.js';
import { decodeFrame, FP_EVERY, FINISH_WINDOW } from '../../src/shared/protocol.js';

// A test client: collects messages, can wait for one matching a predicate.
function client(port, hello = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const msgs = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    msgs.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const ready = new Promise((r) => ws.on('open', r)).then(() => ws.send(JSON.stringify({ t: 'hello', ...hello })));
  const wait = (pred, ms = 8000) => {
    const hit = msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error('timed out waiting for message')), ms).unref();
    });
  };
  return { ws, msgs, ready, wait, send: (o) => ws.send(JSON.stringify(o)), close: () => ws.close() };
}

// Re-run a client's view of the race from start + frames, like the browser does.
function replay(start, frames) {
  const w = createWorld(generateIsland(start.seed));
  for (const id of start.ids) addRiver(w, id, undefined, { drop: true }); // as the room does
  const prints = new Map();
  for (const f of frames) {
    step(w, decodeFrame(start.ids, f));
    if (w.tick % FP_EVERY === 0) prints.set(w.tick, riverFingerprint(w));
  }
  return prints;
}

test('two players race; their replays match the server tick for tick', async () => {
  const room = new Room({ seed: 7, opts: { lobbyMs: 300 } });
  const srv = await startServer({ port: 0, host: '127.0.0.1', room });
  try {
    const a = client(srv.port, { name: 'Ann' }), b = client(srv.port, { name: '<b>Bo</b>' });
    await Promise.all([a.ready, b.ready]);
    const sa = await a.wait((m) => m.t === 'start');
    const sb = await b.wait((m) => m.t === 'start');
    assert.deepEqual(sa.ids, sb.ids);
    assert.equal(sa.ids.length, 12, 'bots fill the room to 12');
    assert.notEqual(sa.you, sb.you);
    assert.equal(sb.names[sb.you], 'bBob', 'markup characters are stripped');
    a.send({ t: 'in', s: -1 });
    b.send({ t: 'in', s: 7 }); // invalid: ignored
    await a.wait((m) => m.t === 'f' && m.k >= 2 * FP_EVERY + 5, 20000);
    const frames = a.msgs.filter((m) => m.t === 'f').map((m) => m.i);
    const mine = replay(sa, frames);
    for (const k of [FP_EVERY, 2 * FP_EVERY]) assert.equal(mine.get(k), room.prints.get(k), `tick ${k}`);
    // a steered left at some point; b's invalid input left it at 0.
    const ia = sa.ids.indexOf(sa.you), ib = sa.ids.indexOf(sb.you);
    assert.ok(frames.some((f) => f[ia] === '-'));
    assert.ok(frames.every((f) => f[ib] === '0'));
    a.close(); b.close();
  } finally {
    srv.close();
  }
});

test('a dropped player rejoins with its token and gets the whole race replayed', async () => {
  const room = new Room({ seed: 3, opts: { lobbyMs: 200 } });
  const srv = await startServer({ port: 0, host: '127.0.0.1', room });
  try {
    const a = client(srv.port);
    await a.ready;
    const welcome = await a.wait((m) => m.t === 'welcome');
    const start = await a.wait((m) => m.t === 'start');
    await a.wait((m) => m.t === 'f' && m.k >= 40);
    a.ws.terminate();
    const again = client(srv.port, { token: welcome.token });
    await again.ready;
    const resumed = await again.wait((m) => m.t === 'start');
    assert.equal(resumed.you, start.you, 'got the same seat');
    assert.ok(resumed.log.length >= 40, 'log replays the race so far');
    const stranger = client(srv.port, { token: 'not-a-real-token' });
    await stranger.ready;
    const watch = await stranger.wait((m) => m.t === 'start');
    assert.equal(watch.you, null, 'unknown token spectates, never takes a seat');
    again.close(); stranger.close();
  } finally {
    srv.close();
  }
});

test('a wrong fingerprint gets a resync', async () => {
  const room = new Room({ seed: 5, opts: { lobbyMs: 200 } });
  const srv = await startServer({ port: 0, host: '127.0.0.1', room });
  try {
    const a = client(srv.port);
    await a.ready;
    await a.wait((m) => m.t === 'f' && m.k >= FP_EVERY + 2, 15000);
    a.send({ t: 'fp', k: FP_EVERY, fp: 'deadbeef' });
    await a.wait((m) => m.t === 'resync');
    a.close();
  } finally {
    srv.close();
  }
});

test('a race ends at most 90 s after the first river reaches the sea', () => {
  const sent = [];
  const conn = { send: (m) => sent.push(m), close() {} };
  const room = new Room({ seed: 42, opts: { lobbyMs: 0 } });
  room.hello(conn, {});
  room.start();
  while (room.state === 'race') room.tickRace();
  const end = sent.find((m) => m.t === 'end');
  assert.ok(end, 'no end message');
  assert.equal(end.standings.length, 12);
  assert.ok(room.firstFinish >= 0, 'nobody finished');
  assert.ok(room.world.tick - room.firstFinish <= FINISH_WINDOW + 1, `ran ${room.world.tick - room.firstFinish} ticks past the first finish`);
});
