/* combat.js - broadsides, projectiles, damage, enemy AI, director, XP and loot. */
(function () {
'use strict';
const G = window.G;

const DEG = Math.PI / 180;
const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;
const SPREAD_PLAYER = 1.5 * DEG;
const SPREAD_ENEMY = 4 * DEG;
const MAX_ROT = 28 * DEG;
const CONE_SIDE = 40 * DEG;
const CONE_BOW = 25 * DEG;
const FIRE_CONE = 22 * DEG;
const PROJ_CAP = 300;
const ORB_CAP = 150;
const LOOT_CAP = 30;
const MARKER_MAX = 12;
const ARC_N = 16;
const SHELL_RANGE = 170;
const WAVE_LEN = 45;
const BOSS_EVERY = 5;
const COST = { sloop: 1, fireship: 1.5, brig: 2.5, mortar: 3, galleon: 5 };
const UNLOCK = { sloop: 0, fireship: 40, brig: 60, mortar: 130, galleon: 180 };
const PLAYER_SIDE_TYPES = { lightning: 1, curse: 1, kraken: 1, shark: 1, harpoon: 1, vortex: 1, wave: 1, fire: 1 };

const V3 = THREE.Vector3;
const _dir = new V3(), _tgt = new V3(), _muz = new V3(), _pred = new V3(), _fw = new V3();
const _sy = new V3(), _vel = new V3(), _ground = new V3(), _lobFrom = new V3(), _np = new V3();
const _ring = new V3(), _tmp = new V3(), _lead = new V3();

const projectiles = [];
const meshPool = [];
const pending = [];
const enemyCache = [];
const orbs = [];
const orbPool = [];
const loot = [];
const muzzles = [], lands = [];
for (let i = 0; i < MARKER_MAX; i++) { muzzles.push(new V3()); lands.push(new V3()); }

let projGeo = null, orbGeo = null, orbMat = null, haloGeo = null, haloMat = null;
let glowGeo = null, warmGlowMat = null, redGlowMat = null, beamGeo = null, beamMat = null;
let crateGeo = null, topGeo = null, crossA = null, crossB = null;
let woodMat = null, goldMat = null, greenMat = null;
let markers = [], readyMat = null, reloadMat = null, lockMat = null, arcGeo = null, arcLine = null, arcPos = null;
let previewReady = false;

let dirT = 0, spawnT = 2, budget = 1, waveT = 0, waveNum = 0, firstDone = false;
let aimRange = 0;     // set by aimYaw()
let launchOk = true;  // set by solveLaunch()
let deadT = 0;        // seconds since the player died (enemies cease fire after CEASE_T)
const CEASE_T = 3;
let noDmgT = 0;       // seconds since the player last took damage (out-of-combat repair)

/* ------------------------------------------------------------------ helpers */

function live(s) { return !!s && s.alive && !s.sinking; }

function isHostileTeam(a, b) {
  if (!a || !b || a === b) return false;
  if (a === 'enemy') return b === 'player' || b === 'ally';
  if (b === 'enemy') return a === 'player' || a === 'ally';
  return false;
}

function countEnemies() {
  const l = G.ships.list; let n = 0;
  for (let j = 0; j < l.length; j++) if (l[j].team === 'enemy' && live(l[j])) n++;
  return n;
}

function bossAlive() {
  const l = G.ships.list;
  for (let j = 0; j < l.length; j++) if (l[j].isBoss && live(l[j])) return true;
  return false;
}

function later(t, fn) { pending.push({ t: t, fn: fn }); }

// Concurrent enemy cap, growing with run time (pacing).
function maxAlive() { return Math.min(G.CFG.MAX_ENEMIES, 2 + Math.floor(dirT / 25)); }

// Broadside side direction as a yaw angle. right = starboard = local -X (via G.util.right).
function sideYaw(s, side) {
  if (side === 'bow') return s.yaw;
  if (side === 'stern') return s.yaw + Math.PI;
  G.util.right(s.yaw, _sy);
  const a = Math.atan2(_sy.x, _sy.z);
  return side === 'right' ? a : a + Math.PI;
}

function sternBowMuzzle(s, side, out) {
  G.util.fwd(s.yaw, _fw);
  const k = side === 'bow' ? s.length * 0.5 : -s.length * 0.5;
  out.copy(s.pos).addScaledVector(_fw, k);
  out.y = s.pos.y + 1.5;
  return out;
}

// Yaw of the shot for a given base yaw and aim point; writes aimRange as a side effect.
function aimYaw(s, base, aim) {
  const dx = aim.x - s.pos.x, dz = aim.z - s.pos.z;
  aimRange = G.util.clamp(Math.sqrt(dx * dx + dz * dz), 18, s.stats.range);
  const diff = G.util.clamp(G.util.angDiff(base, Math.atan2(dx, dz)), -MAX_ROT, MAX_ROT);
  return base + diff;
}

// Ballistic solve. Writes launch velocity to outVel, returns flight time to the horizontal distance.
// launchOk = false when the target is out of range (velocity then uses 45 degrees).
function solveLaunch(from, to, v, g, high, outVel) {
  const dx = to.x - from.x, dz = to.z - from.z, dy = to.y - from.y;
  const d = Math.sqrt(dx * dx + dz * dz);
  const v2 = v * v;
  let th;
  launchOk = true;
  if (d < 0.01) {
    th = high ? 1.2 : 0.3;
  } else {
    const disc = v2 * v2 - g * (g * d * d + 2 * dy * v2);
    if (disc < 0) { th = Math.PI / 4; launchOk = false; }
    else { th = Math.atan((high ? v2 + Math.sqrt(disc) : v2 - Math.sqrt(disc)) / (g * d)); }
  }
  const hz = v * Math.cos(th);
  const ux = d > 0.01 ? dx / d : 0, uz = d > 0.01 ? dz / d : 1;
  outVel.set(ux * hz, v * Math.sin(th), uz * hz);
  return d / Math.max(hz, 0.01);
}

/* -------------------------------------------------------------- projectiles */

function acquireMesh() {
  let m = meshPool.pop();
  if (!m) {
    m = new THREE.Mesh(projGeo, new THREE.MeshBasicMaterial({ color: 0x222222 }));
    const gl = new THREE.Mesh(glowGeo, warmGlowMat);
    m.add(gl);
    m.glow = gl;
    if (G.scene) G.scene.add(m);
  }
  m.visible = true;
  return m;
}

function releaseProj(p) {
  if (p.mesh) { p.mesh.visible = false; meshPool.push(p.mesh); p.mesh = null; }
}

function removeProjAt(i) {
  releaseProj(projectiles[i]);
  projectiles[i] = projectiles[projectiles.length - 1];
  projectiles.pop();
}

function fireProjectile(opts) {
  opts = opts || {};
  // At the cap, the oldest projectile is flagged dead and removed by the simulation this frame.
  if (projectiles.length >= PROJ_CAP) projectiles[0].life = -1;
  const owner = opts.owner || null;
  const p = {
    pos: opts.pos ? new V3().copy(opts.pos) : new V3(),
    vel: opts.vel ? new V3().copy(opts.vel) : new V3(),
    owner: owner,
    team: opts.team || (owner ? owner.team : 'enemy'),
    damage: opts.damage != null ? opts.damage : (owner && owner.stats ? owner.stats.damage : 10),
    kind: opts.kind || 'ball',
    radius: opts.radius != null ? opts.radius : 0.7,
    gravity: opts.gravity != null ? opts.gravity : G.CFG.GRAVITY,
    life: opts.life != null ? opts.life : 8,
    bounces: opts.bounces || 0,
    pierce: opts.pierce || 0,
    blast: opts.blast || 0,
    flags: opts.flags || {},
    color: opts.color != null ? opts.color : 0x222222,
    scale: opts.scale != null ? opts.scale : 1,
    trail: opts.trail !== false,
    mesh: null,
    hitSet: [],
    trailT: 0
  };
  G.emit('proj:spawn', { proj: p });
  const m = acquireMesh();
  m.material.color.setHex(p.color);
  m.scale.setScalar(p.scale);
  m.position.copy(p.pos);
  m.glow.material = p.team === 'player' ? warmGlowMat : redGlowMat;
  p.mesh = m;
  projectiles.push(p);
  return p;
}

function launchAt(from, target, speed, opts) {
  opts = opts || {};
  const g = opts.gravity || G.CFG.GRAVITY;
  solveLaunch(from, target, speed > 0 ? speed : 60, g, !!opts.high, _vel);
  const o = Object.assign({}, opts, { pos: from, vel: _vel, gravity: g });
  if (!o.team) o.team = opts.owner ? opts.owner.team : 'enemy';
  return fireProjectile(o);
}

function registerHit(p, s) {
  const pos = new V3().copy(p.pos);
  const type = p.kind === 'mortar' ? 'mortar' : 'cannon';
  damageShip(s, p.damage, { type: type, owner: p.owner, pos: pos });
  G.emit('proj:hit', { proj: p, ship: s, pos: pos });
  if (G.vfx) { G.vfx.sparks(pos, 10); G.vfx.debris(pos, 6); G.vfx.smoke(pos, 2, 1); }
  const sp = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z) || 1;
  s.ext.x += p.vel.x / sp * 1.2;
  s.ext.z += p.vel.z / sp * 1.2;
  if (p.blast > 0) explode(pos, p.blast, p.damage * 0.6, { type: type, owner: p.owner, pos: pos }, p.team);
}

// Returns true when the projectile hit a ship and must be removed.
function hitShips(p) {
  const list = G.ships.list;
  for (let j = 0; j < list.length; j++) {
    const s = list[j];
    if (!live(s) || s === p.owner || !isHostileTeam(p.team, s.team)) continue;
    if (p.hitSet.indexOf(s) >= 0) continue;
    if (p.pos.y < s.pos.y - 2 || p.pos.y > s.pos.y + 7) continue;
    const dx = p.pos.x - s.pos.x, dz = p.pos.z - s.pos.z;
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const lx = -c * dx + sn * dz;   // along right (-cos, 0, sin)
    const lz = sn * dx + c * dz;    // along forward (sin, 0, cos)
    if (Math.abs(lx) >= s.width * 0.5 + p.radius) continue;
    if (Math.abs(lz) >= s.length * 0.5 + p.radius) continue;
    registerHit(p, s);
    if (p.pierce > 0) { p.pierce--; p.hitSet.push(s); continue; }
    return true;
  }
  return false;
}

function bounce(p, wh) {
  const sp = p.vel.length();
  const ns = sp * 0.65;
  const hs = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
  if (hs > 1e-4) { const f = ns * 0.937 / hs; p.vel.x *= f; p.vel.z *= f; }
  else { p.vel.x = 0; p.vel.z = 0; }
  p.vel.y = 0.35 * ns;
  p.pos.y = wh + 0.05;
  p.bounces--;
  if (G.vfx) G.vfx.splash(p.pos, 0.4);
  G.ocean.addRipple(p.pos.x, p.pos.z, 0.25);
}

function finishWater(p) {
  const pos = new V3().copy(p.pos);
  if (G.vfx) G.vfx.splash(pos, 1);
  G.ocean.addRipple(pos.x, pos.z, 0.4);
  if (p.blast > 0) explode(pos, p.blast, p.damage * 0.6, { type: p.kind === 'mortar' ? 'mortar' : 'cannon', owner: p.owner, pos: pos }, p.team);
  G.emit('proj:splash', { proj: p, pos: pos });
}

// Returns true when the projectile is finished and must be removed.
function stepProj(p, dt) {
  p.life -= dt;
  if (p.life <= 0) return true;
  const sp = p.vel.length();
  let n = Math.ceil(sp * dt / 1.5);
  if (n < 1) n = 1; else if (n > 12) n = 12;
  const h = dt / n;
  for (let k = 0; k < n; k++) {
    p.vel.y -= p.gravity * h;
    p.pos.addScaledVector(p.vel, h);
    if (hitShips(p)) return true;
    const wh = G.ocean.heightAt(p.pos.x, p.pos.z);
    if (p.vel.y < 0 && p.pos.y <= wh) {
      if (p.bounces > 0) bounce(p, wh);
      else { finishWater(p); return true; }
    }
  }
  if (p.trail && G.vfx) {
    p.trailT -= dt;
    if (p.trailT <= 0) { p.trailT = 0.05; G.vfx.smoke(p.pos, 1, 0.35); }
  }
  return false;
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    if (stepProj(p, dt)) removeProjAt(i);
    else if (p.mesh) p.mesh.position.copy(p.pos);
  }
}

