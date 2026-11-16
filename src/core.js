(function () {
  'use strict';

  const T = THREE;
  const TAU = Math.PI * 2;

  const G = (window.G = {
    time: 0,                       // game clock (s)
    scene: null,
    camera: null,
    renderer: null,
    player: null,                  // player's ship object, set by main on game start
    state: {
      mode: 'menu', level: 1, xp: 0, xpNext: 32, gold: 0, kills: 0, score: 0, wave: 0,
      runTime: 0, bossKills: 0, damageDealt: 0, hitstop: 0
    },
    input: {
      keys: {}, aim: new T.Vector3(), aimValid: false, mouseDown: false, mx: 0, my: 0
    },
    CFG: {
      GRAVITY: 30, MAX_ENEMIES: 12, SPAWN_MIN: 170, SPAWN_MAX: 230, DESPAWN: 420,
      XP_MAGNET: 22, WORLD_FOG: 0.0022
    }
  });

  // ---------- event bus ----------
  const _listeners = Object.create(null);

  G.on = function (evt, fn) {
    if (typeof fn !== 'function') return;
    let arr = _listeners[evt];
    if (!arr) arr = _listeners[evt] = [];
    arr.push(fn);
  };

  G.emit = function (evt, data) {
    const arr = _listeners[evt];
    if (!arr) return;
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      try {
        arr[i](data);
      } catch (err) {
        console.error('[G.emit] listener for "' + evt + '" failed:', err);
      }
    }
  };

  // ---------- mode ----------
  G.setMode = function (mode) {
    const prev = G.state.mode;
    if (prev === mode) return;
    G.state.mode = mode;
    G.emit('mode:changed', { mode: mode, prev: prev });
  };

  G.xpForLevel = function (level) {
    return Math.floor(20 + 12 * Math.pow(level, 1.5));
  };

  // ---------- utilities ----------
  const _w = new T.Vector3();
  const _p = new T.Vector3();

  G.util = {
    clamp(v, a, b) {
      return v < a ? a : (v > b ? b : v);
    },
    lerp(a, b, t) {
      return a + (b - a) * t;
    },
    rand(a, b) {
      return a + Math.random() * (b - a);
    },
    randInt(a, b) {
      return Math.floor(a + Math.random() * (b - a + 1));
    },
    pick(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    },
    sign(v) {
      return v > 0 ? 1 : (v < 0 ? -1 : 0);
    },
    damp(cur, target, lambda, dt) {
      return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
    },
    angDiff(a, b) {
      let d = (b - a) % TAU;          // (-TAU, TAU)
      if (d > Math.PI) d -= TAU;
      else if (d <= -Math.PI) d += TAU;
      return d;                       // (-PI, PI]
    },
    fwd(yaw, out) {
      return out.set(Math.sin(yaw), 0, Math.cos(yaw));
    },
    right(yaw, out) {
      return out.set(-Math.cos(yaw), 0, Math.sin(yaw));
    },
    dist2DSq(a, b) {
      const dx = a.x - b.x, dz = a.z - b.z;
      return dx * dx + dz * dz;
    },
    dist2D(a, b) {
      return Math.sqrt(G.util.dist2DSq(a, b));
    },
    hostile(a, b) {
      if (!a || !b) return false;
      // enemy is hostile to player and ally; player and ally are friends.
      return (a.team === 'enemy') !== (b.team === 'enemy');
    },
    worldToScreen(v3, out) {
      const cam = G.camera;
      if (!cam || !v3) {
        out.x = 0; out.y = 0; out.visible = false;
        return out;
      }
      _w.copy(v3).applyMatrix4(cam.matrixWorldInverse);   // view space (camera looks down -Z)
      if (_w.z >= 0) {                                    // behind the camera
        out.x = 0; out.y = 0; out.visible = false;
        return out;
      }
      _p.copy(_w).applyMatrix4(cam.projectionMatrix);     // NDC
      out.x = (_p.x * 0.5 + 0.5) * window.innerWidth;
      out.y = (-_p.y * 0.5 + 0.5) * window.innerHeight;
      out.visible = true;
      return out;
    },
    smoothstep(a, b, x) {
      const d = b - a;
      const t = d === 0 ? (x >= a ? 1 : 0) : G.util.clamp((x - a) / d, 0, 1);
      return t * t * (3 - 2 * t);
    }
  };
})();
