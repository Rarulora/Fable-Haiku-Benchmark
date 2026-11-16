(function(){
'use strict';
const G = window.G;
const U = G.util;

// ---------- shared temps (no per-frame allocations) ----------
const UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3();
const _ra = new THREE.Vector3(), _rb = new THREE.Vector3();

function pick3(arr, lvl){ return arr[Math.max(0, Math.min(2, (lvl | 0) - 1))]; }
function d2(ax, az, bx, bz){ const dx = ax - bx, dz = az - bz; return Math.sqrt(dx*dx + dz*dz); }
function segDist(px, pz, ax, az, bx, bz){
  const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
  const L = vx*vx + vz*vz;
  let t = L > 1e-6 ? (wx*vx + wz*vz) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + vx*t - px, cz = az + vz*t - pz;
  return Math.sqrt(cx*cx + cz*cz);
}

// cosmetic / audio guards
function vSplash(p, s){ if (G.vfx) G.vfx.splash(p, s); }
function vFoam(p, s){ if (G.vfx) G.vfx.foam(p, s); }
function vSparks(p, n){ if (G.vfx) G.vfx.sparks(p, n); }
function vDebris(p, n){ if (G.vfx) G.vfx.debris(p, n); }
function vShake(a){ if (G.vfx) G.vfx.shake(a); }
function vHitstop(s){ if (G.vfx) G.vfx.hitstop(s); }
function vExplosion(p, s){ if (G.vfx) G.vfx.explosion(p, s); }
function vRing(p, r, c, d){ if (G.vfx) G.vfx.ring(p, r, c, d); }
function vSound(name, opts){ if (G.audio && G.audio.play) G.audio.play(name, opts); }

/* =====================================================================
   1. HARPOON (Zıpkın) - active
   ===================================================================== */
const H = { bolts: [], tethers: [], flung: [], boltPool: [], ropePool: [], boltGeo: null, boltMat: null, ropeMat: null };
const HN = 14; // rope points

function hEnsureAssets(){
  if (H.boltGeo) return;
  H.boltGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 6);
  H.boltGeo.rotateX(Math.PI / 2); // axis along local Z so lookAt() aims it
  H.boltMat = new THREE.MeshStandardMaterial({ color: 0x2a1d10, roughness: 0.7 });
  H.ropeMat = new THREE.LineBasicMaterial({ color: 0x6b4a2a });
}
function hBoltMesh(){
  hEnsureAssets();
  let m = H.boltPool.pop();
  if (!m){ m = new THREE.Mesh(H.boltGeo, H.boltMat); G.scene.add(m); }
  m.visible = true;
  return m;
}
function hRope(){
  hEnsureAssets();
  let l = H.ropePool.pop();
  if (!l){
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(HN * 3), 3));
    l = new THREE.Line(g, H.ropeMat);
    l.frustumCulled = false;
    G.scene.add(l);
  }
  l.visible = true;
  return l;
}
function hFreeRope(l){ if (!l) return; l.visible = false; H.ropePool.push(l); }
function hFreeBolt(m){ if (!m) return; m.visible = false; H.boltPool.push(m); }

