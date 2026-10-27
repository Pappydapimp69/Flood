# Flood

A browser battle royale where every player is a river. Race downhill across an island, swallow
lakes to grow, cut rivals off, and be the first to reach the sea.

## Play
Steer with ← → (or A D). On a phone, hold the left or right side of the screen. `M` toggles the map.

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
