# Summit Rush — a second mode, from the trailer

Status: designed (owner, 2026-11-14), not built. The ski-slope race stays as it is; Summit Rush is a
choice beside it on the start screen.

## What it takes from the trailer, and what it doesn't
The trailer ("Playing as a River in a Battle Royale") was already tried as a game, as the open island
the game began on, and it didn't work: rivers spread over the island and rarely met, deaths happened out of
sight, and stragglers took ten minutes. So this mode keeps today's rules (depth tug-of-war, the
water economy, lakes, Surge and Gouge, the sky drop) and takes from the trailer only what makes a race
exciting: many rivers, rivers crashing into each other, a camera down among them, and route choice
between valleys.

## The race: two minutes, many rivers, always close
- Up to 80 rivers (the start screen's Rivers setting; bots fill the empty seats).
- Every drop comes down onto one summit. From it three or four valleys fan out and rejoin at one gorge
  before a short run to the sea, so rivers split for route choice and always meet again.
- About two minutes from landing to the first finish (the ski race runs about 2 to 2.5).
- Valleys about a kilometre wide, so with this many rivers you are in contact most of the race (on the ski
  map the nearest rival is a median 2 km away, within 400 m only 4% of the time).

## Every feature is a choice, sized by your water
- **Valleys**: the short, steep, narrow one crowds everyone into each other's channels; the longer, wider
  one has lakes to grow on before the gorge. Both reach the gorge, where the deeper river drains the rest.
- **Arch**: a shortcut through a rock arch that only a small river fits under. Big rivers go round.
- **Forest**: slows a small river (as today) and gives way to a big one, so the forest line is fastest
  only once you have grown.
- **Ridges and pebble**: as on the ski map, crest them with Surge or Gouge, grind through, or go round.

## Rivers hit each other
- Heads that touch shove each other apart, like drops already bump during the descent: the one with more
  momentum wins the hit and keeps its line; the other is knocked aside. On top of that, the draining
  rule stays as it is.
- A hit throws a spray burst between the two heads and jolts your camera; the "rivals cut you off"
  caption plays on your first one.

## The camera: down among the water
- About 150 m behind the head and 40 m up (the ski race uses 330 m and 110 m), the field of view widening
  with speed as it does now.
- Close up, the 100 m terrain grid looks coarse, so this needs finer ground near the player: displaced
  detail on the terrain and dense small rocks around the head. Without it the close camera fails.

## The finish
- The first river into the sea gets the giant #1 as the camera rises over the surf (as now); the race
  ends a fixed time after the first finisher, as it does now, so no one waits on stragglers.

## Open
- Phones with 80 rivers: the sim measured 2.8 ms a tick for 80 bots (0.46 for 12) on a desktop; the
  renderer with 80 ribbons is unmeasured.
- Whether the hit shove makes the gorge a brawl or a pile-up: measure finishes and knockouts in bot races.