// rope from A to B, sagging proportional to slack (ropeLen - chord)
function hSetRope(l, A, B, ropeLen){
  const arr = l.geometry.attributes.position.array;
  const chord = A.distanceTo(B);
  const slack = Math.max(0, ropeLen - chord);
  const sag = slack * 0.4 + 0.15;
  for (let i = 0; i < HN; i++){
    const t = i / (HN - 1);
    arr[i*3]     = A.x + (B.x - A.x) * t;
    arr[i*3 + 1] = A.y + (B.y - A.y) * t - 4 * sag * t * (1 - t);
    arr[i*3 + 2] = A.z + (B.z - A.z) * t;
  }
  l.geometry.attributes.position.needsUpdate = true;
}
function hAnchor(p, out){
  U.right(p.yaw, _r);
  out.copy(p.pos).addScaledVector(_r, 2.2);
  out.y += 2.4;
  return out;
}
function hBusy(e){
  if (e.status.harpooned) return true;
  for (let i = 0; i < H.bolts.length; i++) if (H.bolts[i].ship === e) return true;
  return false;
}
function hPick(n){
  const p = G.player;
  if (!p || !p.alive) return [];
  const list = G.combat.enemies();
  const hasAim = G.input.aimValid;
  const cand = [];
  for (let i = 0; i < list.length; i++){
    const e = list[i];
    if (!e || !e.alive || hBusy(e)) continue;
    const dp = d2(e.pos.x, e.pos.z, p.pos.x, p.pos.z);
    if (dp > 75) continue;
    let key = 1000 + dp;
    if (hasAim){
      const da = d2(e.pos.x, e.pos.z, G.input.aim.x, G.input.aim.z);
      if (da <= 25) key = da;
    }
    cand.push({ e: e, key: key });
  }
  cand.sort((a, b) => a.key - b.key);
  return cand.slice(0, n).map(c => c.e);
}
function hFire(lvl){
  const p = G.player;
  if (!p || !p.alive) return false;
  const targets = hPick(lvl >= 3 ? 3 : 1);
  if (!targets.length) return false;
  for (let i = 0; i < targets.length; i++){
    const e = targets[i];
    const from = hAnchor(p, new THREE.Vector3());
    const rope = hRope();
    const mesh = hBoltMesh();
    mesh.position.copy(from);
    H.bolts.push({ ship: e, pos: from, mesh: mesh, rope: rope, ropeLen: from.distanceTo(e.pos) + 2, lvl: lvl });
  }
  vSound('whoosh', { pos: p.pos });
  return true;
}
function hArrive(b){
  const e = b.ship, p = G.player;
  const dmg = pick3([15, 20, 25], b.lvl);
  G.combat.damageShip(e, dmg, { type: 'harpoon', owner: p, pos: e.pos.clone() });
  vSound('harpoon', { pos: e.pos });
  if (!e.alive || !p){ hFreeBolt(b.mesh); hFreeRope(b.rope); return; }
  hAnchor(p, _ra);
  _rb.set(e.pos.x, e.pos.y + 1.5, e.pos.z);
  b.mesh.position.copy(_rb);
  H.tethers.push({
    ship: e, time: pick3([4, 5, 6], b.lvl), ropeLen: _ra.distanceTo(_rb) + 4,
    lvl: b.lvl, rope: b.rope, mesh: b.mesh
  });
  e.status.harpooned = true;
  vSplash(e.pos, 0.6);
}
function hUpdateBolts(dt){
  const p = G.player;
  for (let i = H.bolts.length - 1; i >= 0; i--){
    const b = H.bolts[i];
    const e = b.ship;
    if (!e || !e.alive || !p){
      hFreeBolt(b.mesh); hFreeRope(b.rope); H.bolts.splice(i, 1);
      continue;
    }
    const tx = e.pos.x, ty = e.pos.y + 1.5, tz = e.pos.z;
    const dx = tx - b.pos.x, dy = ty - b.pos.y, dz = tz - b.pos.z;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const step = 140 * dt;
    if (dist <= step + 1.5){
      H.bolts.splice(i, 1);
      hArrive(b);
      continue;
    }
    b.pos.x += dx / dist * step;
    b.pos.y += dy / dist * step;
    b.pos.z += dz / dist * step;
    b.mesh.position.copy(b.pos);
    b.mesh.lookAt(tx, ty, tz);
    hAnchor(p, _ra);
    hSetRope(b.rope, _ra, b.pos, b.ropeLen);
  }
}
function hEndTether(t){
  const j = H.tethers.indexOf(t);
  if (j >= 0) H.tethers.splice(j, 1);
  if (t.ship && t.ship.status) t.ship.status.harpooned = false;
  hFreeRope(t.rope);
  hFreeBolt(t.mesh);
}
function hFlingMark(s, until){
  for (let i = 0; i < H.flung.length; i++){
    if (H.flung[i].ship === s){ H.flung[i].until = until; return; }
  }
  H.flung.push({ ship: s, until: until });
}
function hIsFlung(s){
  const now = G.time;
  for (let i = 0; i < H.flung.length; i++){
    const f = H.flung[i];
    if (f.ship === s && f.until > now) return true;
  }
  return false;
}
function hSnap(t){
  const s = t.ship, p = G.player;
  const dmg = pick3([20, 30, 40], t.lvl);
  G.combat.damageShip(s, dmg, { type: 'harpoon', owner: p, pos: s.pos.clone() });
  if (s.alive && p){
    U.fwd(p.yaw, _f);
    s.ext.addScaledVector(_f, 18);
    hFlingMark(s, G.time + 1.5);
  }
  vSparks(s.pos, 14);
  vSplash(s.pos, 1.2);
  vShake(0.4);
  vSound('harpoon', { pos: s.pos });
  hEndTether(t);
}
function hUpdateTethers(dt){
  const p = G.player;
  for (let i = H.tethers.length - 1; i >= 0; i--){
    const t = H.tethers[i];
    const s = t.ship;
    if (!s || !s.alive || !p || !p.alive){ hEndTether(t); continue; }
    _rb.set(s.pos.x, s.pos.y + 1.5, s.pos.z);
    hAnchor(p, _ra);
    const d = d2(s.pos.x, s.pos.z, p.pos.x, p.pos.z);
    t.time -= dt;
    if (d <= 14 || t.time <= 0){ hSnap(t); continue; }
    if (d > 22){
      const mult = s.isBoss ? 0.3 : 0.85;
      const accel = Math.min((d - 22) * 6, 30);
      const ux = (p.pos.x - s.pos.x) / d, uz = (p.pos.z - s.pos.z) / d;
      s.ext.x += ux * accel * mult * dt;
      s.ext.z += uz * accel * mult * dt;
      p.ext.x -= ux * accel * 0.15 * dt;
      p.ext.z -= uz * accel * 0.15 * dt;
    }
    s.status.harpooned = true;
    s.status.slowT = Math.max(s.status.slowT, 0.5);
    s.status.slowAmt = 0.5;
    hSetRope(t.rope, _ra, _rb, t.ropeLen);
    t.mesh.position.copy(_rb);
  }
}
function harpoonUse(lvl){ return hFire(lvl); }
function harpoonUpdate(dt){
  hUpdateBolts(dt);
  hUpdateTethers(dt);
  const now = G.time;
  for (let i = H.flung.length - 1; i >= 0; i--){
    const f = H.flung[i];
    if (f.until <= now || !f.ship || !f.ship.alive) H.flung.splice(i, 1);
  }
}
function harpoonReset(){
  for (let i = 0; i < H.tethers.length; i++){
    const t = H.tethers[i];
    if (t.ship && t.ship.status) t.ship.status.harpooned = false;
    hFreeRope(t.rope); hFreeBolt(t.mesh);
  }
  for (let i = 0; i < H.bolts.length; i++){
    hFreeRope(H.bolts[i].rope); hFreeBolt(H.bolts[i].mesh);
  }
  H.tethers.length = 0;
  H.bolts.length = 0;
  H.flung.length = 0;
}

G.on('ship:removed', (d) => {
  if (!G.perks.level('harpoon')) return;
  const s = d.ship;
  for (let i = H.tethers.length - 1; i >= 0; i--){
    const t = H.tethers[i];
    if (t.ship === s){ H.tethers.splice(i, 1); hFreeRope(t.rope); hFreeBolt(t.mesh); }
  }
  for (let i = H.bolts.length - 1; i >= 0; i--){
    const b = H.bolts[i];
    if (b.ship === s){ H.bolts.splice(i, 1); hFreeRope(b.rope); hFreeBolt(b.mesh); }
  }
  for (let i = H.flung.length - 1; i >= 0; i--){
    if (H.flung[i].ship === s) H.flung.splice(i, 1);
  }
});

