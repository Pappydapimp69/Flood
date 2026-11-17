# The Landslide: what it is for

Claude's design position, 2026-11-17, written before any more building (owner: work out what the mechanic is
for first). Evidence cited by bs id; numbers from bot races in this repo's tools.

## What it is for
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

The design target is that the two come out close to even across seeds, so the choice is real. Split/Second was
criticised where simply outrunning the field beat using its hazards (flood-143); a ride that always wins would be
the opposite failure. This must be measured, not assumed: time to the sea for rivers that beat it against rivers
that rode it, same seeds.

## What should not trigger it
- **A clock alone.** It happens without anyone causing it: scenery, the owner's complaint.
- **Nobody near it.** If the field has already passed, nothing is regrouped and nobody chose anything. That is what
  happened before 2026-11-17 (on some seeds 7-11 rivers were past the dam before it closed).
- **One river by accident.** A bot drifting through a lake was setting it off; a trigger the player cannot see or
  answer is a gotcha (flood-135).

## Why it needs triggers, and what they should be
It needs triggers so it has a cause the players can see and a moment they can see coming: a warning they can act
on (flood-135). Without a trigger it is either scenery (a clock) or random.

My view: **the trigger should be water reaching the slope, which in Flood means lakes**, because water soaking a
slope is what actually brings slopes down (flood-113) and lakes are already the resource every river is chasing.
Several lakes, combined into one shared soaking, not a single lake: one lake makes it a coin flip owned by
whoever happens to pass, while several combined make it a pressure that builds as the field moves through the
lake zone, so the front can read how close it is and decide. Not separate per-river activations: separate
activations make it a personal weapon (a Blue Shell, flood-141), which removes the shared choice the event exists
for.

Time should be a backstop only: if the field is about to reach the slope and the soaking is not done, it should
still come down then, in front of the front-runners, so the set piece never fails to happen. Time sets the latest
moment; lakes set the usual one.

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
1. A fixed, marked slope again, with the trigger lakes well above it so the soaking finishes while the field is
   approaching, not after it has passed; the time backstop for when it would otherwise be late.
2. Measure beat-it against ride-it on several seeds and tune the hold, the ride and the lake top-ups until neither
   dominates.
