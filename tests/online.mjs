// Headless online test: two browser players join one server race. Their sims
// must match the server's fingerprints, steering must reach the server, and a
// reloaded tab must rejoin its own seat.
import { createRequire } from 'node:module';
import { startServer } from '../src/server/server.mjs';
import { Room } from '../src/server/room.js';
import { FP_EVERY } from '../src/shared/protocol.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const shotDir = process.argv[2];

const room = new Room({ seed: 7, opts: { lobbyMs: 2000 } });
const srv = await startServer({ port: 0, host: '127.0.0.1', room });
const base = `http://127.0.0.1:${srv.port}/`;
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
let code = 0;

const view = (page) => page.evaluate(() => ({
  tick: __flood.world?.tick ?? -1, you: __flood.river?.id ?? null, prints: [...__flood.prints], error: __flood.error,
}));
async function until(page, fn, what, tries = 900) {
  for (let i = 0; i < tries; i++) {
    const v = await view(page);
    if (v.error) throw new Error(v.error);
    if (fn(v)) return v;
    await page.waitForTimeout(100);
  }
  const v = await view(page);
  throw new Error(`timed out: ${what} (page tick ${v.tick}, you ${v.you}, server tick ${room.world?.tick}, state ${room.state})`);
}
function checkPrints(v, who) {
  let n = 0;
  for (const [k, fp] of v.prints) {
    if (room.prints.get(k) !== fp) throw new Error(`${who} desynced at tick ${k}: ${fp} vs ${room.prints.get(k)}`);
    n++;
  }
  if (!n) throw new Error(`${who} has no fingerprints yet`);
  return n;
}

try {
  const ctxA = await browser.newContext({ viewport: { width: 800, height: 500 } });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
  const a = await ctxA.newPage(), b = await ctxB.newPage();
  const errs = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errs.push(e.message));
  await Promise.all([a.goto(`${base}?online&name=Ann`), b.goto(`${base}?online&name=Bo`)]);

  const va = await until(a, (v) => v.you, 'A in race');
  const vb = await until(b, (v) => v.you, 'B in race');
  if (va.you === vb.you) throw new Error('both players got the same seat');
  const slotA = room.ids.indexOf(va.you);

  // Hold left until the server has stamped it into a frame (the page may render slowly).
  await a.keyboard.down('ArrowLeft');
  for (let i = 0; i < 300 && !room.log.some((f) => f[slotA] === '-'); i++) await a.waitForTimeout(50);
  await a.keyboard.up('ArrowLeft');
  if (!room.log.some((f) => f[slotA] === '-')) throw new Error('A steering never reached the server');
  await until(a, (v) => v.tick > 2 * FP_EVERY + 10, 'A past two checks');
  console.log(`ok   both players in one race (${room.ids.length} rivers), A's steering reached the server`);

  // A live client must keep up with the server, not just match it on old ticks.
  await until(a, (v) => v.tick >= room.world.tick - 40, 'A keeps up with the live race');
  const pa = checkPrints(await view(a), 'A');
  const pb = checkPrints(await until(b, (v) => v.prints.length >= 2, 'B prints'), 'B');
  console.log(`ok   no desync: A matched ${pa}, B matched ${pb} server fingerprints`);

  // Reload B mid-race: same tab keeps its token, so it must get its seat back and replay.
  await b.reload();
  const vb2 = await until(b, (v) => v.you && v.tick >= room.world.tick - 40, 'B resumed and caught up');
  if (vb2.you !== vb.you) throw new Error(`B came back as ${vb2.you}, was ${vb.you}`);
  checkPrints(await until(b, (v) => v.prints.length >= 2, 'B prints after reload'), 'B after reload');
  console.log('ok   reloaded tab rejoined its own seat and caught up without desync');
  if (shotDir) { await a.screenshot({ path: `${shotDir}/online-a.png` }); await b.screenshot({ path: `${shotDir}/online-b.png` }); }
  if (errs.length) throw new Error(`page errors: ${errs.join(' | ')}`);
  console.log('online ok');
} catch (e) {
  console.error('online FAIL', e.message);
  code = 1;
} finally {
  await browser.close();
  srv.close();
}
process.exit(code);
