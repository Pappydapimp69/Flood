// Procedural sound. A water bed in three layers (a low rumble that grows with
// the river, a rush that brightens with speed, a gurgle that bubbles), wind
// while falling, and one-shot effects: landing splash, lake swallow, lava hiss,
// siphon bubbles, the sea at the finish. Effects share a bus with a soft
// compressor and a voice budget, and free their nodes when done. Music: two
// pieces written with `brain compose`, crossfaded with an equal-power curve; a
// small generative loop stands in if they can't load. Started on the first
// gesture, fire-and-forget: nothing waits on audio, so a blocked context costs only sound.

export function createAudio() {
  let ctx = null, bed = null, muted = false, music = null, sfxBus = null, noise = null;
  let voices = 0;
  const VOICES = 12, last = {};
  try { muted = localStorage.getItem('flood.muted') === '1'; } catch { /* no storage */ }

  function start() {
    if (ctx || muted) return;
    try {
      ctx = new AudioContext();
      ctx.resume?.().catch(() => {});
      // Two seconds of stereo noise (left and right independent), gently
      // low-passed so it's water, not static.
      noise = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = noise.getChannelData(c);
        let b0 = 0, b1 = 0;
        for (let i = 0; i < d.length; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99 * b0 + 0.08 * w; b1 = 0.6 * b1 + 0.4 * w; // pink-ish: a slow and a quick part
          d[i] = (b0 * 0.7 + b1 * 0.5) * 0.9;
        }
      }
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
      const soft = ctx.createBiquadFilter();
      soft.type = 'lowpass'; soft.frequency.value = 7000;
      sfxBus = ctx.createGain();
      sfxBus.gain.value = muted ? 0 : 1;
      sfxBus.connect(soft).connect(comp).connect(ctx.destination);
      const layer = (type, f, q) => {
        const src = ctx.createBufferSource();
        src.buffer = noise; src.loop = true;
        src.playbackRate.value = 0.85 + Math.random() * 0.3;
        const filter = ctx.createBiquadFilter();
        filter.type = type; filter.frequency.value = f; filter.Q.value = q;
        const gain = ctx.createGain(); gain.gain.value = 0;
        src.connect(filter).connect(gain).connect(sfxBus);
        src.start();
        return { filter, gain };
      };
      bed = { rumble: layer('lowpass', 180, 0.7), rush: layer('bandpass', 800, 0.6), gurgle: layer('bandpass', 2300, 3), wind: layer('bandpass', 420, 0.5) };
      // The gurgle bubbles: its level wobbles with two slow, unrelated oscillators.
      for (const f of [3.1, 5.3]) {
        const lfo = ctx.createOscillator(), depth = ctx.createGain();
        lfo.frequency.value = f; depth.gain.value = 0.012;
        lfo.connect(depth).connect(bed.gurgle.gain.gain);
        lfo.start();
      }
    } catch { ctx = null; }
  }

  // One-shot effects, within a voice budget; every chain disconnects when done.
  function voice(build, key, gap = 0) {
    if (!ctx || muted || voices >= VOICES) return;
    const t = ctx.currentTime;
    if (key && last[key] !== undefined && t - last[key] < gap) return;
    if (key) last[key] = t;
    try {
      const nodes = build(t);
      voices++;
      const end = nodes[0];
      end.onended = () => { voices--; for (const n of nodes) n.disconnect(); };
    } catch { /* sound is optional */ }
  }
  // Filtered noise burst: a splash, a hiss, a wave.
  function burst(t, dur, type, f0, f1, vol, q = 0.8) {
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise;
    filter.type = type; filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.1));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(sfxBus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    return [src, filter, g];
  }
  function tone(t, f0, f1, dur, vol, type = 'sine') {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
    return [o, g];
  }

  // Browsers only let sound start from a click, tap or key press (a gamepad
  // button doesn't count). Every such gesture starts or wakes the audio and
  // the music, however the page was opened.
  const wake = () => {
    start();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});
    loadTracks();
  };
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, wake, { once: false, passive: true });

  function blip(f0, f1, dur, vol) { voice((t) => tone(t, f0, f1, dur, vol)); }

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
  // The composed pieces, decoded once; null until loaded (or if they fail).
  const TRACKS = { menu: './assets/music/source.mp3', race: './assets/music/downhill.mp3' };
  const VOLUME = { menu: 0.55, race: 0.4 };
  let musicBus = null, buffers = null, playing = null, want = 'menu';
  function loadTracks() {
    if (buffers) return;
    buffers = {};
    musicBus = ctx.createGain();
    musicBus.gain.value = muted ? 0 : 1;
    musicBus.connect(ctx.destination);
    for (const [name, url] of Object.entries(TRACKS)) {
      fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((b) => ctx.decodeAudioData(b))
        .then((buf) => { buffers[name] = buf; if (name === want) play(want); })
        .catch(() => { if (name === want && !music) startMusic(); }); // fall back to the generative loop
    }
  }
  // Crossfade to a piece, looping it.
  function play(name) {
    want = name;
    if (!ctx || !buffers?.[name] || playing?.name === name) return;
    const t = ctx.currentTime;
    // Equal-power crossfade (cos/sin) over 2.5 s: two different pieces don't dip in the middle.
    const F = 2.5, steps = 32, down = new Float32Array(steps), upc = new Float32Array(steps);
    for (let i = 0; i < steps; i++) { const a = (i / (steps - 1)) * Math.PI / 2; down[i] = Math.cos(a); upc[i] = Math.sin(a) * VOLUME[name]; }
    if (playing) {
      const g0 = playing.gain.gain.value;
      playing.gain.gain.cancelScheduledValues(t);
      playing.gain.gain.setValueCurveAtTime(down.map((v) => v * g0), t, F);
      playing.src.stop(t + F + 0.1);
    }
    if (music) { music.out.gain.setTargetAtTime(0, t, 0.6); clearInterval(music.timer); }
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = buffers[name];
    src.loop = true;
    gain.gain.setValueCurveAtTime(upc, t, F);
    src.connect(gain).connect(musicBus);
    src.start(t);
    playing = { name, src, gain };
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
    music() { start(); if (ctx) loadTracks(); },
    // Which piece plays: 'menu' (splash, menu, results) or 'race'.
    track(name) { want = name; if (ctx && buffers) play(name); },
    // speed01: 0..1 of top speed; flowing: false when out or finished;
    // size: river size (1 at the start); fall01: 1 at the top of the drop, 0 landed.
    update(speed01, flowing, size = 1, fall01 = 0) {
      if (!bed) return;
      const t = ctx.currentTime, on = !muted && flowing, big = Math.min(1, (size - 1) / 0.8); // the roar grows fast with size
      bed.rumble.gain.gain.setTargetAtTime(on ? 0.1 + 0.22 * big + 0.06 * speed01 * (1 + big) : 0, t, 0.4);
      bed.rush.gain.gain.setTargetAtTime(on ? 0.035 + 0.12 * speed01 : 0, t, 0.3);
      bed.rush.filter.frequency.setTargetAtTime(600 + 1100 * speed01, t, 0.3);
      bed.gurgle.gain.gain.setTargetAtTime(on ? 0.015 + 0.03 * speed01 : 0, t, 0.3);
      bed.wind.gain.gain.setTargetAtTime(!muted && fall01 > 0 ? 0.05 + 0.16 * fall01 : 0, t, 0.3);
      bed.wind.filter.frequency.setTargetAtTime(300 + 500 * fall01, t, 0.3);
    },
    lake() { this.swallow(); },
    // Touchdown: a heavy splash.
    splash(size = 1) { voice((t) => [...burst(t, 0.9, 'lowpass', 2600, 220, 0.5 * Math.min(1.5, size)), ...tone(t, 110, 50, 0.4, 0.25)], 'splash', 0.3); },
    // Joining a lake: a deep gulp and a whoosh.
    swallow() { voice((t) => [...tone(t, 150, 55, 0.5, 0.3), ...burst(t, 0.7, 'bandpass', 500, 1400, 0.22, 1.2)], 'swallow', 0.5); },
    // Water on lava: a steam hiss.
    hiss() { voice((t) => burst(t, 0.6, 'highpass', 2500, 5000, 0.12, 0.7), 'hiss', 0.45); },
    // Drawing water from a rival: a few bubbles.
    bubble() { voice((t) => tone(t, 320 + Math.random() * 280, 700 + Math.random() * 300, 0.09, 0.08), 'bubble', 0.12); },
    // Reaching the sea: a wave crashing and a bright chime.
    finish(first) {
      voice((t) => burst(t, 2.6, 'lowpass', 1800, 300, 0.45, 0.6));
      voice((t) => [...tone(t, first ? 880 : 660, first ? 880 : 660, 1.6, 0.12), ...tone(t + 0.12, first ? 1320 : 990, first ? 1320 : 990, 1.8, 0.09)]);
    },
    merge(won) { blip(won ? 140 : 90, won ? 60 : 40, 0.5, 0.3); },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('flood.muted', muted ? '1' : '0'); } catch { /* no storage */ }
      if (!muted) { start(); if (ctx) loadTracks(); }
      if (music) music.out.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.1);
      if (musicBus) musicBus.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.1);
      if (sfxBus) sfxBus.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.1);
      return muted;
    },
    get muted() { return muted; },
    get playing() { return playing?.name ?? (music ? 'generative' : null); },
    // True while the browser is holding sound back until a click or key press.
    get blocked() { return !muted && (!ctx || ctx.state !== 'running'); },
  };
}
