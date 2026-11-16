(function () {
  'use strict';

  const G = window.G;
  const T = THREE;

  const BEST_KEY = 'karabayrak_best';
  const GAMEOVER_DELAY_MS = 2800;
  const INIT_ORDER = ['ocean', 'vfx', 'audio', 'ships', 'combat', 'perks', 'ui'];
  const RESET_ORDER = ['ships', 'combat', 'perks', 'vfx', 'ocean', 'audio', 'ui'];
  const SIM_ORDER = ['ocean', 'ships', 'combat', 'perks', 'vfx', 'audio'];
  const AIM_MAX_DIST = 400;
  const PEEK_MAX = 110;      // max aim offset (m) used for camera peek, before the 0.12 factor
  const PEEK_FACTOR = 0.12;
  const PREVENT_CODES = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };

  // ---------- error reporting (throttled to once per second per key) ----------
  const _errT = Object.create(null);
  function logErr(key, err) {
    const now = performance.now();
    if (_errT[key] === undefined || now - _errT[key] > 1000) {
      _errT[key] = now;
      console.error('[main] ' + key + ' failed:', err);
    }
  }

  function callMod(name, fn, arg) {
    const m = G[name];
    if (!m || typeof m[fn] !== 'function') return;
    try {
      m[fn](arg);
    } catch (err) {
      logErr(name + '.' + fn, err);
    }
  }

  // ---------- module-level temps (no per-frame allocation) ----------
  const _ndc = new T.Vector3();
  const _ray = new T.Raycaster();
  const _seaPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  const _fwd = new T.Vector3();
  const _right = new T.Vector3();
  const _d = new T.Vector3();
  const _desPos = new T.Vector3();
  const _desLook = new T.Vector3();
  const _camPos = new T.Vector3();
  const _camVel = new T.Vector3();
  const _camLook = new T.Vector3();
  const _lastPos = new T.Vector3();

  let _camYaw = 0;
  let _peekX = 0, _peekZ = 0;   // smoothed aim-peek offset (xz)
  let _zoomT = 1, _zoom = 1;    // wheel zoom target / smoothed value
  let _fov = 55;
  let _orbitAng = 0;
  let _camInit = false;
  let _modeT = 0;
  let _prevMode = 'menu';
  let _god = false;
  let _goAt = 0;
  let _booted = false;
  let _unlocked = false;
  let _last = 0;
  const _edge = Object.create(null);   // one-frame key-press flags (keydown, non-repeat)

  // ---------- audio unlock ----------
  function unlockAudio() {
    if (_unlocked) return;
    _unlocked = true;
    callMod('audio', 'unlock');
  }

  // ---------- input ----------
  function clearInput() {
    const keys = G.input.keys;
    for (const k in keys) keys[k] = false;
    G.input.mouseDown = false;
    for (const k in _edge) _edge[k] = false;
  }

  function clearEdges() {
    for (const k in _edge) _edge[k] = false;
  }

  function onKeyDown(e) {
    const code = e.code;
    unlockAudio();
    if (PREVENT_CODES[code]) e.preventDefault();
    G.input.keys[code] = true;
    if (!e.repeat) _edge[code] = true;
  }

  function onKeyUp(e) {
    G.input.keys[e.code] = false;
    if (PREVENT_CODES[e.code]) e.preventDefault();
  }

  function onMouseMove(e) {
    G.input.mx = e.clientX;
    G.input.my = e.clientY;
  }

  function onCanvasDown(e) {
    if (e.button === 0) G.input.mouseDown = true;
    unlockAudio();
  }

  function onMouseUp(e) {
    if (e.button === 0) G.input.mouseDown = false;
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  function onResize() {
    const r = G.renderer, c = G.camera;
    if (!r || !c) return;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(window.innerWidth, window.innerHeight);
    c.aspect = window.innerWidth / window.innerHeight;
    c.updateProjectionMatrix();
  }

  // Mouse position -> aim point on the sea plane (y = 0).
  function updateAim() {
    const cam = G.camera;
    if (!cam) return;
    const inp = G.input;
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    _ndc.set((inp.mx / w) * 2 - 1, -(inp.my / h) * 2 + 1, 0.5);
    _ray.setFromCamera(_ndc, cam);
    const ray = _ray.ray;
    const hit = ray.intersectPlane(_seaPlane, inp.aim);
    if (hit === null || ray.origin.distanceTo(inp.aim) > AIM_MAX_DIST) {
      // Sky or far horizon: clamp to a point AIM_MAX_DIST away along the horizontal ray direction.
      const hl = Math.hypot(ray.direction.x, ray.direction.z);
      const ux = hl > 1e-4 ? ray.direction.x / hl : 0;
      const uz = hl > 1e-4 ? ray.direction.z / hl : -1;
      inp.aim.set(ray.origin.x + ux * AIM_MAX_DIST, 0, ray.origin.z + uz * AIM_MAX_DIST);
    }
    inp.aimValid = true;
  }

  // Pause / mute toggles (work in any mode, pause only flips playing <-> paused).
  function handleModeKeys() {
    if (_edge.Escape || _edge.KeyP) {
      const m = G.state.mode;
      if (m === 'playing') G.setMode('paused');
      else if (m === 'paused') G.setMode('playing');
    }
    if (_edge.KeyM && G.audio) {
      try {
        G.audio.setMuted(!G.audio.muted);
      } catch (err) {
        logErr('audio.setMuted', err);
      }
    }
  }

  // Player ship controls (mode 'playing' only).
  function controlPlayer(dt) {
    const p = G.player;
    if (!p || !p.alive) return;
    const k = G.input.keys;

    const fwdHeld = !!(k.KeyW || k.ArrowUp);
    const brake = !!(k.KeyS || k.ArrowDown);
    p.throttle = (fwdHeld && !brake) ? 1 : 0;
    if (brake && dt > 0) p.speed *= Math.exp(-1.5 * dt);
    p.rudder = ((k.KeyA || k.ArrowLeft) ? 1 : 0) - ((k.KeyD || k.ArrowRight) ? 1 : 0);

    const inp = G.input;
    if (inp.mouseDown) {
      G.util.right(p.yaw, _right);
      _d.subVectors(inp.aim, p.pos);
      const side = _d.dot(_right) > 0 ? 'right' : 'left';
      G.combat.tryFire(p, side, inp.aimValid ? inp.aim : null);
    }
    if (k.KeyQ) G.combat.tryFire(p, 'left', null);
    if (k.KeyE) G.combat.tryFire(p, 'right', null);

    if (_edge.ShiftLeft || _edge.ShiftRight) p.dash();
    if (_edge.Space) G.perks.useActive(0);
    if (_edge.KeyF) G.perks.useActive(1);
    if (_edge.KeyR) G.perks.useActive(2);
    if (_edge.KeyC) G.perks.useActive(3);
  }

  // ---------- camera ----------
  function safeGroundY(x, z) {
    if (!G.ocean || typeof G.ocean.heightAt !== 'function') return 0;
    try {
      return G.ocean.heightAt(x, z);
    } catch (err) {
      logErr('ocean.heightAt', err);
      return 0;
    }
  }

  function updateCamera(dt) {
    const cam = G.camera;
    if (!cam) return;
    const mode = G.state.mode;
    const p = G.player;
    let fovT = 55;

    if (p && (mode === 'playing' || mode === 'levelup' || mode === 'paused')) {
      // Chase camera: spring-smoothed, behind and above the ship.
      _lastPos.copy(p.pos);
      _camYaw += G.util.angDiff(_camYaw, p.yaw) * (1 - Math.exp(-2.5 * dt));
      G.util.fwd(_camYaw, _fwd);

      const sp = Math.abs(p.speed || 0);
      const maxS = (p.stats && p.stats.maxSpeed) || 17;
      const sN = G.util.clamp(sp / maxS, 0, 1);
      _zoom = G.util.damp(_zoom, _zoomT, 6, dt);
      const back = (40 + 8 * sN) * _zoom;
      const height = 24 * _zoom;

      // Aim peek: offset clamped to PEEK_MAX, then scaled, then smoothed.
      let tx = 0, tz = 0;
      if (G.input.aimValid) {
        const aim = G.input.aim;
        let ox = aim.x - p.pos.x, oz = aim.z - p.pos.z;
        const L = Math.sqrt(ox * ox + oz * oz);
        if (L > PEEK_MAX) { ox *= PEEK_MAX / L; oz *= PEEK_MAX / L; }
        tx = ox * PEEK_FACTOR;
        tz = oz * PEEK_FACTOR;
      }
      _peekX = G.util.damp(_peekX, tx, 3, dt);
      _peekZ = G.util.damp(_peekZ, tz, 3, dt);

      _desPos.set(p.pos.x - _fwd.x * back + _peekX * 0.5, p.pos.y + height, p.pos.z - _fwd.z * back + _peekZ * 0.5);
      _desLook.set(p.pos.x + _fwd.x * 10 + _peekX, p.pos.y + 2, p.pos.z + _fwd.z * 10 + _peekZ);

      if (!_camInit) {
        _camPos.copy(_desPos);
        _camLook.copy(_desLook);
        _camVel.set(0, 0, 0);
        _camInit = true;
      } else {
        const k = 38, c = 11;   // spring stiffness / damping (stable for dt <= 0.05)
        _camVel.x += ((_desPos.x - _camPos.x) * k - _camVel.x * c) * dt;
        _camVel.y += ((_desPos.y - _camPos.y) * k - _camVel.y * c) * dt;
        _camVel.z += ((_desPos.z - _camPos.z) * k - _camVel.z * c) * dt;
        _camPos.addScaledVector(_camVel, dt);
        _camLook.x = G.util.damp(_camLook.x, _desLook.x, 6, dt);
        _camLook.y = G.util.damp(_camLook.y, _desLook.y, 6, dt);
        _camLook.z = G.util.damp(_camLook.z, _desLook.z, 6, dt);
      }

      fovT = p.dashT > 0 ? 64 : 55 + 9 * sN;
    } else {
      // Orbit: menu (around showcase ship) or gameover/no-player (around last position).
      const c = (mode === 'menu' && p) ? p.pos : _lastPos;
      const h = mode === 'gameover' ? 14 + Math.min(_modeT * 0.8, 10) : 14;
      _orbitAng += 0.12 * dt;
      const ca = Math.cos(_orbitAng), sa = Math.sin(_orbitAng);
      _camPos.set(c.x + ca * 46, c.y + h, c.z + sa * 46);
      _camLook.set(c.x, c.y + 3, c.z);
      _camVel.set(0, 0, 0);
      _camInit = true;
      _peekX = 0;
      _peekZ = 0;
    }

    // Keep camera above the water.
    const gy = safeGroundY(_camPos.x, _camPos.z) + 4;
    if (_camPos.y < gy) _camPos.y = gy;

    // FOV widens with speed and dash.
    _fov = G.util.damp(_fov, fovT, 3, dt);
    if (Math.abs(cam.fov - _fov) > 0.01) {
      cam.fov = _fov;
      cam.updateProjectionMatrix();
    }

    cam.position.copy(_camPos);
    const sh = G.vfx && G.vfx.shakeOffset;
    if (sh) cam.position.add(sh);
    cam.lookAt(_camLook);
    cam.updateMatrixWorld();
  }

  // ---------- game flow ----------
  function finishGameOver() {
    let best = 0;
    try {
      best = Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch (err) {
      best = 0;
    }
    const score = Number(G.state.score) || 0;
    if (score > best) {
      best = score;
      try {
        localStorage.setItem(BEST_KEY, String(best));
      } catch (err) { /* storage unavailable */ }
    }
    const stats = Object.assign({}, G.state, { best: best });
    callMod('ui', 'showGameOver', stats);
  }

  G.startGame = function () {
    callMod('audio', 'unlock');
    for (let i = 0; i < RESET_ORDER.length; i++) callMod(RESET_ORDER[i], 'reset');

    const S = G.state;
    S.level = 1;
    S.xp = 0;
    S.xpNext = G.xpForLevel(1);
    S.gold = 0;
    S.kills = 0;
    S.score = 0;
    S.wave = 0;
    S.runTime = 0;
    S.bossKills = 0;
    S.damageDealt = 0;
    S.hitstop = 0;

    clearInput();
    _goAt = 0;
    G.player = null;
    try {
      G.player = G.ships.create('player', { team: 'player', x: 0, z: 0, yaw: 0 });
    } catch (err) {
      logErr('startGame.createPlayer', err);
    }
    G.setMode('playing');
    G.emit('game:start', {});
  };

  // Player death: switch to gameover, show stats after a real-time delay.
  function onShipKilled(e) {
    if (!e || e.ship !== G.player || G.state.mode !== 'playing') return;
    G.setMode('gameover');
    G.emit('game:over', {});
    _goAt = performance.now() + GAMEOVER_DELAY_MS;
  }

  function onWheel(e) {
    _zoomT = G.util.clamp(_zoomT * Math.exp(e.deltaY * 0.001), 0.7, 1.6);
  }

  function onPreDamage(e) {
    if (_god && G.player && e && e.ship === G.player) e.cancel = true;
  }

  // ---------- frame loop ----------
  function frame() {
    requestAnimationFrame(frame);

    const pn = performance.now();          // the one allowed real-time read
    let realDt = (pn - _last) / 1000;
    _last = pn;
    if (!(realDt > 0)) realDt = 0;
    const dtC = realDt < 0.05 ? realDt : 0.05;

    const st = G.state;
    let dt = dtC;
    if (st.hitstop > 0) {
      st.hitstop -= realDt;
      dt = 0;
    }

    updateAim();
    handleModeKeys();

    const mode = st.mode;
    if (mode !== _prevMode) {
      _prevMode = mode;
      _modeT = 0;
    }
    _modeT += dtC;

    if (mode === 'playing' || mode === 'gameover' || mode === 'menu') {
      G.time += dt;
      if (mode === 'playing') st.runTime += dt;

      if (mode === 'playing') {
        try {
          controlPlayer(dt);
        } catch (err) {
          logErr('player.control', err);
        }
      }

      for (let i = 0; i < SIM_ORDER.length; i++) {
        const name = SIM_ORDER[i];
        if (name === 'perks' && st.mode !== 'playing') continue;
        callMod(name, 'update', dt);
      }
    }

    if (_goAt && st.mode === 'gameover' && pn >= _goAt) {
      _goAt = 0;
      finishGameOver();
    }

    updateCamera(dtC);
    callMod('ui', 'update', dtC);
    clearEdges();

    if (G.renderer && G.scene && G.camera) {
      try {
        G.renderer.render(G.scene, G.camera);
      } catch (err) {
        logErr('render', err);
      }
    }
  }

  // ---------- boot ----------
  function boot() {
    if (_booted) return;
    _booted = true;

    let renderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      console.error('[main] WebGL renderer could not be created:', err);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    const el = renderer.domElement;
    el.style.position = 'fixed';
    el.style.top = '0';
    el.style.right = '0';
    el.style.bottom = '0';
    el.style.left = '0';
    el.style.zIndex = '0';
    el.style.display = 'block';
    document.body.appendChild(el);

    G.renderer = renderer;
    G.scene = new T.Scene();
    G.camera = new T.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 2500);
    G.camera.position.set(0, 20, 60);
    G.camera.updateMatrixWorld();

    G.input.mx = window.innerWidth / 2;
    G.input.my = window.innerHeight / 2;

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('blur', clearInput);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('pointerdown', unlockAudio);
    el.addEventListener('mousedown', onCanvasDown);

    G.on('ship:killed', onShipKilled);
    G.on('ship:predamage', onPreDamage);

    G.debug = {
      xp(n) { G.combat.addXP(n); },
      perk(id) { G.perks.acquire(id); },
      spawn(type) { return G.combat.spawnEnemy(type); },
      god(b) {
        _god = (b === undefined) ? !_god : !!b;
        return _god;
      },
      shot(name) {
        G.renderer.render(G.scene, G.camera);
        const url = '/shot?name=' + encodeURIComponent(name);
        return fetch(url, { method: 'POST', body: G.renderer.domElement.toDataURL('image/jpeg', 0.85) })
          .then(r => r.text())
          .catch(e => String(e));
      },
      kill() {
        const list = G.combat.enemies().slice();
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          G.combat.killShip(s, { type: 'cannon', owner: G.player || null, pos: s.pos });
        }
      }
    };

    for (let i = 0; i < INIT_ORDER.length; i++) callMod(INIT_ORDER[i], 'init');

    G.setMode('menu');
    callMod('ui', 'showMenu');

    try {
      G.player = G.ships.create('player', { team: 'player', x: 0, z: 0, yaw: 0 });
      if (G.player) G.player.throttle = 0.5;
    } catch (err) {
      logErr('menu.showcaseShip', err);
    }

    _prevMode = G.state.mode;
    _last = performance.now();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
