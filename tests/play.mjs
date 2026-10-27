// Headless play test: the river moves, digs, and answers each input device.
// Each device gets its own page and may only use its own input API.
import { createRequire } from 'node:module';
import { serve } from '../tools/serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const shotDir = process.argv[2];

const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}/?seed=1`;
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

const state = (page) => page.evaluate(() => {
  const r = __flood.river;
  return { ready: __flood.ready, error: __flood.error, tick: __flood.world.tick, x: r.x, z: r.z, dx: r.dx, dz: r.dz,
    travelled: r.travelled, points: r.path.length, carved: __flood.world.carve.some((c) => c > 0) };
});

// Poll the game's own clock, never wall time.
async function until(page, fn, what, tries = 600) {
  for (let i = 0; i < tries; i++) {
    const s = await state(page);
    if (s.error) throw new Error(s.error);
    if (fn(s)) return s;
    await page.waitForTimeout(50);
  }
  throw new Error(`timed out: ${what} ${JSON.stringify(await state(page))}`);
}

// Heading change in radians over a stretch of ticks, signed (+ = turned left).
const turned = (a, b) => Math.atan2(a.dx * b.dz - a.dz * b.dx, a.dx * b.dx + a.dz * b.dz) * -1;

const fails = [];
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { fails.push(name); console.error(`FAIL ${name}: ${e.message}`); }
}

await check('river flows and digs on its own', async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(base);
  await until(page, (s) => s.ready, 'ready');
  const s = await until(page, (s) => s.tick > 200, 'tick 200');
  if (!(s.travelled > 500)) throw new Error(`barely moved: ${s.travelled}`);
  if (!s.carved || s.points < 5) throw new Error(`no channel: ${JSON.stringify(s)}`);
  if (shotDir) await page.screenshot({ path: `${shotDir}/play-flow.png` });
  await page.close();
});

// Same seed and spawn, so steering is the only difference between runs.
async function steerRun(page, act) {
  await until(page, (s) => s.ready, 'ready');
  await page.evaluate(() => { __flood.forceSteer = 0; __flood.newRun(); });
  const a = await until(page, (s) => s.tick >= 10, 'tick 10');
  await page.evaluate(() => { __flood.forceSteer = undefined; });
  await act();
  const b = await until(page, (s) => s.tick >= a.tick + 30, '30 ticks');
  return turned(a, b);
}

await check('keyboard: left and right turn opposite ways', async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(base);
  const left = await steerRun(page, () => page.keyboard.down('ArrowLeft'));
  await page.keyboard.up('ArrowLeft');
  const right = await steerRun(page, () => page.keyboard.down('ArrowRight'));
  await page.keyboard.up('ArrowRight');
  if (!(left > right + 0.3)) throw new Error(`left ${left.toFixed(2)} vs right ${right.toFixed(2)}`);
  await page.close();
});

await check('touch: holding each half of the screen steers', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(base);
  // Touch pointer events only (no keyboard), dispatched as a held finger.
  const hold = (x) => page.evaluate((x) => {
    const c = document.querySelector('canvas');
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: x, clientY: 600, bubbles: true }));
  }, x);
  const release = () => page.evaluate(() => {
    document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', bubbles: true }));
  });
  const left = await steerRun(page, () => hold(40));
  await release();
  const right = await steerRun(page, () => hold(350));
  await release();
  if (!(left > right + 0.3)) throw new Error(`left ${left.toFixed(2)} vs right ${right.toFixed(2)}`);
  if (shotDir) await page.screenshot({ path: `${shotDir}/play-phone.png` });
  await ctx.close();
});

await check('a short tap still registers (event-time capture)', async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(base);
  await until(page, (s) => s.ready, 'ready');
  // Each press+release lands inside one frame; held-state sampling alone would see nothing.
  await page.evaluate(() => { __flood.steers.length = 0; });
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowLeft', { delay: 0 }); await page.waitForTimeout(400); }
  const steers = await page.evaluate(() => __flood.steers.slice());
  const lefts = steers.filter((v) => v === -1).length;
  if (lefts < 3) throw new Error(`only ${lefts} left ticks from 3 taps: ${steers.join('')}`);
  await page.close();
});

await browser.close();
server.close();
if (fails.length) { console.error(`${fails.length} play check(s) failed`); process.exit(1); }
console.log('play ok');
