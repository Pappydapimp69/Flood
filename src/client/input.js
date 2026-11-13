// Steering input: keyboard, touch/mouse and gamepad. Presses are captured at
// event time, so a tap shorter than a sim tick still turns for one tick
// (held-state sampling alone would miss it). Gamepads have no events worth
// trusting (Chrome hides a pad until a button press), so poll() reads them
// every frame.

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const FWD = new Set(['ArrowUp', 'KeyW']);
const BACK = new Set(['ArrowDown', 'KeyS']);
const SKILL = new Set(['Space', 'KeyE', 'ShiftLeft', 'ShiftRight']);
const SURGE = new Set(['KeyQ', 'KeyF', 'ControlLeft']);

// Standard gamepad mapping.
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const DEADZONE = 0.35;

export function createInput(target) {
  const held = { left: false, right: false };
  const pulse = { left: false, right: false };
  const pointers = new Map(); // pointerId -> 'left' | 'right'
  const actions = []; // one-shot keys: 'restart', 'map'

  let onChange = null; // (steer) => void, fired on every press and release
  let onSkill = null; // () => void, fired on every skill press
  let skillPulse = 0; // a skill press not yet taken by a tick
  const pressSkill = () => { skillPulse = 1; onSkill?.(); };
  let onSurge = null, surgePulse = 0;
  const pressSurge = () => { surgePulse = 1; onSurge?.(); };
  let onPad = null; // fired once, when a gamepad is first seen
  const current = () => (held.left === held.right ? 0 : held.left ? -1 : 1);
  const press = (side) => { held[side] = true; pulse[side] = true; onChange?.(side === 'left' ? -1 : 1); };
  const sync = () => {
    held.left = keys.left || pad.left || btn.left || [...pointers.values()].includes('left');
    held.right = keys.right || pad.right || btn.right || [...pointers.values()].includes('right');
    onChange?.(current());
  };
  const keys = { left: false, right: false, fwd: false, back: false };
  // On-screen touch buttons (phones): ◀ ▶ steer, ▲ ▼ dash / dive while falling. Kept apart
  // so one thumb steers and the other flies the drop (owner, 2026-11-11).
  const btn = { left: false, right: false, fwd: false, back: false };
  const pad = { left: false, right: false, down: new Set(), stickY: 0, seen: false, fwd: 0, glide: 0, look: 0, vec: { x: 0, y: 0 } };
  // Forward / back: hurry or slow the fall. Keys or right stick up / down.
  const forward = () => {
    const k = keys.fwd === keys.back ? 0 : keys.fwd ? 1 : -1;
    const b = btn.fwd === btn.back ? 0 : btn.fwd ? 1 : -1;
    return k || b || pad.fwd;
  };

  addEventListener('keydown', (e) => {
    if (e.repeat && (LEFT.has(e.code) || RIGHT.has(e.code))) return e.preventDefault(); // held already
    if (LEFT.has(e.code)) { keys.left = true; press('left'); e.preventDefault(); }
    else if (RIGHT.has(e.code)) { keys.right = true; press('right'); e.preventDefault(); }
    else if (FWD.has(e.code) || BACK.has(e.code)) {
      const was = forward();
      keys[FWD.has(e.code) ? 'fwd' : 'back'] = true;
      if (forward() !== was) onChange?.(current());
      e.preventDefault();
    } else if (SKILL.has(e.code)) {
      if (!e.repeat) pressSkill();
      if (e.code === 'Space') actions.push('restart');
      e.preventDefault();
    } else if (SURGE.has(e.code)) { if (!e.repeat) pressSurge(); e.preventDefault(); }
    else if (e.code === 'Escape' || e.code === 'KeyP') actions.push('pause');
    else if (e.code === 'KeyR' || e.code === 'Enter') actions.push('restart');
    else if (e.code === 'KeyM') actions.push('map');
  });
  addEventListener('keyup', (e) => {
    if (LEFT.has(e.code)) keys.left = false;
    else if (RIGHT.has(e.code)) keys.right = false;
    else if (FWD.has(e.code)) keys.fwd = false;
    else if (BACK.has(e.code)) keys.back = false;
    sync();
  });
  addEventListener('blur', () => { swipe = null; });
  addEventListener('blur', () => { keys.left = keys.right = keys.fwd = keys.back = btn.left = btn.right = btn.fwd = btn.back = pad.left = pad.right = false; pad.fwd = pad.look = 0; pointers.clear(); sync(); });

  // Touch / mouse: hold the left or right half of the screen.
  // A drag stick too: where the first finger went down and where it is now.
  // The game uses it while falling (aim where you drag); halves steer on the ground.
  let stick = null; // { id, x0, y0, x, y }
  // A phone's finger on open screen (not a button) is the right stick (owner, 2026-11-11):
  // drag sideways looks left / right, drag up pulls the camera back for a view ahead; let go
  // and it eases back behind the river. It never steers: the ◀ ▶ buttons do that.
  let swipe = null; // { id, x0, y0, x, y }
  const SWIPE = 110; // pixels of drag for a full stick
  target.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      actions.push('tap');
      if (!swipe) swipe = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      return;
    }
    const side = e.clientX < innerWidth / 2 ? 'left' : 'right';
    pointers.set(e.pointerId, side);
    press(side);
    actions.push('tap');
    // The drag stick (left / right and up / down in one) is for a mouse; a phone has its own buttons.
    if (!stick && e.pointerType === 'mouse') stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  });
  target.addEventListener('pointermove', (e) => {
    if (swipe && e.pointerId === swipe.id) { swipe.x = e.clientX; swipe.y = e.clientY; }
    if (stick && e.pointerId === stick.id) { stick.x = e.clientX; stick.y = e.clientY; }
  });
  const up = (e) => {
    if (swipe && e.pointerId === swipe.id) swipe = null;
    pointers.delete(e.pointerId);
    if (stick && e.pointerId === stick.id) stick = null;
    sync();
  };
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);

  // Wire an on-screen button to a held control. Pointer capture keeps it held while the
  // thumb slides a little; the press never reaches the canvas underneath.
  const bind = (el, what) => {
    const on = new Set();
    const set = () => {
      const was = btn[what];
      btn[what] = on.size > 0;
      if (btn[what] && !was && (what === 'left' || what === 'right')) press(what);
      sync();
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      on.add(e.pointerId); try { el.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ } el.classList.add('on'); set();
    });
    const off = (e) => { on.delete(e.pointerId); if (!on.size) el.classList.remove('on'); set(); };
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  // Wire an on-screen button to a toggle: each tap turns the control on or off (owner, 2026-11-13:
  // holding DIVE tied up the right thumb that also needs DASH).
  const toggles = new Map();
  const bindToggle = (el, what) => {
    toggles.set(what, el);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      btn[what] = !btn[what]; el.classList.toggle('on', btn[what]); sync();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  // Turn a toggle off (the drop has landed, a new race).
  const untoggle = (what) => {
    if (!btn[what]) return;
    btn[what] = false; toggles.get(what)?.classList.remove('on'); sync();
  };

  return {
    bind,
    bindToggle,
    untoggle,
    // True while the steer this tick comes from touch alone (no key or pad held): phones
    // turn 20% slower (owner, 2026-11-11), so the game drops every fifth turning tick.
    touchSteer: () => !keys.left && !keys.right && !pad.left && !pad.right && (held.left || held.right),
    // Steer for the next tick: -1 left, 1 right, 0 straight.
    sample() {
      const l = held.left || pulse.left, r = held.right || pulse.right;
      pulse.left = pulse.right = false;
      return l === r ? 0 : l ? -1 : 1;
    },
    // Hurry (+1) or slow (-1) the drop.
    forward,
    // Glide throttle: the pad's left stick, or on a keyboard the same keys as the dive. ↑ is full
    // throttle as well as a dive, so a keyboard drop can fly as fast as a pad's or a bot's (it was
    // capped at 1.5x against their 1.8-2.2x, and landed last however well it was flown).
    glide: () => pad.glide || (keys.fwd === keys.back ? 0 : keys.fwd ? 1 : 0),
    // Left stick / D-pad as a screen vector (x right, y down), length 0..1; null with no pad.
    stick: () => (pad.seen ? pad.vec : null),
    // Left stick up (+) / down (-), -1..1: tilts the camera while falling.
    tilt: () => (pad.seen ? pad.tilt ?? 0 : 0),
    // 1 once for each skill press (key, pad B or the on-screen button), then 0.
    takeSkill() { const k = skillPulse; skillPulse = 0; return k; },
    takeSurge() { const u = surgePulse; surgePulse = 0; return u; },
    pressSurge,
    pressSkill,
    // Right stick sideways, -1..1: look left / right (once landed).
    look: () => {
      if (!swipe) return pad.look;
      const v = (swipe.x - swipe.x0) / SWIPE;
      return Math.abs(v) < 0.15 ? 0 : Math.max(-1, Math.min(1, v));
    },
    rise: () => {
      if (!swipe) return pad.rise ?? 0;
      const v = (swipe.y0 - swipe.y) / SWIPE; // up is +
      return v < 0.15 ? 0 : Math.min(1, v);
    },
    takeActions() { return actions.splice(0); },
    // The drag stick: offset from where the finger went down, in screen pixels,
    // with its start point; null while no finger (or mouse button) is down.
    drag: () => (stick ? { dx: stick.x - stick.x0, dy: stick.y - stick.y0, x0: stick.x0, y0: stick.y0 } : null),
    // Read gamepads; call once per frame. Steering is the left stick or D-pad,
    // falling, its up / down glides faster or slower; the right stick up / down hurries or slows the fall.
    // Button presses become actions: A 'confirm' (and 'restart') and the skill in a race, B the skill too, X 'mute',
    // Y/Back 'map', D-pad or stick up/down 'up'/'down' for menus.
    poll() {
      const pads = navigator.getGamepads?.() ?? [];
      let l = false, r = false, y = 0, ry = 0, look = 0, vx = 0, vy = 0;
      const now = new Set();
      for (const gp of pads) {
        if (!gp) continue;
        const x = gp.axes[0] ?? 0;
        // The strongest push over every listed controller: browsers often list more than one (an idle
        // duplicate or a phone's own), and taking the last one's zeros lost the real stick.
        if (Math.abs(gp.axes[1] ?? 0) > Math.abs(y)) y = gp.axes[1];
        if (Math.abs(gp.axes[3] ?? 0) > Math.abs(ry)) ry = gp.axes[3]; // right stick up / down: the fall while dropping, the raised view once landed
        const rx = gp.axes[2] ?? 0;
        if (Math.abs(rx) > 0.2 && Math.abs(rx) > Math.abs(look)) look = rx; // right stick sideways: look left / right once landed
        // The left stick (or D-pad) as a screen direction, for the top-down drop.
        const b = (i) => (gp.buttons[i]?.pressed ? 1 : 0);
        vx = x + b(PAD.RIGHT) - b(PAD.LEFT); vy = y + b(PAD.DOWN) - b(PAD.UP);
        if (x < -DEADZONE || gp.buttons[PAD.LEFT]?.pressed) l = true;
        if (x > DEADZONE || gp.buttons[PAD.RIGHT]?.pressed) r = true;
        gp.buttons.forEach((b, i) => { if (b.pressed) now.add(i); });
      }
      if (!pads.some(Boolean)) return;
      pad.look = look;
      // The right stick is the camera: up / down tilts the view while falling, up raises it once landed.
      pad.tilt = Math.abs(ry) > DEADZONE ? -ry : 0;
      pad.rise = ry < -0.2 ? Math.min(1, (-ry - 0.2) / 0.7) : 0; // right stick up: 0..1
      const vl = Math.hypot(vx, vy);
      pad.vec = vl > 1 ? { x: vx / vl, y: vy / vl } : { x: vx, y: vy };
      // Falling, the left stick's up hurries the fall (the camera moved to the right stick); dash is
      // the Surge button (a bumper). The left stick's sideways steers, as before.
      const g = 0;
      const f = y < -DEADZONE ? 1 : 0;
      if (f !== pad.fwd || g !== pad.glide) { pad.fwd = f; pad.glide = g; onChange?.(current()); }
      if (!pad.seen) { pad.seen = true; onPad?.(); }
      for (const i of now) {
        if (pad.down.has(i)) continue; // edges only
        if (i === PAD.A) { actions.push('confirm', 'restart'); pressSkill(); } // A: select in menus, Gouge in a race
        else if (i === PAD.B) pressSkill();
        else if (i === PAD.RB || i === PAD.LB) pressSurge();
        else if (i === PAD.START) actions.push('pause');
        else if (i === PAD.X) actions.push('mute');
        else if (i === PAD.Y || i === PAD.BACK) actions.push('map');
        else if (i === PAD.UP) actions.push('up');
        else if (i === PAD.DOWN) actions.push('down');
      }
      pad.down = now;
      // Stick up/down for menus, debounced to one step per push.
      const dir = y < -0.6 ? -1 : y > 0.6 ? 1 : 0;
      if (dir && dir !== pad.stickY) actions.push(dir < 0 ? 'up' : 'down');
      pad.stickY = dir;
      if (l !== pad.left || r !== pad.right) {
        if (l && !pad.left) press('left');
        if (r && !pad.right) press('right');
        pad.left = l; pad.right = r;
        sync();
      }
    },
    set onPad(fn) { onPad = fn; },
    // Online play sends a skill press at once.
    set onSkill(fn) { onSkill = fn; },
    set onSurge(fn) { onSurge = fn; },
    // Online play sends steer as it changes instead of waiting for the next frame.
    set onChange(fn) { onChange = fn; },
  };
}
