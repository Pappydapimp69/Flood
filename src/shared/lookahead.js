// Look-ahead river: a planning agent that tries each steering choice in a copy
// of the world and takes the one that ends nearest the beach. It is a measuring
// stick, not a rival to ship: it sees the whole sim, which no player can, but it
// only plans 8 s ahead, greedily, and takes its rivals for unsteered, so what it
// wins by is the least steering is worth, not the most (tools/skill-gap.mjs).
// Deterministic: the sim is, and it draws no randomness.

import { step, cellIndex, isRacing, TICK_HZ } from './river.js';

// every: ticks between decisions. hold: ticks a trial keeps its steer before
// letting go. horizon: ticks each trial runs. rivals: what the others do in a
// trial ('still' = never steer; they are only scenery to the plan).
export const TUNE_LOOK = { every: TICK_HZ, hold: TICK_HZ, horizon: 8 * TICK_HZ, plans: [0, -1, 1, -2, 2] };

export function createLookahead(world, river, tune = {}) {
  return { river, tune: { ...TUNE_LOOK, ...tune }, next: 0, steer: 0, hold: 0, trials: 0 };
}

// Metres of water route left to the beach; a finished river counts its spare
// ticks as distance so sooner beats later, and a drained one is worst of all.
function left(world, r, endTick) {
  if (r.out) return 1e9;
  if (r.finished) return -(endTick - r.finishTick) * 100;
  const d = world.toBeach[cellIndex(world.terrain, r.x, r.z)];
  return d < 1e8 ? d : 1e8;
}

// One trial: steer `s` for `hold` ticks (|plan| 2 = for the whole trial), then hands off.
function trial(world, id, plan, tune) {
  const w = structuredClone(world), me = w.rivers.find((r) => r.id === id);
  const s = Math.sign(plan), held = Math.abs(plan) > 1 ? tune.horizon : tune.hold, end = w.tick + tune.horizon;
  for (let k = 0; k < tune.horizon && isRacing(me); k++) step(w, new Map([[id, k < held ? s : 0]]));
  return left(w, me, end);
}

export function lookaheadSteer(world, agent) {
  const r = agent.river, tune = agent.tune;
  if (!isRacing(r) || r.dropping) return 0; // falling: hands off, like the rivers it is measured against
  if (world.tick >= agent.next) {
    let best = Infinity, pick = 0;
    for (const plan of tune.plans) { // first listed wins a tie: straight on unless a turn is strictly better
      const d = trial(world, r.id, plan, tune);
      agent.trials++;
      if (d < best) { best = d; pick = plan; }
    }
    agent.steer = Math.sign(pick);
    agent.hold = world.tick + (Math.abs(pick) > 1 ? tune.every : Math.min(tune.every, tune.hold));
    agent.next = world.tick + tune.every;
  }
  return world.tick < agent.hold ? agent.steer : 0;
}