/* ----------------------------------------------------------------- broadsides */

// Auto-aim target for a side: nearest hostile within range inside the side's cone.
function autoTarget(s, side) {
  if (side === 'stern') return null;
  const cone = side === 'bow' ? CONE_BOW : CONE_SIDE;
  const base = sideYaw(s, side);
  const range = s.stats.range;
  const l = G.ships.list;
  let best = null, bd = Infinity;
  for (let j = 0; j < l.length; j++) {
    const o = l[j];
    if (o === s || !live(o) || !isHostileTeam(s.team, o.team)) continue;
    const dx = o.pos.x - s.pos.x, dz = o.pos.z - s.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > range || d < 1) continue;
    if (Math.abs(G.util.angDiff(base, Math.atan2(dx, dz))) > cone) continue;
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function fireBall(s, muz, yaw, range) {
  const sp = s.team === 'player' ? SPREAD_PLAYER * 0.5 : SPREAD_ENEMY;
  const a = yaw + G.util.rand(-sp, sp);
  _dir.set(Math.sin(a), 0, Math.cos(a));
  _tgt.set(muz.x + _dir.x * range, 0, muz.z + _dir.z * range);
  _tgt.y = G.ocean.heightAt(_tgt.x, _tgt.z);
  launchAt(muz, _tgt, s.stats.projSpeed, {
    damage: s.team === 'player' ? s.stats.damage : s.stats.damage * enemyDmgRamp(),
    team: s.team, owner: s, kind: 'ball', radius: s.team === 'player' ? 1.3 : 0.7
  });
  if (G.vfx) G.vfx.muzzle(muz, _dir);
}

// Player aim assist: nearest live hostile within 16 m of the aim point (or the side cone when aim is null).
function assistTarget(s, side, aim) {
  if (s.team !== 'player') return null;
  if (!aim) return autoTarget(s, side);
  const l = G.ships.list;
  let best = null, bd = Infinity;
  for (let j = 0; j < l.length; j++) {
    const o = l[j];
    if (o === s || !live(o) || !isHostileTeam(s.team, o.team)) continue;
    const d = G.util.dist2D(aim, o.pos);
    if (d <= 16 && d < bd) { bd = d; best = o; }
  }
  return best;
}

// Landing point for one player cannon: target predicted twice (lead by velocity incl. ext),
// with the cannon's own offset from the ship centre scaled by 0.45 so the volley converges.
function assistLanding(s, muz, tgt, out) {
  const v = Math.max(1, s.stats.projSpeed);
  G.util.fwd(tgt.yaw, _fw);
  const vx = _fw.x * tgt.speed + tgt.ext.x, vz = _fw.z * tgt.speed + tgt.ext.z;
  let px = tgt.pos.x, pz = tgt.pos.z;
  for (let it = 0; it < 2; it++) {
    const T = Math.hypot(px - muz.x, pz - muz.z) / v;
    px = tgt.pos.x + vx * T;
    pz = tgt.pos.z + vz * T;
  }
  const cx = px + 0.45 * (muz.x - s.pos.x), cz = pz + 0.45 * (muz.z - s.pos.z);
  out.set(cx, 0, cz);
  out.y = G.ocean.heightAt(cx, cz);
  return out;
}

function fireAssisted(s, muz, tgt) {
  assistLanding(s, muz, tgt, _tgt);
  const dx = _tgt.x - muz.x, dz = _tgt.z - muz.z;
  const L = Math.sqrt(dx * dx + dz * dz) || 1;
  _dir.set(dx / L, 0, dz / L);
  launchAt(muz, _tgt, s.stats.projSpeed, { damage: s.stats.damage, team: s.team, owner: s, kind: 'ball', radius: 1.3 });
  if (G.vfx) G.vfx.muzzle(muz, _dir);
}

// Enemy aim error: +-11 m at start, shrinking linearly to +-4 m at 240 s.
function enemyAimErr() { return 11 + (4 - 11) * G.util.clamp(dirT / 240, 0, 1); }
// Enemy cannon damage multiplier: 0.6 at start, 1.0 at 120 s.
function enemyDmgRamp() { return 0.6 + 0.4 * G.util.clamp(dirT / 120, 0, 1); }

function firePending(s, side, i, aim) {
  if (!live(s)) return;
  const muz = _muz;
  if (side === 'bow' || side === 'stern') sternBowMuzzle(s, side, muz);
  else s.cannonPos(side, i, muz);
  if (s.team === 'player' && side !== 'bow' && side !== 'stern') {
    const at = assistTarget(s, side, aim);
    if (at) { fireAssisted(s, muz, at); return; }
  }
  const base = sideYaw(s, side);
  let yaw, range;
  if (aim) {
    yaw = aimYaw(s, base, aim); range = aimRange;
  } else {
    const tgt = autoTarget(s, side);
    if (tgt) {
      const dx = tgt.pos.x - s.pos.x, dz = tgt.pos.z - s.pos.z;
      const flight = Math.sqrt(dx * dx + dz * dz) / Math.max(1, s.stats.projSpeed);
      G.util.fwd(tgt.yaw, _fw);
      _pred.set(tgt.pos.x + (_fw.x * tgt.speed + tgt.ext.x) * flight, 0,
                tgt.pos.z + (_fw.z * tgt.speed + tgt.ext.z) * flight);
      yaw = aimYaw(s, base, _pred); range = aimRange;
    } else {
      yaw = base; range = s.stats.range * 0.7;
    }
  }
  fireBall(s, muz, yaw, range);
}

function tryFire(ship, side, aimPoint) {
  if (!live(ship)) return false;
  if (ship.status && ship.status.stunT > 0) return false;
  if (side !== 'left' && side !== 'right') return false;
  if (ship.reload[side] > 0) return false;
  const st = ship.stats;
  const n = st.cannonsPerSide | 0;
  if (n <= 0) return false;
  ship.reload[side] = st.reloadTime;
  const volleys = Math.max(1, st.volleys | 0);
  const stern = st.sternCannons | 0, bow = st.bowCannons | 0;
  const aim = aimPoint ? new V3().copy(aimPoint) : null;
  for (let v = 0; v < volleys; v++) {
    const base = 0.28 * v;
    for (let i = 0; i < n; i++) later(base + G.util.rand(0, 0.22), () => firePending(ship, side, i, aim));
    for (let i = 0; i < stern; i++) later(base + G.util.rand(0, 0.22), () => firePending(ship, 'stern', i, null));
    for (let i = 0; i < bow; i++) later(base + G.util.rand(0, 0.22), () => firePending(ship, 'bow', i, null));
  }
  G.emit('broadside:fired', { ship: ship, side: side, count: n * volleys });
  G.util.right(ship.yaw, _tmp);
  const k = side === 'right' ? -0.6 : 0.6;
  ship.ext.x += _tmp.x * k;
  ship.ext.z += _tmp.z * k;
  if (ship.team === 'player' && G.vfx) G.vfx.shake(0.12);
  return true;
}

/* ----------------------------------------------------------- aim preview */

function buildPreview() {
  if (!G.scene) return;
  readyMat = new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.7, depthWrite: false });
  reloadMat = new THREE.MeshBasicMaterial({ color: 0xa02020, transparent: true, opacity: 0.7, depthWrite: false });
  lockMat = new THREE.MeshBasicMaterial({ color: 0x5dff7a, transparent: true, opacity: 0.8, depthWrite: false });
  const rg = new THREE.RingGeometry(1.35, 1.6, 24);
  for (let i = 0; i < MARKER_MAX; i++) {
    const m = new THREE.Mesh(rg, readyMat);
    m.rotation.x = -HALF_PI;
    m.visible = false;
    G.scene.add(m);
    markers.push(m);
  }
  arcPos = new Float32Array(ARC_N * 3);
  arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3));
  const lm = new THREE.LineDashedMaterial({ color: 0xffe9a0, dashSize: 1.2, gapSize: 1.0, transparent: true, opacity: 0.6, depthWrite: false });
  arcLine = new THREE.Line(arcGeo, lm);
  arcLine.frustumCulled = false;
  arcLine.visible = false;
  G.scene.add(arcLine);
  previewReady = true;
}

