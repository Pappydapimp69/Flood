# Head collisions, and draining only through channels

Status: designed (owner, 2026-11-14), not built. Applies to every mode.

## Why
With 30 rivers the race became very hard: a deeper head touching yours drains you. Today a deeper
river takes up to 4% of your water a tick (80% a second, `siphonRate` 0.04, `siphonCap` 0.05), and you
are out below half your peak water (ADR 0007), so one second of touching knocks you out, faster than
anyone can see it and steer away. The drain was raised to that on 2026-11-09 because rivers grew to 3
to 17 times their starting water and no one came near the floor; the carving cost added on 2026-11-14
keeps rivers much smaller, so the reason has gone while the drain stayed. More rivers mean more
touches, so the one-second knockout comes over and over.

## Heads that touch collide; they don't drain
- When two river heads touch, they bounce apart, the way falling drops already bump in the descent.
- Each loses some water as spray, more for a faster, more head-on hit. That water goes to the sky, not
  to the other river, so a hit never feeds the leader.
- Depth decides the hit, the same rule as draining: the deeper river keeps its line, the shallower is
  pushed off it. The push runs along the slope (the fall line), short and fading through the river's own
  flow, not a sideways slide. (The descent's bump slides a drop about 130 m sideways and picks its winner
  by momentum; landed rivers use depth so the two contact rules never disagree.)
- A hit alone never knocks a river out: knockouts come only from being drained through a channel.
- Once two rivers have collided, that same pair can't collide again for 3 seconds. Either can still hit
  anyone else. (Drops already keep a per-pair cooldown, `bumpCool`, 2 s; this uses the same mechanism,
  set in seconds.) During those 3 seconds the two heads can overlap without bouncing, which is harmless
  now that touching heads no longer drain; the first bounce should carry them apart before it ends.
- A hit throws a spray burst between the heads and jolts your camera, except with shake turned off in
  the options (bs flood-89).

## Draining comes only from channels
- A head in a rival's live channel (dug in the last 15 s, `liveTicks`) is drained while it stays there,
  by the deeper side, at 1.2% of its water per second (owner, 2026-11-14), stated per second so it reads
  the same whatever the tick rate.
- A cut still joins the two channels for 15 s after the last touch, and in that time a share of every
  pulse coming down the shallower river's channel runs into the deeper one (as now). This is the
  mechanic that makes cutting through a rival's channel worth doing again.
- A knocked-out river's water still goes to the river that drained it (ADR 0006).

## Bots
- Today bots flee any deeper head. They learn instead that ramming costs both sides water and that the
  shallower side is pushed off its line: ram a shallower river only when the push sends it somewhere
  worse, otherwise keep clear; seek shallower rivals' channels to cut.

## How to tell it worked
- Bot races at 12 and at 30 rivers, the same seeds before and after: knockouts per race, finishers, the
  winning time, and how many knockouts come within a second of first contact (should be none).
- Then the owner's play test at 30 rivers.

## Rates are per second
Every rate in this design is stated per second, never per tick (owner, 2026-11-14: ticks are too
unstable a unit to reason in). The code converts with `DT`.
