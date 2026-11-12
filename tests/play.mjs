// Headless play test: the river moves, digs, and answers each input device.
// Each device gets its own page and may only use its own input API.
import { createRequire } from 'node:module';
import { serve } from '../tools/serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const shotDir = process.argv[2];

const server = await serve(0);
const root = `http://127.0.0.1:${server.address().port}/`;
// Most checks skip the opening sky drop (?nodrop); the drop has its own check.
const base = `${root}?seed=1&nodrop&lite`;
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

const state = (page) => page.evaluate(() => {
  if (!__flood.world) return { ready: false, error: __flood.error, tick: -1 }; // still on the menu
  const r = __flood.river;
  return { ready: __flood.ready, error: __flood.error, tick: __flood.world.tick, x: r.x, z: r.z, dx: r.dx, dz: r.dz,
    travelled: r.travelled, points: r.path.length, dropping: r.dropping, carved: __flood.world.carve.some((c) => c > 0) };
});

// Poll the game's own clock, never wall time.
async function until(page, fn, what, tries = 1200) { // 60 s: CI renders in software, slower than the sim
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
  // A failed check must not leave its page rendering: it would starve every later one.
  for (const ctx of browser.contexts()) await ctx.close().catch(() => {});
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
  const b = await until(page, (s) => s.tick >= a.tick + 15, '15 ticks'); // under a half turn, so the sign holds
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

// Phones play in landscape (an upright phone gets the "turn your phone" card), so touch checks use one.
const PHONE = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true };
await check('touch: dragging the open screen looks around like the right stick, and never steers', async () => {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await page.goto(base);
  await until(page, (s) => s.ready && s.tick > 5, 'ready');
  const fire = (type, x, y) => page.evaluate(([type, x, y]) => document.querySelector('canvas').dispatchEvent(
    new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, bubbles: true })), [type, x, y]);
  await page.evaluate(() => { __flood.steers.length = 0; });
  await fire('pointerdown', 300, 200); await fire('pointermove', 440, 200); // drag right: look right
  await page.waitForFunction(() => __flood.camYaw > 0.3, null, { timeout: 20000 });
  await fire('pointermove', 440, 60); // and up: pull back for a view ahead
  await page.waitForFunction(() => __flood.camRise > 0.5, null, { timeout: 20000 });
  const steered = await page.evaluate(() => __flood.steers.filter((v) => v !== 0).length);
  if (steered) throw new Error(`a drag steered the river on ${steered} ticks`);
  await fire('pointerup', 440, 60); // let go: back behind the river
  await page.waitForFunction(() => Math.abs(__flood.camYaw) < 0.1 && __flood.camRise < 0.15, null, { timeout: 20000 });
  if (shotDir) await page.screenshot({ path: `${shotDir}/play-phone.png` });
  await ctx.close();
});

await check('touch: ◀ ▶ buttons steer, 20% slower than a key (every fifth tick straight)', async () => {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await page.goto(base);
  await until(page, (s) => s.ready && s.tick > 5, 'ready');
  if (await page.isHidden('#tpad')) throw new Error('no ◀ ▶ on a phone');
  const btn = (id, type) => page.evaluate(([id, type]) => document.getElementById(id).dispatchEvent(
    new PointerEvent(type, { pointerId: 11, pointerType: 'touch', bubbles: true, cancelable: true })), [id, type]);
  await page.evaluate(() => { __flood.steers.length = 0; });
  await btn('t-left', 'pointerdown');
  const t0 = (await state(page)).tick;
  await until(page, (s) => s.tick > t0 + 40, '40 ticks held');
  await btn('t-left', 'pointerup');
  const st = await page.evaluate(() => __flood.steers.slice());
  const first = st.indexOf(-1), run = st.slice(first, first + 40);
  if (first < 0 || run.some((v) => v === 1)) throw new Error(`◀ steers: ${st.join(',')}`);
  const share = run.filter((v) => v === -1).length / run.length;
  if (Math.abs(share - 0.8) > 0.03) throw new Error(`◀ turned on ${(share * 100).toFixed(0)}% of ticks, want 80%: ${run.join(',')}`);
  await ctx.close();
});

