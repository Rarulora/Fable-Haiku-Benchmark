# KARA BAYRAK — Architecture Contract (READ FULLY, FOLLOW EXACTLY)

A 3D pirate roguelite that ships as ONE html file. Three.js **r160** is available as the global `THREE`
(classic script, no ES modules, no imports, no other libraries, no external assets/fonts/URLs).
Several authors write separate files in parallel; nobody sees the others' code. This contract is the
only thing that makes the pieces fit. **If the contract names a function/field/event, use that exact
name and shape. Do not invent APIs on other modules. Do not implement things owned by another file.**

## 0. Files and load order
Files are concatenated as classic `<script>` blocks in this order:

1. `core.js`   — G namespace, event bus, utils, state, config
2. `ocean.js`  — water, sky, lights, fog
3. `vfx.js`    — particles, shake, damage numbers, lightning, rain
4. `audio.js`  — procedural WebAudio
5. `ships.js`  — ship models, ship physics/buoyancy, statuses, sinking
6. `combat.js` — cannons, projectiles, damage, enemy AI, spawner, XP/loot
7. `perks.js`  — perk framework + 6 perks
8. `perks2.js` — 6 perks
9. `perks3.js` — 6 perks
10. `ui.js`    — HUD, menus, level-up cards (all DOM/CSS)
11. `main.js`  — renderer, input, camera, game loop, game flow

Every file is wrapped: `(function(){ 'use strict'; const G = window.G; ... })();`
(`core.js` creates `window.G`.) At load time a file may ONLY define things on `G` and register
event listeners with `G.on`. **Never touch `G.scene`, `G.camera`, `G.renderer`, the DOM, or other
modules' functions at load time** — only inside `init()` or later. Calling other modules at runtime
(inside init/update/handlers) is fine since everything is loaded by then.

Each module `X` exposes `G.X.init()` (called once by main after scene exists), `G.X.update(dt)`
(called every frame by main), and `G.X.reset()` (called on every new game) — unless stated otherwise.

## 1. Conventions
- Units ≈ meters, seconds, radians. **Y is up. Calm sea level is y = 0.**
- Ship heading is `yaw`. **Forward = (sin(yaw), 0, cos(yaw))**; ship models are built with the bow
  toward local **+Z**. Mesh `rotation.order = 'YXZ'`, `rotation.y = yaw`.
- **"right" = starboard = local −X; "left" = port = local +X.** (With a chase camera behind the ship,
  local −X is on the right of the screen.) Right vector = (−cos(yaw), 0, sin(yaw)).
  Increasing yaw turns the ship to the LEFT. ALWAYS use `G.util.fwd` / `G.util.right`, never re-derive.
- Sides are the strings `'left'` and `'right'`.
- Teams: `'player'`, `'ally'`, `'enemy'`. player+ally are friends. Use `G.util.hostile(a,b)`.
- Time: `G.time` = game seconds (frozen while paused / level-up). Never use Date.now/performance.now
  for gameplay.
- All player-facing text is **Turkish with correct Turkish characters** (ç ğ ı İ ö ş ü). Files are UTF‑8.
- Performance: target 60 FPS on a laptop GPU. No per-frame `new THREE.Vector3` etc. in hot loops
  (reuse module-level temps). Pool particles/projectiles. No shadow maps. No post-processing passes.
- Defensive coding: a missing optional thing must never throw inside the frame loop. Guard optional
  calls on other modules like `G.audio && G.audio.play && G.audio.play('x')` only for audio/vfx
  cosmetic calls; core gameplay APIs in this contract are guaranteed to exist.
- Code must pass `node --check yourfile.js`.

