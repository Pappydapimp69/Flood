# Summit Rush — a second mode, from the trailer

Status: designed (owner, 2026-11-14), audited the same day; the course is built (Course on the start screen,
`?course=summit`), the rest is not. The ski-slope race stays as it is; Summit Rush is a choice beside it.

## Built so far: the course
- `rushShape` / `rushHeight` in `src/shared/terrain.js`: three or four valley heads side by side, a valley from
  each (one narrow and straight, one wide with bends and lakes, the rest between), fanning out and rejoining at one
  gorge, then a short run-out to the sea. A start ring round each head; the landing lane spans all of them.
- Per-course rules (`COURSE_RULES` in `src/shared/river.js`): starts 250 m apart, the full-width landing lane, and
  spawn grace capped at 7 s.
- Measured, not assumed (`node tools/bot-race.mjs --course summit --rivers 30 --drop <seeds>`): bots average about
  300 m/s, so the 16 km first guessed gave a 55 s race. The course is now about 39 km of route: fastest finish
  125 to 137 s on seeds 1 to 3 at 30 rivers, a rival within 400 m 22 to 26% of the time (the ski map: 16 to 19%).
- Still the old drain: at 30 rivers 14 to 18 are knocked out, at 80 rivers 57. That is the draining this design
  and docs/collisions.md change; not built yet. `tools/course-map.mjs --course summit <seed>` draws the island.

## What it takes from the trailer, and what it doesn't
The trailer ("Playing as a River in a Battle Royale") was already tried as a game, as the open island
the game began on, and it didn't work: rivers spread over the island and rarely met, deaths happened out of
sight, and stragglers took ten minutes. So this mode keeps today's rules (depth tug-of-war, the
water economy, lakes, Surge and Gouge, the sky drop) and takes from the trailer only what makes a race
exciting: many rivers, rivers crashing into each other, a camera down among them, and route choice
between valleys.

## The race: two minutes, many rivers, always close
- Up to 80 rivers (the start screen's Rivers setting; bots fill the empty seats).
- The comets rain in toward one summit, but land on start rings at the head of each valley, about 20
  rivers a ring. (Audit: one summit's ring seats only 15 to 18 rivers at the 600 m `spawnGap`.)
- From the summit three or four valleys fan out and rejoin at one gorge before a short run to the sea,
  so rivers split for route choice and always meet again.
- About two minutes from landing to the first finish: at 130 to 140 m/s, a course of about 16 km
  from the valley heads to the sea. Measure it on the generated island; don't assume it.
- Valleys about a kilometre wide, so with this many rivers you are in contact most of the race (on the ski
  map the nearest rival is a median 2 km away, within 400 m only 4% of the time).
- Spawn grace grows with the field (`graceTicks` 100 + 2 per river): 260 ticks, 13 s of no contact
  with 80. Cap it for this mode, or a sixth of the race has no contact.

## Draining in a crowd
Audit: a river can lose up to 5% of its starting water a tick (`siphonCap`), so in a crowd of deeper
rivers it falls to the knockout floor in about half a second, and the knockout hands all its water to
the drainer (ADR 0006), which feeds the leader. In a mode built on contact that makes the gorge a kill
zone, not a fight.
- Cap draining per pair of rivers, not per river, and slow it in this mode, so a crowd costs you water
  over seconds and you can steer out.
- Hand a knocked-out river's water to everyone who was draining it, by what each took, not all to one.

## Every feature is a choice
- **Valleys**: the short, steep, narrow one crowds everyone into each other's channels; the longer, wider
  one has lakes to grow on before the gorge. Both reach the gorge.
- **Notch**: a gap in a rock wall only as wide as a small river, a shortcut big rivers can't take. (Audit:
  an arch is impossible, because the terrain holds one height per point, so nothing can pass under an
  overhang. A narrow notch makes the same choice.)
- **Forest**: trees give way to momentum, size times speed (`breaksTrees`), so a small fast river already
  smashes through. The forest line is a choice of keeping speed up, not of size. (Audit: the first design
  wrongly made it a size gate.)
- **Ridges and pebble**: as on the ski map, crest them with Surge or Gouge, grind through, or go round.
- Bots must judge time, not distance: today they score a heading by the course's distance to the beach
  (`world.toBeach`), which knows nothing of forests, lakes or crowds, so they would always take the
  shortest valley. Give them a measured time to the beach from a pathing pass.

## Rivers hit each other
- When heads touch, each gets a short push along the fall line, away from the other, fading through its
  own flow; the deeper river (the same rule that decides draining) keeps its line and the shallower is
  pushed off it. (Audit: the descent's bump is a sideways slide of about 130 m that ignores the slope,
  and it picks its winner by momentum while draining picks by depth: two rules that can disagree.)
- A hit throws a spray burst between the heads. The camera jolts only on the first hit by a given rival in
  a few seconds, and never with shake turned off in the options (Xbox accessibility guideline 117: let
  players turn off camera shake; bs flood-89).

## The camera: down among the water
- About 150 m behind the head and 40 m up (the ski race uses 330 m and 110 m), the field of view widening
  with speed as it does now, still aimed along the river's course so it never fights the player (flood-22).
- Audit: the camera's ground clamp keeps it at least 45 m above the ground at the head and 115 m at its
  own end, so the clamp must change for this mode, or the 40 m never happens.
- Audit: the terrain is a flat 100 m mesh; its rocky look is lighting only. The close camera needs real
  finer geometry near the player (a detail patch that follows the head) plus dense small rocks, or it
  shows flat triangles.

## The finish
- The first river into the sea gets the giant #1 as the camera rises over the surf (as now); the race
  ends a fixed time after the first finisher, as it does now, so no one waits on stragglers.

## Open
- Phones with 80 rivers: the sim measured 2.8 ms a tick for 80 bots (0.46 for 12) on a desktop. Each river
  draws about 8 objects, so 80 rivers is about 640 draw calls before the terrain: batch them, and measure
  on a phone before choosing the cap there.
- Whether the gorge becomes a brawl or a pile-up with the slower draining: measure finishes and knockouts
  in bot races.
