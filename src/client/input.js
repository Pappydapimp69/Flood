// Steering input: keyboard, touch/mouse and gamepad. Presses are captured at
// event time, so a tap shorter than a sim tick still turns for one tick
// (held-state sampling alone would miss it). Gamepads have no events worth
// trusting (Chrome hides a pad until a button press), so poll() reads them
// every frame.

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const FWD = new Set(['ArrowUp', 'KeyW']);
const BACK = new Set(['ArrowDown', 'KeyS']);

// Standard gamepad mapping.
const PAD = { A: 0, B: 1, X: 2, Y: 3, BACK: 8, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const DEADZONE = 0.35;

export function createInput(target) {
  const held = { left: false, right: false };
  const pulse = { left: false, right: false };
  const pointers = new Map(); // pointerId -> 'left' | 'right'
  const actions = []; // one-shot keys: 'restart', 'map'

  let onChange = null; // (steer) => void, fired on every press and release
  let onPad = null; // fired once, when a gamepad is first seen
  const current = () => (held.left === held.right ? 0 : held.left ? -1 : 1);
  const press = (side) => { held[side] = true; pulse[side] = true; onChange?.(side === 'left' ? -1 : 1); };
  const sync = () => {
    held.left = keys.left || pad.left || [...pointers.values()].includes('left');
    held.right = keys.right || pad.right || [...pointers.values()].includes('right');
    onChange?.(current());
  };
  const keys = { left: false, right: false, fwd: false, back: false };
  const pad = { left: false, right: false, down: new Set(), stickY: 0, seen: false, fwd: 0, look: 0 };
  // Forward / back: hurry or slow the drop. Keys or left stick up / down.
  const forward = () => {
    const k = keys.fwd === keys.back ? 0 : keys.fwd ? 1 : -1;
    return k || pad.fwd;
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
    } else if (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'Space') actions.push('restart');
    else if (e.code === 'KeyM') actions.push('map');
  });
  addEventListener('keyup', (e) => {
    if (LEFT.has(e.code)) keys.left = false;
    else if (RIGHT.has(e.code)) keys.right = false;
    else if (FWD.has(e.code)) keys.fwd = false;
    else if (BACK.has(e.code)) keys.back = false;
    sync();
  });
  addEventListener('blur', () => { keys.left = keys.right = keys.fwd = keys.back = pad.left = pad.right = false; pad.fwd = pad.look = 0; pointers.clear(); sync(); });

  // Touch / mouse: hold the left or right half of the screen.
  // A drag stick too: where the first finger went down and where it is now.
  // The game uses it while falling (aim where you drag); halves steer on the ground.
  let stick = null; // { id, x0, y0, x, y }
  target.addEventListener('pointerdown', (e) => {
    const side = e.clientX < innerWidth / 2 ? 'left' : 'right';
    pointers.set(e.pointerId, side);
    press(side);
    actions.push('tap');
    if (!stick) stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  });
  target.addEventListener('pointermove', (e) => {
    if (stick && e.pointerId === stick.id) { stick.x = e.clientX; stick.y = e.clientY; }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (stick && e.pointerId === stick.id) stick = null;
    sync();
  };
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);

  return {
    // Steer for the next tick: -1 left, 1 right, 0 straight.
    sample() {
      const l = held.left || pulse.left, r = held.right || pulse.right;
      pulse.left = pulse.right = false;
      return l === r ? 0 : l ? -1 : 1;
    },
    // Hurry (+1) or slow (-1) the drop.
    forward,
    // Right stick x, -1..1: turns the camera. 0 inside the dead zone.
    look: () => pad.look,
    takeActions() { return actions.splice(0); },
    // The drag stick: offset from where the finger went down, in screen pixels,
    // with its start point; null while no finger (or mouse button) is down.
    drag: () => (stick ? { dx: stick.x - stick.x0, dy: stick.y - stick.y0, x0: stick.x0, y0: stick.y0 } : null),
    // Read gamepads; call once per frame. Steering is the left stick or D-pad,
    // its up / down hurries or slows the drop; the right stick turns the camera.
    // Button presses become actions: A 'confirm' (and 'restart'), X 'mute',
    // Y/Back 'map', D-pad or stick up/down 'up'/'down' for menus.
    poll() {
      const pads = navigator.getGamepads?.() ?? [];
      let l = false, r = false, y = 0, look = 0;
      const now = new Set();
      for (const gp of pads) {
        if (!gp) continue;
        const x = gp.axes[0] ?? 0;
        y = gp.axes[1] ?? 0;
        const rx = gp.axes[2] ?? 0;
        if (Math.abs(rx) > 0.2 && Math.abs(rx) > Math.abs(look)) look = rx;
        if (x < -DEADZONE || gp.buttons[PAD.LEFT]?.pressed) l = true;
        if (x > DEADZONE || gp.buttons[PAD.RIGHT]?.pressed) r = true;
        gp.buttons.forEach((b, i) => { if (b.pressed) now.add(i); });
      }
      if (!pads.some(Boolean)) return;
      pad.look = look;
      const f = y < -DEADZONE || now.has(PAD.UP) ? 1 : y > DEADZONE || now.has(PAD.DOWN) ? -1 : 0;
      if (f !== pad.fwd) { pad.fwd = f; onChange?.(current()); }
      if (!pad.seen) { pad.seen = true; onPad?.(); }
      for (const i of now) {
        if (pad.down.has(i)) continue; // edges only
        if (i === PAD.A) actions.push('confirm', 'restart');
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
    // Online play sends steer as it changes instead of waiting for the next frame.
    set onChange(fn) { onChange = fn; },
  };
}
