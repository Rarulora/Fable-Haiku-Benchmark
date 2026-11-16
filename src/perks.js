(function () {
  'use strict';
  const G = window.G;

  // ============================================================
  // Framework (CONTRACT section 7)
  // ============================================================
  const RARITY_W = { common: 50, rare: 30, epic: 16, legendary: 7 };
  const RARITY_COL = { common: '#cfd8dc', rare: '#4fc3f7', epic: '#ce93d8', legendary: '#ffd54f' };
  const KEYS = ['Space', 'F', 'R', 'C'];
  const FIRE_CAP = 24;

  const DEFS = {};
  const order = [];
  const owned = {};
  const actives = [];
  const loggedOnce = {};
  let queue = 0;
  let showing = false;

  const _v1 = new THREE.Vector3();
  const _from = new THREE.Vector3();
  const _tgt = new THREE.Vector3();
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();

  function logOnce(key, err) {
    if (loggedOnce[key]) return;
    loggedOnce[key] = true;
    try { console.error('[perks] ' + key, err); } catch (_) { /* ignore */ }
  }
  function level(id) { return owned[id] || 0; }
  function toast(text, color) {
    try { if (G.ui && G.ui.toast) G.ui.toast(text, color); } catch (e) { logOnce('toast', e); }
  }
  function vRing(p, r, c, d) { if (G.vfx && G.vfx.ring) G.vfx.ring(p, r, c, d); }
  function vBeam(a, b, c, d) { if (G.vfx && G.vfx.beam) G.vfx.beam(a, b, c, d); }
  function vLight(a, b) { if (G.vfx && G.vfx.lightning) G.vfx.lightning(a, b); }
  function vShake(a) { if (G.vfx && G.vfx.shake) G.vfx.shake(a); }
  function sfx(name, opts) { if (G.audio && G.audio.play) G.audio.play(name, opts); }
  function ensureFlags(p) { if (!p.flags) p.flags = {}; return p.flags; }
  function isPlayerBall(p) {
    return !!(p && G.player && p.team === 'player' && p.owner === G.player && p.kind === 'ball');
  }
  function applySlow(s, t, a) {
    const st = s && s.status;
    if (!st) return;
    st.slowT = Math.max(st.slowT || 0, t);
    st.slowAmt = Math.max(st.slowAmt || 0, a);
  }

  function keyFor(id) {
    for (const a of actives) if (a.id === id) return a.key;
    return actives.length < 4 ? KEYS[actives.length] : '';
  }

  function makeChoice(def) {
    const cur = owned[def.id] || 0;
    const next = cur + 1;
    return {
      id: def.id,
      name: def.name,
      icon: def.icon,
      rarity: def.rarity,
      nextLevel: next,
      maxLevel: def.maxLevel,
      desc: (def.desc && def.desc[next - 1]) || '',
      tagline: def.tagline || '',
      isNew: cur === 0,
      isActive: !!def.active,
      key: def.active ? keyFor(def.id) : ''
    };
  }
  function fallbackRepair() {
    return {
      id: '_repair', name: 'Tamir Takımı', icon: '🔧', rarity: 'common', nextLevel: 1, maxLevel: 1,
      desc: "Geminin %40'ını onar.", tagline: 'Katran, çivi ve dua.', isNew: false, isActive: false, key: ''
    };
  }
  function fallbackGold() {
    return {
      id: '_gold', name: 'Gömülü Hazine', icon: '💰', rarity: 'common', nextLevel: 1, maxLevel: 1,
      desc: '+150 altın.', tagline: 'Haritadaki çarpı işareti.', isNew: false, isActive: false, key: ''
    };
  }

  // ---------- burning sea patches (shared hazard) ----------
  let fireGeo = null;
  const fireSlots = [];
  let fireSfxT = -9;
  let fireBurnAcc = 0;

  function newFireSlot() {
    return { mesh: null, alive: false, pos: new THREE.Vector3(), r: 1, end: 0, born: 0, dps: 0, acc: 0, ph: 0 };
  }

  function spawnFirePatch(pos, radius, duration, dps) {
    if (!pos) return;
    let s = null;
    for (const q of fireSlots) if (!q.alive) { s = q; break; }
    if (!s) {
      if (fireSlots.length < FIRE_CAP) {
        s = newFireSlot();
        fireSlots.push(s);
      } else {
        for (const q of fireSlots) if (!s || q.born < s.born) s = q;   // oldest replaced
      }
    }
    if (!s.mesh && G.scene) {
      if (!fireGeo) {
        fireGeo = new THREE.CircleGeometry(1, 20);
        fireGeo.rotateX(-Math.PI / 2);
      }
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff6a00, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      s.mesh = new THREE.Mesh(fireGeo, mat);
      s.mesh.renderOrder = 4;
      G.scene.add(s.mesh);
    }
    s.alive = true;
    s.pos.copy(pos);
    s.r = radius;
    s.end = G.time + duration;
    s.born = G.time;
    s.dps = dps;
    s.acc = 0;
    s.ph = Math.random() * 6.28;
    if (s.mesh) s.mesh.visible = true;
    if (G.time - fireSfxT > 0.6) {
      fireSfxT = G.time;
      sfx('fire', { pos: s.pos, volume: 0.5 });
    }
  }

  function burnTick() {
    if (!G.combat || !G.combat.enemies) return;
    const list = G.combat.enemies();
    for (const s of fireSlots) {
      if (!s.alive) continue;
      const r2 = s.r * s.r;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e || !e.status || !e.pos) continue;
        if (G.util.dist2DSq(e.pos, s.pos) <= r2) {
          e.status.burnT = Math.max(e.status.burnT || 0, 1.2);
          e.status.burnDps = Math.max(e.status.burnDps || 0, s.dps);
        }
      }
    }
  }

  function updateFire(dt) {
    if (!fireSlots.length) return;
    const now = G.time;
    const hasOcean = !!(G.ocean && G.ocean.heightAt);
    for (const s of fireSlots) {
      if (!s.alive) continue;
      const left = s.end - now;
      if (left <= 0) {
        s.alive = false;
        if (s.mesh) s.mesh.visible = false;
        continue;
      }
      const hy = hasOcean ? G.ocean.heightAt(s.pos.x, s.pos.z) : 0;
      if (s.mesh) {
        s.mesh.position.set(s.pos.x, hy + 0.25, s.pos.z);
        s.mesh.scale.set(s.r, 1, s.r);
        s.mesh.material.opacity =
          (0.42 + 0.22 * Math.sin(now * 13 + s.ph) + 0.12 * Math.sin(now * 29 + s.ph * 2)) *
          Math.min(1, left / 0.8);
      }
      s.acc += dt;
      while (s.acc >= 0.125) {
        s.acc -= 0.125;
        const ang = Math.random() * 6.283;
        const rr = Math.sqrt(Math.random()) * s.r;
        const x = s.pos.x + Math.cos(ang) * rr;
        const z = s.pos.z + Math.sin(ang) * rr;
        _v1.set(x, hasOcean ? G.ocean.heightAt(x, z) : 0, z);
        if (G.vfx && G.vfx.fire) G.vfx.fire(_v1, 1);
      }
    }
    fireBurnAcc += dt;
    if (fireBurnAcc >= 0.5) {
      fireBurnAcc = 0;
      burnTick();
    }
  }

  function clearFire() {
    for (const s of fireSlots) {
      s.alive = false;
      if (s.mesh) s.mesh.visible = false;
    }
    fireBurnAcc = 0;
    fireSfxT = -9;
  }

  // ---------- level-up flow ----------
  function open() {
    showing = true;
    if (G.state.mode !== 'levelup') G.setMode('levelup');
    const choices = P.rollChoices(3);
    let done = false;
    const onPick = function (id) {
      if (done) return;
      done = true;
      try { P.acquire(id); } catch (e) { logOnce('acquire', e); }
      queue = Math.max(0, queue - 1);
      if (queue > 0) {
        open();
      } else {
        showing = false;
        G.setMode('playing');
      }
    };
    if (!G.ui || typeof G.ui.showLevelUp !== 'function') {
      onPick(choices[0].id);
      return;
    }
    try {
      G.ui.showLevelUp(choices, onPick);
    } catch (e) {
      logOnce('levelup-ui', e);
      onPick(choices[0].id);
    }
  }

  // ---------- public object ----------
  const P = {
    init() {
      // nothing heavy; fire meshes are created lazily
    },

    update(dt) {
      for (let i = 0; i < actives.length; i++) {
        const a = actives[i];
        if (a.cd > 0) a.cd = Math.max(0, a.cd - dt);
      }
      if (G.state.mode === 'playing') {
        for (const id in owned) {
          const def = DEFS[id];
          if (!def || !def.update) continue;
          try {
            def.update(dt, owned[id]);
          } catch (e) {
            logOnce('update:' + id, e);
          }
        }
      }
      updateFire(dt);
    },

    reset() {
      for (const k in owned) delete owned[k];
      actives.length = 0;
      P.rerollsLeft = 2;
      queue = 0;
      showing = false;
      clearFire();
      for (const id of order) {
        const def = DEFS[id];
        if (def && def.reset) {
          try { def.reset(); } catch (e) { logOnce('reset:' + id, e); }
        }
      }
    },

    DEFS: DEFS,
    order: order,

    register(def) {
      if (!def || !def.id) return;
      if (!def.maxLevel) def.maxLevel = 3;
      DEFS[def.id] = def;
      if (order.indexOf(def.id) < 0) order.push(def.id);
    },

    owned: owned,
    level: level,
    actives: actives,

    useActive(slot) {
      const a = actives[slot];
      if (!a) return false;
      if (a.cd > 0) return false;
      if (G.state.mode !== 'playing') return false;
      if (!G.player || !G.player.alive) return false;
      const lvl = owned[a.id] || 0;
      let ok = false;
      try {
        ok = !!a.def.active.use(lvl);
      } catch (e) {
        logOnce('active:' + a.id, e);
      }
      if (ok) {
        a.cdMax = a.def.active.cooldown(lvl);
        a.cd = a.cdMax;
        return true;
      }
      return false;
    },

    rollChoices(n) {
      const lvlP = G.state.level || 1;
      const pool = [];
      const w = [];
      let total = 0;
      for (const id of order) {
        const def = DEFS[id];
        if (!def) continue;
        const cur = owned[id] || 0;
        if (cur >= (def.maxLevel || 3)) continue;
        if (cur === 0 && def.active && actives.length >= 4) continue;
        let wt = RARITY_W[def.rarity] || 50;
        if (def.rarity === 'legendary' && lvlP <= 2) wt = 2;
        if (cur > 0) wt *= 1.6;
        pool.push(def);
        w.push(wt);
        total += wt;
      }
      const out = [];
      while (out.length < n && pool.length > 0) {
        let r = Math.random() * total;
        let k = 0;
        for (; k < pool.length - 1; k++) {
          if (r < w[k]) break;
          r -= w[k];
        }
        const def = pool[k];
        total -= w[k];
        pool.splice(k, 1);
        w.splice(k, 1);
        out.push(makeChoice(def));
      }
      while (out.length < n) {
        const hasRepair = out.some(function (c) { return c.id === '_repair'; });
        const hasGold = out.some(function (c) { return c.id === '_gold'; });
        if (!hasRepair) out.push(fallbackRepair());
        else if (!hasGold) out.push(fallbackGold());
        else break;
      }
      return out;
    },

    rerollsLeft: 2,

    reroll() {
      if (P.rerollsLeft > 0) {
        P.rerollsLeft--;
        return P.rollChoices(3);
      }
      return null;
    },

    acquire(id) {
      if (id === '_repair') {
        if (G.player && G.combat) G.combat.heal(G.player.stats.maxHp * 0.4);
        toast('🔧 Geminin onarıldı', '#cfd8dc');
        return;
      }
      if (id === '_gold') {
        if (G.combat) G.combat.addGold(150);
        toast('💰 +150 altın', '#ffd54f');
        return;
      }
      const def = DEFS[id];
      if (!def) return;
      const prev = owned[id] || 0;
      const lvl = Math.min(prev + 1, def.maxLevel || 3);
      owned[id] = lvl;
      if (def.active) {
        let a = null;
        for (const x of actives) if (x.id === id) { a = x; break; }
        if (!a && actives.length < 4) {
          a = { id: id, def: def, key: KEYS[actives.length], cd: 0, cdMax: 0 };
          actives.push(a);
        }
        if (a) {
          try { a.cdMax = def.active.cooldown(lvl); } catch (e) { logOnce('cd:' + id, e); }
        }
      }
      if (def.onAcquire) {
        try { def.onAcquire(lvl); } catch (e) { logOnce('onAcquire:' + id, e); }
      }
      G.emit('perk:acquired', { id: id, level: lvl, def: def });
      toast(def.icon + ' ' + def.name + ' — Seviye ' + lvl, RARITY_COL[def.rarity] || '#ffffff');
    },

    spawnFirePatch: spawnFirePatch
  };

  G.perks = P;

  G.on('player:levelup', function () {
    queue++;
    if (!showing) open();
  });

  // ============================================================
  // 1. Zincir Gülle (chainshot)
  // ============================================================
  let chainCount = 0;
  const CHAIN_T = [3, 4, 5];
  const CHAIN_A = [0.45, 0.55, 0.65];

  G.on('proj:spawn', function (e) {
    const lvl = level('chainshot');
    if (!lvl) return;
    const p = e.proj;
    if (!isPlayerBall(p)) return;
    chainCount++;
    if (lvl >= 2 || chainCount % 2 === 0) {
      ensureFlags(p).chain = true;
      p.color = 0x8899aa;
      p.scale = 1.3;
    }
  });

  G.on('proj:hit', function (e) {
    const lvl = level('chainshot');
    if (!lvl) return;
    const p = e.proj, s = e.ship;
    if (!p || !s || !p.flags || !p.flags.chain) return;
    if (!s.alive) return;
    applySlow(s, CHAIN_T[lvl - 1], CHAIN_A[lvl - 1]);
    const at = e.pos || s.pos;
    vRing(at, 2.5, 0xffffff, 0.45);
    if (lvl >= 3 && G.combat && G.combat.nearestEnemy) {
      const t = G.combat.nearestEnemy(s.pos, 28, s);
      if (!t) return;
      const storm = level('storm') > 0;
      _a.copy(s.pos); _a.y += 1.5;
      _b.copy(t.pos); _b.y += 1.5;
      if (storm) vLight(_a, _b);
      else vBeam(_a, _b, 0x9aa5b1, 0.4);
      applySlow(t, CHAIN_T[lvl - 1], CHAIN_A[lvl - 1]);
      const dmg = p.damage * (storm ? 0.75 : 0.5);
      G.combat.damageShip(t, dmg, { type: 'cannon', owner: G.player, pos: new THREE.Vector3().copy(t.pos) });
    }
  });

  G.on('ship:predamage', function (e) {
    const lvl = level('chainshot');
    if (!lvl || lvl < 2) return;
    if (!e.ship || !e.source || e.source.owner !== G.player) return;
    if (e.ship.status && e.ship.status.slowT > 0) e.amount *= 1.3;
  });

  // ============================================================
  // 2. Rum Ateşi (greekfire)
  // ============================================================
  const GF_BURN_T = [3, 4, 5];
  const GF_BURN_DPS = [4, 6, 9];
  const GF_R = [5, 6.5, 8];
  const GF_D = [4, 5, 6];
  const GF_DPS = [5, 7, 10];
  let gfPatchT = -9;

  G.on('proj:spawn', function (e) {
    const lvl = level('greekfire');
    if (!lvl) return;
    const p = e.proj;
    if (!isPlayerBall(p)) return;
    ensureFlags(p).greekfire = true;
    p.color = 0xff6a00;
  });

  G.on('proj:hit', function (e) {
    const lvl = level('greekfire');
    if (!lvl) return;
    const p = e.proj, s = e.ship;
    if (!p || !s || !p.flags || !p.flags.greekfire) return;
    const st = s.status;
    if (!st) return;
    st.burnT = Math.max(st.burnT || 0, GF_BURN_T[lvl - 1]);
    st.burnDps = Math.max(st.burnDps || 0, GF_BURN_DPS[lvl - 1]);
  });

  G.on('proj:splash', function (e) {
    const lvl = level('greekfire');
    if (!lvl) return;
    const p = e.proj;
    if (!p || !p.flags || !p.flags.greekfire) return;
    if (G.time - gfPatchT < 0.15) return;
    gfPatchT = G.time;
    spawnFirePatch(e.pos, GF_R[lvl - 1], GF_D[lvl - 1], GF_DPS[lvl - 1]);
  });

  G.on('ship:killed', function (e) {
    const lvl = level('greekfire');
    if (lvl < 3) return;
    const s = e.ship;
    if (!s || s.team !== 'enemy' || !s.status || !(s.status.burnT > 0)) return;
    s.status.burnT = 0;
    const at = new THREE.Vector3().copy(s.pos);
    if (G.combat && G.combat.explode) {
      G.combat.explode(at, 14, 30, { type: 'explosion', owner: G.player, pos: at }, 'player');
    }
    spawnFirePatch(at, 9, 6, 9);
    vShake(0.5);
  });

  // ============================================================
  // 3. Seken Gülle (ricochet)
  // ============================================================
  const BOUNCES = [1, 2, 3];

  G.on('proj:spawn', function (e) {
    const lvl = level('ricochet');
    if (!lvl) return;
    const p = e.proj;
    if (!isPlayerBall(p)) return;
    p.bounces = BOUNCES[lvl - 1];
    ensureFlags(p).rbLast = p.bounces;
  });

  function onSkip(p, f, lvl) {
    f.rbSkips = (f.rbSkips || 0) + 1;
    if (f.rbBase === undefined) f.rbBase = p.damage;
    if (lvl >= 2) p.damage = f.rbBase * (1 + 0.25 * f.rbSkips);
    vRing(p.pos, 1.5, 0xdde6ee, 0.35);
    if (lvl >= 3 && G.combat && G.combat.nearestEnemy) {
      const t = G.combat.nearestEnemy(p.pos, 45, null);
      if (t) {
        const hz = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
        const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > 0.01 && hz > 0.01) {
          p.vel.x = dx / d * hz;
          p.vel.z = dz / d * hz;
        }
      }
    }
  }

  // ============================================================
  // 4. Çifte Borda (doublebroadside)
  // ============================================================
  let inCross = false;
  let broadsideCount = 0;

  function ringVolley() {
    const P0 = G.player;
    if (!P0 || !G.combat || !G.combat.fireProjectile) return;
    const ps = P0.stats.projSpeed * 0.8;
    const dmg = P0.stats.damage * 0.6;
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI * 2 / 16;
      const sx = Math.sin(a), sz = Math.cos(a);
      G.combat.fireProjectile({
        pos: new THREE.Vector3(P0.pos.x, P0.pos.y + 1.5, P0.pos.z),
        vel: new THREE.Vector3(sx * ps, 10, sz * ps),
        team: 'player',
        owner: P0,
        kind: 'ball',
        damage: dmg,
        radius: 0.7,
        scale: 1,
        trail: true
      });
    }
    vRing(P0.pos, 6, 0xffb040, 0.6);
    vShake(0.4);
    sfx('whoosh', { pos: P0.pos });
  }

  G.on('broadside:fired', function (e) {
    const lvl = level('doublebroadside');
    if (!lvl) return;
    if (inCross || !G.player || !e || e.ship !== G.player) return;
    broadsideCount++;
    if (lvl >= 3 && broadsideCount % 4 === 0) ringVolley();
    if (lvl >= 2 && G.combat && G.combat.tryFire) {
      inCross = true;
      try {
        G.combat.tryFire(G.player, e.side === 'left' ? 'right' : 'left', null);
      } finally {
        inCross = false;
      }
    }
  });

  // ============================================================
  // 5. Av Topları (chasers)
  // ============================================================
  let swT = 0;
  const marks = new Map();     // ship -> expiry (G.time)
  const expired = [];
  let markNow = 0;

  function collectExpired(exp, ship) {
    if (exp <= markNow || !ship.alive || ship.sinking) expired.push(ship);
  }

  function fireSwivel() {
    const P0 = G.player;
    if (!P0 || !P0.alive || !G.combat || !G.combat.nearestEnemy) return;
    const t = G.combat.nearestEnemy(P0.pos, 70, null);
    if (!t || !G.combat.launchAt) return;
    _from.copy(P0.pos);
    _from.y += 3.5;
    _tgt.copy(t.pos);
    G.combat.launchAt(_from, _tgt, 110, {
      team: 'player',
      owner: P0,
      kind: 'swivel',
      damage: P0.stats.damage * 0.5,
      scale: 0.6,
      flags: { swivel: true }
    });
  }

  G.on('proj:hit', function (e) {
    const lvl = level('chasers');
    if (lvl < 3) return;
    const p = e.proj, s = e.ship;
    if (!p || !s || !p.flags || !p.flags.swivel) return;
    marks.set(s, G.time + 3);
    if (G.ships && G.ships.setTint) G.ships.setTint(s, 0xffdd33);
  });

  G.on('ship:predamage', function (e) {
    if (!level('chasers') || marks.size === 0 || !e.ship) return;
    const exp = marks.get(e.ship);
    if (exp !== undefined && exp > G.time) e.amount *= 1.25;
  });

  // ============================================================
  // 6. Yağmacı (plunderer)
  // ============================================================
  let goldTotal = 0;
  let goldSteps = 0;
  let goldenCount = 0;
  const goldHit = new WeakSet();

  G.on('proj:spawn', function (e) {
    const lvl = level('plunderer');
    if (lvl < 3) return;
    const p = e.proj;
    if (!isPlayerBall(p)) return;
    goldenCount++;
    if (goldenCount % 10 === 0) {
      ensureFlags(p).golden = true;
      p.color = 0xffd700;
      p.scale = 1.6;
      p.damage *= 3;
      p.pierce = 2;
    }
  });

  G.on('proj:hit', function (e) {
    if (level('plunderer') < 3) return;
    const p = e.proj, s = e.ship;
    if (!p || !s || !p.flags || !p.flags.golden) return;
    goldHit.add(s);
  });

  G.on('gold:gained', function (e) {
    const lvl = level('plunderer');
    if (!lvl) return;
    goldTotal += (e && e.amount) || 0;
    if (lvl < 2) return;
    if (G.player && G.player.alive && G.combat) G.combat.heal(5);
    const target = Math.floor(goldTotal / 100);
    while (goldSteps < target) {
      goldSteps++;
      if (G.player) G.player.stats.damage *= 1.03;
    }
  });

  G.on('ship:killed', function (e) {
    const lvl = level('plunderer');
    if (!lvl) return;
    const s = e.ship;
    if (!s || s.team !== 'enemy') return;
    if (G.player && G.player.alive && G.combat) G.combat.heal(3);
    if (lvl >= 3 && goldHit.has(s) && G.combat && G.combat.dropLoot) {
      G.combat.dropLoot(new THREE.Vector3().copy(s.pos), 'gold');
    }
  });

  // ============================================================
  // Perk definitions
  // ============================================================
  P.register({
    id: 'chainshot',
    name: 'Zincir Gülle',
    icon: '⛓️',
    rarity: 'rare',
    maxLevel: 3,
    desc: [
      'Her ikinci top zincir gülle olur; isabet ettiği düşmanı 3 sn %45 yavaşlatır.',
      'Her top zincir gülle olur (4 sn, %55 yavaşlatma). Yavaşlatılmış düşmanlara verilen hasar %30 artar.',
      '5 sn, %65 yavaşlatma. Zincir 28 m içindeki en yakın düşmana sıçrar: hasarın yarısını verir ve onu da yavaşlatır.'
    ],
    tagline: 'Zinciri savur, yelkenleri parçala.',
    active: null,
    reset() { chainCount = 0; }
  });

  P.register({
    id: 'greekfire',
    name: 'Rum Ateşi',
    icon: '🔥',
    rarity: 'epic',
    maxLevel: 3,
    desc: [
      'Toplar yakar: isabet eden gemi 3 sn boyunca sn başına 4 hasar alır. Suya düşen top 5 m yarıçapında 4 sn süren ateş bırakır (5 hasar/sn).',
      'Yanma 4 sn ve 6 hasar/sn. Ateş alanı 6.5 m yarıçap, 5 sn ve 7 hasar/sn olur.',
      'Yanma 5 sn ve 9 hasar/sn; ateş alanı 8 m, 6 sn ve 10 hasar/sn. Yanarken ölen düşman 14 m çapında patlar (30 hasar) ve büyük ateş bırakır.'
    ],
    tagline: 'Deniz bile yanar.',
    active: null
  });

  P.register({
    id: 'ricochet',
    name: 'Seken Gülle',
    icon: '🪨',
    rarity: 'common',
    maxLevel: 3,
    desc: [
      'Toplar suya bir kez sekerek düşer. Her sekme küçük bir şok dalgası yaratır.',
      'Toplar iki kez seker. Her sekme topun hasarını %25 artırır.',
      'Toplar üç kez seker ve her sekmede 45 m içindeki en yakın düşmana yönelir (hız korunur). Sekme hasar bonusu da sürer.'
    ],
    tagline: 'Dalgaların üstünde sektir.',
    active: null,
    update(dt, lvl) {
      const arr = G.combat && G.combat.projectiles;
      if (!arr) return;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        const f = p.flags;
        if (!f || f.rbLast === undefined) continue;
        if (p.bounces < f.rbLast) {
          const n = f.rbLast - p.bounces;
          f.rbLast = p.bounces;
          for (let k = 0; k < n; k++) onSkip(p, f, lvl);
        }
      }
    }
  });

  P.register({
    id: 'doublebroadside',
    name: 'Çifte Borda',
    icon: '💥',
    rarity: 'rare',
    maxLevel: 3,
    desc: [
      'Her borda çift salvo halinde ateşlenir.',
      'Bir yan ateşlenince diğer yan da hazırsa onunla birlikte ateşler.',
      'Ölüm Çemberi: her 4. borda, geminin etrafına 16 top saçar (her biri %60 hasar).'
    ],
    tagline: 'İki yan, tek kükreme.',
    active: null,
    onAcquire(lvl) {
      if (G.player && G.player.stats) G.player.stats.volleys = 2;
    },
    reset() { broadsideCount = 0; inCross = false; }
  });

  P.register({
    id: 'chasers',
    name: 'Av Topları',
    icon: '🎯',
    rarity: 'common',
    maxLevel: 3,
    desc: [
      'Pruvaya 2 ek top eklenir.',
      'Kıça da 2 top eklenir. Her 1.6 sn bir döner top, 70 m içindeki en yakın düşmana hızlı küçük bir mermi atar.',
      'Döner toplar 0.8 sn aralıkla ateşler. İsabet eden düşman 3 sn "İşaretli" olur ve her hasarı %25 fazla alır.'
    ],
    tagline: 'Pusuda bekleyen gözler.',
    active: null,
    onAcquire(lvl) {
      const s = G.player && G.player.stats;
      if (!s) return;
      if (lvl >= 1) s.bowCannons = 2;
      if (lvl >= 2) s.sternCannons = 2;
    },
    update(dt, lvl) {
      if (lvl >= 2 && G.player && G.player.alive) {
        swT += dt;
        const iv = lvl >= 3 ? 0.8 : 1.6;
        if (swT >= iv) {
          swT = 0;
          fireSwivel();
        }
      }
      if (marks.size > 0) {
        markNow = G.time;
        expired.length = 0;
        marks.forEach(collectExpired);
        for (let i = 0; i < expired.length; i++) {
          const s = expired[i];
          marks.delete(s);
          if (G.ships && G.ships.setTint) G.ships.setTint(s, null);
        }
      }
    },
    reset() {
      swT = 0;
      marks.clear();
      expired.length = 0;
    }
  });

  P.register({
    id: 'plunderer',
    name: 'Yağmacı',
    icon: '🏴‍☠️',
    rarity: 'common',
    maxLevel: 3,
    desc: [
      'Mıknatıs menzili 2 kat; batırdığın her düşman seni 3 can onarır.',
      'Mıknatıs 3 kat; altın toplamak 5 can onarır. Her 100 toplanan altın kalıcı %3 hasar kazandırır.',
      'Altın Gülle: her 10. top altın gülle olur (3 kat hasar, 2 delici, büyük). Bu topla öldürülen gemiler her zaman altın bırakır.'
    ],
    tagline: 'Batanın malı, bizim malımız.',
    active: null,
    onAcquire(lvl) {
      if (G.player && G.player.stats) G.player.stats.magnet = lvl >= 2 ? 3 : 2;
    },
    reset() {
      goldTotal = 0;
      goldSteps = 0;
      goldenCount = 0;
    }
  });
})();
