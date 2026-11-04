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
