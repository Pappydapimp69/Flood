# Flood

A browser battle royale where every player is a river. Race downhill across an island, swallow
lakes to grow, cut rivals off, and be the first to reach the sea.

## Play
Steer with ← → (or A D); ↑ ↓ (W S) hurry or slow your fall. On a phone, hold the left or right side of the screen to steer; while falling, drag to aim the drop where you point (drag far to dive faster). With a controller: left stick or D-pad steers, right stick turns the camera, A selects / races again, Y opens the map, X toggles sound. `M` toggles the map on a keyboard.

- Every race is a new island. It starts with a 30 s drop from the sky: steer toward the ring to
  pick your landing. Every start sits at the same height.
- Flow downhill to the sea; first one there wins (the race ends 90 s later). The game never steers.
- Every lake is full. Your river's water stands over the brim where it runs, so you skate across
  without losing momentum and leave over the bank you reach. Join one and your mass jumps at
  once, then it keeps feeding you through the outlet you cut, which erodes deeper the more it
  carries.
- Water is one network. Cut through a rival's live channel deeper than it runs and its water
  keeps flowing into you until that channel goes dry; if they cut yours, yours flows into them.
- Every start is the same height and the same route length from the sea.
- More water is more mass and a taller head: faster, deeper channels, and rises that turn a small
  river aside don't stop a big one, so you steer more freely as you grow. Where rivers touch, the deeper
  one drains the shallower. Below 40% of your starting water, you're out.
- Every trail stays live water and keeps eroding as long as its river pours; a drained river's bed goes grey.

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
