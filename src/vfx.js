(function () {
'use strict';
const G = window.G;

// ---------------------------------------------------------------------------
// Constants and shared state
// ---------------------------------------------------------------------------
// Particle sizes are authored in meters and converted with SIZE_K so that
// gl_PointSize = aSize * (300 / depth) gives roughly the on-screen size of a
// sphere of that diameter for a ~60 degree vertical FOV.
const SIZE_K = 2.6;
const TAU = Math.PI * 2;

let ready = false;
let smokeSys = null;   // NormalBlending, cap 2500
let glowSys = null;    // AdditiveBlending, cap 1500
let rings = [];
let beams = [];
let bolts = [];
let overlay = null;
let numbers = [];
let rain = null;
let rainTarget = 0;
let rainLevel = 0;
let trauma = 0;
let shakeT = 0;

const shakeOff = new THREE.Vector3();
const _hw = new THREE.Vector3();
const _scr = { x: 0, y: 0, visible: false };
let _rx = 0, _ry = 0, _rz = 0;

const RAIN_N = 1200;
const RAIN_TX = 0.18, RAIN_TY = 1.2, RAIN_TZ = 0.05;   // streak tail offset
const BOLT_N = 13;
const BRANCH_N = 7;

function rnd(a, b) { return a + Math.random() * (b - a); }
function clampN(v, a, b) { return v < a ? a : (v > b ? b : v); }
function sc(s) { return s > 0 ? s : 1; }
function cnt(n, def, max) { if (!(n >= 0)) n = def; n = Math.floor(n); return n > max ? max : n; }

// unit random direction on the sphere -> _rx,_ry,_rz
function randDir() {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * TAU;
  const s = Math.sqrt(1 - u * u);
  _rx = s * Math.cos(a);
  _ry = u;
  _rz = s * Math.sin(a);
}

function setHex(arr, i3, hex) {
  arr[i3] = ((hex >> 16) & 255) / 255;
  arr[i3 + 1] = ((hex >> 8) & 255) / 255;
  arr[i3 + 2] = (hex & 255) / 255;
}

// pick an inactive pool slot, otherwise the oldest active one
function pickSlot(pool) {
  let best = null, bestT = -1;
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i];
    if (!e.active) return e;
    if (e.t > bestT) { bestT = e.t; best = e; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// GPU point particle system (ring buffer, CPU-simulated)
// ---------------------------------------------------------------------------
const PARTICLE_VERT = [
  'attribute vec3 aColor;',
  'attribute float aSize;',
  'attribute float aAlpha;',
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'void main() {',
  '  vColor = aColor;',
  '  vAlpha = aAlpha;',
  '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
  '  gl_PointSize = clamp(aSize * (300.0 / max(-mvPosition.z, 0.5)), 0.0, 400.0);',
  '  gl_Position = projectionMatrix * mvPosition;',
  '}'
].join('\n');

const PARTICLE_FRAG = [
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'void main() {',
  '  float d = length(gl_PointCoord - vec2(0.5, 0.5));',
  '  float a = vAlpha * (1.0 - smoothstep(0.0, 0.5, d));',
  '  if (a < 0.003) discard;',
  '  gl_FragColor = vec4(vColor, a);',
  '}'
].join('\n');

function makeSystem(cap, blending) {
  const S = {
    cap: cap,
    head: 0,
    px: new Float32Array(cap * 3),
    vel: new Float32Array(cap * 3),
    c0: new Float32Array(cap * 3),
    c1: new Float32Array(cap * 3),
    col: new Float32Array(cap * 3),
    age: new Float32Array(cap),
    life: new Float32Array(cap),
    s0: new Float32Array(cap),
    s1: new Float32Array(cap),
    a0: new Float32Array(cap),
    grav: new Float32Array(cap),
    drag: new Float32Array(cap),
    size: new Float32Array(cap),
    alpha: new Float32Array(cap)
  };
  const geo = new THREE.BufferGeometry();
  S.aPos = new THREE.BufferAttribute(S.px, 3).setUsage(THREE.DynamicDrawUsage);
  S.aCol = new THREE.BufferAttribute(S.col, 3).setUsage(THREE.DynamicDrawUsage);
  S.aSize = new THREE.BufferAttribute(S.size, 1).setUsage(THREE.DynamicDrawUsage);
  S.aAlpha = new THREE.BufferAttribute(S.alpha, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', S.aPos);
  geo.setAttribute('aColor', S.aCol);
  geo.setAttribute('aSize', S.aSize);
  geo.setAttribute('aAlpha', S.aAlpha);
  const mat = new THREE.ShaderMaterial({
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: blending
  });
  S.points = new THREE.Points(geo, mat);
  S.points.frustumCulled = false;
  return S;
}

// size is in meters (converted here), colors are hex, grav is absolute m/s^2 (positive = down)
function emit(S, x, y, z, vx, vy, vz, life, s0, s1, c0, c1, a0, grav, drag) {
  const i = S.head;
  S.head = (i + 1) % S.cap;
  const i3 = i * 3;
  S.px[i3] = x; S.px[i3 + 1] = y; S.px[i3 + 2] = z;
  S.vel[i3] = vx; S.vel[i3 + 1] = vy; S.vel[i3 + 2] = vz;
  S.age[i] = 0;
  S.life[i] = life > 0.01 ? life : 0.01;
  S.s0[i] = s0 * SIZE_K;
  S.s1[i] = s1 * SIZE_K;
  if (c1 === undefined) c1 = c0;
  setHex(S.c0, i3, c0);
  setHex(S.c1, i3, c1);
  S.col[i3] = S.c0[i3]; S.col[i3 + 1] = S.c0[i3 + 1]; S.col[i3 + 2] = S.c0[i3 + 2];
  S.a0[i] = a0;
  S.grav[i] = grav || 0;
  S.drag[i] = drag || 0;
  S.size[i] = S.s0[i];
  S.alpha[i] = 0;
}

function updateSystem(S, dt) {
  const cap = S.cap;
  const px = S.px, vel = S.vel, age = S.age, life = S.life;
  const s0 = S.s0, s1 = S.s1, a0 = S.a0, grav = S.grav, drag = S.drag;
  const c0 = S.c0, c1 = S.c1, col = S.col, size = S.size, alpha = S.alpha;
  for (let i = 0; i < cap; i++) {
    const L = life[i];
    if (L <= 0) continue;
    const a = age[i] + dt;
    if (a >= L) { life[i] = 0; size[i] = 0; alpha[i] = 0; continue; }
    age[i] = a;
    const p = a / L;
    const i3 = i * 3;
    const k = Math.exp(-drag[i] * dt);
    const vx = vel[i3] * k;
    const vy = (vel[i3 + 1] - grav[i] * dt) * k;
    const vz = vel[i3 + 2] * k;
    vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
    px[i3] += vx * dt;
    px[i3 + 1] += vy * dt;
    px[i3 + 2] += vz * dt;
    size[i] = s0[i] + (s1[i] - s0[i]) * p;
    const sm = p * p * (3 - 2 * p);
    let al = a0[i] * Math.min(1, a * 14) * (1 - sm);
    const y = px[i3 + 1];
    if (y < 0) {
      const w = 1 + y * 2;   // fade out once below the waterline
      al *= w < 0 ? 0 : (w > 1 ? 1 : w);
    }
    alpha[i] = al;
    col[i3] = c0[i3] + (c1[i3] - c0[i3]) * p;
    col[i3 + 1] = c0[i3 + 1] + (c1[i3 + 1] - c0[i3 + 1]) * p;
    col[i3 + 2] = c0[i3 + 2] + (c1[i3 + 2] - c0[i3 + 2]) * p;
  }
  S.aPos.needsUpdate = true;
  S.aCol.needsUpdate = true;
  S.aSize.needsUpdate = true;
  S.aAlpha.needsUpdate = true;
}

function resetSystem(S) {
  S.head = 0;
  S.life.fill(0); S.age.fill(0); S.size.fill(0); S.alpha.fill(0);
  S.col.fill(0);
  S.aPos.needsUpdate = true;
  S.aCol.needsUpdate = true;
  S.aSize.needsUpdate = true;
  S.aAlpha.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Particle effects
// ---------------------------------------------------------------------------
function muzzle(pos, dir) {
  if (!ready) return;
  const px = pos.x, py = pos.y, pz = pos.z;
  let dx = dir.x, dy = dir.y, dz = dir.z;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (L < 1e-6) { dx = 0; dy = 0; dz = 1; } else { dx /= L; dy /= L; dz /= L; }

  // bright core flashes (additive)
  const nf = 3 + ((Math.random() * 3) | 0);
  for (let k = 0; k < nf; k++) {
    const d = 0.6 + k * 0.5;
    emit(glowSys,
      px + dx * d + rnd(-0.4, 0.4), py + dy * d + rnd(-0.4, 0.4), pz + dz * d + rnd(-0.4, 0.4),
      dx * 2, dy * 2, dz * 2,
      rnd(0.1, 0.18), rnd(2.2, 3.0), rnd(4.5, 6.0),
      0xfff6d0, 0xff7a20, 1.0, 0, 6);
  }

  // smoke puffs pushed along dir, lingering and drifting
  const ns = 8 + ((Math.random() * 5) | 0);
  for (let k = 0; k < ns; k++) {
    randDir();
    const along = rnd(2.5, 6);
    const spread = rnd(0.6, 1.4);
    const d = rnd(1.5, 3.0);
    emit(smokeSys,
      px + dx * d + _rx * 0.8, py + dy * d + _ry * 0.8 + 0.2, pz + dz * d + _rz * 0.8,
      dx * along + _rx * spread, dy * along + _ry * spread + 0.5, dz * along + _rz * spread,
      rnd(1.5, 2.5), rnd(1.4, 2.0), rnd(3.6, 5.0),
      0xd6dadd, 0x7f868c, 0.5, -0.5, 1.6);
  }

  // hot sparks
  const nsp = 4 + ((Math.random() * 3) | 0);
  for (let k = 0; k < nsp; k++) {
    randDir();
    const sp = rnd(6, 12);
    emit(glowSys,
      px + dx * 0.8, py + dy * 0.8, pz + dz * 0.8,
      dx * sp + _rx * 3, dy * sp + _ry * 3 + 1, dz * sp + _rz * 3,
      rnd(0.3, 0.6), 0.35, 0.12,
      0xfff0a0, 0xff6a10, 1.0, 9.8, 0.8);
  }
}

function smoke(pos, count, scale) {
  if (!ready) return;
  const s = sc(scale);
  const n = cnt(count, 6, 200);
  const px = pos.x, py = pos.y, pz = pos.z;
  for (let k = 0; k < n; k++) {
    emit(smokeSys,
      px + rnd(-1.5, 1.5) * s, py + rnd(0, 1.0) * s, pz + rnd(-1.5, 1.5) * s,
      rnd(-0.6, 0.6), rnd(1.5, 3.0), rnd(-0.6, 0.6),
      rnd(2.5, 4.0), 1.5 * s, rnd(4.0, 6.0) * s,
      0x3a3530, 0x6b6660, 0.6, -1.2, 0.6);
  }
}

function splash(pos, scale) {
  if (!ready) return;
  const s = sc(scale);
  const sq = Math.sqrt(s);
  const px = pos.x, py = pos.y, pz = pos.z;

  // water column shot upward
  const nc = cnt(Math.round(18 * s), 0, 40);
  for (let k = 0; k < nc; k++) {
    emit(smokeSys,
      px + rnd(-0.6, 0.6) * s, py, pz + rnd(-0.6, 0.6) * s,
      rnd(-0.8, 0.8) * s, rnd(8, 16) * sq, rnd(-0.8, 0.8) * s,
      rnd(0.9, 1.4), rnd(1.4, 2.0) * s, rnd(2.4, 3.2) * s,
      0xf4fbff, 0xb8e2f2, 0.85, 9.8, 0.25);
  }

  // droplets spraying outward
  const nd = cnt(Math.round(14 * s), 0, 40);
  for (let k = 0; k < nd; k++) {
    const a = rnd(0, TAU);
    const r = rnd(3, 7) * sq;
    emit(smokeSys,
      px, py + 0.3, pz,
      Math.cos(a) * r, rnd(4, 9) * sq, Math.sin(a) * r,
      rnd(0.8, 1.2), 0.5 * s, 0.3 * s,
      0xeaf6ff, 0x9fd4ec, 0.9, 9.8, 0.1);
  }

  // foam ring on the water
  const nr = cnt(Math.round(16 * s), 0, 30);
  for (let k = 0; k < nr; k++) {
    const a = (k / nr) * TAU + rnd(-0.1, 0.1);
    const ca = Math.cos(a), sa = Math.sin(a);
    const v = rnd(1.5, 2.5) * sq;
    emit(smokeSys,
      px + ca * 1.0 * s, py + 0.2, pz + sa * 1.0 * s,
      ca * v, 0, sa * v,
      rnd(1.1, 1.6), 1.2 * s, 2.6 * s,
      0xffffff, 0xd8eef6, 0.6, 0, 1.4);
  }
}

function explosion(pos, scale) {
  if (!ready) return;
  const s = sc(scale);
  const sq = Math.sqrt(s);
  const px = pos.x, py = pos.y, pz = pos.z;

  // white-hot core
  emit(glowSys, px, py, pz, 0, 0, 0, 0.22, 3.5 * s, 7.5 * s, 0xffffff, 0xffc060, 1.0, 0, 0);
  emit(glowSys, px + rnd(-0.5, 0.5) * s, py + rnd(0, 0.5) * s, pz + rnd(-0.5, 0.5) * s,
    0, 0, 0, 0.18, 2.5 * s, 5.0 * s, 0xfffbe8, 0xff9a30, 0.9, 0, 0);

  // orange fireball
  const nf = cnt(Math.round(24 * s), 0, 40);
  for (let k = 0; k < nf; k++) {
    randDir();
    const sp = rnd(2, 7) * sq;
    emit(glowSys,
      px + _rx * 0.8 * s, py + _ry * 0.8 * s, pz + _rz * 0.8 * s,
      _rx * sp, _ry * sp + 1, _rz * sp,
      rnd(0.5, 0.9), 2.2 * s, 4.2 * s,
      0xffd060, 0x8a1a00, 0.9, -0.5, 2.5);
  }

  // dark billowing smoke
  const nsm = cnt(Math.round(18 * s), 0, 30);
  for (let k = 0; k < nsm; k++) {
    randDir();
    const sp = rnd(1, 4) * sq;
    emit(smokeSys,
      px + _rx * s, py + _ry * s, pz + _rz * s,
      _rx * sp, _ry * sp + rnd(1, 3), _rz * sp,
      rnd(2.5, 3.5), 2 * s, 6 * s,
      0x2e2a26, 0x5f5852, 0.7, -1.0, 1.2);
  }

  // radial sparks with gravity
  const nsp = cnt(Math.round(18 * s), 0, 40);
  for (let k = 0; k < nsp; k++) {
    randDir();
    const sp = rnd(8, 18) * sq;
    emit(glowSys,
      px, py, pz,
      _rx * sp, _ry * sp + 2, _rz * sp,
      rnd(0.6, 1.2), 0.35, 0.1,
      0xfff0a0, 0xff5a10, 1.0, 9.8, 0.4);
  }

  shake(0.35 * s);
}

function fire(pos, scale) {
  if (!ready) return;
  const s = sc(scale);
  const sq = Math.sqrt(s);
  const px = pos.x, py = pos.y, pz = pos.z;
  for (let k = 0; k < 3; k++) {
    emit(glowSys,
      px + rnd(-0.5, 0.5) * s, py + rnd(0, 0.6) * s, pz + rnd(-0.5, 0.5) * s,
      rnd(-0.3, 0.3), rnd(2, 3.5) * sq, rnd(-0.3, 0.3),
      rnd(0.45, 0.7), 1.1 * s, 0.3 * s,
      0xffe066, 0xff2a00, 0.9, -1.5, 0.8);
  }
  if (Math.random() < 0.5) {
    emit(smokeSys,
      px, py + 0.5 * s, pz,
      rnd(-0.4, 0.4), rnd(1.5, 2.5), rnd(-0.4, 0.4),
      rnd(1.5, 2.0), 0.8 * s, 2.5 * s,
      0x4a4540, 0x2a2724, 0.55, -1.0, 0.8);
  }
}

function sparks(pos, count) {
  if (!ready) return;
  const n = cnt(count, 12, 60);
  const px = pos.x, py = pos.y, pz = pos.z;
  for (let k = 0; k < n; k++) {
    randDir();
    const sp = rnd(4, 12);
    emit(glowSys,
      px, py, pz,
      _rx * sp, _ry * sp + 2, _rz * sp,
      rnd(0.25, 0.6), 0.25, 0.12,
      0xfff2a8, 0xff7a1a, 1.0, 9.8, 0.6);
  }
}

function debris(pos, count) {
  if (!ready) return;
  const n = cnt(count, 10, 60);
  const px = pos.x, py = pos.y, pz = pos.z;
  for (let k = 0; k < n; k++) {
    const a = rnd(0, TAU);
    const r = rnd(2, 7);
    emit(smokeSys,
      px, py + 0.2, pz,
      Math.cos(a) * r, rnd(5, 12), Math.sin(a) * r,
      rnd(1.8, 3.0), rnd(0.45, 0.7), rnd(0.35, 0.5),
      0x6b4220, 0xb8875a, 1.0, 14, 0.15);
  }
}

function foam(pos, scale) {
  if (!ready) return;
  const s = sc(scale);
  const n = cnt(Math.round(10 * s), 0, 30);
  const px = pos.x, py = pos.y, pz = pos.z;
  for (let k = 0; k < n; k++) {
    const a = rnd(0, TAU);
    const r = rnd(0, 1.2) * s;
    const v = rnd(0.3, 1.2);
    const ca = Math.cos(a), sa = Math.sin(a);
    emit(smokeSys,
      px + ca * r, py + 0.15, pz + sa * r,
      ca * v, 0, sa * v,
      rnd(1.2, 1.8), 1.2 * s, 2.5 * s,
      0xffffff, 0xdcf0f7, 0.6, 0, 1.2);
  }
}

function ghostPuff(pos, scale) {
  if (!ready) return;
  const s = sc(scale);
  const n = cnt(Math.round(8 * s), 0, 20);
  const px = pos.x, py = pos.y, pz = pos.z;
  for (let k = 0; k < n; k++) {
    emit(glowSys,
      px + rnd(-1, 1) * s, py + rnd(0, 1) * s, pz + rnd(-1, 1) * s,
      rnd(-0.4, 0.4), rnd(0.6, 1.2), rnd(-0.4, 0.4),
      rnd(1.8, 2.6), 1.2 * s, 3.0 * s,
      0x7dfff0, 0x2bd88a, 0.35, -0.3, 0.5);
  }
}

// ---------------------------------------------------------------------------
// Mesh effects (pooled)
// ---------------------------------------------------------------------------
let ringGeo = null, boxGeo = null;

function ring(pos, radius, color, duration) {
  if (!ready) return;
  const e = pickSlot(rings);
  e.active = true;
  e.t = 0;
  e.dur = duration > 0 ? duration : 0.6;
  e.r = radius > 0 ? radius : 6;
  e.mesh.position.set(pos.x, pos.y + 0.3, pos.z);
  e.mat.color.setHex(typeof color === 'number' ? color : 0xffffff);
  e.mat.opacity = 0.9;
  e.mesh.scale.setScalar(0.1);
  e.mesh.visible = true;
}

function beam(from, to, color, duration) {
  if (!ready) return;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 0.01) return;
  const e = pickSlot(beams);
  e.active = true;
  e.t = 0;
  e.dur = duration > 0 ? duration : 0.5;
  e.len = len;
  e.mesh.position.set((from.x + to.x) * 0.5, (from.y + to.y) * 0.5, (from.z + to.z) * 0.5);
  e.mesh.lookAt(to.x, to.y, to.z);
  e.mesh.scale.set(0.45, 0.45, len);
  e.mat.color.setHex(typeof color === 'number' ? color : 0xffffff);
  e.mat.opacity = 1;
  e.mesh.visible = true;
}

function makeBolt() {
  const mg = new Float32Array(BOLT_N * 3);
  const bg = new Float32Array(BRANCH_N * 3);
  const geoM = new THREE.BufferGeometry();
  geoM.setAttribute('position', new THREE.BufferAttribute(mg, 3).setUsage(THREE.DynamicDrawUsage));
  const geoB = new THREE.BufferGeometry();
  geoB.setAttribute('position', new THREE.BufferAttribute(bg, 3).setUsage(THREE.DynamicDrawUsage));
  const matM = new THREE.LineBasicMaterial({
    color: 0xe6f4ff, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const matB = new THREE.LineBasicMaterial({
    color: 0x9fd3ff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const main = new THREE.Line(geoM, matM);
  const branch = new THREE.Line(geoB, matB);
  main.frustumCulled = false;
  branch.frustumCulled = false;
  main.visible = false;
  branch.visible = false;
  return {
    main: main, branch: branch, matM: matM, matB: matB, mg: mg, bg: bg,
    active: false, t: 0, dur: 0.18,
    ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0
  };
}

function jitterBolt(b) {
  const mg = b.mg, bg = b.bg;
  const dx = b.bx - b.ax, dy = b.by - b.ay, dz = b.bz - b.az;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const amp = Math.min(3, L * 0.04);
  for (let k = 0; k < BOLT_N; k++) {
    const t = k / (BOLT_N - 1);
    const edge = (k === 0 || k === BOLT_N - 1);
    const i3 = k * 3;
    mg[i3] = b.ax + dx * t + (edge ? 0 : rnd(-amp, amp));
    mg[i3 + 1] = b.ay + dy * t + (edge ? 0 : rnd(-amp, amp));
    mg[i3 + 2] = b.az + dz * t + (edge ? 0 : rnd(-amp, amp));
  }
  // branch forks off main-bolt vertex 4
  const si = 4 * 3;
  const sx = mg[si], sy = mg[si + 1], sz = mg[si + 2];
  const ex = sx + rnd(-1, 1) * L * 0.25;
  const ey = sy - L * 0.2 * rnd(0.6, 1.0);
  const ez = sz + rnd(-1, 1) * L * 0.25;
  for (let k = 0; k < BRANCH_N; k++) {
    const t = k / (BRANCH_N - 1);
    const edge = (k === 0 || k === BRANCH_N - 1);
    const i3 = k * 3;
    bg[i3] = sx + (ex - sx) * t + (edge ? 0 : rnd(-amp, amp) * 0.6);
    bg[i3 + 1] = sy + (ey - sy) * t + (edge ? 0 : rnd(-amp, amp) * 0.6);
    bg[i3 + 2] = sz + (ez - sz) * t + (edge ? 0 : rnd(-amp, amp) * 0.6);
  }
  b.main.geometry.attributes.position.needsUpdate = true;
  b.branch.geometry.attributes.position.needsUpdate = true;
}

function lightning(from, to) {
  if (!ready) return;
  const b = pickSlot(bolts);
  b.active = true;
  b.t = 0;
  b.ax = from.x; b.ay = from.y; b.az = from.z;
  b.bx = to.x; b.by = to.y; b.bz = to.z;
  b.main.visible = true;
  b.branch.visible = true;
  jitterBolt(b);

  if (G.ocean && typeof G.ocean.flash === 'function') G.ocean.flash(1);
  shake(0.5);
  sparks(to, 20);
  emit(glowSys, to.x, to.y + 0.5, to.z, 0, 0, 0, 0.2, 5, 8, 0xdff0ff, 0x6fb8ff, 1.0, 0, 0);
}

function updateBeams(dt) {
  for (let i = 0; i < beams.length; i++) {
    const e = beams[i];
    if (!e.active) continue;
    e.t += dt;
    const p = e.t / e.dur;
    if (p >= 1) { e.active = false; e.mesh.visible = false; continue; }
    const w = 0.45 * (1 - p * 0.5);
    e.mesh.scale.set(w, w, e.len);
    e.mat.opacity = Math.pow(1 - p, 1.5);
  }
}

function updateRings(dt) {
  for (let i = 0; i < rings.length; i++) {
    const e = rings[i];
    if (!e.active) continue;
    e.t += dt;
    const p = e.t / e.dur;
    if (p >= 1) { e.active = false; e.mesh.visible = false; continue; }
    const s = 0.1 + (e.r - 0.1) * (1 - Math.pow(1 - p, 3));
    e.mesh.scale.setScalar(s);
    e.mat.opacity = (1 - p) * 0.9;
  }
}

function updateBolts(dt) {
  for (let i = 0; i < bolts.length; i++) {
    const b = bolts[i];
    if (!b.active) continue;
    b.t += dt;
    if (b.t >= b.dur) {
      b.active = false;
      b.main.visible = false;
      b.branch.visible = false;
      continue;
    }
    jitterBolt(b);   // flicker: re-jag the bolt every frame
    const fade = 1 - b.t / b.dur;
    const fl = Math.random() < 0.3 ? 0.35 : 1;
    b.matM.opacity = fade * fl;
    b.matB.opacity = fade * fl * 0.7;
  }
}

// ---------------------------------------------------------------------------
// Floating combat text (DOM)
// ---------------------------------------------------------------------------
const NUM_LIFE = 0.9;

function createOverlay() {
  if (typeof document === 'undefined' || !document.body) return;
  overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;overflow:hidden;';
  document.body.appendChild(overlay);
  for (let i = 0; i < 40; i++) {
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;left:0;top:0;display:none;white-space:nowrap;' +
      "font-family:Georgia,'Times New Roman',serif;font-weight:900;font-size:26px;line-height:1;" +
      'letter-spacing:0.5px;pointer-events:none;will-change:transform;transform-origin:50% 50%;' +
      'text-shadow:0 0 2px #000,1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,0 2px 4px rgba(0,0,0,0.6);';
    overlay.appendChild(el);
    numbers.push({ el: el, active: false, t: 0, pos: new THREE.Vector3() });
  }
}

function hitNumber(pos, text, color) {
  if (!ready || !overlay) return;
  const e = pickSlot(numbers);
  e.active = true;
  e.t = 0;
  e.pos.copy(pos);
  e.el.textContent = String(text);
  e.el.style.color = color || '#ffffff';
  e.el.style.opacity = '1';
  e.el.style.display = 'block';
}

function updateNumbers(dt) {
  if (!overlay || !G.camera || !G.util || !G.util.worldToScreen) return;
  for (let i = 0; i < numbers.length; i++) {
    const e = numbers[i];
    if (!e.active) continue;
    e.t += dt;
    const p = e.t / NUM_LIFE;
    if (p >= 1) { e.active = false; e.el.style.display = 'none'; continue; }
    const ease = 1 - (1 - p) * (1 - p);
    _hw.copy(e.pos);
    _hw.y += 4 * ease;
    _scr.visible = false;
    G.util.worldToScreen(_hw, _scr);
    if (!_scr.visible) { e.el.style.display = 'none'; continue; }
    let s;
    if (p < 0.15) s = 0.4 + (p / 0.15) * 0.85;          // pop in
    else if (p < 0.25) s = 1.25 - ((p - 0.15) / 0.1) * 0.25;  // settle
    else s = 1.0;
    const op = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
    e.el.style.display = 'block';
    e.el.style.transform = 'translate(' + _scr.x.toFixed(1) + 'px,' + _scr.y.toFixed(1) +
      'px) translate(-50%,-50%) scale(' + s.toFixed(3) + ')';
    e.el.style.opacity = op.toFixed(3);
  }
}

// ---------------------------------------------------------------------------
// Camera shake and hitstop
// ---------------------------------------------------------------------------
function shake(amount) {
  const a = Number(amount) || 0;
  trauma = Math.min(2, trauma + a);
}

function updateShake(dt) {
  if (trauma > 0) trauma = Math.max(0, trauma - 2.2 * dt);
  shakeT += dt;
  const t2 = trauma * trauma * 1.6;
  if (t2 <= 0) { shakeOff.set(0, 0, 0); return; }
  const T = shakeT;
  shakeOff.set(
    t2 * (Math.sin(T * 23.7 + 1.3) * 0.6 + Math.sin(T * 41.1 + 0.4) * 0.4),
    t2 * 0.5 * (Math.sin(T * 19.3 + 2.2) * 0.6 + Math.sin(T * 37.9 + 4.1) * 0.4),
    t2 * (Math.sin(T * 27.9 + 5.2) * 0.6 + Math.sin(T * 44.3 + 0.9) * 0.4)
  );
}

function hitstop(seconds) {
  if (!G.state) return;
  const s = Math.min(Number(seconds) || 0, 0.12);
  G.state.hitstop = Math.max(G.state.hitstop || 0, s);
}

// ---------------------------------------------------------------------------
// Rain
// ---------------------------------------------------------------------------
function initRain() {
  const base = new Float32Array(RAIN_N * 3);
  const spd = new Float32Array(RAIN_N);
  for (let i = 0; i < RAIN_N; i++) {
    base[i * 3] = rnd(-30, 30);
    base[i * 3 + 1] = rnd(-8, 32);
    base[i * 3 + 2] = rnd(-30, 30);
    spd[i] = rnd(24, 34);
  }
  const posArr = new Float32Array(RAIN_N * 6);
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  const mat = new THREE.LineBasicMaterial({
    color: 0xaec3d6, transparent: true, opacity: 0, depthWrite: false
  });
  const obj = new THREE.LineSegments(geo, mat);
  obj.frustumCulled = false;
  obj.visible = false;
  rain = { base: base, spd: spd, pos: posArr, attr: attr, mat: mat, obj: obj };
}

function updateRain(dt) {
  if (!rain) return;
  rainLevel += (rainTarget - rainLevel) * (1 - Math.exp(-2.5 * dt));
  if (rainLevel < 0.003 && rainTarget <= 0) {
    rainLevel = 0;
    rain.obj.visible = false;
    return;
  }
  rain.obj.visible = true;
  rain.mat.opacity = rainLevel * 0.5;

  const cam = G.camera ? G.camera.position : null;
  const cx = cam ? cam.x : 0, cy = cam ? cam.y : 0, cz = cam ? cam.z : 0;
  const b = rain.base, sp = rain.spd, p = rain.pos;
  for (let i = 0; i < RAIN_N; i++) {
    const i3 = i * 3;
    let x = b[i3];
    let y = b[i3 + 1] - sp[i] * dt;
    let z = b[i3 + 2];
    // wrap the box around the camera (modular, so it is robust to big jumps)
    let dx = x - cx; dx -= 60 * Math.round(dx / 60); x = cx + dx;
    let dz = z - cz; dz -= 60 * Math.round(dz / 60); z = cz + dz;
    let dy = y - (cy + 12); dy -= 40 * Math.round(dy / 40); y = cy + 12 + dy;
    b[i3] = x; b[i3 + 1] = y; b[i3 + 2] = z;
    const i6 = i * 6;
    p[i6] = x; p[i6 + 1] = y; p[i6 + 2] = z;
    p[i6 + 3] = x + RAIN_TX; p[i6 + 4] = y + RAIN_TY; p[i6 + 5] = z + RAIN_TZ;
  }
  rain.attr.needsUpdate = true;
}

function setRain(intensity) {
  rainTarget = clampN(Number(intensity) || 0, 0, 1);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function init() {
  if (ready) return;
  if (!G.scene || typeof THREE === 'undefined') return;

  smokeSys = makeSystem(2500, THREE.NormalBlending);
  glowSys = makeSystem(1500, THREE.AdditiveBlending);
  G.scene.add(smokeSys.points);
  G.scene.add(glowSys.points);

  ringGeo = new THREE.RingGeometry(0.85, 1, 40);
  rings = [];
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
    });
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mesh.frustumCulled = false;
    G.scene.add(mesh);
    rings.push({ mesh: mesh, mat: mat, active: false, t: 0, dur: 1, r: 6 });
  }

  boxGeo = new THREE.BoxGeometry(1, 1, 1);
  beams = [];
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const mesh = new THREE.Mesh(boxGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    G.scene.add(mesh);
    beams.push({ mesh: mesh, mat: mat, active: false, t: 0, dur: 0.5, len: 1 });
  }

  bolts = [];
  for (let i = 0; i < 4; i++) {
    const b = makeBolt();
    G.scene.add(b.main);
    G.scene.add(b.branch);
    bolts.push(b);
  }

  numbers = [];
  createOverlay();

  initRain();
  G.scene.add(rain.obj);

  ready = true;
}

function reset() {
  if (smokeSys) resetSystem(smokeSys);
  if (glowSys) resetSystem(glowSys);
  for (let i = 0; i < rings.length; i++) {
    rings[i].active = false;
    rings[i].mesh.visible = false;
  }
  for (let i = 0; i < beams.length; i++) {
    beams[i].active = false;
    beams[i].mesh.visible = false;
  }
  for (let i = 0; i < bolts.length; i++) {
    bolts[i].active = false;
    bolts[i].main.visible = false;
    bolts[i].branch.visible = false;
  }
  for (let i = 0; i < numbers.length; i++) {
    numbers[i].active = false;
    numbers[i].el.style.display = 'none';
  }
  rainTarget = 0;
  rainLevel = 0;
  if (rain) rain.obj.visible = false;
  trauma = 0;
  shakeOff.set(0, 0, 0);
}

function update(dt) {
  if (!(dt > 0)) dt = 0;
  updateShake(dt);
  if (!ready) return;
  updateSystem(smokeSys, dt);
  updateSystem(glowSys, dt);
  updateRings(dt);
  updateBeams(dt);
  updateBolts(dt);
  updateNumbers(dt);
  updateRain(dt);
}

G.vfx = {
  init: init,
  update: update,
  reset: reset,
  muzzle: muzzle,
  smoke: smoke,
  splash: splash,
  explosion: explosion,
  fire: fire,
  sparks: sparks,
  debris: debris,
  foam: foam,
  ring: ring,
  beam: beam,
  lightning: lightning,
  ghostPuff: ghostPuff,
  hitNumber: hitNumber,
  shake: shake,
  hitstop: hitstop,
  setRain: setRain,
  shakeOffset: shakeOff
};

})();