function hidePreview() {
  if (!previewReady) return;
  for (let i = 0; i < markers.length; i++) markers[i].visible = false;
  arcLine.visible = false;
}

function updatePreview() {
  if (!previewReady) return;
  const P = G.player;
  if (G.state.mode !== 'playing' || !live(P) || !G.input.aimValid || !(P.stats.cannonsPerSide > 0)) { hidePreview(); return; }
  const aim = G.input.aim;
  G.util.right(P.yaw, _sy);
  const side = ((aim.x - P.pos.x) * _sy.x + (aim.z - P.pos.z) * _sy.z) >= 0 ? 'right' : 'left';
  const n = Math.min(MARKER_MAX, P.stats.cannonsPerSide | 0);
  const yaw = aimYaw(P, sideYaw(P, side), aim);
  const range = aimRange;
  const reloading = P.reload[side] > 0;
  const at = assistTarget(P, side, aim);
  for (let i = 0; i < MARKER_MAX; i++) {
    const m = markers[i];
    if (i >= n) { m.visible = false; continue; }
    P.cannonPos(side, i, muzzles[i]);
    if (at) {
      assistLanding(P, muzzles[i], at, lands[i]);
    } else {
      _dir.set(Math.sin(yaw), 0, Math.cos(yaw));
      lands[i].copy(muzzles[i]).addScaledVector(_dir, range);
      lands[i].y = G.ocean.heightAt(lands[i].x, lands[i].z);
    }
    m.position.set(lands[i].x, lands[i].y + 0.15, lands[i].z);
    m.material = at ? lockMat : (reloading ? reloadMat : readyMat);
    m.visible = true;
  }
  const mid = (n - 1) >> 1;
  const from = muzzles[mid];
  const g = G.CFG.GRAVITY;
  const T = solveLaunch(from, lands[mid], P.stats.projSpeed, g, false, _vel);
  for (let k = 0; k < ARC_N; k++) {
    const t = T * k / (ARC_N - 1);
    arcPos[3 * k] = from.x + _vel.x * t;
    arcPos[3 * k + 1] = from.y + _vel.y * t - 0.5 * g * t * t;
    arcPos[3 * k + 2] = from.z + _vel.z * t;
  }
  arcGeo.attributes.position.needsUpdate = true;
  arcLine.computeLineDistances();
  arcLine.visible = true;
}

