# 0004: One finish beach, and Gouge fires any time

Date: 2026-11-02 · Status: accepted (owner)

## One finish beach
Only the stretch of coast where the slope's axis meets the sea ends the race, `TUNE.beachRadius`
(3 km) either side. In bot races almost every finish already landed within 2.3 km of that point
(one stray finished 24 km away on another coast).

- A river that reaches any other coast is carried by a sea current (`TUNE.seaCurrent`, 150 m/s)
  along the shore to the beach. Steering doesn't work out at sea. It costs time, but the river is
  never stranded. A wall-like sea was rejected because it would trap rivers in coves, the same
  failure the drained lakes had.
- "KM TO THE BEACH", standings, bots and the slope clouds measure the shortest water route to the
  beach (`world.toBeach`). Spawn fairness and forest lanes keep the any-sea distance
  (`world.reach`), so islands don't reroll.
- The beach shore is drawn gold, with red and white posts.

## Gouge fires any time it is ready
A player's Gouge starts whenever it is recharged and the river can pay. It cuts what it can along
the heading: through a rise, part way into one (the ground strip shows where the cut ends), or
nothing, in which case it is just a lunge.

Bots still press it only when the cut breaks through. Brain lesson (2026-11-02, flood gouge
breakthrough): cuts that stop short leave dead-end trenches, and with them bots finished 86 vs 92
of 120 and 3 vs 0 were trapped. The player gets the freedom, and the preview shows the risk.

## Update (owner, same day): Gouge is a climb boost, not a cut
Gouge no longer changes the terrain. After the wind-up, for 3 s (`TUNE.gougeBoost`) the head can
pass over ground up to 80 m x size higher than usual (`gougeLift`, folded into `liftOf`). It goes
where it's aimed even uphill, at least 2x base speed, and climbing doesn't cost it speed. The
cooldown is 10 s from the press. The trench, the breakthrough plan and the dig-phase cut queue are
gone. Bots press it facing a rise above what they can climb but within the boost's lift.
