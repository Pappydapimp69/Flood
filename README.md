# Flood

A browser battle royale where every player is a river. Race downhill across an island, swallow
lakes to grow, cut rivals off, and be the first to reach the sea.

## Play
Steer with ← → (or A D). On a phone, hold the left or right side of the screen. `M` toggles the map.

## Run it
```
npm start            # http://127.0.0.1:8080/  (add ?seed=42 for another island)
```
No install or build step. three.js is vendored (see `docs/adr/0001-vendor-three.md`).

## Test
```
npm test             # unit tests (node:test)
npm run smoke        # headless browser check (needs Playwright + Chromium)
npm run play         # headless play test: flow, keyboard, touch
```

## Layout
- `src/shared/` — game logic shared by client and server (deterministic, no three.js)
- `src/client/` — rendering and input
- `tests/` — unit tests and headless smoke test
- `docs/milestones.md` — the plan and a log of each finished milestone