/* ------------------------------------------------------------------ damage */

function showDamageNumber(ship, amount, type) {
  if (!G.vfx) return;
  let v = amount;
  if (type === 'fire') {
    // merge tiny burn ticks: accumulate fractions and show whole numbers only
    const acc = (ship.ai.burnAcc || 0) + amount;
    const whole = Math.floor(acc);
    ship.ai.burnAcc = acc - whole;
    v = whole;
  }
  const shown = Math.round(v);
  if (shown < 1) return;
  let color = '#ffffff';
  if (ship === G.player) color = '#ff4d4d';
  else if (type === 'fire') color = '#ff9a3c';
  else if (type === 'lightning') color = '#6ff3ff';
  else if (type === 'curse') color = '#c08bff';
  _np.copy(ship.pos);
  _np.y += 6;
  G.vfx.hitNumber(_np, String(shown), color);
}

function damageShip(ship, amount, source) {
  if (!ship || !ship.alive || !(amount > 0)) return 0;
  const info = { ship: ship, amount: amount, source: source || null, cancel: false };
  G.emit('ship:predamage', info);
  if (info.cancel || !(info.amount > 0)) return 0;
  const dmg = info.amount;
  ship.hp -= dmg;
  if (ship === G.player) noDmgT = 0;
  const type = source && source.type ? source.type : 'cannon';
  const owner = source ? source.owner : null;
  if (ship.team === 'enemy') {
    if (owner && (owner.team === 'player' || owner.team === 'ally')) G.state.damageDealt += dmg;
    else if (!owner && PLAYER_SIDE_TYPES[type]) G.state.damageDealt += dmg;
  }
  G.emit('ship:damaged', { ship: ship, amount: dmg, source: source || null });
  showDamageNumber(ship, dmg, type);
  if (owner === G.player && ship.team === 'enemy') flashShip(ship);
  if (type === 'cannon' && owner && owner === G.player) G.vfx && G.vfx.hitstop(0.03);
  if (ship === G.player && G.vfx) G.vfx.shake(type === 'fire' ? 0.1 : 0.3);
  if (ship.hp <= 0) killShip(ship, source || null);
  return dmg;
}

// Hit flash: 0.08 s white tint on enemies hit by the player. Skips curse-tinted ships and fireships
// (their own warning pulse owns the tint).
function flashShip(s) {
  if (!G.ships.setTint || !s.ai) return;
  if (s.type === 'fireship' || (s.status && s.status.curseT > 0)) return;
  if ((s.ai.tintT || 0) > 0) { s.ai.tintT = 0.08; return; }
  G.ships.setTint(s, 0xffffff);
  s.ai.tintT = 0.08;
  s.ai.flashing = true;
}

function tickFlash(dt) {
  const l = G.ships.list;
  for (let j = 0; j < l.length; j++) {
    const s = l[j];
    if (!s.ai || !s.ai.flashing) continue;
    s.ai.tintT -= dt;
    if (s.ai.tintT <= 0) {
      s.ai.flashing = false;
      s.ai.tintT = 0;
      if (G.ships.setTint && !(s.status && s.status.curseT > 0)) G.ships.setTint(s, null);
    }
  }
}

function killShip(ship, source) {
  if (!ship || !ship.alive) return;
  const ev = { ship: ship, source: source || null, cancel: false };
  G.emit('ship:prekill', ev);
  if (ev.cancel) return;
  ship.alive = false;
  ship.sinking = true;
  ship.sinkT = 0;
  ship.hp = 0;
  const pos = ship.pos;
  if (G.vfx) {
    G.vfx.explosion(pos, ship.length / 12);
    G.vfx.debris(pos, 20);
    G.vfx.shake(0.5);
  }
  G.ocean.addRipple(pos.x, pos.z, 1.2);
  if (ship.team === 'enemy') {
    const def = ship.def || { xp: 10 };
    G.state.kills++;
    G.state.score += def.xp * 10;
    // first three kills of a run give x1.6 XP so level 2 comes after kill 2 and level 3 near kill 5
    dropXP(pos, def.xp * (G.state.kills <= 3 ? 1.6 : 1));
    if (ship.isBoss) {
      G.state.bossKills++;
      const gold = G.util.randInt(3, 5), rep = 2;
      for (let k = 0; k < gold; k++) dropLoot(pos, 'gold');
      for (let k = 0; k < rep; k++) dropLoot(pos, 'repair');
    } else {
      if (Math.random() < 0.35) dropLoot(pos, 'gold');
      if (Math.random() < 0.12) dropLoot(pos, 'repair');
    }
  }
  G.emit('ship:killed', { ship: ship, source: source || null });
}

function explode(pos, radius, damage, source, team) {
  if (!pos) return;
  if (G.vfx) G.vfx.explosion(pos, radius / 5);
  G.ocean.addRipple(pos.x, pos.z, radius * 0.12);
  const tm = team || 'player';
  const src = source || { type: 'explosion', owner: null, pos: null };
  const l = G.ships.list;
  for (let j = 0; j < l.length; j++) {
    const s = l[j];
    if (!live(s) || !isHostileTeam(tm, s.team)) continue;
    const dx = s.pos.x - pos.x, dz = s.pos.z - pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > radius + s.radius) continue;
    const f = 1 - 0.65 * G.util.clamp(d / radius, 0, 1);
    damageShip(s, damage * f, { type: src.type, owner: src.owner, pos: new V3().copy(pos) });
    if (d > 0.01) { s.ext.x += dx / d * 3 * f; s.ext.z += dz / d * 3 * f; }
  }
}

function heal(amount) {
  const P = G.player;
  if (!P || !P.alive || !(amount > 0)) return 0;
  const before = P.hp;
  P.hp = Math.min(P.stats.maxHp, P.hp + amount);
  const got = P.hp - before;
  G.emit('player:healed', { amount: got });
  if (G.vfx && got >= 0.5) {
    _np.copy(P.pos);
    _np.y += 7;
    G.vfx.hitNumber(_np, '+' + Math.round(got), '#6dff8a');
  }
  return got;
}

function addXP(n) {
  G.state.xp += n;
  G.state.score += n;
  G.emit('xp:gained', { amount: n });
  while (G.state.xp >= G.state.xpNext) {
    G.state.xp -= G.state.xpNext;
    G.state.level++;
    G.state.xpNext = G.xpForLevel(G.state.level);
    G.emit('player:levelup', { level: G.state.level });
  }
}

function addGold(n) {
  G.state.gold += n;
  G.state.score += n;
  G.emit('gold:gained', { amount: n });
}

/* ----------------------------------------------------------------- pickups */

function acquireOrb() {
  let o = orbPool.pop();
  if (!o) {
    o = { mesh: new THREE.Mesh(orbGeo, orbMat), pos: new V3(), vel: new V3(), age: 0, value: 0, settled: false, spd: 0, phase: 0 };
    o.mesh.add(new THREE.Mesh(haloGeo, haloMat));
    if (G.scene) G.scene.add(o.mesh);
  }
  o.mesh.visible = true;
  o.mesh.scale.set(1, 1, 1);
  o.age = 0; o.settled = false; o.spd = 0; o.trailT = 0; o.pulling = false;
  return o;
}

