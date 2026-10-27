// Headless browser smoke test: the page loads, WebGL renders, the frame isn't blank.
// Checks logic and "something drew"; it cannot judge looks (Brain T11).
import { createRequire } from 'node:module';
import { serve } from '../tools/serve.mjs';

// Playwright is preinstalled globally (not a repo dependency); require resolves it.
const { chromium } = createRequire(import.meta.url)('playwright');

const query = process.argv[2] || '?seed=1';
const shot = process.argv[3];

const server = await serve(0); // own port per run
const url = `http://127.0.0.1:${server.address().port}/${query}`;
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);

  // Poll game state from Node; never assume a real-time duration.
  let state;
  for (let i = 0; i < 300; i++) {
    state = await page.evaluate(() => window.__flood && { ready: __flood.ready, error: __flood.error, calls: __flood.calls, frames: __flood.frames, fingerprint: __flood.fingerprint, stats: __flood.stats });
    if (state?.ready || state?.error) break;
    await page.waitForTimeout(100);
  }
  if (!state?.ready) throw new Error(`not ready: ${JSON.stringify(state)} ${errors.join(' | ')}`);
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  if (!(state.calls > 0)) throw new Error(`no draw calls: ${JSON.stringify(state)}`);

  // Blank check: the canvas must show more than one flat colour.
  const spread = await page.evaluate(() => {
    const gl = __flood.renderer.getContext();
    __flood.renderer.render(__flood.scene, __flood.camera);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const seen = new Set();
    for (let i = 0; i < px.length; i += 4 * 97) seen.add((px[i] >> 4) << 8 | (px[i + 1] >> 4) << 4 | (px[i + 2] >> 4));
    return seen.size;
  });
  if (spread < 12) throw new Error(`frame looks blank (${spread} colour buckets)`);
  if (shot) await page.screenshot({ path: shot });
  console.log(`smoke ok ${query} calls=${state.calls} colours=${spread} fp=${state.fingerprint}`);
} catch (e) {
  console.error('smoke FAIL', e.message);
  code = 1;
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