## 2. core.js (author: core/main agent)
```js
window.G = {
  time: 0,                 // game clock (s)
  scene:null, camera:null, renderer:null,   // set by main.js before any init()
  player:null,             // the player's ship object (see §5), set by main on game start
  state: { mode:'menu', level:1, xp:0, xpNext:32, gold:0, kills:0, score:0, wave:0,
           runTime:0, bossKills:0, damageDealt:0, hitstop:0 },
  input: { keys:{}, aim:new THREE.Vector3(), aimValid:false, mouseDown:false, mx:0, my:0 },
  CFG: { GRAVITY:30, MAX_ENEMIES:12, SPAWN_MIN:170, SPAWN_MAX:230, DESPAWN:420,
         XP_MAGNET:22, WORLD_FOG:0.0022 },
};
G.on(evt, fn)            // subscribe (no unsubscribe needed)
G.emit(evt, data)        // sync dispatch; each listener wrapped in try/catch (console.error)
G.setMode(mode)          // 'menu'|'playing'|'levelup'|'paused'|'gameover'; emits 'mode:changed' {mode, prev}
G.xpForLevel(level)      // Math.floor(20 + 12*Math.pow(level,1.5))
G.util = {
  clamp(v,a,b), lerp(a,b,t), rand(a,b), randInt(a,b) /*inclusive*/, pick(arr), sign(v),
  damp(cur,target,lambda,dt),          // exponential smoothing: lerp(cur,target,1-exp(-lambda*dt))
  angDiff(a,b),                        // shortest signed angle from a to b, in (-PI,PI]
  fwd(yaw,out), right(yaw,out),        // write into THREE.Vector3 `out`, return out
  dist2D(a,b), dist2DSq(a,b),          // a,b have .x .z
  hostile(shipA, shipB),               // true if teams are enemies
  worldToScreen(v3, out),              // out={x,y,visible}; pixel coords; visible=false if behind camera
  smoothstep(a,b,x)
};
```

### Events (the complete list — exact names and payloads)
| event | payload | emitted by |
|---|---|---|
| `mode:changed` | `{mode, prev}` | core (`G.setMode`) |
| `game:start` | `{}` | main, after reset and player creation |
| `game:over` | `{}` | main |
| `ship:spawned` | `{ship}` | ships |
| `ship:predamage` | `{ship, amount, source, cancel:false}` (mutable: listeners may change `amount` or set `cancel=true`) | combat |
| `ship:damaged` | `{ship, amount, source}` | combat |
| `ship:prekill` | `{ship, source, cancel:false}` (listener may set `cancel=true` after restoring hp) | combat |
| `ship:killed` | `{ship, source}` | combat |
| `ship:removed` | `{ship}` | ships |
| `ship:collide` | `{a, b, relSpeed}` | ships (once per pair per 0.5 s) |
| `proj:spawn` | `{proj}` (listeners may mutate proj) | combat |
| `proj:hit` | `{proj, ship, pos}` | combat |
| `proj:splash` | `{proj, pos}` (projectile hit water and is finished) | combat |
| `broadside:fired` | `{ship, side, count}` | combat |
| `xp:gained` | `{amount}` | combat |
| `gold:gained` | `{amount}` | combat |
| `player:levelup` | `{level}` | combat |
| `player:healed` | `{amount}` | combat |
| `player:dash` | `{ship}` | ships |
| `perk:acquired` | `{id, level, def}` | perks |
| `wave:started` | `{wave}` | combat |
| `boss:spawned` | `{ship}` | combat |

`source` (damage source) is always an object: `{type, owner, pos}` — `type` one of
`'cannon','ram','fire','explosion','lightning','kraken','shark','curse','mortar','harpoon','wave','collision','vortex'`;
`owner` = ship or null; `pos` = THREE.Vector3 or null.

## 3. ocean.js
```js
G.ocean = {
  init(), update(dt), reset(),
  heightAt(x,z),              // water surface height at world x,z at time G.time. MUST match the shader.
  normalAt(x,z,out),          // unit surface normal into out (Vector3), returns out
  storm: 0,                   // current 0..1 (read-only for others)
  setStorm(target),           // 0..1 target; ocean eases toward it (bigger, choppier waves, darker sky)
  addRipple(x,z,strength,speed),   // expanding ring wave (strength≈ height in m, 0.3 small splash … 3 tidal wave; speed m/s default 14). Visible in shader AND included in heightAt. Up to 8 live ripples (oldest replaced).
  setVortex(x,z,radius,depth),     // one whirlpool funnel depression (depth 0 = off). Shader + heightAt.
  flash(intensity),           // lightning flash: brighten sky/light briefly (0..1)
  sunDir: THREE.Vector3       // unit vector toward the sun
};
```
Owns: water mesh + shader, sky dome, sun, all lights (directional + hemisphere/ambient), `scene.fog`.