function releaseOrb(o) { o.mesh.visible = false; orbPool.push(o); }

function dropXP(pos, amount) {
  if (!pos || !(amount > 0)) return;
  const n = G.util.randInt(3, 8);
  const each = amount / n;
  for (let k = 0; k < n; k++) {
    if (orbs.length >= ORB_CAP) releaseOrb(orbs.shift());
    const o = acquireOrb();
    o.pos.set(pos.x + G.util.rand(-1.5, 1.5), pos.y + 1.5, pos.z + G.util.rand(-1.5, 1.5));
    o.vel.set(G.util.rand(-5, 5), G.util.rand(6, 11), G.util.rand(-5, 5));
    o.value = each;
    o.phase = G.util.rand(0, TAU);
    o.mesh.position.copy(o.pos);
    orbs.push(o);
  }
}

function updateOrbs(dt) {
  const P = G.player;
  const magR = G.CFG.XP_MAGNET * ((P && P.stats && P.stats.magnet) || 1);
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    o.age += dt;
    if (!o.settled) {
      o.vel.y -= 22 * dt;
      o.pos.addScaledVector(o.vel, dt);
      const k = Math.exp(-3 * dt);
      o.vel.x *= k; o.vel.z *= k;
      if (o.pos.y <= G.ocean.heightAt(o.pos.x, o.pos.z) + 1.2 && o.vel.y <= 0) { o.settled = true; o.vel.set(0, 0, 0); }
    }
    if (live(P)) {
      const dx = P.pos.x - o.pos.x, dz = P.pos.z - o.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 3) {
        addXP(o.value);
        releaseOrb(o);
        orbs.splice(i, 1);
        continue;
      }
      if (d < magR || o.age > 40) {
        o.settled = true;
        o.pulling = true;
        o.spd = Math.min(40, o.spd + 60 * dt);
        const inv = o.spd * dt / d;
        o.pos.x += dx * inv;
        o.pos.z += dz * inv;
      }
    }
    if (o.settled) o.pos.y = G.ocean.heightAt(o.pos.x, o.pos.z) + 1.2 + Math.sin(G.time * 3 + o.phase) * 0.15;
    o.mesh.position.copy(o.pos);
    // pulse and spin; stretch and trail while magnetized toward the player
    const pulse = 1 + 0.12 * Math.sin(G.time * 4 + o.phase);
    o.mesh.rotation.y += dt * 2;
    o.mesh.scale.set(pulse, pulse, pulse * (o.pulling ? 1.5 : 1));
    if (o.pulling && G.vfx) {
      o.trailT -= dt;
      if (o.trailT <= 0) { o.trailT = 0.1; G.vfx.ghostPuff(o.pos, 0.3); }
    }
    o.pulling = false;
  }
}

function makeCrate(kind) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(crateGeo, woodMat));
  if (kind === 'gold') {
    const top = new THREE.Mesh(topGeo, goldMat);
    top.position.y = 0.65;
    g.add(top);
  } else {
    const a = new THREE.Mesh(crossA, greenMat); a.position.y = 0.65; g.add(a);
    const b = new THREE.Mesh(crossB, greenMat); b.position.y = 0.65; g.add(b);
  }
  // crate is 2.2 m; a soft vertical beam (8 m) marks it from afar
  g.scale.setScalar(1.375);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 2.9;
  beam.scale.y = 0.727;
  g.add(beam);
  return g;
}

function dropLoot(pos, kind) {
  if (!pos) return;
  const k = kind === 'repair' ? 'repair' : 'gold';
  const g = makeCrate(k);
  g.position.set(pos.x, G.ocean.heightAt(pos.x, pos.z) + 0.6, pos.z);
  if (G.scene) G.scene.add(g);
  loot.push({ kind: k, mesh: g, age: 0, phase: G.util.rand(0, TAU) });
  if (loot.length > LOOT_CAP) {
    const old = loot.shift();
    if (G.scene) G.scene.remove(old.mesh);
  }
}

function updateLoot(dt) {
  const P = G.player;
  const magR = G.CFG.XP_MAGNET * ((P && P.stats && P.stats.magnet) || 1);
  for (let i = loot.length - 1; i >= 0; i--) {
    const L = loot[i];
    L.age += dt;
    const m = L.mesh;
    m.position.y = G.ocean.heightAt(m.position.x, m.position.z) + 0.6 + Math.sin(G.time * 2 + L.phase) * 0.2;
    m.rotation.y += dt * 0.7;
    let remove = L.age > 60;
    if (live(P)) {
      const dx = P.pos.x - m.position.x, dz = P.pos.z - m.position.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 5) {
        if (L.kind === 'repair') heal(25);
        else {
          const n = G.util.randInt(15, 40);
          addGold(n);
          if (G.vfx) { _np.copy(m.position); _np.y += 3; G.vfx.hitNumber(_np, '+' + n, '#ffd54a'); }
        }
        remove = true;
      } else if (d < magR * 0.5 && d > 0.01) {
        const step = Math.min(d, 12 * dt);
        m.position.x += dx / d * step;
        m.position.z += dz / d * step;
      }
    }
    if (remove) {
      if (G.scene) G.scene.remove(m);
      loot.splice(i, 1);
    }
  }
}

/* ---------------------------------------------------------- spawning & AI */

function ringPoint(out) {
  const P = G.player;
  let cx = 0, cz = 0, yaw = 0;
  if (P) {
    // centre the ring where the player will be in 6 s, so enemies cross the player's path
    G.util.fwd(P.yaw, _fw);
    const ahead = Math.max(0, P.speed) * 6;
    cx = P.pos.x + _fw.x * ahead;
    cz = P.pos.z + _fw.z * ahead;
    yaw = P.yaw;
  }
  const a = yaw + G.util.rand(-100, 100) * DEG;
  const r = G.util.rand(G.CFG.SPAWN_MIN, G.CFG.SPAWN_MAX);
  out.set(cx + Math.sin(a) * r, 0, cz + Math.cos(a) * r);
  return out;
}

function isBroadside(type) { return type !== 'fireship' && type !== 'mortar'; }

function setupAI(s) {
  s.ai = {
    state: 'approach', tgt: null, retT: 0,
    orbit: Math.random() < 0.5 ? -1 : 1, orbitT: 0, t: 0,
    lobT: G.util.rand(1.5, 3), specialT: 9, flip: false,
    lifeT: -1, dist: G.util.rand(90, 130), burnAcc: 0, tintOn: false,
    baseMaxSpeed: s.stats.maxSpeed, stallT: 0, unstuckT: 0
  };
  if (s.type === 'boss') s.isBoss = true;
  if (s.type === 'ghost') s.isGhost = true;
  if (isBroadside(s.type) && s.reload) {
    s.reload.left = G.util.rand(1, 2.5);
    s.reload.right = G.util.rand(1, 2.5);
  }
}

function spawnEnemy(type, x, z) {
  if (x == null || z == null) { ringPoint(_ring); x = _ring.x; z = _ring.z; }
  const P = G.player;
  const yaw = P ? Math.atan2(P.pos.x - x, P.pos.z - z) + G.util.rand(-0.3, 0.3) : 0;
  const s = G.ships.create(type, { team: 'enemy', x: x, z: z, yaw: yaw });
  if (!s) return null;
  const hpMul = 1 + dirT / 150, dmgMul = 1 + dirT / 300;
  s.hp *= hpMul;
  s.stats.maxHp *= hpMul;
  s.stats.damage *= dmgMul;
  setupAI(s);
  if (type === 'boss') G.emit('boss:spawned', { ship: s });
  return s;
}

