// Steering input. Presses are captured at event time, so a tap shorter than a
// sim tick still turns for one tick (held-state sampling alone would miss it).

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);

export function createInput(target) {
  const held = { left: false, right: false };
  const pulse = { left: false, right: false };
  const pointers = new Map(); // pointerId -> 'left' | 'right'
  const actions = []; // one-shot keys: 'restart', 'map'

  let onChange = null; // (steer) => void, fired on every press and release
  const current = () => (held.left === held.right ? 0 : held.left ? -1 : 1);
  const press = (side) => { held[side] = true; pulse[side] = true; onChange?.(side === 'left' ? -1 : 1); };
  const sync = () => {
    held.left = keys.left || [...pointers.values()].includes('left');
    held.right = keys.right || [...pointers.values()].includes('right');
    onChange?.(current());
  };
  const keys = { left: false, right: false };

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
  addEventListener('blur', () => { keys.left = keys.right = false; pointers.clear(); sync(); });

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
    // Online play sends steer as it changes instead of waiting for the next frame.
    set onChange(fn) { onChange = fn; },
  };
}
