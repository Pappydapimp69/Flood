# Milestones

Each milestone starts with a ZaneGPT pressure test and several Brain searches, and reviews the
entries below for context. Each ends with a log entry here.

1. **Terrain** — island heightmap in Three.js, camera, basic look.
2. **One river** — flow downhill, steer left/right, carve a channel.
3. **Growth** — lakes to swallow, volume sets width and speed, "km to sea".
4. **Bots** — AI rivers racing you, blocking and merging.
5. **Multiplayer** — Node WebSocket server, up to 80 players, lag handling.
6. **Polish** — water shader, phone performance, win screens.

---

## M1 — Terrain (done)

**Built**
- `src/shared/terrain.js`: seeded island (pure JS, no three, no transcendental Math, so the server
  can rebuild the same map). Elongated north–south island, mountain spine west of centre, cape in
  the north. 512×512 grid over 48 km, peaks ~1.7–1.9 km.
- Priority-flood depression fill: every land cell drains to the sea by strict descent. Filled
  basins deeper than 2 m are lakes (used in M3).
- `src/client/`: terrain mesh with height/slope vertex colours, translucent sea, seabed, fog,
  orbit camera. `?seed=N` picks the island.
- Tests: `npm test` (determinism, sea edge, size, all-cell drainage, sampling) and `npm run smoke`
  (headless Chromium + SwiftShader: loads, draws, frame isn't blank).

**Decisions**
- ADR 0001: vendor pinned three 0.169, no build step (Brain T12).
- Procedural island instead of real Corsica elevation data: seedable maps, no download, no
  licence questions, and we control drainage. Real DEM can come back as a special map later.

**Carry forward to M2**
- `downhill(t, idx)` and `sampleHeight` are the river's API. Rivers flow on `filled`, not `height`.
- Render uses `VERT = 2.4` exaggeration; game logic stays in true metres.
- Grid row 0 is north (−z). `+z` is south.
- Headless rAF is slow and uneven: tests poll `window.__flood`, never wall-clock.
- Open: ~6k lake cells per map is still a lot of flat water; tune when lakes become gameplay.

## M2 — One river (done)

**Built**
- `src/shared/river.js`: fixed 20 Hz sim. The head turns with integer steer (−1/0/1), steep ground
  pulls it downhill, lakes and flats pull it toward the outlet, and it can't climb more than 1.5 m
  above the lowest level it reached. Each path point digs a flat-bottomed channel.
- A river ignores its own channel (per-cell owner) but will feel rivals' channels — the hook for
  "cut you off" in M4.
- Stall guard: no progress toward the sea for 5 s → follow the fill's downhill tree for 3 s.
- Client: water ribbon, chase camera that keeps the sightline above ground, wider FOV in portrait,
  "km to sea" + timer HUD, finish banner, restart, `M` for map view.
- Input: arrows/A-D, or hold the left/right half of the screen. Presses are captured at event time.
- Tests: `tests/unit/river.test.mjs` (every seed × steering policy reaches the sea, determinism,
  steering matters, digging bounded); `tests/play.mjs` (flows/digs, keyboard, touch, short taps).

**Decisions**
- Continuous head over a bilinear surface, with grid fallbacks, rather than cell-to-cell movement:
  smoother steering, and the fill tree still guarantees an exit.
- Speeds are game-scale (up to 200 m/s); the HUD shows distance and time, not speed.

**Carry forward to M3**
- Rivers have fixed `TUNE.width`/`depth`; M3 makes them grow with volume.
- `world.dist` is static distance-to-sea along the fill tree (ignores digging).
- Spawn spread is unfair (24 s to 11 min); fix spawn rules before bots/multiplayer.
- Multi-river ticks read neighbours mid-tick; snapshot before M4 so order doesn't matter.

## M3 — Growth (done)

**Built**
- Volume in litres. Start 1,000,000 L; +25 L per metre travelled; swallowing a lake adds
  120,000 L + 9,000 L per lake cell (capped at 400 cells). One-shot: first river in takes it.
- Size = (volume / start)^¼ (two square roots, no transcendental Math). Channel width/depth scale
  with size (width capped 420 m). Top speed +25% per unit of size, but turning is divided by size —
  bigger is faster and stronger, not more agile, so the leader can't simply snowball.
- Turning now adds a sideways component and renormalises, so turn rate can vary without trig.
- `findLakes` labels lakes (8-way, index order). A swallowed lake dries to a mudflat visually; the
  game surface keeps its level so drainage still holds.
- Fair spawns: high ground inside ±8% of the 75th-percentile flow distance to the sea. Single-player
  times per seed now sit within ~1.4× of each other (were 3–6×).
- HUD: litres counter, "+N L" pop when you swallow a lake, finish banner with litres and lakes.
- Tests: `tests/unit/growth.test.mjs` (lake labels, one-shot lakes, size, spawn band, a run grows);
  play test checks the litres HUD counts up.

**Carry forward to M4**
- `world.events` carries lake captures for presentation; add rival events the same way.
- Rivals' channels already change the surface others feel; capture/merge rules come next.
- Rival heads in one tick still read each other mid-update — snapshot first.
- Runs take ~3–8 minutes; revisit pacing once there are opponents.

## M4 — Bots (done)

**Built**
- The sim now runs in phases each tick: all rivers move against last tick's surface → contacts
  → lakes → channel digs (in id order). Outcomes don't depend on the order rivers were added
  (unit test reverses it).
- Contact: a head touching a rival's head, or a rival's *live* channel (dug in the last 15 s),
  absorbs the smaller river; the bigger takes 50% of its water. 5 s spawn grace. Older channel is
  a dry bed — permanent trails made upstream, out-of-sight deaths the norm.
- Lakes touched by several heads in one tick go to the biggest.
- Spawns keep ≥2.5 km apart (wider band fallback when crowded).
- `src/shared/bot.js`: bots steer from the same state a player sees — progress toward the sea,
  untaken lakes, avoiding live water of anything that might be bigger, chasing clearly smaller
  rivals by aggression. Each bot has its own id-keyed RNG; steering only beats going straight
  by a margin.
- Client: 11 bots by default (`?bots=N`), coloured ribbons, rank "#4/12 · 8 flowing", event feed,
  "Absorbed …" pop, spectate the river that absorbed you, end banner with place.
- Tests: `tests/unit/race.test.mjs` (determinism, add-order independence, contact rule, spawn
  gap, standings, bots place better than never-steering rivers); play test for absorb + spectate.

**Open**
- Bot quality is mixed: they win every race on the test seeds but average placement beats
  never-steering rivers on only some seeds. Tune when real players give a baseline.
- Stragglers can take 10 minutes; consider a "the sea rises" shrink timer for the BR ending.

**Carry forward to M5**
- Inputs are just `Map<id, steer>` per tick, and the sim is deterministic — ready for a server
  that runs the same `step()` and broadcasts state.
- Bots run in the shared module, so the server can host them.
