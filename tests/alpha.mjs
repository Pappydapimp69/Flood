// Headless check of alpha feedback mode (?alpha): the pill shows, opening the form
// pauses the race, typing never reaches the game, a drained race is logged with its
// result, the copied report carries answers and races, and the mode and draft stick.
import { createRequire } from 'node:module';
import { serve } from '../tools/serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const shotDir = process.argv[2];
const server = await serve(0);
const root = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const fails = [];
const tick = (page) => page.evaluate(() => __flood.world?.tick ?? -1);
async function until(page, fn, what, tries = 1200) {
  for (let i = 0; i < tries; i++) {
    const v = await page.evaluate(fn);
    if (v) return v;
    const err = await page.evaluate(() => __flood.error);
    if (err) throw new Error(err);
    await page.waitForTimeout(50);
  }
  throw new Error(`timed out: ${what}`);
}

try {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 640 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error: ${e.message}`));
  await page.goto(`${root}?alpha&seed=1&nodrop&lite`);
  await until(page, () => __flood.ready && __flood.world.tick > 20, 'race running');
  if (!(await page.isVisible('#fb-open'))) throw new Error('feedback pill not shown');
  const log0 = await page.evaluate(() => JSON.parse(localStorage.getItem('flood.alpha.log')));
  if (log0?.races?.at(-1)?.result !== 'playing' || log0.races.at(-1).seed == null) throw new Error(`race start not logged: ${JSON.stringify(log0)}`);

  // Open: the race stops; keys typed in the form don't steer, pause or restart.
  await page.click('#fb-open');
  const t0 = await tick(page);
  await page.click('[data-q="best"]');
  await page.keyboard.press('Enter'); await page.keyboard.press('Space'); // would restart or gouge in the game
  await page.keyboard.type('the drop was great d a p r');
  await page.keyboard.down('ArrowLeft'); // held through closing: the game must never see it
  await page.click('.fb-c:has(input[data-q="fun"][value="4"])');
  await page.waitForTimeout(600);
  const t1 = await tick(page);
  if (t1 !== t0) throw new Error(`race ran while the form was open: ${t0} -> ${t1}`);
  if (!(await page.isHidden('#pause'))) throw new Error('typing opened the pause menu');
  if (shotDir) await page.screenshot({ path: `${shotDir}/alpha-form.png` });

  // Escape closes the form (not into the pause menu) and the race resumes.
  await page.keyboard.press('Escape');
  if (!(await page.isHidden('#fb'))) throw new Error('Escape did not close the form');
  await page.evaluate(() => { __flood.steers.length = 0; });
  await until(page, () => __flood.world.tick > 150 && __flood.steers.length > 20, 'race resumes past spawn grace');
  const steered = await page.evaluate(() => __flood.steers.filter((s) => s !== 0).length);
  if (steered) throw new Error(`a key held in the form steered the river (${steered} ticks)`);
  await page.keyboard.up('ArrowLeft');
  if (!(await page.isHidden('#pause'))) throw new Error('Escape from the form opened pause');

  // Get drained: the race is logged with its result, and results offer feedback.
  const t2 = Date.now();
  let banner = false;
  while (Date.now() - t2 < 60000 && !banner) {
    banner = await page.evaluate(() => {
      const me = __flood.river;
      if (!me.out) {
        const bot = __flood.world.rivers.find((r) => r !== me && !r.out && !r.finished && r.gougeT < 0 && !(r.boost > 0) && !r.dropping);
        __flood.world.storms.length = 0; me.volume = 1; me.size = 0.01; bot.x = me.x + 5; bot.z = me.z;
      }
      return !!document.getElementById('fb-results');
    });
    if (!banner) await page.waitForTimeout(100);
  }
  if (!banner) throw new Error('results never offered Send feedback');
  const last = await page.evaluate(() => JSON.parse(localStorage.getItem('flood.alpha.log')).races.at(-1));
  if (last.result !== 'drained' || !last.place || !last.by) throw new Error(`race end not logged: ${JSON.stringify(last)}`);

  await page.click('#fb-results');
  await page.click('#fb-copy');
  await until(page, () => document.getElementById('fb-said').textContent.startsWith('Copied'), 'copied');
  const report = await page.evaluate(() => navigator.clipboard.readText());
  for (const want of ['FLOOD ALPHA FEEDBACK', 'How fun was it?\n  4', 'the drop was great d a p r', 'drained by', 'Device']) {
    if (!report.includes(want)) throw new Error(`report lacks "${want}":\n${report}`);
  }

  // Sticky: no ?alpha on the next visit, the pill and the draft are still there.
  await page.goto(`${root}?seed=2&nodrop&lite`);
  await until(page, () => __flood.ready, 'reload ready');
  if (!(await page.isVisible('#fb-open'))) throw new Error('alpha mode did not stick');
  await page.click('#fb-open');
  const kept = await page.inputValue('[data-q="best"]');
  if (!kept.endsWith('the drop was great d a p r')) throw new Error(`draft lost: "${kept}"`);
  const races = await page.evaluate(() => JSON.parse(localStorage.getItem('flood.alpha.log')).races.length);
  if (races !== 2) throw new Error(`expected 2 logged races, got ${races}`);

  // Off switch.
  await page.goto(`${root}?alpha=off&seed=2&nodrop&lite`);
  await until(page, () => __flood.ready, 'off ready');
  if (await page.$('#fb-open')) throw new Error('alpha=off still shows the pill');
  await ctx.close();
} catch (e) { fails.push(e.message); }

// Without ?alpha, testers' builds look like everyone else's.
try {
  const page = await browser.newPage();
  await page.goto(`${root}?seed=1&nodrop&lite`);
  await until(page, () => __flood.ready, 'plain ready');
  if (await page.$('#fb-open')) throw new Error('pill shown without ?alpha');
  await page.close();
} catch (e) { fails.push(e.message); }

await browser.close();
server.close();
if (fails.length) { for (const f of fails) console.error(`FAIL ${f}`); process.exit(1); }
console.log('alpha ok');
