// One race room: lobby -> race -> results -> lobby. Transport-free, so tests can
// drive it with fake connections. A connection is { send(obj), close() }.

import { randomBytes } from 'node:crypto';
import { generateIsland } from '../shared/terrain.js';
import { createWorld, addRiver, step, isRacing, standings, riverFingerprint, TICK_HZ } from '../shared/river.js';
import { createBot, botSteer } from '../shared/bot.js';
import { encodeFrame, FP_EVERY, FINISH_WINDOW } from '../shared/protocol.js';

export const ROOM = {
  minRivers: 12, // bots fill up to this
  maxPlayers: 16, // one island reads best at 12-16 rivers (Brain tension on lobby size)
  lobbyMs: 8000, // wait after the first player joins
  resultsMs: 8000,
  maxTicks: TICK_HZ * 600, // hard cap on a race
};

const cleanName = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 12);

export class Room {
  constructor({ now = () => Date.now(), seed, opts = {} } = {}) {
    this.cfg = { ...ROOM, ...opts };
    this.now = now;
    this.fixedSeed = seed;
    this.seats = new Map(); // token -> { id, name, conn, held, pulse }
    this.state = 'lobby';
    this.lobbyEnds = 0;
    this.nextId = 1;
  }

  // --- connections -------------------------------------------------------

  hello(conn, msg = {}) {
    let seat = msg.token && this.seats.get(msg.token);
    if (seat) {
      if (seat.conn && seat.conn !== conn) seat.conn.close(); // newest tab wins the seat
      seat.conn = conn;
    } else {
      if (this.seats.size >= this.cfg.maxPlayers * 2) return conn.close(); // spectator cap
      const token = randomBytes(16).toString('hex');
      seat = { token, id: null, name: cleanName(msg.name), conn, held: 0, pulse: 0 };
      this.seats.set(token, seat);
    }
    conn.seat = seat;
    conn.send({ t: 'welcome', token: seat.token, id: seat.id });
    if (this.state === 'race') this.sendStart(seat);
    else this.touchLobby();
  }

  leave(conn) {
    const seat = conn.seat;
    if (!seat || seat.conn !== conn) return;
    seat.conn = null;
    seat.held = 0; // a dropped player's river keeps flowing, unsteered
    seat.fwd = 0;
    // Seats never raced in can go; racers keep theirs for a reconnect.
    if (!seat.id || this.state !== 'race') this.seats.delete(seat.token);
  }

  input(conn, msg) {
    const seat = conn.seat;
    if (!seat || !seat.id) return;
    const s = msg.s;
    if (s !== -1 && s !== 0 && s !== 1) return;
    const f = msg.f ?? 0;
    if (f !== -1 && f !== 0 && f !== 1) return;
    seat.held = s;
    seat.fwd = f;
    if (s) seat.pulse = s; // a tap shorter than a tick still turns once
  }

  fingerprint(conn, msg) {
    if (this.state !== 'race' || !Number.isInteger(msg.k)) return;
    const mine = this.prints.get(msg.k);
    if (mine && mine !== msg.fp) conn.send({ t: 'resync' });
  }

  // --- lobby ---------------------------------------------------------------

  touchLobby() {
    if (this.state !== 'lobby') return;
    const players = [...this.seats.values()].filter((s) => s.conn).length;
    if (!this.lobbyEnds && players) this.lobbyEnds = this.now() + this.cfg.lobbyMs;
    const startsIn = Math.max(0, Math.ceil((this.lobbyEnds - this.now()) / 1000));
    this.broadcast({ t: 'lobby', players, startsIn });
  }

  // --- race ----------------------------------------------------------------

  start() {
    const humans = [...this.seats.values()].filter((s) => s.conn).slice(0, this.cfg.maxPlayers);
    for (const s of humans) s.id = `p${String(this.nextId++).padStart(3, '0')}`;
    const nBots = Math.max(0, this.cfg.minRivers - humans.length);
    const botIds = Array.from({ length: nBots }, (_, i) => `bot${String(i + 1).padStart(2, '0')}`);
    this.ids = [...humans.map((s) => s.id), ...botIds].sort();
    this.names = Object.fromEntries(humans.map((s) => [s.id, s.name || s.id]));
    this.seed = this.fixedSeed ?? 1 + (randomBytes(4).readUInt32LE(0) % 1_000_000);
    this.world = createWorld(generateIsland(this.seed));
    for (const id of this.ids) addRiver(this.world, id, undefined, { drop: true });
    this.bots = this.world.rivers.filter((r) => botIds.includes(r.id)).map((r) => createBot(this.world, r));
    this.byId = new Map(humans.map((s) => [s.id, s]));
    this.log = [];
    this.prints = new Map();
    this.firstFinish = -1;
    this.state = 'race';
    this.lobbyEnds = 0;
    for (const seat of this.seats.values()) if (seat.conn) this.sendStart(seat);
  }

  sendStart(seat) {
    seat.conn.send({ t: 'start', seed: this.seed, ids: this.ids, names: this.names, you: seat.id, log: this.log });
  }

  tickRace() {
    const w = this.world;
    const steers = new Map();
    for (const id of this.ids) {
      const seat = this.byId.get(id);
      if (!seat) continue;
      const st = seat.held || seat.pulse;
      steers.set(id, seat.fwd ? { s: st, f: seat.fwd } : st);
      seat.pulse = 0;
    }
    for (const b of this.bots) steers.set(b.river.id, botSteer(w, b));
    const frame = { t: 'f', k: w.tick, i: encodeFrame(this.ids, steers) };
    step(w, steers);
    this.log.push(frame.i);
    this.broadcast(frame);
    if (w.tick % FP_EVERY === 0) this.prints.set(w.tick, riverFingerprint(w));
    if (this.firstFinish < 0 && w.rivers.some((r) => r.finished)) this.firstFinish = Math.min(...w.rivers.filter((r) => r.finished).map((r) => r.finishTick));
    const windowUp = this.firstFinish >= 0 && w.tick - this.firstFinish >= FINISH_WINDOW;
    if (!w.rivers.some(isRacing) || windowUp || w.tick >= this.cfg.maxTicks) this.end();
  }

  end() {
    this.broadcast({ t: 'end', standings: standings(this.world).map((r) => r.id) });
    this.state = 'results';
    this.resultsEnd = this.now() + this.cfg.resultsMs;
  }

  // Called on a timer. Advances whatever phase the room is in.
  update() {
    if (this.state === 'lobby') {
      if (this.lobbyEnds && this.now() >= this.lobbyEnds) this.start();
      else if (this.lobbyEnds) {
        const left = Math.ceil((this.lobbyEnds - this.now()) / 1000);
        if (left !== this.lastCount) { this.lastCount = left; this.touchLobby(); }
      }
    } else if (this.state === 'results' && this.now() >= this.resultsEnd) {
      this.state = 'lobby';
      for (const [token, seat] of this.seats) {
        seat.id = null;
        if (!seat.conn) this.seats.delete(token);
      }
      this.touchLobby();
    }
  }

  broadcast(msg) {
    for (const seat of this.seats.values()) seat.conn?.send(msg);
  }
}
