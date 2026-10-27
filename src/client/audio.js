// Small procedural sound: a rushing-water bed that follows speed, a gulp for
// lakes and a thud for merges. Started on the first gesture, fire-and-forget:
// nothing in the game waits on audio, so a blocked AudioContext costs only sound.

export function createAudio() {
  let ctx = null, bed = null, muted = false;
  try { muted = localStorage.getItem('flood.muted') === '1'; } catch { /* no storage */ }

  function start() {
    if (ctx || muted) return;
    try {
      ctx = new AudioContext();
      ctx.resume?.().catch(() => {});
      // Two seconds of noise, looped, band-passed into a river hiss.
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let b = 0;
      for (let i = 0; i < d.length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 600;
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start();
      bed = { filter, gain };
    } catch { ctx = null; }
  }
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, start, { once: false, passive: true });

  function blip(f0, f1, dur, vol) {
    if (!ctx || muted) return;
    try {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur);
    } catch { /* sound is optional */ }
  }

  return {
    // speed01: 0..1 of top speed; flowing: false when out or finished.
    update(speed01, flowing) {
      if (!bed) return;
      const t = ctx.currentTime;
      bed.gain.gain.setTargetAtTime(muted || !flowing ? 0 : 0.05 + 0.12 * speed01, t, 0.3);
      bed.filter.frequency.setTargetAtTime(400 + 900 * speed01, t, 0.3);
    },
    lake() { blip(180, 620, 0.35, 0.18); },
    merge(won) { blip(won ? 140 : 90, won ? 60 : 40, 0.5, 0.3); },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('flood.muted', muted ? '1' : '0'); } catch { /* no storage */ }
      if (!muted) start();
      return muted;
    },
    get muted() { return muted; },
  };
}
