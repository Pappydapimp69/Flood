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

## M5 — Multiplayer (done)

**Built**
- `src/server/server.mjs`: one Node process serves the game (public paths only) and a WebSocket
  room at `/ws`. `npm run server`, then open the page and press **Play online**.
- `src/server/room.js`: lobby (8 s after the first player, or full at 80) → race → results →
  lobby. Bots fill the race to 12 rivers. Seats are resumable by token (sessionStorage); a
  dropped player's river keeps flowing unsteered; unknown tokens spectate.
- Server-stamped input lockstep (ADR 0002): frames of one char per river; clients replay the
  log on join/reconnect; fingerprints every 100 ticks catch desync and trigger a resync.
- Hardening: steer validated to −1/0/1, 1 KB message cap, 60 msg/s rate limit, names
  sanitised, slow clients over 4 MB buffered are dropped (they can rejoin), static server
  allowlist (no .git / node_modules / server code), 20 Hz clock with a catch-up cap.
- Client: start menu (name, Play online, Solo vs bots), lobby/connection status, spectator mode,
  "next race soon" after results. Island rebuilt per race seed.
- Spawn grace scales with lobby size (+0.1 s per river): 80-player rooms spawn closer together.
- Tests: `tests/unit/server.test.mjs` (two clients' replays match the server, invalid input
  ignored, names sanitised, token resume + log replay, stranger spectates, fingerprint resync);
  `tests/online.mjs` (two headless browsers in one race, steering reaches the server, no desync,
  reloaded tab gets its seat back).
- Load: 80 players ≈ 0.04 ms/tick average, 6 ms worst, ~2 KB/s per client.

**Carry forward to M6**
- Own-input latency is one round trip; add local "ghost" prediction of your head if it feels slow.
- Ribbon/water look, phone performance (262k-vertex terrain), win screens, menus polish.
- Many early merges in 80-player rooms on a 48 km island — consider bigger maps for big lobbies.

## M6 — Polish (done)

**Built**
- Water shader: flow stripes and bank foam scroll along each channel; water older than the
  15 s live window fades to a grey dry bed, so you can see which channel is lethal. The fade
  reads the sim's own `TUNE.liveTicks`.
