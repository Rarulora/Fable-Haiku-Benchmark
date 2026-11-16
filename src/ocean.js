(function(){
'use strict';
const G = window.G;

/* ------------------------------------------------------------------ *
 * Wave model (single source of truth for GPU and CPU)
 * ------------------------------------------------------------------ */
const GRAV = 9.81;
const NW = 6;
const WIND = 0.35;
const CELL = 3.0;          // mesh cell size (900 m / 300 segments); origin snaps to it
const MESH_SIZE = 900;
const MESH_SEG = 300;
const DISC_R = 2400;
const SKY_R = 2200;
const RIP_N = 8;
const RIP_LIFE = 9.0;
const RIP_SPEED = 14.0;
const FOG_EDGE_NEAR = 380.0;
const FOG_EDGE_FAR = 445.0;
const FOG_DENSITY = 0.0013;
const HAZE_HEX = 0xb3b9bb;   // cool blue-grey haze; same value is the sky horizon

// 2 swells, 2 medium, 2 chop. Directions spread around WIND.
const WAVE_SPECS = [
  { ang: -0.45, wl: 92, amp: 1.05, st: 0.34 },
  { ang:  0.30, wl: 68, amp: 0.92, st: 0.33 },
  { ang: -0.20, wl: 34, amp: 0.46, st: 0.34 },
  { ang:  0.55, wl: 25, amp: 0.38, st: 0.34 },
  { ang: -0.70, wl: 12, amp: 0.17, st: 0.36 },
  { ang:  0.15, wl:  9, amp: 0.13, st: 0.38 }
];

// {dirX, dirZ, wavelength, amplitude, steepness, speed} plus derived k, w, Q.
// Q is the Gerstner steepness factor: Q*k*A = steepness/NW, so the sum over
// waves of Q*k*A is ~0.35 at calm and ~0.8 at full storm (uAmp = 2.3).
const WAVES = WAVE_SPECS.map(function (s) {
  const a = WIND + s.ang;
  const k = 2.0 * Math.PI / s.wl;
  const speed = Math.sqrt(GRAV / k);
  const Q = Math.min(0.9, s.st / (k * s.amp * NW));
  return {
    dirX: Math.cos(a), dirZ: Math.sin(a),
    wavelength: s.wl, amplitude: s.amp, steepness: s.st, speed: speed,
    k: k, w: k * speed, Q: Q
  };
});

const SUN_DIR = new THREE.Vector3(0.305, 0.3746, 0.875).normalize(); // ~22 deg elevation

/* ------------------------------------------------------------------ *
 * GLSL
 * ------------------------------------------------------------------ */
const COMMON_GLSL = `
uniform float uTime;
uniform float uStorm;
uniform float uFlash;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec4 uRip[8];
uniform float uRipSpd[8];
uniform vec4 uVortex;

float wh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = wh(i);
  float b = wh(i + vec2(1.0, 0.0));
  float c = wh(i + vec2(0.0, 1.0));
  float d = wh(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p){
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}

// travelling decaying ring packets (must match ocean.js extAt)
float ripH(vec2 q){
  float h = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 r = uRip[i];
    float a = uTime - r.z;
    if (r.w != 0.0 && a >= 0.0 && a < 9.0) {
      float x = length(q - r.xy) - a * uRipSpd[i];
      h += r.w * exp(-a * 0.55) * sin(x * 0.55) * exp(-(x * x) / 49.0);
    }
  }
  return h;
}

// whirlpool funnel (must match ocean.js extAt)
float vortexH(vec2 q){
  float rr = max(uVortex.z, 1.0);
  vec2 dv = q - uVortex.xy;
  return -uVortex.w * exp(-dot(dv, dv) / (rr * rr) * 2.5);
}

// sky gradient, shared by the sky dome and by water reflections
vec3 skyBase(vec3 d){
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.42));
  float sd = max(dot(d, uSunDir), 0.0);
  vec3 peach = vec3(1.0, 0.55, 0.3);
  c += uSunColor * (0.30 * pow(sd, 8.0) + 0.25 * pow(sd, 96.0));
  c += peach * (0.18 * pow(sd, 3.0) + 0.14 * pow(sd, 14.0)) * (1.0 - 0.5 * h);
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(lum) * vec3(0.55, 0.6, 0.68), uStorm * 0.8);
  c *= 1.0 - uStorm * 0.4;
  c += uFlash * vec3(0.55, 0.6, 0.75);
  return c;
}
`;

const WATER_VS = `
uniform float uAmp;
uniform vec4 uWaveA[6];
uniform vec4 uWaveB[6];
uniform vec2 uCam;
uniform float uDiscY;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;

float extraH(vec2 q){
  return ripH(q) + vortexH(q);
}

void main(){
#ifdef FLAT
  vec4 wpF = modelMatrix * vec4(position, 1.0);
  vWorld = wpF.xyz;
  vNormal = vec3(0.0, 1.0, 0.0);
  vCrest = 1.0;
  gl_Position = projectionMatrix * viewMatrix * wpF;
#else
  vec4 wp0 = modelMatrix * vec4(position, 1.0);
  vec2 p = wp0.xz;                       // undisplaced world position
  float fade = 1.0 - smoothstep(380.0, 445.0, distance(p, uCam));
  vec2 off = vec2(0.0);
  float gy = 0.0;
  vec3 T = vec3(1.0, 0.0, 0.0);
  vec3 B = vec3(0.0, 0.0, 1.0);
  for (int i = 0; i < 6; i++) {
    vec4 wa = uWaveA[i];
    vec4 wb = uWaveB[i];
    vec2 d = wa.xy;
    float k = wa.z;
    float A = wa.w * uAmp;
    float Q = wb.x;
    float w = wb.y;
    float ph = k * dot(d, p) - w * uTime;
    float S = sin(ph);
    float C = cos(ph);
    float WA = k * A;
    float QWA = Q * WA;
    off += Q * A * d * C;
    gy += A * S;
    T += vec3(-QWA * d.x * d.x * S, WA * d.x * C, -QWA * d.x * d.y * S);
    B += vec3(-QWA * d.x * d.y * S, WA * d.y * C, -QWA * d.y * d.y * S);
  }
  off *= fade;
  vec2 q = p + off;                      // displaced horizontal position
  float y = uDiscY * (1.0 - fade) + fade * (gy + extraH(q));

  // analytic Gerstner normal, blended to up at the mesh edge
  vec3 N = normalize(cross(B, T));
  N = normalize(mix(vec3(0.0, 1.0, 0.0), N, fade));
  // ripple + vortex slope via finite differences (eps 0.6)
  float e = 0.6;
  float base = extraH(q);
  float gx = (extraH(q + vec2(e, 0.0)) - base) / e;
  float gz = (extraH(q + vec2(0.0, e)) - base) / e;
  vec2 slope = N.xz / N.y - fade * vec2(gx, gz);
  vNormal = normalize(vec3(slope.x, 1.0, slope.y));

  vCrest = T.x * B.z - T.z * B.x;        // horizontal Jacobian (folds => foam)
  vWorld = vec3(q.x, y, q.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
#endif
}
`;

const WATER_FS = `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uDeep;
uniform vec3 uFace;
uniform vec3 uTurq;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;

float detailH(vec2 p){
  float h = vnoise(p * 0.9 + vec2(uTime * 0.35, uTime * 0.22)) * 0.6;
  h += vnoise(p * 2.3 + vec2(-uTime * 0.5, uTime * 0.37)) * 0.4;
  return h;
}

vec2 detailGrad(vec2 p){
  float e = 0.06;
  float h0 = detailH(p);
  return vec2(detailH(p + vec2(e, 0.0)) - h0, detailH(p + vec2(0.0, e)) - h0) / e;
}

// thin soft leading-crest line per ripple, fades twice as fast as the height
float ripFoam(vec2 q){
  float f = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 r = uRip[i];
    float a = uTime - r.z;
    if (r.w != 0.0 && a >= 0.0 && a < 4.0) {
      float x = length(q - r.xy) - a * uRipSpd[i];
      float line = exp(-pow((x - 0.8) / 0.6, 2.0));
      float sF = smoothstep(0.6, 1.6, r.w) * clamp(r.w / 2.0, 0.0, 1.0);
      float fadeF = exp(-a * 1.1);
      float n = vnoise(vec2(x * 2.0, a * 3.0 + float(i) * 7.0));
      f += line * sF * fadeF * (0.35 + 0.65 * smoothstep(0.3, 0.7, n));
    }
  }
  return clamp(f, 0.0, 1.0);
}

// logarithmic spiral foam arms plus a bright lip ring
float vortexFoam(vec2 q){
  float dep = clamp(uVortex.w / 4.0, 0.0, 1.0);
  if (dep <= 0.001) return 0.0;
  vec2 dv = q - uVortex.xy;
  float d = length(dv);
  float r = d / max(uVortex.z, 1.0);
  float arms = sin(atan(dv.y, dv.x + 1e-5) * 3.0 + log(d + 1.0) * 6.0 - uTime * 3.0);
  float spiral = smoothstep(0.35, 0.95, arms) * smoothstep(0.1, 0.35, r) * (1.0 - smoothstep(0.7, 1.3, r));
  float rim = exp(-pow((r - 1.0) / 0.09, 2.0));
  float n = vnoise(q * 1.3 + vec2(uTime * 0.5, -uTime * 0.3));
  return dep * clamp(spiral * (0.35 + 0.65 * smoothstep(0.35, 0.7, n)) + rim * 0.9, 0.0, 1.0);
}

// darkens the funnel toward the centre
float vortexDark(vec2 q){
  float dep = clamp(uVortex.w / 4.0, 0.0, 1.0);
  float r = length(q - uVortex.xy) / max(uVortex.z, 1.0);
  return dep * 0.9 * (1.0 - smoothstep(0.2, 1.0, r));
}

// swirled slope so sun glints follow the spin
vec2 vortexSwirl(vec2 q){
  float dep = clamp(uVortex.w / 4.0, 0.0, 1.0);
  if (dep <= 0.001) return vec2(0.0);
  vec2 dv = q - uVortex.xy;
  float d = length(dv);
  float r = d / max(uVortex.z, 1.0);
  vec2 tng = vec2(-dv.y, dv.x) / max(d, 0.5);
  float arms = sin(atan(dv.y, dv.x + 1e-5) * 3.0 + log(d + 1.0) * 6.0 - uTime * 3.0);
  return tng * dep * 0.22 * arms * smoothstep(1.3, 0.3, r);
}

void main(){
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);
  float nearF = 1.0 - smoothstep(30.0, 260.0, dist);

  // two octaves of scrolling detail normal, fading with distance
  vec2 g = detailGrad(vWorld.xz);
  float farK = 1.0 - smoothstep(90.0, 260.0, dist);
  float pertS = (0.16 + 0.12 * uStorm) * farK;
  vec2 sw = vortexSwirl(vWorld.xz);
  vec3 N = normalize(vNormal + vec3(-g.x, 0.0, -g.y) * pertS + vec3(sw.x, 0.0, sw.y));

  float cosT = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);   // Schlick, F0 0.02
  vec3 R = reflect(-V, N);

  // body colour: dark troughs, lighter wave faces, turquoise glow when backlit by the sun
  float hf = clamp(vWorld.y * 0.35 + 0.5, 0.0, 1.0);
  vec3 body = mix(uDeep, uFace, hf);
  float back = pow(max(dot(-V, uSunDir), 0.0), 4.0);
  body += uTurq * back * hf * 0.5;
  body *= 0.72 + 0.28 * max(dot(N, uSunDir), 0.0);

  vec3 col = mix(body, skyBase(R), F);

  // sun glitter and broad sun path
  float sd = max(dot(R, uSunDir), 0.0);
  float farS = 1.0 - smoothstep(90.0, 260.0, dist);
  col += uSunColor * (pow(sd, 300.0) * 6.0 * (0.3 + 0.7 * farS) + pow(sd, 24.0) * 0.16) * (1.0 - 0.7 * uStorm);

  // foam: crests (Jacobian fold), ripple rings, vortex spiral; noisy breakup
  float n1 = vnoise(vWorld.xz * 0.45 + vec2(uTime * 0.25, uTime * 0.18));
  float n2 = vnoise(vWorld.xz * 1.6 - vec2(uTime * 0.4, uTime * 0.3));
  float breakup = smoothstep(0.3, 0.75, n1 * 0.6 + n2 * 0.4);
  // vortex funnel darkens toward the centre before foam is laid on top
  float vd = vortexDark(vWorld.xz);
  col = mix(col, vec3(0.01, 0.035, 0.045), vd);
  float crestFoam = smoothstep(0.5, 0.15, vCrest) * (0.35 + 0.65 * breakup);
  // streaky whitecaps on the highest swell crests only
  float along = dot(vWorld.xz, vec2(0.94, 0.34));
  float across = dot(vWorld.xz, vec2(-0.34, 0.94));
  float streak = vnoise(vec2(along * 0.22, across * 2.4) + vec2(uTime * 0.6, 0.0));
  float swellCap = smoothstep(0.9, 0.5, vCrest) * smoothstep(0.6, 1.2, vWorld.y) * smoothstep(0.45, 0.7, streak);
  crestFoam = max(crestFoam, swellCap * 0.85) * (1.0 - smoothstep(90.0, 260.0, dist));
  float rippleFoam = ripFoam(vWorld.xz) * (0.6 + 0.4 * breakup);
  float vFoam = vortexFoam(vWorld.xz) * (0.6 + 0.4 * n2);
  float foam = clamp(max(crestFoam, rippleFoam) + vFoam * 0.9 + uStorm * 0.2 * breakup * hf, 0.0, 1.0);
  vec3 foamCol = vec3(0.92, 0.96, 0.97) * (0.7 + 0.3 * max(dot(N, uSunDir), 0.0));
  col = mix(col, foamCol, foam * 0.9);

  // storm grading and lightning flash
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum) * vec3(0.8, 0.9, 1.0), uStorm * 0.25);
  col *= 1.0 - uStorm * 0.2;
  col = col * (1.0 + uFlash * 0.9) + uFlash * vec3(0.12, 0.14, 0.18);

  // manual FogExp2 matching scene.fog
  float fogF = clamp(1.0 - exp(-pow(uFogDensity * dist, 2.0)), 0.0, 1.0);
  col = mix(col, uFogColor, fogF);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SKY_VS = `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FS = `
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 col = skyBase(d);
  float sd = max(dot(d, uSunDir), 0.0);
  if (d.y > 0.0) {
    vec2 cuv = d.xz / (d.y + 0.14) * 1.4 + vec2(uTime * 0.012, uTime * 0.005);
    float cl = fbm(cuv);
    float cm = smoothstep(0.5, 0.8, cl) * smoothstep(0.02, 0.3, d.y);
    // warm-lit tops, cool grey-blue undersides, warm rim on the sun side
    float lit = smoothstep(0.5, 0.85, cl);
    vec3 top = vec3(1.0, 0.86, 0.68) * (0.75 + 0.5 * pow(sd, 3.0));
    vec3 under = vec3(0.5, 0.56, 0.68);
    vec3 cc = mix(under, top, lit) + uSunColor * pow(sd, 6.0) * 0.35 * lit;
    cc *= 1.0 - 0.6 * uStorm;
    col = mix(col, cc, cm * 0.85);
  }
  float disc = smoothstep(0.9994, 0.9998, sd);
  col += uSunColor * disc * 8.0 * (1.0 - uStorm);
  // bloom-like falloff around the disc
  col += uSunColor * (pow(sd, 600.0) * 3.0 + pow(sd, 60.0) * 0.12) * (1.0 - uStorm);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ------------------------------------------------------------------ *
 * Module state
 * ------------------------------------------------------------------ */
let ready = false;
let curTime = 0;
let stormV = 0, stormT = 0;
let curAmp = 1;
let flashV = 0;
let discY = -2.5;
let camX = 0, camZ = 0;
let vx = 0, vz = 0, vR = 10, vDepth = 0, vTarget = 0;
let gOX = 0, gOZ = 0, gY = 0;   // scratch output of gerstnerAt

const RIP = [];
for (let i = 0; i < RIP_N; i++) RIP.push({ on: false, x: 0, z: 0, t0: 0, str: 0, spd: RIP_SPEED });

let SH = null;      // uniforms shared by sky and water
let WU = null;      // water uniforms (superset)
let waterMesh = null, discMesh = null, skyMesh = null;
let sunLight = null, hemiLight = null;
let fogCol = null;
let FOG_BASE = null, FOG_STORM = null;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// Gerstner displacement at undisplaced point (px,pz), unfaded. Sets gOX, gOZ, gY.
function gerstnerAt(px, pz) {
  let ox = 0, oz = 0, y = 0;
  for (let i = 0; i < NW; i++) {
    const w = WAVES[i];
    const ph = w.k * (w.dirX * px + w.dirZ * pz) - w.w * curTime;
    const S = Math.sin(ph), C = Math.cos(ph);
    const A = w.amplitude * curAmp;
    const QA = w.Q * A;
    ox += QA * w.dirX * C;
    oz += QA * w.dirZ * C;
    y += A * S;
  }
  gOX = ox; gOZ = oz; gY = y;
}

// Edge fade of the wave mesh, measured from the undisplaced point to the camera.
function fadeAt(px, pz) {
  const dx = px - camX, dz = pz - camZ;
  const d = Math.sqrt(dx * dx + dz * dz);
  let t = (d - FOG_EDGE_NEAR) / (FOG_EDGE_FAR - FOG_EDGE_NEAR);
  t = clamp(t, 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

// Ripples + vortex height at world (x,z), matches the shader.
function extAt(x, z) {
  let h = 0;
  for (let i = 0; i < RIP_N; i++) {
    const r = RIP[i];
    if (!r.on) continue;
    const a = curTime - r.t0;
    if (a < 0 || a >= RIP_LIFE) continue;
    const dx = x - r.x, dz = z - r.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const xx = d - a * r.spd;
    h += r.str * Math.exp(-a * 0.55) * Math.sin(xx * 0.55) * Math.exp(-(xx * xx) / 49.0);
  }
  if (vDepth > 0.0001) {
    const dx = x - vx, dz = z - vz;
    const rr = Math.max(vR, 1.0);
    h -= vDepth * Math.exp(-(dx * dx + dz * dz) / (rr * rr) * 2.5);
  }
  return h;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */
// Water surface height at world (x,z). Inverts the horizontal Gerstner
// displacement with 3 fixed-point iterations. No allocations.
function heightAt(x, z) {
  if (!ready) return 0;
  let px = x, pz = z;
  for (let it = 0; it < 3; it++) {
    gerstnerAt(px, pz);
    const f = fadeAt(px, pz);
    px = x - gOX * f;
    pz = z - gOZ * f;
  }
  gerstnerAt(px, pz);
  const f = fadeAt(px, pz);
  return discY * (1 - f) + f * (gY + extAt(x, z));
}

function normalAt(x, z, out) {
  out = out || G.__oceanTmpN || (G.__oceanTmpN = new THREE.Vector3());
  if (!ready) return out.set(0, 1, 0);
  const e = 0.6;
  const dhx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  const dhz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  return out.set(-dhx, 1, -dhz).normalize();
}

function setStorm(t) {
  stormT = clamp(+t || 0, 0, 1);
}

function addRipple(x, z, strength, speed) {
  let slot = null;
  for (let i = 0; i < RIP_N; i++) {
    const r = RIP[i];
    if (!r.on || G.time - r.t0 >= RIP_LIFE) { slot = r; break; }
  }
  if (!slot) {
    slot = RIP[0];
    for (let i = 1; i < RIP_N; i++) if (RIP[i].t0 < slot.t0) slot = RIP[i];
  }
  slot.on = true;
  slot.x = x;
  slot.z = z;
  slot.t0 = G.time || 0;
  slot.str = strength;
  slot.spd = (speed && speed > 0) ? speed : RIP_SPEED;
}

function setVortex(x, z, radius, depth) {
  if (depth > 0) {
    vx = x; vz = z;
    vR = Math.max(1, radius || 10);
    vTarget = depth;
  } else {
    vTarget = 0;
  }
}

function flash(intensity) {
  flashV = Math.max(flashV, clamp(+intensity || 0, 0, 1));
}

function reset() {
  for (let i = 0; i < RIP_N; i++) RIP[i].on = false;
  vTarget = 0;
  vDepth = 0;
  stormT = 0;
  flashV = 0;
}

function update(dt) {
  if (!ready) return;
  if (!(dt > 0)) dt = 0;
  curTime = G.time || 0;

  stormV += (stormT - stormV) * (1 - Math.exp(-0.4 * dt));
  G.ocean.storm = stormV;
  curAmp = 1 + stormV * 1.3;
  discY = -(2.5 + 2.0 * (curAmp - 1));

  vDepth += (vTarget - vDepth) * (1 - Math.exp(-1.5 * dt));
  if (vDepth < 0.0005 && vTarget <= 0) vDepth = 0;

  flashV *= Math.exp(-6 * dt);
  if (flashV < 0.001) flashV = 0;

  const cam = G.camera;
  if (cam) {
    camX = cam.position.x;
    camZ = cam.position.z;
  }

  // water mesh snaps to the cell grid so vertices never swim
  const ox = Math.floor(camX / CELL) * CELL;
  const oz = Math.floor(camZ / CELL) * CELL;
  waterMesh.position.set(ox, 0, oz);
  discMesh.position.set(camX, discY, camZ);
  if (cam && skyMesh) skyMesh.position.copy(cam.position);

  const u = WU;
  u.uTime.value = curTime;
  u.uAmp.value = curAmp;
  u.uStorm.value = stormV;
  u.uFlash.value = flashV;
  u.uDiscY.value = discY;
  u.uCam.value.set(camX, camZ);
  u.uVortex.value.set(vx, vz, vR, vDepth);

  for (let i = 0; i < RIP_N; i++) {
    const r = RIP[i];
    const v = u.uRip.value[i];
    const a = curTime - r.t0;
    if (r.on && a >= 0 && a < RIP_LIFE) {
      v.set(r.x, r.z, r.t0, r.str);
      u.uRipSpd.value[i] = r.spd;
    } else {
      v.set(0, 0, 0, 0);
      u.uRipSpd.value[i] = RIP_SPEED;
    }
  }

  const fog = G.scene && G.scene.fog;
  fogCol.copy(FOG_BASE).lerp(FOG_STORM, stormV * 0.85);
  if (fog) {
    fog.color.copy(fogCol);
    fog.density = FOG_DENSITY * (1 + stormV);
    u.uFogDensity.value = fog.density;
  }

  sunLight.intensity = 2.2 + flashV * 1.5;
  hemiLight.intensity = 0.9 + flashV * 0.5;
}

function init() {
  if (ready || !G.scene) return;
  const C = THREE.Color;

  FOG_BASE = new C(HAZE_HEX);     // cool haze, equals sky horizon
  FOG_STORM = new C(0x3a4350);
  fogCol = new C().copy(FOG_BASE);

  SH = {
    uTime: { value: 0 },
    uStorm: { value: 0 },
    uFlash: { value: 0 },
    uSunDir: { value: SUN_DIR },
    uSunColor: { value: new C(1.0, 0.84, 0.6) },
    uHorizon: { value: new C(HAZE_HEX) },
    uZenith: { value: new C(0x3f6fa8) }
  };

  const ripV = [];
  const ripSpd = [];
  for (let i = 0; i < RIP_N; i++) { ripV.push(new THREE.Vector4(0, 0, 0, 0)); ripSpd.push(RIP_SPEED); }

  WU = Object.assign({}, SH, {
    uAmp: { value: 1 },
    uWaveA: { value: WAVES.map(function (w) { return new THREE.Vector4(w.dirX, w.dirZ, w.k, w.amplitude); }) },
    uWaveB: { value: WAVES.map(function (w) { return new THREE.Vector4(w.Q, w.w, 0, 0); }) },
    uRip: { value: ripV },
    uRipSpd: { value: ripSpd },
    uVortex: { value: new THREE.Vector4(0, 0, 10, 0) },
    uCam: { value: new THREE.Vector2(0, 0) },
    uDiscY: { value: discY },
    uFogColor: { value: fogCol },
    uFogDensity: { value: FOG_DENSITY },
    uDeep: { value: new C(0x06324a) },
    uFace: { value: new C(0x0a5a70) },
    uTurq: { value: new C(0x27c9bc) }
  });

  // Sky dome
  const skyMat = new THREE.ShaderMaterial({
    uniforms: SH,
    vertexShader: SKY_VS,
    fragmentShader: COMMON_GLSL + SKY_FS,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false
  });
  skyMesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_R, 32, 16), skyMat);
  skyMesh.renderOrder = -1000;
  skyMesh.frustumCulled = false;
  G.scene.add(skyMesh);

  // Main water: flat grid, displaced in the vertex shader
  const wGeo = new THREE.PlaneGeometry(MESH_SIZE, MESH_SIZE, MESH_SEG, MESH_SEG);
  wGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.ShaderMaterial({
    uniforms: WU,
    vertexShader: COMMON_GLSL + WATER_VS,
    fragmentShader: COMMON_GLSL + WATER_FS,
    side: THREE.DoubleSide,
    fog: false
  });
  waterMesh = new THREE.Mesh(wGeo, waterMat);
  waterMesh.frustumCulled = false;
  G.scene.add(waterMesh);

  // Far disc: same shading, no displacement, hidden by fog
  const dGeo = new THREE.CircleGeometry(DISC_R, 64);
  dGeo.rotateX(-Math.PI / 2);
  const discMat = new THREE.ShaderMaterial({
    uniforms: WU,
    vertexShader: COMMON_GLSL + WATER_VS,
    fragmentShader: COMMON_GLSL + WATER_FS,
    defines: { FLAT: 1 },
    side: THREE.DoubleSide,
    fog: false
  });
  discMesh = new THREE.Mesh(dGeo, discMat);
  discMesh.frustumCulled = false;
  G.scene.add(discMesh);

  // Lights
  sunLight = new THREE.DirectionalLight(new C(1.0, 0.86, 0.66), 2.2);
  sunLight.position.copy(SUN_DIR).multiplyScalar(100);
  G.scene.add(sunLight);
  hemiLight = new THREE.HemisphereLight(new C(0x9fd3ea), new C(0x0b3a4a), 0.9);
  G.scene.add(hemiLight);

  // Fog
  G.scene.fog = new THREE.FogExp2(new C().copy(FOG_BASE), FOG_DENSITY);

  ready = true;
  update(0);
}

G.ocean = {
  init: init,
  update: update,
  reset: reset,
  heightAt: heightAt,
  normalAt: normalAt,
  storm: 0,
  setStorm: setStorm,
  addRipple: addRipple,
  setVortex: setVortex,
  flash: flash,
  sunDir: SUN_DIR
};

})();
