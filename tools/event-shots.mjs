// Event shots: stills of the Landslide (Training) at set moments of its fall, its pond and its wave, from a
// camera aimed at it. The race runs ahead to each moment, the free camera pauses it there (the slide's look
// runs on race time, so a pause freezes boulders mid-air), aims, shoots, and lets go. A few minutes in all on
// software rendering, where watching a race to catch the moment took ten.
// Usage: node tools/event-shots.mjs <outdir> [seed] [width] [height]
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [out, seed = '7001', w = '640', h = '360'] = process.argv.slice(2);
const server = await serve(0);
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/?course=slide&seed=${seed}&bots=11&nohint&nocaptions&nocoach&pilot`);
await page.waitForFunction(() => window.__flood?.world?.slide && __flood.river, null, { timeout: 120000 });
const state = () => page.evaluate(() => ({ st: __flood.world.slide.state, tick: __flood.world.tick, since: __flood.world.tick - __flood.world.slide.tick }));
async function runUntil(pred) { // ahead 5 ticks at a time until pred(world.slide, ticks since its phase began)
  for (let i = 0; i < 2000; i++) {
    if (await page.evaluate((p) => { const s = __flood.world.slide, since = __flood.world.tick - s.tick; return eval(p); }, pred)) return true;
    await page.evaluate(() => { __flood.ff = 5; });
    await page.waitForFunction(() => !(__flood.ff > 0), null, { timeout: 60000 });
  }
  return false;
}
async function shoot(name, aim) {
  await page.evaluate(() => __flood.freeCamOn());
  const spot = await page.evaluate(aim);
  if (!spot) { console.log(name, 'nothing to aim at'); await page.evaluate(() => __flood.freeCamOff()); return; }
  await page.evaluate((a) => __flood.freeCamAim(...a), spot);
  const f0 = await page.evaluate(() => __flood.frames);
  await page.waitForFunction((f) => __flood.frames >= f + 3, f0, { timeout: 60000 });
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 80 });
  console.log(name, JSON.stringify(await state()));
  await page.evaluate(() => __flood.freeCamOff());
}
// The dam from downstream and to one side, a few km off; the wave from ahead of it, looking back up the valley.
const atDam = `(() => { const s = __flood.world.slide; return [s.x, s.z, 3800, Math.atan2(s.axis.x, s.axis.z) + 0.6, 0.42]; })()`;
const atWave = `(() => { const s = __flood.world.slide, p = __flood.waveAt(); return p && [p.x, p.z, 2600, Math.atan2(s.axis.x, s.axis.z) + 0.3, 0.35]; })()`;
const plan = [
  ['1-fall-early', "s.state === 'falling' && since >= 8", atDam],
  ['2-fall-mid', "s.state === 'falling' && since >= 20", atDam],
  ['3-dammed', "s.state === 'dammed' && s.level > 40", atDam],
  ['4-burst', "s.state === 'burst' && since >= 10", atDam],
  ['5-wave', "s.state === 'burst' && since >= 40", atWave],
  ['6-wave-late', "s.state === 'burst' && since >= 100", atWave],
];
for (const [name, pred, aim] of plan) {
  if (!(await runUntil(pred))) { console.log(name, 'never happened', JSON.stringify(await state())); continue; }
  await shoot(name, new Function(`return ${aim}`));
}
await browser.close(); server.close();
