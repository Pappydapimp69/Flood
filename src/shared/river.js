// River simulation. Authoritative, fixed-tick, shared by client and server.
// Rules: no transcendental Math; integer steering input; render never writes here.

import { SEA_LEVEL, downhill, findLakes, MinHeap, generateIsland } from './terrain.js';
import { stream } from './rng.js';
import { plantForest } from './forest.js';

export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;

export const TUNE = {
  turnStep: 0.06, // radians per tick at full steer, at starting size
  minSpeed: 18, // m/s, water always creeps
  landCarry: 0.8, // share of the drop's glide speed the river keeps on landing (was none: landing was a hard brake)
  baseSpeed: 55, // m/s on level ground at starting size
  slopeSpeed: 1800, // m/s lost per unit of uphill slope (climbing)
  // Downhill, speed levels off instead of rising with steepness (T181, owner
  // 2026-11-06): extra speed = satSpeed * (1 - e^(-slope / satSlope)).
  satSpeed: 90, satSlope: 0.015,
  climbDrag: 0.03, // share of speed a climb takes per tick at a 5% rise, boosted or not
  maxSpeed: 240,
  speedEase: 0.2, // share of the way to target speed per tick, at starting size, speeding up (was 0.12: regaining speed felt slow)...
  slowEase: 0.03, // ...and slowing down (divided by size): carried speed halves in about 1.1 s, not 0.27 s
  climb: 1.5, // metres any head can rise over before it is blocked, before its head height
  headPerSize: 2, // metres the water stands at the head per unit of size: what it can push over
  headLook: 150,
  climbSpeed: 40, // m/s: below this a head aimed uphill can't run up the slope // metres ahead a rise is judged against the head // metres the head may sit above the lowest point it has reached
  bankCut: 1.5, // metres a head on a lake cuts into the bank it's pushing on, per tick, times size
  // (fast: with lakes full, a slow cut held heads against banks for a quarter of their slow time)
  cutMax: 40, // metres above the lake, times size: the highest rim a head can cut through
  cutTicks: 120, // a bank still not cut through after 6 s: make for the lake's lowest exit
  pool: 0.15, // metres a stuck head's water rises per tick, times size: the hollow fills, then spills
  slideMin: 0.15,
  flatSlope: 0.004, // below this the ground counts as flat: follow the fill's route out
  fallSlope: 0.04, // slope (m per m) at which the fall line pulls the water at full strength
  fallDrift: 0.15, // aimed downhill or across: how much the slope pulls the water down
  fallUphill: 0.6, // aimed uphill: how much it pulls the water down once the uphill part is gone // heading share along the contour needed to slide past a slope
  width: 110, // channel width at starting size, metres
  depth: 7, // channel depth at starting size, metres
  maxWidth: 420,
  // Mass. Volume is in litres; size = (volume / start) ^ 1/4. More mass: more
  // momentum (slower to speed up, slow down and turn), faster flow, deeper cuts.
  startVolume: 500_000,
  trickle: 25, // litres gained per metre of trail at the start...
  trickleGrowth: 4000, // ...and more per metre the longer the river already is: x(1 + length / this). A river drains
  // more land the longer it gets (Hack's law: area grows about as length squared), so its gain per metre grows with length.
  speedPerSize: 0.1, // speed multiplier gained per unit of size above 1: twice the size, +10% (real rivers barely speed up as they grow: T175, owner 2026-11-06)
  // Lakes are reservoirs. They hold still until water flows in: every river
  // pouring in raises the level (its own volume holds while its head is in).
  // A river leaving cuts an outlet as deep as its head; water over that lip
  // drains out to it (weir law, head^1.5, times outlet width) and erodes the
  // outlet deeper, slower as it deepens. Above its rim a lake spills into an
  // ownerless channel that dries up once the level drops back.
  lakeBase: 120_000, // capacity of any lake, litres...
  lakePerCell: 25_000, // ...plus this per lake cell...
  lakeCellCap: 400, // ...counting at most this many cells
  lakeStart: 0.95, // every lake starts this full
  discharge: 3000, // litres per tick a river delivers downstream, times size squared
  outletK: 3000, // litres per tick an outlet carries at 1 m of water over its lip, starting width
  erodeK: 0.002, // metres an outlet erodes per tick, per metre of water over its lip, times the river's size
  outletMax: 40, // metres: most water over a lip that counts
  outletDrain: 4, // metres below its starting level an outlet can ever drain a lake: lakes stay lakes
  spillK: 4000, // litres per tick a lake spills at 1 m over its rim
  spillDepth: 2, // metres a spill cuts its channel (it never erodes)
  spillWidth: 50, // metres
  spillCells: 160, // longest spill channel, cells
  shallowWater: 0.3, // metres of standing water that count as under water (no digging)
  levelGlide: 0.99, // on level water or flats, carried speed fades this much per tick: halves in about 3.5 s (owner: it carried too long)
  joinShare: 0, // nothing taken at once on joining: only what flows out is added
  fullAt: 0.999, // a lake this full is level ground you flow across
  maxPoolTicks: 200, // guaranteed exit: after 10 s pooled, the basin tops up and spills
  trailErode: 0.0004, // metres a channel tile erodes per tick, per metre of water over it, times size...
  slopeErode: 0.04, // ...and once more for every this much slope (steep ground cuts canyons)
  trailPasses: 20, // ticks between outlet recuts
  headSpared: 4, // path points nearest the head that pulses don't erode
  stuckNet: 4, // metres: moved less than this in stuckTicks, it's stuck...
  stuckTicks: 6, // ...(0.3 s)...
  stuckWear: 0.5, // ...and wears the ground the way it's pushing down this many metres a tick, times size...
  stuckWearCells: 3, // ...this many cells out along its heading
  stuckWearMax: 40, // metres the ground can be worn down
  // A skill presses through (owner: skills are power and choice): blocked while boosted or surging, the head
  // holds its heading and wears the rise ahead down this many metres a tick, times size (Surge half), up to pressWearMax.
  pressWear: 4, pressWearMax: 90,
  beachRadius: 3000, // metres of coast either side of where the slope meets the sea: the one finish
  seaCurrent: 150, // m/s: the current that carries a river off the wrong coast along to the beach
  // Gouge, a skill: the head rears up and slams down, and for gougeBoost the
  // water can run over ground far higher than it normally can, uphill where
  // it's aimed, without the climb bleeding its speed. It never stops the head
  // (owner, 2026-11-03: no wind-up pause, so T188 is moot), and it spends water.
  gougeAdd: 1.5, // times base speed Gouge adds on top of the speed the head already has
  gougeFloor: 140, // ...and at least this many m/s for the whole boost, from a standstill too; climbs can't drain it below
  gougeGrow: 0.5, // size it adds for the boost (a taller, deeper head; gone when the boost ends)
  gougeBoost: 60, // ticks the boost lasts (3 s)
  gougeLift: 80, // metres higher than usual the head can pass over while boosted
  gougeRise: 2, // metres: a bot presses it only for a rise at least this far above what it can climb...
  gougeLook: 4, // ...within this many cells along its heading
  gougeShare: 0.1, // share of the river's volume each gouge spends...
  gougeMinCost: 80_000, // ...but never less than this many litres
  gougeKeep: 0.5, // share of the starting volume a river must keep after paying
  gougeCool: 240, // ticks from one gouge to the next (12 s; owner +1 s twice)
  lakeJunctions: false, // waves end at lakes, shared over every outlet (off: 4 test races went 7.5 -> 4.5 finishes, first finish 97 -> 204 s)
  rockBelow: 1000, // the summit is rock down to this far below the start line: no erosion there (owner)
  gougeDeepen: 0.05, // each gouge deepens the river's whole channel by this share (owner, 2026-11-09)
  gougeSizeCost: false, // experiment: cost share x size (big rivers pay more)
  // Surge, the second skill: a short wind-up, then
  // a burst of speed on the flat; costs water, its own cooldown.
  surgeOn: true,
  surgeTicks: 40, // ticks of burst (2 s)
  surgeAdd: 2, // times base speed Surge adds on top of the speed the head already has
  surgeFloor: 110, // ...and at least this many m/s while it lasts
  surgeShare: 0.08, // share of volume each surge spends (min gougeMinCost)
  surgeCool: 180, // ticks from one surge to the next (9 s; owner +1 s)
  lakeCoolPer: 0.001, lakeCoolLitres: 10_000, lakeCoolMin: 0.25, // lakes are buffs: cooldowns 0.1% shorter per 10k L of lake water taken in (never under a quarter)
  // Skills unlock as a river grows (litres; once unlocked, kept), and share one
  // cooldown: using either restarts it for both, at the length of the one used.
  surgeUnlock: 1_200_000,
  gougeUnlock: 1_500_000,
  // Comeback experiments (off by default).
  stormAim: 'pack', // 'pack': storms blow in just ahead of the middle of the field; 'tail': over its back
  catchUp: 0, // extra trickle share for rivers more than catchUpGap behind the leader
  catchUpGap: 3000, // metres behind the leader that count as far behind
  tailUnlock: true, // far behind, Surge unlocks whatever your size
  massEase: 0.04, // share of the way a river's momentum moves to its new size each tick
  stallTicks: 20, stallMin: 30, stallNet: 0.35,
  routeHold: 10, // ticks a head keeps to the way out once it takes it
  pairHold: 20, // ticks a pair's water keeps running one way before it may turn round // moved over 30 m in 1 s but under 35% of it net: going nowhere
  routeDrop: 1.5, // metres a head following the fill route must fall before it goes back to its heading // path points nearest the head that don't erode // ticks to sweep a whole trail once (a slice of it each tick)
  // Dry basins: a few lakes start empty and must be filled by the rivers that
  // run into them before anyone can flow across.
  basins: 0, // no dry basins: every lake on the map is full
  basinMinCells: 15,
  basinMaxCells: 260,
  // The drop: every river falls for 30 s from high above the island, steering
  // (turn, and faster or slower) to choose where it lands. It lands on the
  // nearest cell of the start contour: every start is at the same elevation.
  dropTicks: 1600, // a fall at the steady rate lasts this long (80 s)...
  dropAlt: 6000, // metres above the start line's height at the start
  // The drop comes in like a comet: it starts this share of a steady glide's
  // run behind its start spot, so flying straight lands it there on time.
  cometRun: 1,
  laneEntry: 1.25, // the descent lane's half-width where comets come in, as a share of the start line's half-span...
  laneEnd: 1 / 6, // ...and at the line (its middle sixth, about 2.5 km). (A cone, narrow in and wide at the line, was tried and removed, owner 2026-11-09.)
  // The start line: every course cell this far from the beach by water (the fair
  // cells' median), so wherever a drop crosses it, the race ahead is the same length.
  lineTol: 0.004, // share of that distance either side drawn as the line
  ceilSlope: 1.3, // highest a drop can be: this many metres up per metre still to go to the line
  floorGap: 60, // lowest: this far over the ground, easing to 0 in the last 1.5 km
  dropCloudShare: 0.156, // descent clouds hold this share of cloudWater (they gave far too much; 0.25 x 10/16 clouds)
  cloudSpread: 4500, // metres either side of the comet path the first clouds sit; they close in toward the start line
  diveRate: 1.6,
  diveSpeed: 0, floatSpeed: 0.3, // diving only loses height, no ground speed (was 0.5: bots dived half the descent and outran players, owner 2026-11-09); // diving glides this much faster, floating this much slower // ...diving falls up to this much faster (about 12 s)...
  floatRate: 0.35, // ...floating up to this much slower (about 31 s): land early for a head start, or stay up to catch clouds
  // Rain clouds hang in the sky over the summits: fall through one and its
  // water is yours, a bigger start; each can only be taken once.
  skyClouds: 16, // rain clouds along the comet path in, closer together near the start line (was 10:
  // an engaged drop's longest quiet stretch 18 s, worst 29 s; now 13 s, worst 16 s, same total water)...
  cloudsRandom: true, // anywhere in the lane, any reachable height (owner); off: cloudsOnPath placement
  cloudsOnPath: true, // ...each at the height a steady fall passes it, so steering to one can reach it
  slopeClouds: 14, // ...and low rain clouds spread evenly down the slope, caught by flowing under them
  cloudRadius: 500, // metres across the sky...
  cloudDepth: 400, // ...and this far above or below its height
  cloudDrain: 50, // a drop cloud drains in this many ticks with a river inside, shared equally by all inside
  cloudLift: 0, // metres a drop cloud rises as it empties (none: clouds stay where you saw them) (lighter, it floats up into slower fallers' way)
  heavyFall: 0.5, // falling faster per unit of size gained from clouds...
  // Water cycle: the source pump replaces what a channel loses to evaporation and
  // seepage (so a river's volume holds), and those losses feed the sky and the ground.
  evapRate: 0.00015, // litres per tick per square metre of channel surface, into the sky
  seepRate: 0.0001, // litres per tick per square metre of channel bed, into the ground store
  stormMinWater: 5_000_000, // the sky builds a storm once it holds this much...
  stormMaxWater: 5_000_000, // ...carrying at most this much, rained out until it's empty
  cloudWater: [150_000, 450_000],
  slopeCloudAlt: 350, // metres above the ground a low slope cloud hangs
  glideSpeed: 82.5, // m/s across the ground while falling (was 110: cut 25%, owner 2026-11-09) (stick all the way: x1.8, stick let go: x0.4)
  // Bumps between falling drops: touching (within bumpRadius across and
  // bumpDepth up or down) and closing, they knock each other off course and
  // both lose water to spray, the one hit harder (the lighter, or the one rammed) more.
  bumpRadius: 350, // metres (was 220: rams rarely landed)
  bumpDepth: 300, // metres of height
  dropRandom: { back: 0, alt: 0 }, // a 150 m jitter across around each drop's place; back / alt: shares of the run and height
  dropCalm: 90, // ticks at the start of a descent (the 4.5 s opening shot) when no drop can bump or be bumped
  // Slipstream: flying within draftLength behind another drop (draftWidth either
  // side, within bumpDepth of its height) glides draftBoost faster, past the stick's cap.
  draftLength: 600, draftWidth: 120, draftBoost: 0.2,
  boostBuild: 0.04, boostFade: 0.08, // dive / float build by this share a tick and fade by this (slipstream: 0.6x both)
  bumpKnock: 1.4, // knock speed per m/s of closing speed, shared by weight
  bumpDecay: 0.93, // knock left after each tick (a bump carries them well apart)
  bumpMin: 30, // (was 40, scaled with the 25% slower glide) m/s of closing speed below which drops just touch: no bump (the 110 m/s glide closes slower)
  bumpLoss: 0.02, // share of volume lost to a knock as fast as the base glide (head-on at full glide: about 4%)
  bumpLossMax: 0.08, // most of its volume a drop can lose to one bump
  bumpCool: 40, // ticks before the same two drops can bump again
  // Anti-bullying: the drop hit darts away (bumpBurst faster for bumpBurstTicks), the
  // hitter is checked (bumpRecoil of its glide for bumpRecoilTicks), so a chaser can't pin a drop.
  bumpBurst: 0.6, bumpBurstTicks: 10, bumpRecoil: 0.5, bumpRecoilTicks: 20,
  bumpTransfer: 0.7, // share of the loser's spill the winner of a bump soaks up (the rest goes to the sky)
  bumpSteal: true, // the side with more momentum into the hit wins it (Brain flood#E122: the winner must gain; dlist#E71: damage by momentum)
  bumpWinLoss: 0.15, // the winner still spills this share of what the loser does
  zoneSlack: 2400, // metres a falling drop may stray from the landing rings: wide enough to glide to another mountain's
  glideTurn: 0.045, // radians per tick while falling (52 deg/s; was 0.08 = 92 deg/s, twice what the drop camera
  // may turn without sickness, Brain T182: the view lagged 47 deg behind a 1 s turn and the drop swung across the screen)
  startElevation: 0.91, // starts ring each summit cone this far up its peak
  startTolerance: 0.006, // starts within ±0.6% of the peak's height of each other
  fairReach: 0.025, // and within ±2.5% of the same route length to the sea // +- share of the peak
  // Lava: a few flows down from the high ground. Water crossing lava boils off
  // and slows, and the lava it touches cools into a rock ridge.
  lavaFlows: 2,
  lavaLength: 70,
  steam: 0.006,
  steamFloor: 1.15,
  lavaSlow: 0.6,
  damHeight: 4,
  // Trees: what a river must be to knock a stand flat, and how tall a stand
  // stands to one that can't.
  treeBreak: 1.3,
  treeHeight: 14, // (no longer a rise: see forestDrag)
  forestDrag: 0.35, // a small river among trees runs at this share of its speed
  treeCost: 0.03, // share of its speed a head of size 1 loses per tick ploughing through forest its full width; divided by size
  // A head breaks trees by force: size x speed / base speed >= treeBreak (a small fast head smashes through, a slow one is held up).
  // The heat front: from heatStart ticks (counted from the start of the drop)
  // a heat wave rolls down the mountain at heatSpeed m/s. It never touches a
  // river: the lakes behind it slowly dry out.
  heatStart: 600 + 20 * 50,
  heatSpeed: 155,
  heatEvery: 60, // every 3 s...
  heatDrop: 0.1, // ...each lake behind the front falls this many metres (a level drop, not litres: a
  // pond and a deep lake dry at the same rate, as real evaporation does; inflow still fills it)
  // Pulses: a river's water comes down its channel in waves. Every
  // pulseEvery ticks (more for bigger rivers) a pulse leaves the source with
  // the water gathered since the last; it runs down the channel at pulseSpeed
  // times the river's speed, eroding every stretch it passes, filling any low
  // lake on the way and losing a share wherever a rival has cut in, and the
  // river grows by what reaches its head.
  pulseEvery: [[3_000_000, 20], [8_000_000, 40], [Infinity, 60]], // [below this volume, ticks]
  pulseSpeed: 3,
  surge: 2.5, // a pulse reaching the head adds up to this many times base speed...
  surgeShare: 0.015, // ...the full surge once it brings this share of the river's volume...
  surgeCap: 1.6, // ...up to this many times its usual top speed
  surgeLift: 3, // metres a head running at base speed can carry up a rise (grows with speed squared)...
  surgeLiftMax: 40, // ...up to this
  surgeHop: 20, // metres more a surging head can top, whatever its speed: Surge carries you over a slight hill, Gouge over a real one
  // Storms: one at a time, from stormStart and then stormGap after each has
  // gone, a storm blows in from one side of the island ahead of the pack and
  // sweeps across to the other,
  // raining stormRain litres per tick into every river head under it and
  // filling every lake it passes over.
  stormStart: 600 + 20 * 40,
  stormGap: 20 * 12,
  stormRadius: 2500, // (map pass: a storm you can actually reach)
  stormRain: 9000,
  stormMax: 3, // storms in the sky at once
  stormLakeRain: 15, // litres per tick per lake cell for a lake under a storm
  stormSpan: 9000, // metres either side of the slope's centre line a storm starts and ends
  stormSpeed: [100, 150], // m/s a storm sweeps across the island...
  stormDrift: [15, 40], // ...while drifting this fast down the slope
  // Contact is a depth tug-of-war: the deeper water siphons the shallower.
  // (was 0.012 / 0.015: 12 bot races had 0 knockouts, 2026-11-09; see ADR 0007)
  siphonRate: 0.04,
  siphonCap: 0.05,
  siphonDeadband: 0.05,
  floor: 0.4, // below this share of the starting volume a river dries up and is out...
  floorPeak: 0.5, // ...or below this share of the most it has held (rivers outgrow a fixed floor fast)
  knockoutHandoff: true, // a river knocked out hands what's left to the river that drained it (T178)
  contactDepth: 1,
  liveTicks: 300, // a drained river's channel stays live this long, then it's a dry bed
  graceTicks: 100,
  gracePerRiver: 2,
  spawnGap: 600,
};

