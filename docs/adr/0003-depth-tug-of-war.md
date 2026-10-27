# ADR 0003 — Contact is a depth tug-of-war, not an instant absorb

Status: accepted (milestone 7). Resolves the Brain tension "river contact: instant absorb vs depth
tug-of-war vs pure blocking" toward the tug-of-war (owner's call).

## Decision
- Every river cuts to a depth set by mass and speed: `depth × size × (0.7 … 1.42 by speed)`.
- Where a head touches a rival's head, or a rival's live channel (dug in the last 15 s), the
  deeper water siphons the shallower: 1.2% of the loser's water per tick at a 100% depth lead,
  scaled down for smaller leads, nothing under a 5% lead, at most 1.5% per tick in total.
- A river below 40% of its starting water dries up and is out, credited to its biggest siphoner.
- Live rival water no longer dents the surface others flow on. Crossing costs water, never traps
  (a trench you can't climb out of would turn every contact back into a death).

## Evidence (10 seeds, 12 bots each)
- Snowball unchanged: the river biggest at 60 s won 1 of 10 races, same as with instant absorb.
- Eliminations 3.4 → 1.6 per race; finishers 8.4 → 10.0; about 22% of all water changes hands.

## Costs
- Contacts are less decisive; the race is decided more by routing and water than by kills.
- Players need feedback to read it: red/green/amber heads and ▲▼= tags by depth, "cutting N m
  deep" in the HUD, a red edge and "X is draining you" while losing water, "+N L from X" while
  gaining.
