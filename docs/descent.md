# The descent: audit and a proposed design (2026-11-17, not built)

## What the audit found (6 seeds, 12 bots, plus 18 seat races with a greedy cloud chaser)
- It lasts about 74 s, not 120 s: holding the glide stick full (x1.8) costs nothing, so everyone does. That is
  30-34% of the time to the first finish.
- It hands out almost nothing: water at landing 0.78-1.20 of the start (median 1.01). Clouds add 0.06 on average,
  bumps take 0.06; bumps spill as much water to the sky as all clouds give, so the phase cancels itself.
- It does not predict the result: rank correlations of place with landing water +0.08, cloud water -0.22, landing
  spot -0.17 (all noise). A greedy cloud chaser landed with 5% more water and no better place.
- Dead time: the median drop's longest stretch with no cloud or bump is 22 s (worst 74 s); about 14% of a descent
  has no reachable cloud; the first 4.5 s cannot be steered.

## What the prototypes found (an isolated copy, nothing shipped)
- A short descent (about 25 s to land, same cloud water in 7 clouds) means exactly as little and saves about 55 s.
- A full-width landing band (land anywhere across a wide line) is the only variant whose choice showed through: the
  outer slots averaged places 10.6-10.7 against 5.9-6.7 in the middle. But that is a trap you learn once, not a
  tradeoff weighed each race.
- The root finding: moving one bot's landing by 12-25 m swung its final place by 7.1 places on average; a 2 km
  landing choice swung it by 8.5. The race after landing amplifies tiny differences into big swings, so no
  opening choice can matter until that is understood. (Bots only; humans may differ.)

## What other games say the opening is for
- Battle royale drops are a choice and a contest over where to land, not flying time (bs flood-150: DED.NET skipped
  the plane for pinned, contested landing spots; Apex's drop zones aimed at cleaner pacing).
- A good race start is one readable skill moment (bs flood-151: Mario Kart's rocket start, timed to the countdown).
- No data was found on how long an opening can last before it feels dead; League's draft phase drew complaints at
  lengths comparable to Flood's descent.

## Opinion
The descent's one real job in Flood is to decide where and how each river starts the race, and today the game
removes that on purpose: every start is the same height and route length, so the drop has nothing to choose, and
its clouds and bumps cancel out. The constraint to remove is the fair line, not the clouds.

Proposed, in order:
1. First, find why the race turns a 20 m landing difference into seven places (the same chaos makes every other
   choice in the race hard to feel). Measure which mechanic amplifies it: contacts, cuts, lake order, Surge timing.
2. Then a short descent, about 25-30 s, whose output is a landing choice that is a real tradeoff each race: land
   anywhere across a wide band where the lines differ (a fast line with no lakes, a slow one through lakes, one
   shared with rivals), shown from the sky so it can be read and weighed.
3. One skill moment at the end: a timed touchdown (pull out of the dive close to the ground) that sets your opening
   speed, like a rocket start.
4. Clouds and bumps go unless they can be made to matter: at today's size they are noise, and bumps are a net loss.