// Size from volume without transcendental Math: two square roots.
// Size is the cube root of relative volume, as for real water: eight times the
// water is twice the size. Newton's method from sqrt, a fixed number of steps,
// so every machine gets the same bits (no cbrt/pow).
export function sizeOf(volume) {
  const v = Math.max(1e-9, volume / TUNE.startVolume);
  let x = v > 1 ? Math.sqrt(v) : 1;
  for (let i = 0; i < 12; i++) x = (2 * x + v / (x * x)) / 3;
  return x;
}

export function lakeGain(lake) {
  return TUNE.lakeBase + TUNE.lakePerCell * Math.min(lake.cells, TUNE.lakeCellCap);
}

// The game surface: filled terrain minus every carved channel.
export function createWorld(terrain, { forest = true, lava = true } = {}) {
  const n = terrain.size;
  // owner: which river last dug each cell. A river never feels its own channel
  // (it would sit at the bottom of its own trench and stall), only rivals'.
  const { label: lakeOf, lakes } = findLakes(terrain);
  const world = {
    terrain,
    dist: distanceToSea(terrain, downhill), // along the fill's downhill tree
    reach: descentDistance(terrain), // shortest route water can take to any sea (spawn fairness, forest lanes)
    ...finishBeach(terrain), // beach (sea cells that end the race), beachLand, seaNext, toBeach
    lakeOf, lakes,
    lakeCap: Float64Array.from(lakes, (l) => lakeGain(l)), // litres when full
    lakeVol: Float64Array.from(lakes, (l) => lakeGain(l) * TUNE.lakeStart), // litres now
    lakeFlow: new Float64Array(lakes.length), // litres of rivers' water poured in and not yet out again
    lakePending: new Float64Array(lakes.length), // litres arriving next tick (outlets and spills into lakes)
    spills: new Map(), // lake -> { path: [cells], flow, on }: overflow over the rim, owned by nobody
    lakeIn: new Float64Array(lakes.length), // litres per tick flowing in, last tick
    lakeOut: new Float64Array(lakes.length), // litres per tick flowing out, last tick
    lakeOutlet: lakeOutlets(terrain, lakeOf, lakes), // cell just past each lake's spill point
    ...lakeLevels(terrain, lakeOf, lakes), // lakeBrim, lakeBed: surface when full, lowest point
    events: [], // for presentation, see step()
    digs: [], // channel digs queued during a tick, applied together at its end
    storms: [], // { id, x, z, vx, vz, radius, until }: storms sweeping across the island
    pairs: new Map(), // 'id|id' -> { win, tick }: which way water last ran between a pair
    junctions: new Map(), // 'from|to' -> { from, to, until }: a cut channel's water flowing on into the cutter
    carve: new Float32Array(n * n), owner: new Int32Array(n * n).fill(-1), dugAt: new Int32Array(n * n), tick: 0, rivers: [], dirty: [],
  };
  world.lava = new Uint8Array(n * n); // 1 where lava flows
  world.cooled = []; // cells that turned from lava to rock, for presentation
  world.rock = new Float32Array(n * n); // metres of cooled rock on top of the ground
  world.basins = makeBasins(world);
  if (lava) makeLava(world);
  if (forest) addForest(world);
  return world;
}

// The forest, planted once the island is settled (rerolls skip it).
export function addForest(world) {
  const band = spawnBand(world);
  ({ trees: world.trees, round: world.roundReach } = plantForest(world, band.ring, band.cells, TUNE.climb));
  world.felled = []; // cells whose trees a river knocked down, for presentation
  world.treeRock = Float32Array.from(world.rock, (v, k) => v + (world.trees[k] ? TUNE.treeHeight : 0)); // the ground as a small river feels it
  return world;
}

// Surface seen by river `self` (-1 = everyone's channels, for rendering).
// Each lake's surface when full (its brim, the fill level) and its lowest bed
// point. In between, the level is taken as linear in the water it holds.
function lakeLevels(t, lakeOf, lakes) {
  const lakeBrim = new Float64Array(lakes.length).fill(Infinity), lakeBed = new Float64Array(lakes.length).fill(Infinity);
  for (let k = 0; k < lakeOf.length; k++) {
    const l = lakeOf[k];
    if (l < 0) continue;
    if (t.filled[k] < lakeBrim[l]) lakeBrim[l] = t.filled[k];
    if (t.height[k] < lakeBed[l]) lakeBed[l] = t.height[k];
  }
  return { lakeBrim, lakeBed };
}

// Under standing water: a lake, or the shallow fringe around one (or any filled
// hollow) under the lake-depth threshold. Rivers don't dig or erode there; only
// the dry banks do.
export function underWater(world, k) {
  const t = world.terrain;
  return world.lakeOf[k] >= 0 || t.filled[k] - t.height[k] > TUNE.shallowWater;
}

// Water surface: bed when empty, rim when full, above the rim past full.
export function lakeLevel(world, lake) {
  return world.lakeBed[lake] + lakeSpan(world, lake) * (world.lakeVol[lake] / world.lakeCap[lake]);
}
const lakeSpan = (world, lake) => Math.max(0.5, world.lakeBrim[lake] - world.lakeBed[lake]);
// Litres a lake holds at a given surface level.
export const lakeVolAt = (world, lake, level) => Math.max(0, world.lakeCap[lake] * (level - world.lakeBed[lake]) / lakeSpan(world, lake));

// The cell each lake spills into: the first cell outside it on the fill's
// downhill tree, from the lowest-lying lake cell that drains out.
function lakeOutlets(t, lakeOf, lakes) {
  const out = new Int32Array(lakes.length).fill(-1), best = new Float64Array(lakes.length).fill(Infinity);
  for (let k = 0; k < lakeOf.length; k++) {
    const l = lakeOf[k];
    if (l < 0) continue;
    const d = downhill(t, k);
    if (d >= 0 && lakeOf[d] !== l && t.filled[k] < best[l]) { best[l] = t.filled[k]; out[l] = d; }
  }
  return out;
}

// Pick the dry basins: mid-size lakes, chosen by a seeded stream so every
// client and the server agree. Kept off spawn cells.
export function makeBasins(world) {
  const r = stream(world.terrain.seed, 'basins');
  const spawn = dropZone(world);
  const cands = world.lakes.filter((l) => l.cells >= TUNE.basinMinCells && l.cells <= TUNE.basinMaxCells && world.lakeOutlet[l.id] >= 0);
  const picked = [];
  while (picked.length < TUNE.basins && cands.length) {
    const l = cands.splice(Math.floor(r() * cands.length), 1)[0];
    let nearSpawn = false;
    for (let k = 0; k < world.lakeOf.length && !nearSpawn; k++) if (world.lakeOf[k] === l.id && spawn.has(k)) nearSpawn = true;
    if (nearSpawn) continue;
    picked.push(l.id);
    world.lakeVol[l.id] = 0;
  }
  return picked;
}

// Lava flows: from a few high cells, down the fill's downhill tree, three
// cells wide, stopping before lakes and low ground. Seeded, so all agree.
export function makeLava(world) {
  const t = world.terrain, n = t.size;
  const r = stream(t.seed, 'lava');
  let peak = 0;
  for (let i = 0; i < n * n; i++) if (t.height[i] > peak) peak = t.height[i];
  const spawn = dropZone(world);
  for (let f = 0; f < TUNE.lavaFlows; f++) {
    let c = -1;
    for (let tries = 0; tries < 400 && c < 0; tries++) {
      const k = Math.floor(r() * n * n);
      if (t.height[k] > peak * 0.7 && world.lakeOf[k] < 0 && !spawn.has(k)) c = k;
    }
    for (let step = 0; c >= 0 && step < TUNE.lavaLength; step++) {
      if (world.lakeOf[c] >= 0 || t.filled[c] < 150) break;
      const cx = c % n, cy = (c - cx) / n;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 1 || y < 1 || x >= n - 1 || y >= n - 1) continue;
        const k = y * n + x;
        if (world.lakeOf[k] < 0 && !spawn.has(k)) world.lava[k] = 1;
      }
      c = downhill(t, c);
    }
  }
}

export function surfaceAt(world, wx, wz, self = -1) {
  const t = world.terrain, n = t.size;
  const gx = (wx / t.worldSize + 0.5) * (n - 1);
  const gy = (wz / t.worldSize + 0.5) * (n - 1);
  const x0 = gx < 0 ? 0 : gx > n - 2 ? n - 2 : Math.floor(gx);
  const y0 = gy < 0 ? 0 : gy > n - 2 ? n - 2 : Math.floor(gy);
  const fx = Math.min(1, Math.max(0, gx - x0)), fy = Math.min(1, Math.max(0, gy - y0));
  const i = y0 * n + x0, f = t.filled, c = world.carve, o = world.owner;
  // A river doesn't feel its own channel, nor a rival's live water (crossing that
  // costs water instead, see resolveContacts); old dry beds are ordinary ground.
  const cv = (k) => (self >= 0 && o[k] >= 0 && (o[k] === self || isLive(world, k)) ? 0 : c[k]);
  // To a river too small to knock them down, a stand of trees is a rise.
  const rk = world.rock;
  const a = f[i] + rk[i] - cv(i), b = f[i + 1] + rk[i + 1] - cv(i + 1), d = f[i + n] + rk[i + n] - cv(i + n), e = f[i + n + 1] + rk[i + n + 1] - cv(i + n + 1);
  return (a + (b - a) * fx) + ((d + (e - d) * fx) - (a + (b - a) * fx)) * fy;
}

// Start contours: one round each of the three summits, every start at the
// same elevation (a share of the peak, within a small tolerance), on open
// ground, on the downhill side of its peak. Cached per world.
export function spawnBand(world) {
  if (world.band) return world.band;
  const t = world.terrain, n = t.size, h = t.height, ax = t.axis.x, ay = t.axis.y;
  const groups = [], ring = [];
  for (const top of t.summits) {
    const peak = h[top], tx = top % n, ty = (top - tx) / n;
    const target = peak * TUNE.startElevation;
    let tol = peak * TUNE.startTolerance, cells;
    do {
      // The summit's own slopes: everything connected to its top that stays
      // above the start contour.
      const near = new Uint8Array(n * n), queue = [top];
      near[top] = 1;
      cells = [];
      while (queue.length) {
        const c = queue.pop(), cx = c % n, cy = (c - cx) / n;
        if (Math.abs(h[c] - target) <= tol && t.filled[c] - h[c] < 0.5 && (cx - tx) * ax + (cy - ty) * ay >= 0 && (!t.mask || t.mask[c])) cells.push(c); // never on the scenery
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 8 || y < 8 || x >= n - 8 || y >= n - 8) continue;
          const k = y * n + x;
          if (!near[k] && h[k] >= target - tol) { near[k] = 1; queue.push(k); }
        }
      }
      tol *= 1.5;
    } while (cells.length < 40 && tol < peak * 0.02);
    cells.sort((a, b) => a - b);
    // Fair paths: of those, the ones as far from the sea as this summit's
    // median, by the shortest route water can take.
    const reach = world.reach;
    const sorted = cells.map((c) => reach[c]).sort((a, b) => a - b);
    const mid = sorted[sorted.length >> 1];
    groups.push(cells.filter((c) => Math.abs(reach[c] - mid) <= mid * TUNE.fairReach));
    ring.push(...cells);
  }
  const fair = groups.flat().sort((a, b) => a - b);
  // ring: the contours, which falling drops glide along; cells: their fair
  // spots, where they touch down; groups: those spots per summit.
  world.band = { target: h[t.summits[1]] * TUNE.startElevation, cells: fair, wide: fair, groups, ring, top: t.summits[1] };
  return world.band;
}

// How many rivers the start rings can seat at least spawnGap apart (greedy, in
// index order), split evenly over the three summits. A map that can't seat
// everyone gets rerolled.
export function seats(world) {
  const t = world.terrain, n = t.size, gap2 = TUNE.spawnGap * TUNE.spawnGap;
  const per = spawnBand(world).groups.map((cells) => {
    const placed = [];
    for (const c of cells) {
      const x = ((c % n) / (n - 1) - 0.5) * t.worldSize, z = (Math.floor(c / n) / (n - 1) - 0.5) * t.worldSize;
      if (placed.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 >= gap2)) placed.push({ x, z });
    }
    return placed.length;
  });
  return Math.min(...per) * per.length;
}

// The island for a race: from `seed`, the next seed and the next until the
// summit ring seats every river. Returns the seed used and its fresh world.
export function rollIsland(seed, rivers, tries = 40) {
  let world;
  for (let i = 0; i < tries; i++, seed = (seed % 1_000_000) + 1) {
    world = createWorld(generateIsland(seed), { forest: false });
    if (seats(world) >= rivers) break;
  }
  return { seed: world.terrain.seed, world: addForest(world) };
}

// Keyed by player id. Keeps clear of rivers already placed, so add rivers in
// a fixed order (sorted ids) when the result must be reproducible.
export function spawnPoint(world, id) {
  const t = world.terrain, n = t.size;
  const band = spawnBand(world);
  const r = stream(t.seed, `spawn:${id}`);
  const others = world.rivers.map((o) => o.spawn);
  // Rivers are dealt round the three summits in the order they're added.
  const cells = band.groups[world.rivers.length % band.groups.length];
  let best = null, bestGap = -1;
  for (let tries = 0; tries < 120; tries++) {
    const i = cells[Math.floor(r() * cells.length)];
    const p = { x: ((i % n) / (n - 1) - 0.5) * t.worldSize, z: (Math.floor(i / n) / (n - 1) - 0.5) * t.worldSize };
    let gap = Infinity;
    for (const o of others) gap = Math.min(gap, (o.x - p.x) ** 2 + (o.z - p.z) ** 2);
    if (gap >= TUNE.spawnGap * TUNE.spawnGap) return p;
    if (gap > bestGap) { bestGap = gap; best = p; }
  }
  return best;
}

// (world.dropScale shortens the descent for one world: the tutorial's is half as long.)
const cometRun = (world) => TUNE.cometRun * TUNE.glideSpeed * TUNE.dropTicks * DT * (world?.dropScale ?? 1);
// The height a drop's altitude counts from: the start line's (a comet flies
// over the scenery behind, so not the ground under it).
export const skyBase = (world) => spawnBand(world).target;