## 4. vfx.js — purely cosmetic, never affects gameplay
All positions are THREE.Vector3 (the function copies them; caller may reuse its vector).
```js
G.vfx = {
  init(), update(dt), reset(),
  muzzle(pos, dir),            // cannon flash + smoke puff along dir
  smoke(pos, count, scale),
  splash(pos, scale),          // water column + droplets + foam ring (scale 1 = cannonball)
  explosion(pos, scale),       // fireball + smoke + sparks + flash (scale 1 ≈ 5 m)
  fire(pos, scale),            // call repeatedly (each ~0.1 s) to keep something burning
  sparks(pos, count),
  debris(pos, count),          // wood splinters flying out and falling into the sea
  foam(pos, scale),            // short-lived white foam patch on the water (wakes)
  ring(pos, radius, color, duration),  // expanding flat shockwave ring on water; color = hex number
  beam(from, to, color, duration),     // straight glowing line (e.g. rope flash, curse link)
  lightning(from, to),         // jagged bolt + flash (calls G.ocean.flash)
  ghostPuff(pos, scale),       // spectral cyan-green wisps
  hitNumber(pos, text, color), // floating combat text; color = CSS string
  shake(amount),               // camera shake impulse, ~0.2 light … 1.5 huge
  hitstop(seconds),            // sets G.state.hitstop = max(current, seconds)
  setRain(intensity),          // 0..1
  shakeOffset: THREE.Vector3   // main adds this to the camera position every frame
};
```

## 5. ships.js
```js
G.ships = {
  init(), update(dt), reset(),          // reset removes every ship from scene and list
  list: [],                             // all ship objects currently in the world (alive or sinking)
  DEFS: { player, sloop, brig, galleon, fireship, mortar, boss, ghost },
  create(type, opts),                   // opts {team, x, z, yaw}; builds mesh, adds to scene+list, emits ship:spawned, returns ship
  remove(ship),                         // immediate removal (mesh disposed, removed from list, emits ship:removed)
  setGhost(ship, on),                   // spectral translucent cyan look
  setTint(ship, hexOrNull)              // temporary emissive tint (e.g. curse purple, burn orange); null clears
};
```
### Ship object (exact fields; everyone reads these)
```js
ship = {
  id, type, def, team,
  pos: Vector3,            // y follows the water
  yaw, pitch, roll,
  speed,                   // signed forward speed m/s
  throttle,                // 0..1 desired sail (set by main for player, by AI for others)
  rudder,                  // -1..1 ; +1 = turn LEFT (yaw increases)
  ext: Vector3,            // external velocity (knockback/pull); added to movement, decays ~1.5/s. Others ADD to it.
  hp, alive, sinking, sinkT,
  radius, length, width,   // collision sizes (copied from def)
  mesh: THREE.Group,
  stats: { maxHp, maxSpeed, accel, turnRate, cannonsPerSide, reloadTime, damage, projSpeed, range,
           volleys /*1*/, sternCannons /*0*/, bowCannons /*0*/ },   // copied from def; perks mutate the PLAYER's stats
  reload: { left:0, right:0 },   // seconds until that side can fire again (combat ticks these)
  status: { slowT:0, slowAmt:0, stunT:0, burnT:0, burnDps:0, curseT:0, harpooned:false },
  dashT:0, dashCd:0, dashCdMax:5,     // player dash (Shift)
  ai: {},                  // free scratch for combat.js
  isBoss, isGhost,
  // methods
  dash(),                  // if dashCd<=0: 0.9 s speed burst, set dashCd, emit player:dash, return true
  cannonPos(side, i, out), // world position of cannon i (0..cannonsPerSide-1) on side, into out
};
```
`DEFS[type]` has: `name` (Turkish), `hp, maxSpeed, accel, turnRate, length, width, radius,
cannonsPerSide, reloadTime, damage, projSpeed, range, xp, gold, scale` + colors.
Reference numbers: player — hp 100, maxSpeed 17, turnRate 1.1 rad/s, length 16, width 5, 4 cannons/side,
reload 2.4 s, damage 12, projSpeed 85, range 120. sloop — hp 34, fast (15), 2 cannons, xp 10.
brig — hp 80, 4 cannons, xp 22. galleon — hp 190, slow (9), 7 cannons, xp 50. fireship — hp 30, very fast (20),
no cannons, xp 14. mortar — hp 60, slow, xp 28. boss — hp 900, length 34, 10 cannons, xp 300. ghost — ally version of brig.