// Savur (lvl2): a flung ship crashing into another enemy
G.on('ship:collide', (d) => {
  const lvl = G.perks.level('harpoon');
  if (!lvl || lvl < 2) return;
  const a = d.a, b = d.b;
  if (!a || !b || !a.alive || !b.alive) return;
  if (a.team !== 'enemy' || b.team !== 'enemy') return;
  if (!hIsFlung(a) && !hIsFlung(b)) return;
  _v1.set((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2, (a.pos.z + b.pos.z) / 2);
  G.combat.damageShip(a, 40, { type: 'harpoon', owner: G.player, pos: _v1.clone() });
  G.combat.damageShip(b, 40, { type: 'harpoon', owner: G.player, pos: _v1.clone() });
  vExplosion(_v1, 0.8);
});

// Lvl3: +30% cannon damage on tethered ships
G.on('ship:predamage', (e) => {
  const lvl = G.perks.level('harpoon');
  if (!lvl || lvl < 3) return;
  const s = e.ship;
  if (!s || !s.status || !s.status.harpooned) return;
  if (e.source && e.source.type === 'cannon' && e.source.owner === G.player) e.amount *= 1.3;
});

/* =====================================================================
   2. RAM (Mahmuz) - passive
   ===================================================================== */
const RM = { mesh: null, dash: false, prev: new THREE.Vector3(), vis: new THREE.Vector3(), hits: [] };

function ramEnsure(){
  if (RM.mesh) return RM.mesh;
  const geo = new THREE.ConeGeometry(0.45, 2.2, 8);
  geo.rotateX(Math.PI / 2); // tip points to local +Z (bow)
  const mat = new THREE.MeshStandardMaterial({ color: 0xcd7f32, metalness: 0.7, roughness: 0.35 });
  RM.mesh = new THREE.Mesh(geo, mat);
  RM.mesh.position.set(0, 0.5, 8.5);
  RM.mesh.visible = false;
  return RM.mesh;
}
function ramAttach(p){
  const m = ramEnsure();
  if (p.mesh && m.parent !== p.mesh) p.mesh.add(m);
  m.visible = true;
}
function ramWake(p){
  if (p.dashT > 0){
    if (!RM.dash){
      RM.dash = true;
      RM.hits.length = 0;
      RM.prev.copy(p.pos);
      RM.vis.copy(p.pos);
      G.ocean.addRipple(p.pos.x, p.pos.z, 1.6, 14);
      vFoam(p.pos, 2);
      vSplash(p.pos, 1.5);
    }
    const ax = RM.prev.x, az = RM.prev.z, bx = p.pos.x, bz = p.pos.z;
    const en = G.combat.enemies();
    for (let i = 0; i < en.length; i++){
      const e = en[i];
      if (!e || !e.alive) continue;
      if (RM.hits.indexOf(e) >= 0) continue;
      if (segDist(e.pos.x, e.pos.z, ax, az, bx, bz) > 7) continue;
      RM.hits.push(e);
      G.combat.damageShip(e, 25, { type: 'ram', owner: p, pos: e.pos.clone() });
      vSparks(e.pos, 6);
    }
    RM.prev.copy(p.pos);
    if (d2(p.pos.x, p.pos.z, RM.vis.x, RM.vis.z) >= 1.5){
      vFoam(p.pos, 2.2);
      vSplash(p.pos, 1.1);
      RM.vis.copy(p.pos);
    }
  } else if (RM.dash){
    RM.dash = false;
    RM.hits.length = 0;
  }
}

G.on('ship:collide', (d) => {
  const lvl = G.perks.level('ram');
  if (!lvl) return;
  const p = G.player;
  if (!p || !p.alive) return;
  let o = null;
  if (d.a === p) o = d.b; else if (d.b === p) o = d.a;
  if (!o || !o.alive || o.team !== 'enemy') return;
  if (!(p.speed > 8)) return;
  const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z;
  const dist = Math.sqrt(dx*dx + dz*dz);
  if (dist < 0.01) return;
  U.fwd(p.yaw, _f);
  if ((_f.x * dx + _f.z * dz) / dist <= 0.5) return;
  const dashing = p.dashT > 0;
  const dmg = pick3([20, 30, 45], lvl) * (dashing ? 2 : 1);
  _v1.set((p.pos.x + o.pos.x) / 2, (p.pos.y + o.pos.y) / 2, (p.pos.z + o.pos.z) / 2);
  G.combat.damageShip(o, dmg, { type: 'ram', owner: p, pos: _v1.clone() });
  if (o.alive){
    o.ext.x += (dx / dist) * 14;
    o.ext.z += (dz / dist) * 14;
    o.status.stunT = Math.max(o.status.stunT, 1);
  } else if (lvl >= 2){
    p.dashCd = 0; // chain rams: a ram kill resets the dash
  }
  vDebris(_v1, 8);
  vSparks(_v1, 14);
  vShake(0.6);
  vHitstop(0.08);
  vSound('hit', { pos: _v1 });
});

G.on('ship:predamage', (e) => {
  const lvl = G.perks.level('ram');
  if (!lvl) return;
  const p = G.player;
  if (!p || e.ship !== p) return;
  const dashing = p.dashT > 0;
  if (lvl >= 3 && dashing){ e.cancel = true; return; }
  if (e.source && e.source.type === 'collision' && (lvl >= 2 || dashing)) e.cancel = true;
});

G.on('ship:removed', (d) => {
  if (!G.perks.level('ram')) return;
  for (let i = RM.hits.length - 1; i >= 0; i--){
    if (RM.hits[i] === d.ship) RM.hits.splice(i, 1);
  }
});

/* =====================================================================
   3. KEGS (Barut Fıçıları) - passive
   ===================================================================== */
const K = { pool: [], live: [], dropT: 0, assets: null };
const KEG_CAP = [8, 12, 16];
const KEG_INT = [3.0, 2.4, 1.8];

function kegAssetsGet(){
  if (K.assets) return K.assets;
  K.assets = {
    body: new THREE.CylinderGeometry(0.9, 0.9, 1.6, 10),
    band: new THREE.CylinderGeometry(0.95, 0.95, 0.16, 10),
    fuse: new THREE.SphereGeometry(0.16, 6, 5),
    bodyM: new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }),
    bandM: new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.6 }),
    fuseM: new THREE.MeshBasicMaterial({ color: 0xff2a1a })
  };
  return K.assets;
}
function kegCreate(){
  const A = kegAssetsGet();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(A.body, A.bodyM));
  const b1 = new THREE.Mesh(A.band, A.bandM); b1.position.y = -0.5; g.add(b1);
  const b2 = new THREE.Mesh(A.band, A.bandM); b2.position.y = 0.5; g.add(b2);
  const fuse = new THREE.Mesh(A.fuse, A.fuseM);
  fuse.position.set(0, 1.0, 0);
  g.add(fuse);
  g.visible = false;
  G.scene.add(g);
  return { group: g, fuse: fuse, active: false, pos: new THREE.Vector3(), age: 0, armed: false,
           triggered: false, fuseT: 0, chainN: 0, phase: 0 };
}
function kegRemoveAt(i){
  const k = K.live[i];
  k.active = false;
  k.group.visible = false;
  K.live.splice(i, 1);
}
// n = index of this explosion within its chain (1 = first)
function kegDetonate(k, n){
  const j = K.live.indexOf(k);
  if (j < 0) return;
  K.live.splice(j, 1);
  k.active = false;
  k.group.visible = false;
  const lvl = G.perks.level('kegs') || 1;
  const R = pick3([11, 12, 13], lvl);
  const base = pick3([28, 38, 50], lvl);
  const mult = n >= 4 ? 1 + Math.min(1, 0.2 * (n - 3)) : 1;
  const pos = new THREE.Vector3(k.pos.x, G.ocean.heightAt(k.pos.x, k.pos.z), k.pos.z);
  G.combat.explode(pos, R, base * mult, { type: 'explosion', owner: G.player, pos: pos.clone() }, 'player');
  vSound('explosion', { pos: pos });
  if (lvl >= 3 && G.perks.spawnFirePatch && G.perks.level('greekfire') > 0){
    G.perks.spawnFirePatch(pos, 7, 5, 8);
  }
  // chain reaction: armed neighbours fuse after 0.12 s each
  for (let i = 0; i < K.live.length; i++){
    const o = K.live[i];
    if (o.armed && !o.triggered && d2(o.pos.x, o.pos.z, k.pos.x, k.pos.z) <= R){
      o.triggered = true;
      o.fuseT = 0.12;
      o.chainN = n + 1;
    }
  }
}
function kegSpawn(p, lvl){
  const cap = KEG_CAP[lvl - 1];
  while (K.live.length >= cap && K.live.length > 0){
    kegDetonate(K.live[0], 1); // oldest detonates when cap exceeded
  }
  let k = null;
  for (let i = 0; i < K.pool.length; i++){
    if (!K.pool[i].active){ k = K.pool[i]; break; }
  }
  if (!k){ k = kegCreate(); K.pool.push(k); }
  U.fwd(p.yaw, _f);
  const back = (p.length || 16) * 0.5 + 1;
  k.pos.set(p.pos.x - _f.x * back, p.pos.y, p.pos.z - _f.z * back);
  k.age = 0;
  k.armed = false;
  k.triggered = false;
  k.fuseT = 0;
  k.chainN = 0;
  k.phase = Math.random() * 6.2832;
  k.active = true;
  k.group.visible = true;
  K.live.push(k);
}
function kegsUpdate(dt, lvl){
  const p = G.player;
  if (p && p.alive && p.speed > 4){
    K.dropT -= dt;
    if (K.dropT <= 0){
      K.dropT = KEG_INT[lvl - 1];
      kegSpawn(p, lvl);
    }
  }
  for (let i = K.live.length - 1; i >= 0; i--){
    const k = K.live[i];
    k.age += dt;
    if (k.age >= 30){ vSplash(k.pos, 0.6); kegRemoveAt(i); continue; }
    if (!k.armed && k.age >= 0.8) k.armed = true;
    if (lvl >= 2 && !k.triggered){
      const e = G.combat.nearestEnemy(k.pos, 22, null);
      if (e){
        const dx = e.pos.x - k.pos.x, dz = e.pos.z - k.pos.z;
        const dd = Math.sqrt(dx*dx + dz*dz);
        if (dd > 0.5){ k.pos.x += dx / dd * 5 * dt; k.pos.z += dz / dd * 5 * dt; }
      }
    }
    const h = G.ocean.heightAt(k.pos.x, k.pos.z);
    k.pos.y = h;
    k.group.position.set(k.pos.x, h + 0.45 + Math.sin(G.time * 2.2 + k.phase) * 0.12, k.pos.z);
    G.ocean.normalAt(k.pos.x, k.pos.z, _n);
    k.group.quaternion.setFromUnitVectors(UP, _n);
    const rate = k.armed ? 10 : 2 + 6 * (k.age / 0.8);
    const on = Math.sin(k.age * rate * 6.2832) > 0;
    k.fuse.scale.setScalar(on ? 1.3 : 0.6);
    if (k.triggered){
      k.fuseT -= dt;
      if (k.fuseT <= 0) kegDetonate(k, k.chainN);
      continue;
    }
    if (k.armed && G.combat.nearestEnemy(k.pos, 6, null)){
      kegDetonate(k, 1);
    }
  }
}
// Lvl3: your own cannonballs detonate kegs
function kegProjBoom(proj, pos){
  const lvl = G.perks.level('kegs');
  if (!lvl || lvl < 3) return;
  if (!proj || proj.owner !== G.player || !pos) return;
  for (let i = K.live.length - 1; i >= 0; i--){
    const k = K.live[i];
    if (k.armed && !k.triggered && d2(k.pos.x, k.pos.z, pos.x, pos.z) <= 6){
      kegDetonate(k, 1);
    }
  }
}
G.on('proj:hit', (d) => { if (!G.perks.level('kegs')) return; kegProjBoom(d.proj, d.pos); });
G.on('proj:splash', (d) => { if (!G.perks.level('kegs')) return; kegProjBoom(d.proj, d.pos); });

