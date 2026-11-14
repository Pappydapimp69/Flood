// Race shots: pictures of one race from the player's camera, a bot steering the player (?pilot), the game run
// ahead between shots (__flood.ff) so a whole race takes a minute or two on software rendering, not ten.
// The HUD is hidden unless HUD=1. To judge how a course looks and reads, by eye.
// Usage: node tools/race-shots.mjs <outdir> [seed] [ticks between shots] [shots] [extra query, e.g. '&nodrop&course=summit']
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [out, seed = '1', every = '300', max = '8', extra = '&nodrop&course=summit'] = process.argv.slice(2);
const server = await serve(0);
const url = `http://127.0.0.1:${server.address().port}/?seed=${seed}&bots=29&nohint&nocaptions&nocoach&pilot${extra}`;
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 405, height: 720 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 300)); });
await page.goto(url);
await page.waitForFunction(() => window.__flood?.world && __flood.river, null, { timeout: 120000 });
if (!process.env.HUD) await page.addStyleTag({ content: 'body *:not(canvas):not(:has(canvas)) { visibility: hidden !important; }' });
for (let n = 0; n < Number(max); n++) {
  const target = await page.evaluate((e) => { __flood.ff = e; return __flood.world.tick + e; }, n ? Number(every) : 30);
  await page.waitForFunction((t) => __flood.world.tick >= t || __flood.river.finished || __flood.river.out, target, { timeout: 120000 });
  const f0 = await page.evaluate(() => __flood.frames);
  await page.waitForFunction((f) => __flood.frames >= f + 6, f0, { timeout: 120000 }).catch(() => {}); // let the camera settle
  await page.screenshot({ path: `${out}/s${String(n).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 80 });
  const s = await page.evaluate(() => ({ tick: __flood.world.tick, done: !!__flood.river?.finished, out: !!__flood.river?.out, err: __flood.error }));
  console.log(n, JSON.stringify(s));
  if (s.done || s.out) break;
}
await browser.close(); server.close();