function spawnAlly(type, x, z, lifetime) {
  const P = G.player;
  if (x == null || z == null) {
    x = (P ? P.pos.x : 0) + G.util.rand(-15, 15);
    z = (P ? P.pos.z : 0) + G.util.rand(-15, 15);
  }
  const s = G.ships.create(type, { team: 'ally', x: x, z: z, yaw: P ? P.yaw : 0 });
  if (!s) return null;
  setupAI(s);
  s.ai.lifeT = lifetime > 0 ? lifetime : 45;
  if (type === 'ghost' && G.ships.setGhost) G.ships.setGhost(s, true);
  return s;
}

function enemiesList() { return enemyCache; }

function pickTarget(s) {
  if (s.team === 'ally') return nearestEnemy(s.pos, Infinity, null);
  const P = G.player;
  const playerOk = live(P);
  let ally = null, da = Infinity;
  const l = G.ships.list;
  for (let j = 0; j < l.length; j++) {
    const o = l[j];
    if (o.team === 'ally' && live(o)) {
      const d = G.util.dist2D(s.pos, o.pos);
      if (d < da) { da = d; ally = o; }
    }
  }
  if (ally && (!playerOk || da < G.util.dist2D(s.pos, P.pos) * 0.5)) return ally;
  return playerOk ? P : null;
}

// Steers toward a desired yaw with separation from nearby ships (unless noSep).
function steer(s, desired, noSep) {
  let sx = 0, sz = 0;
  if (!noSep) {
    const l = G.ships.list;
    for (let j = 0; j < l.length; j++) {
      const o = l[j];
      if (o === s || !o.alive) continue;
      const rs = s.radius + o.radius + 8;
      const dx = s.pos.x - o.pos.x, dz = s.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rs * rs || d2 < 0.01) continue;
      const d = Math.sqrt(d2);
      const w = (rs - d) / rs;
      sx += dx / d * w;
      sz += dz / d * w;
    }
  }
  let want = desired;
  if (sx !== 0 || sz !== 0) want = Math.atan2(Math.sin(desired) + sx * 1.5, Math.cos(desired) + sz * 1.5);
  s.rudder = G.util.clamp(G.util.angDiff(s.yaw, want) * 2, -1, 1);
}

function chooseOrbit(s, bearing) {
  const a = Math.abs(G.util.angDiff(s.yaw, bearing + HALF_PI));
  const b = Math.abs(G.util.angDiff(s.yaw, bearing - HALF_PI));
  return a <= b ? 1 : -1;
}

function tryBroadsideFire(s, tgt, d, bearing) {
  if (d > 0.85 * s.stats.range) return;
  // first broadside only after 3 s in range
  if (!s.ai.fired && (s.ai.rangeT || 0) < 3) return;
  const sides = ['right', 'left'];
  for (let k = 0; k < 2; k++) {
    const side = sides[k];
    if (Math.abs(G.util.angDiff(sideYaw(s, side), bearing)) > FIRE_CONE) continue;
    const flight = d / Math.max(1, s.stats.projSpeed);
    const err = enemyAimErr();
    G.util.fwd(tgt.yaw, _fw);
    _pred.set(
      tgt.pos.x + (_fw.x * tgt.speed + tgt.ext.x) * flight + G.util.rand(-err, err), 0,
      tgt.pos.z + (_fw.z * tgt.speed + tgt.ext.z) * flight + G.util.rand(-err, err));
    if (tryFire(s, side, _pred)) {
      s.ai.fired = true;
      // sloops break away for 4 s, presenting their stern
      if (s.type === 'sloop') { s.ai.state = 'break'; s.ai.t = 4; }
    }
    return;
  }
}

function aiBroadside(s, dt) {
  const ai = s.ai, tgt = ai.tgt;
  if (!tgt) { s.throttle = 0.5; steer(s, s.yaw, false); return; }
  const range = s.stats.range;
  const dx = tgt.pos.x - s.pos.x, dz = tgt.pos.z - s.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const bearing = Math.atan2(dx, dz);
  if (ai.state === 'break') {
    ai.t -= dt;
    if (ai.t <= 0) ai.state = 'approach';
    s.throttle = 1;
    steer(s, bearing + Math.PI, false);
  } else if (ai.state === 'approach') {
    s.throttle = 1;
    // stall watchdog: if the ship is barely moving for 3 s, rudder hard for 2 s
    ai.stallT = Math.abs(s.speed) < 2 ? ai.stallT + dt : 0;
    if (ai.stallT > 3) { ai.stallT = 0; ai.unstuckT = 2; }
    if (ai.unstuckT > 0) {
      ai.unstuckT -= dt;
      s.rudder = ai.orbit;
    } else {
      const lead = leadPoint(s, tgt, d, 0.6);
      steer(s, Math.atan2(lead.x - s.pos.x, lead.z - s.pos.z), false);
    }
    if (d <= 0.75 * range) {
      ai.state = 'broadside';
      ai.orbit = chooseOrbit(s, bearing);
      ai.orbitT = 6;
    }
  } else {
    ai.orbitT -= dt;
    if (ai.orbitT <= 0) { ai.orbit = chooseOrbit(s, bearing); ai.orbitT = 6; }
    if (d > 1.6 * range) ai.state = 'approach';
    let off = 90 * DEG;
    if (d < 0.55 * range) { off = 120 * DEG; s.throttle = 0.6; }
    else if (d > 0.7 * range) { off = 60 * DEG; s.throttle = 1; }
    else s.throttle = 0.8;
    steer(s, bearing + ai.orbit * off, false);
  }
  if (d <= range) ai.rangeT = (ai.rangeT || 0) + dt;
  if (ai.state !== 'break') tryBroadsideFire(s, tgt, d, bearing);
  if (s.isBoss) bossSpecial(s, dt);
}

function lobShell(s, aim) {
  const v = s.stats.projSpeed || 60;
  _lobFrom.copy(s.pos);
  _lobFrom.y += 4;
  const T = solveLaunch(_lobFrom, aim, v, G.CFG.GRAVITY, true, _vel);
  if (!launchOk) return false;
  _ground.set(aim.x, G.ocean.heightAt(aim.x, aim.z), aim.z);
  if (G.vfx) G.vfx.ring(_ground, 9, 0xff2200, T);
  launchAt(_lobFrom, _ground, v, { high: true, kind: 'mortar', blast: 9, damage: 16, scale: 1.8, color: 0x331100, team: s.team, owner: s });
  return true;
}

function bossSpecial(s, dt) {
  const ai = s.ai;
  ai.specialT -= dt;
  if (ai.specialT > 0) return;
  ai.specialT = 9;
  ai.flip = !ai.flip;
  if (ai.flip) {
    // (a) two sloops next to the flagship
    if (countEnemies() < maxAlive() + 2) {
      for (let k = 0; k < 2; k++) spawnEnemy('sloop', s.pos.x + G.util.rand(-12, 12), s.pos.z + G.util.rand(-12, 12));
    }
  } else {
    // (b) three-shell mortar barrage around the player, with warning rings
    for (let k = 0; k < 3; k++) {
      later(0.6 * k, () => {
        const P = G.player;
        if (!live(s) || !live(P)) return;
        lobShell(s, new V3(P.pos.x + G.util.rand(-12, 12), 0, P.pos.z + G.util.rand(-12, 12)));
      });
    }
  }
}

