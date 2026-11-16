// Latch shots: stills of the Landslide's slope as each basin fills (the slump, the new crack, the brighter split),
// from a camera across the valley. Usage: node tools/latch-shots.mjs <outdir> [seed]
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [out, seed = '7001'] = process.argv.slice(2);
const server = await serve(0);
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/?course=slide&seed=${seed}&bots=11&nohint&nocaptions&nocoach&pilot`);
await page.waitForFunction(() => window.__flood?.world?.slide && __flood.river, null, { timeout: 120000 });
for (let n = 1; n <= Number(process.argv[4] ?? 4); n++) {
  for (let i = 0; i < 3000 && !(await page.evaluate((n) => (__flood.world.slide.filled ?? 0) >= n || __flood.world.slide.state !== 'armed', n)); i++) {
    await page.evaluate(() => { __flood.ff = 5; });
    await page.waitForFunction(() => !(__flood.ff > 0), null, { timeout: 60000 });
  }
  for (const [k, yo] of [['a', 0.35], ['b', 0.8]]) {
    await page.evaluate(() => __flood.freeCamOn());
    await page.evaluate((yo) => { const s = __flood.world.slide, f = __flood.slideFx(), q = f.onSlope(s.scarAt * 0.55, f.slumpAlong), p = q; __flood.freeCamAim(p.x, p.z, 2600, Math.atan2(-s.across.x, -s.across.z), yo); }, yo); // from across the valley, looking at the face
    await page.evaluate(() => { const f = __flood.slideFx(); if (f) f.latchAt = performance.now() - 900; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/latch-${n}${k}.jpg`, type: 'jpeg', quality: 80 });
    await page.evaluate(() => __flood.freeCamOff());
    if (n > 1) break;
  }
  console.log(n, JSON.stringify(await page.evaluate(() => ({ st: __flood.world.slide.state, filled: __flood.world.slide.filled, t: __flood.world.tick }))));
  await page.evaluate(() => __flood.freeCamOff());
}
await browser.close(); server.close();
