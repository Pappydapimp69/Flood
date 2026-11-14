# Summit Rush — a second mode, from the trailer

Status: built (owner, 2026-11-14) as Course: Summit Rush on the start screen (`?course=summit`). The ski race
stays as it is.

## What is built, and what measured
Rebuilt 2026-11-14 after the owner's verdict on the first build ("boring, nothing like the trailer, too slow"). The
sections below this one describe the first design; where they speak of a moat, read this instead.
- What was wrong, measured (`node tools/course-counts.mjs`): the water ran as fast as on the ski slope (median about
  240 m/s on both), but a river on the first island swallowed 1 lake a race against the ski slope's 6, and met no
  boulder, ridge or rock bar at all: the generator handed the sim a bare cone. And the moat did not bring rivers
  together (a rival within 400 m 8 to 10% of the time): they spread round it.
- `src/shared/summit.js` now: the erosion's base level is open only at the three breaches and the starting ground
  tilts toward each, so the ravines gather into three trunk valleys, each leaving through its own gorge. No moat.
  Lakes, rock bars and boulder fields are placed on the paths water takes from the start ring, counted on the fine
  grid, a third of the lakes in each band of the descent (placed from the erosion grid's own drainage they went to
  the ditch at the ring's foot, which no river in a race follows). Tarns are cut level into the slope, wider across
  the valley than along it. Puddles of six cells or fewer are levelled.
- Measured (30 bots, seeds 1 to 3): a rival within 400 m 11 to 23% of the time, 16% on average (the ski slope: 16
  to 19%); lakes entered 3.3 to 5.0 a race (the ski slope: 5.4 to 6); fastest finish 79 to 83 s, median 96 to 104 s.
- The look (`src/client/scenery.js` buildCrags, buildArch; the rugged rock in `terrainMesh.js`): crags in outcrops
  along the crests and round the peak, buttresses on walls, scree under them and in ravine floors, block piles on the
  boulder fields and rock bars, standing stones on spurs, a rock arch over one gorge; darker jointed rock shading.
  Placement follows researched rules (clusters that thin from their middles, big rock first then small round it, a
  third of each sunk in: bs flood-98, flood-99). Rock under a river's water is cleared like the trees.
- Felt speed: it comes mostly from how many ground features pass each second (bs flood-95), which is what the rock
  and the fuller valleys add; the water's speed is unchanged.
- To look at a race: `node tools/race-shots.mjs <dir> <seed>` (a bot steers the player with `?pilot`, the game runs
  ahead between shots).
- The detail patch (`terrainMesh.js` buildDetailPatch): a 15 m mesh 2.4 km across that follows the camera and draws
  the ground there with relief the 100 m grid cannot hold (ledged on steep rock, gentle on grass, none in water or
  channels, none at its edges); the big mesh skips drawing under it. Summit Rush only, not with `?lite`.
- Not built: sea stacks as meshes.
- Not run: the unit tests and CI (owner, 2026-11-14: "no tests, no ci"). Tests that pin the old island's numbers
  may need their numbers updated.

## What the owner asked for
"It should look more like this" (the trailer "Playing as a River in a Battle Royale"): comets rain onto one jagged
peak; streams run off it in every direction through rugged rock, ravines, forest, an arch and stone pillars, seen
from a camera down among the water; the first to the sea gets a giant #1. Summit Rush is its own mode: it keeps
the river itself (flow, growth, lakes, Surge, Gouge, contact) and reuses nothing built around the ski slope's one
direction.

## The one problem the look creates
Water off a cone runs radially, and radial streams never meet (Britannica: radial drainage is typical of intact
volcanic cones). Real mountain islands send many separate rivers to the sea: Corsica has seven main rivers, each
with its own mouth, which meet their own tributaries but never each other. The open island the game began on did
exactly that, and rivers rarely met. Mass-start downhill races get contact the other way: Megavalanche starts
1,500 to 2,000 riders across a wide glacier and funnels them into narrow terrain. So the island needs one feature
that bends the radial flow back together (bs flood-93).

## The island: a peak, its ribs, a moat, and breaches
- **The peak.** One jagged summit in the middle of a round island about 50 km across. The comets fall on it from
  straight above, from every side, and land on a ring round it at one height. Land anywhere on the ring.
- **The ribs.** Ravines leave the peak in every direction, the way a young volcano's are "parasol ribbed": basins
  about 20 degrees wide, more than ten reaching the summit (O'Hara et al. 2024, 16 stratovolcanoes; bs flood-94).
  About 12 ravines, V-shaped and steep high up, each branching and taking in side ravines on the way down
  (dendritic; bifurcation ratio about 4). Your landing spot is your ravine: the drop is the route choice.
- **The moat.** About two thirds of the way down, every ravine pours over a step, a waterfall (a knickpoint), into
  one ring valley that runs right round the mountain. This is where everyone meets: rivers arriving from every
  direction, crossing each other's channels. Nothing in real drainage does this on its own; a ring valley round a
  dome or caldera is the feature that does, and it is the island's one invented rule.
- **The breaches.** Three or four gorges cut through the outer rim of the moat to the sea, each a different kind:
  a narrow slot that crowds everyone together, a wider one with lakes to grow on, one through forest, one past sea
  stacks. Any breach finishes at the sea; there is no single beach. Which way round the moat you turn and which
  breach you take is the second choice, made in a crowd.
- **Length.** Bots average about 300 m/s here (measured on the first Summit Rush course), so two minutes needs
  about 36 km of route: about 12 km down a rib, up to a quarter of the moat round it, and about 8 km out through a
  breach. Measure it on the built island before settling the numbers.

## How it is made
- A coarse stream-power erosion pass carves the ribs and side ravines so they branch and join like real ones:
  uplift high at the peak and on the rim, low in the moat; solve `dh/dt = U - K A^m S` implicitly (Braun and
  Willett 2013, O(n) a step) on a 160 x 160 grid, upsample, then add ridged noise for rock. Deterministic with fixed
  tie-breaks. Its cost in JS is an estimate (a few hundred ms); measure it, and paint the ribs straight from noise
  if it is too slow.
- The moat, the waterfalls and the breaches are drawn in, not left to erosion, so every island has them.
- One to three landmarks per island, built around (racing level design: "a track is a start, some landmarks and an
  end line"; bs flood-91): the peak, the waterfalls into the moat, and one breach's sea stacks or rock arch. An arch
  is a mesh over a gorge, not terrain: the ground holds one height per point, and the water runs underneath.

## Forward, landing and bots, without the ski slope's axis
- "Forward" is each spot's own direction toward its nearest finish by water, not one axis. The landing heading, the
  chase camera, the course arrow and the bots all read it.
- Bots score headings by measured time to the sea from a pathing pass, so they pick ravines and breaches by
  crowding, lakes and length, not straight-line distance.

## The camera and the ground up close
- A low chase camera, about 150 m behind and 40 m up (the ski race uses 330 and 110), kept 8 to 15 m above the
  ground under it by a spring that rises fast and falls slowly, the field of view widening slowly with speed, at
  most 10 to 15 degrees. Shake and field-of-view change can be turned off (Xbox accessibility guideline 117; bs
  flood-89).
- Today's terrain is a flat 100 m mesh. Close up it needs a detail patch that follows the camera (about 128 x 128
  vertices at 12.5 to 25 m, 2 to 3 km across) with rock noise added by slope, triplanar rock shading on steep
  ground, and instanced boulders and trees scattered near the camera in 1 km chunks. The physics keeps the 100 m
  grid; the patch only draws.

## Contact and the end of the race
- The moat makes contact; the drain decides what it costs. Today's drain knocks out 57 of 80 bots on the first
  Summit Rush course. Head collisions and channel-only draining (docs/collisions.md) come before this mode is played
  with a full field; the drain rate there is still open.
- The race ends a fixed time after the first finisher, as now. No shrinking zone: the moat already brings everyone
  together, and a straggler's race ends on the clock.

## Open
- Whether the stream-power pass fits a phone's load time.
- 80 rivers on phones: about 640 draw calls for rivers before terrain; batch them, and measure.
- Whether the moat becomes a brawl or a pile-up: measure finishes and knockouts in bot races.

## Sources
- Radial drainage: https://www.britannica.com/science/river/Drainage-patterns
- Volcano ribs: https://esurf.copernicus.org/articles/12/709/2024/
- Corsica's rivers: https://en.wikipedia.org/wiki/Corsica, https://en.wikipedia.org/wiki/Golo_(river)
- Megavalanche: https://en.wikipedia.org/wiki/Megavalanche
- Stream power: https://landlab.readthedocs.io/en/latest/generated/api/landlab.components.stream_power.fastscape_stream_power.html
- Landmarks: https://www.gamedeveloper.com/design/racing-level-design-the-rally-case
- Knickpoints: https://en.wikipedia.org/wiki/Knickpoint
- Camera: https://support.iracing.com/support/solutions/articles/31000157467, https://arxiv.org/pdf/2103.05200
- Terrain detail: https://hhoppe.com/proj/geomclipmap/, https://github.com/nwpointer/three-landscape

## The living mountain: Training's test map (owner, 2026-11-14)
The owner's verdict on the set-piece library ("just combining 3 ski maps... the map has to feel alive"): Summit's
mountain should change during the race. First piece, on a small test map under Training in the menu
(`?course=slide`, seed 7001, a 400-cell ski-style valley that builds in under a second): the Landslide
(`src/shared/river.js` SLIDE, makeSlide, slideStep). As the leader nears it a slope comes down across the
valley as rock on `world.rock` (the layer cooled lava already used, so lockstep and drawing needed nothing new);
a pond backs up behind it; the dam breaks when a river wears its crest through or after 13 s, and the pond goes
down the valley as a wave: every river it passes rides it (a free surge plus water), rivers held in the pond
ride furthest. Measured (12 bots, seeds 7001-7003): it falls 24-28 s in, holds the pack, and 8-9 of 12 ride
the burst. Not yet: no river breaks the dam before it overtops (bots don't Gouge a 150 m dam), so the early
break is untested; the dam's own look is plain dark rock.

### Built from the owner's list (2026-11-14)
- Training maps start on the start line (no descent).
- The dam is a straight wall across the valley's own direction (the first build followed the winding course and
  left gaps rivers slipped through), with a seeded saddle, its low point. Its crest is loose rubble: a river
  pressing it washes 0.3 m a tick (times size) off the crest near it, so one river at the saddle breaks it in about
  6 s, a few together faster, and one on the high crest not before the pond overtops it (13 s from the first
  river's arrival). Bold bots (aggression over 0.4) make for the saddle. Seeds 7001 to 7005: a river broke it in 4
  of 5 races; the feed names who.
- The look: boulders tumble off the valley side across the dam line in the slope's sweep, dust rises and thins
  over five seconds, and the wave's front runs down the valley as a band of white water.
- Select (C on a keyboard) on a Training map: the race pauses, nothing on screen but the world; left stick moves,
  right stick turns and tilts, triggers lower and raise (keys: arrows or WASD, IJKL, Q E). Select again flies back
  over 2 s and the race resumes. Y keeps the map elsewhere; Select no longer opens it.

### Built, unchecked (owner, 2026-11-14: "no checks, no tests")
- Triggered, not timed: a cracked slope stands on one side of the valley (dark cracks mark it); a river's head
  within 350 m of its toe sets it off, which starts a 3 s countdown of flickering cracks. No river, no slide.
- The slide in the shared sim (`river.js` releaseBlocks, stepBlocks, settle): 120 seeded blocks let go of the
  scar top first over 1.5 s, are pushed down the real ground and slowed by friction, bounce on slopes steeper than
  45 degrees (an impact keeps 40% of the speed), roll on gentler ones, and stop when slow on gentle ground; each
  stopped block piles rock on world.rock (34 m at its middle over 230 m, adding up to 170 m), so the dam is the
  debris where it came to rest, and blocks ride up on earlier piles. The client draws the same blocks, turning as
  they travel, with dust behind them; they stay on the dam.
- The dam's low point is wherever the debris on the floor is lowest (no seeded saddle). The pond fills with the
  water held rivers pour in (40,000 L per metre of the low point's height); it bursts when full, or when rivers
  pressing the debris wash the low point down to 15 m above the floor (the river nearest is named). The burst
  washes out 300 m either side of the low point; the rest of the debris stays and narrows the river.
- Bots: the boldest (aggression over 0.65) go for the toe before it falls; the bold (over 0.4) for the low point
  while it holds.
Ideas, not on the list: a glacier outburst, a river jumping course, a valley stolen through a ridge, a log jam.