function aiFireship(s, dt) {
  const ai = s.ai, tgt = ai.tgt;
  if (!tgt) { s.throttle = 0.3; steer(s, s.yaw, true); return; }
  s.throttle = 1;
  const dx = tgt.pos.x - s.pos.x, dz = tgt.pos.z - s.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const T = d / Math.max(8, Math.abs(s.speed));
  G.util.fwd(tgt.yaw, _fw);
  const px = tgt.pos.x + (_fw.x * tgt.speed + tgt.ext.x) * T;
  const pz = tgt.pos.z + (_fw.z * tgt.speed + tgt.ext.z) * T;
  steer(s, Math.atan2(px - s.pos.x, pz - s.pos.z), true);
  if (d < 40) {
    const on = Math.floor(G.time * 6) % 2 === 0;
    if (on !== ai.tintOn) { ai.tintOn = on; if (G.ships.setTint) G.ships.setTint(s, on ? 0xff3300 : null); }
  } else if (ai.tintOn) {
    ai.tintOn = false;
    if (G.ships.setTint) G.ships.setTint(s, null);
  }
  if (d <= 7 + tgt.radius) detonateFireship(s);
}

function detonateFireship(s) {
  if (!live(s)) return;
  const src = { type: 'explosion', owner: s, pos: new V3().copy(s.pos) };
  explode(s.pos, 16, 34, src, s.team);
  killShip(s, src);
}

function aiMortar(s, dt) {
  const ai = s.ai, tgt = ai.tgt;
  if (!tgt) { s.throttle = 0.5; steer(s, s.yaw, false); return; }
  const dx = tgt.pos.x - s.pos.x, dz = tgt.pos.z - s.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const bearing = Math.atan2(dx, dz);
  let want;
  if (d > ai.dist + 10) want = bearing;
  else if (d < ai.dist - 10) want = bearing + Math.PI;
  else want = bearing + ai.orbit * HALF_PI;
  s.throttle = 0.5;
  steer(s, want, false);
  ai.lobT -= dt;
  if (ai.lobT > 0) return;
  ai.lobT = 1;
  if (d > SHELL_RANGE) return;
  const v = s.stats.projSpeed || 60;
  _lobFrom.copy(s.pos);
  _lobFrom.y += 4;
  const T0 = solveLaunch(_lobFrom, tgt.pos, v, G.CFG.GRAVITY, true, _vel);
  if (!launchOk) return;
  G.util.fwd(tgt.yaw, _fw);
  _pred.set(tgt.pos.x + (_fw.x * tgt.speed + tgt.ext.x) * T0, 0,
            tgt.pos.z + (_fw.z * tgt.speed + tgt.ext.z) * T0);
  if (lobShell(s, _pred)) ai.lobT = 5;
}

function runAI(s, dt) {
  const ai = s.ai;
  ai.retT -= dt;
  if (!live(ai.tgt) || ai.retT <= 0) { ai.tgt = pickTarget(s); ai.retT = 2; }
  if (s.team === 'ally' && ai.lifeT > 0) {
    ai.lifeT -= dt;
    if (ai.lifeT <= 0) { killShip(s, { type: 'wave', owner: null, pos: null }); return; }
  }
  if (s.team === 'enemy') {
    if (deadT > CEASE_T) { cruise(s); return; }   // player is dead: sail around, no fire
    catchUp(s);
  }
  if (s.type === 'fireship') aiFireship(s, dt);
  else if (s.type === 'mortar') aiMortar(s, dt);
  else aiBroadside(s, dt);
}

function runAllAI(dt) {
  const l = G.ships.list;
  for (let j = l.length - 1; j >= 0; j--) {
    const s = l[j];
    if (!s || s.team === 'player' || !s.alive || s.sinking || !s.ai) continue;
    runAI(s, dt);
  }
}

// Lead point for pursuit: target position plus its velocity over the time we need to close, scaled by k.
function leadPoint(s, tgt, d, k) {
  const own = Math.max(5, s.ai.baseMaxSpeed || s.stats.maxSpeed);
  const T = d / own * k;
  G.util.fwd(tgt.yaw, _fw);
  _lead.set(tgt.pos.x + (_fw.x * tgt.speed + tgt.ext.x) * T, 0,
            tgt.pos.z + (_fw.z * tgt.speed + tgt.ext.z) * T);
  return _lead;
}

// Catch-up: enemies beyond 1.1x range get up to 2.2x top speed so they can reach a fleeing player.
function catchUp(s) {
  const base = s.ai.baseMaxSpeed;
  let f = 1;
  const tgt = s.ai.tgt;
  if (tgt && isBroadside(s.type)) {
    const R = s.stats.range * 1.1;
    const d = G.util.dist2D(s.pos, tgt.pos);
    f = G.util.clamp(1 + (d - R) / Math.max(1, 250 - R) * 1.2, 1, 2.2);
  }
  s.stats.maxSpeed = base * f;
}

// No target (or cease-fire): hold a slow cruise, never stop.
function cruise(s) {
  s.stats.maxSpeed = s.ai.baseMaxSpeed;
  s.throttle = 0.5;
  steer(s, s.yaw + 0.25 * Math.sin(G.time * 0.4 + s.id), false);
}

function onCollide(ev) {
  const a = ev && ev.a, b = ev && ev.b;
  if (!live(a) || !live(b)) return;
  if (!isHostileTeam(a.team, b.team)) return;
  if (a.type === 'fireship') detonateFireship(a);
  if (b.type === 'fireship') detonateFireship(b);
  const rel = ev.relSpeed || 0;
  if (rel > 6) {
    const pa = new V3().copy(a.pos), pb = new V3().copy(b.pos);
    damageShip(a, rel * 0.6, { type: 'collision', owner: b, pos: pa });
    damageShip(b, rel * 0.6, { type: 'collision', owner: a, pos: pb });
  }
}

function nearestEnemy(pos, maxDist, exclude) {
  const lim = maxDist == null ? Infinity : maxDist;
  let best = null, bd = Infinity;
  for (let j = 0; j < enemyCache.length; j++) {
    const e = enemyCache[j];
    if (exclude) {
      if (exclude instanceof Set ? exclude.has(e) : e === exclude) continue;
    }
    const d = G.util.dist2D(pos, e.pos);
    if (d <= lim && d < bd) { bd = d; best = e; }
  }
  return best;
}

function buildEnemyCache() {
  enemyCache.length = 0;
  const l = G.ships.list;
  for (let j = 0; j < l.length; j++) if (l[j].team === 'enemy' && live(l[j])) enemyCache.push(l[j]);
}

/* ---------------------------------------------------------------- director */

const WEIGHT = { sloop: 3, fireship: 2, brig: 2.5, mortar: 1.5, galleon: 1 };
function pickSpawnType() {
  const c = [];
  let total = 0;
  for (const k in COST) {
    if (dirT >= UNLOCK[k] && COST[k] <= budget) { c.push(k); total += WEIGHT[k]; }
  }
  if (!c.length) return null;
  let r = Math.random() * total;
  for (let i = 0; i < c.length; i++) {
    r -= WEIGHT[c[i]];
    if (r <= 0) return c[i];
  }
  return c[c.length - 1];
}