/* =====================================================================
   4. MORTAR (Havan Topu) - active
   ===================================================================== */
const MO = { queue: [] };

function mortarShoot(x, z, lvl){
  const p = G.player;
  if (!p) return;
  const from = new THREE.Vector3(p.pos.x, p.pos.y + 4, p.pos.z);
  const to = new THREE.Vector3(x, G.ocean.heightAt(x, z), z);
  G.combat.launchAt(from, to, 62, {
    high: true, kind: 'mortar', team: 'player', owner: p,
    damage: pick3([45, 60, 80], lvl), blast: pick3([10, 11, 12], lvl),
    scale: 2, color: 0x221100, trail: true
  });
}
function mortarUse(lvl){
  const p = G.player;
  if (!p || !p.alive) return false;
  const tgt = new THREE.Vector3();
  if (G.input.aimValid) tgt.copy(G.input.aim);
  else {
    const e = G.combat.nearestEnemy(p.pos, 150, null);
    if (!e) return false;
    tgt.copy(e.pos);
  }
  let dx = tgt.x - p.pos.x, dz = tgt.z - p.pos.z;
  let d = Math.sqrt(dx*dx + dz*dz);
  if (d < 0.01){ U.fwd(p.yaw, _f); dx = _f.x; dz = _f.z; d = 1; }
  const want = U.clamp(d, 25, 150);
  const ux = dx / d, uz = dz / d;
  tgt.x = p.pos.x + ux * want;
  tgt.z = p.pos.z + uz * want;
  tgt.y = G.ocean.heightAt(tgt.x, tgt.z);

  const blast = pick3([10, 11, 12], lvl);
  const shots = [];
  if (lvl === 1){
    shots.push({ x: tgt.x, z: tgt.z, t: 0 });
  } else if (lvl === 2){
    for (let k = 0; k < 3; k++){
      const a = k * 2.0944;
      shots.push({ x: tgt.x + Math.cos(a) * 4, z: tgt.z + Math.sin(a) * 4, t: k * 0.15 });
    }
  } else {
    for (let k = 0; k < 7; k++){
      const s = (k - 3) * 9;
      shots.push({ x: tgt.x + ux * s, z: tgt.z + uz * s, t: k * 0.12 });
    }
  }
  const flight = 2 * 62 * Math.sin(1.2) / 30; // rough high-arc flight time
  const from = new THREE.Vector3(p.pos.x, p.pos.y + 4, p.pos.z);
  if (G.vfx){ G.vfx.muzzle(from, UP); G.vfx.shake(0.3); }
  vSound('mortar', { pos: from });
  for (let i = 0; i < shots.length; i++){
    const s = shots[i];
    _v2.set(s.x, G.ocean.heightAt(s.x, s.z), s.z);
    vRing(_v2, blast, 0xffaa22, flight);
    if (s.t <= 0) mortarShoot(s.x, s.z, lvl);
    else MO.queue.push({ x: s.x, z: s.z, t: s.t, lvl: lvl });
  }
  return true;
}
function mortarUpdate(dt){
  for (let i = MO.queue.length - 1; i >= 0; i--){
    const q = MO.queue[i];
    q.t -= dt;
    if (q.t <= 0){
      MO.queue.splice(i, 1);
      if (G.player && G.player.alive) mortarShoot(q.x, q.z, q.lvl);
    }
  }
}
function mortarImpact(proj, pos){
  if (!proj || proj.kind !== 'mortar' || !G.player || proj.owner !== G.player || !pos) return;
  const lvl = G.perks.level('mortar');
  if (!lvl) return;
  if (lvl >= 2){
    const R = proj.blast || 10;
    const en = G.combat.enemies();
    for (let i = 0; i < en.length; i++){
      const e = en[i];
      if (!e || !e.alive) continue;
      if (d2(e.pos.x, e.pos.z, pos.x, pos.z) <= R){
        e.status.slowT = Math.max(e.status.slowT, 3);
        e.status.slowAmt = 0.4;
      }
    }
  }
  if (lvl >= 3 && G.perks.spawnFirePatch) G.perks.spawnFirePatch(pos, 5, 4, 6);
}
G.on('proj:hit', (d) => { if (!G.perks.level('mortar')) return; mortarImpact(d.proj, d.pos); });
G.on('proj:splash', (d) => { if (!G.perks.level('mortar')) return; mortarImpact(d.proj, d.pos); });

