# ADR 0006 — A knocked-out river's water goes to the river that drained it

Status: accepted. Resolves Brain tension T178 (merge sink vs conserving merges) toward conserving
the water at a knockout.

## Decision
- When a river falls below the floor (40% of its starting water) and is out, what it still holds
  runs on into the river that drained it (`TUNE.knockoutHandoff`, `src/shared/river.js`).
- The `merge` event now reports that amount as `gain`, matching what the game already tells the
  player ("All of X's water ran into you").
- Unchanged: the size law (cube root of volume) and discharge (`3000 L/tick x size^2`).

## Evidence
- The sink was there to curb the snowball, and it barely did. Brain sandboxes on Flood's own
  bots, sink vs handoff: the river biggest at 60 s won +2 of 30 and +1 of 90 races more with the
  handoff, and 1 of 40 fewer with tuned bots in a crowded field. The winner's share of the field's
  water rose about 3 points.
- The sink destroyed about 16% of a crowded field's water per race (memory: zanegpt#E99, #E388;
  sandboxes 2026-11-03__flood-merge-sink-barely-curbs-snowball.py and
  2026-11-06__flood-merge-sink-tuned-bots-crowded-field.py).
- Real confluences add discharge (zanegpt#E34).

## Costs
- A knockout pays a little more (about 0.4 starting volumes), a small push toward the leader. If
  that shows as a snowball, set `knockoutHandoff: false` to get the old sink back.