await check('phone upright: the rotate card shows and the race waits', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.waitForFunction(() => window.__flood?.ready);
  if (!(await page.isVisible('#rotate'))) throw new Error('no rotate card upright');
  const t0 = (await state(page)).tick;
  await page.waitForTimeout(1500);
  const t1 = (await state(page)).tick;
  if (t1 !== t0) throw new Error(`race ran upright: ${t0} -> ${t1}`);
  await page.setViewportSize({ width: 844, height: 390 });
  await until(page, (s) => s.tick > t1 + 5, 'race runs once sideways');
  if (await page.isVisible('#rotate')) throw new Error('rotate card stayed sideways');
  await ctx.close();
});

await check('a short tap still registers (event-time capture)', async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(base);
  await until(page, (s) => s.ready, 'ready');
  // Each press+release lands inside one frame; held-state sampling alone would see nothing.
  await page.evaluate(() => { __flood.steers.length = 0; });
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowLeft', { delay: 0 }); await page.waitForTimeout(2500); } // a frame apart even below 1 fps (CI's software renderer)
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

await check('race: rank shows, and a drained player spectates the winner', async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(base);
  await until(page, (s) => s.ready, 'ready');
  const rank = await page.evaluate(() => document.getElementById('rank').textContent);
  if (!/^#\d+\/12\d+ flowing$/.test(rank)) throw new Error(`rank text: ${rank}`);
  const s0 = await state(page);
  await until(page, (s) => s.tick > s0.tick + 110, 'past spawn grace');
  // Shrink the player and drop a bot on its head: next tick it must be absorbed.
  await page.evaluate(() => {
    // (A bot mid-Gouge holds still and digs no channel: pick one that is flowing.)
    const me = __flood.river, bot = __flood.world.rivers.find((r) => r !== me && !r.out && !r.finished && r.gougeT < 0 && !(r.boost > 0) && !r.dropping);
    me.volume = 1; me.size = 0.01; // (size follows volume when water arrives; set both)
    bot.x = me.x + 5; bot.z = me.z;
    window.__absorber = bot.id;
  });
  await until(page, () => true, 'tick');
  // (Hold the setup until it takes: storms now rain into channels and can top
  // the player back up, and CI's software renderer runs few ticks a second.)
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const r = await page.evaluate(() => {
      const me = __flood.river, bot = __flood.world.rivers.find((o) => o.id === window.__absorber);
      if (!me.out) { __flood.world.storms.length = 0; me.volume = 1; me.size = 0.01; bot.x = me.x + 5; bot.z = me.z; }
      return { out: me.out, focus: __flood.focus.id, banner: document.getElementById('banner').hidden ? '' : document.getElementById('banner').textContent };
    });
    if (r.out && r.banner) {
      const by = await page.evaluate(() => window.__absorber), byName = await page.evaluate((id) => __flood.nameOf(id), by);
      if (r.out.by !== by || r.focus !== by || !r.banner.includes(`Drained dry by ${byName}`)) throw new Error(JSON.stringify(r));
      if (shotDir) await page.screenshot({ path: `${shotDir}/play-race.png` });
      const rows = await page.evaluate(() => document.querySelectorAll('#banner li').length);
      if (rows < 6) throw new Error(`results list has ${rows} rows`);
      await page.click('#again');
      await until(page, (st) => !st.ready || st.tick < 20, 'restart after Race again');
      await page.close();
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error('player was never absorbed');
});

await check('tug-of-war: a deeper rival on you shows the drain warning and takes water', async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(base + '&nohint');
  await until(page, (s) => s.ready && s.tick > 150, 'past spawn grace');
  const r = await page.evaluate(async () => {
    const me = __flood.river, bot = __flood.world.rivers.find((o) => o !== me && !o.out && !o.finished);
    bot.volume = 1e6 * 81; bot.size = 3; // cuts about three times deeper
    const v0 = me.volume;
    let warned = '';
    const park = setInterval(() => {
      bot.x = me.x + 5; bot.z = me.z;
      const d = document.getElementById('drain');
      if (d.classList.contains('on')) warned = document.getElementById('drain-text').textContent;
    }, 20);
    await new Promise((res) => setTimeout(res, 2500));
    clearInterval(park);
    return { warned, lost: v0 - me.volume, bot: __flood.nameOf(bot.id), tag: document.querySelector('#tags div.threat')?.textContent ?? '' };
  });
  if (!r.warned.includes(r.bot)) throw new Error(`no drain warning naming ${r.bot}: ${JSON.stringify(r)}`);
  if (!(r.lost > 0)) throw new Error(`player lost no water: ${JSON.stringify(r)}`);
  if (shotDir) await page.screenshot({ path: `${shotDir}/play-drain.png` });
  await page.close();
});