// opts.drop: start as a falling drop (the game); without it the river starts on
// the ground at once (tests and tools).
export function addRiver(world, id, at = spawnPoint(world, id), opts = {}) {
  const idx = world.rivers.length;
  const g = gradient(world, at.x, at.z, idx);
  const len = Math.sqrt(g.x * g.x + g.z * g.z) || 1;
  const river = {
    id,
    idx,
    x: at.x, z: at.z,
    spawn: { x: at.x, z: at.z }, // where it was placed (drops may land elsewhere)
    dx: -g.x / len, dz: -g.z / len,
    speed: TUNE.minSpeed,
    volume: TUNE.startVolume,
    size: 1,
    depth: TUNE.depth,
    lakes: 0, // lakes joined
    inflow: 0, // litres per tick arriving from lakes through your outlets
    via: new Map(), // lake -> { cell, e (metres eroded), born } for lakes you flowed through
    inLake: -1, // lake the head is in now
    pooled: -1, // lake the head is pooled in (below full), or -1
    pooledTicks: 0,
    low: Infinity, // lowest surface reached; water can't climb far above it
    ponded: 0, // metres the local pool has risen above the ground
    leftLake: -1, // the last lake the head left
    cut: 0, cutTicks: 0, cutAt: -1, cutLake: -1,
    stuck: false, stuckAt: 0, stuckX: 0, stuckZ: 0, // a head on a lake cutting its way out through a bank
    exitPath: null, exitStep: 0,
    gougeT: -1, // (unused since Gouge stopped pausing the head: always -1)
    surgeT: -1, surgeAt: 0, // Surge: ticks into it (wind-up then burst), or -1; tick it's ready again
    boost: 0, // ticks of Gouge's climb boost left
    gougeAt: 0, // tick the next gouge is ready
    pulses: [], // { s (metres down the path), i (next path point), amount, flow, every, erode, lakes passed }
    feeds: new Map(), // path index -> litres waiting to leave there with the next pulse
    pulseAt: 0, // tick the next pulse leaves
    exit: -1, // cell of the lake exit a blocked head on a lake is making for, or -1
    routeAt: -1e9,
    route: null, // level where the head was blocked: it's following the fill route out until it runs lower
    netAt: 0, netX: 0, netZ: 0, netT: 0, // where it was a moment ago, to tell going nowhere from flowing
    travelled: 0,
    finished: false,
    finishTick: -1,
    out: null, // { by, tick } once drained below the floor by a rival
    born: world.tick,
    dropping: opts.drop ? TUNE.dropTicks : 0, // ticks of fall left
    claim: -1, // the start cell a falling drop will touch down on, once chosen
    alt: opts.drop ? TUNE.dropAlt : 0, // metres above the ground while falling
    path: [],
  };
  world.rivers.push(river);
  if (!river.dropping) {
    pushPathPoint(world, river);
    applyDigs(world);
  } else {
    // Start the fall heading down the slope: drops that don't steer fall
    // side by side and keep apart, instead of all closing on one spot.
    river.dx = world.terrain.axis.x; river.dz = world.terrain.axis.y;
    // A comet: it comes in from behind the mountains, a steady glide's run
    // back from its start spot, so flying straight brings it down there.
    // It starts a glide's run straight back from the stretch of the start line
    // ahead of its spot, so flying straight brings every drop down in the same time.
    const run = cometRun(world), t = world.terrain, n = t.size, ax = river.dx, az = river.dz;
    const lat = (x, z) => -x * az + z * ax, v0 = lat(at.x, at.z);
    let best = -1, bd = Infinity;
    for (const k of startLine(world).cells) {
      const kx = ((k % n) / (n - 1) - 0.5) * t.worldSize, kz = (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize, d = Math.abs(lat(kx, kz) - v0);
      if (d < bd || (d === bd && k < best)) { bd = d; best = k; }
    }
    const bx = best >= 0 ? ((best % n) / (n - 1) - 0.5) * t.worldSize : at.x, bz = best >= 0 ? (Math.floor(best / n) / (n - 1) - 0.5) * t.worldSize : at.z;
    river.x = bx - ax * run; river.z = bz - az * run;
    if (TUNE.dropRandom) {
      // Random starts (owner, 2026-11-09): anywhere across the lane's mouth, a little nearer or
      // farther back, higher or lower. Seeded by the island and the river, so every machine agrees.
      const rng = stream(t.seed, `drop-start:${id}`), lane = descentLane(world);
      const u = (river.x * ax + river.z * az) - run * TUNE.dropRandom.back * (rng() * 2 - 1);
      const side = lat(river.x, river.z) + 150 * (rng() * 2 - 1); // a jitter around its own place
      river.x = ax * u - az * side; river.z = az * u + ax * side;
      river.alt = TUNE.dropAlt * (1 + TUNE.dropRandom.alt * (rng() * 2 - 1));
    }
  }
  return river;
}

// While falling: turn, and hurry (+1) or slow (-1) the glide, anywhere over the map.
// steer turns, fwd hurries (+1) or slows (-1) the fall, g glides faster or slower across the ground.
function glide(world, r, steer, fwd, g = 0) {
  if (steer) {
    // A comet keeps coming in: at most 60 degrees off straight down the slope (was 70: held there with no
    // dive boost it crept in at a third of its speed). Turning further
    // from downhill eases off from 45 degrees instead of stopping dead at the limit (it read as
    // the stick doing nothing a quarter of the time); turning back is always full rate.
    const ax0 = world.terrain.axis.x, az0 = world.terrain.axis.y, cosNow = r.dx * ax0 + r.dz * az0;
    const a0 = (TUNE.glideTurn * -steer) / Math.max(1, r.size); // heavier turns slower
    const away = (r.dx + r.dz * a0) * ax0 + (r.dz - r.dx * a0) * az0 < cosNow; // this turn takes it further from downhill
    const a = a0 * (away ? Math.max(0.15, Math.min(1, (cosNow - 0.5) / (0.707 - 0.5))) : 1);
    const dx = r.dx + r.dz * a, dz = r.dz - r.dx * a;
    r.dx = dx; r.dz = dz;
    normalize(r);
  }
  {
    const ax = world.terrain.axis.x, az = world.terrain.axis.y, MAXC = 0.5; // cos 60
    if (r.dx * ax + r.dz * az < MAXC) {
      const side = r.dx * az - r.dz * ax < 0 ? -1 : 1, sn = Math.sqrt(1 - MAXC * MAXC);
      r.dx = ax * MAXC + az * sn * side; r.dz = az * MAXC - ax * sn * side;
    }
  }
  // Diving trades height for speed (and floating, speed for height), on top of the stick's glide: capped at 2.2x.
  // On the floor there is no height left to trade: a dive there is no faster.
  // Dive and float build up and fade (owner, 2026-11-09): about 1.2 s to full, 0.6 s to let go.
  const want = fwd > 0 && r.onFloor ? 0 : fwd;
  r.diveK = (r.diveK ?? 0) + Math.max(-TUNE.boostFade, Math.min(TUNE.boostBuild, want - (r.diveK ?? 0)));
  const dive = r.diveK;
  const v = TUNE.glideSpeed * Math.min(2.2, (g > 0 ? 1 + 0.8 * g : 1 + 0.6 * g) * (dive > 0 ? 1 + TUNE.diveSpeed * dive : 1 + TUNE.floatSpeed * dive));
  // After a bump: the drop that was hit darts away for a moment, the one that hit is checked.
  const kick = (r.burstT > 0 ? 1 + TUNE.bumpBurst : 1) * (r.recoilT > 0 ? TUNE.bumpRecoil : 1);
  if (r.burstT > 0) r.burstT--;
  if (r.recoilT > 0) r.recoilT--;
  // The slipstream builds while you sit in it (about 2 s to full) and fades over 1 s when you leave.
  r.draftK = (r.draftK ?? 0) + (r.draft ? Math.min(TUNE.boostBuild * 0.6, 1 - (r.draftK ?? 0)) : -Math.min(TUNE.boostFade * 0.6, r.draftK ?? 0));
  const vDraft = v * (1 + TUNE.draftBoost * r.draftK) * kick;
  const heavy = 1 + TUNE.heavyFall * Math.max(0, r.size - 1); // cloud water makes a drop heavier: it falls faster
  r.glideV = v;
  const kx = r.kx ?? 0, kz = r.kz ?? 0; // a bump's knock, fading
  r.kx = kx * TUNE.bumpDecay; r.kz = kz * TUNE.bumpDecay;
  // It goes exactly where it's flown: no zone, no easing onto a spot. Only the
  // walls of the course stop it (the scenery beside it is never flown into or landed on).
  let nx = r.x + (r.dx * vDraft + kx) * DT, nz = r.z + (r.dz * vDraft + kz) * DT;
  const t = world.terrain, line = startLine(world);
  const offCourse = (x, z) => t.mask?.[cellIndex(t, x, z)] === 0 && slopeT(world, x, z) > -0.03; // beside the course (behind it is where comets come in)
  if (offCourse(nx, nz)) {
    // Against the course wall: slide along it toward the nearest stretch of the line.
    const n = t.size;
    let best = -1, bd = Infinity;
    for (const k of line.cells) { const d2 = (((k % n) / (n - 1) - 0.5) * t.worldSize - r.x) ** 2 + ((Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize - r.z) ** 2; if (d2 < bd || (d2 === bd && k < best)) { bd = d2; best = k; } }
    if (best >= 0) {
      const tx = ((best % n) / (n - 1) - 0.5) * t.worldSize - r.x, tz = (Math.floor(best / n) / (n - 1) - 0.5) * t.worldSize - r.z, tl = Math.hypot(tx, tz) || 1;
      const m = Math.min(tl, v * DT);
      nx = r.x + (tx / tl) * m; nz = r.z + (tz / tl) * m;
    } else { nx = r.x; nz = r.z; }
  }
  // The descent lane's walls: past one, slide back to it along the line of flight (no pull from inside).
  {
    const lane = descentLane(world), ax = t.axis.x, az = t.axis.y;
    const lat = -nx * az + nz * ax, u = nx * ax + nz * az, half = laneHalf(lane, lane.uLine - u), off = lat - lane.c;
    if (Math.abs(off) > half) {
      // Against a wall: keep the move down the lane, drop the part going out through the wall, and
      // ease back inside by at most 3 m a tick (it used to re-place the drop on the wall: up to 17 m jumps).
      // A 150 m cushion past the wall fades the outward part of the move to nothing; beyond it,
      // ease back in by 3 m a tick. (It used to re-place the drop on the wall: jumps up to 17 m.)
      const lat0 = -r.x * az + r.z * ax, sg = Math.sign(off), over = Math.abs(off) - half, dl = lat - lat0;
      let l2 = lat;
      if (dl * sg > 0) l2 = lat0 + dl * Math.max(0, 1 - over / 150);
      if (Math.abs(l2 - lane.c) > half + 150) l2 -= sg * 3;
      const uu = Math.max(u, r.x * ax + r.z * az + v * DT * 0.5); // always on down the lane: pinned against a course wall too, it got stuck
      nx = ax * uu - az * l2; nz = az * uu + ax * l2;
    }
  }
  r.x = nx; r.z = nz;
  // Height is for the clouds: dive or float between a floor (just over the
  // ground) and a ceiling that closes in, so the drop meets the ground right at the line.
  const d = toLine(world, r.x, r.z), near = Math.min(1, d / 1500);
  // The ground under it and up to 1.5 s ahead, from the start line's height: the floor rises before
  // a hill instead of shoving the drop up as the hill passes under it (39% of a weaving fall, up to 13 m a tick).
  const under = surfaceAt(world, r.x, r.z, r.idx) - skyBase(world);
  let gnd = -Infinity;
  for (const ahead of [0, 0.5, 1, 1.5]) gnd = Math.max(gnd, surfaceAt(world, r.x + r.dx * v * ahead, r.z + r.dz * v * ahead, r.idx));
  gnd -= skyBase(world);
  const floor = gnd + TUNE.floorGap * near, ceil = Math.max(floor, d * TUNE.ceilSlope + under * (1 - near)); // the ceiling meets the ground under the drop at the line (not the look-ahead: a hill leaving it dropped the ceiling 52 m in a tick)
  const rate = (TUNE.dropAlt / (TUNE.dropTicks * (world.dropScale ?? 1))) * (dive > 0 ? 1 + TUNE.diveRate * dive : 1 + TUNE.floatRate * dive) * heavy;
  // Below the floor, climb to it with a climb speed that builds and fades by 0.6 m a tick, never in one jump.
  const fallTo = r.alt - rate, need = floor - fallTo;
  r.climb = need > 0 ? Math.min(need, (r.climb ?? 0) + 0.6, 14) : Math.max(0, (r.climb ?? 0) - 0.6);
  // The ceiling pulls down at most 6 m a tick faster than the fall (no snaps), except in the last 30 m to the line.
  r.alt = Math.max(Math.min(ceil, fallTo + r.climb), d > 30 ? fallTo - 6 : -Infinity);
  r.onFloor = r.alt <= floor + 1;
  const straight = Math.max(0, (line.t - slopeT(world, r.x, r.z)) * 2 * t.long * (t.worldSize / 2)); // flight distance to the line
  r.dropping = Math.max(1, Math.ceil(straight / (TUNE.glideSpeed * DT))); // ticks to the line at the base glide (the HUD's countdown)
  // Inside a drop cloud: it drains into every river inside, equally (see dropClouds).
  for (const c of skyClouds(world)) {
    if (c.low || c.water <= 0 || (c.x - r.x) ** 2 + (c.z - r.z) ** 2 > (c.radius ?? TUNE.cloudRadius) ** 2 || Math.abs(c.alt - r.alt) > TUNE.cloudDepth) continue;
    (c.inside ??= []).push(r);
  }
  // Crossing the line, it touches down right where it is (or, never having
  // found it, after three falls' time: a safety net, not a rule).
  r.fallT = (r.fallT ?? 0) + 1;
  if (pastLine(world, r.x, r.z) || r.fallT > 3 * TUNE.dropTicks) land(world, r);
}

// The rain clouds over the summits, seeded so every machine has the same sky:
// near the start rings, at heights a fall passes through.
export function skyClouds(world) {
  if (world.clouds) return world.clouds;
  const t = world.terrain, n = t.size, rng = stream(t.seed, 'sky-clouds'), ring = spawnBand(world).ring;
  // Along the comet path in: each cloud sits where a steady fall passes at
  // its height, spread wide early on and closing in toward the middle of the
  // start line near the end, packed closer there, so the drops converge and bump.
  const fair = spawnBand(world).cells, ax = t.axis.x, az = t.axis.y, run = cometRun(world);
  const sx = fair.reduce((a, k) => a + ((k % n) / (n - 1) - 0.5) * t.worldSize, 0) / fair.length;
  const sz = fair.reduce((a, k) => a + (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize, 0) / fair.length;
  world.clouds = Array.from({ length: TUNE.skyClouds }, (_, id) => {
    // The first two come early (within about the first 10 s) and near the lanes the drops fly in on,
    // so the descent opens with a choice instead of empty sky (Brain: time to first event, not median gap).
    const early = id < 2 && !TUNE.cloudsRandom;
    // Random clouds (owner, 2026-11-09): anywhere along the run and across the lane, at any reachable height.
    const p = TUNE.cloudsRandom ? 0.04 + 0.92 * rng() : early ? 0.05 + 0.05 * id + 0.02 * rng() : 0.12 + 0.8 * Math.pow((id - 2 + 0.3 + 0.4 * rng()) / (TUNE.skyClouds - 2), 0.6); // then denser toward the line
    const lane = descentLane(world);
    const side = TUNE.cloudsRandom ? lane.c - (-sx * az + sz * ax) + (rng() * 2 - 1) * laneHalf(lane, run * (1 - p)) * 0.95 : early ? (id ? 1 : -1) * (600 + rng() * 1200) : (rng() * 2 - 1) * (TUNE.cloudSpread * Math.pow(1 - p, 0.8) + 250);
    const back = run * (1 - p);
    return {
      id,
      x: sx - ax * back - az * side,
      z: sz - az * back + ax * side,
      alt: TUNE.cloudsRandom ? TUNE.dropAlt * (1 - p) * (0.3 + 0.9 * rng()) + 150 : early || TUNE.cloudsOnPath ? TUNE.dropAlt * (1 - p) * (0.85 + 0.1 * rng()) : Math.max(150, back * (0.3 + 0.9 * rng())), // on the steady path (TUNE.cloudsOnPath: all of them), else anywhere a drop can reach
      water: (TUNE.cloudWater[0] + rng() * (TUNE.cloudWater[1] - TUNE.cloudWater[0])) * TUNE.dropCloudShare,
      taken: -1,
    };
  });
  // Drop clouds are reservoirs: their size follows their water, and they drain as rivers pass through.
  for (const c of world.clouds) { c.water0 = c.water; c.radius = TUNE.cloudRadius * Math.cbrt(c.water / (TUNE.cloudWater[1] * TUNE.dropCloudShare)) * 1.2; } // (size as before: less water, same cloud)
  // Low clouds down the slope, one per band of distance to the sea from the
  // start ring to the coast, so there is water to chase the whole way down,
  // not only in the sky at the start. Caught by a head flowing under one.
  const low = stream(t.seed, 'slope-clouds'), top = Math.max(...ring.map((k) => world.toBeach[k]));
  const picked = [];
  for (let i = 0; i < TUNE.slopeClouds; i++) {
    const want = top * (1 - (i + 0.5) / TUNE.slopeClouds);
    let best = -1, bestErr = Infinity;
    for (let tries = 0; tries < 400; tries++) {
      const k = Math.floor(low() * n * n);
      if (world.lakeOf[k] >= 0 || t.filled[k] <= SEA_LEVEL + 5 || world.lava?.[k] || !(world.toBeach[k] > 0 && world.toBeach[k] < 1e8)) continue;
      const kx = ((k % n) / (n - 1) - 0.5) * t.worldSize, kz = (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize;
      if (picked.some((p) => (p.x - kx) ** 2 + (p.z - kz) ** 2 < 2500 ** 2)) continue;
      const err = Math.abs(world.toBeach[k] - want);
      if (err < bestErr) { bestErr = err; best = k; }
    }
    if (best < 0) continue;
    const c = {
      id: world.clouds.length, low: true,
      x: ((best % n) / (n - 1) - 0.5) * t.worldSize, z: (Math.floor(best / n) / (n - 1) - 0.5) * t.worldSize,
      alt: TUNE.slopeCloudAlt,
      water: TUNE.cloudWater[0] + low() * (TUNE.cloudWater[1] - TUNE.cloudWater[0]),
      taken: -1,
    };
    picked.push(c);
    world.clouds.push(c);
  }
  return world.clouds;
}

// A falling drop stays over the landing ring: never more than zoneSlack from
// the summit contour, so it can glide all the way round but never out to a
// coast, and touches down on the fair spot nearest where it is.
export function keepInZone(world, x, z, slack = TUNE.zoneSlack) {
  if (!world.ringZone) world.ringZone = new Set(spawnBand(world).ring);
  const t = world.terrain, n = t.size, k = landingCell(world, x, z, world.ringZone);
  const cx = ((k % n) / (n - 1) - 0.5) * t.worldSize, cz = (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize;
  const dx = x - cx, dz = z - cz, d = Math.sqrt(dx * dx + dz * dz);
  if (d <= slack) return { x, z };
  return { x: cx + (dx * slack) / d, z: cz + (dz * slack) / d };
}

// The start line: course cells whose water route to the beach is the fair
// cells' median (Brain flood#E14: a fixed tolerance, not one that widens to fit).
export function startLine(world) {
  if (world.line) return world.line;
  const t = world.terrain, fair = spawnBand(world).cells, reach = fair.map((k) => world.toBeach[k]).sort((a, b) => a - b);
  const L = reach[reach.length >> 1], tol = L * TUNE.lineTol, cells = [];
  for (let k = 0; k < t.size * t.size; k++) if (t.mask?.[k] !== 0 && t.filled[k] > SEA_LEVEL && Math.abs(world.toBeach[k] - L) <= tol) cells.push(k);
  const n = t.size, ts = cells.map((k) => slopeT(world, ((k % n) / (n - 1) - 0.5) * t.worldSize, (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize)).sort((a, b) => a - b);
  world.line = { L, cells, set: new Set(cells), t: ts[ts.length >> 1] ?? 0.15 };
  return world.line;
}
// The descent lane: a triangle in the sky, the full width of the start line
// where the comets come in, narrowing to its middle third at the line, so the
// drops are brought together near the end (owner, 2026-11-06). Its walls only
// stop a drop pushing into them: it slides along them, nothing pulls it in.
export function descentLane(world) {
  if (world.lane) return world.lane;
  const t = world.terrain, n = t.size, ax = t.axis.x, az = t.axis.y, line = startLine(world);
  const lats = line.cells.map((k) => { const x = ((k % n) / (n - 1) - 0.5) * t.worldSize, z = (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize; return -x * az + z * ax; }).sort((a, b) => a - b);
  const lo = lats[Math.floor(lats.length * 0.02)], hi = lats[Math.floor(lats.length * 0.98)];
  world.lane = { c: (lo + hi) / 2, entry: ((hi - lo) / 2) * TUNE.laneEntry, end: ((hi - lo) / 2) * TUNE.laneEnd, run: cometRun(world), uLine: (line.t * 2 * t.long - t.long) * (t.worldSize / 2) };
  return world.lane;
}
// The lane's half-width with `d` metres of flight still to go to the line.
export const laneHalf = (lane, d) => lane.end + (lane.entry - lane.end) * Math.min(1, Math.max(0, d) / lane.run);

// Is (x, z) on or past the start line, on the course?
export function pastLine(world, x, z) {
  const t = world.terrain, k = cellIndex(t, x, z);
  const line = startLine(world);
  return t.mask?.[k] !== 0 && t.filled[k] > SEA_LEVEL && world.toBeach[k] <= line.L * (1 + TUNE.lineTol); // anywhere on the drawn line counts
}
// Metres still to go to the start line: by water on the course, along the slope elsewhere.
export function toLine(world, x, z) {
  const t = world.terrain, k = cellIndex(t, x, z), line = startLine(world);
  if (t.mask?.[k] !== 0 && t.filled[k] > SEA_LEVEL && world.toBeach[k] < 1e8) return Math.max(0, world.toBeach[k] - line.L);
  return Math.max(0, (line.t - slopeT(world, x, z)) * 2 * t.long * (t.worldSize / 2));
}

export function dropZone(world) {
  if (!world.dropZone) world.dropZone = new Set(spawnBand(world).cells);
  return world.dropZone;
}

// Where a drop above (x, z) touches down: the nearest start-contour cell.
// Searched in square rings, ties broken by index, so every client agrees.
export function landingCell(world, x, z, zone = dropZone(world)) {
  const t = world.terrain, n = t.size;
  const c = cellIndex(t, x, z);
  if (zone.has(c)) return c;
  const cx = c % n, cy = (c - cx) / n;
  let best = -1, bestD = Infinity;
  for (let rad = 1; rad < n; rad++) {
    // Just the ring's edge: top and bottom rows, then the two side columns.
    for (let i = 0; i < 8 * rad; i++) {
      const side = i < 2 * (2 * rad + 1) ? (i & 1) : 2 + (i & 1);
      const j = side < 2 ? (i >> 1) - rad : ((i - 2 * (2 * rad + 1)) >> 1) - rad + 1;
      const dx = side < 2 ? j : side === 2 ? -rad : rad;
      const dy = side < 2 ? (side === 0 ? -rad : rad) : j;
      const x2 = cx + dx, y2 = cy + dy;
      if (x2 < 0 || y2 < 0 || x2 >= n || y2 >= n) continue;
      const k = y2 * n + x2;
      if (!zone.has(k)) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD || (d === bestD && k < best)) { bestD = d; best = k; }
    }
    // A cell found in ring rad can only be beaten within ring ceil(rad * sqrt 2).
    if (best >= 0 && rad * rad >= bestD) break;
  }
  return best >= 0 ? best : c;
}

// Touchdown on the start contour: the river starts here, its grace from now.
// Where a drop will touch down: the nearest fair start cell to where it is
// that no other river has taken (none landed or about to land within
// spawnGap), claimed as the last seconds of the fall begin and kept, so two
// drops never land on one spot and start the race already fighting. In the
// order rivers move (sorted ids), so every machine agrees.

function land(world, r) {
  // Where it is: the line was crossed here (no snapping to a spot).
  r.dropping = 0;
  r.alt = 0;
  const g = gradient(world, r.x, r.z, r.idx);
  const len = Math.sqrt(g.x * g.x + g.z * g.z);
  if (len > 1e-9) { r.dx = -g.x / len; r.dz = -g.z / len; }
  r.born = world.tick;
  r.low = Infinity;
  // It hits the ground still moving: the glide carries into the river (then fades to what the ground allows).
  r.speed = Math.max(TUNE.minSpeed, (r.glideV ?? 0) * TUNE.landCarry);
  pushPathPoint(world, r);
  world.events.push({ type: 'land', river: r.idx, tick: world.tick });
}

export const isRacing = (r) => !r.finished && !r.out;

function gradient(world, x, z, self) {
  const h = world.terrain.cell;
  return {
    x: (surfaceAt(world, x + h, z, self) - surfaceAt(world, x - h, z, self)) / (2 * h),
    z: (surfaceAt(world, x, z + h, self) - surfaceAt(world, x, z - h, self)) / (2 * h),
  };
}

function normalize(r) {
  const len = Math.sqrt(r.dx * r.dx + r.dz * r.dz);
  if (len > 1e-9) { r.dx /= len; r.dz /= len; }
}

// Inputs: Map<id, steer> with steer -1 | 0 | 1, or Map<id, { s, f, k }> where f
// (-1 | 0 | 1) slows or hurries a falling drop and k (0 | 1) is the skill button.
function readInput(v) {
  if (v && typeof v === 'object') return { s: clampUnit(v.s), f: clampUnit(v.f), g: clampUnit(v.g), k: v.k ? 1 : 0, u: v.u ? 1 : 0 };
  return { s: clampUnit(v), f: 0, g: 0, k: 0, u: 0 };
}

// ---- Gouge. Two gates, read alike by the sim, the HUD and the bots: ready
// (recharged, enough water, free to act) and a target (ground ahead to cut).
// The cooldown and the cost are taken only once both pass.
export const gougeCost = (r) => Math.max(TUNE.gougeMinCost, r.volume * TUNE.gougeShare * (TUNE.gougeSizeCost ? Math.max(1, r.size) : 1));

export function gougeReady(world, r) {
  return isRacing(r) && !!r.gougeOn && !r.dropping && r.pooled < 0 && r.gougeT < 0 && !(r.boost > 0) && world.tick >= r.gougeAt &&
    r.volume - gougeCost(r) >= TUNE.gougeKeep * TUNE.startVolume;
}

// Cells the blow would cut along the current heading: [cell, new rock] pairs.
// A rise worth a bot's press: ground along its heading, within gougeLook
// cells, that stands above what it can climb now but within the boost's lift.
export function gougeTarget(world, r) {
  const t = world.terrain, ceiling = r.low + TUNE.climb + liftOf(r);
  let top = -Infinity;
  for (let i = 1; i <= TUNE.gougeLook; i++) top = Math.max(top, surfaceAt(world, r.x + r.dx * t.cell * i, r.z + r.dz * t.cell * i, r.idx));
  return top > ceiling + TUNE.gougeRise && top < ceiling + TUNE.gougeLift * r.size;
}

export const gougeUsable = (world, r) => gougeReady(world, r) && gougeTarget(world, r);

// Gouge never stops the head: the momentum it has is kept and the boost adds
// to it, speed and size both, for gougeBoost ticks (owner, 2026-11-03).
function startGouge(world, r) {
  const cost = gougeCost(r);
  grow(r, -cost);
  // Every gouge also deepens the river's whole channel by 5%, applied with the digs (phase 4), so the
  // order rivers move in can't change what the others feel this tick.
  (world.deepen ??= []).push(r);
  const cool = coolOf(r, TUNE.gougeCool);
  r.gougeAt = r.surgeAt = world.tick + cool; r.coolLen = cool; // one cooldown for both skills
  r.boost = TUNE.gougeBoost;
  r.boostSpeed = Math.max(TUNE.gougeFloor, r.speed + TUNE.baseSpeed * TUNE.gougeAdd * Math.max(1, r.mass ?? 1));
  r.speed = r.boostSpeed;
  r.size = sizeOf(r.volume) + TUNE.gougeGrow;
  r.depth = depthOf(r);
  // A fresh start from here: no route, exit, cut or stall held over from before.
  r.route = null; r.exit = -1; r.exitPath = null; r.stuck = false; r.filling = false;
  r.cut = 0; r.cutTicks = 0; r.cutAt = -1; r.cutLake = -1;
  r.netAt = r.stuckAt = world.tick; r.netX = r.stuckX = r.x; r.netZ = r.stuckZ = r.z; r.netT = r.travelled;
  world.events.push({ type: 'gouge-wind', river: r.idx, cost, tick: world.tick });
  world.events.push({ type: 'gouge', river: r.idx, x: r.x, z: r.z, dx: r.dx, dz: r.dz, tick: world.tick });
}

const clampUnit = (v) => Math.max(-1, Math.min(1, v | 0));

// One authoritative tick. Phases, so the result never depends on the order
// rivers were added:
// 1. every racing river moves against last tick's surface;
// 2. contacts resolve (deeper siphons shallower), judged on last tick's channels;
// 3. water moves between rivers and lakes;
// 4. channel digs and erosion are applied, in id order.
export function step(world, inputs) {
  if (TUNE.catchUp || TUNE.tailUnlock) {
    let lead = Infinity;
    for (const r of world.rivers) if (isRacing(r) && !r.dropping) lead = Math.min(lead, world.toBeach[cellIndex(world.terrain, r.x, r.z)]);
    world.leadReach = lead;
  }
  for (const r of world.rivers) {
    if (!isRacing(r)) continue;
    moveRiver(world, r, readInput(inputs?.get(r.id)));
  }
  dropBumps(world);
  dropClouds(world);
  waterCycle(world);
  resolveContacts(world);
  weather(world);
  hydrology(world);
  pulses(world);
  erodeTrails(world);
  applyDigs(world);
  world.tick++;
}

// No auto-steering: only the player turns the head. Gravity sets the speed
// (downhill along the heading is fast, across a slope slow); water can't go
// uphill, so a heading into a rise slides along the contour if it can, or the
// water ponds a little and then waits for the player to turn.
export const surgeReady = (world, r) => TUNE.surgeOn && !!r.surgeOn && isRacing(r) && !r.dropping && r.pooled < 0 && r.gougeT < 0 && !(r.surgeT >= 0)
  && world.tick >= (r.surgeAt ?? 0) && r.volume - Math.max(TUNE.gougeMinCost, r.volume * TUNE.surgeShare) >= TUNE.gougeKeep * TUNE.startVolume;
function moveRiver(world, r, { s: steer, f: fwd, g: glideIn = 0, k: skill, u: surge }) {
  // The opening shot (owner): nobody steers, players or bots; everyone glides straight at full throttle.
  if (r.dropping) return calm(r) ? glide(world, r, 0, 0, 1) : glide(world, r, steer, fwd, glideIn);
  if (steer) {
    // Turn by adding a sideways component, then renormalising (angle = atan(a)).
    // A bigger river answers the stick as well as a small one: more water is
    // more control, not less. Left of heading (dx, dz) is (dz, -dx).
    const a = TUNE.turnStep * -steer;
    const dx = r.dx + r.dz * a, dz = r.dz - r.dx * a;
    r.dx = dx; r.dz = dz;
    normalize(r);
  }
  // Skills unlock as the river grows, and stay unlocked.
  // A river far behind the leader gets Surge before it has grown enough for it: a way
  // back by speed, not handed water (Brain flood#E112; 36 bot races: tail comebacks 11 -> 20 of 108).
  const behind = TUNE.tailUnlock && world.leadReach !== undefined && world.toBeach[cellIndex(world.terrain, r.x, r.z)] - world.leadReach > TUNE.catchUpGap;
  if (!r.surgeOn && (r.volume >= TUNE.surgeUnlock || behind)) { r.surgeOn = true; world.events.push({ type: 'unlock', skill: 'surge', river: r.idx, why: r.volume >= TUNE.surgeUnlock ? 'size' : 'behind', tick: world.tick }); }
  if (!r.gougeOn && r.volume >= TUNE.gougeUnlock) { r.gougeOn = true; world.events.push({ type: 'unlock', skill: 'gouge', river: r.idx, tick: world.tick }); }
  // A player's Gouge fires whenever it is ready; bots press it only facing a
  // rise the boost can carry them over (see bot.js).
  if (skill && gougeReady(world, r)) startGouge(world, r);
  if (r.boost > 0 && --r.boost === 0) r.size = sizeOf(r.volume); // the boost's extra size goes with it
  if (surge && surgeReady(world, r)) {
    const cost = Math.max(TUNE.gougeMinCost, r.volume * TUNE.surgeShare);
    // Like Gouge, it never stops the head: the speed it has is kept and Surge adds to it.
    grow(r, -cost); r.surgeT = 0; const cool = coolOf(r, TUNE.surgeCool); r.surgeAt = r.gougeAt = world.tick + cool; r.coolLen = cool;
    r.surgeSpeed = Math.max(TUNE.surgeFloor, r.speed + TUNE.baseSpeed * TUNE.surgeAdd * Math.max(1, r.mass ?? 1));
    r.speed = r.surgeSpeed;
    world.events.push({ type: 'surge-wind', river: r.idx, cost, tick: world.tick });
    world.events.push({ type: 'surge', river: r.idx, tick: world.tick });
  }
  if (r.surgeT >= 0 && ++r.surgeT > TUNE.surgeTicks) r.surgeT = -1;
  // In the sea off the wrong coast: only the one beach ends the race, so the
  // current carries the river along the coast to it (no steering out at sea).
  const kSea = cellIndex(world.terrain, r.x, r.z);
  if (world.terrain.filled[kSea] <= SEA_LEVEL && !world.beach[kSea]) return seaCurrent(world, r, kSea);
  // Riding the current, a shore cell barely above the sea is still the sea: carry on from the last
  // sea cell (clipping one 0.23 m up, a river flowed back and forth there for good).
  if (r.offCourse && r.seaCell >= 0 && world.terrain.filled[kSea] <= SEA_LEVEL + 2 && !world.beach[kSea] && world.lakeOf[kSea] < 0) return seaCurrent(world, r, r.seaCell);
  if (r.pooled >= 0) {
    // Pooled in a lake below full: the water rises; the head waits.
    r.pooledTicks++;
    r.speed = 0;
    r.depth = depthOf(r);
    return;
  }
  const me = r.idx;
  const here = surfaceAt(world, r.x, r.z, me);
  const g = gradient(world, r.x, r.z, me);
  const gl = Math.sqrt(g.x * g.x + g.z * g.z);
  if (here < r.low) { r.low = here; r.ponded = 0; }

  // Where the water goes. On a lake or a flat it runs level, straight where
  // it's aimed. On a slope it goes where it's aimed too, as long as that's
  // downhill or across (with a slight drift down); aimed uphill, the uphill
  // part is dropped and it runs along and down the slope instead, because
  // water never climbs. The heading itself only ever turns when the player steers.
  //
  // Blocked, water doesn't stall or rock against the rise: it fills the hollow
  // and spills out at its lowest point, along the terrain's fill route
  // (priority flood), which leads to the sea without climbing. Once on that
  // route it stays on it until it has run clearly lower than where it was
  // blocked, or the player steers. (Choosing afresh each tick, it would step
  // back toward the rise and rock in place.)
  const tt = world.terrain, cHere = cellIndex(tt, r.x, r.z), onLake = world.lakeOf[cHere] >= 0;
  // On a lake the head floats on its water: as the lake rises past its rim,
  // the head rises with it and can top higher banks.
  if (onLake) r.low = Math.max(r.low, lakeLevel(world, world.lakeOf[cHere]));
  // Off the route again once it has run clearly lower and the heading no longer
  // points back up the slope (or the player steers): otherwise a heading aimed
  // uphill would climb, block and fall back forever.
  if (r.route !== null) {
    const aimUp = gl > 1e-6 ? (g.x * r.dx + g.z * r.dz) / gl : 0; // > 0: heading points uphill
    // (Held at least routeHold ticks once taken: re-choosing every tick
    // between the route and the heading only rocks the head back and forth.)
    if (world.tick - r.routeAt >= TUNE.routeHold && (steer || (here < r.route - TUNE.routeDrop && aimUp < 0.2))) r.route = null;
  }
  // Going nowhere (moving, but back and forth, as across a valley floor when
  // aimed up it): take the fill route out too.
  if (world.tick - r.netAt >= TUNE.stallTicks) {
    const moved = r.travelled - r.netT, net = Math.sqrt((r.x - r.netX) ** 2 + (r.z - r.netZ) ** 2);
    if (r.route === null && moved > TUNE.stallMin && net < moved * TUNE.stallNet) {
      // On a lake, going nowhere means making for its lowest exit (the fill
      // route there only creeps along the shore); on land, the fill route.
      if (onLake) { if (r.exit < 0) setExit(world, r, world.lakeOf[cHere]); } else { r.route = here; r.routeAt = world.tick; }
    }
    r.netAt = world.tick; r.netX = r.x; r.netZ = r.z; r.netT = r.travelled;
  }
  // Barely gone anywhere in a moment, however it's steered: it's stuck. A
  // rushing river can't stop, so it holds still while its water pools and
  // wears away the ground the way it is pushing (see below), until a way opens.
  if (world.tick - r.stuckAt >= TUNE.stuckTicks) {
    const net = Math.sqrt((r.x - r.stuckX) ** 2 + (r.z - r.stuckZ) ** 2);
    if (!r.stuck && net < TUNE.stuckNet && !onLake && r.exit < 0 && !r.cut) r.stuck = true;
    r.stuckAt = world.tick; r.stuckX = r.x; r.stuckZ = r.z;
  }
  const routeDir = () => {
    const n = tt.size, d = wayOut(world, r, cellIndex(tt, r.x, r.z));
    if (d < 0) return null;
    const ex = ((d % n) / (n - 1) - 0.5) * tt.worldSize - r.x, ez = (Math.floor(d / n) / (n - 1) - 0.5) * tt.worldSize - r.z;
    const el = Math.sqrt(ex * ex + ez * ez);
    return el > 1e-6 ? { x: ex / el, z: ez / el } : null;
  };
  // Cutting out of a lake: until the head is through the rim and running
  // below the lake, it goes where it's aimed (the slope doesn't turn it back).
  if (r.cutLake >= 0 && (onLake || here < lakeLevel(world, r.cutLake) - 1)) r.cutLake = -1;
  let mx = r.dx, mz = r.dz;
  // Under a skill the water goes exactly where it's aimed: no fall-line bend,
  // no route round a rise (it presses through and erodes it instead, below).
  const skilled = (r.boost > 0 || r.surgeT >= 0) && !onLake;
  if (skilled) { r.route = null; r.stuck = false; }
  if (skilled) { /* straight on the heading */ } else if (r.route !== null) {
    const d = routeDir();
    if (d) { mx = d.x; mz = d.z; } else r.route = null;
  } else if (!onLake && r.cutLake < 0 && gl >= TUNE.flatSlope) {
    const fx = -g.x / gl, fz = -g.z / gl, wf = Math.min(1, gl / TUNE.fallSlope);
    const up = mx * fx + mz * fz; // > 0: aimed downhill
    // Aimed uphill, a rise the head stands taller than is no obstacle while the
    // water still has the speed to run up it: it goes where it's aimed. A rise
    // above the head, or running out of speed, drops the uphill part.
    const over = up < 0 && (-up * gl * TUNE.headLook > liftOf(r) || (r.speed < TUNE.climbSpeed && !(r.boost > 0)));
    let bx = mx, bz = mz;
    if (over) { bx -= up * fx; bz -= up * fz; } // drop the uphill part
    if (up >= 0 || over) {
      bx += fx * wf * (over ? TUNE.fallUphill : TUNE.fallDrift);
      bz += fz * wf * (over ? TUNE.fallUphill : TUNE.fallDrift);
    }
    const bl = Math.sqrt(bx * bx + bz * bz);
    if (bl > 1e-6) { mx = bx / bl; mz = bz / bl; }
  }
  // Momentum takes up new water over a second or two, so a pulse arriving
  // swells the river's pace instead of jolting it.
  r.mass = (r.mass ?? 1) + (1 + TUNE.speedPerSize * (r.size - 1) - (r.mass ?? 1)) * TUNE.massEase;
  const mass = r.mass;
  const along = onLake ? 0 : -(g.x * mx + g.z * mz); // downhill slope along the way the water goes; a lake is level
  // Level water (a lake, a flat) doesn't push or brake: what you carry in
  // carries on, fading slowly, never below the base speed.
  const level = onLake || gl < TUNE.flatSlope;
  // Forest is rough ground (Manning's n for a wooded floodplain runs 3-4x
  // pasture's): a river too small to knock the trees down is slowed right
  // down among them, but never walled in; a big one flattens them.
  const drag = world.trees?.[cHere] && !breaksTrees(r) ? TUNE.forestDrag : 1;
  const target = (level ? Math.max(TUNE.baseSpeed * mass, Math.min(TUNE.maxSpeed * mass, r.speed * TUNE.levelGlide))
    : Math.max(TUNE.minSpeed, Math.min(TUNE.maxSpeed * mass, (TUNE.baseSpeed + (along >= 0 ? TUNE.satSpeed * (1 - Math.exp(-along / TUNE.satSlope)) : TUNE.slopeSpeed * along)) * mass))) * drag;
  // Momentum: more water surges up to speed just as fast, but holds it
  // longer, slowing down only slowly.
  r.speed += (target - r.speed) * (target > r.speed ? TUNE.speedEase : TUNE.slowEase / r.size);
  // Climbing always costs speed, boosted or surging too (owner: going over higher ground should slow it).
  if (!onLake && along < 0) {
    const keep = 1 - (TUNE.climbDrag * Math.min(1, -along / 0.05)) / Math.max(1, r.size) ** 1.5; // more water pushes further up
    r.speed *= keep;
    if (r.boostSpeed) r.boostSpeed = Math.max(TUNE.gougeFloor, r.boostSpeed * keep); // a skill's floor holds on a climb
    if (r.surgeSpeed) r.surgeSpeed = Math.max(TUNE.surgeFloor, r.surgeSpeed * keep);
  }
  if (r.boost > 0) r.speed = Math.max(r.speed, r.boostSpeed); // boosted: the speed it had plus the boost (less what climbs cost)
  if (r.surgeT >= 0) r.speed = Math.max(r.speed, r.surgeSpeed); // surging: its speed plus the surge
  r.depth = depthOf(r);

  // More water stands taller at the head: rises that would stop a small river
  // don't stop a big one.
  let ceiling = r.low + TUNE.climb + liftOf(r);
  let v = r.speed;
  let nx = r.x + mx * v * DT, nz = r.z + mz * v * DT;
  if (r.stuck) {
    // Free as soon as the way it's aimed, or the way out, is open: it goes
    // that way (the heading first) and the pool runs out after it.
    const step = Math.max(TUNE.minSpeed, TUNE.baseSpeed * mass) * DT * 3, d = routeDir();
    const ways = [{ x: r.dx, z: r.dz }, d].filter(Boolean);
    const open = ways.find((w) => surfaceAt(world, r.x + w.x * step, r.z + w.z * step, me) <= ceiling);
    if (open) {
      r.stuck = false;
      r.stuckAt = world.tick; r.stuckX = r.x; r.stuckZ = r.z;
      mx = open.x; mz = open.z;
      v = r.speed = Math.max(r.speed, TUNE.baseSpeed * mass);
      nx = r.x + mx * v * DT; nz = r.z + mz * v * DT;
    } else {
      // Held: the pool keeps rising, and the water wears away the ground the
      // way it's pushing.
      r.low = Math.max(r.low, here) + TUNE.pool * r.size;
      wearAhead(world, r);
      r.speed = TUNE.minSpeed;
      if (!r.filling) world.events.push({ type: 'pond', river: r.idx, tick: world.tick });
      r.filling = true;
      r.depth = depthOf(r);
      return;
    }
  }
  // On a lake with no bank low enough to climb, the head makes for the lake's
  // lowest exit, its natural spill point or any river's outlet (a rival's too:
  // riding it out cuts into their channel). Nobody is trapped by a lake that
  // has drained below its rim.
  // First, though, a head pushed against a bank cuts its own way out: it
  // erodes the bank where it's aimed, faster for a bigger river, and once the
  // cut is down to its water it flows out there, cutting a new outlet. Only
  // a bank too high to cut in cutTicks sends it to the lowest exit.
  // (The shallow fringe round a lake counts: the head is still in its water.)
  const shore = onLake ? world.lakeOf[cHere] : r.cutLake >= 0 ? r.cutLake : underWater(world, cHere) ? r.leftLake : -1;
  // Judged where the player aims, not where the slope would turn the water.
  const px = r.x + r.dx * Math.max(v * DT, tt.cell * 0.5), pz = r.z + r.dz * Math.max(v * DT, tt.cell * 0.5);
  const ahead = shore >= 0 && r.exit < 0 ? surfaceAt(world, px, pz, me) : -Infinity;
  if (ahead > ceiling) {
    const at = cellIndex(tt, px, pz);
    const ax = at % tt.size, ay = (at - ax) / tt.size, bx = r.cutAt % tt.size, by = (r.cutAt - bx) / tt.size;
    if (r.cutAt < 0 || Math.abs(ax - bx) > 2 || Math.abs(ay - by) > 2) { r.cut = 0; r.cutTicks = 0; } // a new spot
    r.cutAt = at;
    r.cut += TUNE.bankCut * r.size;
    r.cutTicks++;
    r.cutLake = onLake ? -1 : shore; // on the rim: keep cutting the way it's aimed
    if (ahead - lakeLevel(world, shore) > TUNE.cutMax * r.size) {
      // A hill, not a rim: no cutting through that. Make for the lowest exit.
      setExit(world, r, shore); r.cut = 0; r.cutTicks = 0; r.cutAt = -1; r.cutLake = -1;
    } else if (r.cut >= ahead - ceiling) {
      // Through: the water runs out over the cut.
      r.low = ahead - TUNE.climb - liftOf(r) + 0.01;
      ceiling = r.low + TUNE.climb + liftOf(r);
      mx = r.dx; mz = r.dz; nx = px; nz = pz; // out through the cut, the way it's aimed
      r.cutLake = shore;
      r.cut = 0; r.cutTicks = 0; r.cutAt = -1;
    } else {
      world.digs.push({ r, x: px, z: pz, width: widthOf(r), depth: r.cut, bed: ahead - r.cut });
      if (r.cutTicks === 1) world.events.push({ type: 'cut', river: r.idx, tick: world.tick });
      if (r.cutTicks > TUNE.cutTicks) { setExit(world, r, shore); r.cut = 0; r.cutTicks = 0; r.cutAt = -1; r.cutLake = -1; }
      else {
        r.speed = Math.min(r.speed, TUNE.baseSpeed * mass);
        r.depth = depthOf(r);
        return;
      }
    }
  } else if (shore < 0) { r.cut = 0; r.cutTicks = 0; r.cutAt = -1; }
  if (r.exit >= 0) {
    // Along the water to the exit (never straight across a headland).
    const n = tt.size;
    let k = r.exitPath[r.exitStep], ex, ez, el;
    for (;;) {
      ex = ((k % n) / (n - 1) - 0.5) * tt.worldSize - r.x; ez = (Math.floor(k / n) / (n - 1) - 0.5) * tt.worldSize - r.z;
      el = Math.sqrt(ex * ex + ez * ez);
      if (el > tt.cell * 0.75 || r.exitStep >= r.exitPath.length - 1) break;
      k = r.exitPath[++r.exitStep];
    }
    if (el > tt.cell * 0.75) {
      v = Math.max(TUNE.baseSpeed * mass * 3, r.speed); // the lake's current carries it to the exit
      r.speed = v;
      const s = Math.min(v * DT, el);
      moveTo(world, r, r.x + (ex / el) * s, r.z + (ez / el) * s);
      afterMove(world, r);
      return;
    }
    // Through: the water stands at the exit now and runs on downhill.
    r.exit = -1; r.exitPath = null;
    r.low = Math.max(r.low, surfaceAt(world, r.x, r.z, me));
    r.route = r.low;
    const d = routeDir();
    if (d) { mx = d.x; mz = d.z; nx = r.x + mx * v * DT; nz = r.z + mz * v * DT; }
  }
  // A skill presses through: no bouncing off a rise while boosted or surging.
  // The head holds its heading and wears the ground ahead down, and goes on
  // as soon as it's through (the skill's speed floor keeps it pushing).
  if ((r.boost > 0 || r.surgeT >= 0) && !onLake && r.route === null && surfaceAt(world, nx, nz, me) > ceiling) {
    wearAhead(world, r, TUNE.pressWear * (r.boost > 0 ? 1 : 0.5), TUNE.pressWearMax);
    if (surfaceAt(world, nx, nz, me) > ceiling) {
      if (!r.pressing) world.events.push({ type: 'press', river: r.idx, tick: world.tick });
      r.pressing = true;
      r.depth = depthOf(r);
      return; // held right here this tick, still pushing the way it's aimed
    }
  }
  r.pressing = false;
  if (r.route === null && surfaceAt(world, nx, nz, me) > ceiling && gl > 1e-6) {
    // Slide along the contour, on the side the water is going.
    const ux = g.x / gl, uz = g.z / gl, d = mx * ux + mz * uz;
    const sx = mx - d * ux, sz = mz - d * uz, sl = Math.sqrt(sx * sx + sz * sz);
    if (sl > TUNE.slideMin) {
      mx = sx / sl; mz = sz / sl; v = r.speed * sl;
      nx = r.x + mx * v * DT; nz = r.z + mz * v * DT;
    }
  }
  if (r.route === null && onLake && surfaceAt(world, nx, nz, me) > ceiling) {
    // Blocked on a lake (a bank it couldn't cut, or one it topped with speed
    // and lost it climbing): the lake's current carries it to the lowest exit
    // rather than the fill route creeping along the shore.
    setExit(world, r, world.lakeOf[cHere]);
    if (r.exit >= 0) { r.depth = depthOf(r); return; }
  }
  if (r.route === null && surfaceAt(world, nx, nz, me) > ceiling) {
    const d = routeDir();
    if (d) {
      { r.route = here; r.routeAt = world.tick; }
      // Momentum carries on: blocked, the water swings off along its way out
      // at the speed it had (on a lake, at least base speed).
      v = onLake ? Math.max(TUNE.baseSpeed * mass, r.speed) : Math.max(TUNE.minSpeed, r.speed);
      r.speed = v;
      nx = r.x + d.x * v * DT; nz = r.z + d.z * v * DT;
    } else {
      nx = r.x; nz = r.z;
      r.speed *= 0.8;
    }
  }
  if (r.route !== null) {
    // Stuck in a hollow: a rushing river can't stop, so its water fills the
    // hollow, rising each tick, and the head waits until it spills over.
    const rise = surfaceAt(world, nx, nz, me) - ceiling, fill = TUNE.pool * r.size;
    if (rise > fill) {
      r.low += fill;
      r.speed = Math.min(r.speed, TUNE.minSpeed);
      if (!r.filling) world.events.push({ type: 'pond', river: r.idx, tick: world.tick });
      r.filling = true;
      r.depth = depthOf(r);
      return;
    }
    if (rise > 0) r.low += rise;
  }
  r.filling = false;
  // Running up a rise spends momentum (what lets it top the rise, see
  // liftOf): every metre climbed costs speed, so a long climb slows it
  // right down, and running down gives it back through the slope.
  const rise = surfaceAt(world, nx, nz, me) - here;
  if (rise > 0 && !onLake && !(r.boost > 0)) {
    // (Heavier water loses less speed per metre: mass carries a big river further up.)
    const v2 = r.speed * r.speed - (rise * TUNE.baseSpeed * TUNE.baseSpeed) / (TUNE.surgeLift * (r.mass ?? 1));
    r.speed = Math.max(TUNE.minSpeed, Math.sqrt(Math.max(0, v2)));
  }
  moveTo(world, r, nx, nz);
  afterMove(world, r);
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// Bigger first; equal volumes fall back to id so ties never depend on order.
const biggerFirst = (a, b) => b.volume - a.volume || byId(a, b);

function resolveContacts(world) {
  const grace = TUNE.graceTicks + TUNE.gracePerRiver * world.rivers.length;
  const rs = world.rivers.filter((r) => isRacing(r) && !r.dropping && world.tick - r.born >= grace);
  if (rs.length < 2) return;
  const { carve, owner } = world;
  // Contacts from last tick's channels and this tick's heads: [a, aDepth, b, bDepth, how].
  const contacts = new Map();
  const add = (a, da, b, db, how) => {
    const [p, dp, q, dq] = byId(a, b) < 0 ? [a, da, b, db] : [b, db, a, da];
    const key = `${p.id}|${q.id}`;
    const prev = contacts.get(key);
    // Two touches between the same pair: keep the bigger depth gap.
    if (!prev || Math.abs(dp - dq) > Math.abs(prev[1] - prev[3])) contacts.set(key, [p, dp, q, dq, how]);
  };
  const live = new Set(rs.map((r) => r.idx));
  const cuts = []; // heads in a rival's live channel: [a, aDepth, owner, channelDepth]
  for (const a of rs) {
    // Head in a rival's live channel: the channel's water is as deep as it was dug.
    const k = cellIndex(world.terrain, a.x, a.z);
    const o = owner[k];
    if (o >= 0 && o !== a.idx && live.has(o) && carve[k] > TUNE.contactDepth && isLive(world, k)) {
      cuts.push([a, a.depth, world.rivers[o], carve[k], k]); // head depth vs the channel as cut right here
    }
    // Heads touching.
    for (const b of rs) {
      if (b.idx <= a.idx) continue;
      const reach = (widthOf(a) + widthOf(b)) / 2;
      const dx = a.x - b.x, dz = a.z - b.z;
      if (dx * dx + dz * dz < reach * reach) add(a, a.depth, b, b.depth, 'head');
    }
  }
  // Amounts come from volumes at the start of the phase, so order can't matter.
  const start = new Map(rs.map((r) => [r, r.volume]));
  const lost = new Map(), top = new Map();
  const flows = [];
  for (const key of [...contacts.keys()].sort()) {
    const [p, dp, q, dq, how] = contacts.get(key);
    const [win, dw, lose, dl] = dp >= dq ? [p, dp, q, dq] : [q, dq, p, dp];
    const lead = (dw - dl) / Math.max(dl, 0.5);
    if (lead < TUNE.siphonDeadband) continue;
    const amount = start.get(lose) * TUNE.siphonRate * Math.min(1, lead);
    flows.push({ win, lose, amount, how });
    lost.set(lose, (lost.get(lose) ?? 0) + amount);
  }
  // A cut through a rival's channel joins the two: water runs on from the
  // shallower into the deeper for as long as the cut stays live.
  // The cut point on each river's channel: pulses coming down the shallower
  // one lose a share there to the deeper (see pulses()).
  for (const [a, da, b, db, k] of cuts) {
    const [win, dw, lose, dl] = da >= db ? [a, da, b, db] : [b, db, a, da];
    if ((dw - dl) / Math.max(dl, 0.5) < TUNE.siphonDeadband) continue;
    const jk = `${lose.id}|${win.id}`, rev = world.junctions.get(`${win.id}|${lose.id}`);
    // The deeper side flipped: water runs one way only, but a cut made moments
    // ago holds for pairHold ticks first (hysteresis, so it can't flicker).
    if (rev && world.tick - rev.made < TUNE.pairHold) continue;
    world.junctions.delete(`${win.id}|${lose.id}`);
    if (!world.junctions.has(jk)) {
      const t = world.terrain, n = t.size;
      world.events.push({ type: 'junction', from: lose.idx, to: win.idx, x: ((k % n) / (n - 1) - 0.5) * t.worldSize, z: (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize, tick: world.tick });
    }
    world.junctions.set(jk, { from: lose, to: win, made: world.junctions.get(jk)?.made ?? world.tick, until: world.tick + TUNE.liveTicks, share: dw / (dw + dl), s: nearestS(world, lose, k), at: nearestIndex(world, win, k) });
  }
  for (const jk of [...world.junctions.keys()].sort()) {
    const j = world.junctions.get(jk);
    if (world.tick >= j.until || !isRacing(j.from) || !isRacing(j.to)) world.junctions.delete(jk);
  }
  if (!flows.length) return;
  // Net each pair to one flow, so a pair never trades water both ways in a tick.
  const net = new Map();
  for (const f of flows) {
    const fwd = byId(f.win, f.lose) < 0;
    const key = fwd ? `${f.win.id}|${f.lose.id}` : `${f.lose.id}|${f.win.id}`;
    const n = net.get(key) ?? { p: fwd ? f.win : f.lose, q: fwd ? f.lose : f.win, amount: 0, how: f.how };
    n.amount += fwd ? f.amount : -f.amount;
    net.set(key, n);
  }
  flows.length = 0;
  lost.clear();
  for (const key of [...net.keys()].sort()) {
    const n = net.get(key);
    if (n.amount === 0) continue;
    const [win, lose] = n.amount > 0 ? [n.p, n.q] : [n.q, n.p];
    // Hysteresis: a pair whose water ran the other way moments ago doesn't
    // flip on a hair's change in depth; it holds until the new way has led
    // for pairHold ticks.
    const held = world.pairs.get(key);
    if (held && held.win !== win && world.tick - held.tick < TUNE.pairHold) continue;
    if (!held || held.win !== win) world.pairs.set(key, { win, tick: world.tick });
    // Capped at half the gap between them, so one tick's transfer never
    // overshoots and turns the contest round by itself.
    const gap = (win.depth - lose.depth) / Math.max(win.depth, 0.5);
    const amount = Math.min(Math.abs(n.amount), Math.max(0, gap) * 0.5 * lose.volume);
    flows.push({ win, lose, amount, how: n.how });
    lost.set(lose, (lost.get(lose) ?? 0) + amount);
  }
  for (const f of flows) {
    // Scale down evenly if one river is being drained from several sides at once.
    const total = lost.get(f.lose), cap = start.get(f.lose) * TUNE.siphonCap;
    const amount = total > cap ? (f.amount * cap) / total : f.amount;
    grow(f.lose, -amount);
    grow(f.win, amount);
    world.events.push({ type: 'siphon', from: f.lose.idx, to: f.win.idx, amount, how: f.how, tick: world.tick });
    if (!top.has(f.lose) || amount > top.get(f.lose).amount) top.set(f.lose, { by: f.win, amount });
  }
  for (const r of [...top.keys()].sort(byId)) {
    if (r.volume >= knockoutFloor(r)) continue;
    const by = top.get(r).by;
    r.out = { by: by.id, tick: world.tick };
    // What's left of a river knocked out runs on into the one that drained it, so
    // no water leaves the world (T178: the sink barely curbed the snowball and lost
    // about 16% of a crowded field's water per race).
    const gain = TUNE.knockoutHandoff ? r.volume : 0;
    if (gain > 0) { grow(by, gain); grow(r, -gain); }
    world.events.push({ type: 'merge', winner: by.idx, loser: r.idx, gain, how: 'drained', tick: world.tick });
  }
}

// How far down the slope a point is: 0 at the summit end, 1 at the sea end.
export function slopeT(world, x, z) {
  const t = world.terrain, u = (x * t.axis.x + z * t.axis.y) / (t.worldSize / 2);
  return (u + t.long) / (2 * t.long);
}

// Where the heat front stands (as slopeT), or -Infinity before it starts.
export function heatFront(world) {
  const ticks = world.tick - TUNE.heatStart;
  if (ticks < 0) return -Infinity;
  const t = world.terrain;
  return -0.02 + (ticks * TUNE.heatSpeed * DT) / (2 * t.long * (t.worldSize / 2));
}

// Drop clouds this tick: each drains into every river inside it, equally, at
// most water0/cloudDrain a tick, shrinking as it empties and rising as it
// lightens. Once every river has landed, what's left goes into the sky.
// Falling drops that touch and are closing knock each other apart: the
// closing speed, split by weight (a heavier drop is pushed less), becomes a
// fading sideways knock, and each loses water to spray (into the sky store) in
// proportion to how hard it was knocked. Pairs in id order, so the result never
// depends on the order rivers were added.
// The descent's opening (the client's comet shot): no bumps while it plays.
export const calm = (r) => (r.fallT ?? 0) < TUNE.dropCalm;

function dropBumps(world) {
  const falling = world.rivers.filter((r) => isRacing(r) && r.dropping).sort(byId);
  // Slipstream: a drop flying close behind another, at its height, glides faster
  // next tick (less air to push), so a chaser can close on a drop as fast as itself.
  for (const r of falling) {
    r.draft = falling.some((o) => {
      if (o === r) return false;
      const ox = o.x - r.x, oz = o.z - r.z, along = ox * r.dx + oz * r.dz, across = Math.abs(ox * r.dz - oz * r.dx);
      return along > 0 && along < TUNE.draftLength && across < TUNE.draftWidth && Math.abs(o.alt - r.alt) < TUNE.bumpDepth;
    });
  }
  const bumps = (world.bumps ??= new Map());
  for (let i = 0; i < falling.length; i++) for (let j = i + 1; j < falling.length; j++) {
    const a = falling[i], b = falling[j];
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d > TUNE.bumpRadius || Math.abs(a.alt - b.alt) > TUNE.bumpDepth) continue;
    if (calm(a) || calm(b)) continue; // the opening shot: nobody can be hit while they can't steer
    const key = `${a.id}|${b.id}`;
    if (world.tick < (bumps.get(key) ?? -1)) continue;
    const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
    const va = a.glideV ?? TUNE.glideSpeed, vb = b.glideV ?? TUNE.glideSpeed;
    const close = (a.dx * va + (a.kx ?? 0) - b.dx * vb - (b.kx ?? 0)) * nx + (a.dz * va + (a.kz ?? 0) - b.dz * vb - (b.kz ?? 0)) * nz;
    if (close <= TUNE.bumpMin) continue; // drifting apart, or only brushing
    bumps.set(key, world.tick + TUNE.bumpCool);
    const ma = Math.max(0.2, a.size), mb = Math.max(0.2, b.size);
    const ka = close * TUNE.bumpKnock * (mb / (ma + mb)), kb = close * TUNE.bumpKnock * (ma / (ma + mb));
    a.kx = (a.kx ?? 0) - nx * ka; a.kz = (a.kz ?? 0) - nz * ka;
    b.kx = (b.kx ?? 0) + nx * kb; b.kz = (b.kz ?? 0) + nz * kb;
    // Water lost to spray. With bumpSteal (the battle rule): the side that hit with more
    // momentum (water x speed into the other) wins; the loser spills water in proportion
    // to how hard it was hit, the winner soaks up most of it and spills a little itself.
    // Without it: both lose, the harder knocked and the rammed one more (the old rule).
    const ca = Math.max(0, (a.dx * va) * nx + (a.dz * va) * nz), cb = Math.max(0, -((b.dx * vb) * nx + (b.dz * vb) * nz));
    let la, lb, ga = 0, gb = 0;
    if (TUNE.bumpSteal) {
      const pa = a.volume * (ca + 1), pb = b.volume * (cb + 1), aWins = pa > pb || (pa === pb && a.id < b.id);
      const [win, lose, kl] = aWins ? [a, b, kb] : [b, a, ka];
      const spill = Math.min(lose.volume * TUNE.bumpLossMax, lose.volume * TUNE.bumpLoss * 2 * (kl / TUNE.glideSpeed));
      const winSpill = spill * TUNE.bumpWinLoss, take = spill * TUNE.bumpTransfer;
      if (aWins) { lb = spill; la = winSpill; ga = take; } else { la = spill; lb = winSpill; gb = take; }
    } else {
      const ramA = ca + cb > 0 ? ca / (ca + cb) : 0.5;
      const lose = (r, k, ram) => Math.min(r.volume * TUNE.bumpLossMax, r.volume * TUNE.bumpLoss * (k / TUNE.glideSpeed) * (1.5 - ram));
      la = lose(a, ka, ramA); lb = lose(b, kb, 1 - ramA);
      const take = TUNE.bumpTransfer * Math.max(la, lb);
      if (la < lb) ga = take; else gb = take;
    }
    // The hitter (more of its own speed into the other) is checked: slowed for a second.
    // The one hit darts away, faster for half a second, so a bump never pins a drop down.
    const aHits = ca > cb || (ca === cb && a.id < b.id), [hitter, hit] = aHits ? [a, b] : [b, a];
    hitter.recoilT = TUNE.bumpRecoilTicks; hit.burstT = TUNE.bumpBurstTicks;
    hit.hitBy = { id: hitter.id, tick: world.tick };
    grow(a, ga - la); grow(b, gb - lb);
    world.sky = (world.sky ?? 0) + la + lb - ga - gb;
    world.events.push({ type: 'bump', a: a.idx, b: b.idx, hitter: hitter.idx, lossA: la, lossB: lb, gainA: ga, gainB: gb, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, tick: world.tick });
  }
}

function dropClouds(world) {
  const clouds = world.clouds;
  if (!clouds) return;
  const falling = world.rivers.some((r) => isRacing(r) && r.dropping);
  for (const c of clouds) {
    if (c.low) continue;
    const inside = (c.inside ?? []).sort(byId);
    c.inside = [];
    if (!falling && c.water > 0) { world.sky = (world.sky ?? 0) + c.water; c.water = 0; c.taken = -2; continue; }
    if (!inside.length || c.water <= 0) continue;
    const drain = Math.min(c.water, c.water0 / TUNE.cloudDrain), share = drain / inside.length;
    c.water -= drain;
    for (const r of inside) {
      grow(r, share);
      world.events.push({ type: 'cloud', river: r.idx, amount: share, cloud: c.id, tick: world.tick });
    }
    c.radius = Math.max(TUNE.cloudRadius * 0.25, TUNE.cloudRadius * 1.2 * Math.cbrt(c.water / (TUNE.cloudWater[1] * TUNE.dropCloudShare)));
    c.alt += TUNE.cloudLift * (drain / c.water0);
    if (c.water <= 0) c.taken = inside[0].idx;
  }
}

// The water cycle's ledger. The source pump is the one place water comes from
// nothing: it replaces what each channel loses to evaporation and seepage, so
// the river's volume holds, and the losses go to the sky (storms) and the
// ground store (springs, later). Water reaching the sea is counted there.
function waterCycle(world) {
  const w = (world.water ??= { pumped: 0, sky: 0, ground: 0, sea: 0 });
  for (const r of world.rivers) {
    if (!isRacing(r) || r.dropping || !r.path.length) continue;
    const area = r.path[r.path.length - 1].s * widthOf(r);
    const evap = area * TUNE.evapRate, seep = area * TUNE.seepRate;
    world.sky = (world.sky ?? 0) + evap;
    w.ground += seep;
    w.pumped += evap + seep;
  }
  w.sky = world.sky ?? 0;
}

// Weather, once per tick: the heat front dries the lakes it has passed;
// storms rain into whatever is under them. Placed from the state of
// the race and a seeded stream, so every machine agrees.
function weather(world) {
  const front = heatFront(world);
  const racing = world.rivers.filter((r) => isRacing(r) && !r.dropping).sort(byId);
  if (front > -Infinity) {
    if (world.tick === TUNE.heatStart) world.events.push({ type: 'heat', tick: world.tick });
    if ((world.tick - TUNE.heatStart) % TUNE.heatEvery === 0) {
      const t = world.terrain, n = t.size;
      for (const l of world.lakes) {
        const x = (l.gx / (n - 1) - 0.5) * t.worldSize, z = (l.gy / (n - 1) - 0.5) * t.worldSize;
        if (slopeT(world, x, z) >= front || world.lakeVol[l.id] <= 0) continue;
        const dry = Math.min(world.lakeVol[l.id], world.lakeCap[l.id] * TUNE.heatDrop / lakeSpan(world, l.id));
        world.lakeVol[l.id] -= dry;
        world.sky = (world.sky ?? 0) + dry; // up into the sky, for the next storm
        world.events.push({ type: 'evaporate', lake: l.id, amount: dry, tick: world.tick });
      }
    }
  }
  // Storms: each one forms at a random spot past the first quarter of the
  // course and heads off in a random direction, raining steadily as it goes
  // (it shrinks as it empties) and raining into every river (head or channel)
  // and lake under it. A river under it costs the storm double what it gains.
  // Up to stormMax storms at once; after one ends the next waits stormGap.
  if (world.storms.length < TUNE.stormMax && world.tick >= (world.stormNext ?? TUNE.stormStart) && racing.length && (world.sky ?? 0) >= TUNE.stormMinWater) {
    const rng = stream(world.terrain.seed, `storm:${world.tick}:${world.storms.length}`);
    // Around the middle of the field: the mean slope position of the rivers
    // from 3rd place to 3rd from last (the two out front and the two at the
    // back don't pull it), never above the first quarter of the course.
    const landed = racing.filter((r) => !r.dropping);
    const ts = (landed.length ? landed : racing).map((r) => slopeT(world, r.x, r.z)).sort((a, b) => b - a);
    const mid = ts.length >= 5 ? ts.slice(2, ts.length - 2) : ts;
    const hi = mid[0], lo = mid[mid.length - 1], mean = mid.reduce((a, b) => a + b, 0) / mid.length;
    const tAt = Math.min(0.95, Math.max(0.25, Math.min(hi, Math.max(lo, mean + (rng() - 0.5) * (hi - lo)))));
    const t = world.terrain, ax = t.axis.x, az = t.axis.y, half = t.worldSize / 2;
    const u = (tAt * 2 * t.long - t.long) * half, span = TUNE.stormSpan;
    const side = (rng() * 2 - 1) * span * 0.7;
    const x = ax * u - az * side, z = az * u + ax * side;
    const heading = rng() * Math.PI * 2;
    const speed = TUNE.stormSpeed[0] + (TUNE.stormSpeed[1] - TUNE.stormSpeed[0]) * rng();
    const ticks = Math.ceil(((2 * span) / speed) * TICK_HZ);
    const water = Math.min(world.sky, TUNE.stormMaxWater);
    world.sky -= water;
    const s = { id: world.tick * 4 + world.storms.length, x, z, vx: Math.cos(heading) * speed, vz: Math.sin(heading) * speed, until: world.tick + ticks, radius: TUNE.stormRadius, water, water0: water, drizzle: water / ticks };
    world.storms.push(s);
    world.events.push({ type: 'storm', on: true, id: s.id, x, z, radius: s.radius, tick: world.tick });
  }
  const t = world.terrain, n = t.size;
  for (const s of [...world.storms]) {
    if (world.tick >= s.until || s.water <= 0) {
      world.sky = (world.sky ?? 0) + Math.max(0, s.water); // what it didn't rain goes back up
      world.storms.splice(world.storms.indexOf(s), 1);
      world.stormNext = world.tick + TUNE.stormGap;
      world.events.push({ type: 'storm', on: false, id: s.id, tick: world.tick });
      continue;
    }
    s.x += s.vx * DT;
    s.z += s.vz * DT;
    // Off the island (past the summit, the sea or the sides), it's gone.
    const st = slopeT(world, s.x, s.z), side = -s.x * t.axis.y + s.z * t.axis.x;
    if (st < 0 || st > 1.05 || Math.abs(side) > TUNE.stormSpan * 1.1) s.until = world.tick;
    const ledger = (world.water ??= { pumped: 0, sky: 0, ground: 0, sea: 0 });
    // It rains as it travels, onto the ground, and shrinks as it empties.
    const drizzle = Math.min(s.water, s.drizzle);
    s.water -= drizzle; ledger.ground += drizzle;
    s.radius = TUNE.stormRadius * Math.max(0.35, Math.sqrt(Math.max(0, s.water) / s.water0));
    const r2 = s.radius * s.radius;
    for (const r of racing) {
      // Rain on the head counts in full; rain on the channel behind it counts
      // for the share of the storm's width the channel runs under.
      let wet = (r.x - s.x) ** 2 + (r.z - s.z) ** 2 <= r2 ? 1 : 0;
      if (!wet && r.path.length) {
        let under = 0;
        for (let k = r.path.length - 1, prev = null; k >= 0; k -= 4) {
          const p = r.path[k];
          const inside = (p.x - s.x) ** 2 + (p.z - s.z) ** 2 <= r2;
          if (inside && prev) under += Math.abs(prev.s - p.s);
          prev = inside ? p : null;
        }
        wet = Math.min(1, under / (2 * s.radius));
      }
      if (wet <= 0) continue;
      const rain = Math.min(s.water / 2, TUNE.stormRain * wet);
      if (rain <= 0) break;
      s.water -= 2 * rain; ledger.ground += rain; // double off the cloud: half soaks in
      if (r.inLake >= 0) world.lakePending[r.inLake] += rain;
      else grow(r, rain);
      r.rained = world.tick;
    }
    // Lakes under it fill, more the more of them it covers.
    for (const l of world.lakes) {
      const lx = (l.gx / (n - 1) - 0.5) * t.worldSize, lz = (l.gy / (n - 1) - 0.5) * t.worldSize;
      const reach = s.radius + Math.sqrt(l.cells) * t.cell * 0.5;
      if ((lx - s.x) ** 2 + (lz - s.z) ** 2 > reach * reach) continue;
      const rain = Math.min(Math.max(0, s.water), TUNE.stormLakeRain * Math.min(l.cells, TUNE.lakeCellCap));
      s.water -= rain;
      world.lakePending[l.id] += rain;
    }
  }
}

// Water between rivers and lakes, once per tick. A lake is a reservoir:
// - every river pours its discharge into the lake its head is in and into every
//   lake upstream of it that it flowed through; the river's own volume holds
//   while its head is in a lake (the lake is part of its body);
// - a lake drains through the outlets of the rivers that left it: each lip is
//   the ground where the outlet was cut, minus how deep it's cut. Only water
//   standing over a lip flows out, by weir law (head^1.5, times outlet width),
//   so a deeper or wider outlet takes more, whoever got there first; what
//   flows through erodes the outlet deeper, faster with more water over the
//   lip and a bigger river, slowing as the lake falls to the lip; a river's
//   own water passing through is no gain, only what drains out beyond it;
// - more in than out and the level rises, past the lips and past the rim:
//   over the rim it spills into a channel nobody owns, which runs dry once the
//   level falls back. A river whose head is in a spill channel takes its water;
// - you grow only by what leaves through your outlets, never by stored water.
function hydrology(world) {
  const L = world.lakes.length, cap = world.lakeCap, vol = world.lakeVol, t = world.terrain;
  const inflow = world.lakePending;
  world.lakePending = new Float64Array(L);
  const outlets = []; // [lake, river, outlet]
  const flowing = world.rivers.filter((r) => isRacing(r) && !r.dropping).sort(byId);
  for (const r of flowing) {
    r.inflow = 0;
    // (Rivers pour into lakes in pulses, see pulses().)
    for (const [lake, o] of r.via) {
      if (lake === r.inLake) continue; // your own head is in it: you don't drain it
      outlets.push([lake, r, o]);
    }
  }
  const give = (r, q) => {
    // Water reaching a river whose head is in a lake goes into that lake.
    if (r.inLake >= 0) world.lakePending[r.inLake] += q;
    else { grow(r, q); r.inflow += q; }
  };
  const want = new Float64Array(L), lowLip = new Float64Array(L).fill(Infinity);
  for (let lake = 0; lake < L; lake++) { vol[lake] += inflow[lake]; world.lakeIn[lake] = inflow[lake]; }
  const open = [];
  for (const [lake, r, o] of outlets) {
    const lip = t.filled[o.cell] - o.e;
    const h = Math.min(TUNE.outletMax, lakeLevel(world, lake) - lip);
    if (h <= 0) continue;
    const q = TUNE.outletK * (o.w / TUNE.width) * h * Math.sqrt(h);
    open.push([lake, r, o, q, h]);
    want[lake] += q;
    if (lip < lowLip[lake]) lowLip[lake] = lip;
  }
  // No outlet drains a lake below its own lip: the total is capped by the
  // water standing over the lowest open lip.
  const scale = new Float64Array(L).fill(1);
  for (let lake = 0; lake < L; lake++) {
    if (!want[lake]) continue;
    const avail = vol[lake] - lakeVolAt(world, lake, lowLip[lake]);
    if (want[lake] > avail) scale[lake] = Math.max(0, avail) / want[lake];
  }
  const out = new Float64Array(L);
  for (const [lake, r, o, w, h] of open) {
    const q = w * scale[lake];
    if (q <= 0) continue;
    vol[lake] -= q;
    out[lake] += q;
    // Rivers' water passing through is already theirs: only what drains out
    // beyond it (the lake's stored water, rain) makes you bigger.
    // (Rivers' water passing through is on account at the lake: it flows
    // out again first, and only the lake's own water beyond it is a gain.)
    const through = Math.min(q, world.lakeFlow[lake]);
    world.lakeFlow[lake] -= through;
    const gain = q - through;
    // It joins the river at the outlet and comes down with the next pulse.
    if (gain > 0) {
      feed(r, o.at ?? 0, gain);
      r.inflow += gain;
      r.lakeTaken = (r.lakeTaken ?? 0) + gain; // lake water shortens skill cooldowns (coolOf)
      (r.lakeFeeds ??= new Map()).set(o.at ?? 0, lake); // that pulse is this lake's water
    }
    // Erosion follows the water over the lip and the river's volume: a high
    // lake and a big river cut fast; as the lake drops to the lip it slows.
    o.e = Math.min(t.filled[o.cell] - SEA_LEVEL - 0.5, outletFloor(world, lake, o.cell), o.e + TUNE.erodeK * h * r.size);
  }
  // Over the rim: spill.
  for (let lake = 0; lake < L; lake++) {
    const hs = lakeLevel(world, lake) - world.lakeBrim[lake];
    let sp = world.spills.get(lake);
    if (hs <= 0 || world.lakeOutlet[lake] < 0) {
      if (sp?.on) { sp.on = false; sp.flow = 0; world.events.push({ type: 'overflow', lake, on: false, tick: world.tick }); }
      world.lakeOut[lake] = out[lake];
      continue;
    }
    if (!sp) { sp = spillChannel(world, lake); world.spills.set(lake, sp); }
    if (!sp.on) { sp.on = true; world.events.push({ type: 'overflow', lake, on: true, tick: world.tick }); }
    const q = Math.min(vol[lake] - cap[lake], TUNE.spillK * hs * Math.sqrt(hs));
    vol[lake] -= q;
    sp.flow = q;
    out[lake] += q;
    world.lakeOut[lake] = out[lake];
    // Rivers with their head in the spill channel share it by depth; the rest
    // runs on into the lake (if any) the channel ends in.
    const taps = flowing.filter((r) => r.inLake < 0 && sp.cells.has(cellIndex(t, r.x, r.z)));
    const dsum = taps.reduce((a, r) => a + r.depth, 0);
    for (const r of taps) give(r, (q * r.depth) / dsum);
    if (!taps.length && sp.into >= 0) world.lakePending[sp.into] += q;
  }
}

// A lake's spill channel: from its spill point down the fill's downhill tree
// to the sea, the next lake, or spillCells long. Cut once, shallow, owned by
// nobody; it never erodes, so it stays a temporary channel.
function spillChannel(world, lake) {
  const t = world.terrain, n = t.size, path = [], cells = new Set();
  let k = world.lakeOutlet[lake], into = -1;
  while (k >= 0 && path.length < TUNE.spillCells) {
    if (world.lakeOf[k] >= 0 && world.lakeOf[k] !== lake) { into = world.lakeOf[k]; break; }
    if (t.filled[k] <= SEA_LEVEL) break;
    path.push(k);
    k = downhill(t, k);
  }
  const rad = Math.max(1, Math.round(TUNE.spillWidth / 2 / t.cell));
  for (const c of path) {
    const cx = c % n, cy = (c - cx) / n;
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 1 || y < 1 || x >= n - 1 || y >= n - 1 || dx * dx + dy * dy > rad * rad) continue;
      const j = y * n + x;
      cells.add(j);
      if (world.owner[j] >= 0 || underWater(world, j) || t.filled[j] <= SEA_LEVEL) continue;
      const v = Math.min(TUNE.spillDepth * (1 - (dx * dx + dy * dy) / (rad * rad + 1)), t.height[j] - SEA_LEVEL - 0.5);
      if (v > world.carve[j]) { world.carve[j] = v; world.dirty.push(j); }
    }
  }
  return { path, cells, into, flow: 0, on: false };
}

// Water waiting at a point of a river's channel for the next pulse.
function feed(r, at, litres) {
  if (litres > 0) r.feeds.set(at, (r.feeds.get(at) ?? 0) + litres);
}

// The path point of river r nearest cell k (searching back from the head).
function nearestIndex(world, r, k) {
  const t = world.terrain, n = t.size;
  const kx = ((k % n) / (n - 1) - 0.5) * t.worldSize, kz = (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize;
  let best = Math.max(0, r.path.length - 1), bd = Infinity;
  for (let i = r.path.length - 1; i >= 0; i--) {
    const d = (r.path[i].x - kx) ** 2 + (r.path[i].z - kz) ** 2;
    if (d < bd) { bd = d; best = i; }
    if (bd < t.cell * t.cell && d > bd * 100) break;
  }
  return best;
}
const nearestS = (world, r, k) => r.path[nearestIndex(world, r, k)]?.s ?? 0;

export function pulseEvery(r) {
  for (const [below, ticks] of TUNE.pulseEvery) if (r.volume < below) return ticks;
  return TUNE.pulseEvery[TUNE.pulseEvery.length - 1][1];
}

// Pulses, once per tick: release, run down the channel, arrive.
function pulses(world) {
  const t = world.terrain, n = t.size;
  const cutsOf = new Map();
  for (const jk of [...world.junctions.keys()].sort()) {
    const j = world.junctions.get(jk);
    if (!cutsOf.has(j.from)) cutsOf.set(j.from, []);
    cutsOf.get(j.from).push(j);
  }
  for (const r of world.rivers.filter((o) => isRacing(o) && !o.dropping && o.path.length).sort(byId)) {
    const head = r.path[r.path.length - 1].s;
    // Release: the source's pulse carries the river's flow for the interval
    // (what it pours into lakes) and the water gathered since the last one;
    // water waiting further down (lake outlets, rivals' cuts) leaves there.
    if (world.tick >= r.pulseAt) {
      const every = pulseEvery(r);
      r.pulseAt = world.tick + every;
      r.pulses.push({ s: 0, i: 0, amount: r.feeds.get(0) ?? 0, flow: dischargeOf(r) * every, every, erode: true, lakes: [] });
      for (const [at, litres] of [...r.feeds].sort((a, b) => a[0] - b[0])) {
        if (at === 0) continue;
        const p = r.path[Math.min(at, r.path.length - 1)];
        r.pulses.push({ s: p.s, i: Math.min(at, r.path.length - 1), amount: litres, flow: 0, every, erode: false, lakes: [], lake: r.lakeFeeds?.get(at) ?? -1 });
      }
      r.feeds.clear();
      r.lakeFeeds?.clear();
      world.events.push({ type: 'pulse', river: r.idx, tick: world.tick });
    }
    const v = TUNE.pulseSpeed * Math.max(r.speed, TUNE.baseSpeed);
    const cuts = cutsOf.get(r) ?? [];
    const flow = 0.7 * depthOf(r);
    const keep = [];
    for (const p of r.pulses) {
      const s0 = p.s, s1 = s0 + v * DT;
      // Every path point passed this tick.
      while (p.i < r.path.length && r.path[p.i].s <= s1) {
        const q = r.path[p.i++], c = cellIndex(t, q.x, q.z);
        // (The head itself doesn't erode: a head that stops can't dig itself a pit.)
        if (p.erode && p.i <= r.path.length - TUNE.headSpared) erodeAt(world, r, c, flow, p.every);
        const lake = world.lakeOf[c];
        if (lake >= 0 && !p.lakes.includes(lake) && lake !== r.inLake) {
          // Into a lake on the way: it pours the river's flow in, and if
          // the lake stands below this river's outlet it soaks up the pulse
          // until it's back up to the lip.
          p.lakes.push(lake);
          world.lakePending[lake] += p.flow;
          world.lakeFlow[lake] += p.flow; // river water passing through, no one's gain
          const o = r.via.get(lake);
          if (o && p.amount > 0) {
            const short = lakeVolAt(world, lake, t.filled[o.cell] - o.e) - world.lakeVol[lake] - world.lakePending[lake];
            if (short > 0) {
              const take = Math.min(p.amount, short);
              p.amount -= take;
              world.lakePending[lake] += take;
              world.events.push({ type: 'soak', river: r.idx, lake, amount: take, tick: world.tick });
            }
          }
          // Lakes are junctions (owner, 2026-11-09): the wave ends here. Its water joins the lake, and the
          // lake's rising level pours out through every outlet (by depth over each lip), feeding every river
          // that leaves it. Not river water passing through: the lake's own gain, shared by all its outlets.
          if (TUNE.lakeJunctions && p.amount > 0) {
            // Shared at once over every river leaving the lake, by how deep each has cut its outlet
            // (stored in the lake, a full lake spilled it into ownerless channels: finishes 9 -> 5).
            const outs = world.rivers.filter((o) => isRacing(o) && !o.dropping && o.via.has(lake)).sort(byId);
            const wsum = outs.reduce((a, o) => a + Math.max(0.5, o.via.get(lake).e), 0);
            for (const o of outs) feed(o, o.via.get(lake).at ?? 0, p.amount * Math.max(0.5, o.via.get(lake).e) / wsum);
            if (outs.length) p.amount = 0;
          }
        }
      }
      // A rival's cut on the way takes its share.
      for (const j of cuts) {
        if (j.s <= s0 || j.s > s1 || p.amount <= 0) continue;
        // Not against the way water is running between the pair right now.
        const pk = byId(r, j.to) < 0 ? `${r.id}|${j.to.id}` : `${j.to.id}|${r.id}`, held = world.pairs.get(pk);
        if (held && held.win !== j.to && world.tick - held.tick < TUNE.pairHold * 3) continue;
        if (!held || held.win !== j.to) world.pairs.set(pk, { win: j.to, tick: world.tick });
        const take = p.amount * j.share;
        p.amount -= take;
        feed(j.to, j.at, take);
        world.events.push({ type: 'siphon', from: r.idx, to: j.to.idx, amount: take, how: 'junction', tick: world.tick });
      }
      p.s = s1;
      if (s1 < head) { keep.push(p); continue; }
      // At the head: the river swells (or, with its head in a lake, the lake does).
      // With its head in a lake below its rim, the pulse fills the lake; a
      // full lake passes it straight on to the head (what flows into a full
      // reservoir flows out), so the head still swells and surges.
      const L = r.inLake;
      if (L >= 0 && lakeLevel(world, L) < world.lakeBrim[L]) { world.lakePending[L] += p.flow + p.amount; world.lakeFlow[L] += p.flow; }
      else if (p.amount > 0) {
        grow(r, p.amount);
        // The wave hits the head and shoves it on: a surge of speed, bigger
        // the more water the pulse brings against what the river already
        // carries, past its usual top speed for a moment; its momentum then
        // carries it (heavy water slows only slowly).
        const shove = TUNE.surge * TUNE.baseSpeed * Math.min(1, p.amount / (r.volume * TUNE.surgeShare));
        r.speed = Math.min(r.speed + shove, TUNE.maxSpeed * (r.mass ?? 1) * TUNE.surgeCap);
      }
      world.events.push({ type: 'swell', river: r.idx, amount: p.amount, lake: p.lake ?? -1, tick: world.tick });
    }
    r.pulses = keep;
  }
}

// A pulse passing erodes the channel: by the water over each cell (the
// river's flow depth, shallower at the banks), the river's size and the slope
// there, for the whole interval since the last pulse. Big rivers on steep
// ground carve canyons; small ones on the flats barely scour.
// The mountain top is rock down to rockBelow metres (by water) under the start line: channels there never erode.
const onRock = (world, k) => world.toBeach[k] > startLine(world).L - TUNE.rockBelow;

function erodeAt(world, r, c, flow, every) {
  const t = world.terrain, n = t.size, cx = c % n, cy = (c - cx) / n;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const k = (cy + dy) * n + cx + dx;
    if (k < 0 || k >= n * n || world.owner[k] !== r.idx || t.filled[k] <= SEA_LEVEL || underWater(world, k) || onRock(world, k)) continue;
    if (world.erodedBy?.[k] === world.tick) continue; // once a tick, however many points cross it
    (world.erodedBy ??= new Int32Array(n * n).fill(-1))[k] = world.tick;
    const was = world.carve[k];
    const f = t.filled, kx = k % n;
    const sx = (f[kx < n - 1 ? k + 1 : k] - f[kx > 0 ? k - 1 : k]) / (2 * t.cell);
    const sz = (f[k + n < n * n ? k + n : k] - f[k - n >= 0 ? k - n : k]) / (2 * t.cell);
    const slope = Math.sqrt(sx * sx + sz * sz);
    const add = TUNE.trailErode * every * Math.min(flow, was) * r.size * (1 + slope / TUNE.slopeErode);
    // Deep canyons cut slower, but never stop.
    const v = Math.min(t.height[k] + world.rock[k] - SEA_LEVEL - 0.5, was + add / (1 + was / (TUNE.depth * 3)));
    if (v <= was) continue;
    world.carve[k] = v;
    if (Math.floor(v * 4) !== Math.floor(was * 4)) world.dirty.push(k);
  }
}

// Erosion is forever: every river's whole channel keeps deepening as long as
// it pours, a pulse at a time, never below sea level.
function erodeTrails(world) {
  // The channel erodes as pulses pass (see erodeAt). Outlets are recut to
  // how far they have eroded, every trailPasses ticks.
  if (world.tick % TUNE.trailPasses) return;
  const t = world.terrain, n = t.size;
  for (const r of world.rivers.filter((o) => isRacing(o) && !o.dropping).sort(byId)) {
    for (const [, o] of r.via) {
      const x = ((o.cell % n) / (n - 1) - 0.5) * t.worldSize, z = (Math.floor(o.cell / n) / (n - 1) - 0.5) * t.worldSize;
      world.digs.push({ r, x, z, width: widthOf(r), depth: o.e, bed: t.filled[o.cell] - o.e });
    }
  }
}

// Litres per tick a river delivers into lakes downstream of it: heavier rivers
// carry more (size squared), so they fill basins faster.
// Drained below this a river is out: 40% of the starting water, or half the
// most it has ever held, whichever is higher (ADR 0007).
export function knockoutFloor(r) {
  return Math.max(TUNE.floor * TUNE.startVolume, TUNE.floorPeak * (r.peak ?? r.volume));
}

export function dischargeOf(r) {
  return TUNE.discharge * r.size * r.size;
}

export function isLive(world, k) {
  // A trail is live for as long as its river pours (finished ones included);
  // once a river is drained out its channel dries after liveTicks.
  const o = world.owner[k];
  if (o < 0) return false;
  const r = world.rivers[o];
  return !r.out || world.tick - Math.max(world.dugAt[k], r.out.tick) < TUNE.liveTicks;
}

// Cutting depth from mass (size) and speed: 0.7x when crawling, up to 1.42x at
// top speed. Linear, so it stays deterministic everywhere.
// How tall the water stands at the head, metres: it grows with volume (as
// size, the fourth root), so a bigger river pushes over rises a small one can't.
// How high the water can run up a rise: the head's height plus what its
// speed carries it (fast water surges over bumps, slow water stops at them).
// Does this head break trees? By force: size times speed (a small fast head smashes through, a slow one is held up).
export const breaksTrees = (r) => (r.size ?? 1) * Math.max(r.speed ?? 0, TUNE.minSpeed) / TUNE.baseSpeed >= TUNE.treeBreak;

export function liftOf(r) {
  const v = (r.speed ?? 0) / TUNE.baseSpeed;
  return headOf(r) + Math.min(TUNE.surgeLiftMax, TUNE.surgeLift * v * v) + (r.boost > 0 ? TUNE.gougeLift * (r.size ?? 1) : 0) + (r.surgeT >= 0 ? TUNE.surgeHop : 0);
}

export function headOf(r) {
  return TUNE.headPerSize * r.size * r.size; // grows fast: a big river plows over banks a small one can't
}

export function depthOf(r) {
  return TUNE.depth * r.size * (0.7 + 0.6 * Math.min(1.2, r.speed / TUNE.maxSpeed));
}

export function widthOf(r) {
  return Math.min(TUNE.maxWidth, TUNE.width * r.size);
}

// Finish order, then racers by distance left, then the absorbed (latest out first).
export function standings(world) {
  const fin = world.rivers.filter((r) => r.finished).sort((a, b) => a.finishTick - b.finishTick || biggerFirst(a, b));
  const left = (r) => world.toBeach[cellIndex(world.terrain, r.x, r.z)];
  const racing = world.rivers.filter(isRacing).sort((a, b) => left(a) - left(b) || byId(a, b));
  const out = world.rivers.filter((r) => r.out).sort((a, b) => b.out.tick - a.out.tick || biggerFirst(a, b));
  return [...fin, ...racing, ...out];
}

// Behind the start line: land whose water route to the beach is longer than the
// line's. A landed river can never go there (owner, 2026-11-09).
export function behindLine(world, x, z) {
  const t = world.terrain, k = cellIndex(t, x, z);
  if (!(t.filled[k] > SEA_LEVEL)) return false;
  const tb = world.toBeach[k], line = startLine(world);
  if (tb < 1e8) return tb > line.L * (1 + TUNE.lineTol);
  return slopeT(world, x, z) < line.t; // ground with no route to the beach: judge by the slope
}

function moveTo(world, r, nx, nz) {
  const half = world.terrain.worldSize / 2;
  nx = Math.max(-half, Math.min(half, nx));
  nz = Math.max(-half, Math.min(half, nz));
  // The start line is a wall from the course side: slide along it, never through.
  // (Not at sea: the current along the coast may brush land behind the line, and must carry on to the beach.)
  if (!r.dropping && world.terrain.filled[cellIndex(world.terrain, r.x, r.z)] > SEA_LEVEL && behindLine(world, nx, nz) && !behindLine(world, r.x, r.z)) {
    if (!behindLine(world, nx, r.z)) nz = r.z;
    else if (!behindLine(world, r.x, nz)) nx = r.x;
    else {
      // Blocked both ways (heading along the line): turn down the slope and go that way, never
      // freeze on the line (a river landed facing along it stood still for 90 s).
      const ax = world.terrain.axis.x, az = world.terrain.axis.y, d = Math.hypot(nx - r.x, nz - r.z);
      if (!behindLine(world, r.x + ax * d, r.z + az * d)) { nx = r.x + ax * d; nz = r.z + az * d; r.dx = ax; r.dz = az; }
      // else: every way is 'behind' (the route twists right at the line): let it go rather than freeze it there.
    }
  }
  const mx = nx - r.x, mz = nz - r.z;
  const moved = Math.sqrt(mx * mx + mz * mz);
  r.travelled += moved;
  r.x = nx; r.z = nz;
  // In a lake the river's volume holds: its water goes into the lake.
  // What a longer channel gathers comes down it from the source, in pulses.
  if (world.lakeOf[cellIndex(world.terrain, nx, nz)] < 0) {
    const behind = TUNE.catchUp && world.leadReach !== undefined && world.toBeach[cellIndex(world.terrain, nx, nz)] - world.leadReach > TUNE.catchUpGap;
    feed(r, 0, moved * TUNE.trickle * (1 + r.travelled / TUNE.trickleGrowth) * (behind ? 1 + TUNE.catchUp : 1));
  }
}

// Send a head on a lake to its lowest exit, by a path over the lake's water
// (lake and its shallow fringe), found breadth-first so every machine agrees.
function setExit(world, r, lake) {
  const t = world.terrain, n = t.size, goal = lowestExit(world, lake, r);
  if (goal < 0) return;
  const start = cellIndex(t, r.x, r.z), from = new Map([[start, -1]]), queue = [start];
  // Over the water, or ground no higher than the head can stand on.
  const top = Math.max(r.low, lakeLevel(world, lake)) + TUNE.climb + headOf(r);
  const wet = (k) => world.lakeOf[k] === lake || (world.lakeOf[k] < 0 && underWater(world, k)) || t.filled[k] + world.rock[k] <= top;
  let end = -1;
  for (let q = 0; q < queue.length && end < 0; q++) {
    const c = queue[q], cx = c % n, cy = (c - cx) / n;
    for (let dy = -1; dy <= 1 && end < 0; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy, k = y * n + x;
      if ((!dx && !dy) || x < 0 || y < 0 || x >= n || y >= n || from.has(k)) continue;
      if (k === goal) { from.set(k, c); end = k; break; }
      if (!wet(k)) continue;
      from.set(k, c);
      queue.push(k);
    }
  }
  const path = [];
  for (let k = end >= 0 ? end : goal; k >= 0; k = from.get(k) ?? -1) path.push(k);
  path.reverse();
  r.exit = goal; r.exitPath = path; r.exitStep = 0;
}

// Where water blocked at cell c runs next: down the fill's downhill tree, or,
// for a river too small to knock trees down, down the shortest way to the
// sea round the stands (the fill's tree runs straight through them).
function wayOut(world, r, c) {
  const t = world.terrain, round = world.roundReach;
  if (!round || breaksTrees(r) || round[c] < 0) return downhill(t, c);
  const n = t.size, cx = c % n, cy = (c - cx) / n;
  let best = -1, bd = round[c];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = cx + dx, y = cy + dy;
    if ((!dx && !dy) || x < 0 || y < 0 || x >= n || y >= n) continue;
    const k = y * n + x;
    if (round[k] < 0 || round[k] >= bd || t.filled[k] > t.filled[c] + TUNE.climb) continue;
    bd = round[k]; best = k;
  }
  return best >= 0 ? best : downhill(t, c);
}

// A lake's lowest way out: its spill point or the lip of any outlet cut from it.
function lowestExit(world, lake, self) {
  const f = world.terrain.filled;
  let best = world.lakeOutlet[lake], low = best >= 0 ? f[best] : Infinity;
  for (const o of world.rivers) {
    if (o === self) continue; // not back to where it already failed to get out
    const ot = o.via.get(lake);
    // (Ties go to the lower cell index, not to whichever river was added first:
    // the race must not depend on the order rivers joined.)
    const lip = f[ot?.cell] - ot?.e;
    if (ot && (lip < low || (lip === low && ot.cell < best)) && !drainsBack(world, ot.cell, lake)) { low = lip; best = ot.cell; }
  }
  return best;
}

// Whether the ground past an outlet runs straight back into its own lake. A
// river that left over a bank cut its outlet where it climbed out, and the
// fill's downhill tree from there can lead back in: an exit there only loops.
function drainsBack(world, cell, lake) {
  const t = world.terrain;
  for (let k = cell, i = 0; k >= 0 && i < 64; k = downhill(t, k), i++) {
    if (world.lakeOf[k] === lake) return true;
    if (world.lakeOf[k] >= 0) return false;
  }
  return false;
}

// The deepest an outlet may be cut: its lip never more than outletDrain below
// the level the lake starts at, so outlets bleed a lake's top off (and feed
// rivers from the start) but never empty it into a pit.
export const outletLipFloor = (world, lake) =>
  world.lakeBed[lake] + Math.max(0.5, world.lakeBrim[lake] - world.lakeBed[lake]) * TUNE.lakeStart - TUNE.outletDrain;
function outletFloor(world, lake, cell) {
  return Math.max(0, world.terrain.filled[cell] - outletLipFloor(world, lake));
}

function joinLake(world, r, lake, cell) {
  if (r.via.has(lake)) return; // already has an outlet from this lake
  // The head floats on the lake, so it cuts its outlet down from the water it
  // rides on (or the bank, if lower): a river leaving a drained lake cuts a
  // lower outlet. As wide as the head; from then on only the water through it
  // deepens it.
  const ground = world.terrain.filled[cell];
  const lip = Math.max(SEA_LEVEL + 0.5, Math.min(ground, lakeLevel(world, lake)) - r.depth);
  r.via.set(lake, { cell, e: Math.max(0, Math.min(ground - lip, outletFloor(world, lake, cell))), w: widthOf(r), born: world.tick, at: Math.max(0, r.path.length - 1) });
  r.lakes++;
  // Joining a lake adds its water to yours at once, then keeps flowing.
  // A full lake's surge comes off the brim: it doesn't lower the lake (a lake
  // only falls when more flows out than in).
  const take = world.lakeVol[lake] * TUNE.joinShare;
  grow(r, take);
  world.events.push({ type: 'join', lake, river: r.idx, gain: take, tick: world.tick });
}

// A skill's cooldown, shortened 0.1% per 10k L of lake water the river has taken in (owner, 2026-11-09).
export function coolOf(r, ticks) {
  const k = Math.max(TUNE.lakeCoolMin, 1 - TUNE.lakeCoolPer * (r.lakeTaken ?? 0) / TUNE.lakeCoolLitres);
  return Math.max(1, Math.round(ticks * k));
}

function grow(r, litres) {
  r.volume += litres;
  if (!(r.volume <= (r.peak ?? 0))) r.peak = r.volume; // the most it has held: sets its knockout floor
  r.size = sizeOf(r.volume) + (r.boost > 0 ? TUNE.gougeGrow : 0); // (a Gouge boost adds size while it lasts)
}

function afterMove(world, r) {
  const here = cellIndex(world.terrain, r.x, r.z);
  // Flowing under a low rain cloud: its water is yours (first come).
  for (const c of predicting ? [] : skyClouds(world)) {
    if (!c.low || c.taken >= 0 || (c.x - r.x) ** 2 + (c.z - r.z) ** 2 > TUNE.cloudRadius ** 2) continue;
    c.taken = r.idx;
    grow(r, c.water);
    world.events.push({ type: 'cloud', river: r.idx, amount: c.water, cloud: c.id, tick: world.tick });
  }
  if (world.lava[here]) {
    // Boiling off: water and speed, but lava alone never knocks a river out.
    const floor = TUNE.floor * TUNE.startVolume * TUNE.steamFloor;
    const boil = Math.max(0, Math.min(r.volume * TUNE.steam, r.volume - floor));
    if (boil > 0) grow(r, -boil);
    r.speed *= TUNE.lavaSlow;
    world.events.push({ type: 'steam', river: r.idx, amount: boil, tick: world.tick });
  }
  // Lakes: entering one pours your water in; a basin below full fills from
  // every river running into it, but nobody waits for it: the head flows on
  // across at its momentum. Leaving one cuts your outlet from it, and its
  // water starts flowing to you.
  const lake = world.lakeOf[here];
  if (lake !== r.inLake) {
    if (r.inLake >= 0) { joinLake(world, r, r.inLake, here); r.leftLake = r.inLake; }
    r.inLake = lake;
    if (lake >= 0 && !r.via.has(lake)) {
      world.events.push({ type: 'pool', lake, river: r.idx, tick: world.tick });
    }
  }
  const last = r.path[r.path.length - 1];
  const lx = r.x - last.x, lz = r.z - last.z;
  if (lx * lx + lz * lz >= (world.terrain.cell * 0.75) ** 2) pushPathPoint(world, r);
  const kEnd = cellIndex(world.terrain, r.x, r.z);
  if (world.terrain.filled[kEnd] <= SEA_LEVEL && world.beach[kEnd]) {
    (world.water ??= { pumped: 0, sky: 0, ground: 0, sea: 0 }).sea += r.volume; // its water joins the sea
    r.finished = true;
    r.finishTick = world.tick;
    pushPathPoint(world, r);
  }
}

// The one finish: the stretch of coast where the slope's axis meets the sea,
// beachRadius either side. beach marks its sea cells, beachLand the shore cells
// behind them (drawn as the finish), seaNext is each sea cell's step toward it,
// and toBeach the shortest route water can take there (HUD, standings, bots).
function finishBeach(t) {
  const n = t.size, f = t.filled, cell = (x, z) => cellIndex(t, x, z);
  let px = 0, pz = 0;
  for (let s = 0; s < t.worldSize; s += t.cell * 0.5) {
    const x = t.axis.x * s, z = t.axis.y * s;
    if (f[cell(x, z)] <= SEA_LEVEL) { px = x; pz = z; break; }
  }
  const beach = new Uint8Array(n * n), beachLand = [];
  const R2 = TUNE.beachRadius * TUNE.beachRadius;
  const pos = (k) => [((k % n) / (n - 1) - 0.5) * t.worldSize, (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize];
  for (let k = 0; k < n * n; k++) {
    const [x, z] = pos(k), d2 = (x - px) ** 2 + (z - pz) ** 2;
    if (d2 > (TUNE.beachRadius + 1500) ** 2) continue;
    if (f[k] <= SEA_LEVEL) { if (d2 <= R2) beach[k] = 1; continue; }
    if (d2 > R2) continue;
    const kx = k % n, ky = (k - kx) / n;
    let shore = false;
    for (let dy = -1; dy <= 1 && !shore; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = kx + dx, y = ky + dy;
      if (x >= 0 && y >= 0 && x < n && y < n && f[y * n + x] <= SEA_LEVEL) { shore = true; break; }
    }
    if (shore) beachLand.push(k);
  }
  // Sea current: breadth-first over sea cells from the beach.
  const seaNext = new Int32Array(n * n).fill(-1), seen = new Uint8Array(n * n), queue = [];
  for (let k = 0; k < n * n; k++) if (beach[k]) { seen[k] = 1; queue.push(k); }
  for (let q = 0; q < queue.length; q++) {
    const a = queue[q], ax = a % n, ay = (a - ax) / n;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = ax + dx, y = ay + dy, b = y * n + x;
      if ((!dx && !dy) || x < 0 || y < 0 || x >= n || y >= n || seen[b] || f[b] > SEA_LEVEL) continue;
      seen[b] = 1; seaNext[b] = a; queue.push(b);
    }
  }
  return { beach, beachLand, beachAt: { x: px, z: pz }, seaNext, toBeach: descentDistance(t, beach) };
}

function seaCurrent(world, r, k) {
  const t = world.terrain, n = t.size;
  if (t.filled[k] <= SEA_LEVEL) r.seaCell = k;
  let to = k;
  for (let i = 0; i < 3 && world.seaNext[to] >= 0; i++) to = world.seaNext[to];
  const tx = ((to % n) / (n - 1) - 0.5) * t.worldSize - r.x, tz = (Math.floor(to / n) / (n - 1) - 0.5) * t.worldSize - r.z;
  const tl = Math.sqrt(tx * tx + tz * tz);
  if (!r.offCourse) { r.offCourse = true; world.events.push({ type: 'offcourse', river: r.idx, tick: world.tick }); }
  r.speed = TUNE.seaCurrent;
  r.depth = depthOf(r);
  if (tl < 1e-6) return;
  // (The current moves the water; the heading stays the player's.)
  const step = Math.min(tl, r.speed * DT);
  moveTo(world, r, r.x + (tx / tl) * step, r.z + (tz / tl) * step);
  afterMove(world, r);
}

// The route preview: run the real movement rules on a copy of a river for
// `ticks`, holding the stick still, against a ghost of the world that keeps
// its own events, digs and clock, so nothing shared changes (no ground worn,
// no cloud taken). Rivals, pulses and weather don't move in the preview.
// Returns [{ x, z, speed, kind }] with kind 'run' | 'slow' | 'route' | 'stuck'.
let predicting = false;
export function predictPath(world, r, ticks = 120, every = 4) {
  if (!isRacing(r) || r.dropping) return [];
  const ghost = Object.create(world);
  Object.assign(ghost, { events: [], digs: [], dirty: [], tick: world.tick });
  const g = {
    ...r, path: r.path.slice(-2), via: new Map(r.via), feeds: new Map(), pulses: [], lakeFeeds: new Map(),
    exitPath: r.exitPath ? r.exitPath.slice() : null,
  };
  const out = [];
  predicting = true;
  try {
    for (let i = 0; i < ticks && isRacing(g); i++) {
      moveRiver(ghost, g, { s: 0, f: 0, k: 0 });
      ghost.tick++;
      if (i % every === every - 1) {
        // A rival's live channel under this point: its depth against what this river's head will be (the preview's markers).
        const k = cellIndex(world.terrain, g.x, g.z), o = world.owner[k];
        const cross = o >= 0 && o !== r.idx && isLive(world, k) && world.carve[k] > TUNE.contactDepth ? { o, theirs: world.carve[k], mine: depthOf(g) } : null;
        out.push({ x: g.x, z: g.z, speed: g.speed, cross, kind: g.stuck || g.filling ? 'stuck' : g.route !== null || g.exit >= 0 ? 'route' : g.speed < TUNE.climbSpeed ? 'slow' : 'run' });
      }
    }
  } finally { predicting = false; }
  return out;
}

export function cellIndex(t, wx, wz) {
  const n = t.size;
  const x = Math.max(0, Math.min(n - 1, Math.round((wx / t.worldSize + 0.5) * (n - 1))));
  const y = Math.max(0, Math.min(n - 1, Math.round((wz / t.worldSize + 0.5) * (n - 1))));
  return y * n + x;
}

// Record a path point and queue the channel under it: a flat-bottomed trench
// at (centre surface - depth), feathered at the banks.
function pushPathPoint(world, r) {
  const t = world.terrain;
  // Bed depth is measured from undug ground, so passes never stack into a pit.
  const centre = surfaceAt(world, r.x, r.z, r.idx);
  const width = widthOf(r), depth = r.depth;
  const bed = Math.min(centre, sampleFilled(t, r.x, r.z)) - depth;
  const last = r.path[r.path.length - 1];
  const s = last ? last.s + Math.sqrt((r.x - last.x) ** 2 + (r.z - last.z) ** 2) : 0;
  r.path.push({ x: r.x, z: r.z, water: centre - depth * 0.3, w: width, tick: world.tick, s });
  world.digs.push({ r, x: r.x, z: r.z, width, depth, bed });
}

function deepenChannels(world) {
  if (!world.deepen?.length) return;
  const t = world.terrain;
  for (const r of world.deepen.sort(byId)) {
    for (let k = 0; k < world.carve.length; k++) {
      if (world.owner[k] !== r.idx || !(world.carve[k] > 0) || onRock(world, k)) continue;
      const v = Math.min(world.carve[k] * (1 + TUNE.gougeDeepen), Math.max(0, t.height[k] + world.rock[k] - SEA_LEVEL - 0.5)); // never below the sea
      if (v > world.carve[k]) { world.carve[k] = v; world.dirty.push(k); }
    }
  }
  world.deepen.length = 0;
}

function applyDigs(world) {
  deepenChannels(world);
  const digs = world.digs.sort((a, b) => byId(a.r, b.r));
  world.digs = [];
  for (const d of digs) dig(world, d);
}

function dig(world, { r, x: px, z: pz, width, depth, bed }) {
  const t = world.terrain, n = t.size, cell = t.cell;
  const rad = width / 2, feather = cell * 0.6;
  let felled = 0, cells = 0; // trees knocked down here, of the cells the head covers
  const gx = (px / t.worldSize + 0.5) * (n - 1), gy = (pz / t.worldSize + 0.5) * (n - 1);
  const reach = Math.ceil((rad + feather) / cell);
  const cx = Math.round(gx), cy = Math.round(gy);
  for (let y = cy - reach; y <= cy + reach; y++) {
    if (y < 1 || y >= n - 1) continue;
    for (let x = cx - reach; x <= cx + reach; x++) {
      if (x < 1 || x >= n - 1) continue;
      const ddx = (x - gx) * cell, ddy = (y - gy) * cell;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d > rad + feather) continue;
      const k = y * n + x;
      cells++;
      const ground = t.filled[k];
      if (ground <= SEA_LEVEL) continue;
      if (underWater(world, k)) continue; // rivers run over lakes, not through their beds: only banks erode
      if (world.trees[k]) {
        // A big river knocks the trees flat; a small one's water stops at them.
        if (!breaksTrees(r)) continue;
        fell(world, k);
        felled++;
      }
      if (world.lava[k]) {
        // Water meets lava: it cools into rock instead of being dug.
        world.lava[k] = 0;
        world.rock[k] = Math.max(world.rock[k], TUNE.damHeight);
        world.treeRock[k] = world.rock[k] + (world.trees[k] ? TUNE.treeHeight : 0);
        world.dirty.push(k);
        world.cooled.push(k);
        continue;
      }
      const w = d <= rad ? 1 : 1 - (d - rad) / feather;
      const want = (ground - bed) * w; // carve down to the bed, less at the banks
      if (want > world.carve[k]) {
        world.carve[k] = Math.min(want, depth * 3, Math.max(0, t.height[k] + world.rock[k] - SEA_LEVEL - 0.5)); // never below the sea
        world.owner[k] = r.idx;
        world.dirty.push(k);
      }
      // Refresh the live-water clock where this river still owns the cell.
      if (world.owner[k] === r.idx && want > TUNE.contactDepth) world.dugAt[k] = world.tick;
    }
  }
  // Ploughing through forest costs speed by the share of the head's footprint that was trees, less for more water.
  if (felled && !predicting) r.speed *= 1 - (TUNE.treeCost * Math.min(1, felled / Math.max(1, cells))) / Math.max(1, r.size);
}

// A stuck river wears away the ground the way it's pushing: a strip as wide
// as the river, out a few cells along its heading, strongest nearest the head,
// down toward its pool's level (never below the sea). Its own spot isn't worn:
// that would only sink it deeper. Worn ground is lower for everyone (it's the
// land, not a channel), so in time the head breaks through where it's aimed.
function wearAhead(world, r, amount = TUNE.stuckWear, most = TUNE.stuckWearMax) {
  if (predicting) return; // a preview never touches the ground
  const t = world.terrain, n = t.size, floor = r.low - TUNE.climb;
  const half = Math.max(t.cell * 0.6, widthOf(r) / 2), seen = new Set([cellIndex(t, r.x, r.z)]);
  for (let i = 1; i <= TUNE.stuckWearCells; i++) {
    const cx = r.x + r.dx * t.cell * i, cz = r.z + r.dz * t.cell * i, strength = 1 - (i - 1) / TUNE.stuckWearCells;
    for (let s = -half; s <= half; s += t.cell * 0.5) {
      const k = cellIndex(t, cx + r.dz * s, cz - r.dx * s);
      if (seen.has(k)) continue;
      seen.add(k);
      if (world.lakeOf[k] >= 0 || t.filled[k] <= SEA_LEVEL) continue;
      const ground = t.filled[k] + world.rock[k];
      if (ground <= floor) continue;
      const wear = Math.min(ground - floor, amount * r.size * strength);
      const lowest = Math.max(-most, SEA_LEVEL + 0.5 - t.filled[k]);
      const was = world.rock[k], now = Math.max(lowest, was - wear);
      if (now >= was) continue;
      world.rock[k] = now;
      world.treeRock[k] += now - was;
      world.dirty.push(k);
    }
  }
}

function fell(world, k) {
  world.trees[k] = 0;
  world.treeRock[k] = world.rock[k];
  world.felled.push(k);
}

function sampleFilled(t, wx, wz) {
  return t.filled[cellIndex(t, wx, wz)];
}

// Shortest distance from each cell to the sea along any route water can flow
// (each step at most TUNE.climb uphill on the filled surface). A steered river
// can cut across the fill tree, so fair spawns must be measured by this.
// goal: a cell mask to measure to (the finish beach); without one, any sea.
// Toward a goal, open sea is passable (the current carries a river along it).
export function descentDistance(t, goal = null) {
  const n = t.size, f = t.filled;
  const dist = new Float64Array(n * n).fill(Infinity);
  const heap = new MinHeap(n * 4);
  for (let i = 0; i < n * n; i++) if (goal ? goal[i] : f[i] <= SEA_LEVEL) { dist[i] = 0; heap.push(0, i); }
  while (heap.size) {
    const a = heap.pop(), da = dist[a];
    const ax = a % n, ay = (a - ax) / n;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = ax + dx, y = ay + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const b = y * n + x;
      if ((!goal && f[b] <= SEA_LEVEL) || f[a] > f[b] + TUNE.climb) continue; // water can't flow b -> a
      const d = da + t.cell * (dx && dy ? 1.4142135623730951 : 1);
      if (d < dist[b]) { dist[b] = d; heap.push(d, b); }
    }
  }
  return Float32Array.from(dist, (d) => (Number.isFinite(d) ? d : goal ? 1e9 : 0));
}

// Remaining downhill distance to the sea from every cell (static, ignores carving).
export function distanceToSea(t, downhill) {
  const n = t.size, dist = new Float32Array(n * n).fill(-1);
  const chain = [];
  for (let i = 0; i < n * n; i++) {
    let c = i;
    while (dist[c] < 0) {
      const d = downhill(t, c);
      if (d < 0) { dist[c] = 0; break; }
      chain.push(c);
      c = d;
    }
    while (chain.length) {
      const k = chain.pop();
      const d = downhill(t, k);
      const diag = d % n !== k % n && Math.floor(d / n) !== Math.floor(k / n);
      dist[k] = dist[d] + t.cell * (diag ? 1.4142135623730951 : 1);
    }
  }
  return dist;
}

// Canonical fingerprint of authoritative river state (positions rounded to cm).
export function riverFingerprint(world) {
  let h = 0x811c9dc5;
  const mix = (v) => { h = Math.imul(h ^ (v | 0), 0x01000193); };
  mix(world.tick);
  // The ground too (worn rock, carved channels): a desync off every river's
  // path would otherwise never show (Brain: it went unseen for 2,000+ ticks).
  let g = 0;
  for (let k = 0; k < world.rock.length; k++) {
    const v = Math.round(world.rock[k] * 64) ^ Math.round(world.carve[k] * 64);
    if (v) g = Math.imul(g ^ v ^ k, 0x01000193);
  }
  mix(g);
  for (const r of [...world.rivers].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    mix(Math.round(r.x * 100)); mix(Math.round(r.z * 100)); mix(r.finishTick); mix(r.path.length); mix(Math.round(r.volume));
    mix(r.out ? r.out.tick : -1); mix(r.pooled); mix(r.via.size); mix(r.gougeT); mix(r.gougeAt); mix(r.boost); mix(r.surgeT ?? -1); mix(r.surgeAt ?? 0); mix((r.surgeOn ? 1 : 0) + (r.gougeOn ? 2 : 0));
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