ships.js owns: physics integration from throttle/rudder, buoyancy (y/pitch/roll from `G.ocean.heightAt`
sampled at bow/stern/left/right, with spring lag), wake foam, sail/flag animation, ship–ship collision
(push apart + `ship:collide`), status timers (slow, stun, burn → burn damage via `G.combat.damageShip`
every 0.5 s with source type `'fire'`, plus `G.vfx.fire`), the sinking animation (ship with `sinking=true`
tilts and goes under over ~4 s, then is removed), and the dash.
ships.js does NOT decide throttle/rudder for anyone, does NOT fire cannons, does NOT kill ships.

## 6. combat.js
```js
G.combat = {
  init(), update(dt), reset(),
  projectiles: [],
  tryFire(ship, side, aimPoint),     // broadside if reload[side]<=0 && not stunned. aimPoint (Vector3 on water) or null → auto range. returns bool
  fireProjectile(opts),              // spawn one projectile, returns proj (see below)
  launchAt(from, target, speed, opts), // helper: ballistic solve so it lands at target (Vector3); opts as fireProjectile; returns proj
  damageShip(ship, amount, source),  // full pipeline: predamage → hp → damaged → (prekill → killed). returns actual damage dealt
  killShip(ship, source),
  explode(pos, radius, damage, source, team), // area damage (falloff) to ships hostile to `team`, + vfx.explosion + ocean ripple
  heal(amount),                      // heal player, emits player:healed
  addXP(amount), addGold(amount),
  enemies(),                         // array of alive (not sinking) ships with team 'enemy' (do not mutate)
  nearestEnemy(pos, maxDist, exclude), // nearest alive enemy ship to pos within maxDist (exclude = ship or Set or null), or null
  spawnEnemy(type, x, z),            // create + set up AI; x,z optional (random ring around player)
  spawnAlly(type, x, z, lifetime),   // ally ship with AI that hunts enemies; auto-sinks after lifetime s
  dropXP(pos, amount), dropLoot(pos, kind)  // kind 'repair' | 'gold'
};
```
### Projectile object
```js
proj = { pos:Vector3, vel:Vector3, owner:ship|null, team, damage, kind /*'ball'|'mortar'|'chain'|'fire'|...*/,
         radius /*hit radius, default 0.7*/, gravity /*default G.CFG.GRAVITY*/, life,
         bounces:0,     // if >0 when hitting water: skip off the surface (keep 65% speed, flip vy to +35% of speed), bounces--, small splash; NOT finished
         pierce:0,      // if >0 when hitting a ship: keep flying, pierce--, never hit the same ship twice
         blast:0,       // if >0: on ship hit or final water impact call G.combat.explode(pos, blast, damage*0.6, ...)
         flags:{},      // free for perks (e.g. flags.chain, flags.greekfire)
         color: 0x222222, scale:1, trail:true, mesh }
fireProjectile(opts)   // opts: any of the fields above; required: pos, vel, team. Emits proj:spawn AFTER filling defaults.
```
combat.js owns: projectile simulation and collision (vs hostile ships: ship-local box test using
ship.length/width; vs water: `G.ocean.heightAt`), staggered broadsides, the player's aim preview arcs,
all damage/kill bookkeeping (`G.state.kills/score/damageDealt/bossKills`), enemy + ally AI
(sets `ship.throttle`/`ship.rudder`, calls `tryFire`), the spawn director/waves/boss,
XP orbs + loot pickups, XP/level bookkeeping (`G.state.xp/xpNext/level`, emits `player:levelup`).
`damageShip` on a ship with `alive===false` does nothing. Cannon damage = `owner.stats.damage` per ball.