await check('lakes start part full and a river skates across without stopping', async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(base + '&nohint');
  await until(page, (s) => s.ready && s.tick > 5, 'race');
  const full = await page.evaluate(() => {
    const w = __flood.world, me = __flood.river, n = w.terrain.size;
    const lake = w.lakes.reduce((a, b) => (b.cells > a.cells ? b : a)), k = w.lakeOf.indexOf(lake.id);
    me.x = ((k % n) / (n - 1) - 0.5) * w.terrain.worldSize; me.z = (Math.floor(k / n) / (n - 1) - 0.5) * w.terrain.worldSize;
    return w.lakes.every((l) => w.lakeVol[l.id] === w.lakeCap[l.id] * 0.95);
  });
  if (!full) throw new Error('a lake did not start 95% full');
  const t0 = await state(page);
  const t1 = await until(page, (s) => s.tick > t0.tick + 20, '20 ticks');
  if (!(t1.travelled > t0.travelled + 20)) throw new Error(`head stopped on the lake: ${t0.travelled} -> ${t1.travelled}`);
  if (shotDir) await page.screenshot({ path: `${shotDir}/play-lake.png` });
  await page.close();
});

await check('sky drop: fall with a countdown and a landing marker, steer, land on the start line where it crosses', async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(`${root}?seed=1&nohint&lite`);
  await until(page, (s) => s.ready, 'ready');
  const d0 = await page.evaluate(() => ({ dropping: __flood.river.dropping, alt: __flood.river.alt, hud: document.getElementById('dist').textContent, x: __flood.river.x, z: __flood.river.z, dx: __flood.river.dx, dz: __flood.river.dz }));
  if (!(d0.dropping > 0 && d0.alt > 0)) throw new Error(`not falling at the start: ${JSON.stringify(d0)}`);
  if (!/^falling/i.test(d0.hud)) throw new Error(`HUD: ${d0.hud}`);
  await until(page, (s) => s.tick > 95, 'past the opening shot'); // no steering until TUNE.dropCalm (90 ticks)
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down('ArrowUp');
  await until(page, (s) => s.tick > 155, 'gliding');
  await page.keyboard.up('ArrowLeft');
  // Steering turned the drop (it lands wherever it crosses the start line).
  const h1 = await page.evaluate(() => ({ dx: __flood.river.dx, dz: __flood.river.dz }));
  if (h1.dx * d0.dx + h1.dz * d0.dz > 0.9) throw new Error('steering during the fall did not turn the drop');
  const m = await page.evaluate(() => __flood.marker);
  if (!m) throw new Error('no landing ring');
  if (shotDir) await page.screenshot({ path: `${shotDir}/play-drop.png` });
  // Skip most of the fall for everyone: put each drop a few seconds short of the
  // start line, straight back from the stretch ahead of it, so the test doesn't sit through it.
  await page.evaluate(() => {
    const w = __flood.world, t = w.terrain, n = t.size, ax = t.axis.x, az = t.axis.y;
    for (const r of w.rivers) {
      if (!r.dropping) continue;
      const lat = (x, z) => -x * az + z * ax, v0 = lat(r.x, r.z);
      let best = w.line.cells[0], bd = Infinity;
      for (const k of w.line.cells) { const kx = ((k % n) / (n - 1) - 0.5) * t.worldSize, kz = (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize, d = Math.abs(lat(kx, kz) - v0); if (d < bd) { bd = d; best = k; } }
      r.x = ((best % n) / (n - 1) - 0.5) * t.worldSize - ax * 400; r.z = (Math.floor(best / n) / (n - 1) - 0.5) * t.worldSize - az * 400;
      r.dx = ax; r.dz = az; r.alt = Math.min(r.alt, 300);
    }
  });
  await until(page, (s) => !s.dropping && s.points > 0, 'landed');
  await page.keyboard.up('ArrowUp');
  const d1 = await page.evaluate(() => {
    const r = __flood.river, w = __flood.world, n = w.terrain.size, p = r.path[0];
    const k = Math.round((p.z / w.terrain.worldSize + 0.5) * (n - 1)) * n + Math.round((p.x / w.terrain.worldSize + 0.5) * (n - 1));
    return { dropping: r.dropping, path: r.path.length, inZone: w.toBeach[k] <= w.line.L * 1.01, x: p.x, z: p.z };
  });
  if (d1.dropping || !d1.path) throw new Error(`did not land: ${JSON.stringify(d1)}`);
  if (!d1.inZone) throw new Error(`landed short of the start line: ${JSON.stringify(d1)}`);
  await page.close();
});

