// Route-preview markers for rival channels ahead: one per channel (owner, 2026-11-09). A path weaving
// along a channel's edge re-enters it again and again; that is still one channel and one marker, placed
// at the first crossing ahead, and its points along the channel add up (12+ is a ride, not a cut).
// Hysteresis (view management, Bell et al. 2001): the preview is re-run four times a second, so a
// marker stays where it was until its channel's first crossing moves more than HOLD metres.
export const HOLD = 150;

export function groupCrossings(path, prev = []) {
  const marks = [], byRival = new Map();
  for (const p of path) {
    if (!p.cross) continue;
    const m = byRival.get(p.cross.o);
    if (m) { m.n++; continue; }
    const fresh = { x: p.x, z: p.z, ...p.cross, n: 1 };
    byRival.set(p.cross.o, fresh);
    marks.push(fresh);
  }
  for (const m of marks) {
    const old = prev.find((q) => q.o === m.o);
    if (old && Math.hypot(old.x - m.x, old.z - m.z) < HOLD) { m.x = old.x; m.z = old.z; }
  }
  return marks;
}
