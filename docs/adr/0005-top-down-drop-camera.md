# 0005: A top-down drop camera, aimed by screen direction

Date: 2026-11-04 · Status: accepted (owner)

## The camera
While a drop falls, the camera sits about 5 km above it, about 7 degrees off vertical, with a narrower
lens (0.8x the base field of view). The beach is always at the top of the screen. The camera moves
with the drop but never turns.

The owner asked for it ("the camera angle is terrible, it should be top down"). It also settles
Brain T182: the old chase camera turned the view at 114 deg/s while the player held a turn, about
twice the 60 deg/s where visually induced motion sickness peaks. A view that never turns has no
yaw at all, and the drop's heading stays readable from the arrow ahead of it.

## Aiming
With a fixed view, turning left or right relative to the heading reads backwards whenever the drop
faces down the screen (Brain opticon#E42: map input through the view the player actually sees). So
while falling, the left stick and D-pad aim by screen direction. Push where you want to go, and the
drop turns that way by the shorter side. Push all the way to glide fast; let go to hover (a slow glide) and wait for a cloud. The client turns this into
the same steer and glide inputs as before, so frames, the server and replays are unchanged. The
right stick still sets the fall speed. Keyboard steering is unchanged (turn left and right), and
touch already aimed by screen direction.

## Height
A view from above hides height (Brain seven#E52: the perspective was a mechanic), and a drop only
catches a cloud near its own height (`TUNE.cloudDepth`, 400 m). So each drop cloud you can still
reach carries a tag giving its height below you, and the tag turns gold and reads "your height: fly
in!" once you are level with it.

## Update 2026-11-04: a comet approach instead of top-down
The owner found the top-down view made it hard to tell where the drop was relative to the clouds
(it looked above them when it wasn't). Drops now come in like comets: each starts a steady glide's
run (`TUNE.cometRun`) behind its start spot, over new scenery land behind the start line (a dead
zone: terrain `mask` 0, no spawns, landings or lakes), and is held in a funnel that narrows to the
start line as the fall runs out, so it always lands on the line and never before it. The camera
chases from behind and a little above, always facing down the slope, so there is still no yaw
(T182 stays settled). Height reads from a ground shadow and stem under every drop, cloud shadows
and the height tags. Altitudes count from the start line's height (`skyBase`), not the ground
underneath. Drop clouds sit along the comet path, spread wide early and packed close to the
middle of the start line near the end, so drops converge and bump. Once landed, the right stick
looks up to 30 degrees aside (drifting back) and up raises the view; the map is off.

## Update 2026-11-06: a slipstream, and bots that keep pace
Measured over 12 islands, a player holding full stick and flying straight had one event in a 44 s
descent, with a 40 s quiet gap (Brain flood#E126: judge dead air by the longest gap). Three causes:
bots with nothing to chase glided at the base speed (1x against the player's 1.8x); a chasing bot
at the same speed as its target never closed; and a bot under its target stayed out of bump height.
Now bots fly at full stick, dive onto targets below them and float up to targets above, and a drop
flying within 600 m behind another (120 m either side, within bump height) glides 20% faster
(`TUNE.draftLength`, `draftWidth`, `draftBoost`), past the stick's cap. That's a slipstream, so a
chase can close. Longest gap for an active player went from 20 s to 11 s, events per descent from
8 to 16, and the slowest 10% of landings from 71 s to 57 s. Over 24 islands, ramming and dodging
still come out even (mean about 1.1 in both builds). Diving gives no extra speed once a drop is on
the floor, since it has no height left to trade. The altimeter shows "slipstream" while you're in one.

## Update 2026-11-06: a calm opening, and bumps that can't pin a drop down
The owner asked that nobody be hit during the opening shot, when the player can't steer: no bumps for
the first `TUNE.dropCalm` ticks (4.5 s, which is also the shot's length). The owner had one bot ram
them for a whole descent, so a bump now checks the hitter (half glide for 1 s) and the drop it hit
darts away (1.6x for 0.5 s). The hitter is the drop with more of its own speed into the other. A bot
chases one drop for at most 6 to 18 s (by aggression) or 2 hits, then leaves it alone for 30 s. A bot
that's bumped turns on whoever hit it. Over 12 islands, a player who chases clouds but never rams took
a median of 3 hits per descent (was 16), and at most 3 from any one bot (was 11).

## Bots see what a player sees (not part of the camera decision, recorded here with it)
The owner asked that bots stop finding their way by the whole map. On the ground, a bot weighs headings
only within 30 degrees either side and only 1200 m ahead (`TUNE_BOT.view`). Its sight is a quarter less
if trees stand in the way and half as far if the ground rises above its eye (a ridge). It judges
progress by how far down the island a spot is, not by distance-to-beach along the best route. Bots
finish about 5% slower.
