(function () {
  'use strict';
  const G = window.G;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const MAX_VOICES = 24;
  let ctx = null;
  let master = null, comp = null, sfxBus = null, ambBus = null, musBus = null, revIn = null;
  let nbuf = null;
  let oceanG = null, windG = null, windBp = null;
  let ambStarted = false;
  let stormIn = 0, stormCur = 0, ambT = 0, nextGull = 0, nextCreak = 0;
  let voiceEnds = [];
  const lastPlay = Object.create(null);
  let combo = 0, lastXpT = -10, lastHurtT = -10;
  let intensT = 0, intense = false, drumLvl = 0.5, duckVal = 0.16;

  const M = { nextT: 0, idx: 0, prog: null, mIdx: -1, shift: 0, cur: null, mul: 1 };

  // D minor pentatonic (D4 F4 G4 A4 C5 D5 F5 G5)
  const PENT = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 698.46, 783.99];
  // Chords: bass root (r) and fifth (f)
  const CH_DM = { r: 73.42, f: 110.0 };
  const CH_C = { r: 65.41, f: 98.0 };
  const CH_AM = { r: 55.0, f: 82.41 };
  const CH_F = { r: 87.31, f: 130.81 };
  const PROGS = [
    [CH_DM, CH_C, CH_DM, CH_AM],   // Dm-C-Dm-Am
    [CH_DM, CH_F, CH_C, CH_DM]     // Dm-F-C-Dm
  ];
  // 2-bar motifs (12 eighth notes): [scaleDegree, startEighth, lengthEighths]
  const MOTIFS = [
    [[0, 0, 2], [2, 2, 1], [3, 3, 3], [4, 6, 2], [3, 8, 1], [2, 9, 3]],
    [[5, 0, 3], [4, 3, 1], [3, 4, 2], [2, 6, 2], [1, 8, 1], [0, 9, 3]],
    [[0, 0, 1], [2, 1, 1], [3, 2, 2], [2, 4, 1], [1, 5, 1], [0, 6, 2], [3, 8, 2], [4, 10, 2]]
  ];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  function noiseBuf() {
    if (!nbuf) {
      const sr = ctx.sampleRate;
      nbuf = ctx.createBuffer(1, sr * 2, sr);
      const d = nbuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return nbuf;
  }

  function impulse() {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 1.8);
    const b = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return b;
  }

  // Amplitude envelope: silence -> peak (linear attack) -> exponential decay to ~0.
  function env(g, t, a, d, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    return t + a + d;
  }

  // Smooth parameter change without zipper/click (cancels queued automation first).
  function ramp(param, val, now, dur) {
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(val, now + dur);
    } catch (e) { /* ignore */ }
  }

  function sweepF(p, a, b, t0, t1) {
    p.setValueAtTime(a, t0);
    p.exponentialRampToValueAtTime(b, t1);
  }

  // Voice = bag of nodes. When all its sources have ended, the nodes are disconnected.
  function vTo(dest) {
    const g = ctx.createGain();
    g.connect(dest);
    return { nodes: [g], live: 0, in: g };
  }
  function cleanup(v) {
    for (let i = 0; i < v.nodes.length; i++) {
      try { v.nodes[i].disconnect(); } catch (e) { /* ignore */ }
    }
    v.nodes.length = 0;
  }
  function track(v, s) {
    v.live++;
    v.nodes.push(s);
    s.onended = function () { if (--v.live <= 0) cleanup(v); };
  }
  function osc(v, type, f, t0, t1, dest) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    o.connect(dest);
    o.start(t0);
    o.stop(t1);
    track(v, o);
    return o;
  }
  function noise(v, t0, t1, dest) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf();
    s.loop = true;
    s.connect(dest);
    s.start(t0, Math.random() * 1.5);
    s.stop(t1);
    track(v, s);
    return s;
  }
  function filt(v, type, f, q) {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = (q == null) ? 1 : q;
    v.nodes.push(b);
    return b;
  }
  function gain(v, val) {
    const g = ctx.createGain();
    g.gain.value = (val == null) ? 1 : val;
    v.nodes.push(g);
    return g;
  }
  // Reverb send: taps src into the shared convolver.
  function send(v, src, amt) {
    const g = gain(v, amt);
    src.connect(g);
    g.connect(revIn);
  }
  // Short pitched blip with an envelope, straight into dest.
  function chirp(v, t, f0, f1, d, peak, type) {
    const g = gain(v, 0);
    g.connect(v.in);
    const o = osc(v, type, f0, t, t + d + 0.05, g);
    sweepF(o.frequency, f0, f1, t, t + d);
    env(g, t, 0.01, d, peak);
  }

  // ---------------------------------------------------------------------------
  // Sound designs. Each takes (voice, startTime, pitch, opts) and returns its length in seconds.
  // ---------------------------------------------------------------------------
  function sCannon(v, t, p, far) {
    const vol = far ? 0.55 : 1;
    let out = v.in;
    if (far) {
      const lp = filt(v, 'lowpass', 500, 0.8);
      lp.connect(v.in);
      out = lp;
    }
    const bg = gain(v, 0);
    bg.connect(out);
    const o = osc(v, 'sine', 130 * p, t, t + 0.37, bg);
    o.frequency.exponentialRampToValueAtTime(38 * p, t + 0.35);
    env(bg, t, 0.003, 0.34, 0.95 * vol);
    send(v, bg, far ? 0.15 : 0.4);

    const ng = gain(v, 0);
    ng.connect(out);
    const lp2 = filt(v, 'lowpass', far ? 380 : 900, 0.7);
    lp2.connect(ng);
    noise(v, t, t + 0.27, lp2);
    env(ng, t, 0.004, 0.24, 0.6 * vol);

    const cg = gain(v, 0);
    cg.connect(out);
    const hp = filt(v, 'bandpass', far ? 1500 : 3200, 1.2);
    hp.connect(cg);
    noise(v, t, t + 0.02, hp);
    env(cg, t, 0.0008, 0.012, 0.35 * vol);
    return 0.4;
  }

  function sSplash(v, t, p) {
    const g = gain(v, 0);
    g.connect(v.in);
    const bp = filt(v, 'bandpass', 2500 * p, 1.4);
    bp.connect(g);
    sweepF(bp.frequency, 2500 * p, 600 * p, t, t + 0.45);
    noise(v, t, t + 0.47, bp);
    env(g, t, 0.012, 0.43, 0.7);
    for (let i = 0; i < 4; i++) {
      const tt = t + 0.12 + i * rnd(0.03, 0.06);
      const dg = gain(v, 0);
      dg.connect(v.in);
      const o = osc(v, 'sine', rnd(900, 1600) * p, tt, tt + 0.07, dg);
      o.frequency.exponentialRampToValueAtTime(rnd(1400, 2200) * p, tt + 0.05);
      env(dg, tt, 0.002, 0.06, 0.12);
    }
    return 0.5;
  }

  function sHit(v, t, p) {
    const g = gain(v, 0);
    g.connect(v.in);
    const bp = filt(v, 'bandpass', 900 * p, 4);
    bp.connect(g);
    noise(v, t, t + 0.1, bp);
    env(g, t, 0.001, 0.09, 0.9);
    const tg = gain(v, 0);
    tg.connect(v.in);
    const o = osc(v, 'sine', 180 * p, t, t + 0.16, tg);
    sweepF(o.frequency, 180 * p, 90 * p, t, t + 0.14);
    env(tg, t, 0.002, 0.14, 0.7);
    return 0.2;
  }

  function sExplosion(v, t, p) {
    const g = gain(v, 0);
    g.connect(v.in);
    send(v, g, 0.6);
    const lp = filt(v, 'lowpass', 1800, 0.8);
    lp.connect(g);
    sweepF(lp.frequency, 1800, 80, t, t + 1.1);
    noise(v, t, t + 1.15, lp);
    env(g, t, 0.005, 1.1, 1.0);

    const sg = gain(v, 0);
    sg.connect(v.in);
    send(v, sg, 0.3);
    const s = osc(v, 'sine', 55 * p, t, t + 1.1, sg);
    sweepF(s.frequency, 55 * p, 32 * p, t, t + 1.05);
    env(sg, t, 0.01, 1.0, 0.9);

    const cg = gain(v, 0);
    cg.connect(v.in);
    const hp = filt(v, 'highpass', 2500, 0.7);
    hp.connect(cg);
    noise(v, t, t + 0.25, hp);
    env(cg, t, 0.001, 0.22, 0.35);
    return 1.2;
  }

  function sSink(v, t, p) {
    const dur = 2.0;
    const g = gain(v, 0);
    g.connect(v.in);
    send(v, g, 0.35);
    const lp = filt(v, 'lowpass', 500, 2.5);
    lp.connect(g);
    lp.frequency.setValueAtTime(520, t);
    lp.frequency.linearRampToValueAtTime(220, t + dur);
    env(g, t, 0.35, 1.65, 0.2);
    // detuned saws, pitch falling: the creaking groan
    const a = osc(v, 'sawtooth', 90 * p, t, t + dur + 0.05, lp);
    a.frequency.linearRampToValueAtTime(60 * p, t + dur);
    const b = osc(v, 'sawtooth', 92 * p, t, t + dur + 0.05, lp);
    b.frequency.linearRampToValueAtTime(61.5 * p, t + dur);
    // bubbling: band-passed noise swelling + little sine blips
    const bg = gain(v, 0);
    bg.connect(v.in);
    const bp = filt(v, 'bandpass', 700, 2);
    bp.connect(bg);
    noise(v, t + 0.2, t + dur, bp);
    env(bg, t + 0.2, 0.3, 1.5, 0.07);
    for (let i = 0; i < 14; i++) {
      const tt = t + 0.25 + i * rnd(0.1, 0.16);
      if (tt > t + dur - 0.1) break;
      const bl = gain(v, 0);
      bl.connect(v.in);
      const f = rnd(300, 650) * p;
      const o = osc(v, 'sine', f, tt, tt + 0.08, bl);
      o.frequency.exponentialRampToValueAtTime(f * 1.6, tt + 0.07);
      env(bl, tt, 0.004, 0.07, 0.12);
    }
    return dur;
  }

  function sXp(v, t, p) {
    const g = gain(v, 0);
    g.connect(v.in);
    const o = osc(v, 'sine', 1300 * p, t, t + 0.09, g);
    o.frequency.exponentialRampToValueAtTime(1900 * p, t + 0.06);
    env(g, t, 0.002, 0.075, 0.3);
    const h = gain(v, 0);
    h.connect(v.in);
    osc(v, 'sine', 2600 * p, t, t + 0.07, h);
    env(h, t, 0.001, 0.06, 0.06);
    return 0.1;
  }

  function ding(v, t, f, peak, dec) {
    const g = gain(v, 0);
    g.connect(v.in);
    send(v, g, 0.25);
    osc(v, 'sine', f, t, t + dec + 0.05, g);
    env(g, t, 0.002, dec, peak);
    const h = gain(v, 0);
    h.connect(v.in);
    osc(v, 'sine', f * 2.01, t, t + dec * 0.6, h);
    env(h, t, 0.002, dec * 0.5, peak * 0.25);
  }

  function sGold(v, t, p) {
    ding(v, t, 1318.5 * p, 0.22, 0.35);
    ding(v, t + 0.075, 1975.5 * p, 0.2, 0.45);
    return 0.6;
  }

  function sLevelup(v, t, p) {
    const seq = [293.66, 369.99, 440.0, 587.33, 739.99];
    for (let i = 0; i < seq.length; i++) {
      const tt = t + i * 0.1;
      const f = seq[i] * p;
      const g = gain(v, 0);
      g.connect(v.in);
      send(v, g, 0.35);
      osc(v, 'triangle', f, tt, tt + 0.7, g);
      env(g, tt, 0.005, 0.6, 0.2);
      const og = gain(v, 0);
      og.connect(v.in);
      osc(v, 'sine', f * 2, tt, tt + 0.55, og);
      env(og, tt, 0.004, 0.5, 0.06);
    }
    const tf = t + seq.length * 0.1;
    const cg = gain(v, 0);
    cg.connect(v.in);
    send(v, cg, 0.4);
    const chord = [587.33, 739.99, 880.0];
    for (let i = 0; i < chord.length; i++) osc(v, 'triangle', chord[i] * p, tf, tf + 1.6, cg);
    env(cg, tf, 0.02, 1.5, 0.14);
    // shimmer
    const sg = gain(v, 0);
    sg.connect(v.in);
    send(v, sg, 0.6);
    const bp = filt(v, 'bandpass', 6000, 6);
    bp.connect(sg);
    noise(v, t + 0.2, t + 1.8, bp);
    env(sg, t + 0.2, 0.4, 1.2, 0.05);
    return 2.2;
  }

  function sPerk(v, t, p) {
    const lp = filt(v, 'lowpass', 800, 1.2);
    const g = gain(v, 0);
    lp.connect(g);
    g.connect(v.in);
    send(v, g, 0.6);
    lp.frequency.setValueAtTime(800, t);
    lp.frequency.exponentialRampToValueAtTime(3200, t + 0.5);
    lp.frequency.exponentialRampToValueAtTime(1100, t + 1.9);
    env(g, t, 0.35, 1.9, 0.12);
    const fr = [293.66, 349.23, 440.0, 523.25, 659.26];
    for (let i = 0; i < fr.length; i++) {
      osc(v, 'sine', fr[i] * p, t, t + 2.4, lp);
      osc(v, 'triangle', fr[i] * p * 1.004, t, t + 2.4, lp);
    }
    const spark = [1568, 2093, 2637];
    for (let i = 0; i < 3; i++) {
      const tt = t + 0.2 + i * 0.12;
      const sg = gain(v, 0);
      sg.connect(v.in);
      osc(v, 'sine', spark[i] * p, tt, tt + 0.3, sg);
      env(sg, tt, 0.002, 0.28, 0.05);
    }
    return 2.4;
  }

  function sClick(v, t, p) {
    const g = gain(v, 0);
    g.connect(v.in);
    const o = osc(v, 'sine', 1800 * p, t, t + 0.03, g);
    sweepF(o.frequency, 1800 * p, 1200 * p, t, t + 0.025);
    env(g, t, 0.001, 0.024, 0.16);
    return 0.03;
  }

  function sHover(v, t, p) {
    const g = gain(v, 0);
    g.connect(v.in);
    osc(v, 'sine', 2400 * p, t, t + 0.02, g);
    env(g, t, 0.002, 0.015, 0.05);
    return 0.02;
  }

  function sLightning(v, t, p) {
    const cg = gain(v, 0);
    cg.connect(v.in);
    send(v, cg, 0.2);
    const hp = filt(v, 'highpass', 1800, 0.7);
    hp.connect(cg);
    noise(v, t, t + 0.1, hp);
    env(cg, t, 0.001, 0.09, 1.0);
    // rolling rumble
    const rg = gain(v, 0);
    rg.connect(v.in);
    send(v, rg, 0.7);
    const lp = filt(v, 'lowpass', 320, 0.8);
    lp.connect(rg);
    sweepF(lp.frequency, 320, 70, t + 0.03, t + 1.5);
    noise(v, t + 0.03, t + 1.55, lp);
    env(rg, t + 0.03, 0.05, 1.45, 0.8);
    const sg = gain(v, 0);
    sg.connect(v.in);
    const s = osc(v, 'sine', 50 * p, t + 0.03, t + 1.55, sg);
    sweepF(s.frequency, 50 * p, 30 * p, t + 0.03, t + 1.5);
    env(sg, t + 0.03, 0.05, 1.45, 0.6);
    return 1.6;
  }

  function sHurt(v, t, p) {
    const tg = gain(v, 0);
    tg.connect(v.in);
    const o = osc(v, 'sine', 95 * p, t, t + 0.3, tg);
    sweepF(o.frequency, 95 * p, 38 * p, t, t + 0.26);
    env(tg, t, 0.003, 0.26, 0.75);
    // short dissonant stab (minor second)
    const sg = gain(v, 0);
    sg.connect(v.in);
    const lp = filt(v, 'lowpass', 1400, 0.8);
    lp.connect(sg);
    osc(v, 'sawtooth', 311 * p, t, t + 0.24, lp);
    osc(v, 'sawtooth', 330 * p, t, t + 0.24, lp);
    env(sg, t, 0.003, 0.2, 0.16);
    return 0.3;
  }

  function sDash(v, t, p) {
    const g = gain(v, 0);
    g.connect(v.in);
    send(v, g, 0.25);
    const bp = filt(v, 'bandpass', 400, 1.4);
    bp.connect(g);
    sweepF(bp.frequency, 400 * p, 2600 * p, t, t + 0.9);
    noise(v, t, t + 0.95, bp);
    env(g, t, 0.12, 0.8, 0.5);
    return 0.95;
  }

  function sWhoosh(v, t, p) {
    const g = gain(v, 0);
    g.connect(v.in);
    const bp = filt(v, 'bandpass', 600, 1.2);
    bp.connect(g);
    sweepF(bp.frequency, 600 * p, 1800 * p, t, t + 0.35);
    noise(v, t, t + 0.4, bp);
    env(g, t, 0.04, 0.3, 0.35);
    return 0.4;
  }

  function sHarpoon(v, t, p) {
    const tg = gain(v, 0);
    tg.connect(v.in);
    send(v, tg, 0.2);
    const o = osc(v, 'sine', 720 * p, t, t + 0.3, tg);
    sweepF(o.frequency, 720 * p, 500 * p, t, t + 0.25);
    osc(v, 'sine', 1450 * p, t, t + 0.2, tg); // inharmonic metallic partial
    env(tg, t, 0.001, 0.25, 0.35);
    // rope zip
    const zg = gain(v, 0);
    zg.connect(v.in);
    const bp = filt(v, 'bandpass', 1200, 6);
    bp.connect(zg);
    sweepF(bp.frequency, 1200 * p, 3000 * p, t + 0.08, t + 0.4);
    noise(v, t + 0.08, t + 0.42, bp);
    env(zg, t + 0.08, 0.05, 0.3, 0.22);
    return 0.5;
  }

  function sKraken(v, t, p) {
    const dur = 1.5;
    const g = gain(v, 0);
    g.connect(v.in);
    send(v, g, 0.45);
    const lp = filt(v, 'lowpass', 220, 1.2);
    lp.connect(g);
    lp.frequency.setValueAtTime(150, t);
    lp.frequency.linearRampToValueAtTime(300, t + 0.7);
    lp.frequency.linearRampToValueAtTime(130, t + dur);
    env(g, t, 0.15, 1.3, 0.75);
    // FM: sine modulator (1.5x carrier) drives the saw's frequency
    const modG = gain(v, 30);
    modG.gain.setValueAtTime(30, t);
    modG.gain.linearRampToValueAtTime(130, t + 0.6);
    modG.gain.linearRampToValueAtTime(40, t + dur);
    const car = osc(v, 'sawtooth', 45 * p, t, t + dur + 0.1, lp);
    osc(v, 'sine', 67.5 * p, t, t + dur + 0.1, modG);
    modG.connect(car.frequency);
    // growl noise
    const ng = gain(v, 0);
    ng.connect(v.in);
    const nl = filt(v, 'lowpass', 320, 1);
    nl.connect(ng);
    noise(v, t, t + dur + 0.05, nl);
    env(ng, t, 0.2, 1.2, 0.35);
    return dur + 0.1;
  }

  function sGhost(v, t, p) {
    const dur = 1.2;
    const g = gain(v, 0);
    g.connect(v.in);
    send(v, g, 0.6);
    const lp = filt(v, 'lowpass', 1500, 0.7);
    lp.connect(g);
    env(g, t, 0.25, 0.95, 0.16);
    // slow vibrato fading in
    const vg = gain(v, 0);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(6, t + 0.45);
    osc(v, 'sine', 5.2, t, t + dur + 0.2, vg);
    const fr = [330, 332.5, 440, 441.3, 495];
    for (let i = 0; i < fr.length; i++) {
      const o = osc(v, 'sine', fr[i] * p, t, t + dur + 0.2, lp);
      vg.connect(o.frequency);
    }
    return dur + 0.2;
  }

  function dunk(v, t, f, peak, dec) {
    const g = gain(v, 0);
    g.connect(v.in);
    send(v, g, 0.1);
    const lp = filt(v, 'lowpass', 520, 0.9);
    lp.connect(g);
    osc(v, 'sawtooth', f, t, t + dec + 0.05, lp);
    env(g, t, 0.008, dec, peak);
  }

  function sShark(v, t, p) {
    dunk(v, t, 98 * p, 0.5, 0.2);
    dunk(v, t + 0.26, 87 * p, 0.6, 0.32);
    return 0.6;
  }

  function bellAt(v, t, f, amp, dec) {
    const g = gain(v, 1);
    g.connect(v.in);
    send(v, g, 0.5);
    const parts = [[1, 1, 1], [2.76, 0.5, 0.6], [5.4, 0.3, 0.35], [8.93, 0.15, 0.2]];
    for (let i = 0; i < parts.length; i++) {
      const pt = parts[i];
      const pg = gain(v, 0);
      pg.connect(g);
      osc(v, 'sine', f * pt[0], t, t + dec * pt[2] + 0.1, pg);
      env(pg, t, 0.002, dec * pt[2], amp * pt[1]);
    }
  }

  function sBell(v, t, p) {
    bellAt(v, t, 880 * p, 0.35, 2.6);
    const hg = gain(v, 0);
    hg.connect(v.in);
    const hp = filt(v, 'highpass', 3000, 0.7);
    hp.connect(hg);
    noise(v, t, t + 0.02, hp);
    env(hg, t, 0.001, 0.012, 0.12);
    return 2.7;
  }

  function sMortar(v, t, p) {
    // descending whistle (flight)
    const wg = gain(v, 0);
    wg.connect(v.in);
    send(v, wg, 0.3);
    const w = osc(v, 'sine', 1500 * p, t, t + 1.0, wg);
    sweepF(w.frequency, 1500 * p, 260 * p, t, t + 0.95);
    env(wg, t, 0.03, 0.92, 0.14);
    // hollow thump (impact)
    const tg = gain(v, 0);
    tg.connect(v.in);
    send(v, tg, 0.3);
    const th = osc(v, 'sine', 120 * p, t + 0.8, t + 1.25, tg);
    sweepF(th.frequency, 120 * p, 55 * p, t + 0.8, t + 1.2);
    env(tg, t + 0.8, 0.005, 0.32, 0.8);
    const hg = gain(v, 0);
    hg.connect(v.in);
    const bp = filt(v, 'bandpass', 420 * p, 3);
    bp.connect(hg);
    noise(v, t + 0.8, t + 1.2, bp);
    env(hg, t + 0.8, 0.01, 0.3, 0.45);
    return 1.3;
  }

  function sWave(v, t, p) {
    const dur = 1.5;
    const g = gain(v, 0);
    g.connect(v.in);
    send(v, g, 0.35);
    const lp = filt(v, 'lowpass', 400, 0.9);
    lp.connect(g);
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(1800, t + 0.7);
    lp.frequency.exponentialRampToValueAtTime(300, t + dur);
    noise(v, t, t + dur + 0.05, lp);
    env(g, t, 0.5, 1.0, 0.8);
    // spray hiss
    const hg = gain(v, 0);
    hg.connect(v.in);
    const hp = filt(v, 'highpass', 3500, 0.6);
    hp.connect(hg);
    noise(v, t + 0.3, t + dur, hp);
    env(hg, t + 0.3, 0.4, 0.9, 0.12);
    return dur + 0.1;
  }

  function sFire(v, t, p) {
    const rg = gain(v, 0);
    rg.connect(v.in);
    const lp = filt(v, 'lowpass', 300, 0.7);
    lp.connect(rg);
    noise(v, t, t + 0.6, lp);
    env(rg, t, 0.05, 0.55, 0.25);
    for (let i = 0; i < 16; i++) {
      const tt = t + rnd(0, 0.5);
      const cg = gain(v, 0);
      cg.connect(v.in);
      const hp = filt(v, 'highpass', rnd(1200, 3000) * p, 0.8);
      hp.connect(cg);
      noise(v, tt, tt + 0.03, hp);
      env(cg, tt, 0.0008, 0.025, rnd(0.2, 0.5));
    }
    return 0.6;
  }

  function sCurse(v, t, p) {
    const cut = t + 1.0;
    const g = gain(v, 0.0001);
    g.connect(v.in);
    send(v, g, 0.5);
    // swell rising, then cut
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45, cut);
    g.gain.setValueAtTime(0.45, cut);
    g.gain.exponentialRampToValueAtTime(0.0001, cut + 0.08);
    const bp = filt(v, 'bandpass', 300, 2);
    bp.connect(g);
    sweepF(bp.frequency, 300, 1200, t, cut);
    noise(v, t, cut + 0.1, bp);
    const lp = filt(v, 'lowpass', 500, 1.5);
    lp.connect(g);
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(900, cut);
    osc(v, 'sawtooth', 146.83 * p, t, cut + 0.1, lp);
    osc(v, 'sawtooth', 207.65 * p, t, cut + 0.1, lp);
    osc(v, 'sine', 98 * p, t, cut + 0.1, g);
    return 1.2;
  }

  function sGameover(v, t, p) {
    const ph = [[293.66, 0, 0.42], [261.63, 0.42, 0.42], [233.08, 0.84, 0.45], [220.0, 1.3, 1.9]];
    for (let i = 0; i < ph.length; i++) {
      const n = ph[i];
      const tt = t + n[1];
      const g = gain(v, 0);
      g.connect(v.in);
      send(v, g, 0.45);
      osc(v, 'triangle', n[0] * p, tt, tt + n[2] + 0.1, g);
      env(g, tt, 0.02, n[2], 0.28);
    }
    return 3.3;
  }

  function sBoss(v, t, p) {
    const g = gain(v, 0);
    g.connect(v.in);
    send(v, g, 0.35);
    const lp = filt(v, 'lowpass', 200, 2);
    lp.connect(g);
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.exponentialRampToValueAtTime(1400, t + 0.18);
    lp.frequency.exponentialRampToValueAtTime(420, t + 1.1);
    env(g, t, 0.08, 1.0, 0.32);
    osc(v, 'sawtooth', 110 * p, t, t + 1.3, lp);
    osc(v, 'sawtooth', 165 * p, t, t + 1.3, lp);
    osc(v, 'sawtooth', 111.5 * p, t, t + 1.3, lp);
    bellAt(v, t + 0.05, 220 * p, 0.35, 2.4);
    return 2.5;
  }

  function softNote(v, t, f, peak, d) {
    const g = gain(v, 0);
    g.connect(v.in);
    send(v, g, 0.3);
    osc(v, 'triangle', f, t, t + d + 0.05, g);
    env(g, t, 0.02, d, peak);
  }
  function sHeal(v, t, p) {
    softNote(v, t, 523.25 * p, 0.15, 0.6);
    softNote(v, t + 0.1, 659.26 * p, 0.15, 0.9);
    return 1.0;
  }

  // Ambient-only one-offs (also reachable via play)
  function sGull(v, t, p) {
    chirp(v, t, 1900 * p, 1400 * p, 0.14, 0.12, 'sine');
    chirp(v, t + 0.18, 2000 * p, 1300 * p, 0.16, 0.1, 'sine');
    return 0.4;
  }

  const SFX = {
    cannon: function (v, t, p) { return sCannon(v, t, p, false); },
    cannon_far: function (v, t, p) { return sCannon(v, t, p, true); },
    splash: sSplash,
    hit: sHit,
    explosion: sExplosion,
    sink: sSink,
    xp: sXp,
    gold: sGold,
    levelup: sLevelup,
    perk: sPerk,
    click: sClick,
    hover: sHover,
    lightning: sLightning,
    hurt: sHurt,
    dash: sDash,
    whoosh: sWhoosh,
    harpoon: sHarpoon,
    kraken: sKraken,
    ghost: sGhost,
    shark: sShark,
    bell: sBell,
    mortar: sMortar,
    wave: sWave,
    fire: sFire,
    curse: sCurse,
    gameover: sGameover,
    boss: sBoss,
    heal: sHeal,
    gull: sGull
  };

  // ---------------------------------------------------------------------------
  // Play (voice limit, rate limit, attenuation, panning, pitch jitter)
  // ---------------------------------------------------------------------------
  function play(name, opts) {
    try {
      if (!ctx || ctx.state !== 'running' || G.audio.muted) return;
      const fn = SFX[name];
      if (!fn) return;
      opts = opts || {};
      const now = ctx.currentTime;

      const last = lastPlay[name];
      if (last !== undefined && now - last < 0.04) return;

      let live = 0;
      for (let i = voiceEnds.length - 1; i >= 0; i--) {
        if (voiceEnds[i] < now) voiceEnds.splice(i, 1); else live++;
      }
      if (live >= MAX_VOICES) return;

      let att = 1, pan = 0;
      if (opts.pos && G.camera && G.camera.position) {
        const cp = G.camera.position, ps = opts.pos;
        const dx = ps.x - cp.x, dy = ps.y - cp.y, dz = ps.z - cp.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const d = Math.sqrt(d2);
        att = 1 / (1 + d2 / 3600); // 1/(1+(d/60)^2)
        const e = G.camera.matrixWorld.elements; // column 0 = camera right axis
        const rx = dx * e[0] + dy * e[1] + dz * e[2];
        pan = clamp(rx / (d + 6), -0.9, 0.9);
      }
      if (att < 0.003) return;

      lastPlay[name] = now;
      const p = (opts.pitch || 1) * (1 + (Math.random() * 2 - 1) * 0.06);
      const vol = (opts.volume == null ? 1 : opts.volume) * att;
      const t = now + 0.005;

      const v = { nodes: [], live: 0, in: null };
      const vg = ctx.createGain();
      vg.gain.value = vol;
      v.nodes.push(vg);
      v.in = vg;
      if (pan !== 0 && ctx.createStereoPanner) {
        const sp = ctx.createStereoPanner();
        sp.pan.value = pan;
        vg.connect(sp);
        sp.connect(sfxBus);
        v.nodes.push(sp);
      } else {
        vg.connect(sfxBus);
      }
      const dur = fn(v, t, p, opts) || 0.5;
      voiceEnds.push(t + dur);
    } catch (e) { /* audio must never break the game */ }
  }

  function isFar(pos, dist) {
    const c = G.camera && G.camera.position;
    if (!c) return false;
    const dx = pos.x - c.x, dy = pos.y - c.y, dz = pos.z - c.z;
    return dx * dx + dy * dy + dz * dz > dist * dist;
  }

  // ---------------------------------------------------------------------------
  // Graph
  // ---------------------------------------------------------------------------
  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    nbuf = null;

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;

    master = ctx.createGain();
    master.gain.value = G.audio.muted ? 0 : 0.7;
    master.connect(comp);
    comp.connect(ctx.destination);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);

    ambBus = ctx.createGain();
    ambBus.gain.value = 0.55;
    ambBus.connect(master);

    musBus = ctx.createGain();
    musBus.gain.value = 0.16;
    musBus.connect(master);
    duckVal = 0.16;

    // shared reverb (generated impulse)
    const conv = ctx.createConvolver();
    conv.buffer = impulse();
    revIn = ctx.createGain();
    revIn.gain.value = 1;
    const revOut = ctx.createGain();
    revOut.gain.value = 0.5;
    revIn.connect(conv);
    conv.connect(revOut);
    revOut.connect(master);
  }

  // ---------------------------------------------------------------------------
  // Ambient: ocean wash, wind, seagulls, hull creaks
  // ---------------------------------------------------------------------------
  function startAmbient() {
    if (ambStarted) return;
    ambStarted = true;

    // ocean wash: looped noise -> lowpass ~500 Hz, LFO on cutoff and level (period ~7 s)
    const ocS = ctx.createBufferSource();
    ocS.buffer = noiseBuf();
    ocS.loop = true;
    ocS.start(0, Math.random() * 1.5);
    const oceanLp = ctx.createBiquadFilter();
    oceanLp.type = 'lowpass';
    oceanLp.frequency.value = 500;
    oceanLp.Q.value = 0.8;
    oceanG = ctx.createGain();
    oceanG.gain.value = 0.3;
    ocS.connect(oceanLp);
    oceanLp.connect(oceanG);
    oceanG.connect(ambBus);

    const l1 = ctx.createOscillator();
    l1.frequency.value = 1 / 7;
    const l1g = ctx.createGain();
    l1g.gain.value = 260;
    l1.connect(l1g);
    l1g.connect(oceanLp.frequency);
    l1.start(0);

    const l2 = ctx.createOscillator();
    l2.frequency.value = 1 / 7.3;
    const l2g = ctx.createGain();
    l2g.gain.value = 0.12;
    l2.connect(l2g);
    l2g.connect(oceanG.gain);
    l2.start(0);

    // wind layer
    const wS = ctx.createBufferSource();
    wS.buffer = noiseBuf();
    wS.loop = true;
    wS.start(0, Math.random() * 1.5);
    windBp = ctx.createBiquadFilter();
    windBp.type = 'bandpass';
    windBp.frequency.value = 700;
    windBp.Q.value = 0.6;
    windG = ctx.createGain();
    windG.gain.value = 0.05;
    wS.connect(windBp);
    windBp.connect(windG);
    windG.connect(ambBus);

    const now = ctx.currentTime;
    nextGull = now + rnd(4, 9);
    nextCreak = now + rnd(3, 6);
  }

  function ambientUpdate(dt, now) {
    ambT -= dt;
    if (ambT <= 0) {
      ambT = 0.5;
      let s = stormIn;
      try {
        if (G.ocean && typeof G.ocean.storm === 'number') s = Math.max(s, G.ocean.storm);
      } catch (e) { /* ignore */ }
      stormCur = clamp(s, 0, 1);
      const r = rnd(0.85, 1.15);
      ramp(windG.gain, (0.05 + 0.28 * stormCur) * r, now, 0.5);
      ramp(windBp.frequency, 600 + 500 * stormCur + rnd(-120, 120), now, 0.6);
      ramp(oceanG.gain, 0.3 + 0.22 * stormCur, now, 0.6);
    }
    if (now >= nextGull) {
      if (stormCur < 0.3) gullVoice(now);
      nextGull = now + rnd(8, 20);
    }
    if (now >= nextCreak) {
      creak(now);
      nextCreak = now + rnd(6, 14);
    }
  }

  function gullVoice(now) {
    const v = vTo(ambBus);
    v.nodes[0].gain.value = 0.35;
    sGull(v, now + 0.05, rnd(0.95, 1.05));
  }

  function creak(now) {
    const v = vTo(ambBus);
    v.nodes[0].gain.value = 0.7;
    const t = now + 0.02;
    const dur = rnd(0.9, 1.4);
    const g = gain(v, 0);
    g.connect(v.in);
    const lp = filt(v, 'lowpass', 320, 1);
    lp.connect(g);
    const f = rnd(70, 100);
    const o = osc(v, 'triangle', f, t, t + dur + 0.05, lp);
    o.frequency.linearRampToValueAtTime(f * rnd(1.1, 1.3), t + dur * 0.4);
    o.frequency.linearRampToValueAtTime(f * rnd(0.95, 1.05), t + dur);
    env(g, t, 0.25, dur - 0.25, rnd(0.07, 0.12));
  }

  // ---------------------------------------------------------------------------
  // Music: generative 6/8 sea shanty in D minor, look-ahead scheduler
  // ---------------------------------------------------------------------------
  function pickMotif() {
    M.mIdx = (M.mIdx + 1 + Math.floor(Math.random() * 2)) % 3;
    M.cur = MOTIFS[M.mIdx];
    const r = Math.random();
    M.shift = r < 0.55 ? 0 : (r < 0.8 ? 1 : -1);
  }

  function bass(t, f, dur, peak) {
    const v = vTo(musBus);
    const g = gain(v, 0);
    g.connect(v.in);
    osc(v, 'triangle', f, t, t + dur + 0.1, g);
    env(g, t, 0.01, dur * 0.9, peak);
  }

  function pluck(t, f, dur, peak) {
    const v = vTo(musBus);
    const g = gain(v, 0);
    g.connect(v.in);
    const lp = filt(v, 'lowpass', 3000, 1.5);
    lp.connect(g);
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + Math.min(0.5, dur));
    osc(v, 'sawtooth', f, t, t + dur + 0.12, lp);
    env(g, t, 0.004, dur * 0.9 + 0.1, peak);
  }

  function thump(t, lvl) {
    const v = vTo(musBus);
    const g = gain(v, 0);
    g.connect(v.in);
    const o = osc(v, 'sine', 120, t, t + 0.3, g);
    sweepF(o.frequency, 120, 45, t, t + 0.22);
    env(g, t, 0.004, 0.24, 0.9 * lvl);
  }

  function tick(t, lvl) {
    const v = vTo(musBus);
    const g = gain(v, 0);
    g.connect(v.in);
    const hp = filt(v, 'highpass', 6000, 0.8);
    hp.connect(g);
    noise(v, t, t + 0.03, hp);
    env(g, t, 0.001, 0.02, 0.18 * lvl);
  }

  // eighth-note index i (6 per bar, 2 beats = dotted quarters, 6/8)
  function schedEighth(t, i, e) {
    const pos6 = i % 6;
    const bar = (i - pos6) / 6;
    if (pos6 === 0 && bar % 4 === 0) M.prog = PROGS[Math.random() < 0.5 ? 0 : 1];
    if (!M.prog) M.prog = PROGS[0];
    const ch = M.prog[bar % 4];

    if (pos6 === 0) {
      bass(t, ch.r, e * 2.8, 0.5);
      thump(t, drumLvl);
    } else if (pos6 === 3) {
      bass(t, ch.f, e * 2.8, 0.3);
      thump(t, drumLvl * 0.8);
    } else {
      tick(t, drumLvl);
    }

    const p12 = i % 12;
    if (p12 === 0) pickMotif();
    const cur = M.cur;
    if (cur) {
      for (let k = 0; k < cur.length; k++) {
        const n = cur[k];
        if (n[1] !== p12) continue;
        if (Math.random() < 0.08) continue; // occasional breath
        const deg = clamp(n[0] + M.shift, 0, PENT.length - 1);
        pluck(t, PENT[deg], n[2] * e * 0.95, 0.3);
      }
    }
  }

  function eighthDur() { return 60 / (96 * M.mul) / 3; }

  function computeIntense() {
    let n = 0, boss = false;
    try { if (G.combat && G.combat.enemies) n = G.combat.enemies().length; } catch (e) { /* ignore */ }
    try {
      const L = G.ships && G.ships.list;
      if (L) {
        for (let i = 0; i < L.length; i++) {
          const s = L[i];
          if (s.isBoss && s.alive && !s.sinking) { boss = true; break; }
        }
      }
    } catch (e) { /* ignore */ }
    return n > 4 || boss;
  }

  function musicUpdate(dt, now) {
    intensT -= dt;
    if (intensT <= 0) {
      intensT = 0.5;
      intense = computeIntense();
    }
    const drumTarget = intense ? 1 : 0.45;
    drumLvl += (drumTarget - drumLvl) * Math.min(1, dt * 1.5);
    M.mul = intense ? 1.08 : 1;

    let duck = 0.16;
    const mode = G.state ? G.state.mode : 'playing';
    if (mode === 'menu') duck = 0.11;
    else if (mode === 'paused' || mode === 'levelup') duck = 0.064; // 40%
    if (Math.abs(duck - duckVal) > 0.0001) {
      duckVal = duck;
      ramp(musBus.gain, duck, now, 0.4);
    }

    if (M.nextT < now) M.nextT = now + 0.02;
    while (M.nextT < now + 0.2) {
      const e = eighthDur();
      schedEighth(M.nextT, M.idx, e);
      M.nextT += e;
      M.idx++;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function setMuted(b) {
    G.audio.muted = !!b;
    if (!ctx || !master) return;
    ramp(master.gain, b ? 0 : 0.7, ctx.currentTime, 0.06);
  }

  function unlock() {
    try {
      if (!ctx) {
        try {
          build();
        } catch (e) {
          ctx = null;
          return;
        }
        M.nextT = ctx.currentTime + 0.1;
        M.idx = 0;
        startAmbient();
      }
      if (ctx.state === 'suspended' && ctx.resume) {
        const pr = ctx.resume();
        if (pr && pr.catch) pr.catch(function () { /* ignore */ });
      }
    } catch (e) { /* ignore */ }
  }

  G.audio = {
    muted: false,
    init: function () { /* context is created lazily in unlock() */ },
    update: function (dt) {
      if (!ctx) return;
      try {
        const now = ctx.currentTime;
        ambientUpdate(dt, now);
        musicUpdate(dt, now);
      } catch (e) { /* ignore */ }
    },
    reset: function () {
      combo = 0;
      lastXpT = -10;
      lastHurtT = -10;
    },
    unlock: unlock,
    play: play,
    setMuted: setMuted,
    setStorm: function (x) {
      const n = Number(x);
      stormIn = clamp(isFinite(n) ? n : 0, 0, 1);
    }
  };

  // ---------------------------------------------------------------------------
  // Event subscriptions (handlers are no-ops before unlock because play() guards ctx)
  // ---------------------------------------------------------------------------
  G.on('broadside:fired', function (e) {
    if (!ctx || !e || !e.ship || !e.ship.pos) return;
    const ship = e.ship;
    const name = isFar(ship.pos, 140) ? 'cannon_far' : 'cannon';
    play(name, { pos: ship.pos });
    const count = e.count || 1;
    if (count > 1) {
      const extra = Math.random() < 0.5 ? 1 : 2;
      for (let i = 0; i < extra; i++) {
        const pp = ship.pos.clone();
        const delay = rnd(60, 140) + i * rnd(40, 70);
        setTimeout(function () {
          play(name, { pos: pp, volume: 0.45, pitch: 0.92 });
        }, delay);
      }
    }
  });

  G.on('proj:hit', function (e) {
    if (ctx && e && e.pos) play('hit', { pos: e.pos });
  });

  G.on('proj:splash', function (e) {
    if (ctx && e && e.pos) play('splash', { pos: e.pos, volume: 0.5 });
  });

  G.on('ship:killed', function (e) {
    if (!ctx || !e || !e.ship || !e.ship.pos) return;
    play('explosion', { pos: e.ship.pos });
    play('sink', { pos: e.ship.pos });
  });

  G.on('ship:damaged', function (e) {
    if (!ctx || !e || e.ship !== G.player || !(e.amount > 0)) return;
    const now = ctx.currentTime;
    if (now - lastHurtT < 0.25) return;
    lastHurtT = now;
    play('hurt');
  });

  G.on('xp:gained', function () {
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - lastXpT > 0.6) combo = 0;
    lastXpT = now;
    combo++;
    play('xp', { pitch: 1 + Math.min(combo - 1, 14) * 0.05, volume: 0.8 });
  });

  G.on('gold:gained', function () { if (ctx) play('gold', { volume: 0.8 }); });
  G.on('player:levelup', function () { if (ctx) play('levelup'); });
  G.on('perk:acquired', function () { if (ctx) play('perk'); });
  G.on('boss:spawned', function () { if (ctx) play('boss'); });
  G.on('player:dash', function () { if (ctx) play('dash'); });
  G.on('player:healed', function () { if (ctx) play('heal'); });
  G.on('wave:started', function () { if (ctx) play('bell', { volume: 0.7 }); });
  G.on('game:over', function () { if (ctx) play('gameover'); });
})();
