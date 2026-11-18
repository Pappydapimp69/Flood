# The Landslide: what it is for

Claude's design position, 2026-11-17, written before any more building (owner: work out what the mechanic is
for first). Evidence cited by bs id; numbers from bot races in this repo's tools. Revised the same day after
re-reading where it came from (summit-rush.md, "The living mountain"): the first version below read it as a
comeback device; that is a consequence, not the purpose.

## Fourth pass (2026-11-17, owner: consider the game as a whole)
The toe trigger of the third pass was wrong for Flood. A river has no engine: its speed comes only from the line it
takes over the terrain, so a trigger at one spot on the valley side is a detour that costs the best line, the
lakes, the fights with rivals and even the descent's choice of clouds. A trigger must come from what rivers
already do on whatever lines they choose.

Position: **the trigger is the water the whole field puts into the mountain above the slope.** Real slopes fail
when water soaking into them raises the pressure underground; steady water only primes a slope, pulses set it off
(USGS, Iverson 2000; bs flood-149). Flood already models the soaking: every channel seeps into the ground
(`TUNE.seepRate`) and storms rain into it. So every channel carved above the slope soaks it as it flows, and the
pulses that run down those channels push it harder. Bigger rivers, deeper channels, lake water drawn through
outlets, storms and skills that carve all bring it sooner, as side effects of playing well, never as a detour.
It is not a clock in disguise: a field of small, thin rivers soaks it slowly and a field that grows fast brings it
down early, and where the field's water runs decides which slope gets the water.

What stays from the third pass: one fixed, marked slope; its soaking shown on the slope in stages (darkening,
cracks, slumps, a countdown) so every river can read it and choose to beat it or ride it; no clock; lakes as water
(basin inflow, flood top-ups), not a trigger. What goes: the toe trigger, and ringed lakes as latches.

## After external research (2026-11-17, third pass): my position
What other games teach, and what follows for Flood:
- **Player-caused, not timed.** Battlefield 4's Levolution began as "Timeline", a background timer that changed
  maps whatever players did, and was reworked so players trigger each event, with the stated rule that the
  set piece must matter to play and not only be spectacle (flood-112). Split/Second's route changers are also
  fired by racers (flood-108). Grumble Volcano's crumbling on lap 3 and MotorStorm Apocalypse's earthquakes are the
  timed or uncontrolled kind; MotorStorm's reviewers liked that only because no racer could abuse it (flood-145).
  Flood wants the first kind: the owner's "no river, no slide".
- **The cause must be legible where the effect happens.** Harvey Smith found Deus Ex players felt robbed when their
  actions changed a situation in ways they could not read, and Tim Cain's telegraphing rule is the same from the
  other side (flood-147, flood-135). Today's trigger fails this: you touch a ringed lake kilometres away and a slope
  you never looked at gives way. It is a checkbox, not water, and bots tick it for you.
- **A trigger is worth having only as a situational tradeoff.** Sid Meier: interesting decisions are tradeoffs that
  depend on the situation (flood-147). Split/Second was criticised where outrunning the field beat using its
  hazards (flood-143); the Blue Shell where the user gained little and the target had no way out (flood-141).
- **Catch-up must not be the point.** Visible rubber-banding is the best-known failure of dynamic difficulty in
  racing games (flood-148). The flood carrying the held rivers is fine as a consequence of a rule; the event must
  not exist to slow the leaders.
- **From Dust's lesson:** a water and terrain simulation is the play itself; the hard part in multiplayer is how
  players act on the terrain (flood-146). Flood already has the verb: rivers erode.

So my opinion, and where it disagrees with what is built:
1. **Purpose:** the living mountain, a part of the course the rivers can break, whose breaking reshapes the water
   network for everyone: it cuts the channels across it, stores the water behind it and releases it as a flood.
2. **Trigger: the rivers wear the slope's toe, not ringed lakes.** Undercutting the toe is what real rivers do to
   bring slopes down (USGS, flood-113), it happens at the slope where everyone can see it, and it uses Flood's own
   verbs: a river flowing along the toe wears it a little, a Gouge into it a lot. That was the owner's first
   trigger (2026-11-14); it was replaced because the spot was not apparent, the 3 s delay was short and it fired too
   late to see. Those are faults of marking and timing, fixed by the stages below, not of the cause.