- Threat at a glance: rival heads are red if bigger than you (they'd absorb you), green if
  smaller; name tags with ▲/▼ over the 8 nearest rivals. Heads grow into markers in map view.
- Results: end screen with your place, time, litres, lakes and the top 5 (+ you), "Race again"
  in solo, "Next race starts soon" online; final results when the race ends.
- Finish window: a race ends 90 s after the first river reaches the sea (server and solo),
  so stragglers can't drag it out.
- First-run hint (once per browser, `?nohint` to skip); keyboard help hidden on phones.
- Phones: no MSAA and pixel ratio capped at 1.5; pixel ratio re-read on resize.
- Sound: river hiss that follows speed, lake gulp, merge thud; starts on first gesture,
  never blocks the game; mute button (remembered).
- HUD hidden until a race starts; online without a server explains how to start one.
- Tests: finish-window unit test; play test checks the results list and "Race again".

**Not done / next ideas**
- Real phone profiling (headless can't measure GPU): the terrain is 262k vertices; a
  half-resolution display mesh is the next lever if phones struggle.
- Bigger islands for big lobbies; bot tuning; a "ghost" prediction of your own head online.

## M7 — Depth tug-of-war (done)

**Built** (ADR 0003)
- Cutting depth from size and speed; contact siphons water from the shallower river each tick
  (1.2% at a full lead, 5% deadband, 1.5% cap); out below 40% of starting water.
- Live rival channels no longer shape the surface others flow on — crossing costs water, never
  traps. Dry beds are still terrain.
- Bots compare depth instead of volume.
- Client: heads and tags by depth (red ▲ deeper, green ▼ shallower, amber = even), "cutting N m
  deep" HUD line, red screen edge + "X is draining you", "+N L from X" pops, "drained dry" wording.
- Gamepad support (stick/D-pad steer, A select / race again, Y map, X sound) and the GitHub Pages
  deploy from `main` landed alongside.
- Tests: duel tests (deeper drains shallower to the floor, equal depths move nothing, live rival
  channel never dents the surface), play tests for the drain warning and gamepad.

**Measured** (10 seeds × 12 bots): biggest-at-60 s won 1/10 (unchanged from absorb), eliminations
3.4 → 1.6 per race, ~22% of all water changes hands.

**Carry forward to M8**
- Lakes are still one-shot gulps; M8 drains them through your channel over time, and a deeper
  rival crossing that channel taps the flow.

## M8 — Lakes drain through your channel (done)

**Built**
- Touching a full lake *taps* it instead of swallowing it. Its water arrives over time: the share
  that flows out per tick ramps from 0.15% to 0.6% over 20 s as the outlet erodes (~90% within
  40 s); under 1,000 L the rest arrives at once (no endless decay tail). Total is the same as the
  old one-shot gain.
- Cutting a lake off: a head that cuts deeper than a rival's channel, on a stretch dug after that
  rival tapped a lake, takes over the tap (the outlet starts eroding afresh). A tapper drained dry
  hands its lakes to whoever drained it; one that reaches the sea lets them go for others to tap.
- Bots value cutting across shallower rivers that are draining lakes.
- Client: lakes sink toward their beds and fade to mud as they empty; HUD shows
  "+N L/s from K lakes"; pops for tapping, cutting and being cut; feed line for cuts.
- Tests: tap goes to the biggest head, gradual drain delivers exactly the lake's water (>85% in
  40 s), finishing releases your lakes, a deeper cutter steals a tap.

**Measured** (10 seeds × 12 bots): ~29 taps, ~8 cuts and ~25 lakes emptied per race; the river
biggest at 60 s won 0/10 (no snowball).

**Carry forward to M9**
- Empty basins: a few lakes start dry and must be filled before you can spill on.

## M9 — Dry basins (done)

**Built**
- Up to 5 mid-size lakes per map start dry (seeded, never on a spawn). A head that runs into one
  pools: it stops and pours water in — at most 30% of its water, never below 1.25× the
  elimination floor, at a rate that grows with size — until the basin is full, its share is paid,
  or 12 s pass (guaranteed exit). It then spills from the basin's outlet and carries on.
- What it poured becomes a reservoir (80% kept) that any other river can tap like a lake.
- Bots avoid dry basins unless they're big enough to fill them quickly.
- Client: basins show dry and fill visibly; HUD "filling a basin · N%"; pops for pooling and
  breaching; feed line when someone fills one.
- Tests: basins are deterministic and off spawns; pooling stops the head, costs water, spills at
  the outlet within the cap; floor margin holds; the reservoir is tappable by another river; a
  play test for the HUD and the spill.

**Measured** (10 seeds × 12 bots, basins on vs off): ~1 basin filled per race, winner time 95 →
90 s, finishers and eliminations unchanged, longest pool 11.6 s.

**Camera fix (owner report: "the camera fights the player")**
- The chase camera now follows the river's course over the last ~400 m instead of the head's
  tick-to-tick heading, ignores changes under ~12°, turns slowly, follows position tightly, and
  rises fast / sinks slowly. Under constant left-right steering its yaw travel fell from 687° to
  52° in 20 s, and direction reversals from 24 to 8.

## M10 — Sky drop and gamepad (done)

**Built**
- Every race opens with a 6 s drop: each river falls from 3 km over its fair spawn as a streaked
  drop, and steering glides it (160 m/s, a held turn is a wide arc) to choose where it lands —
  only inside the wide fair band, sliding along its edge. Drops start gliding around the island
  so they run along the band. In the sim: authoritative, fingerprinted, the same online.
- Landing starts the river (flowing downhill) and its spawn grace; no contacts, lakes or basins
  while falling. Bots glide away from the nearest other drop.
- Client: the landing zone glows cyan while you fall, HUD "Steer your landing · N s", drop and
  streak visuals, a splash sound on touchdown. `?nodrop` skips it.
- Gamepad support shipped earlier in this cycle (stick/D-pad, A, X, Y; menu navigation).
- Tests: drop timing, glide stays in the zone, grace from touchdown; play test for the
  countdown, steering the landing and flowing after.
