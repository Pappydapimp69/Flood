# Flood

A browser battle royale where every player is a river. Race downhill across an island, swallow
lakes to grow, cut rivals off, and be the first to reach the sea.

## Play
Steer with ← → (or A D). On a phone, hold the left or right side of the screen. With a controller: stick or D-pad steers, A selects / races again, Y opens the map, X toggles sound. `M` toggles the map on a keyboard.

- Flow downhill to the sea; first one there wins (the race ends 90 s later).
- Tap lakes to grow: a lake you touch drains into you over the next half minute through your
  channel. A rival cutting deeper across that channel steals the flow. Bigger rivers are faster
  and cut deeper, but turn slower.
- Speed cuts deeper too. Where rivers touch, the deeper one drains the shallower each moment.
  Cross shallower rivers (green ▼) to drain them; keep off deeper ones (red ▲). Drained below
  40% of your starting water, you're out.
- Bright, flowing water is live and dangerous; grey channels are dry beds.

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