/* =====================================================================
   5. TIDALWAVE (Gelgit Dalgası) - active
   ===================================================================== */
const TW = { waves: [] };

function twMake(cx, cz, lvl, mul, delay){
  return {
    cx: cx, cz: cz, r: 0, rPrev: 0,
    max: pick3([75, 90, 110], lvl),
    dmg: pick3([18, 26, 36], lvl) * mul,
    push: pick3([20, 24, 28], lvl),
    stun: pick3([1, 1.3, 1.6], lvl),
    delay: delay, started: false, second: mul < 1,
    splashT: 0, hits: [], lvl: lvl
  };
}
function twStart(w){
  w.started = true;
  const strength = pick3([2.6, 3.2, 3.8], w.lvl) * (w.second ? 0.6 : 1);
  G.ocean.addRipple(w.cx, w.cz, strength, 22);
  _v1.set(w.cx, G.ocean.heightAt(w.cx, w.cz), w.cz);
  vRing(_v1, w.max, 0x9fe8ff, w.max / 22);
  vShake(w.second ? 0.4 : 0.8);
  vSound('wave', { pos: _v1 });
}
function tidalwaveUse(lvl){
  const p = G.player;
  if (!p) return false;
  const cx = p.pos.x, cz = p.pos.z;
  const first = twMake(cx, cz, lvl, 1, 0);
  twStart(first);
  TW.waves.push(first);
  if (lvl >= 2){
    p.status.burnT = 0;
    G.combat.heal(8);
  }
  if (lvl >= 3) TW.waves.push(twMake(cx, cz, lvl, 0.6, 0.8));
  return true;
}
function twUpdate(dt){
  const ws = TW.waves;
  for (let i = ws.length - 1; i >= 0; i--){
    const w = ws[i];
    if (!w.started){
      w.delay -= dt;
      if (w.delay > 0) continue;
      twStart(w);
    }
    w.rPrev = w.r;
    w.r += 22 * dt;
    w.splashT -= dt;
    if (w.splashT <= 0){
      w.splashT = 0.15;
      for (let k = 0; k < 10; k++){
        const a = k * 0.6283 + w.r * 0.02;
        const x = w.cx + Math.cos(a) * w.r, z = w.cz + Math.sin(a) * w.r;
        _v1.set(x, G.ocean.heightAt(x, z), z);
        vSplash(_v1, 1.0);
      }
    }
    const en = G.combat.enemies();
    for (let j = 0; j < en.length; j++){
      const e = en[j];
      if (!e || !e.alive) continue;
      if (w.hits.indexOf(e) >= 0) continue;
      const dx = e.pos.x - w.cx, dz = e.pos.z - w.cz;
      const d = Math.sqrt(dx*dx + dz*dz);
      if (d > w.r) continue;
      w.hits.push(e);
      const capsize = w.lvl >= 3 && e.status.stunT > 0;
      const dmg = w.dmg + (capsize ? 50 : 0);
      G.combat.damageShip(e, dmg, { type: 'wave', owner: G.player, pos: e.pos.clone() });
      if (capsize){ _v1.copy(e.pos); vSplash(_v1, 3); }
      if (e.alive){
        const dd = Math.max(d, 0.01);
        e.ext.x += dx / dd * w.push;
        e.ext.z += dz / dd * w.push;
        e.status.stunT = Math.max(e.status.stunT, w.stun);
      }
    }
    if (w.lvl >= 2){
      const pj = G.combat.projectiles;
      for (let j = 0; j < pj.length; j++){
        const q = pj[j];
        if (!q || q.team !== 'enemy' || !(q.life > 0)) continue;
        const dd = d2(q.pos.x, q.pos.z, w.cx, w.cz);
        if (dd <= w.r && dd >= w.rPrev - 3){
          q.life = 0;
          vSplash(q.pos, 0.4);
        }
      }
    }
    if (w.r >= w.max) ws.splice(i, 1);
  }
}
G.on('ship:removed', (d) => {
  if (!G.perks.level('tidalwave')) return;
  for (let i = 0; i < TW.waves.length; i++){
    const h = TW.waves[i].hits;
    for (let j = h.length - 1; j >= 0; j--){ if (h[j] === d.ship) h.splice(j, 1); }
  }
});

