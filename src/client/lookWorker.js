// The look-ahead rival's thinking, off the main thread: it gets a copy of the
// world, tries each steer in copies of that (src/shared/lookahead.js) and
// answers with the best. Solo only (?rival=look): its answer arrives when it
// arrives, so it is not part of the deterministic lockstep.
import { createLookahead, lookaheadSteer } from '../shared/lookahead.js';

onmessage = (e) => {
  const { world, id, race } = e.data;
  let steer = 0;
  try { steer = lookaheadSteer(world, createLookahead(world, world.rivers.find((r) => r.id === id))); } catch { /* an unplannable moment: hands off */ }
  postMessage({ race, steer });
};
