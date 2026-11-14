# Summit Rush — a second mode, from the trailer

Status: redesigned (owner, 2026-11-14), not built. Replaces the first design, whose course (built and on `main`
as Course: Summit Rush) was the ski slope again: walled valleys side by side, all running one way. The ski race
stays as it is.

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
