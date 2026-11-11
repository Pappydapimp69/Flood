// Alpha feedback mode. Opening the game with ?alpha turns it on (and it stays on
// in this browser; ?alpha=off turns it off). The game logs each race's facts on
// its own; the form asks the tester only for opinions, keeps a draft, and gives
// back one plain-text report to copy or share (Brain od76#E11: measure what can
// be measured, ask people only what needs a person).

const KEY_ON = 'flood.alpha';
const KEY_LOG = 'flood.alpha.log';
const KEY_DRAFT = 'flood.alpha.draft';
const KEEP_RACES = 12;
const KEEP_ERRORS = 6;

export const QUESTIONS = [
  { id: 'fun', label: 'How fun was it?', choices: ['1', '2', '3', '4', '5'], hint: '1 = boring · 5 = great' },
  { id: 'clear', label: 'Did you know what to do?', choices: ['Always', 'Mostly', 'Sometimes', 'Lost'] },
  { id: 'again', label: 'Would you play another race?', choices: ['Yes', 'Maybe', 'No'] },
  { id: 'best', label: 'Best moment', text: true },
  { id: 'confusing', label: 'What confused you or felt unfair?', text: true },
  { id: 'bugs', label: 'Anything broken or weird? What were you doing just before?', text: true },
  { id: 'other', label: 'Anything else', text: true },
];

const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: kept for this page only */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* no storage */ } },
};

export function alphaWanted(params) {
  const p = params.get('alpha');
  if (p === 'off' || p === '0') { store.del(KEY_ON); return false; }
  if (p !== null) { store.set(KEY_ON, 1); return true; }
  return store.get(KEY_ON, 0) === 1;
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const litres = (v) => v >= 1e6 ? `${(v / 1e6).toFixed(2)}M L` : `${Math.round(v / 1e3)}k L`;

function raceLine(r, i) {
  const what = r.kind === 'tutorial' ? 'tutorial' : 'race';
  let end;
  if (r.result === 'sea') end = `reached the sea ${ord(r.place)} of ${r.of}`;
  else if (r.result === 'drained') end = `drained by ${r.by || 'a rival'} (${ord(r.place)} of ${r.of})`;
  else if (r.result === 'time') end = `time ran out, ${ord(r.place)} of ${r.of}`;
  else if (r.result === 'restarted') end = 'restarted before the end';
  else end = 'left before the end';
  const parts = [`${i + 1}. ${what} · island ${r.seed} · ${end}`];
  if (r.secs != null) parts.push(mmss(r.secs));
  if (r.volume != null) parts.push(`${litres(r.volume)} water`);
  if (r.lakes != null) parts.push(`${r.lakes} lake${r.lakes === 1 ? '' : 's'}`);
  if (r.fps) parts.push(`${r.fps.avg} fps avg, ${r.fps.low} low`);
  return parts.join(' · ');
}

// The report a tester sends: their answers, then the facts the game measured.
export function buildReport({ build, when, device, log, answers }) {
  const a = answers || {};
  const L = [`FLOOD ALPHA FEEDBACK · build ${build} · ${when}`];
  if (a.name) L.push(`From: ${a.name}`);
  L.push('', '— Answers —');
  for (const q of QUESTIONS) {
    const v = (a[q.id] ?? '').toString().trim();
    L.push(q.label, `  ${v ? v.replace(/\n/g, '\n  ') : '(skipped)'}`);
  }
  const races = log?.races ?? [];
  L.push('', `— Races (last ${races.length}, measured by the game) —`);
  if (!races.length) L.push('none yet');
  races.forEach((r, i) => L.push(raceLine(r, i)));
  const t = log?.totals;
  if (t) L.push(`All time in this browser: ${t.races} race${t.races === 1 ? '' : 's'}, ${t.wins} win${t.wins === 1 ? '' : 's'}, ${t.tutorials} tutorial${t.tutorials === 1 ? '' : 's'}`);
  L.push('', '— Device —', device);
  const errs = log?.errors ?? [];
  if (errs.length) { L.push('', '— Errors the game caught —'); for (const e of errs) L.push(`${e.at} · ${e.msg}`); }
  return L.join('\n');
}

function describeDevice() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'other';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'other';
  const touch = navigator.maxTouchPoints > 0 ? 'touch' : 'no touch';
  let pad = 'no controller';
  try { if ([...(navigator.getGamepads?.() ?? [])].some(Boolean)) pad = 'controller connected'; } catch { /* blocked */ }
  return `${os} · ${br} · screen ${screen.width}×${screen.height} @${devicePixelRatio.toFixed(1)}x · window ${innerWidth}×${innerHeight} · ${touch} · ${pad}`;
}