3. **Combined and staged.** Every river's erosion adds to one shared wear on the toe, shown on the slope itself:
   cracks open, stretches slump, then a countdown of about 10 s, then a fall of about 12 s while the dam grows. One
   river can bring it down alone only by spending time and Gouges there; a few passing rivers bring it down by
   flowing along it. Several rivers, several spots along a 2.5 km toe, as the owner asked.
4. **The tradeoff is built in.** Whoever sets it off is at the slope when it goes. Run on and you beat it, but your
   own channel is cut behind you until the burst; stay and you are held, then ride the flood. Setting it off just
   after rivals pass cuts their supply; just before they arrive holds them, and they ride the flood past you later.
   No choice is always right, and every choice costs the chooser something (flood-147).
5. **Lakes keep their role as water:** the lakes above drain into the basin when it closes (so the hold stays short,
   flood-134), and the flood fills the lakes below (so rivers ahead with outlets there are paid back). They stop
   being the trigger.
6. **No clock, a fixed marked slope, no placement chasing the leader.** If no river touches the toe, it never falls.
7. **Bots** wear the toe only when it suits them (a rival close behind, or their own route along it), so the player
   sees rivals use it deliberately, not by drifting through a ring.

## Where it came from
The owner's verdict on the set-piece maps, 2026-11-14: "the map has to feel alive"; the mountain should change
during the race. The landslide is the first piece of a living mountain (ideas listed beside it: a glacier
outburst, a river jumping course, a log jam). And from the start, "No river, no slide": the rivers cause it.

## What it is for, in one line
The rivers' own water changes the mountain, and the changed mountain changes the rivers' water: the field's lake
visits soak a slope until it falls, the debris cuts the channels through it and stores the water behind it, and
the burst gives that water back down the valley. A closed loop the players set in motion, not an event the game
runs at them.

## What it adds to the plain slope
On the plain slope a lake is only a refill. Here the lakes above the slope also load it, so the race splits into
two ways to play: take the lakes (grow, soak the hill, and be behind the dam when it falls, then ride the flood)
or skip them and run (beat the slope, but past it your channel is cut and your pulses stop until the burst). The
landslide is what makes "lakes or speed" a real fork with a visible consequence, and the field's choices decide
when it happens.

## What it does (first reading, still true as effects)
The ski slope alone is a solo time trial with neighbours: in 12-bot races the nearest rival sits about 1 km away
(within 400 m only 5-10% of the time), and positions rarely change once the field spreads. Nothing in the world
makes the field meet or makes one river's choice change another's race.

The landslide is the one moment where the world itself changes for everyone, the way a battle royale's zone
forces players together and Split/Second's route changers rewrite a track mid-race (flood-108). It does three
things the plain slope cannot:
1. **It regroups the field.** A dam holds whoever is behind it and the burst throws them forward, so a spread race
   comes back together at one place and time.
2. **It turns one decision into the race's turning point: beat it or ride it.** A river near the front can push
   to get past the slope before it falls, or hang back and ride the flood. That only works if the slope is
   somewhere you can see coming and plan for.
3. **It shows Flood's water as one connected system.** Water upstream of a dam has nowhere to go but the basin; a
   full basin overtops; the outburst runs down the valley into the lakes and channels below. Every step is how
   real landslide dams behave (USGS, flood-113: a landslide dam usually fails by overtopping at its lowest point,
   and how fast the lake rises, set by inflow, decides when; Baige 2018 filled in two days at 1,680 m3/s).

