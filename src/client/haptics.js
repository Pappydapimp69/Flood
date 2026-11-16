// Vibration: the phone's motor (navigator.vibrate, Android browsers; iPhones have none in the browser) and every
// connected controller's rumble. bs dlist-4: the phone refuses until the page has had a tap, and says so by
// returning false, so a refusal is not remembered as final; bs upstarts-12: feature-detect each path and keep
// quiet where none exists; bs dlist-13: below about a quarter strength a motor does not register, so pulses are
// clamped up; bs dlist-7: pulses landing together add as energy (sum of squares), not the louder one alone.
export function createHaptics(enabled) {
  let pend = 0, pendMs = 0, timer = 0;
  const fire = () => {
    timer = 0;
    const s = Math.min(1, Math.max(0.25, Math.sqrt(pend))), ms = Math.round(pendMs);
    pend = 0; pendMs = 0;
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* blocked */ }
    try {
      for (const gp of navigator.getGamepads?.() ?? []) {
        if (!gp) continue;
        if (gp.vibrationActuator?.playEffect) gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: s, weakMagnitude: Math.min(1, s * 0.7) }).catch(() => {});
        else gp.hapticActuators?.[0]?.pulse?.(s, ms);
      }
    } catch { /* no rumble here */ }
  };
  // strength 0..1, ms: how long.
  return (strength, ms) => {
    if (!enabled() || strength <= 0) return;
    pend += strength * strength; pendMs = Math.max(pendMs, ms);
    if (!timer) timer = setTimeout(fire, 30); // gather what lands in the same moment
  };
}