function spawnPack() {
  const P = G.player;
  if (!live(P)) return;
  const room = maxAlive() - countEnemies();
  if (room <= 0) return;
  const themes = ['sloops'];
  if (dirT >= UNLOCK.fireship) themes.push('fireships');
  if (dirT >= UNLOCK.brig) themes.push('brigs');
  const theme = themes[Math.floor(Math.random() * themes.length)];
  ringPoint(_ring);
  const cx = _ring.x, cz = _ring.z;
  const rx = cx - P.pos.x, rz = cz - P.pos.z;
  const rl = Math.sqrt(rx * rx + rz * rz) || 1;
  const tx = rz / rl, tz = -rx / rl;   // tangent, perpendicular to the radial
  let type, offs = [];
  if (theme === 'sloops') { type = 'sloop'; offs = [-16, 0, 16]; }
  else if (theme === 'brigs') { type = 'brig'; offs = [-18, 18]; }
  else {
    type = 'fireship';
    const n = Math.random() < 0.5 ? 3 : 4;
    for (let k = 0; k < n; k++) offs.push(G.util.rand(-18, 18));
  }
  for (let k = 0; k < offs.length && k < room; k++) {
    spawnEnemy(type, cx + tx * offs[k], cz + tz * offs[k]);
  }
}

function waveStep(dt) {
  waveT += dt;
  if (waveT < WAVE_LEN) return;
  waveT -= WAVE_LEN;
  waveNum++;
  G.state.wave = waveNum;
  G.emit('wave:started', { wave: waveNum });
  if (waveNum % BOSS_EVERY === 0) {
    if (!bossAlive()) spawnEnemy('boss');
    if (G.ui && G.ui.banner) G.ui.banner('KARA AMİRAL', 'Denizlerin laneti üzerine geliyor!');
  } else {
    spawnPack();
    if (G.ui && G.ui.toast) G.ui.toast('DALGA ' + waveNum, '#ffd54a');
  }
}

function director(dt) {
  const P = G.player;
  if (!live(P)) return;
  waveStep(dt);
  budget = Math.min(budget + dt * (0.35 + dirT / 200), 10 + dirT / 20);
  spawnT -= dt;
  if (spawnT > 0) return;
  spawnT = G.util.lerp(5, 1.8, G.util.clamp(dirT / 300, 0, 1)) * G.util.rand(0.85, 1.15);
  if (countEnemies() >= maxAlive()) return;
  if (!firstDone) { firstDone = true; spawnEnemy('sloop'); return; }
  let type;
  if (dirT < 30) {
    // opening: sloops only, one at a time for the first 15 s
    if (dirT < 15 && countEnemies() >= 1) return;
    type = 'sloop';
  } else {
    type = pickSpawnType();
  }
  if (!type) return;
  budget -= COST[type];
  spawnEnemy(type);
}

function despawnFar(P) {
  const l = G.ships.list;
  for (let j = l.length - 1; j >= 0; j--) {
    const s = l[j];
    if (s.team !== 'enemy' || s.isBoss || !s.alive) continue;
    if (G.util.dist2D(s.pos, P.pos) > G.CFG.DESPAWN) G.ships.remove(s);
  }
}

/* ------------------------------------------------------------- main loop */

// Out-of-combat repair: after 6 s without damage, +1.5 hp/s up to 60% of max hp (silent).
function repairTick(dt) {
  const P = G.player;
  noDmgT += dt;
  if (!live(P) || noDmgT < 6) return;
  const cap = P.stats.maxHp * 0.6;
  if (P.hp < cap) P.hp = Math.min(cap, P.hp + 1.5 * dt);
}

function tickReload(dt) {
  const l = G.ships.list;
  for (let j = 0; j < l.length; j++) {
    const r = l[j].reload;
    if (!r) continue;
    if (r.left > 0) r.left = Math.max(0, r.left - dt);
    if (r.right > 0) r.right = Math.max(0, r.right - dt);
  }
}

function runPending(dt) {
  for (let i = pending.length - 1; i >= 0; i--) {
    const q = pending[i];
    q.t -= dt;
    if (q.t <= 0) { pending.splice(i, 1); q.fn(); }
  }
}

function init() {
  projGeo = new THREE.SphereGeometry(0.6, 8, 6);
  orbGeo = new THREE.SphereGeometry(0.55, 10, 8);
  orbMat = new THREE.MeshBasicMaterial({ color: 0x7dffc8 });
  haloGeo = new THREE.SphereGeometry(1.6, 12, 8);
  haloMat = new THREE.MeshBasicMaterial({ color: 0x7dffc8, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  glowGeo = new THREE.SphereGeometry(1.0, 8, 6);
  warmGlowMat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  redGlowMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
  beamGeo = new THREE.CylinderGeometry(0.25, 0.25, 8, 8, 1, true);
  beamMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  crateGeo = new THREE.BoxGeometry(1.6, 1.1, 1.6);
  topGeo = new THREE.BoxGeometry(1.2, 0.2, 1.2);
  crossA = new THREE.BoxGeometry(0.35, 0.2, 1.3);
  crossB = new THREE.BoxGeometry(1.3, 0.2, 0.35);
  woodMat = new THREE.MeshLambertMaterial({ color: 0x7a4a24 });
  goldMat = new THREE.MeshBasicMaterial({ color: 0xffd54a });
  greenMat = new THREE.MeshBasicMaterial({ color: 0x44ff88 });
  buildPreview();
}

function update(dt) {
  const mode = G.state.mode;
  tickReload(dt);
  if (mode === 'gameover') deadT += dt;
  else if (mode === 'playing') deadT = 0;
  if (mode === 'playing') repairTick(dt);
  if (mode !== 'playing' && mode !== 'gameover') { hidePreview(); return; }
  buildEnemyCache();
  if (mode === 'playing') {
    dirT += dt;
    G.state.runTime = dirT;
  }
  runPending(dt);
  tickFlash(dt);
  runAllAI(dt);
  if (mode === 'playing') {
    director(dt);
    if (live(G.player)) despawnFar(G.player);
  }
  updateProjectiles(dt);
  updateOrbs(dt);
  updateLoot(dt);
  if (mode === 'playing') updatePreview(); else hidePreview();
}

function reset() {
  for (let i = 0; i < projectiles.length; i++) releaseProj(projectiles[i]);
  projectiles.length = 0;
  pending.length = 0;
  for (let i = 0; i < orbs.length; i++) releaseOrb(orbs[i]);
  orbs.length = 0;
  for (let i = 0; i < loot.length; i++) if (G.scene) G.scene.remove(loot[i].mesh);
  loot.length = 0;
  enemyCache.length = 0;
  dirT = 0; spawnT = 2; budget = 1; waveT = 0; waveNum = 0; firstDone = false;
  G.state.runTime = 0;
  G.state.wave = 0;
  deadT = 0;
  noDmgT = 0;
  hidePreview();
}

/* ---------------------------------------------------------------- public */

G.combat = {
  init: init,
  update: update,
  reset: reset,
  projectiles: projectiles,
  tryFire: tryFire,
  fireProjectile: fireProjectile,
  launchAt: launchAt,
  damageShip: damageShip,
  killShip: killShip,
  explode: explode,
  heal: heal,
  addXP: addXP,
  addGold: addGold,
  enemies: enemiesList,
  nearestEnemy: nearestEnemy,
  spawnEnemy: spawnEnemy,
  spawnAlly: spawnAlly,
  dropXP: dropXP,
  dropLoot: dropLoot
};

G.on('ship:collide', onCollide);
G.on('mode:changed', function (d) { if (d && d.mode !== 'playing') hidePreview(); });

})();
