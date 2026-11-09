# ADR 0007 — Knockouts: half your peak, and a stronger drain

Status: accepted. Follows ADR 0003 (depth tug-of-war) and ADR 0006 (the drainer gets the water).

## Problem
On the 6 Nov build, 12 headless races of 12 bots (half with the sky drop) had 0 knockouts, and
11-12 of 12 rivers reached the sea every time. Contact was common (35-44 river pairs and 8-13M L
moved per race), but rivers grow to 3-17x their starting water, so the fixed floor of 40% of the
start (200k L) was never in reach: no river ever lost more than 27% of its own peak.

## Decision
- A river is out below the higher of 40% of its starting water and half the most it has ever
  held (`TUNE.floorPeak`, `knockoutFloor()` in `src/shared/river.js`).
- The drain is stronger: `siphonRate` 0.012 -> 0.04 and `siphonCap` 0.015 -> 0.05 per tick.

## Evidence (12 islands, 12 bots, sky drop on)
- Old: 0.00 knockouts per race, 11.4 of 12 at the sea; the river biggest at 140 s won 6 of 12.
- Stronger drain alone: 0.92 knockouts per race; biggest at 140 s won 7 of 12.
- This ADR: 2.25 knockouts per race, 9.4 of 12 at the sea; biggest at 140 s won 5 of 12. That is
  back inside the range Flood has had (ADR 0003: 1.6 per race with the tug-of-war, 3.4 before it),
  with no added snowball.
- A peak floor alone (40-60% of peak) gave 0 knockouts: contacts were too short to drain that far.
- Unit, play and online tests pass (no desync).

## Costs
- A big river that loses half its water in fights is out, which is harsher than before.
- Bots only; a human may seek or avoid contact differently. Retune `floorPeak` first if it feels harsh.
