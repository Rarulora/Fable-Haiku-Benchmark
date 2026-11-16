/* perks2.js - Kara Bayrak: Kraken, Hayalet Filo, Kopekbaligi Surusu, Lanetli Gulleler, Olu Adamin Sandigi, Firtina Cagiran */
(function(){
'use strict';
const G = window.G;

const TA = new THREE.Vector3();
const TB = new THREE.Vector3();
const TC = new THREE.Vector3();
const TAU = Math.PI * 2;

/* ---------- shared helpers ---------- */
function lvlOf(id){ return G.perks ? G.perks.level(id) : 0; }
function isLive(s){ return !!(s && s.alive && !s.sinking && s.pos); }
function liveP(){ return isLive(G.player) ? G.player : null; }
function heightAt(x, z){ return G.ocean ? G.ocean.heightAt(x, z) : 0; }
function splash(p, s){ if (G.vfx && G.vfx.splash) G.vfx.splash(p, s); }
function shake(a){ if (G.vfx && G.vfx.shake) G.vfx.shake(a); }
function puff(p, s){ if (G.vfx && G.vfx.ghostPuff) G.vfx.ghostPuff(p, s); }
function ring(p, r, c, d){ if (G.vfx && G.vfx.ring) G.vfx.ring(p, r, c, d); }
function ripple(x, z, s){ if (G.ocean && G.ocean.addRipple) G.ocean.addRipple(x, z, s); }
function sfx(name, pos){ if (G.audio && G.audio.play) G.audio.play(name, pos ? { pos: pos } : undefined); }
function toast(t, c){ if (G.ui && G.ui.toast) G.ui.toast(t, c); }
function banner(a, b){ if (G.ui && G.ui.banner) G.ui.banner(a, b); }

/* ======================================================================
   1. KRAKEN - "Kraken'in Cagrisi"
   ====================================================================== */
const KR = { cd: 0, grabs: [], pool: [], geos: null, mat: null };
const KR_SEGS = 8, KR_LEN = 2.2, KR_RISE = 0.5, KR_RELEASE = 2.7, KR_END = 3.7;
const KR_CD = [0, 9, 7.5, 6];
const KR_DPS = [0, 14, 20, 28];

function krInit(){
  if (KR.geos) return;
  const dark = new THREE.Color(0x3b0d26);
  const pale = new THREE.Color(0xc77a84);
  KR.geos = [];
  for (let i = 0; i < KR_SEGS; i++){
    // taper: base radius 1.3 m down to 0.25 m at the tip
    const rBot = 1.3 - 1.05 * (i / KR_SEGS);
    const rTop = 1.3 - 1.05 * ((i + 1) / KR_SEGS);
    const geo = new THREE.CylinderGeometry(rTop, rBot, KR_LEN, 7, 1, false);
    geo.translate(0, KR_LEN / 2, 0);
    const nrm = geo.attributes.normal;
    const n = nrm.count;
    const col = new Float32Array(n * 3);
    for (let v = 0; v < n; v++){
      // two-tone: pale underside stripe facing the hull
      const c = nrm.getZ(v) > 0.35 ? pale : dark;
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    KR.geos.push(geo);
  }
  KR.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.05 });
  KR.suckerGeo = new THREE.SphereGeometry(0.16, 5, 4);
  KR.suckerMat = new THREE.MeshStandardMaterial({ color: 0xe0a0a8, roughness: 0.5, flatShading: true });
}

function krMakeTent(){
  krInit();
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const segs = [];
  let parent = root;
  for (let i = 0; i < KR_SEGS; i++){
    const seg = new THREE.Group();
    seg.rotation.order = 'YXZ';
    if (i > 0) seg.position.y = KR_LEN;
    seg.add(new THREE.Mesh(KR.geos[i], KR.mat));
    // paler sucker bumps along the hull-facing side
    const r = 1.3 - 1.05 * ((i + 0.5) / KR_SEGS);
    for (let k = 0; k < 2; k++){
      const sk = new THREE.Mesh(KR.suckerGeo, KR.suckerMat);
      sk.position.set(0, KR_LEN * (0.3 + 0.35 * k), r * 0.95);
      seg.add(sk);
    }
    parent.add(seg);
    segs.push(seg);
    parent = seg;
  }
  return { root: root, segs: segs, inUse: false, grab: null, ang: 0, radius: 4, phase: 0, delay: 0, splashed: false };
}

function krAcquire(){
  let t = null;
  for (const x of KR.pool) if (!x.inUse){ t = x; break; }
  if (!t){
    if (KR.pool.length >= 10) return null;
    t = krMakeTent();
    KR.pool.push(t);
  }
  t.inUse = true;
  if (!t.root.parent && G.scene) G.scene.add(t.root);
  return t;
}

function krRelease(t){
  t.inUse = false;
  t.grab = null;
  if (t.root.parent) t.root.parent.remove(t.root);
}

function krHeld(s){
  for (const g of KR.grabs) if (g.ship === s) return true;
  return false;
}

function krPose(t, g){
  const gt = g.t;
  const tt = gt - t.delay;           // staggered emergence (0.15 s apart)
  const cx = g.pos.x, cz = g.pos.z;
  const bx = cx + Math.cos(t.ang) * t.radius;
  const bz = cz + Math.sin(t.ang) * t.radius;
  let e;
  if (tt < 0) e = 0;
  else if (tt < KR_RISE){ const u = tt / KR_RISE; e = u * u * (3 - 2 * u); }
  else if (gt < KR_RELEASE) e = 1;
  else e = 1 - G.util.clamp((gt - KR_RELEASE) / (KR_END - KR_RELEASE), 0, 1);
  const holding = tt >= KR_RISE && gt < KR_RELEASE;
  const pulse = holding ? Math.sin(gt * 9 + t.phase) : 0;
  const time = G.time;
  if (!t.splashed && tt >= 0){
    t.splashed = true;
    TA.set(bx, heightAt(bx, bz), bz);
    splash(TA, 1.5);
  }
  t.root.scale.setScalar(g.size);
  t.root.position.set(bx, heightAt(bx, bz) - 6 + 4.5 * e, bz);
  t.root.rotation.y = Math.atan2(cx - bx, cz - bz);
  for (let i = 0; i < KR_SEGS; i++){
    const s = t.segs[i];
    // arch outward first, then curl inward over the hull
    const base = (i === 0 ? -0.12 : 0.2) * e;
    s.rotation.x = base + (holding ? 0.06 * pulse : 0) + 0.04 * Math.sin(time * 2.2 + i * 0.8 + t.phase);
    s.rotation.z = 0.1 * Math.sin(time * 1.7 + i * 0.5 + t.phase) * ((i + 1) / KR_SEGS);
    const thick = 1 + (holding ? 0.12 * pulse : 0);
    s.scale.set(thick, 1, thick);
  }
}

function krTryGrab(lvl){
  const p = liveP();
  if (!p){ KR.cd = 1; return; }
  const want = lvl >= 3 ? 2 : 1;
  const picks = [];
  const list = G.combat.enemies();
  for (let k = 0; k < want; k++){
    let best = null, bestScore = -1;
    for (const s of list){
      if (!isLive(s) || picks.indexOf(s) >= 0 || krHeld(s)) continue;
      if (G.util.dist2D(s.pos, p.pos) > 110) continue;
      const score = (s.isBoss ? 0 : 1e6) + (s.hp || 0);
      if (score > bestScore){ best = s; bestScore = score; }
    }
    if (!best) break;
    picks.push(best);
  }
  if (!picks.length){ KR.cd = 1; return; }
  KR.cd = KR_CD[lvl];
  const count = lvl >= 3 ? 5 : 3;
  for (const s of picks){
    const len = (s.length || 16);
    const g = { ship: s, pos: s.pos.clone(), t: 0, tick: 0, debrisT: 0, released: false, tents: [], size: G.util.clamp(len / 16, 1, 1.9) };
    const base = Math.random() * TAU;
    for (let k = 0; k < count; k++){
      const t = krAcquire();
      if (!t) break;
      t.grab = g;
      t.ang = base + k * TAU / count + G.util.rand(-0.25, 0.25);
      t.radius = G.util.rand(4.5, 6.5) * g.size;
      t.phase = Math.random() * TAU;
      t.delay = k * 0.15;
      t.splashed = false;
      g.tents.push(t);
    }
    KR.grabs.push(g);
    for (let k = 0; k < 3; k++){
      const x = g.pos.x + G.util.rand(-4, 4), z = g.pos.z + G.util.rand(-4, 4);
      TA.set(x, heightAt(x, z), z);
      splash(TA, 2.2);
    }
    ripple(g.pos.x, g.pos.z, 1.5);
    sfx('kraken', g.pos);
    shake(0.4);
  }
}

function krUpdate(dt, lvl){
  KR.cd -= dt;
  if (KR.cd <= 0) krTryGrab(lvl);
  for (let i = KR.grabs.length - 1; i >= 0; i--){
    const g = KR.grabs[i];
    g.t += dt;
    if (g.ship){
      if (isLive(g.ship)) g.pos.copy(g.ship.pos);
      else { g.ship = null; if (g.t < KR_RELEASE) g.t = KR_RELEASE; }
    }
    if (g.ship && g.t >= KR_RISE && g.t < KR_RELEASE){
      g.ship.status.stunT = Math.max(g.ship.status.stunT, 0.3);
      g.debrisT += dt;
      if (g.debrisT >= 0.4){
        g.debrisT -= 0.4;
        if (G.vfx && G.vfx.debris) G.vfx.debris(g.pos, 6);
      }
      g.tick += dt;
      while (g.tick >= 0.25 && isLive(g.ship)){
        g.tick -= 0.25;
        G.combat.damageShip(g.ship, KR_DPS[lvl] * 0.25, { type: 'kraken', owner: G.player, pos: g.pos });
      }
    }
    if (!g.released && g.t >= KR_RELEASE){
      g.released = true;
      splash(g.pos, 1.5);
      shake(0.5);
      if (lvl >= 3){
        G.combat.explode(g.pos.clone(), 18, 25, { type: 'kraken', owner: G.player, pos: g.pos.clone() }, 'player');
      }
    }
    if (g.t >= KR_END){
      for (const t of g.tents) krRelease(t);
      KR.grabs.splice(i, 1);
      continue;
    }
    for (const t of g.tents) krPose(t, g);
  }
}

function krReset(){
  for (const t of KR.pool) krRelease(t);
  KR.grabs.length = 0;
  KR.cd = 0;
}

G.on('ship:killed', ({ ship }) => {
  const lvl = G.perks.level('kraken'); if (!lvl) return;
  for (const g of KR.grabs){
    if (g.ship !== ship) continue;
    g.ship = null;
    if (lvl >= 2){
      splash(g.pos, 3);
      ripple(g.pos.x, g.pos.z, 2.5);
      shake(0.6);
      G.combat.dropXP(g.pos.clone(), ((ship.def && ship.def.xp) || 0) * 0.5);
      if (g.t < KR_RELEASE) g.t = KR_RELEASE;
    }
    break;
  }
});

G.on('ship:removed', ({ ship }) => {
  const lvl = G.perks.level('kraken'); if (!lvl) return;
  for (const g of KR.grabs) if (g.ship === ship) g.ship = null;
});

/* ======================================================================
   2. GHOSTFLEET - "Hayalet Filo"
   ====================================================================== */
const GF = { pending: [], ghosts: [], dutchT: 45 };
const GF_CHANCE = [0, 0.35, 0.5, 0.65];
const GF_CAP = [0, 2, 3, 4];
const GF_LIFE = [0, 16, 20, 26];

function gfFind(ship){
  for (const e of GF.ghosts) if (e.ship === ship) return e;
  return null;
}

function gfCount(){
  let n = 0;
  for (const e of GF.ghosts) if (!e.dutch && isLive(e.ship)) n++;
  return n;
}

function gfCreate(x, z, life, lvl, dutch){
  let s = G.combat.spawnAlly('ghost', x, z, life) || null;
  if (!s && G.ships && G.ships.list){
    for (let i = G.ships.list.length - 1; i >= 0; i--){
      const c = G.ships.list[i];
      if (c.isGhost && c.team === 'ally' && !gfFind(c)){ s = c; break; }
    }
  }
  if (!s) return null;
  GF.ghosts.push({ ship: s, dutch: dutch, det: false });
  if (G.player && G.player.stats) s.stats.damage = G.player.stats.damage * (lvl >= 3 ? 0.9 : 0.6);
  puff(s.pos, 3);
  ring(s.pos, 8, 0x66ffff, 1.2);
  sfx('ghost', s.pos);
  return s;
}

function gfDutch(lvl){
  const p = liveP();
  if (!p || !G.util) return;
  G.util.right(p.yaw, TA);
  const s = gfCreate(p.pos.x + TA.x * 20, p.pos.z + TA.z * 20, 90, lvl, true);
  if (!s) return;
  s.hp *= 3;
  s.stats.maxHp *= 3;
  s.stats.cannonsPerSide += 3;
  if (s.mesh) s.mesh.scale.multiplyScalar(1.5);
  banner('UÇAN HOLLANDALI', 'Ölüler senin için savaşıyor');
}

function gfDetonate(e, pos){
  e.det = true;
  const c = pos.clone();
  G.combat.explode(c.clone(), 14, 30, { type: 'curse', owner: G.player, pos: c.clone() }, 'player');
  puff(c, 3);
}

function gfUpdate(dt, lvl){
  for (let i = GF.pending.length - 1; i >= 0; i--){
    const q = GF.pending[i];
    q.t -= dt;
    if (q.t <= 0){
      GF.pending.splice(i, 1);
      if (gfCount() < GF_CAP[lvl]) gfCreate(q.x, q.z, GF_LIFE[lvl], lvl, false);
    }
  }
  for (let i = GF.ghosts.length - 1; i >= 0; i--){
    const e = GF.ghosts[i];
    const s = e.ship;
    if (!isLive(s)){
      if (lvl >= 2 && !e.det && s) gfDetonate(e, s.pos);
      GF.ghosts.splice(i, 1);
    }
  }
  if (lvl >= 3){
    GF.dutchT -= dt;
    if (GF.dutchT <= 0){ GF.dutchT = 45; gfDutch(lvl); }
  }
}

function gfReset(){
  GF.pending.length = 0;
  GF.ghosts.length = 0;
  GF.dutchT = 45;
}

G.on('ship:killed', ({ ship, source }) => {
  const lvl = G.perks.level('ghostfleet'); if (!lvl) return;
  if (!ship) return;
  const e = gfFind(ship);
  if (e){
    if (lvl >= 2 && !e.det) gfDetonate(e, ship.pos);
    return;
  }
  if (ship.team !== 'enemy' || ship.isBoss || ship.isGhost) return;
  if (source && source.type === 'expiry') return;
  if (Math.random() < GF_CHANCE[lvl]) GF.pending.push({ x: ship.pos.x, z: ship.pos.z, t: 1.2 });
});

G.on('ship:removed', ({ ship }) => {
  const lvl = G.perks.level('ghostfleet'); if (!lvl) return;
  for (let i = GF.ghosts.length - 1; i >= 0; i--) if (GF.ghosts[i].ship === ship) GF.ghosts.splice(i, 1);
});

/* ======================================================================
   3. SHARKS - "Kopekbaligi Surusu"
   ====================================================================== */
const SK = { pool: [], finGeo: null, finMat: null, bodyGeo: null, bodyMat: null };
const SK_CAP = 14;
const SK_COUNT = [0, 2, 3, 4];
const SK_DMG = [0, 14, 18, 24];
const SK_BITES = [0, 2, 3, 4];
const SK_SPEED = 24, SK_RANGE = 150, SK_LIFE = 14;

// Triangular fin in the YZ plane: 2 m long (Z), 2.6 m tall (Y), thin along X.
function skFinShape(len, height, sweep){
  const sh = new THREE.Shape();
  sh.moveTo(-len / 2, 0);
  sh.lineTo(len / 2, 0);
  sh.lineTo(-len / 2 + sweep, height);
  sh.lineTo(-len / 2, 0);
  return sh;
}

function skInit(){
  if (SK.finGeo) return;
  const extr = { depth: 0.18, bevelEnabled: false, steps: 1 };
  // dorsal fin, 2.6 m tall, 2 m long
  SK.finGeo = new THREE.ExtrudeGeometry(skFinShape(2.0, 2.6, 1.2), extr);
  SK.finGeo.translate(0, 0, -0.09);
  SK.finGeo.rotateY(Math.PI / 2);
  // lighter edge: same fin slightly larger, behind the dark plate
  SK.edgeGeo = new THREE.ExtrudeGeometry(skFinShape(2.1, 2.7, 1.25), extr);
  SK.edgeGeo.translate(0, 0, -0.09);
  SK.edgeGeo.rotateY(Math.PI / 2);
  // tail fin, smaller, 3.5 m behind the dorsal
  SK.tailGeo = new THREE.ExtrudeGeometry(skFinShape(1.2, 1.4, 0.3), extr);
  SK.tailGeo.translate(0, 0, -0.09);
  SK.tailGeo.rotateY(Math.PI / 2);
  SK.finMat = new THREE.MeshStandardMaterial({ color: 0x2c3a46, flatShading: true, roughness: 0.7, side: THREE.DoubleSide });
  SK.edgeMat = new THREE.MeshStandardMaterial({ color: 0x8fa3b0, flatShading: true, roughness: 0.6, side: THREE.DoubleSide });
  // 7 m long flattened ellipsoid body just under the surface
  SK.bodyGeo = new THREE.SphereGeometry(1, 12, 8);
  SK.bodyMat = new THREE.MeshBasicMaterial({ color: 0x0c2a3a, transparent: true, opacity: 0.55, depthWrite: false });
  SK.wakeScale = 0.6;
}

function skMake(){
  skInit();
  const grp = new THREE.Group();
  grp.rotation.order = 'YXZ';
  const fin = new THREE.Mesh(SK.finGeo, SK.finMat);
  fin.position.set(0, -0.2, 0);
  const edge = new THREE.Mesh(SK.edgeGeo, SK.edgeMat);
  edge.position.set(0, -0.2, -0.04);
  const tail = new THREE.Mesh(SK.tailGeo, SK.finMat);
  tail.position.set(0, -0.2, -3.5);
  const body = new THREE.Mesh(SK.bodyGeo, SK.bodyMat);
  body.position.set(0, -0.6, 0);
  body.scale.set(1.3, 0.45, 3.5);
  grp.add(body);
  grp.add(edge);
  grp.add(fin);
  grp.add(tail);
  return {
    grp: grp, fin: fin, active: false, x: 0, z: 0, yaw: 0, life: 0,
    bitesMax: 2, bitesDone: 0, dmg: 14, mult: 1, state: 'hunt', target: null,
    retargetT: 0, circleT: 0, circleA: 0, idleT: 0, wakeT: 0, diveT: 0, breachT: 0
  };
}

function skAcquire(){
  for (const s of SK.pool) if (!s.active) return s;
  if (SK.pool.length >= SK_CAP) return null;
  const s = skMake();
  SK.pool.push(s);
  return s;
}

function skSpawn(ship, lvl){
  const n = SK_COUNT[lvl];
  for (let k = 0; k < n; k++){
    const s = skAcquire();
    if (!s) break;
    s.active = true;
    s.x = ship.pos.x + G.util.rand(-2, 2);
    s.z = ship.pos.z + G.util.rand(-2, 2);
    s.yaw = Math.random() * TAU;
    s.life = SK_LIFE;
    s.bitesMax = SK_BITES[lvl];
    s.bitesDone = 0;
    s.dmg = SK_DMG[lvl];
    s.mult = 1;
    s.state = 'hunt';
    s.target = null;
    s.retargetT = 0; s.circleT = 0; s.circleA = 0; s.idleT = 0; s.wakeT = 0; s.diveT = 0; s.breachT = 0;
    s.fin.visible = true;
    s.grp.position.set(s.x, heightAt(s.x, s.z), s.z);
    s.grp.rotation.y = s.yaw;
    if (G.scene) G.scene.add(s.grp);
  }
}

function skRelease(s){
  s.active = false;
  s.state = 'hunt';
  s.target = null;
  if (s.grp.parent) s.grp.parent.remove(s.grp);
}

function skDive(s){
  s.state = 'dive';
  s.diveT = 1.2;
  s.target = null;
}

function skSteer(s, tx, tz, rate, dt){
  const want = Math.atan2(tx - s.x, tz - s.z);
  const diff = G.util.angDiff(s.yaw, want);
  const m = rate * dt;
  s.yaw += G.util.clamp(diff, -m, m);
}

function skMove(s, speed, dt){
  s.x += Math.sin(s.yaw) * speed * dt;
  s.z += Math.cos(s.yaw) * speed * dt;
}

function skBite(s, lvl){
  const t = s.target;
  const dmg = s.dmg * s.mult;
  G.combat.damageShip(t, dmg, { type: 'shark', owner: G.player, pos: t.pos });
  TA.set(t.pos.x, heightAt(t.pos.x, t.pos.z), t.pos.z);
  splash(TA, 1.2);
  if (G.vfx && G.vfx.hitNumber) G.vfx.hitNumber(TA, '-' + Math.round(dmg), '#ff3b3b');
  sfx('shark', TA);
  s.breachT = 0.4;   // body arcs ~3 m out of the water
  s.bitesDone++;
  if (lvl >= 2 && t.status){
    t.status.slowT = Math.max(t.status.slowT, 2);
    t.status.slowAmt = Math.max(t.status.slowAmt, 0.3);
  }
  const killed = !t.alive;
  if (killed && lvl >= 3){
    s.bitesDone = 0;
    s.life = SK_LIFE;
    s.mult = Math.min(3, s.mult + 0.5);
    s.target = null;
    s.state = 'hunt';
    ring(TA, 6, 0xff2222, 0.8);
    return;
  }
  if (s.bitesDone >= s.bitesMax){ skDive(s); return; }
  s.state = 'circle';
  s.circleT = 0.8;
  s.circleA = Math.atan2(s.z - t.pos.z, s.x - t.pos.x);
}

function skUpdate(dt, lvl){
  for (const s of SK.pool){
    if (!s.active) continue;
    if (s.state === 'dive'){
      s.diveT -= dt;
      if (s.diveT <= 0){ skRelease(s); continue; }
      const k = s.diveT / 1.2;
      s.grp.position.set(s.x, heightAt(s.x, s.z) - (1 - k) * 1.8, s.z);
      s.fin.visible = k > 0.5;
      continue;
    }
    s.life -= dt;
    if (s.life <= 0){ skDive(s); continue; }
    if (s.target && !isLive(s.target)) s.target = null;

    if (s.state === 'circle'){
      if (!s.target){
        s.state = 'hunt';
      } else {
        s.circleT -= dt;
        if (s.circleT <= 0){
          s.state = 'hunt';
        } else {
          s.circleA += 1.3 * dt;
          const cx = s.target.pos.x + Math.cos(s.circleA) * 14;
          const cz = s.target.pos.z + Math.sin(s.circleA) * 14;
          skSteer(s, cx, cz, 2.2, dt);
          skMove(s, 20, dt);
        }
      }
    }

    if (s.state === 'hunt'){
      s.retargetT -= dt;
      if (s.retargetT <= 0 || !s.target){
        s.retargetT = 0.5;
        TA.set(s.x, 0, s.z);
        s.target = G.combat.nearestEnemy(TA, SK_RANGE, null);
      }
      if (!s.target){
        s.idleT += dt;
        if (s.idleT > 3){ skDive(s); continue; }
        skMove(s, SK_SPEED * 0.5, dt);
      } else {
        s.idleT = 0;
        const t = s.target;
        skSteer(s, t.pos.x, t.pos.z, 2.2, dt);
        skMove(s, SK_SPEED, dt);
        const dx = t.pos.x - s.x, dz = t.pos.z - s.z;
        const r = (t.radius || 6) + 1.5;
        if (dx * dx + dz * dz <= r * r){
          skBite(s, lvl);
          if (s.state === 'dive') continue;
        }
      }
    }

    // V-shaped wake: foam on both sides of the stern every 0.08 s
    s.wakeT -= dt;
    if (s.wakeT <= 0){
      s.wakeT = 0.08;
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      const rx = -fz, rz = fx; // starboard right vector (contract: right = (-cos, 0, sin))
      for (let side = -1; side <= 1; side += 2){
        const wx = s.x - fx * 4 + rx * 2.5 * side;
        const wz = s.z - fz * 4 + rz * 2.5 * side;
        TA.set(wx, heightAt(wx, wz), wz);
        if (G.vfx && G.vfx.foam) G.vfx.foam(TA, SK.wakeScale);
      }
    }
    // breach: body arcs ~3 m above the water for 0.4 s after a bite
    let lift = 0;
    if (s.breachT > 0){
      s.breachT = Math.max(0, s.breachT - dt);
      lift = Math.sin((1 - s.breachT / 0.4) * Math.PI) * 3;
    }
    s.grp.position.set(s.x, heightAt(s.x, s.z) + lift, s.z);
    s.grp.rotation.y = s.yaw;
    s.grp.rotation.x = -lift * 0.12;
  }
}

function skReset(){
  for (const s of SK.pool) skRelease(s);
}

G.on('ship:killed', ({ ship }) => {
  const lvl = G.perks.level('sharks'); if (!lvl) return;
  if (!ship || ship.team !== 'enemy') return;
  skSpawn(ship, lvl);
});

G.on('ship:removed', ({ ship }) => {
  const lvl = G.perks.level('sharks'); if (!lvl) return;
  for (const s of SK.pool) if (s.target === ship) s.target = null;
});

/* ======================================================================
   4. CURSE - "Lanetli Gulleler"
   ====================================================================== */
const CU = { map: new Map(), souls: 0, consumeT: 0, consumeN: 0, wisps: [], geo: null, mat: null };
const CU_MAX = [0, 5, 6, 8];
const CU_DUR = 6;

function cuAdd(ship, n, lvl){
  if (!lvl || !isLive(ship)) return;
  let e = CU.map.get(ship);
  if (!e){
    e = { stacks: 0, t: 0, puffT: 0, dotT: 0 };
    CU.map.set(ship, e);
    if (G.ships && G.ships.setTint) G.ships.setTint(ship, 0x9933ff);
  }
  const before = e.stacks;
  e.stacks = Math.min(CU_MAX[lvl], e.stacks + n);
  e.t = CU_DUR;
  ship.status.curseT = e.t;
  if (e.stacks > before) ring(ship.pos, 5 + e.stacks, 0x9933ff, 0.6);
}

function cuWisp(pos){
  let w = null;
  for (const x of CU.wisps) if (!x.active){ w = x; break; }
  if (!w){
    if (CU.wisps.length >= 24) return;
    if (!CU.geo){
      CU.geo = new THREE.SphereGeometry(0.7, 8, 6);
      CU.mat = new THREE.MeshBasicMaterial({ color: 0xc77dff, transparent: true, opacity: 0.9 });
    }
    w = { mesh: new THREE.Mesh(CU.geo, CU.mat), active: false, from: new THREE.Vector3(), t: 0 };
    CU.wisps.push(w);
  }
  w.active = true;
  w.t = 0;
  w.from.copy(pos);
  w.mesh.position.copy(pos);
  if (G.scene) G.scene.add(w.mesh);
}

function cuWispEnd(w){
  w.active = false;
  if (w.mesh.parent) w.mesh.parent.remove(w.mesh);
}

function cuUpdate(dt, lvl){
  for (const [ship, e] of CU.map){
    if (!ship.alive){ CU.map.delete(ship); continue; }
    e.t -= dt;
    if (e.t <= 0){
      CU.map.delete(ship);
      if (G.ships && G.ships.setTint) G.ships.setTint(ship, null);
      ship.status.curseT = 0;
      continue;
    }
    ship.status.curseT = e.t;
    e.puffT -= dt;
    if (e.puffT <= 0){
      e.puffT = 0.3;
      // rising wisps at mast height, more of them with more stacks
      TA.set(ship.pos.x + G.util.rand(-1.5, 1.5), ship.pos.y + 9, ship.pos.z + G.util.rand(-1.5, 1.5));
      puff(TA, 0.5 + 0.1 * e.stacks);
    }
    if (lvl >= 2 && e.stacks >= CU_MAX[lvl]){
      e.dotT += dt;
      if (e.dotT >= 0.5){
        e.dotT -= 0.5;
        G.combat.damageShip(ship, 3 * e.stacks * 0.5, { type: 'curse', owner: G.player, pos: ship.pos });
      }
    }
  }
  if (CU.consumeT > 0){
    CU.consumeT -= dt;
    if (CU.consumeT <= 0){
      CU.consumeT = 0;
      CU.souls = Math.max(0, CU.souls - CU.consumeN);
      CU.consumeN = 0;
    }
  }
  for (const w of CU.wisps){
    if (!w.active) continue;
    w.t += dt;
    const p = liveP();
    if (!p || w.t > 2.5){ cuWispEnd(w); continue; }
    const u = Math.min(1, w.t / 1.0);
    TB.set(p.pos.x, p.pos.y + 3, p.pos.z);
    w.mesh.position.lerpVectors(w.from, TB, u);
    w.mesh.position.y += Math.sin(u * Math.PI) * 4;
    if (u >= 1){
      cuWispEnd(w);
      if (G.combat && G.combat.heal) G.combat.heal(4);
      CU.souls = Math.min(10, CU.souls + 1);
    }
  }
}

function cuReset(){
  CU.map.clear();
  CU.souls = 0;
  CU.consumeT = 0;
  CU.consumeN = 0;
  for (const w of CU.wisps) cuWispEnd(w);
}

G.on('proj:hit', ({ proj, ship }) => {
  const lvl = G.perks.level('curse'); if (!lvl) return;
  if (!proj || !proj.owner || proj.owner !== G.player) return;
  if (!ship || !G.util.hostile(G.player, ship)) return;
  cuAdd(ship, 1, lvl);
});

G.on('ship:killed', ({ ship }) => {
  const lvl = G.perks.level('curse'); if (!lvl) return;
  const e = ship ? CU.map.get(ship) : null;
  if (!e) return;
  CU.map.delete(ship);
  if (G.ships && G.ships.setTint) G.ships.setTint(ship, null);
  ship.status.curseT = 0;
  const stacks = Math.max(1, e.stacks);
  const pos = ship.pos.clone();
  const radius = 12 + 2 * stacks;
  ring(pos, radius, 0x9933ff, 1.0);
  sfx('curse', pos);
  G.combat.explode(pos.clone(), radius, 12 * stacks, { type: 'curse', owner: G.player, pos: pos.clone() }, 'player');
  for (const s of G.combat.enemies()){
    if (G.util.dist2D(s.pos, pos) <= radius) cuAdd(s, 2, lvl);
  }
  if (lvl >= 3) cuWisp(pos);
});

G.on('ship:removed', ({ ship }) => {
  const lvl = G.perks.level('curse'); if (!lvl) return;
  CU.map.delete(ship);
});

G.on('ship:predamage', (e) => {
  const lvl = G.perks.level('curse'); if (!lvl) return;
  if (lvl < 2) return;
  if (!e.ship || e.ship !== G.player || !e.source || !e.source.owner) return;
  const c = CU.map.get(e.source.owner);
  if (!c) return;
  e.amount *= Math.max(0.2, 1 - 0.08 * c.stacks);
});

G.on('proj:spawn', ({ proj }) => {
  const lvl = G.perks.level('curse'); if (!lvl) return;
  if (lvl < 3) return;
  if (!proj || proj.owner !== G.player || CU.souls <= 0) return;
  proj.damage *= 1 + 0.1 * Math.min(10, CU.souls);
});

G.on('broadside:fired', ({ ship }) => {
  const lvl = G.perks.level('curse'); if (!lvl) return;
  if (lvl < 3) return;
  if (ship !== G.player || CU.souls <= 0) return;
  CU.consumeT = 0.5;
  CU.consumeN = CU.souls;
});

/* ======================================================================
   5. DEADMANSCHEST - "Olu Adamin Sandigi"
   ====================================================================== */
const DM = { charge: 0, inited: false, ghostT: 0, boost: false, kills: 0, regenT: 0, prevSpeed: 0 };
const DM_HP = [0, 0.5, 0.75, 1.0];
const DM_T = [0, 5, 6, 8];

function dmReset(){
  DM.charge = 0;
  DM.inited = false;
  DM.ghostT = 0;
  DM.boost = false;
  DM.kills = 0;
  DM.regenT = 0;
  DM.prevSpeed = 0;
}

function dmUpdate(dt, lvl){
  const p = G.player;
  if (p && p.alive && typeof p.speed === 'number') DM.prevSpeed = p.speed;
  if (DM.ghostT > 0){
    DM.ghostT -= dt;
    if (DM.ghostT <= 0){
      DM.ghostT = 0;
      if (DM.boost && p && p.stats) p.stats.maxSpeed /= 1.35;
      DM.boost = false;
      if (p && G.ships && G.ships.setGhost) G.ships.setGhost(p, false);
    }
  }
  if (lvl >= 3 && DM.charge > 0 && p && p.alive && p.hp < p.stats.maxHp){
    DM.regenT += dt;
    if (DM.regenT >= 1){
      DM.regenT -= 1;
      p.hp = Math.min(p.stats.maxHp, p.hp + 1);
    }
  } else {
    DM.regenT = 0;
  }
}

G.on('ship:prekill', (e) => {
  const lvl = G.perks.level('deadmanschest'); if (!lvl) return;
  const p = G.player;
  if (!p || e.ship !== p || e.cancel || DM.charge <= 0) return;
  e.cancel = true;
  DM.charge -= 1;
  DM.kills = 0;
  p.hp = p.stats.maxHp * DM_HP[lvl];
  DM.ghostT = DM_T[lvl];
  if (!DM.boost && p.stats){ p.stats.maxSpeed *= 1.35; DM.boost = true; }
  if (G.ships && G.ships.setGhost) G.ships.setGhost(p, true);
  const c = p.pos.clone();
  G.combat.explode(c.clone(), 40, 60, { type: 'curse', owner: p, pos: c.clone() }, 'player');
  ring(c, 40, 0x66ffe0, 1.2);
  puff(c, 4);
  sfx('ghost', c);
  banner('ÖLÜM SENİ REDDETTİ', 'Hayalet formu!');
  shake(1.2);
  ripple(c.x, c.z, 2.5);
});

G.on('ship:predamage', (e) => {
  const lvl = G.perks.level('deadmanschest'); if (!lvl) return;
  if (DM.ghostT > 0 && e.ship === G.player) e.cancel = true;
});

G.on('ship:collide', ({ a, b }) => {
  const lvl = G.perks.level('deadmanschest'); if (!lvl) return;
  const p = G.player;
  if (!p || DM.ghostT <= 0 || lvl < 2) return;
  if (a !== p && b !== p) return;
  const o = a === p ? b : a;
  if (!isLive(o) || !G.util.hostile(p, o)) return;
  G.combat.damageShip(o, 40, { type: 'ram', owner: p, pos: o.pos });
  if (DM.prevSpeed > p.speed) p.speed = DM.prevSpeed;
});

G.on('ship:killed', ({ ship }) => {
  const lvl = G.perks.level('deadmanschest'); if (!lvl) return;
  if (lvl < 3 || DM.charge > 0 || !ship || ship.team !== 'enemy') return;
  DM.kills++;
  if (DM.kills >= 20){
    DM.charge = 1;
    DM.kills = 0;
    toast('Sandık yeniden doldu!', '#66ffe0');
  }
});

/* ======================================================================
   6. STORM - "Firtina Cagiran"
   ====================================================================== */
const ST = { boltT: 0, bolts: 0, armed: false, eyeT: 0, ringT: 0, reapplyT: 0 };
const ST_STORM = [0, 0.45, 0.65, 0.85];
const ST_RAIN = [0, 0.4, 0.6, 0.8];
const ST_INT = [0, 3.2, 2.6, 2.0];
const ST_DMG = [0, 26, 34, 44];

function stEye(p){
  for (const s of G.combat.enemies()){
    if (G.util.dist2D(s.pos, p.pos) <= 30){
      s.status.slowT = Math.max(s.status.slowT, 0.5);
      s.status.slowAmt = Math.max(s.status.slowAmt, 0.35);
    }
  }
}

function stStrike(p, lvl){
  const cands = [];
  for (const s of G.combat.enemies()){
    if (isLive(s) && G.util.dist2D(s.pos, p.pos) <= 95) cands.push(s);
  }
  if (!cands.length) return false;
  const target = G.util.pick(cands);
  ST.bolts++;
  const mega = lvl >= 3 && ST.bolts % 4 === 0;
  const base = ST_DMG[lvl];
  const tx = target.pos.x, tz = target.pos.z;
  TA.set(tx + G.util.rand(-20, 20), heightAt(tx, tz) + 140, tz + G.util.rand(-20, 20));
  TB.set(tx, heightAt(tx, tz), tz);
  if (G.vfx && G.vfx.lightning) G.vfx.lightning(TA, TB);
  sfx('lightning', TB);
  ripple(tx, tz, 0.6);
  target.status.stunT = Math.max(target.status.stunT, 0.6);
  const dmg = mega ? base * 2.5 : base;
  TC.set(tx, 3, tz);
  if (G.vfx && G.vfx.hitNumber) G.vfx.hitNumber(TC, '-' + Math.round(dmg), '#9fe3ff');
  G.combat.damageShip(target, dmg, { type: 'lightning', owner: p, pos: target.pos });
  if (mega){
    G.combat.explode(new THREE.Vector3(tx, 0, tz), 12, 20, { type: 'lightning', owner: p, pos: new THREE.Vector3(tx, 0, tz) }, 'player');
    shake(0.7);
  }
  if (lvl >= 2){
    const hit = new Set([target]);
    let px = tx, pz = tz;
    for (let k = 0; k < 2; k++){
      TC.set(px, 0, pz);
      const nx = G.combat.nearestEnemy(TC, 30, hit);
      if (!nx) break;
      hit.add(nx);
      TA.set(px, 12, pz);
      TB.set(nx.pos.x, 12, nx.pos.z);
      if (G.vfx && G.vfx.lightning) G.vfx.lightning(TA, TB);
      G.combat.damageShip(nx, base * 0.6, { type: 'lightning', owner: p, pos: nx.pos });
      ripple(nx.pos.x, nx.pos.z, 0.4);
      px = nx.pos.x;
      pz = nx.pos.z;
    }
  }
  return true;
}

function stApply(lvl){
  if (G.ocean && G.ocean.setStorm) G.ocean.setStorm(ST_STORM[lvl]);
  if (G.vfx && G.vfx.setRain) G.vfx.setRain(ST_RAIN[lvl]);
  if (G.audio && G.audio.setStorm) G.audio.setStorm(ST_STORM[lvl]);
}

function stUpdate(dt, lvl){
  const p = liveP();
  // other systems may reset storm/rain: re-apply every 3 s while owned
  ST.reapplyT -= dt;
  if (ST.reapplyT <= 0){ ST.reapplyT = 3; stApply(lvl); }
  ST.boltT -= dt;
  if (ST.boltT <= 0){
    const fired = p ? stStrike(p, lvl) : false;
    ST.boltT = fired ? ST_INT[lvl] : 0.5;
  }
  if (lvl >= 3 && p){
    ST.eyeT -= dt;
    if (ST.eyeT <= 0){ ST.eyeT = 0.25; stEye(p); }
    ST.ringT -= dt;
    if (ST.ringT <= 0){
      ST.ringT = 2;
      TA.copy(p.pos);
      ring(TA, 30, 0x9fd8ff, 0.8);
    }
  }
}

function stReset(){
  ST.boltT = 0;
  ST.bolts = 0;
  ST.armed = false;
  ST.eyeT = 0;
  ST.ringT = 0;
  if (G.ocean && G.ocean.setStorm) G.ocean.setStorm(0);
  if (G.vfx && G.vfx.setRain) G.vfx.setRain(0);
  if (G.audio && G.audio.setStorm) G.audio.setStorm(0);
}

/* ======================================================================
   Registration
   ====================================================================== */
G.perks.register({
  id: 'kraken',
  name: "Kraken'in Çağrısı",
  icon: '🐙',
  rarity: 'legendary',
  maxLevel: 3,
  desc: [
    "Her 9 sn'de 110 m içindeki en güçlü düşmanı 3 dokunaçla sarar; 2.2 sn boyunca saniyede 14 hasar verir ve hedefi sersemletir.",
    "Dokunaç hasarı saniyede 20 olur, bekleme süresi 7.5 sn. Tutulan gemi ölürse suya çekilir ve %50 ekstra XP düşer.",
    "Bekleme 6 sn, 5 dokunaç ve aynı anda 2 hedef; saniyede 28 hasar. Bırakılınca suya vurup 18 m yarıçapta 25 hasar verir."
  ],
  tagline: 'Derinlerden gelen dev bir çağrı yanıt bekliyor.',
  active: null,
  onAcquire(lvl){ KR.cd = Math.max(KR.cd, 3); },
  update(dt, lvl){ krUpdate(dt, lvl); },
  reset(){ krReset(); }
});

G.perks.register({
  id: 'ghostfleet',
  name: 'Hayalet Filo',
  icon: '👻',
  rarity: 'epic',
  maxLevel: 3,
  desc: [
    "Düşman gemi batınca %35 ihtimalle 1.2 sn sonra hayalet yükselir; 16 sn savaşır, en fazla 2 hayalet olur.",
    "Şans %50, hayalet 20 sn yaşar, en fazla 3 olur; yok olan hayalet 14 m yarıçapta 30 hasarlı patlama yapar.",
    "Şans %65, en fazla 4 hayalet; her 45 sn'de yanına 'Uçan Hollandalı' gelir: 3 kat can, 1.5 kat boyut ve %90 hasar."
  ],
  tagline: 'Batan gemiler dalgaların altından geri döner.',
  active: null,
  onAcquire(lvl){},
  update(dt, lvl){ gfUpdate(dt, lvl); },
  reset(){ gfReset(); }
});

G.perks.register({
  id: 'sharks',
  name: 'Köpekbalığı Sürüsü',
  icon: '🦈',
  rarity: 'rare',
  maxLevel: 3,
  desc: [
    "Batan her düşmandan 2 köpekbalığı çıkar; 24 m/s ile en yakın düşmana saldırır ve 2 kez 14 hasar verir.",
    "Batan her düşmandan 3 köpekbalığı çıkar; 3 ısırık, 18 hasar. Isırılan gemi 2 sn boyunca %30 yavaşlar.",
    "Batan her düşmandan 4 köpekbalığı çıkar; 4 ısırık, 24 hasar. Öldüren ısırık köpekbalığını %50 güçlendirir (en fazla 3 kat)."
  ],
  tagline: 'Kan kokusu suyun altından yükseliyor.',
  active: null,
  onAcquire(lvl){},
  update(dt, lvl){ skUpdate(dt, lvl); },
  reset(){ skReset(); }
});

G.perks.register({
  id: 'curse',
  name: 'Lanetli Güller',
  icon: '☠️',
  rarity: 'epic',
  maxLevel: 3,
  desc: [
    "Gülle isabetleri lanet yığını bırakır (6 sn, en fazla 5); lanetli gemi ölünce 12+2×yığın m patlar ve yakındakilere 2 lanet bulaştırır.",
    "En fazla 6 yığın; lanetli gemiler oyuncuya yığın başına %8 az hasar verir ve tam yığında saniyede 3×yığın hasar alır.",
    "En fazla 8 yığın; her lanetli ölüm bir ruh üretir, gemine uçup +4 can verir ve sonraki salvoya +%10 hasar (en fazla +%100) ekler."
  ],
  tagline: 'Her isabet bir lanet, her lanet bir ölüm çığlığı.',
  active: null,
  onAcquire(lvl){},
  update(dt, lvl){ cuUpdate(dt, lvl); },
  reset(){ cuReset(); }
});

G.perks.register({
  id: 'deadmanschest',
  name: 'Ölü Adamın Sandığı',
  icon: '⚰️',
  rarity: 'legendary',
  maxLevel: 3,
  desc: [
    "Ölümcül hasarda bir kez dirilirsin: canın %50 dolar, 5 sn boyunca dokunulmaz ve %35 hızlı olursun; çıkışta 40 m şok dalgası çıkar.",
    "Can %75, hayalet formu 6 sn; hayalet formunda çarptığın düşman 40 hasar alır ve hızını kaybetmezsin.",
    "Can %100, hayalet formu 8 sn; 20 düşman öldürünce sandık yeniden dolar ve sandık doluyken saniyede 1 can yenilenirsin."
  ],
  tagline: 'Ölüm seni tuttu ama sandık seni bırakmadı.',
  active: null,
  onAcquire(lvl){
    if (!DM.inited){ DM.inited = true; DM.charge = 1; }
  },
  update(dt, lvl){ dmUpdate(dt, lvl); },
  reset(){ dmReset(); }
});

G.perks.register({
  id: 'storm',
  name: 'Fırtına Çağıran',
  icon: '⛈️',
  rarity: 'epic',
  maxLevel: 3,
  desc: [
    "Fırtına %45, yağmur %40 olur; 3.2 sn'de bir 95 m içindeki düşmana 26 hasarlı, 0.6 sn sersemleten yıldırım düşer.",
    "Fırtına %65; yıldırım 2.6 sn'de bir düşer, 34 hasar verir ve 30 m içinde 2 düşmana sıçrar (%60 hasar).",
    "Fırtına %85; yıldırım 2.0 sn'de bir, 44 hasar. 30 m içindeki düşmanlar %35 yavaşlar, gemin %15 hızlanır, her 4. yıldırım 2.5 kat hasar verip patlar."
  ],
  tagline: 'Gökyüzü senin öfkenle inler.',
  active: null,
  onAcquire(lvl){
    if (!ST.armed){ ST.armed = true; ST.boltT = ST_INT[lvl]; }
    if (G.ocean && G.ocean.setStorm) G.ocean.setStorm(ST_STORM[lvl]);
    if (G.vfx && G.vfx.setRain) G.vfx.setRain(ST_RAIN[lvl]);
    if (G.audio && G.audio.setStorm) G.audio.setStorm(ST_STORM[lvl]);
    if (lvl === 3 && G.player && G.player.stats) G.player.stats.maxSpeed *= 1.15;
  },
  update(dt, lvl){ stUpdate(dt, lvl); },
  reset(){ stReset(); }
});

})();