/* =====================================================================
   6. WHIRLPOOL (Girdap) - active
   ===================================================================== */
const WP = { cur: null, mesh: null, mat: null };

function wpEnsure(){
  if (WP.mesh) return;
  const geo = new THREE.RingGeometry(0.02, 1, 64);
  geo.rotateX(-Math.PI / 2); // lay flat on the sea
  WP.mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0.6 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uTime; uniform float uAlpha; varying vec2 vP; ' +
      'void main(){ float r = length(vP); if (r > 1.0 || r < 0.03) discard; ' +
      'float a = atan(vP.y, vP.x); ' +
      'float s = 0.5 + 0.5 * sin(a * 3.0 + r * 9.0 - uTime * 4.0); ' +
      'float edge = smoothstep(1.0, 0.55, r); float fade = smoothstep(0.03, 0.2, r); ' +
      'gl_FragColor = vec4(0.8, 0.95, 1.0, s * edge * fade * uAlpha); }',
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });
  WP.mesh = new THREE.Mesh(geo, WP.mat);
  WP.mesh.visible = false;
  G.scene.add(WP.mesh);
}
function wpUse(lvl){
  if (WP.cur) return false;
  const p = G.player;
  if (!p || !p.alive) return false;
  let x, z;
  if (G.input.aimValid){
    let dx = G.input.aim.x - p.pos.x, dz = G.input.aim.z - p.pos.z;
    let d = Math.sqrt(dx*dx + dz*dz);
    if (d < 0.01){ U.fwd(p.yaw, _f); dx = _f.x; dz = _f.z; d = 1; }
    const want = U.clamp(d, 20, 120);
    x = p.pos.x + dx / d * want;
    z = p.pos.z + dz / d * want;
  } else {
    U.fwd(p.yaw, _f);
    x = p.pos.x + _f.x * 50;
    z = p.pos.z + _f.z * 50;
  }
  const R = pick3([22, 26, 30], lvl);
  const depth = pick3([5, 6, 7], lvl);
  const dur = pick3([6, 7, 8], lvl);
  WP.cur = { cx: x, cz: z, R: R, depth: depth, dur: dur, t: 0, tick: 0, foamT: 0, lvl: lvl };
  wpEnsure();
  G.ocean.setVortex(x, z, R, depth);
  const h = G.ocean.heightAt(x, z);
  WP.mesh.visible = true;
  WP.mesh.scale.set(R, 1, R);
  WP.mesh.position.set(x, h + 0.3, z);
  _v1.set(x, h, z);
  vRing(_v1, R, 0xbff4ff, 1.5);
  vSound('wave', { pos: _v1 });
  return true;
}
function wpErupt(w){
  const pos = new THREE.Vector3(w.cx, G.ocean.heightAt(w.cx, w.cz), w.cz);
  G.combat.explode(pos, w.R, 70, { type: 'vortex', owner: G.player, pos: pos.clone() }, 'player');
  for (let j = 0; j < 6; j++){
    const a = Math.random() * 6.2832, r = Math.random() * w.R * 0.5;
    _v1.set(w.cx + Math.cos(a) * r, pos.y, w.cz + Math.sin(a) * r);
    vSplash(_v1, 3);
  }
  G.ocean.addRipple(w.cx, w.cz, 3, 20);
  const en = G.combat.enemies();
  for (let i = 0; i < en.length; i++){
    const e = en[i];
    if (!e || !e.alive) continue;
    const dx = e.pos.x - w.cx, dz = e.pos.z - w.cz;
    const d = Math.sqrt(dx*dx + dz*dz);
    if (d > w.R) continue;
    const dd = Math.max(d, 0.01);
    e.ext.x += dx / dd * 26;
    e.ext.z += dz / dd * 26;
  }
}
function wpClose(){
  const w = WP.cur;
  if (!w) return;
  WP.cur = null;
  G.ocean.setVortex(w.cx, w.cz, w.R, 0);
  if (WP.mesh) WP.mesh.visible = false;
  if (w.lvl >= 3) wpErupt(w);
}
function wpUpdate(dt){
  const w = WP.cur;
  if (!w) return;
  w.t += dt;
  if (w.t >= w.dur){ wpClose(); return; }
  const cx = w.cx, cz = w.cz, R = w.R, R14 = R * 1.4, Rin = R * 0.4;
  WP.mat.uniforms.uTime.value = G.time;
  WP.mesh.position.y = G.ocean.heightAt(cx, cz) + 0.3;
  w.foamT -= dt;
  if (w.foamT <= 0){
    w.foamT = 0.25;
    const a = Math.random() * 6.2832;
    _v1.set(cx + Math.cos(a) * R * 0.95, WP.mesh.position.y, cz + Math.sin(a) * R * 0.95);
    vFoam(_v1, 1.2);
  }
  w.tick -= dt;
  const doTick = w.tick <= 0;
  if (doTick) w.tick = 0.25;
  const dps = pick3([12, 16, 22], w.lvl);
  const en = G.combat.enemies();
  for (let i = 0; i < en.length; i++){
    const e = en[i];
    if (!e || !e.alive) continue;
    const dx = e.pos.x - cx, dz = e.pos.z - cz;
    const d = Math.max(Math.sqrt(dx*dx + dz*dz), 0.01);
    const nx = dx / d, nz = dz / d;
    if (d <= R14){
      const k = e.isBoss ? 0.4 : 1;
      const f = 1 - Math.min(1, d / R14);
      const pull = (9 + 7 * f) * k;
      const ai = pull * 1.5 * dt;          // inward
      const at = pull * 0.8 * 1.5 * dt;    // tangential swirl
      e.ext.x += -nx * ai - nz * at;
      e.ext.z += -nz * ai + nx * at;
      e.yaw += (1.0 + 1.5 * (1 - Math.min(1, d / R))) * k * dt; // dizzy spin
    }
    if (doTick && d <= Rin){
      G.combat.damageShip(e, dps * 0.25, { type: 'vortex', owner: G.player, pos: e.pos.clone() });
    }
  }
  const pj = G.combat.projectiles;
  for (let j = 0; j < pj.length; j++){
    const q = pj[j];
    if (!q || q.team !== 'enemy') continue;
    if (d2(q.pos.x, q.pos.z, cx, cz) <= R) q.vel.y -= 60 * dt;
  }
}
function wpReset(){
  WP.cur = null;
  if (WP.mesh) WP.mesh.visible = false;
  if (G.ocean && G.ocean.setVortex) G.ocean.setVortex(0, 0, 1, 0);
}
// Lvl2: ships dying inside are swallowed and spat out as loot on the rim
G.on('ship:killed', (d) => {
  const lvl = G.perks.level('whirlpool');
  if (!lvl || lvl < 2) return;
  const w = WP.cur, s = d.ship;
  if (!w || !s || !s.pos) return;
  const dx = s.pos.x - w.cx, dz = s.pos.z - w.cz;
  const dist = Math.sqrt(dx*dx + dz*dz);
  if (dist > w.R) return;
  if (s.mesh) s.mesh.visible = false;
  vSplash(s.pos, 3);
  const dd = Math.max(dist, 0.01);
  const rx = w.cx + dx / dd * w.R * 0.9, rz = w.cz + dz / dd * w.R * 0.9;
  _v1.set(rx, G.ocean.heightAt(rx, rz), rz);
  G.combat.dropLoot(_v1.clone(), 'gold');
  if (Math.random() < 0.5) G.combat.dropLoot(_v1.clone(), 'repair');
});