await check('touch drop: ◀ ▶ turn, ▲ DIVE / ▼ FLOAT fly it, and no drag stick on a phone', async () => {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await page.goto(`${root}?seed=3&nohint&nointro&lite`);
  await until(page, (s) => s.ready && s.tick > 95, 'falling, past the opening shot'); // no steering until TUNE.dropCalm
  if (await page.isHidden('#tfly')) throw new Error('no ▲ ▼ while falling');
  // Arrows point the way you go: ▲ FLOAT on top, ▼ DIVE below (owner, 2026-11-11).
  const order = await page.evaluate(() => {
    const f = document.getElementById('t-float').getBoundingClientRect(), d = document.getElementById('t-dive').getBoundingClientRect();
    return { floatAbove: f.bottom <= d.top + 1, dive: document.getElementById('t-dive').textContent, float: document.getElementById('t-float').textContent };
  });
  if (!order.floatAbove || !order.dive.startsWith('▼') || !order.float.startsWith('▲')) throw new Error(`drop buttons: ${JSON.stringify(order)}`);
  const btn = (id, type) => page.evaluate(([id, type]) => document.getElementById(id).dispatchEvent(
    new PointerEvent(type, { pointerId: 12, pointerType: 'touch', bubbles: true, cancelable: true })), [id, type]);
  const ticks = async (n, what) => { const t0 = (await state(page)).tick; await until(page, (s) => s.tick > t0 + n, what); };
  // ▶: the drop turns right (steer +1).
  await page.evaluate(() => { __flood.steers.length = 0; });
  await btn('t-right', 'pointerdown');
  await ticks(10, '10 ticks of turning');
  await btn('t-right', 'pointerup');
  const steers = await page.evaluate(() => __flood.steers.slice());
  if (!steers.includes(1) || steers.includes(-1)) throw new Error(`▶ gave steers ${steers.join('')}`);
  // ▲ DIVE: full throttle, well over the base 82.5 m/s glide. ▼ FLOAT: none, well under it.
  await btn('t-dive', 'pointerdown');
  await ticks(10, '10 ticks diving');
  const fast = await page.evaluate(() => __flood.river.dropping ? __flood.river.glideV : -1);
  await btn('t-dive', 'pointerup');
  await btn('t-float', 'pointerdown');
  await ticks(10, '10 ticks floating');
  const slow = await page.evaluate(() => __flood.river.dropping ? __flood.river.glideV : -1);
  await btn('t-float', 'pointerup');
  if (fast >= 0 && slow >= 0 && !(fast > 130 && slow < 60)) throw new Error(`dive ${fast.toFixed(0)} m/s, float ${slow.toFixed(0)} m/s`);
  // A finger dragged on the canvas no longer draws the combined stick.
  const fire = (type, x, y) => page.evaluate(([type, x, y]) => document.querySelector('canvas').dispatchEvent(
    new PointerEvent(type, { pointerId: 9, pointerType: 'touch', clientX: x, clientY: y, bubbles: true })), [type, x, y]);
  await fire('pointerdown', 420, 200); await fire('pointermove', 420, 120);
  await ticks(3, 'a few ticks dragging');
  const stick = await page.evaluate(() => document.getElementById('stick').classList.contains('on'));
  await fire('pointerup', 420, 120);
  if (stick) throw new Error('drag stick drawn on a phone');
  await ctx.close();
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
  // While the studio card fades nothing gets through; after it, A leaves the splash.
  await page.evaluate(() => { __pad.buttons[0].pressed = true; __pad.buttons[0].value = 1; });
  await page.waitForTimeout(400);
  await page.evaluate(() => { __pad.buttons[0].pressed = false; __pad.buttons[0].value = 0; });
  const early = await page.evaluate(() => ({ studio: !document.getElementById('studio').hidden, splash: !document.getElementById('splash').hidden }));
  if (early.studio && !early.splash) throw new Error('a press during the studio card left the splash');
  await page.waitForFunction(() => document.getElementById('studio').hidden, null, { timeout: 15000 });
  const button = (i, on) => page.evaluate(([i, on]) => { __pad.buttons[i].pressed = on; __pad.buttons[i].value = on ? 1 : 0; }, [i, on]);
  // Held longer than a slow headless frame, so the per-frame poll sees it.
  const tap = async (i) => { await button(i, true); await page.waitForTimeout(1200); await button(i, false); await page.waitForTimeout(1200); };
  // A leaves the splash (music starts) and focuses "Play solo"; down moves to "Tutorial", up back; then A.
  await tap(0);
  if (await page.evaluate(() => !document.getElementById('splash').hidden)) throw new Error('A did not leave the splash');
  // (Two buttons: a press a slow frame counts twice wraps straight back, so
  // only require that D-pad moves focus between them, then settle on Play solo.)
  const focusId = () => page.evaluate(() => document.activeElement?.id);
  const seen = new Set([await focusId()]);
  for (let i = 0; i < 4 && seen.size < 2; i++) { await tap(13); seen.add(await focusId()); }
  if (!seen.has('play-tutorial')) throw new Error(`D-pad never reached Tutorial: ${[...seen]}`);
  for (let i = 0; i < 4 && (await focusId()) !== 'play-solo'; i++) await tap(12);
  const focused = await focusId();
  if (focused !== 'play-solo') throw new Error(`menu focus on ${focused}`);
  // (A slow software frame can miss a whole press, since the pad is read once a
  // frame: press A again if the race hasn't started, up to three times.)
  for (let i = 0; i < 3; i++) {
    await tap(0);
    try { await until(page, (s) => s.ready && s.tick > 5, 'solo race from the gamepad', 300); break; } catch (e) { if (i === 2) throw e; }
  }
  const help = await page.evaluate(() => document.getElementById('help').textContent);
  if (!help.startsWith('Controller')) throw new Error(`help text: ${help}`);
  for (const [how, set] of [['stick', (v) => page.evaluate((v) => { __pad.axes[0] = v; }, v)], ['dpad', (v) => button(v < 0 ? 14 : 15, v !== 0)]]) {
    await page.evaluate(() => { __flood.steers.length = 0; });
    await set(-1);
    // Hold until the sim has run some ticks with it; frames are slow headless.
    let steers = [];
    for (let i = 0; i < 300 && !steers.some((v) => v !== 0); i++) { // 30 s: CI's software renderer can stall for seconds
      await page.waitForTimeout(100);
      steers = await page.evaluate(() => __flood.steers.slice());
    }
    // Falling or landed, left is a left turn (falling, the left stick's up / down is the throttle).
    const falling = await page.evaluate(() => __flood.river.dropping > 0);
    if (falling && how === 'stick') {
      await set(0);
      if (!steers.includes(-1)) throw new Error(`${how} left while falling gave ${steers.join('')}`);
      // Throttle: stick up is full (1.8x the base glide), back is none (0.4x).
      const glideAt = async (y) => {
        await page.evaluate((y) => { __pad.axes[1] = y; }, y);
        let v = 0;
        for (let i = 0; i < 100; i++) { await page.waitForTimeout(100); v = await page.evaluate(() => __flood.river.dropping ? __flood.river.glideV : -1); if (v < 0 || (y < 0 ? v > 150 : v < 80)) break; }
        await page.evaluate(() => { __pad.axes[1] = 0; });
        return v;
      };
      const up = await glideAt(-1), back = await glideAt(1);
      if (up >= 0 && back >= 0 && !(up > 150 && back < 80)) throw new Error(`throttle: up ${up.toFixed(0)} m/s, back ${back.toFixed(0)} m/s`);
      continue;
    }
    await set(0);
    if (!steers.includes(-1)) throw new Error(`${how} left gave ${steers.join('')}`);
  }
  // Right stick sideways: while falling it does nothing to the camera; once
  // landed it looks up to 30 degrees aside and drifts back when let go.
  const fallingNow = await page.evaluate(() => __flood.river.dropping > 0);
  await page.evaluate(() => { __pad.axes[2] = 1; });
  // Wait on the camera, not the clock: headless frames can be seconds apart (up to 25 s).
  let yaw = 0;
  for (let i = 0; i < 250; i++) {
    await page.waitForTimeout(100);
    yaw = await page.evaluate(() => __flood.camYaw);
    if (i >= 24 && (yaw >= 0.2 || fallingNow)) break;
  }
  const stillFalling = await page.evaluate(() => __flood.river.dropping > 0);
  await page.evaluate(() => { __pad.axes[2] = 0; });
  if (fallingNow && stillFalling && Math.abs(yaw) > 0.05) throw new Error(`right stick turned the falling camera: ${yaw}`);
  if (!fallingNow && !stillFalling) {
    if (yaw < 0.2 || yaw > 0.53) throw new Error(`right stick look: ${yaw} rad (want up to 0.52)`);
    let back = yaw;
    for (let i = 0; i < 250 && back > yaw * 0.3; i++) { await page.waitForTimeout(100); back = await page.evaluate(() => __flood.camYaw); } // (frames are slow headless: up to 25 s)
    if (back > yaw * 0.3) throw new Error(`the look didn't drift back: ${back}`);
  }
  // Finish the run by force (after the spawn grace), then A on the results card starts a new one.
  const t0 = (await state(page)).tick;
  await until(page, (st) => st.tick > Math.max(t0, 140), 'past spawn grace');
  await page.evaluate(() => { const me = __flood.river, bot = __flood.world.rivers.find((r) => r !== me && !r.out); me.volume = 1; me.size = 0.01; bot.x = me.x + 5; bot.z = me.z; });
  for (let i = 0; i < 100 && !(await page.evaluate(() => !!document.getElementById('again'))); i++) await page.waitForTimeout(100);
  const before = (await state(page)).tick;
  await tap(0);
  await until(page, (s) => s.tick < before, 'A on the results card restarts');
  await ctx.close();
});

await check('?rival=look: one rival is steered by the look-ahead planner in a worker, and the race runs on', async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(`${base}&rival=look`);
  await until(page, (s) => s.ready, 'ready');
  const a = await until(page, (s) => s.tick > 20, 'tick 20');
  for (let i = 0; i < 600 && !(await page.evaluate(() => __flood.planner?.replies >= 2)); i++) await page.waitForTimeout(100);
  const p = await page.evaluate(() => ({ replies: __flood.planner?.replies, steer: __flood.planner?.steer, error: __flood.error }));
  if (!(p.replies >= 2) || ![-1, 0, 1].includes(p.steer) || p.error) throw new Error(`planner never answered: ${JSON.stringify(p)}`);
  const b = await state(page);
  if (!(b.tick > a.tick)) throw new Error('the race stopped while it thought');
  await page.close();
});

await browser.close();
server.close();
if (fails.length) { console.error(`${fails.length} play check(s) failed`); process.exit(1); }
console.log('play ok');
