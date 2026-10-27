// Small procedural sound: a rushing-water bed that follows speed, a gulp for
// lakes, a thud for merges, and a slow generative music loop. Started on the first gesture, fire-and-forget:
// nothing in the game waits on audio, so a blocked AudioContext costs only sound.

export function createAudio() {
  let ctx = null, bed = null, muted = false, music = null;
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

  // Music: a four-chord pad under a soft plucked arpeggio, scheduled a little
  // ahead on the audio clock. A minor-ish, slow, water-like.
  const CHORDS = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 52, 55, 60], [55, 59, 62, 67]];
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  const BEAT = 0.5; // seconds per arpeggio step
  function note(out, m, t, dur, vol, type) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = hz(m);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (type === 'sine' ? 0.6 : 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function startMusic() {
    if (!ctx || music) return;
    const out = ctx.createGain();
    out.gain.value = muted ? 0 : 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    out.connect(lp).connect(ctx.destination);
    music = { out, step: 0, next: ctx.currentTime + 0.1 };
    music.timer = setInterval(() => {
      try {
        while (music.next < ctx.currentTime + 0.4) {
          const t = music.next, i = music.step, chord = CHORDS[Math.floor(i / 8) % CHORDS.length];
          if (i % 8 === 0) for (const m of chord) note(out, m - 12, t, BEAT * 8.5, 0.035, 'sine');
          const arp = [0, 1, 2, 3, 2, 1, 3, 1][i % 8];
          note(out, chord[arp] + (i % 16 < 8 ? 0 : 12), t, BEAT * 1.8, 0.05, 'triangle');
          music.step++;
          music.next += BEAT;
        }
      } catch { /* sound is optional */ }
    }, 100);
  }

  return {
    // The splash screen's press: unlocks audio and starts the music.
    music() { start(); startMusic(); },
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
      if (music) music.out.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.1);
      return muted;
    },
    get muted() { return muted; },
  };
}
