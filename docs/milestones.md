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
  (1.2% at a full lead, 5% deadband, 1.5% cap); out below 40% of starting water. (Later: 4% / 5% cap and out below half your peak, ADR 0007.)
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

## M14 — Water that looks like the trailer (done)
- One turquoise water language for river, lakes and sea (`src/client/water.js`): deep down the middle,
  pale toward the edges, white foam at every shore and bank, streaks running with the flow.
- River head is a churning surge (noise-displaced, crested with foam) throwing spray, not a ball.
- Lakes are their own water surface at brim level with shore foam; tiny filled hollows under 1 m stay land.
- The sea reads its depth from the terrain: turquoise shallows, navy deep, surf lines rolling into the coast.
- Chase camera sits low and close behind the surge (pulls back as the river grows), as in the trailer.

## M15 — Terrain that looks like the trailer (done)
- Terrain shader (Lambert + onBeforeCompile): banded grey-brown rock on steep ground, olive grass broken
  by dry yellow and dark patches, close-up grit that fades with distance, and noise-bumped lighting that
  gives the 100 m grid rocky relief it can't carry in geometry.
- Dense clustered pine stands (two-tier pines) and scattered round broadleaf trees; boulders over rocky,
  steep and high ground. All instanced; removed where channels are dug.

## M16 — The drop and the map, like the trailer (done)
- Every river has its own colour; falling, it is a comet with a tail pointing back along its fall.
- Opening shot (4.5 s, unskippable since 2026-11-11): from low on the island looking up at the summit as the
  named comets rain in; the HUD and guides stay hidden until it ends.
- Rival names in the trailer's spirit (riverboi, mizu_chan, LaCascade, torrent99, ...), shown over the
  comets while falling. Landing throws a splash. The map shows each river's course in its colour.

