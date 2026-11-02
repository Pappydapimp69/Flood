# Lake traps: lesson plan to train Brain

## Outcome (2026-11-02): fixed in 198e855, and the suspected cause below was wrong

- **Owner call answered from Brain:** never a trap. dog#E11 and sweety#E19 (audited) say
  every state and every enclosure needs a guaranteed exit. The water-currency kernel says a
  basin costs water and time to fill, never the race.
- **Real cause:** the heat front isn't what drains these lakes. Rivals' outlets erode their
  lips 15-39 m and drain the lake to the lowest one. A rival that climbed out over a bank has
  its outlet at that bank cell, and the fill's downhill tree from there runs back into the
  lake. `lowestExit` picked it as the lowest lip, so the head looped in and out forever.
- **F1 (restore pooling) tested alone: no effect.** The eroded lips drained the topped-up lake
  again within seconds, and 5 rivers were still trapped. Dropped.
- **Fix:** `lowestExit` skips outlets whose downhill path returns to the same lake.
  - Diagnosis islands: trapped 6 to 0, stalls over 60 s 11 to 2, finishes 92 to 92.
  - Held-out islands (7 13 21 33 57 64 88 150 222 512): trapped 4 to 0, stalls over 60 s
    8 to 3, finishes 91 to 97.
  - npm test 52/52.
- Lesson filed in memory incoming (`2026-11-02__flood-lake-exit-drains-back.md`).
- L1-L5 below stay open as training on the leftover stalls (2-3 over 60 s that still move).

Rivers still get stuck in lakes. `brain start lake|stuck|basin|outlet` turned up five
lessons on this (flood#E7, E16, E32, E33, E37), and all five are already in the code,
so Brain has no fix for what's left. This plan lists the training passes that would
give Brain one. Each pass follows `brain train`: write the prediction, build a
deterministic sandbox, and file only what the sandbox confirms.

## What the code does now (measured 2026-11-02, `node tools/lake-traps.mjs 4 5 8 11 43 99 126 314 780 2024`)

- 10 islands, 120 rivers (8 bots + 4 unsteered per race), 600 s each.
- 92 finished. **6 were still in a lake at the end** (5 unsteered, 1 bot).
- 54 lake stalls over 15 s. 11 over 60 s, and the longest was 477 s.
- **9 of the 11 long stalls began in a lake already 5 m or more below its brim**
  (range 5 to 62 m). The other two began 0 m and 3.2 m down.
- Trace (island 4, r00, lake 21): the lake sits at 1215 m against a 1247 m brim. The
  head circles the empty bowl at about 190 m/s. `exit` gets set, then cleared a few
  seconds later. `low` stays at the brim.

## Suspected cause (not verified yet; L1 to L3 test it)

1. `299df9f` dropped basin pooling, including the guaranteed exit after
   `maxPoolTicks` (top up and spill after 10 s).
2. `0f61af3` made every lake full and keep it full, so no exit was needed.
3. `50cded9` added the heat front, which dries lakes again (`weather()`,
   `TUNE.heatLake`). That turned them back into pits, and the exit never came back.
   `r.pooled` is never set now, so `maxPoolTicks` and the `pooled` branch in the
   head update are dead code.

Every remaining lake fix assumes a full lake: bank cuts (E33), pass-through (E37), and
the fill route (E7), whose flat `filled` surface sits at the brim.

## Lessons

Run them in order. Each is one sandbox pass, and each fix is tested alone against the
same seeds (rule from flood#E37).

| # | Question | Prediction (could come out wrong) | Sandbox | Composes |
|---|---|---|---|---|
| L1 | Are long lake stalls really drained-lake stalls? | At least 90% of stalls over 60 s, on 30+ islands, enter a lake 5 m or more below its brim. With the heat front off, stalls over 60 s fall by at least 80%. | `tools/lake-traps.mjs` with `TUNE.heatLake = 0` vs on. | flood#E37 (classify first), flood#E41 |
| L2 | Does a stale `r.low` hide the block in a drained pit? | `low` stays within 2 m of the brim while the head is 15 m or more below it, so the bank-cut test (aim above the climb ceiling) never fires. That means 0 cut events in drained-lake stalls and more than 0 in full ones. | Count `cut` events per stall, split by deficit. | flood#E33, flood#E16 |
| L3 | Does the fill route cycle in a pit? | `exit` set and clear repeats with a period of 3 to 8 s, and net displacement per 10 s stays under 35% of distance travelled (E16's rocking signature). | Trace `exit`/`route` per tick on the 6 trapped rivers. | flood#E7, flood#E16, zanegpt#E35 |
| L4 | How deep a pit can momentum climb out of? | Escape height scales with speed squared, so at about 190 m/s the head clears X m. Predict X from `TUNE` climb cost before running, then compare it against the observed trap depths (14 to 62 m). | Python toy: a head in a bowl of depth D with Flood's speed and climb rules, D swept from 0 to 120 m. | flood#E43 (real stage-storage) |
| L5 | How fast does a lake become a pit compared with how long a head stays? | With `heatLake`, a lake drops past 5 m within N s of the front passing. Predict N before running. With E41's level-per-time evaporation, it would never reach 5 m in a race. | Log the deficit over time per lake against front arrival. | flood#E41, flood#E43 |

## Fix candidates (one at a time, same seeds; keep only what moves the numbers)

- **F1 Restore the guaranteed exit:** a head in a lake below its brim pools, and the
  lake tops up and spills after `maxPoolTicks`. Smallest change, and the code is
  already there.
- **F2 Re-seat the ceiling:** on lake entry, set `r.low` to the current lake level, so
  the E33 bank cut can fire against the pit wall.
- **F3 Route from the water, not the brim:** in a drained lake, use the current level
  to pick the exit, not the flat brim surface.
- **F4 Hold the level while a head is in it:** the heat front skips a lake that has a
  head in it.

Pass bar: no rivers left trapped at the end on the 10 islands above, long stalls
cut by at least 80%, and bot finishes unchanged within noise.

## Owner call (surface before building)

Should a drying lake be a **hazard** (the heat front is meant to make the lower
slope harder, so a pit that traps is the point) or **never a trap** (drying costs
water, not your race)? F1 and F3 keep the drying and remove the trap. F4 removes the
drying where it matters. This touches open tension 🔴 T180 (how the race ends: the 90 s straggler window, a
rising sea, or a front that dries rivers out). A trapping pit is a version of the
third option, so settle T180 first. T179 (outlet breach) and T183 (groundwater) are nearby. File it as a new tension if it isn't settled.

## Write-back after each pass

- Confirmed pass: a memory proposal (`brain lab mine` for the schema) with the
  sandbox, then `brain save`.
- Generalizable rule ("a guard removed because its precondition held, then the
  precondition broke"): an `ideas` kernel.
- Hazard vs never a trap: a `tension` entry.