/* =====================================================================
   Perk registration
   ===================================================================== */
G.perks.register({
  id: 'harpoon', name: 'Zıpkın', icon: '🪝', rarity: 'rare', maxLevel: 3,
  desc: [
    '75 m içindeki düşmana 15 hasarlı zıpkın atar ve 4 sn ipte çeker, %50 yavaşlatır. İp koptuğunda (14 m\'ye yaklaşınca) 20 hasar verip düşmanı ileri fırlatır.',
    'Zıpkın 20 hasar verir, ip 5 sn sürer ve kopuş 30 hasar. Fırlatılan gemi 1,5 sn içinde başka bir düşmana çarparsa ikisine de 40 hasar verir (Savur).',
    'Aynı anda 3 düşmana zıpkın atar: 25 hasar, 6 sn ip, kopuşta 40 hasar. İpteki gemilere toplarınız %30 fazla hasar verir.'
  ],
  tagline: 'İp ucunda ne varsa, gemine çekilir.',
  active: {
    cooldown(lvl){ return pick3([9, 8, 7], lvl); },
    use(lvl){ return harpoonUse(lvl); }
  },
  onAcquire(){},
  update(dt){ harpoonUpdate(dt); },
  reset(){ harpoonReset(); }
});

G.perks.register({
  id: 'ram', name: 'Mahmuz', icon: '🐏', rarity: 'common', maxLevel: 3,
  desc: [
    'Önündeki düşmana hızla çarparak 20 hasar verir ve 1 sn sersemletir. Atılırken çarpma hasarı 2 katına çıkar; atılma sırasında çarpışma hasarı almazsın.',
    'Çarpma hasarı 30 (atılırken 60). Çarpışma hasarını her zaman sıfırlarsın. Atılma bekleme süresi 3,5 sn olur; çarpmayla bir gemi batırmak atılmayı anında sıfırlar.',
    'Çarpma hasarı 45 (atılırken 90). Atılma sırasında tamamen dokunulmaz olursun ve yolunun 7 m yakınındaki düşmanlara 25 hasar veren Dalga Yaran bırakırsın.'
  ],
  tagline: 'Baş, ilk sözü söyler.',
  active: null,
  onAcquire(lvl){
    if (G.player) ramAttach(G.player);
  },
  update(dt, lvl){
    const p = G.player;
    if (!p) { if (RM.mesh) RM.mesh.visible = false; RM.dash = false; RM.hits.length = 0; return; }
    ramAttach(p);
    if (lvl >= 2 && p.dashCdMax !== 3.5) p.dashCdMax = 3.5;
    if (lvl >= 3) ramWake(p);
    else if (RM.dash){ RM.dash = false; RM.hits.length = 0; }
  },
  reset(){
    RM.dash = false;
    RM.hits.length = 0;
    if (RM.mesh){
      RM.mesh.visible = false;
      if (RM.mesh.parent) RM.mesh.parent.remove(RM.mesh);
    }
  }
});

