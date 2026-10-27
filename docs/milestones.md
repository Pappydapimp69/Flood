# Milestones

Each milestone starts with a ZaneGPT pressure test and several Brain searches, and reviews the
entries below for context. Each ends with a log entry here.

1. **Terrain** — island heightmap in Three.js, camera, basic look.
2. **One river** — flow downhill, steer left/right, carve a channel.
3. **Growth** — lakes to swallow, volume sets width and speed, "km to sea".
4. **Bots** — AI rivers racing you, blocking and merging.
5. **Multiplayer** — Node WebSocket server, up to 80 players, lag handling.
6. **Polish** — water shader, phone performance, win screens.

---

## M1 — Terrain (done)

**Built**
- `src/shared/terrain.js`: seeded island (pure JS, no three, no transcendental Math, so the server
  can rebuild the same map). Elongated north–south island, mountain spine west of centre, cape in
  the north. 512×512 grid over 48 km, peaks ~1.7–1.9 km.
- Priority-flood depression fill: every land cell drains to the sea by strict descent. Filled
  basins deeper than 2 m are lakes (used in M3).
- `src/client/`: terrain mesh with height/slope vertex colours, translucent sea, seabed, fog,
  orbit camera. `?seed=N` picks the island.
- Tests: `npm test` (determinism, sea edge, size, all-cell drainage, sampling) and `npm run smoke`
  (headless Chromium + SwiftShader: loads, draws, frame isn't blank).

**Decisions**
- ADR 0001: vendor pinned three 0.169, no build step (Brain T12).
- Procedural island instead of real Corsica elevation data: seedable maps, no download, no
  licence questions, and we control drainage. Real DEM can come back as a special map later.

**Carry forward to M2**
- `downhill(t, idx)` and `sampleHeight` are the river's API. Rivers flow on `filled`, not `height`.
- Render uses `VERT = 2.4` exaggeration; game logic stays in true metres.
- Grid row 0 is north (−z). `+z` is south.
- Headless rAF is slow and uneven: tests poll `window.__flood`, never wall-clock.
- Open: ~6k lake cells per map is still a lot of flat water; tune when lakes become gameplay.

## M2 — One river (done)

**Built**
- `src/shared/river.js`: fixed 20 Hz sim. The head turns with integer steer (−1/0/1), steep ground
  pulls it downhill, lakes and flats pull it toward the outlet, and it can't climb more than 1.5 m
  above the lowest level it reached. Each path point digs a flat-bottomed channel.
- A river ignores its own channel (per-cell owner) but will feel rivals' channels — the hook for
  "cut you off" in M4.
- Stall guard: no progress toward the sea for 5 s → follow the fill's downhill tree for 3 s.
- Client: water ribbon, chase camera that keeps the sightline above ground, wider FOV in portrait,
  "km to sea" + timer HUD, finish banner, restart, `M` for map view.
- Input: arrows/A-D, or hold the left/right half of the screen. Presses are captured at event time.
- Tests: `tests/unit/river.test.mjs` (every seed × steering policy reaches the sea, determinism,
  steering matters, digging bounded); `tests/play.mjs` (flows/digs, keyboard, touch, short taps).

**Decisions**
- Continuous head over a bilinear surface, with grid fallbacks, rather than cell-to-cell movement:
  smoother steering, and the fill tree still guarantees an exit.
- Speeds are game-scale (up to 200 m/s); the HUD shows distance and time, not speed.

**Carry forward to M3**
- Rivers have fixed `TUNE.width`/`depth`; M3 makes them grow with volume.
- `world.dist` is static distance-to-sea along the fill tree (ignores digging).
- Spawn spread is unfair (24 s to 11 min); fix spawn rules before bots/multiplayer.
- Multi-river ticks read neighbours mid-tick; snapshot before M4 so order doesn't matter.
