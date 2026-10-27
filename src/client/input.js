// Steering input: keyboard, touch/mouse and gamepad. Presses are captured at
// event time, so a tap shorter than a sim tick still turns for one tick
// (held-state sampling alone would miss it). Gamepads have no events worth
// trusting (Chrome hides a pad until a button press), so poll() reads them
// every frame.

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);

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
  const keys = { left: false, right: false };
  const pad = { left: false, right: false, down: new Set(), stickY: 0, seen: false };

  addEventListener('keydown', (e) => {
    if (e.repeat && (LEFT.has(e.code) || RIGHT.has(e.code))) return e.preventDefault(); // held already
    if (LEFT.has(e.code)) { keys.left = true; press('left'); e.preventDefault(); }
    else if (RIGHT.has(e.code)) { keys.right = true; press('right'); e.preventDefault(); }
    else if (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'Space') actions.push('restart');
    else if (e.code === 'KeyM') actions.push('map');
  });
  addEventListener('keyup', (e) => {
    if (LEFT.has(e.code)) keys.left = false;
    else if (RIGHT.has(e.code)) keys.right = false;
    sync();
  });
  addEventListener('blur', () => { keys.left = keys.right = pad.left = pad.right = false; pointers.clear(); sync(); });

  // Touch / mouse: hold the left or right half of the screen.
  target.addEventListener('pointerdown', (e) => {
    const side = e.clientX < innerWidth / 2 ? 'left' : 'right';
    pointers.set(e.pointerId, side);
    press(side);
    actions.push('tap');
  });
  const up = (e) => { pointers.delete(e.pointerId); sync(); };
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);

  return {
    // Steer for the next tick: -1 left, 1 right, 0 straight.
    sample() {
      const l = held.left || pulse.left, r = held.right || pulse.right;
      pulse.left = pulse.right = false;
      return l === r ? 0 : l ? -1 : 1;
    },
    takeActions() { return actions.splice(0); },
    // Read gamepads; call once per frame. Steering is the left stick or D-pad.
    // Button presses become actions: A 'confirm' (and 'restart'), X 'mute',
    // Y/Back 'map', D-pad or stick up/down 'up'/'down' for menus.
    poll() {
      const pads = navigator.getGamepads?.() ?? [];
      let l = false, r = false, y = 0;
      const now = new Set();
      for (const gp of pads) {
        if (!gp) continue;
        const x = gp.axes[0] ?? 0;
        y = gp.axes[1] ?? 0;
        if (x < -DEADZONE || gp.buttons[PAD.LEFT]?.pressed) l = true;
        if (x > DEADZONE || gp.buttons[PAD.RIGHT]?.pressed) r = true;
        gp.buttons.forEach((b, i) => { if (b.pressed) now.add(i); });
      }
      if (!pads.some(Boolean)) return;
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
