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
  if (!__flood.world) return { ready: false, error: __flood.error, tick: -1 }; // still on the menu
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

await check('the water HUD counts up as the river gathers water', async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(base);
  await until(page, (s) => s.ready, 'ready');
  const litres = () => page.evaluate(() => Number(document.getElementById('litres').textContent.replace(/\D/g, '')));
  const a = await litres();
  const s0 = await state(page);
  await until(page, (s) => s.tick > s0.tick + 200, '200 ticks');
  const b = await litres();
  if (!(b > a)) throw new Error(`litres ${a} -> ${b}`);
  if (shotDir) await page.screenshot({ path: `${shotDir}/play-grow.png` });
  await page.close();
});

await check('race: rank shows, and an absorbed player spectates the winner', async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(base);
  await until(page, (s) => s.ready, 'ready');
  const rank = await page.evaluate(() => document.getElementById('rank').textContent);
  if (!/^#\d+\/12 · \d+ flowing$/.test(rank)) throw new Error(`rank text: ${rank}`);
  const s0 = await state(page);
  await until(page, (s) => s.tick > s0.tick + 110, 'past spawn grace');
  // Shrink the player and drop a bot on its head: next tick it must be absorbed.
  await page.evaluate(() => {
    const me = __flood.river, bot = __flood.world.rivers.find((r) => r !== me && !r.out && !r.finished);
    me.volume = 1;
    bot.x = me.x + 5; bot.z = me.z;
    window.__absorber = bot.id;
  });
  await until(page, () => true, 'tick');
  for (let i = 0; i < 100; i++) {
    const r = await page.evaluate(() => ({ out: __flood.river.out, focus: __flood.focus.id, banner: document.getElementById('banner').hidden ? '' : document.getElementById('banner').textContent }));
    if (r.out && r.banner) {
      const by = await page.evaluate(() => window.__absorber);
      if (r.out.by !== by || r.focus !== by || !r.banner.includes(`Absorbed by ${by}`)) throw new Error(JSON.stringify(r));
      if (shotDir) await page.screenshot({ path: `${shotDir}/play-race.png` });
      const rows = await page.evaluate(() => document.querySelectorAll('#banner li').length);
      if (rows < 6) throw new Error(`results list has ${rows} rows`);
      await page.click('#again');
      await until(page, (st) => !st.ready || st.tick < 20, 'restart after Race again');
      await page.close();
      return;
    }
    await page.waitForTimeout(50);
  }
  throw new Error('player was never absorbed');
});

// A fake standard-mapping gamepad the test can drive; installed before the page loads.
const FAKE_PAD = () => {
  const pad = { id: 'test pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  window.__pad = pad;
  navigator.getGamepads = () => [pad, null, null, null];
};

await check('gamepad: A picks a menu button, stick and D-pad steer, A races again', async () => {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  await ctx.addInitScript(FAKE_PAD);
  const page = await ctx.newPage();
  await page.goto(base.replace('?seed=1', '?nohint'));
  await page.waitForFunction(() => window.__flood?.renderer);
  const button = (i, on) => page.evaluate(([i, on]) => { __pad.buttons[i].pressed = on; __pad.buttons[i].value = on ? 1 : 0; }, [i, on]);
  // Held longer than a slow headless frame, so the per-frame poll sees it.
  const tap = async (i) => { await button(i, true); await page.waitForTimeout(700); await button(i, false); await page.waitForTimeout(500); };
  // First down focuses "Play online", the second "Solo vs bots"; then A.
  await tap(13);
  await tap(13);
  const focused = await page.evaluate(() => document.activeElement?.id);
  if (focused !== 'play-solo') throw new Error(`menu focus on ${focused}`);
  await tap(0);
  await until(page, (s) => s.ready && s.tick > 5, 'solo race from the gamepad');
  const help = await page.evaluate(() => document.getElementById('help').textContent);
  if (!help.startsWith('Controller')) throw new Error(`help text: ${help}`);
  for (const [how, set] of [['stick', (v) => page.evaluate((v) => { __pad.axes[0] = v; }, v)], ['dpad', (v) => button(v < 0 ? 14 : 15, v !== 0)]]) {
    await page.evaluate(() => { __flood.steers.length = 0; });
    await set(-1);
    // Hold until the sim has run some ticks with it; frames are slow headless.
    let steers = [];
    for (let i = 0; i < 100 && !steers.includes(-1); i++) {
      await page.waitForTimeout(100);
      steers = await page.evaluate(() => __flood.steers.slice());
    }
    await set(0);
    if (!steers.includes(-1)) throw new Error(`${how} left gave ${steers.join('')}`);
  }
  // Finish the run by force (after the spawn grace), then A on the results card starts a new one.
  const t0 = (await state(page)).tick;
  await until(page, (st) => st.tick > Math.max(t0, 140), 'past spawn grace');
  await page.evaluate(() => { const me = __flood.river, bot = __flood.world.rivers.find((r) => r !== me && !r.out); me.volume = 1; bot.x = me.x + 5; bot.z = me.z; });
  for (let i = 0; i < 100 && !(await page.evaluate(() => !!document.getElementById('again'))); i++) await page.waitForTimeout(100);
  const before = (await state(page)).tick;
  await tap(0);
  await until(page, (s) => s.tick < before, 'A on the results card restarts');
  await ctx.close();
});

await browser.close();
server.close();
if (fails.length) { console.error(`${fails.length} play check(s) failed`); process.exit(1); }
console.log('play ok');