## Why the basin fills, and why a full basin breaks the dam
The basin fills because all the water behind the dam drains into it: every river behind the dam, and the lakes
above. That is not decoration; it is the timer, and it is self-balancing. The more rivers held, the faster it
fills and the sooner they are released, so the hold can never become a long trap for a lone river (it did, 40 s,
before the lakes' inflow was added: flood-134).

A full basin breaks the dam because a landslide dam fails by overtopping. In the game that turns the held time
into the payoff: the water that held you is the water that carries you. The punishment and the reward are the
same water.

## Why the wave pushes those held, while those who beat the slide keep going
It is a trade, not a punishment:
- **Beat it:** you keep your place and your pace, but the debris cuts the channel behind you, so your pulses stop
  until the burst; afterwards you gain from the lakes below that the wave fills (if you have outlets there) and
  from the wave pouring into your channel.
- **Ride it:** you lose time held behind the dam, then gain speed and water from the flood.

Those are the two sides of the lakes-or-speed fork above: whoever took the lakes caused it and is behind it;
whoever ran is past it. The target is that both ways to play stay viable across seeds, so the choice is real. Split/Second was
criticised where simply outrunning the field beat using its hazards (flood-143); a ride that always wins would be
the opposite failure. This must be measured, not assumed: time to the sea for rivers that beat it against rivers
that rode it, same seeds.

## What should not trigger it
- **A clock alone.** It happens without anyone causing it: scenery, the owner's complaint.
- **Nobody near it.** If the field has already passed, nothing is regrouped and nobody chose anything. That is what
  happened before 2026-11-17 (on some seeds 7-11 rivers were past the dam before it closed).
- **One river by accident.** A bot drifting through a lake was setting it off; a trigger the player cannot see or
  answer is a gotcha (flood-135).

## Why it needs triggers, and what they should be (second pass; superseded on the trigger by the position above)
It needs triggers so it has a cause the players can see and a moment they can see coming: a warning they can act
on (flood-135). Without a trigger it is either scenery (a clock) or random.

My view: **the trigger should be water reaching the slope, which in Flood means lakes**, because water soaking a
slope is what actually brings slopes down (flood-113) and lakes are already the resource every river is chasing.
Several lakes, combined into one shared soaking, not a single lake: one lake makes it a coin flip owned by
whoever happens to pass, while several combined make it a pressure that builds as the field moves through the
lake zone, so the front can read how close it is and decide. Not separate per-river activations: separate
activations make it a personal weapon (a Blue Shell, flood-141), which removes the shared choice the event exists
for.

No clock, not even as a backstop (the first version of this note wanted one; that was wrong): the point is that
the rivers cause it. If the field skips the lakes and the slope never falls, that is the field's choice and its
result, as the owner's first spec had it ("No river, no slide"). What must be tuned instead is that the lakes are
worth taking, so a normal race does soak the slope.

## Stages, not all at once
Stages: each lake reached soaks the slope a visible step further (cracks widen, a stretch slumps), then the final
crack gives a countdown, then the fall takes seconds as the rock arrives and the dam grows. Each stage is a warning
and a decision point; a fall all at once is a gotcha. The fall itself must take long enough that a river close to
it can try to beat it and sometimes make it.

## Where it stands
The slope belongs at a fixed, visible place on the course, marked from the start, with the trigger lakes above it.
The 2026-11-17 change that moved it to wherever the leader was heading was wrong on this reasoning: it removed the
"beat it" half and turned a shared event into one river's weapon.

## What to build next (not yet built)
1. A fixed, marked slope again whose toe the rivers wear (flow along it, Gouge into it), with the shared wear shown
   in stages on the slope; ringed lakes no longer a trigger; no clock.
2. Measure the fork on several seeds, lakes-takers against runners, and tune the hold, the ride, the cut and the
   lake top-ups until both stay viable.

## Built: throttled by the field (2026-11-18, owner: 20 rivers is the standard base, 12 the easy choice)
The whole field pours into the slide's hill and basin, so with more rivers it cracked and burst sooner: the warning
fell from about 12 s at 12 rivers to 7 s at 20 and 4 s at 40. The hill's load and the basin's hold now scale with
the field against the standard 20 (`SLIDE.field`, `fieldShare`), and a basin holds between `minCap` and `maxCap` of
it (a 1M hollow burst in a second; a 24M one doubled for 40 rivers took 21 s). Measured on five seeds: warnings
9.3-12.4 s and fills 3.8-10.8 s at 12, 20 and 40 rivers alike. The game now starts at 20 rivers; 12 is labelled easy.