export function createFeedback({ build, onOpenChange }) {
  const log = store.get(KEY_LOG, null) ?? { races: [], errors: [], totals: { races: 0, wins: 0, tutorials: 0 } };
  log.totals ??= { races: 0, wins: 0, tutorials: 0 };
  let current = null; // the race being played (also stored, so leaving the page leaves it marked)
  let fpsN = 0, fpsSum = 0, fpsLow = Infinity, fpsWin = 0, fpsWinN = 0;
  const save = () => store.set(KEY_LOG, log);

  const note = (msg) => {
    const at = new Date().toTimeString().slice(0, 8);
    log.errors.push({ at, msg: String(msg).slice(0, 200) });
    log.errors.splice(0, Math.max(0, log.errors.length - KEEP_ERRORS));
    save();
  };
  addEventListener('error', (e) => note(`${e.message || 'error'}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`));
  addEventListener('unhandledrejection', (e) => note(`promise: ${e.reason?.message ?? e.reason}`));

  // ---- The panel ----
  const btn = document.createElement('button');
  btn.id = 'fb-open';
  btn.textContent = 'ALPHA · Feedback';
  btn.setAttribute('aria-label', 'Send feedback');
  const panel = document.createElement('div');
  panel.id = 'fb';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Alpha feedback');
  const draft = store.get(KEY_DRAFT, {});
  const field = (q) => {
    if (q.text) return `<label class="fb-q"><span>${q.label}</span><textarea data-q="${q.id}" rows="2"></textarea></label>`;
    const opts = q.choices.map((c) => `<label class="fb-c"><input type="radio" name="fb-${q.id}" data-q="${q.id}" value="${c}"><span>${c}</span></label>`).join('');
    return `<div class="fb-q"><span>${q.label}${q.hint ? ` <small>${q.hint}</small>` : ''}</span><div class="fb-cs">${opts}</div></div>`;
  };
  panel.innerHTML = `<div class="fb-card">
    <h3>Alpha feedback</h3>
    <p class="fb-sub">The game already logged your races, times and device. Just tell us what you thought — every question is optional.</p>
    <label class="fb-q"><span>Your name (so we know who to thank)</span><input data-q="name" maxlength="40" autocomplete="nickname"></label>
    ${QUESTIONS.map(field).join('')}
    <details><summary>See the full report</summary><pre id="fb-preview"></pre></details>
    <div class="fb-row">
      <button id="fb-copy" class="fb-main">Copy report</button>
      <button id="fb-share" hidden>Share…</button>
      <button id="fb-close">Back to the game</button>
    </div>
    <p id="fb-said" aria-live="polite"></p>
    <button id="fb-clear" class="fb-link">Clear my answers for a new report</button>
  </div>`;
  document.body.append(btn, panel);
  // Typing here must never steer, pause or restart the game underneath.
  for (const ev of ['keydown', 'keyup']) panel.addEventListener(ev, (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  for (const ev of ['pointerdown', 'pointerup']) panel.addEventListener(ev, (e) => e.stopPropagation());

  const inputs = [...panel.querySelectorAll('[data-q]')];
  const answers = () => {
    const a = {};
    for (const el of inputs) {
      if (el.type === 'radio') { if (el.checked) a[el.dataset.q] = el.value; } else a[el.dataset.q] = el.value;
    }
    return a;
  };
  const fill = (a) => {
    for (const el of inputs) {
      if (el.type === 'radio') el.checked = a[el.dataset.q] === el.value; else el.value = a[el.dataset.q] ?? '';
    }
  };
  fill(draft);
  const report = () => buildReport({ build, when: new Date().toISOString().slice(0, 16).replace('T', ' '), device: describeDevice(), log, answers: answers() });
  const preview = panel.querySelector('#fb-preview');
  const said = panel.querySelector('#fb-said');
  const refresh = () => { store.set(KEY_DRAFT, answers()); preview.textContent = report(); };
  panel.addEventListener('input', refresh);
  panel.addEventListener('change', refresh);

  const share = panel.querySelector('#fb-share');
  share.hidden = !navigator.share;
  share.onclick = () => navigator.share({ title: 'Flood alpha feedback', text: report() }).then(() => { said.textContent = 'Shared — thank you!'; }).catch(() => {});
  panel.querySelector('#fb-copy').onclick = async () => {
    const text = report();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { /* old browser or blocked */ }
    if (!ok) {
      // Fallback: select the report so a long-press or Ctrl+C copies it.
      panel.querySelector('details').open = true;
      const r = document.createRange(); r.selectNodeContents(preview);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      try { ok = document.execCommand('copy'); } catch { /* nothing more to try */ }
    }
    said.textContent = ok ? 'Copied! Paste it to whoever sent you the game link. Thank you!' : 'Couldn’t copy on its own — the report is selected below; copy it from there.';
  };
  panel.querySelector('#fb-clear').onclick = () => { fill({ name: answers().name }); refresh(); said.textContent = 'Answers cleared (your races stay in the report).'; };
  const close = () => { panel.hidden = true; btn.hidden = false; onOpenChange?.(false); };
  panel.querySelector('#fb-close').onclick = close;
  const open = () => {
    said.textContent = '';
    refresh();
    panel.hidden = false; btn.hidden = true;
    onOpenChange?.(true);
    panel.querySelector('.fb-card').scrollTop = 0;
    panel.querySelector('[data-q="name"]').focus({ preventScroll: true });
  };
  btn.onclick = open;

  return {
    open,
    get isOpen() { return !panel.hidden; },
    raceStart({ seed, kind, of }) {
      if (current && current.result === 'playing') current.result = 'restarted';
      current = { seed, kind, of, result: 'playing' };
      fpsN = fpsSum = fpsWin = fpsWinN = 0; fpsLow = Infinity;
      log.races.push(current);
      log.races.splice(0, Math.max(0, log.races.length - KEEP_RACES));
      if (kind === 'tutorial') log.totals.tutorials++; else log.totals.races++;
      save();
    },
    raceEnd({ result, place, of, secs, volume, lakes, by }) {
      if (!current || current.result !== 'playing') return;
      Object.assign(current, { result, place, of, secs: Math.round(secs), volume: Math.round(volume), lakes, by });
      if (fpsN) current.fps = { avg: Math.round(fpsSum / fpsN), low: Math.round(fpsLow === Infinity ? fpsSum / fpsN : fpsLow) };
      if (result === 'sea' && place === 1 && current.kind !== 'tutorial') log.totals.wins++;
      save();
    },
    // Called every rendered frame while racing: average fps, and the worst one-second window.
    frame(dt) {
      if (!current || current.result !== 'playing' || !(dt > 0)) return;
      fpsWin += dt; fpsWinN++;
      if (fpsWin >= 1) {
        const f = fpsWinN / fpsWin;
        fpsN++; fpsSum += f; fpsLow = Math.min(fpsLow, f);
        fpsWin = fpsWinN = 0;
        if (fpsN % 10 === 0) { current.fps = { avg: Math.round(fpsSum / fpsN), low: Math.round(fpsLow) }; save(); }
      }
    },
  };
}
