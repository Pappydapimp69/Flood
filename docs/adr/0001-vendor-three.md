# ADR 0001 — Vendor a pinned three.js, no build step

Status: accepted (milestone 1). Touches Brain tension 🟡 T12 (vendoring Three.js vs a build step / CDN).

## Decision
Ship `three@0.169.0` as `vendor/three/three.module.min.js` (672 KB) plus the one addon we use
(`OrbitControls.js`), resolved through an import map in `index.html`. No bundler, no CDN.

## Why
- The game must run from any static host and in headless tests with no network. A CDN fails both.
- A build step is not needed yet; the client is a handful of ES modules.
- Brain lessons: pin the exact three release (shader patches break across versions), and a split
  ESM build (`three.module.js` + `three.core.js`, r171+) needs every sibling file. 0.169 is one file.

## Cost
~0.7 MB in the repo per three upgrade. Revisit if we add many addons, need tree-shaking for
phones (milestone 6), or move to TypeScript — then a Vite build replaces the import map.

## Upgrading
Copy `build/three.module.min.js` and the addons from the same npm version, update `VERSION`,
and screenshot-diff a seed before and after.