G.perks.register({
  id: 'kegs', name: 'Barut Fıçıları', icon: '🛢️', rarity: 'rare', maxLevel: 3,
  desc: [
    'Hızlı giderken her 3 sn\'de arkana barut fıçısı bırakır (en fazla 8). Düşman 6 m\'ye girince patlar: 28 hasar, 11 m yarıçap. Patlamalar yakındaki fıçıları zincirleme tetikler; fıçılar 30 sn sonra söner.',
    'Bırakma 2,4 sn, en fazla 12 fıçı. Patlama 38 hasar, 12 m yarıçap. Fıçılar 22 m içindeki düşmana doğru 5 m/s ile sürüklenir (mıknatıs).',
    'Bırakma 1,8 sn, en fazla 16 fıçı. Patlama 50 hasar, 13 m yarıçap. Kendi topların da fıçı patlatır; 3 fıçılık zincirden sonra her patlama %20 büyür (en fazla +%100). Yunan Ateşi sahipken patlama yangın bırakır.'
  ],
  tagline: 'Dalgaların altında sessiz bir ölüm bekler.',
  active: null,
  onAcquire(){ K.dropT = 0; },
  update(dt, lvl){ kegsUpdate(dt, lvl); },
  reset(){
    for (let i = 0; i < K.pool.length; i++){
      K.pool[i].active = false;
      K.pool[i].group.visible = false;
    }
    K.live.length = 0;
    K.dropT = 0;
  }
});

G.perks.register({
  id: 'mortar', name: 'Havan Topu', icon: '☄️', rarity: 'epic', maxLevel: 3,
  desc: [
    'Nişan noktasına (25–150 m) tek havan mermisi atar: 45 hasar, 10 m etki alanı. Bekleme 7 sn.',
    '3 mermi üçgen dizilimle, 0,15 sn arayla düşer: 60 hasar, 11 m etki alanı. Etkideki düşmanlar 3 sn boyunca %40 yavaşlar. Bekleme 6 sn.',
    '7 mermi hedefin üzerinden geçen bir hat boyunca yağar: 80 hasar, 12 m etki alanı. Her isabet 4 sn yanan bir deniz alanı bırakır. Bekleme 5 sn.'
  ],
  tagline: 'Gökten düşer, sorusu yok.',
  active: {
    cooldown(lvl){ return pick3([7, 6, 5], lvl); },
    use(lvl){ return mortarUse(lvl); }
  },
  onAcquire(){},
  update(dt){ mortarUpdate(dt); },
  reset(){ MO.queue.length = 0; }
});

G.perks.register({
  id: 'tidalwave', name: 'Gelgit Dalgası', icon: '🌊', rarity: 'epic', maxLevel: 3,
  desc: [
    'Gemini çevreleyen 75 m\'lik bir dalga yayar: geçtiği düşmanlara 18 hasar verir, 1 sn sersemletir ve dışarı iter. Su yüzeyinde gerçek bir dalga oluşturur. Bekleme 14 sn.',
    'Dalga 90 m\'ye ulaşır: 26 hasar, 1,3 sn sersemletme. Yolundaki düşman mermileri yok olur. Ayrıca yanmanı söndürür ve 8 can yenilersin. Bekleme 12 sn.',
    'Dalga 110 m\'ye ulaşır: 36 hasar, 1,6 sn sersemletme. 0,8 sn sonra %60 hasarlı ikinci bir dalga gelir. Sersemlemiş gemiler dalgayla devrilir: +50 hasar ve büyük sıçrama. Bekleme 10 sn.'
  ],
  tagline: 'Denizin sabrı tükendi.',
  active: {
    cooldown(lvl){ return pick3([14, 12, 10], lvl); },
    use(lvl){ return tidalwaveUse(lvl); }
  },
  onAcquire(){},
  update(dt){ twUpdate(dt); },
  reset(){ TW.waves.length = 0; }
});

G.perks.register({
  id: 'whirlpool', name: 'Girdap', icon: '🌀', rarity: 'legendary', maxLevel: 3,
  desc: [
    'Nişanladığın yere 6 sn süren, 22 m yarıçaplı bir girdap açar: düşmanları merkeze çeker ve döndürür. Merkezdeki %40\'lık alanda saniyede 12 hasar verir. Bekleme 18 sn.',
    'Süre 7 sn, yarıçap 26 m, merkezde saniyede 16 hasar. Girdapta ölen düşman yutulur ve altın bırakır; yarı ihtimalle onarım cevheri de çıkar. Bekleme 16 sn.',
    'Süre 8 sn, yarıçap 30 m, merkezde saniyede 22 hasar. Girdap kapanınca 70 hasarlık bir su fışkırması patlar ve içerideki düşmanları dışarı savurur. Bekleme 14 sn.'
  ],
  tagline: 'Deniz, aşağıdan yutar.',
  active: {
    cooldown(lvl){ return pick3([18, 16, 14], lvl); },
    use(lvl){ return wpUse(lvl); }
  },
  onAcquire(){},
  update(dt){ wpUpdate(dt); },
  reset(){ wpReset(); }
});

})();
