# Flood

A browser battle royale where every player is a river. Race downhill across an island, swallow
lakes to grow, cut rivals off, and be the first to reach the sea.

## Play
In the browser: https://pappydapimp69.github.io/Flood/ (solo against bots; online races need `npm run server`, then `?online`).

Steer with ← → (or A D). Falling: ↑ (W; the right stick up on a controller; ▼ DIVE on a phone, a tap turns it on or off) descends faster, and ↓ (S; RB on a controller; ▲ DASH on a phone) dashes, twice the speed for a second, ready again 5 s after. On a controller the left stick and D-pad only steer. On a phone the game plays in landscape: ◀ ▶ under your left thumb steer (20% gentler than a key), ▼ DIVE / ▲ DASH under your right fly the drop, and once landed dragging anywhere else works like the right stick (sideways looks around, up pulls the camera back). The 4.5 s opening shot can't be skipped.

- **Gouge** (Space / E, pad A or B, or the GOUGE button): your river keeps its momentum and Gouge adds to it: more speed and a bigger head for 3 s, flowing over ground up to 80 m higher than usual. 10 s cooldown; costs water.
- **Surge** (Q / F, a pad bumper, or the SURGE button): adds a burst of speed on top of what you have, for 2 s. 8 s cooldown; costs water. Unlocks at 1.2M L, or as soon as you fall 3 km behind the leader.
- **Map** (M, pad Y, or the MAP button): the whole run from above, the gold finish beach at the bottom.
- **Pause** (Esc / P, pad Start): resume, restart, music and effects volume, route preview and camera shake.
- The white ribbon ahead of your river is where your water will go in the next 10 s if you let go of
  the stick: yellow where it slows, orange where it finds its way round a rise, red where it stalls.
- Rain clouds within 5 km are marked on screen (pinned to the edge when off screen) with their water and distance.

- Every race is a new island. It starts with a 30 s drop from the sky: steer toward the ring to
  pick your landing. Every start sits at the same height.
- Flow downhill to the gold beach where the slope meets the sea; first one there wins. Reaching any other coast, the sea's current carries you along the shore to the beach. The game never steers.
- Every lake is full. Your river's water stands over the brim where it runs, so you skate across
  without losing momentum and leave over the bank you reach. Leaving, you cut an outlet in its
  pebble bank, and the lake feeds you through it: the first river out drains the fullest lake,
  and every river with an outlet shares the same water. Pebble wears slowly, so an outlet deepens
  over the race; rivers flowing in from above and storms refill the lake.
- Gouge and Surge build up: the bigger your river, the longer the speed takes to come in, and the
  cooldown starts when the boost ends. A bigger river also holds its speed longer on flats and lakes.
- Water is one network. Cut through a rival's live channel deeper than it runs and its water
  keeps flowing into you until that channel goes dry; if they cut yours, yours flows into them.
- Every start is the same height and the same route length from the sea.
- More water is more mass and a taller head: faster, deeper channels, and rises that turn a small
  river aside don't stop a big one, so you steer more freely as you grow. Where rivers touch, the deeper
  one drains the shallower. Drained below half the most water you've held (or 40% of your
  starting water), you're out.
- Every trail stays live water and keeps eroding as long as its river pours; a drained river's bed goes grey.

## Alpha testers
Send testers https://pappydapimp69.github.io/Flood/?alpha . That browser stays in feedback mode
(`?alpha=off` turns it off): an **ALPHA · Feedback** button at the top, and **Send feedback** on the
results and pause screens. The game logs each race (island, result, place, time, water, lakes, frame
rate), the device and any errors by itself; testers answer a few opinion questions, and **Copy report**
gives one plain-text report to paste back to you. Answers are kept as a draft until they clear them.

## Run it
```
npm start            # solo only: static files on http://127.0.0.1:8080/  (?seed=42, ?bots=20)
npm install          # once, for the multiplayer server
npm run server       # game + online rooms on http://localhost:8080/ (PORT, FLOOD_LOBBY_MS)
```
No build step. three.js is vendored (`docs/adr/0001-vendor-three.md`). Multiplayer is
server-stamped input lockstep (`docs/adr/0002-server-stamped-lockstep.md`).

## Test
```
npm test             # unit tests (node:test)
npm run smoke        # headless browser check (needs Playwright + Chromium)
npm run play         # headless play test: flow, keyboard, touch, race
npm run online       # two headless browsers in one online race
npm run alpha        # alpha feedback mode: form, pause, report, sticky draft
```

## Layout
- `src/shared/` — game logic shared by client and server (deterministic, no three.js)
- `src/client/` — rendering, input and the online client
- `src/server/` — the room and WebSocket server
- `tests/` — unit tests and headless smoke test
- `docs/milestones.md` — the plan and a log of each finished milestone

## Music
Both pieces were written with `brain compose` and played through FluidSynth with the free
FluidR3 GM soundfont (MusicXML, MIDI and analysis beside each MP3 in `assets/music/`):
**Source** (menu, C lydian, piano, 3/4, 72 bpm, seed 31) and **Downhill** (races, C dorian,
strings, 100 bpm, seed 47). The splash press starts the music.
