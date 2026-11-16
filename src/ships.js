(function () {
  'use strict';
  const G = window.G;
  const T = THREE;
  const TAU = Math.PI * 2;
  const DRAFT = -0.25;
  const GHOST_C = new T.Color(0x66ffe0);
  const GHOST_E = new T.Color(0x22ccaa);
  const CROW = { brig: 1, galleon: 1, boss: 1, ghost: 1 };

  // ---------------------------------------------------------------- DEFS
  const DEFS = {
    player: {
      name: 'Kara Bayrak', hp: 100, maxSpeed: 17, accel: 5.7, turnRate: 1.1, length: 16, width: 5, radius: 6.5,
      cannonsPerSide: 4, reloadTime: 2.4, damage: 12, projSpeed: 85, range: 120, xp: 0, gold: 0, scale: 1, masts: 2,
      colors: { hull: 0x3b2616, trim: 0xd4af37, sail: 0x111111, flag: 0x0a0a0a, deck: 0x7a5230, stripe: 0xb0122b }
    },
    sloop: {
      name: 'Şalopa', hp: 34, maxSpeed: 15, accel: 5, turnRate: 1.2, length: 12, width: 4, radius: 4.6,
      cannonsPerSide: 2, reloadTime: 3.2, damage: 5, projSpeed: 70, range: 100, xp: 10, gold: 5, scale: 1, masts: 1,
      colors: { hull: 0xc9a06a, trim: 0x8a6a40, sail: 0xf6f4ec, flag: 0xb3261e, deck: 0xe6c996 }
    },
    brig: {
      name: 'Brik', hp: 80, maxSpeed: 12, accel: 4, turnRate: 0.85, length: 18, width: 5.5, radius: 7,
      cannonsPerSide: 4, reloadTime: 3.6, damage: 6, projSpeed: 70, range: 105, xp: 22, gold: 12, scale: 1, masts: 2,
      colors: { hull: 0x1f3f78, trim: 0xd8c48a, sail: 0xf2e9cf, flag: 0x1f3f78, deck: 0xc9b08a }
    },
    galleon: {
      name: 'Kalyon', hp: 190, maxSpeed: 9, accel: 3, turnRate: 0.55, length: 26, width: 8, radius: 10.5,
      cannonsPerSide: 7, reloadTime: 4.2, damage: 7, projSpeed: 70, range: 115, xp: 50, gold: 30, scale: 1, masts: 3,
      colors: { hull: 0xa3262a, trim: 0xd4af37, sail: 0xf1e6c8, flag: 0xa3262a, deck: 0xc9a06a }
    },
    fireship: {
      name: 'Ateş Gemisi', hp: 30, maxSpeed: 20, accel: 6.7, turnRate: 1.3, length: 15, width: 4.5, radius: 5.8,
      cannonsPerSide: 0, reloadTime: 3, damage: 0, projSpeed: 40, range: 95, xp: 14, gold: 8, scale: 1, masts: 2,
      fire: true, tattered: true,
      colors: { hull: 0x1a1412, trim: 0x3a2a20, sail: 0xff7a1a, flag: 0x3a1a0a, deck: 0x2b1d15 }
    },
    mortar: {
      name: 'Havan Gemisi', hp: 60, maxSpeed: 7, accel: 2.3, turnRate: 0.6, length: 18, width: 6, radius: 7.2,
      cannonsPerSide: 2, reloadTime: 4, damage: 8, projSpeed: 45, range: 120, xp: 28, gold: 15, scale: 1, masts: 1,
      mortar: true,
      colors: { hull: 0x6b7a6a, trim: 0x4a5548, sail: 0xb8b49a, flag: 0x3d4a3d, deck: 0x8a8f7d }
    },
    boss: {
      name: 'Kara Amiral', hp: 900, maxSpeed: 6, accel: 2, turnRate: 0.45, length: 34, width: 10, radius: 13.5,
      cannonsPerSide: 10, reloadTime: 3, damage: 9, projSpeed: 70, range: 120, xp: 300, gold: 200, scale: 1, masts: 3,
      lanterns: true,
      colors: { hull: 0x0d0d10, trim: 0xd4af37, sail: 0x8a0f1c, flag: 0x8a0f1c, deck: 0x1f1b1a }
    },
    ghost: {
      name: 'Hayalet Gemi', hp: 80, maxSpeed: 12, accel: 4, turnRate: 0.85, length: 18, width: 5.5, radius: 7,
      cannonsPerSide: 4, reloadTime: 3.6, damage: 6, projSpeed: 70, range: 105, xp: 0, gold: 0, scale: 1, masts: 2,
      colors: { hull: 0x2a4a5a, trim: 0x9ff5e0, sail: 0xcfeee8, flag: 0x66ffe0, deck: 0x3d6470 }
    }
  };

  // ---------------------------------------------------------------- temps / state
  const _f = new T.Vector3(), _r = new T.Vector3();
  const _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3();
  const _va = new T.Vector3(), _vb = new T.Vector3(), _fa = new T.Vector3(), _fb = new T.Vector3();
  const _m4 = new T.Matrix4(), _eu = new T.Euler(), _bv = new T.Vector3();
  const toRemove = [];
  const pairT = new Map();
  let idSeq = 0, frameNo = 0;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function ss(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function waterH(x, z) { const o = G.ocean; return (o && o.heightAt) ? o.heightAt(x, z) : 0; }
  function ptAt(x, z, out) { out.set(x, waterH(x, z), z); return out; }
  function vcall(name, a, b, c) { const v = G.vfx; if (v && v[name]) v[name](a, b, c); }

  // ---------------------------------------------------------------- hull shape
  // t: 0 = stern .. 1 = bow ; a: 0 = gunwale .. 1 = keel ; side: +1 port (left), -1 starboard
  // Beam profile: slightly narrower stern, full beam amidships, pointed bow over the last 25%.
  function wfAt(t) {
    if (t < 0.3) return 0.85 + 0.15 * ss(0, 0.3, t);
    if (t < 0.75) return 1.0;
    const u = (t - 0.75) / 0.25;
    return Math.pow(Math.max(0, 1 - u), 0.85);
  }
  // Sheer: lowest amidships, ~15% higher at the bow, ~25% higher at the stern.
  function deckAt(t, dh) { return dh * (1 + 0.25 * (1 - ss(0.05, 0.45, t)) + 0.15 * ss(0.5, 1, t)); }
  function keelAt(t, keel) { return -keel * (0.7 + 0.3 * Math.sin(Math.PI * t)); }
  // Half-beam at depth fraction f (0 = deck edge, 1 = keel). Tumblehome: ~10% narrower at the deck than at the waterline.
  function halfAtF(t, W, f) {
    const hw = wfAt(t) * W * 0.5;
    const sn = Math.pow(clamp(f, 0, 1), 1 / 0.85);
    const cs = Math.sqrt(Math.max(0, 1 - sn * sn));
    return hw * Math.pow(cs, 0.6) * (0.9 + 0.2 * Math.min(1, 1.6 * f));
  }
  function sideXAtDepth(t, W, dh, keel, depth) {
    const span = deckAt(t, dh) - keelAt(t, keel);
    return halfAtF(t, W, depth / span);
  }

  function secPoint(L, W, dh, keel, t, a, side, o) {
    const dk = deckAt(t, dh), kl = keelAt(t, keel);
    const f = Math.pow(Math.sin(a * Math.PI * 0.5), 0.85);
    o[0] = side * halfAtF(t, W, f);
    o[1] = dk - (dk - kl) * f;
    o[2] = -L * 0.5 + t * L;
    return o;
  }

  const ST = 20;

  function hullData(L, W, dh, keel) {
    const K = 6, cols = 2 * K + 1;
    const HP = [], HI = [], tmp = [0, 0, 0];
    for (let s = 0; s < ST; s++) {
      const t = s / (ST - 1);
      for (let c = 0; c < cols; c++) {
        let side = 1, a;
        if (c <= K) { a = c / K; } else { side = -1; a = (2 * K - c) / K; }
        secPoint(L, W, dh, keel, t, a, side, tmp);
        HP.push(tmp[0], tmp[1], tmp[2]);
      }
    }
    for (let s = 0; s < ST - 1; s++) {
      for (let c = 0; c < cols - 1; c++) {
        const i00 = s * cols + c, i10 = i00 + cols;
        HI.push(i00, i10, i00 + 1, i00 + 1, i10, i10 + 1);
      }
    }
    // flat transom stern
    const ci = HP.length / 3;
    HP.push(0, (deckAt(0, dh) + keelAt(0, keel)) * 0.5, -L * 0.5);
    for (let c = 0; c < cols - 1; c++) HI.push(ci, c, c + 1);

    // deck strip
    const DP = [], DI = [];
    for (let s = 0; s < ST; s++) {
      const t = s / (ST - 1), hw = halfAtF(t, W, 0) * 0.97, dk = deckAt(t, dh) + 0.03, z = -L * 0.5 + t * L;
      DP.push(hw, dk, z, 0, dk + 0.03, z, -hw, dk, z);
    }
    for (let s = 0; s < ST - 1; s++) {
      for (let k = 0; k < 2; k++) {
        const a = s * 3 + k, b = a + 1, c = (s + 1) * 3 + k + 1, d = (s + 1) * 3 + k;
        DI.push(a, d, b, b, d, c);
      }
    }
    return { hull: { P: HP, I: HI }, deck: { P: DP, I: DI } };
  }

  // Ribbon along the hull side. aTop/aLow are heights relative to the deck line (negative = below).
  function ribbonData(L, W, dh, keel, aTop, aLow, off) {
    const P = [], I = [];
    for (const sd of [1, -1]) {
      const base = P.length / 3;
      for (let s = 0; s < ST; s++) {
        const t = s / (ST - 1), z = -L * 0.5 + t * L, dk = deckAt(t, dh), span = dk - keelAt(t, keel);
        const xt = halfAtF(t, W, clamp(-aTop / span, 0, 1)) + off;
        const xl = halfAtF(t, W, clamp(-aLow / span, 0, 1)) + off;
        P.push(sd * xt, dk + aTop, z, sd * xl, dk + aLow, z);
      }
      for (let s = 0; s < ST - 1; s++) {
        const top0 = base + s * 2, low0 = top0 + 1, top1 = top0 + 2, low1 = top0 + 3;
        I.push(top0, low0, top1, low0, low1, top1);
      }
    }
    return { P: P, I: I };
  }

  function makeGeo(P, I) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
    g.setIndex(I);
    g.computeVertexNormals();
    return g;
  }

  function mkMat(s, color, extra) {
    const p = { color: color, roughness: 0.8, metalness: 0.02, flatShading: true, side: T.DoubleSide };
    if (extra) for (const k in extra) p[k] = extra[k];
    const m = new T.MeshStandardMaterial(p);
    m.userData.base = {
      color: m.color.clone(), emissive: m.emissive.clone(), ei: m.emissiveIntensity
    };
    s.mats.push(m);
    return m;
  }

  function put(s, parent, geo, mat, x, y, z, rx, ry, rz) {
    if (s._geoms.indexOf(geo) < 0) s._geoms.push(geo);
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m);
    return m;
  }

  // ---- merge helpers: static parts are baked into one batch per material
  function newBatch() { return { P: [], I: [] }; }
  function bAddRaw(b, P, I) {
    const base = b.P.length / 3;
    for (let i = 0; i < P.length; i++) b.P.push(P[i]);
    for (let i = 0; i < I.length; i++) b.I.push(I[i] + base);
  }
  function bAddGeo(b, geo, m) {
    const pa = geo.attributes.position, base = b.P.length / 3;
    for (let k = 0; k < pa.count; k++) {
      _bv.fromBufferAttribute(pa, k).applyMatrix4(m);
      b.P.push(_bv.x, _bv.y, _bv.z);
    }
    const idx = geo.index;
    if (idx) { for (let k = 0; k < idx.count; k++) b.I.push(idx.getX(k) + base); }
    else { for (let k = 0; k < pa.count; k++) b.I.push(base + k); }
  }
  function bAdd(b, geo, x, y, z, rx, ry, rz) {
    const m = new T.Matrix4().makeRotationFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0));
    m.setPosition(x, y, z);
    bAddGeo(b, geo, m);
  }
  function addRope(b, x1, y1, z1, x2, y2, z2) {
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-3) return;
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(dx / len, dy / len, dz / len));
    const m = new T.Matrix4().compose(new T.Vector3((x1 + x2) * 0.5, (y1 + y2) * 0.5, (z1 + z2) * 0.5), q, new T.Vector3(1, 1, 1));
    bAddGeo(b, new T.CylinderGeometry(0.04, 0.04, len, 3), m);
  }
  function flushBatch(s, root, b, mat) {
    if (!b.P.length) return;
    const g = makeGeo(b.P, b.I);
    s._geoms.push(g);
    root.add(new T.Mesh(g, mat));
  }
  function paint(g, c) {
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(a, 3));
  }

  // ---------------------------------------------------------------- model
  function buildModel(s) {
    const def = s.def, col = def.colors;
    const L = def.length, W = def.width;
    const dh = clamp(L * 0.125, 1.6, 3.2);   // deck height above waterline (amidships)
    const keel = L * 0.075;                  // keel depth below waterline
    const root = new T.Group();
    root.rotation.order = 'YXZ';

    const hullM = mkMat(s, col.hull);
    const trimM = mkMat(s, col.trim);
    const deckM = mkMat(s, col.deck);
    const darkM = mkMat(s, 0x1c1c1c);
    const glowM = mkMat(s, 0x3a2a10, { emissive: 0xffcc44, emissiveIntensity: 1.2 });
    const flagM = mkMat(s, col.flag);
    const sailM = mkMat(s, 0xffffff, {
      vertexColors: true, roughness: 0.9, metalness: 0, flatShading: false,
      emissive: col.sail, emissiveIntensity: 0.18
    });
    const sailC = new T.Color(col.sail);
    const stripeC = col.stripe ? new T.Color(col.stripe) : null;
    const skullC = new T.Color(0xf4f1e6), eyeC = new T.Color(0x111111);
    const B = { hull: newBatch(), trim: newBatch(), deck: newBatch(), dark: newBatch(), glow: newBatch() };
    const winG = new T.PlaneGeometry(0.3, 0.36);

    // ---- hull, deck, gunwale trim, gunport band
    const hd = hullData(L, W, dh, keel);
    bAddRaw(B.hull, hd.hull.P, hd.hull.I);
    bAddRaw(B.deck, hd.deck.P, hd.deck.I);
    const rim = ribbonData(L, W, dh, keel, 0.16, -0.06, 0.07);
    bAddRaw(B.trim, rim.P, rim.I);
    const band = ribbonData(L, W, dh, keel, -0.22, -0.66, 0.04);
    bAddRaw(B.trim, band.P, band.I);

    // ---- deck rails along both gunwales
    const NR = 9;
    for (const sd of [1, -1]) {
      for (let k = 0; k < NR; k++) {
        const t0 = 0.06 + k * (0.88 / NR), t1 = t0 + 0.88 / NR, t = (t0 + t1) * 0.5;
        bAdd(B.deck, new T.BoxGeometry(0.06, 0.5, (t1 - t0) * L * 0.92),
          sd * (halfAtF(t, W, 0) + 0.02), deckAt(t, dh) + 0.3, -L * 0.5 + t * L);
      }
    }

    // ---- taller stern castle with railing, transom windows, stern lanterns
    const tcs = 0.1, cdS = L * 0.2, zS = -L * 0.5 + tcs * L, dkS = deckAt(tcs, dh);
    const cwS = 2 * halfAtF(tcs, W, 0) * 0.96, chS = 2.0 + L * 0.04;
    bAdd(B.hull, new T.BoxGeometry(cwS, chS, cdS), 0, dkS + chS * 0.5, zS);
    bAdd(B.trim, new T.BoxGeometry(cwS * 1.05, 0.14, cdS * 1.05), 0, dkS + chS + 0.07, zS);
    for (const sd of [1, -1]) {
      bAdd(B.deck, new T.BoxGeometry(0.05, 0.4, cdS), sd * cwS * 0.5, dkS + chS + 0.2, zS);
    }
    bAdd(B.deck, new T.BoxGeometry(cwS, 0.4, 0.05), 0, dkS + chS + 0.2, -L * 0.5);
    const nWin = def.lanterns ? 5 : 4;
    for (let i = 0; i < nWin; i++) {
      const xo = -cwS * 0.4 + i * (cwS * 0.8 / (nWin - 1));
      bAdd(B.glow, winG, xo, dkS + chS * 0.5, -L * 0.5 - 0.03, 0, Math.PI, 0);
    }
    const lr = def.lanterns ? 0.45 : 0.3;
    const lanternPts = [[-cwS * 0.5, dkS + chS * 0.85], [cwS * 0.5, dkS + chS * 0.85]];
    if (def.lanterns) lanternPts.push([-cwS * 0.5, dkS + chS * 0.35], [cwS * 0.5, dkS + chS * 0.35]);
    const lanG = new T.SphereGeometry(lr, 6, 5);
    for (const p of lanternPts) bAdd(B.glow, lanG, p[0], p[1], -L * 0.5 - 0.05);

    // ---- raised forecastle
    const tf = 0.84, dkF = deckAt(tf, dh), cwF = 2 * halfAtF(tf, W, 0) * 0.9, cdF = L * 0.16, chF = 0.9;
    bAdd(B.hull, new T.BoxGeometry(cwF, chF, cdF), 0, dkF + chF * 0.5, -L * 0.5 + tf * L);
    bAdd(B.trim, new T.BoxGeometry(cwF * 1.05, 0.12, cdF * 1.05), 0, dkF + chF + 0.06, -L * 0.5 + tf * L);

    // ---- bow figurehead block in trim color
    bAdd(B.trim, new T.BoxGeometry(0.5, 0.9, 0.5), 0, deckAt(1, dh) + 0.4, L * 0.5 + 0.05);

    // ---- rudder
    bAdd(B.deck, new T.BoxGeometry(0.12, 1.5, 0.7), 0, -0.75, -L * 0.5 - 0.1);

    // ---- bowsprit
    const bsL = L * 0.28, bsY = deckAt(1, dh) - 0.3, bsZ = L * 0.5 - 0.2;
    bAdd(B.deck, new T.CylinderGeometry(0.07, 0.12, bsL, 6),
      0, bsY + 0.34 * bsL * 0.5, bsZ + 0.94 * bsL * 0.5, Math.PI / 2 - 0.35, 0, 0);

    // ---- square gunports and cannons (muzzles stored in local space)
    const nC = def.cannonsPerSide || 0;
    const gunG = new T.BoxGeometry(0.12, 0.9, 1.0);
    const cg = new T.CylinderGeometry(0.17, 0.21, 1.3, 8);
    for (const side of ['left', 'right']) {
      const sg = side === 'left' ? 1 : -1;
      for (let i = 0; i < nC; i++) {
        const t = 0.2 + (i + 0.5) * 0.62 / nC, zt = -L * 0.5 + t * L, y = deckAt(t, dh) - 0.45;
        const hwG = sideXAtDepth(t, W, dh, keel, 0.45);
        bAdd(B.dark, gunG, sg * (hwG + 0.01), y, zt);
        bAdd(B.dark, cg, sg * (hwG + 0.6), y, zt, 0, 0, -sg * Math.PI / 2);
        s._muz[side].push(new T.Vector3(sg * (hwG + 1.25), y, zt));
      }
    }

    // ---- masts, rigging, sails, flags
    const n = def.masts || 1;
    const mastT = def.mortar ? [0.3] : (n === 1 ? [0.42] : (n === 2 ? [0.3, 0.68] : [0.22, 0.5, 0.78]));
    const mainIdx = mastT.length >= 3 ? 1 : 0;
    const mastTops = [];
    const mastGeoCache = {};

    // square sail (width along X, animated billow) with optional skull / holed (fireship) variants
    const addSail = (s2, root2, w, h, yB, zc, skull, holes) => {
      const sg = new T.PlaneGeometry(w, h, 10, 10);
      const pa = sg.attributes.position.array, uv = sg.attributes.uv, cnt = sg.attributes.position.count;
      const cArr = new Float32Array(cnt * 3);
      for (let k = 0; k < cnt; k++) {
        const u = uv.getX(k), v = uv.getY(k);
        if (def.tattered) {
          const edge = u < 0.08 || u > 0.92 || v < 0.15 || v > 0.94;
          if (edge && Math.random() < 0.7) {
            pa[k * 3] += (Math.random() - 0.5) * w * 0.12;
            pa[k * 3 + 1] += (Math.random() - 0.5) * h * 0.12;
          }
        }
        let cc = (stripeC && v > 0.42 && v < 0.58) ? stripeC : sailC;
        if (skull) {
          if (Math.hypot((u - 0.5) * w, (v - 0.78) * h) < 0.13 * w) cc = skullC;
          if (Math.hypot((u - 0.42) * w, (v - 0.8) * h) < 0.035 * w ||
              Math.hypot((u - 0.58) * w, (v - 0.8) * h) < 0.035 * w) cc = eyeC;
        }
        cArr[k * 3] = cc.r; cArr[k * 3 + 1] = cc.g; cArr[k * 3 + 2] = cc.b;
      }
      sg.setAttribute('color', new T.BufferAttribute(cArr, 3));
      if (holes) {
        const idx = sg.index.array, keep = [];
        for (let k = 0; k < idx.length; k += 3) {
          if (Math.random() < 0.22) continue;
          keep.push(idx[k], idx[k + 1], idx[k + 2]);
        }
        sg.setIndex(keep);
      }
      s2._sails.push({ geom: sg, base: Float32Array.from(pa), w: w, h: h, seed: Math.random() * 6 });
      put(s2, root2, sg, sailM, 0, yB + h * 0.5, zc + 0.15);
      bAdd(B.deck, new T.CylinderGeometry(0.1, 0.1, w + 0.8, 5), 0, yB + h + 0.05, zc + 0.12, 0, 0, Math.PI / 2);
    };

    for (let i = 0; i < mastT.length; i++) {
      const t = mastT[i], zc = -L * 0.5 + t * L, dk = deckAt(t, dh);
      const isMain = i === mainIdx;
      const mh = def.mortar ? L * 0.3 : L * (isMain ? 1.15 : 0.85);
      let mg = mastGeoCache[mh.toFixed(2)];
      if (!mg) mg = mastGeoCache[mh.toFixed(2)] = new T.CylinderGeometry(0.15, 0.22, mh, 7);
      bAdd(B.deck, mg, 0, dk + mh * 0.5, zc);
      const top = dk + mh;
      mastTops.push(top);

      // shrouds from the masthead to both gunwales
      for (const sd of [1, -1]) addRope(B.dark, sd * halfAtF(t, W, 0) * 0.95, dk + 0.2, zc, 0, top - 0.2, zc);

      const sw = W * 1.9;
      const y0 = dk + mh * 0.2, T0 = mh * 0.7, A = T0 - 0.4;
      if (def.mortar) {
        addSail(s, root, sw * 0.7, T0 * 0.9, y0, zc, false, false);
      } else {
        const courseH = 0.6 * A, topH = 0.4 * A;
        addSail(s, root, sw, courseH, y0, zc, isMain && !!stripeC, !!def.tattered);
        addSail(s, root, sw * 0.75, topH, y0 + courseH + 0.4, zc, false, !!def.tattered);
      }

      if (isMain) {
        if (CROW[s.type]) bAdd(B.deck, new T.CylinderGeometry(0.9, 0.7, 0.8, 8), 0, top - 1.2, zc);
        const fw = clamp(L * 0.14, 1.6, 3.6), fh = fw * 0.45;
        const fg = new T.PlaneGeometry(fw, fh, 8, 2);
        fg.translate(fw * 0.5, 0, 0);
        put(s, root, fg, flagM, 0, top + fh * 0.5 + 0.2, zc);
        s._flags.push({ geom: fg, base: Float32Array.from(fg.attributes.position.array), w: fw });
      }
    }

    // jib between the bowsprit and the foremast
    if (mastT.length >= 2) {
      const zF = -L * 0.5 + mastT[mastT.length - 1] * L, topF = mastTops[mastTops.length - 1];
      const dkF2 = deckAt(mastT[mastT.length - 1], dh);
      const jg = new T.BufferGeometry();
      jg.setAttribute('position', new T.Float32BufferAttribute([
        0, topF - 1.5, zF,
        0, bsY + 0.34 * bsL, bsZ + 0.94 * bsL,
        0, dkF2 + 0.3, zF
      ], 3));
      jg.computeVertexNormals();
      paint(jg, sailC);
      put(s, root, jg, sailM, 0, 0, 0);
    }

    // gaff spanker on the aft mast of 3-masters
    if (mastT.length >= 3) {
      const t0 = mastT[0], zc0 = -L * 0.5 + t0 * L, dk0 = deckAt(t0, dh), mh0 = L * 0.85;
      const spW = L * 0.4, spH = mh0 * 0.35;
      const sp = new T.PlaneGeometry(spW, spH, 4, 4);
      paint(sp, sailC);
      put(s, root, sp, sailM, 0, dk0 + mh0 * 0.3 + spH * 0.5, zc0 - L * 0.2, 0, Math.PI / 2, 0);
    }

    // mortar barrel, amidships, pointing up
    if (def.mortar) {
      bAdd(B.dark, new T.CylinderGeometry(0.6, 0.8, 2.2, 9), 0, deckAt(0.58, dh) + 1.1, -L * 0.5 + 0.58 * L);
    }

    s._deckLocal = new T.Vector3(0, deckAt(0.5, dh) + 0.6, 0);

    flushBatch(s, root, B.hull, hullM);
    flushBatch(s, root, B.trim, trimM);
    flushBatch(s, root, B.deck, deckM);
    flushBatch(s, root, B.dark, darkM);
    flushBatch(s, root, B.glow, glowM);
    s.mesh = root;
  }

  // ---------------------------------------------------------------- local -> world
  function localToWorld(s, loc, out) {
    _eu.set(s.pitch, s.yaw, s.roll, 'YXZ');
    _m4.makeRotationFromEuler(_eu);
    return out.copy(loc).applyMatrix4(_m4).add(s.pos);
  }

  function cannonPos(s, side, i, out) {
    out = out || new T.Vector3();
    const arr = side === 'left' ? s._muz.left : s._muz.right;
    const n = arr.length;
    if (!n) return out.copy(s.pos);
    return localToWorld(s, arr[clamp(i | 0, 0, n - 1)], out);
  }

  // ---------------------------------------------------------------- sail / flag animation
  function animSail(sl, t, wf) {
    const pa = sl.geom.attributes.position.array, base = sl.base, n = base.length / 3;
    const amp = sl.w * 0.12 * (0.5 + 0.5 * wf);   // parabolic bulge, ~12% of width at full wind
    const rip = sl.w * 0.01 * (0.4 + wf);
    const iw = 1 / sl.w, ih = 1 / sl.h;
    for (let i = 0; i < n; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      const u = x * iw + 0.5, v = y * ih + 0.5;
      const bulge = amp * 4 * u * (1 - u) * (0.7 + 0.3 * 4 * v * (1 - v));
      pa[i * 3 + 2] = bulge + rip * Math.sin(t * 2.2 + x * 0.6 + y * 0.4 + sl.seed);
    }
    sl.geom.attributes.position.needsUpdate = true;
    sl.geom.computeVertexNormals();
  }

  function animFlag(fl, t) {
    const pa = fl.geom.attributes.position.array, base = fl.base, n = base.length / 3, w = fl.w;
    for (let i = 0; i < n; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      const u = x / w;
      pa[i * 3 + 2] = w * 0.14 * u * Math.sin(u * 5 - t * 6.5 + y * 1.5);
    }
    fl.geom.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------------------- per-ship physics + effects
  function stepShip(s, dt, near, nearSail) {
    const st = s.status, stats = s.stats, def = s.def;
    const L = s.length, W = s.width, maxS = stats.maxSpeed;

    // status timers
    if (st.stunT > 0) st.stunT = Math.max(0, st.stunT - dt);
    if (st.slowT > 0) { st.slowT -= dt; if (st.slowT <= 0) { st.slowT = 0; st.slowAmt = 0; } }
    if (st.burnT > 0) { st.burnT -= dt; if (st.burnT <= 0) { st.burnT = 0; st.burnDps = 0; } }
    if (st.curseT > 0) st.curseT = Math.max(0, st.curseT - dt);
    if (s.dashT > 0) s.dashT = Math.max(0, s.dashT - dt);
    if (s.dashCd > 0) s.dashCd = Math.max(0, s.dashCd - dt);

    const sinking = s.sinking;
    const stunned = st.stunT > 0;
    const thr = (sinking || stunned) ? 0 : clamp(s.throttle, 0, 1);
    const rudT = (sinking || stunned) ? 0 : clamp(s.rudder, -1, 1);
    s._rud += (rudT - s._rud) * (1 - Math.exp(-4 * dt));

    // speed
    const slowF = st.slowT > 0 ? (1 - st.slowAmt) : 1;
    const dashing = s.dashT > 0;
    if (sinking) {
      s.speed *= Math.exp(-0.5 * dt);
    } else if (thr > 0) {
      const tgt = thr * maxS * slowF * (dashing ? 2.3 : 1);
      const step = stats.accel * (dashing ? 3 : 1) * dt;
      const d = tgt - s.speed;
      s.speed += Math.abs(d) <= step ? d : (d > 0 ? step : -step);
    } else {
      s.speed -= s.speed * 0.25 * dt;
    }
    const hardCap = maxS * 2.3 * slowF;
    if (s.speed > hardCap) s.speed = hardCap;
    const spd = Math.abs(s.speed);
    const spFrac = Math.min(1, spd / (maxS * 0.6));

    // turning
    s.yaw += s._rud * stats.turnRate * (0.3 + 0.7 * spFrac) * dt;
    if (s.yaw > Math.PI) s.yaw -= TAU; else if (s.yaw < -Math.PI) s.yaw += TAU;

    // movement
    G.util.fwd(s.yaw, _f);
    G.util.right(s.yaw, _r);
    s.pos.x += _f.x * s.speed * dt + s.ext.x * dt;
    s.pos.z += _f.z * s.speed * dt + s.ext.z * dt;
    s.ext.y = 0;
    const ek = Math.exp(-1.5 * dt);
    s.ext.x *= ek; s.ext.z *= ek;

    // buoyancy samples
    const px = s.pos.x, pz = s.pos.z;
    const hx = 0.4 * L, dS = Math.max(2.5, 0.45 * W);
    const hB = waterH(px + _f.x * hx, pz + _f.z * hx);
    const hS = waterH(px - _f.x * hx, pz - _f.z * hx);
    const hR = waterH(px + _r.x * dS, pz + _r.z * dS);
    const hL = waterH(px - _r.x * dS, pz - _r.z * dS);
    let tY = (hB + hS + hL + hR) * 0.25 + DRAFT;
    let tP = -Math.atan2(hB - hS, 2 * hx);   // bow higher => negative pitch (bow up)
    let tR = Math.atan2(hL - hR, 2 * dS);    // port higher => positive roll

    if (sinking) {
      if (!s._sinkInit) {
        s._sinkInit = true;
        s._sinkSide = Math.random() < 0.5 ? -1 : 1;
        s._sinkPitch = Math.random() < 0.5 ? -1 : 1;
      }
      s.sinkT += dt;
      const k = Math.min(1, s.sinkT / 1.5);
      if (s.sinkT > 1) s._sinkDown += 3 * dt;
      tR = s._sinkSide * 0.9 * k;
      tP = s._sinkPitch * 0.5 * k;
      tY -= s._sinkDown;
    } else {
      tR += s._rud * 0.12 * spFrac;          // heel outward in turns
      if (dashing) tP -= 0.06;
      else if (thr > 0 && spFrac < 0.9) tP -= 0.02 * (1 - spFrac);
      tP = clamp(tP, -0.4, 0.4);
      tR = clamp(tR, -0.55, 0.55);
    }

    // critically-damped-ish springs (bigger ships respond slower)
    const kf = 16 / Math.max(8, L);
    const kY = 18 * kf, kA = 14 * kf;
    s._vy += (kY * (tY - s.pos.y) - 5 * s._vy) * dt;
    s.pos.y += s._vy * dt;
    s._vp += (kA * (tP - s.pitch) - 4.5 * s._vp) * dt;
    s.pitch += s._vp * dt;
    s._vr += (kA * (tR - s.roll) - 4.5 * s._vr) * dt;
    s.roll += s._vr * dt;

    if (s.mesh) {
      s.mesh.position.copy(s.pos);
      s.mesh.rotation.set(s.pitch, s.yaw, s.roll);
    }

    // burn damage every 0.5 s
    if (st.burnT > 0 && s.alive && !sinking) {
      s._burnAcc += dt;
      if (s._burnAcc >= 0.5) {
        s._burnAcc -= 0.5;
        const C = G.combat;
        if (C && C.damageShip) C.damageShip(s, st.burnDps * 0.5, { type: 'fire', owner: null, pos: s.pos });
      }
    }

    // cosmetic effects
    const vis = s.mesh ? s.mesh.visible : true;
    const bowX = px + _f.x * hx, bowZ = pz + _f.z * hx;
    if (near && vis) {
      // wake
      if (!sinking && spd > 3) {
        s._wakeT -= dt;
        if (s._wakeT <= 0) {
          s._wakeT = 0.08;
          vcall('foam', ptAt(px - _f.x * 0.45 * L, pz - _f.z * 0.45 * L, _a), 1);
          vcall('foam', ptAt(bowX - _r.x * 0.5 * W, bowZ - _r.z * 0.5 * W, _b), 0.6);
          vcall('foam', ptAt(bowX + _r.x * 0.5 * W, bowZ + _r.z * 0.5 * W, _c), 0.6);
        }
      }
      // dash bow foam
      if (dashing && !sinking) {
        s._dashFoamT -= dt;
        if (s._dashFoamT <= 0) { s._dashFoamT = 0.05; vcall('foam', ptAt(bowX, bowZ, _a), 1.4); }
      }
      // bow slam
      s._slamT -= dt;
      const hBrate = s._prevHB === null ? 0 : (hB - s._prevHB) / dt;
      if (!sinking && spd > 2 && s._slamT <= 0 && (s._vp > 0.6 || hBrate > 2.5)) {
        s._slamT = 0.6;
        vcall('splash', ptAt(bowX, bowZ, _a), 0.5);
      }
      // smoke when badly damaged
      if (s.alive && !sinking && s.hp < 0.4 * stats.maxHp) {
        s._smokeT -= dt;
        if (s._smokeT <= 0) { s._smokeT = 0.35; vcall('smoke', localToWorld(s, s._deckLocal, _a), 1, 1); }
      }
      // fire: burning, badly damaged (<20%), or permanently burning ships
      const burning = st.burnT > 0;
      const lowFire = s.alive && s.hp < 0.2 * stats.maxHp;
      const selfFire = !!def.fire && s.alive;
      if (!sinking && (burning || lowFire || selfFire)) {
        s._fireT -= dt;
        if (s._fireT <= 0) {
          s._fireT = def.fire ? 0.125 : 1 / 6;
          vcall('fire', localToWorld(s, s._deckLocal, _a), 1);
        }
      }
      // sinking bubbles
      if (sinking) {
        s._bubT -= dt;
        if (s._bubT <= 0) { s._bubT = 0.25; vcall('foam', ptAt(px, pz, _a), 1.2); }
        s._sSplT -= dt;
        if (s._sSplT <= 0) { s._sSplT = 0.6; vcall('splash', ptAt(px, pz, _a), 0.3); }
      }
    }
    s._prevHB = hB;

    // sails and flags
    if (nearSail) {
      const wf = clamp(0.3 * thr + 0.7 * spd / maxS, 0, 1);
      if (((frameNo + s.id) & 1) === 0) for (let i = 0; i < s._sails.length; i++) animSail(s._sails[i], G.time, wf);
      for (let i = 0; i < s._flags.length; i++) animFlag(s._flags[i], G.time);
    }
  }

  // ---------------------------------------------------------------- ship-ship collision
  function collide(list) {
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const a = list[i];
      if (a.sinking) continue;
      for (let j = i + 1; j < n; j++) {
        const b = list[j];
        if (b.sinking) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const rr = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2);
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        const overlap = rr - d;
        const ia = 1 / (a.length * a.length), ib = 1 / (b.length * b.length);
        const fa = ia / (ia + ib), fb = 1 - fa;
        a.pos.x -= nx * overlap * fa; a.pos.z -= nz * overlap * fa;
        b.pos.x += nx * overlap * fb; b.pos.z += nz * overlap * fb;
        a.speed *= 0.92; b.speed *= 0.92;

        G.util.fwd(a.yaw, _fa); G.util.fwd(b.yaw, _fb);
        _va.set(_fa.x * a.speed + a.ext.x, 0, _fa.z * a.speed + a.ext.z);
        _vb.set(_fb.x * b.speed + b.ext.x, 0, _fb.z * b.speed + b.ext.z);
        const rel = _va.distanceTo(_vb);

        const key = a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
        const last = pairT.get(key);
        if (last === undefined || G.time - last >= 0.5) {
          if (pairT.size > 500) pairT.clear();
          pairT.set(key, G.time);
          G.emit('ship:collide', { a: a, b: b, relSpeed: rel });
        }
      }
    }
  }

  // ---------------------------------------------------------------- public API
  function dashShip(s) {
    if (!s.alive || s.sinking || s.dashCd > 0 || s.status.stunT > 0) return false;
    s.dashT = 0.9;
    s.dashCd = s.dashCdMax;
    s.speed = Math.max(s.speed, s.stats.maxSpeed * 1.2);
    G.emit('player:dash', { ship: s });
    return true;
  }

  function create(type, opts) {
    opts = opts || {};
    if (!DEFS[type]) type = 'sloop';
    const def = DEFS[type];
    const x = opts.x == null ? 0 : opts.x;
    const z = opts.z == null ? 0 : opts.z;
    const yaw = opts.yaw == null ? 0 : opts.yaw;
    const ship = {
      id: ++idSeq, type: type, def: def, team: opts.team || 'enemy',
      pos: new T.Vector3(x, 0, z), yaw: yaw, pitch: 0, roll: 0,
      speed: 0, throttle: 0, rudder: 0, ext: new T.Vector3(),
      hp: def.hp, alive: true, sinking: false, sinkT: 0,
      radius: def.radius, length: def.length, width: def.width,
      mesh: null,
      stats: {
        maxHp: def.hp, maxSpeed: def.maxSpeed, accel: def.accel, turnRate: def.turnRate,
        cannonsPerSide: def.cannonsPerSide, reloadTime: def.reloadTime, damage: def.damage,
        projSpeed: def.projSpeed, range: def.range, volleys: 1, sternCannons: 0, bowCannons: 0
      },
      reload: { left: 0, right: 0 },
      status: { slowT: 0, slowAmt: 0, stunT: 0, burnT: 0, burnDps: 0, curseT: 0, harpooned: false },
      dashT: 0, dashCd: 0, dashCdMax: 5,
      ai: {},
      isBoss: type === 'boss', isGhost: type === 'ghost',
      dash: null, cannonPos: null,
      // internals
      mats: [], _geoms: [], _sails: [], _flags: [], _muz: { left: [], right: [] }, _deckLocal: null,
      _vy: 0, _vp: 0, _vr: 0, _rud: 0, _wakeT: 0, _slamT: 0, _prevHB: null,
      _bubT: 0, _sSplT: 0, _smokeT: 0, _fireT: 0, _burnAcc: 0, _dashFoamT: 0,
      _sinkInit: false, _sinkSide: 1, _sinkPitch: 1, _sinkDown: 0,
      _dead: false, _ghostOn: false
    };
    ship.dash = function () { return dashShip(ship); };
    ship.cannonPos = function (side, i, out) { return cannonPos(ship, side, i, out); };

    buildModel(ship);
    ship.pos.y = waterH(x, z) + DRAFT;
    ship.mesh.position.copy(ship.pos);
    ship.mesh.rotation.set(0, yaw, 0);

    G.ships.list.push(ship);
    if (G.scene) G.scene.add(ship.mesh);
    if (ship.isGhost) setGhost(ship, true);
    G.emit('ship:spawned', { ship: ship });
    return ship;
  }

  function remove(ship) {
    if (!ship) return;
    const list = G.ships.list;
    const i = list.indexOf(ship);
    if (i >= 0) list.splice(i, 1);
    if (ship._dead) return;
    ship._dead = true;
    if (ship.mesh) {
      if (ship.mesh.parent) ship.mesh.parent.remove(ship.mesh);
      for (const g of ship._geoms) g.dispose();
      for (const m of ship.mats) m.dispose();
    }
    G.emit('ship:removed', { ship: ship });
  }

  function setGhost(ship, on) {
    if (!ship) return;
    ship._ghostOn = !!on;
    for (const m of ship.mats) {
      const b = m.userData.base;
      if (on) {
        m.transparent = true; m.opacity = 0.45; m.depthWrite = false;
        m.color.copy(b.color).lerp(GHOST_C, 0.6);
        m.emissive.copy(GHOST_E); m.emissiveIntensity = 0.6;
      } else {
        m.transparent = false; m.opacity = 1; m.depthWrite = true;
        m.color.copy(b.color);
        m.emissive.copy(b.emissive); m.emissiveIntensity = b.ei;
      }
      m.needsUpdate = true;
    }
  }

  function setTint(ship, hex) {
    if (!ship) return;
    for (const m of ship.mats) {
      const b = m.userData.base;
      if (hex == null) {
        if (ship._ghostOn) { m.emissive.copy(GHOST_E); m.emissiveIntensity = 0.6; }
        else { m.emissive.copy(b.emissive); m.emissiveIntensity = b.ei; }
      } else {
        m.emissive.setHex(hex); m.emissiveIntensity = 0.5;
      }
    }
  }

  function update(dt) {
    if (!(dt > 0)) return;
    frameNo++;
    const list = G.ships.list;
    const cam = G.camera;
    const hasCam = !!(cam && cam.position);
    const cx = hasCam ? cam.position.x : 0, cz = hasCam ? cam.position.z : 0;

    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      const dx = s.pos.x - cx, dz = s.pos.z - cz, d2 = dx * dx + dz * dz;
      try {
        stepShip(s, dt, !hasCam || d2 < 200 * 200, !hasCam || d2 < 220 * 220);
      } catch (e) {
        console.error('[ships] step failed', e);
      }
      if (s.sinking && s.sinkT > 4.5) {
        if (G.player === s) { if (s.mesh) s.mesh.visible = false; }
        else toRemove.push(s);
      }
    }

    try { collide(list); } catch (e) { console.error('[ships] collide failed', e); }

    for (let i = 0; i < toRemove.length; i++) remove(toRemove[i]);
    toRemove.length = 0;
  }

  function reset() {
    const list = G.ships.list;
    while (list.length) remove(list[list.length - 1]);
    pairT.clear();
    toRemove.length = 0;
  }

  G.ships = {
    init: function () { },
    update: update,
    reset: reset,
    list: [],
    DEFS: DEFS,
    create: create,
    remove: remove,
    setGhost: setGhost,
    setTint: setTint
  };
})();