## M17 — HUD, captions and the finish, like the trailer (done)
- HUD top right, white on a heavy shadow: big rank (#4/12, yellow at the front, pink further back),
  km to sea, litres; details (pour rate, head, depth, feeds) in one small line.
- The trailer's lines as one-time captions at the moment they describe: BE THE FIRST TO THE SEA on
  landing, SWALLOW LAKES TO GROW STRONGER on the first lake, PLAN YOUR ROUTE WELL OR RIVALS CUT YOU OFF
  when a deeper rival first comes close. Reaching the sea shows your place huge (#1 in gold) before results.
- Deploys version every relative import with the commit (no mixed stale modules) and show a build id.

## M18 — Lava, clear channels and the sea finish (done)
- Lava is one glowing stream: soft overlapping patches with dark crust and bright moving cracks.
- Nothing stands in the water: trees and boulders are cleared along each channel's full width.
- Reaching the sea, the camera rises over the surf and your place shows huge, as in the trailer.
- Rivals cutting you off stays the depth rule (a deeper river cutting your channel takes your water),
  now announced by the caption; no new wall rule, so the flow fixes stay intact.

## M19 — Sound (done)
- Water in three layers: a low rumble that grows with the river, a rush that brightens with speed and
  a bubbling gurgle; stereo, low-passed noise so it reads as water, not static. Wind while falling.
- Effects on a soft-compressed bus with a 12-voice budget, each chain freed when done: touchdown splash,
  lake swallow, lava hiss, bubbles while drawing a rival's water, a wave and chime at the sea.
- Music crossfades with an equal-power curve between the menu and race pieces.
- Verified only by levels (headless analyser on the output: peaks 0.07-0.3, no clipping), not by ear.

## M20 — Skills, a readable race, and records (2026-11-02, from Brain training)
Each step was measured on the sim first (Brain docs: train-plan-2026-11-02*.md, audit-2026-11-02.md).
- One finish beach: the coast where the slope meets the sea; other coasts carry you to it on a current.
- Gouge: a 3 s climb boost (+80 m x size), 10 s cooldown. Surge: a 2 s speed burst, 8 s cooldown; the only
  lever that gave rivers at the back any comeback (3 of 18 vs 0 for water levers). Bots use both, but not
  with a deeper rival beside them (the wind-up is a 23% siphon risk).
- Route preview: the real movement rules run on a copy of your river (9 m off at 1 km, against 306 m for
  a terrain trace). It shows where the water goes, not which way is faster: no preview could tell that.
- Map view frames the whole run top-down with the finish marked; cloud markers out to 5 km.
- Lakes stay lakes (slow level-drop evaporation, outlets stop 4 m under the start level); faster bank cuts.
- Map: 20 lake bowls, a wider winding corridor, storms 2.5 km across, drop clouds inside the drop zone.
- Waves hit harder (2.5x base) and carried speed fades in 1.1 s, not 0.27 s.
- Results: stars against this race's own baselines (beach, the middle of the field, first) and a record
  kept in the browser (races, wins, best place, fastest, stars) with personal bests called out.
- Pause and settings (volumes, route preview, camera shake); a first-race coach, one step at a time.
- Desync fingerprint covers the ground; spray drawn as round droplets.
- Open: tensions T188 (wind-up length), T189 (skill cost vs size), T184 (eroded terrain), T180 (race ending).

## M21 — Knockouts, a fair start line and a way back (2026-11-09, from Brain + ZaneGPT)
Measured headless on bot races first (12 rivers, sky drop on), then built.
- Knockouts again (ADR 0007): 0 in 12 races before, because rivers outgrow a fixed 40%-of-start floor.
  Out below half your peak (or 40% of the start), and a stronger drain (4% a tick, 5% cap): 2.25 a race.
- A knocked-out river's water goes to the river that drained it (ADR 0006, Brain T178).
- The start line is a wall: a landed river slides along it and never travels back behind it.
- Far behind the leader (3 km), Surge unlocks whatever your size: the last three at 60 s reached the
  top half 20 of 108 times, against 11 (36 races). A Surge scaled by the gap added nothing.
- Phones: adaptive resolution steps the pixel ratio down (to 0.75) when frames run under about 40 fps.
- Tests: the online lobby waits 15 s (slow pages were seated as spectators), and the gamepad look
  check waits on the camera, not the clock.
- Checked and left alone: following a rival is no longer measurably slower (1.01x and 0.89x on two
  island sets), so no caption claims it. Online play stays off on the published page (it needs a host).
- Open: T184 (eroded terrain) and T189 (skill cost) keep their defaults: noise terrain, a flat 10%.

## M22 — The descent, audited (2026-11-09)
Owner: "the descent sucks". Measured first (Brain flood#E126: time to first event and longest quiet gap).
- Keyboard ↑ is full glide throttle as well as a dive. Nothing on a keyboard set the throttle, so a
  keyboard drop topped out at 1.5x while pads and bots reached 1.8-2.2x and it landed last however well
  it was flown. Holding ↑ now lands at 34-37 s, ahead of the bots (median 58 s).
- 16 sky clouds (was 10), each at the height a steady fall passes it, same total water: an engaged
  drop's longest quiet stretch 18 s -> 13 s (worst 29 -> 16), cloud water median 14k -> 22k L.
- HUD while falling: "IN THE SKY · n of 12 landed" instead of #12/12; tags stay whole on screen, step
  apart instead of stacking, stay clear of the altimeter, and off-screen rivals get none; a cloud above
  you says "m above" (it said "-300 m below"); the footer's race controls hide; one short hint.
- Haze thins with the drop's height (aerosol scale height 1.5 km): the island reads from 7 km up.
- Audit of M21 against the descent: no knockouts while falling, no river behind the line, Surge not
  handed to drops on landing.

## M23 — A tighter descent and a more contested map (2026-11-09)
Owner: "make the race map more competitive" and "the descent is still sloppy". Measured first, bots only.
- Descent: a weaving, diving player had 13.2 height jolts a minute (the floor shoved it up as hills
  passed under, up to 13 m a tick; near the line the ceiling dropped it up to 52 m a tick) and 7.3 sideways
  jolts (the lane wall re-placed it, up to 17 m a tick). Now: the floor looks 1.5 s ahead and the climb
  speeds up and fades by 0.6 m a tick; the ceiling pulls at most 6 m a tick faster than the fall; the lane
  wall is a 150 m cushion that fades outward motion (always moving on down the lane). 1.8 and 3.3 jolts a minute.
- Descent: drops turned at 92 deg/s but the camera may turn 45 (Brain T182), so the view lagged 47 deg
  behind a 1 s turn. Both now 52 deg/s (still under T182's 60). Turning away from downhill eases off from
  45 deg instead of stopping dead at 70.
- Map: rivals are rarely near each other (median nearest rival about 2 km; within 400 m about 4% of
  racing time), so the fight is cutting rivals' channels. A stronger centre trough (ISLAND.trough 60 -> 200)
  raised channel contacts 17% on two fresh island sets (12 and 16 races) with finishes held. More gates
  bunched rivers (14% near a rival) but cost finishes; a narrower corridor, more lakes or a narrower landing
  did nothing reliable.
- Fixed on the way: the sea current could clip a shore cell 0.23 m above the sea and leave a river
  flowing back and forth for good; the start-line wall no longer applies at sea.
- Tests: the forest test checks the tree rule itself (a small river made fast by a slope breaks through,
  by design); the online test decodes frames (a falling steer travels with the glide throttle).
- Open: the river leading 60 s after landing wins 12-13 of 16 races. That is speed parity, not the map.

## Skill gap benchmark (2026-11-12)
- `npm run gap` (`tools/skill-gap.mjs`): one steered river among eleven unsteered, same island and seat,
  steered three ways. 10 islands x 2 seats, no drop: unsteered mean place 5.9 (finished 6 of 20); the bot
  2.2 (finished 20, won 5); the look-ahead planner (`src/shared/lookahead.js`, steering only) 1.5 (won 11).
  Steering decides the race; the bot gives away about 10% of the time to the planner.
- Among 11 bots with the drop (6 islands) the planner placed 1, 2, 2, 3, 3 and once did not finish:
  a strong rival, not an unbeatable one. `?rival=look` puts it in a solo race as LOOKAHEAD (worker).
- Open: an unsteered river won 3 of 20 from its seat alone, and beat the planner in 9 of 20.
- Open: the gamepad play check fails on main ("A did not leave the splash"), before this change.

## Dash, and wall ridges (2026-11-12, owner: float becomes dash; ridges and canyons must shape the course)
- Descent: down is Dash, not float. Twice the glide speed for 1 s, ready again 5 s after it fired; nothing slows
  the fall any more. Rain clouds sit at or under a steady fall (nobody can stay up for a higher one). Bots dash
  after a drop that is getting away, clear of one they let go, for a far cloud, and half as often as they could when cruising.
- Terrain: two spines per island (`ISLAND.spines`), walls 300 m tall and about 5 km long through the switchback
  and the terraces, off-centre and slanted, so the course forks into a narrow canyon and a wide valley.
- Measured (`npm run gap` on 6 islands x 2 seats, and 120 unsteered rivers on 10 islands): the spines changed no
  result. Unsteered rivers finished 61 of 120 (58 before), median 262 s (258); the planner and the bot kept their
  places and times. A dam across the wide valley (`SPINE.dam`, off) changed nothing either: its lake is skated across.
- Why: the rules make every obstacle soft. Blocked water is walked round along the fill route (unsteered rivers
  spend 36% of their racing time on it), lakes cost no time, and Gouge lifts a head 80 m. A wall along the flow
  with the same valley either side is not a decision.
- Open: steering is worth a factor of two in time (planner about 135 s, unsteered about 260 s) yet feels optional.
  Next to try: hitting rock stops the head dead and the route out only starts after a wait, so a wall costs
  seconds unless it is steered round.

## Second try: fast water along the walls (2026-11-13)
- Found in the speed rule: the slope bonus saturates at about a 4.5% grade and the course averages 5%, so every
  route down runs at one pace and only distance counts. That, more than the autopilot, is why terrain did not matter.
- Built: a chute, a strip about 500 m wide along the foot of each spine on its far side, where water runs 35%
  faster (`TUNE.canyonBoost`, `terrain.fast`, shown as dark wet rock). The spines moved out to 0.30-0.42 of the
  half-width, so reaching a chute means leaving the centre line and holding a line beside the wall.
- Measured (6 islands x 2 seats): not proven. The planner's times and places did not improve (it looks 8 s ahead,
  the chute is a 30 s commitment). With the whole canyon fast, unsteered rivers fell in by their seat and won;
  hence the thin strip. A bot pull toward the chute ran bots into the walls, so it is off (`TUNE_BOT.canyon`).
- Regression to settle before merging: with the spines this far out one bot run in 12 never finished (none
  did with the spines nearer the centre), and unsteered finishes fell from 5 of 12 to 3.
- Open: whether a player feels it. Agents cannot say; it needs hands on it.

## Light with depth (2026-11-13, owner: it is visually flat)
- Cause: nothing cast a shadow, the sky fill was half the sun's strength, and the sky was one flat colour.
- Baked light (`src/client/terrainMesh.js`): once per island, march from every ground cell toward the sun over the
  displayed heights and darken what is hidden (cool, soft-edged), and darken hollows by how much sky they see.
  Trees throw shadows the same way (`castTrees`) and take the shade of the hill they stand behind. No shadow maps,
  nothing per frame. The grid is 100 m a cell: hills, walls and stands cast shadows; a lone boulder does not.
- Sun lower (27 degrees) and warmer, sky fill weaker and cooler; trees darken toward the ground so they stand on it.
- Sky: a dome from the haze colour at the horizon to deeper blue overhead, with a glow round the sun.
- Checked by eye on before / after screenshots (seed 4, ground and falling views), not on a phone.

## Ground cover that follows the land (2026-11-13)
- The baked light moved out of the vertex colours into its own attribute (`shade`): the shader tells grass, rock
  and lake bed apart by colour, and a cool shadow tint in the colour made shaded grass read as a lake bed.
- The sun is aimed per island, from the side of its course (`sunOf`): with a fixed compass sun some islands had
  the whole start in the summits' shadow.
- Cover (`damp` attribute: hollows and lake shores damp, crests dry): lush green where water gathers, straw on the
  crests, rust bracken on drier slopes, pale tussock, bare stone on spurs, tufts close up; turf and lichen break
  up the stone of the high ground. A brighter meadow green under it all.
- Checked by eye on one island's opening view (seed 4); the lower course and phones are unchecked.
- Edges (same day): cover patches no longer fade across hundreds of metres. Each wins where its measure, pushed by
  fine detail noise, crosses a threshold in a narrow band (height-blend style); the band widens with distance so
  far edges do not shimmer. Checked by eye on seed 4's opening view.

## Next build: skills build up with weight (agreed 2026-11-13, not built)
- Gouge and Surge stop being an instant jump: the speed builds over a time that grows with the river, then the
  full boost runs its whole length, and the cooldown starts only when it ends.
- Build time follows size (the cube root of volume) by the middle curve: time = T x (s / s0)^1.5, computed as
  s x sqrt(s) (no pow: the sim stays bit-identical). Anchored at 1 s for 1.5M L. Gives about 1.6 s at 4M L and
  2.3 s at 8M L; it bends over with size, so no cap is needed. The anchor is a starting point to tune by hand.
- Gouge's extra height comes at once; only its speed builds, or a river blocked at a rise waits at the wall.
- The head never stops during the build (an earlier wind-up that held it still was removed: rivals drained it).
- Also correct: an earlier note here that speed "tops out" was wrong. Measured, large rivers run about 50% faster
  than small ones on plain ground (carried pulse momentum); the missing piece is that carried speed on flats and
  lakes fades at one rate for every size.

## Rules: skills with weight, momentum by size, pebble lake banks (2026-11-13)
- Gouge and Surge build up (`buildTicks`): 1 s at 1.5M L, by (size ratio)^1.5, eased in; then the full boost
  runs; the cooldown starts when it ends. Gouge's extra height comes at once.
- On flats and lakes carried speed fades by 1% a tick divided by size: twice the size, half the fade.
- Lake banks are pebble: an outlet is first cut to a quarter of the head's depth and wears at a quarter of the
  old rate, down at most to 1 m over the lake's bed. The hidden 4 m stop is gone.
- Rock spines are off (`ISLAND.spines = 0`): they changed no result and, on seed 43, a bot could not finish
  with them (it finished second without). The chute code stays for when they return in another form.
- Tested lightly: unit tests pass (four updated to the new rules, one added for the build curve); render smoke
  passes; one benchmark pass (6 islands x 2 seats). Not tuned or felt by hand; the benchmark was not rerun
  after the spines went off, beyond the one race that had failed.

## Controls and the descent, tightened (2026-11-13, owner)
- A landed river's turn eases toward the stick and out again (`TUNE.turnEase` 0.3, about 7 ticks), not a full
  step at once. Bots turn the same way, so skill-gap numbers from before this date are not comparable.
- Dash on a phone: it never fired while the DIVE toggle was on (the two were summed to zero; dash now wins), and
  a quick tap could start and end between two ticks and be lost (dash is latched now, on the client and the
  server, like a steer tap). The touch play check holds DASH with DIVE on, and taps it down and up in one task.
- Tried and reverted the same day: the falling tilt on the right stick with the descent on the left. It broke
  the rule that the left stick only steers; the gamepad descent play check caught it.
- The descent lasts half as long again (`dropTicks` 2400: a straight drop measured 108-115 s on three islands,
  was 68-75 s). Measured first: a quarter of the fall height or of the glide speed changes the time hardly at
  all (the start point moves with the glide speed, and the drop lands at the line either way).
- Descent clouds: 24 (was 16), same total water, each at random inside its own slice of the run. With 16 fully
  random clouds over 120 s the longest empty stretch averaged 20 s (worst 28 s); now 11 s on average.
- The "bot that never finishes" (seed 8, seat 8, without the drop) is not stuck: it flows the whole time and is
  5.7 km from the beach when the 3 minutes after the first finisher run out. Its seat starts 46 km from the sea
  by water, behind a lake. The skill-gap tool seats rivers on the summit ring; the game itself starts everyone
  on the fair line after the drop, so this is the benchmark's seat, not a race bug.