## 7. perks.js / perks2.js / perks3.js
```js
G.perks = {
  init(), update(dt), reset(),
  DEFS: {},  order: [],
  register(def),              // perks2/perks3 call this at load time
  owned: {},                  // id -> level (1..maxLevel)
  level(id),                  // 0 if not owned
  actives: [],                // [{id, def, key, cd, cdMax}] in acquisition order; keys 'Space','F','R','C'
  useActive(slotIndex),       // main calls on key press; handles cooldown; returns bool
  rollChoices(n),             // n distinct choice objects
  rerollsLeft: 2, reroll(),   // returns new choices array or null
  acquire(id),                // level up that perk, call def.onAcquire, emit perk:acquired
  spawnFirePatch(pos, radius, duration, dps),  // burning sea patch that burns ENEMY ships inside (shared hazard)
};
// def:
{ id, name, icon /*one emoji*/, rarity /*'common'|'rare'|'epic'|'legendary'*/, maxLevel:3,
  desc:[lvl1Text, lvl2Text, lvl3Text],          // Turkish, each describes what THAT level gives
  tagline,                                      // short Turkish flavour line
  active: null | { cooldown(lvl) /*seconds*/, use(lvl) /*do it, return true if used*/ },
  onAcquire(lvl), update(dt,lvl) /*only called while owned & mode playing*/, reset() }
// choice object (what UI receives):
{ id, name, icon, rarity, nextLevel, maxLevel, desc /*text for nextLevel*/, tagline, isNew, isActive, key /*key label if active, else ''*/ }
```
Flow owned by perks.js: on `player:levelup` → queue; `G.setMode('levelup')`;
`G.ui.showLevelUp(choices, onPick)`; `onPick(id)` → `acquire(id)` → next queued or `G.setMode('playing')`.
Fallback choices when fewer than n perks are available: ids `'_repair'` (heal 40%) and `'_gold'` (+150 gold) —
handled inside `acquire`.

Perk ids (fixed): perks.js — `chainshot, greekfire, ricochet, doublebroadside, chasers, plunderer`;
perks2.js — `kraken, ghostfleet, sharks, curse, deadmanschest, storm`;
perks3.js — `harpoon` (active), `ram`, `kegs`, `mortar` (active), `tidalwave` (active), `whirlpool` (active).

## 8. audio.js
```js
G.audio = { init(), update(dt), reset(), unlock() /*call on first user gesture*/,
            play(name, opts /*{volume, pos:Vector3 (distance attenuation from G.camera), pitch}*/),
            setMuted(bool), muted:false, setStorm(x) };
```
Names: `cannon, cannon_far, splash, hit, explosion, sink, xp, gold, levelup, perk, click, hover,
lightning, hurt, dash, harpoon, kraken, ghost, shark, bell, mortar, whoosh, wave, fire, curse, gameover, boss`.
audio.js subscribes to the events itself for the standard sounds (broadside:fired, proj:hit, proj:splash,
ship:killed, xp:gained, player:levelup, perk:acquired, ship:damaged on player, boss:spawned, player:dash…),
so other modules only call `G.audio.play` for special sounds (perk abilities). Unknown name = silent no-op.

## 9. ui.js (DOM + CSS only, creates its own root `<div id="ui">` and `<style>` in init)
```js
G.ui = { init(), update(dt), reset(),
         showLevelUp(choices, onPick),   // modal with cards; calls onPick(id) exactly once
         showGameOver(stats), showMenu(), toast(text, color), banner(title, subtitle) };
```
The menu's start button and game-over's restart button call `G.startGame()`.
ui.js reads state directly each frame: `G.state`, `G.player`, `G.ships.list`, `G.perks.owned/actives/DEFS`.

## 10. main.js
`G.startGame()` — resets everything (`ships.reset, combat.reset, perks.reset, vfx.reset, ocean.reset,
audio.reset, ui.reset`, state), creates `G.player = G.ships.create('player',{team:'player',x:0,z:0,yaw:0})`,
`G.setMode('playing')`, emits `game:start`.
Frame: `dt = min(realDt, 0.05)`; if `G.state.hitstop>0` gameplay dt is 0 for that long;
gameplay modules update only in modes `playing` and `gameover` and `menu` (world keeps living);
in `levelup`/`paused` nothing gameplay updates and `G.time` is frozen. `G.ui.update` and render run always.
Controls: **W** sail (throttle 1 while held, otherwise 0), **S** brake, **A/D** rudder (A = left = rudder +1),
mouse = aim point on the sea (`G.input.aim`), **LMB** = fire the broadside on the side the cursor is on,
**Q/E** = fire left/right, **Shift** = dash, **Space/F/R/C** = active perk slots 0..3, **Esc/P** = pause, **M** = mute.
`G.debug = { xp(n), perk(id), spawn(type), god(bool), kill() }` for testing.
