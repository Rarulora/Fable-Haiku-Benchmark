(function(){
'use strict';
const G = window.G;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const RARITY = {
  common:    { label: 'Sıradan', c: '#9aa7b0', rgb: '154,167,176' },
  rare:      { label: 'Nadir',   c: '#4aa3ff', rgb: '74,163,255' },
  epic:      { label: 'Destansı', c: '#b46bff', rgb: '180,107,255' },
  legendary: { label: 'Efsanevi', c: '#ffb02e', rgb: '255,176,46' }
};
const CONTROLS = [
  ['W', 'yelken'], ['S', 'fren'], ['A / D', 'dümen'], ['Fare', 'nişan'],
  ['Sol tık · Q · E', 'borda ateşi'], ['Shift', 'hamle'], ['Space · F · R · C', 'yetenekler'],
  ['Esc', 'duraklat'], ['M', 'ses']
];
const TIPS = [
  'Düşmanı bordana al ve borda ateşini kullan; sol tık, Q ve E ile ateş edersin.',
  'Shift ile kısa bir hamle yap; kaçmak ve pozisyon almak için en iyi araçtır.',
  'Seviye atladığında üç nimetten birini seç; doğru kombinasyon savaşı değiştirir.',
  'Aktif yetenekler Space, F, R ve C tuşlarındadır; halkası dolunca hazır olur.',
  'Gövde azaldığında denizde beliren tamir sandıklarını topla.'
];
const MM_RANGE = 260;     // minimap range (m)
const THREAT_RANGE = 200; // off-screen threat arrows (m)
const BAR_RANGE = 220;    // enemy health bar range (m)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let root = null;
let E = {};
let C = {};                 // value cache for DOM writes
let dpr = 1;
let _tv = null;             // lazily created THREE.Vector3 temp
const _sc = { x: 0, y: 0, visible: false };
let ghostPct = 100, ghostHold = 0, lastHp = null;
let tutState = 0;           // 0 idle, 1 showing, 2 done
let tipIdx = 0, tipT = 0;
let goRaf = 0;
let bnT1 = 0, bnT2 = 0, lvlT = 0;
let lastMode = null;
const lu = { on: false, done: true, choices: [], onPick: null, t0: 0, lastHov: -1 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function nf(n) { return Math.round(n || 0).toLocaleString('tr-TR'); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function mmss(t) {
  t = Math.max(0, Math.floor(t || 0));
  return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60);
}
function sfx(name, opts) {
  try { if (G.audio && G.audio.play) G.audio.play(name, opts); } catch (e) { /* cosmetic */ }
}
function unlockAudio() {
  try { if (G.audio && G.audio.unlock) G.audio.unlock(); } catch (e) { /* cosmetic */ }
}
function startGame() {
  try { if (G.startGame) G.startGame(); } catch (e) { console.error(e); }
}
function cached(key, val) {
  if (C[key] === val) return false;
  C[key] = val;
  return true;
}
function setT(key, el, v) { if (el && cached(key, v)) el.textContent = v; }
function setS(key, el, prop, v) { if (el && cached(key, v)) el.style[prop] = v; }
function restart(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
function readBest() {
  try { return Number(localStorage.getItem('karabayrak_best')) || 0; } catch (e) { return 0; }
}
function writeBest(v) {
  try { localStorage.setItem('karabayrak_best', String(v)); } catch (e) { /* ignore */ }
}
function gauge(id) {
  const r = root.querySelector('#' + id);
  return { root: r, fill: r.querySelector('.rl-fill'), st: r.querySelector('.rl-st') };
}
function controlsHtml() {
  return CONTROLS.map(c => '<span class="kb">' + c[0] + '</span><span class="cl">' + c[1] + '</span>').join('');
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------
const CSS = `
#ui{--gold:#c9a24b;--gold-hi:#f3d88a;--parch:#f1e3c2;--crim:#b3202a;--ink:rgba(8,18,28,.78);--mute:rgba(241,227,194,.62);
  --serif:'Palatino Linotype','Book Antiqua',Palatino,Georgia,serif;
  position:fixed;inset:0;z-index:10;pointer-events:none;font-family:var(--serif);font-size:clamp(12px,2vmin,26px);
  color:var(--parch);overflow:hidden;user-select:none;-webkit-user-select:none;text-shadow:0 1px 2px rgba(0,0,0,.7);}
#ui *{box-sizing:border-box}
#ui h1,#ui h2{margin:0;font-weight:700}
#ui button{font-family:inherit}
#ui .ly{position:absolute;inset:0;opacity:0;visibility:hidden;transition:opacity .6s ease,visibility .6s}
#ui .ly.on{opacity:1;visibility:visible}
#ui .pa{pointer-events:auto}
#ui .pnl{background:linear-gradient(180deg,rgba(14,28,40,.84),var(--ink));border:1px solid rgba(201,162,75,.5);
  box-shadow:inset 0 1px 0 rgba(255,236,190,.14),inset 0 0 0 1px rgba(0,0,0,.35),0 10px 28px rgba(0,0,0,.5);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-radius:4px}
#ui .sep{display:inline-block;width:1px;height:1em;background:rgba(201,162,75,.45);margin:0 .6em;vertical-align:middle}
#ui .kb{display:inline-block;min-width:2.1em;padding:.1em .45em;text-align:center;font-weight:700;font-size:.85em;white-space:nowrap;
  color:var(--gold-hi);background:linear-gradient(180deg,rgba(40,56,70,.9),rgba(12,20,28,.95));border:1px solid rgba(201,162,75,.55);
  border-bottom-width:2px;border-radius:4px;box-shadow:0 2px 0 rgba(0,0,0,.5)}
#ui .ctl-g{display:grid;grid-template-columns:auto 1fr;gap:.45em .8em;align-items:center}
#ui .ctl-g .cl{font-size:.9em;color:var(--parch)}
#ui .btn-main{position:relative;padding:.8em 2.4em;font-size:clamp(14px,2.6vmin,26px);font-weight:700;letter-spacing:.3em;color:var(--parch);
  background:linear-gradient(180deg,#c42a33 0%,#8e1a20 55%,#5e0f14 100%);border:1px solid var(--gold-hi);border-radius:3px;cursor:pointer;
  box-shadow:inset 0 1px 0 rgba(255,220,220,.35),inset 0 -2px 0 rgba(0,0,0,.35),0 8px 22px rgba(0,0,0,.55);
  transition:transform .25s ease,box-shadow .3s ease,filter .3s ease;overflow:hidden}
#ui .btn-main::after{content:'';position:absolute;top:0;bottom:0;left:-60%;width:40%;
  background:linear-gradient(100deg,transparent,rgba(255,240,200,.45),transparent);transform:skewX(-20deg);transition:left .7s ease}
#ui .btn-main:hover{transform:translateY(-4px) scale(1.03);filter:brightness(1.12);
  box-shadow:inset 0 1px 0 rgba(255,220,220,.35),0 0 34px rgba(179,32,42,.75),0 0 60px rgba(201,162,75,.25),0 10px 24px rgba(0,0,0,.6)}
#ui .btn-main:hover::after{left:130%}
#ui .btn-main:active{transform:translateY(0) scale(.99)}

/* ---------- menu ---------- */
#ui-menu{background:radial-gradient(ellipse 72% 62% at 50% 42%,rgba(3,8,14,0) 0%,rgba(3,8,14,.5) 62%,rgba(2,5,9,.9) 100%),
  linear-gradient(180deg,rgba(2,6,10,.55) 0%,rgba(2,6,10,0) 24%,rgba(2,6,10,0) 66%,rgba(2,6,10,.72) 100%)}
#ui-menu .mn-top{position:absolute;left:50%;top:8vh;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;text-align:center;width:min(92vw,70em)}
#ui-menu .ttl{font-size:clamp(40px,9.5vmin,128px);letter-spacing:.12em;line-height:1.05;padding:0 .08em;
  background:linear-gradient(95deg,#7a5a20 0%,#c9a24b 22%,#fff1c2 40%,#c9a24b 52%,#8a6428 70%,#f3d88a 88%,#7a5a20 100%);
  background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 3px 0 rgba(0,0,0,.55)) drop-shadow(0 0 28px rgba(201,162,75,.28));animation:kbShim 7s linear infinite}
#ui-menu .sub{margin-top:.45em;font-size:clamp(13px,2.6vmin,30px);letter-spacing:.42em;text-transform:uppercase;color:var(--gold-hi);
  display:flex;align-items:center;gap:.8em;justify-content:center}
#ui-menu .sub::before,#ui-menu .sub::after{content:'';width:3.2em;height:1px;background:linear-gradient(90deg,transparent,var(--gold-hi))}
#ui-menu .sub::after{transform:scaleX(-1)}
#ui-menu .emb{position:relative;width:clamp(64px,10vmin,110px);height:clamp(64px,10vmin,110px);margin-bottom:1.4vmin;border-radius:50%;
  border:1.5px solid var(--gold);background:radial-gradient(circle,rgba(20,36,50,.92),rgba(6,12,18,.96));
  box-shadow:0 0 0 4px rgba(8,18,28,.6),0 0 0 5px rgba(201,162,75,.35),0 8px 24px rgba(0,0,0,.6);display:grid;place-items:center;overflow:hidden}
#ui-menu .emb .sw{position:absolute;font-size:clamp(34px,6vmin,68px);color:var(--gold-hi);opacity:.32;line-height:1}
#ui-menu .emb .sw.l{transform:rotate(-45deg)}
#ui-menu .emb .sw.r{transform:rotate(45deg) scaleX(-1)}
#ui-menu .emb .sk{position:relative;font-size:clamp(26px,4.4vmin,50px);color:var(--parch);text-shadow:0 0 14px rgba(241,227,194,.4);line-height:1}
#ui-menu .btn-start{margin-top:4.2vmin;padding:.9em 2.8em;font-size:clamp(16px,3vmin,32px);font-weight:700;letter-spacing:.32em;color:var(--parch);
  background:linear-gradient(180deg,#c42a33 0%,#8e1a20 55%,#5e0f14 100%);border:1px solid var(--gold-hi);border-radius:3px;cursor:pointer;
  box-shadow:inset 0 1px 0 rgba(255,220,220,.35),inset 0 -2px 0 rgba(0,0,0,.35),0 8px 22px rgba(0,0,0,.55);
  transition:transform .25s ease,box-shadow .3s ease,filter .3s ease;position:relative;overflow:hidden}
#ui-menu .btn-start::after{content:'';position:absolute;top:0;bottom:0;left:-60%;width:40%;
  background:linear-gradient(100deg,transparent,rgba(255,240,200,.45),transparent);transform:skewX(-20deg);transition:left .7s ease}
#ui-menu .btn-start:hover{transform:translateY(-4px) scale(1.04);filter:brightness(1.12);
  box-shadow:inset 0 1px 0 rgba(255,220,220,.35),0 0 34px rgba(179,32,42,.75),0 0 64px rgba(201,162,75,.28),0 10px 24px rgba(0,0,0,.6)}
#ui-menu .btn-start:hover::after{left:130%}
#ui-menu .btn-start:active{transform:translateY(0) scale(.99)}
#ui-menu .mn-bl{position:absolute;left:3vw;bottom:4vh;width:clamp(230px,26vmin,340px);padding:1.1em 1.3em}
#ui-menu .mn-br{position:absolute;right:3vw;bottom:4vh;width:clamp(240px,28vmin,360px);text-align:right}
#ui .pnl-h{font-size:.78em;letter-spacing:.3em;color:var(--gold-hi);text-align:center;margin-bottom:.7em;font-weight:700}
#ui-menu .best{font-size:.95em;letter-spacing:.16em;color:var(--mute)}
#ui-menu .best b{color:var(--gold-hi);font-size:1.3em;margin-left:.3em;font-variant-numeric:tabular-nums}
#ui-menu .tip{margin-top:.8em;padding:.8em 0 0;font-style:italic;font-size:.98em;line-height:1.4;color:var(--parch);min-height:3.4em;border-top:1px solid rgba(201,162,75,.3)}
#ui-menu .tip.tin{animation:kbTipIn .6s ease both}
#ui-menu.go .fx{animation:kbFadeUp .9s cubic-bezier(.2,.7,.2,1) both;animation-delay:var(--d,0s)}

/* ---------- HUD ---------- */
#ui-hud{transition:opacity .6s ease,visibility .6s,filter .5s ease}
#ui-hud.dim{filter:brightness(.6) saturate(.75)}
#ui-ov{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.hud-bl{position:absolute;left:2.4vw;bottom:2.4vh;display:flex;flex-direction:column;gap:.7em;align-items:flex-start}
.hp-pnl{position:relative;width:clamp(230px,24vmin,360px);padding:.7em .9em .8em}
.hp-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.45em;letter-spacing:.2em;font-size:.85em}
.hp-row .lbl{color:var(--gold-hi);font-weight:700}
.hp-n{font-weight:700;font-variant-numeric:tabular-nums}
.hp-bar{position:relative;height:1.35em;background:rgba(0,0,0,.55);border:1px solid rgba(201,162,75,.55);border-radius:2px;box-shadow:inset 0 2px 4px rgba(0,0,0,.6)}
.hp-bar>div{position:absolute;left:0;top:0;bottom:0;border-radius:1px}
.hp-ghost{background:rgba(241,227,194,.72);width:100%}
.hp-fill{width:100%;background:linear-gradient(180deg,rgba(255,255,255,.38),rgba(255,255,255,0) 50%,rgba(0,0,0,.22)),var(--hc,#5fbf6a);
  transition:width .25s ease-out;box-shadow:0 0 12px var(--hc,#5fbf6a)}
.hp-fill.g{--hc:#5fbf6a}
.hp-fill.a{--hc:#e0a030}
.hp-fill.r{--hc:#d9352b}
.hp-seg{right:0;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(10% - 2px),rgba(8,14,20,.8) calc(10% - 2px),rgba(8,14,20,.8) 10%)}
.hp-pnl.shk{animation:kbShk .42s linear}
.hp-pops{position:absolute;right:.9em;top:-1.2em;pointer-events:none;height:1em}
.hp-pop{position:absolute;right:0;top:0;color:#8ff0a0;font-weight:700;font-size:1.1em;white-space:nowrap;text-shadow:0 0 10px rgba(90,220,120,.7);animation:kbPop 1s ease-out forwards}
.res{display:flex;align-items:center;gap:.4em;padding:.4em .9em;letter-spacing:.06em}
.res b{font-weight:700;font-variant-numeric:tabular-nums;color:var(--gold-hi);font-size:1.1em}

.hud-bc{position:absolute;left:50%;bottom:2.4vh;transform:translateX(-50%);width:clamp(320px,40vw,820px);display:flex;flex-direction:column;align-items:center;gap:1.1em}
.rl-row{display:flex;justify-content:space-between;align-items:center;width:100%;gap:1.1em}
.rl{flex:1;display:flex;flex-direction:column;gap:.3em}
.rl-lbl{display:flex;justify-content:space-between;font-size:.7em;letter-spacing:.26em;color:var(--gold-hi);font-weight:700}
.rl-st{font-size:.92em;letter-spacing:.2em;color:var(--mute);font-variant-numeric:tabular-nums}
.rl-bar{position:relative;height:.6em;background:rgba(0,0,0,.55);border:1px solid rgba(201,162,75,.45);border-radius:2px;overflow:hidden}
.rl-fill{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#4d5e6b,#c9d6df);transition:width .12s linear}
.rl.rdy .rl-fill{background:linear-gradient(90deg,#c9a24b,#f3d88a);box-shadow:0 0 10px #f3d88a}
.rl.rdy .rl-st{color:var(--gold-hi);font-weight:700;animation:kbGlow 1.2s ease-in-out infinite}
.dash{display:flex;flex-direction:column;align-items:center;gap:.25em;flex:0 0 auto}
.dash-ring{position:relative;width:2.7em;height:2.7em;border-radius:50%;background:conic-gradient(#f3d88a 0deg,rgba(10,20,30,.85) 0deg);box-shadow:0 0 0 1px rgba(201,162,75,.5)}
.dash-in{position:absolute;inset:.2em;border-radius:50%;background:rgba(8,16,24,.94);display:grid;place-items:center;font-size:.85em;font-weight:700;color:var(--parch);font-variant-numeric:tabular-nums}
.dash.rdy .dash-ring{box-shadow:0 0 14px rgba(243,216,138,.65),0 0 0 1px var(--gold-hi)}
.dash-l{font-size:.6em;letter-spacing:.2em;color:var(--mute)}
.xp-wrap{position:relative;width:100%;padding-left:1.35em;height:1.6em;display:flex;align-items:center}
.lvl-med{position:absolute;left:0;top:50%;transform:translateY(-50%);z-index:2;width:2.7em;height:2.7em;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#f7e2a0,#c9a24b 45%,#7a5820 100%);border:2px solid #f3d88a;
  box-shadow:0 0 0 2px rgba(8,18,28,.85),0 4px 14px rgba(0,0,0,.6);display:flex;flex-direction:column;align-items:center;justify-content:center;
  color:#2a1a06;text-shadow:0 1px 0 rgba(255,240,200,.6);line-height:1}
.lvl-sv{font-size:.5em;letter-spacing:.2em;font-weight:700}
.lvl-n{font-size:1.2em;font-weight:700;font-variant-numeric:tabular-nums}
.xp-bar{position:relative;flex:1;height:1.2em;background:rgba(0,0,0,.6);border:1px solid rgba(201,162,75,.6);border-radius:999px;overflow:hidden;box-shadow:inset 0 2px 5px rgba(0,0,0,.7)}
.xp-fill{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(180deg,#f7e2a0,#c9a24b 55%,#8a6428);transition:width .6s cubic-bezier(.3,.7,.2,1);box-shadow:0 0 12px rgba(243,216,138,.5)}
.xp-txt{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:.74em;letter-spacing:.12em;font-weight:700;text-shadow:0 1px 2px #000;font-variant-numeric:tabular-nums}
.xp-wrap.lvlup .xp-bar{animation:kbGlow .5s ease-in-out 3}
.xp-wrap.lvlup .lvl-med{animation:kbMedPop .8s ease-out}

.hud-tc{position:absolute;top:2.2vh;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:.6em}
.t-row{display:flex;align-items:center;padding:.35em 1.2em;font-size:.95em;letter-spacing:.14em;font-variant-numeric:tabular-nums;white-space:nowrap}
.t-row b,.t-row span.v{font-weight:700;color:var(--gold-hi)}
.boss{width:clamp(280px,36vw,640px);opacity:0;visibility:hidden;transform:translateY(-14px);transition:opacity .5s ease,transform .5s ease,visibility .5s}
.boss.on{opacity:1;visibility:visible;transform:none}
.boss-n{text-align:center;font-size:.9em;letter-spacing:.4em;color:#ffb3a8;text-shadow:0 0 10px rgba(179,32,42,.9),0 1px 2px #000;margin-bottom:.35em;font-weight:700}
.boss-bar{position:relative;height:1.1em;background:rgba(0,0,0,.6);border:1px solid rgba(201,162,75,.6);box-shadow:inset 0 2px 5px #000;border-radius:2px;overflow:hidden}
.boss-fill{position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(180deg,#e0453c,#b3202a 55%,#6e0d13);transition:width .35s ease-out;box-shadow:0 0 14px rgba(179,32,42,.8)}

.hud-tr{position:absolute;top:2.4vh;right:2.4vw}
#mm{display:block;width:clamp(130px,15vmin,210px);height:clamp(130px,15vmin,210px);border-radius:50%;
  box-shadow:0 0 0 1px rgba(201,162,75,.6),0 0 0 4px rgba(8,18,28,.6),0 10px 28px rgba(0,0,0,.55)}

.hud-br{position:absolute;right:2.4vw;bottom:2.4vh;display:flex;flex-direction:column;align-items:flex-end;gap:.9em;max-width:min(30vw,440px)}
.pas{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.45em;max-width:100%}
.pc{position:relative;width:2.5em;height:2.5em;display:grid;place-items:center;border-radius:6px;
  background:linear-gradient(180deg,rgba(20,34,46,.92),rgba(8,14,22,.94));border:1px solid rgba(201,162,75,.5);
  font-size:1.05em;box-shadow:inset 0 1px 0 rgba(255,235,190,.15),0 3px 8px rgba(0,0,0,.45);cursor:help;pointer-events:auto;
  transition:transform .2s ease,border-color .2s ease;margin-bottom:.5em}
.pc:hover{transform:translateY(-2px) scale(1.07);border-color:var(--gold-hi)}
.pc-i{line-height:1}
.pc-p{position:absolute;bottom:-.7em;left:50%;transform:translateX(-50%);font-size:.5em;white-space:nowrap;line-height:1}
.pc-p i{display:inline-block;width:.62em;height:.62em;border-radius:50%;border:1px solid rgba(201,162,75,.7);margin:0 .06em;background:rgba(0,0,0,.4)}
.pc-p i.f{background:var(--gold-hi);border-color:var(--gold-hi)}
.acts{display:flex;gap:.6em}
.act{position:relative;width:clamp(50px,6.2vmin,84px);height:clamp(50px,6.2vmin,84px);border-radius:8px;
  background:linear-gradient(160deg,rgba(30,48,62,.96),rgba(8,14,22,.96));border:1.5px solid var(--gold);
  box-shadow:inset 0 1px 0 rgba(255,236,190,.25),0 6px 16px rgba(0,0,0,.55);display:grid;place-items:center;overflow:hidden;transition:transform .25s ease}
.act-ic{font-size:clamp(20px,3.2vmin,40px);line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.6));position:relative;z-index:1}
.act-cd{position:absolute;inset:0;pointer-events:none;z-index:2}
.act-t{position:absolute;left:0;right:0;bottom:.14em;text-align:center;font-size:.62em;font-weight:700;z-index:3;text-shadow:0 1px 3px #000;font-variant-numeric:tabular-nums}
.act-k{position:absolute;top:.2em;left:.22em;font-size:.56em;letter-spacing:.06em;padding:0 .3em;border-radius:3px;background:rgba(0,0,0,.65);
  color:var(--gold-hi);border:1px solid rgba(201,162,75,.5);z-index:3}
.act.rdy{animation:kbRdy 1.4s ease-in-out infinite;border-color:var(--gold-hi)}

.toasts{position:absolute;left:2.4vw;top:2.4vh;display:flex;flex-direction:column;align-items:flex-start;gap:.5em;width:clamp(220px,24vw,360px)}
.toast{padding:.55em .9em .55em 1em;font-size:.95em;background:linear-gradient(90deg,rgba(14,28,40,.92),rgba(8,18,28,.8));
  border:1px solid rgba(201,162,75,.4);border-left:3px solid var(--tc,#c9a24b);border-radius:3px;box-shadow:0 6px 18px rgba(0,0,0,.45);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transform:translateX(-24px);
  transition:opacity .35s ease,transform .35s cubic-bezier(.2,.8,.2,1);max-width:100%}
.toast.in{opacity:1;transform:none}
.toast.out{opacity:0;transform:translateX(-14px);transition:opacity .4s ease,transform .4s ease}

.bn{position:absolute;left:50%;top:13vh;transform:translateX(-50%);text-align:center;opacity:0;transition:opacity .6s ease;pointer-events:none;width:min(90vw,70em)}
.bn.on{opacity:1}
.bn-in{position:relative;padding:.4em 1.6em}
.bn-in::before,.bn-in::after{content:'';position:absolute;left:8%;right:8%;height:1px;background:linear-gradient(90deg,transparent,var(--gold-hi),transparent)}
.bn-in::before{top:0}
.bn-in::after{bottom:0}
.bn-t{font-size:clamp(28px,6vmin,76px);font-weight:700;letter-spacing:.22em;text-transform:uppercase;
  background:linear-gradient(180deg,#fff1c2,#c9a24b 60%,#8a6428);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 3px 2px rgba(0,0,0,.7))}
.bn-s{margin-top:.2em;font-style:italic;font-size:clamp(14px,2.6vmin,26px);color:var(--parch);letter-spacing:.08em}
.bn.on .bn-in{animation:kbBnSweep .8s cubic-bezier(.2,.8,.2,1) both}

.tut{position:absolute;left:50%;top:24vh;transform:translateX(-50%);padding:.6em 1.6em;font-size:clamp(13px,2.2vmin,20px);letter-spacing:.06em;
  white-space:nowrap;opacity:0;transition:opacity 1s ease;background:linear-gradient(90deg,transparent,rgba(8,18,28,.72) 18%,rgba(8,18,28,.72) 82%,transparent);color:var(--gold-hi)}
.tut.on{opacity:1}

.fxl{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .6s ease}
#ui-lowhp{background:radial-gradient(ellipse at center,transparent 52%,rgba(150,12,20,.72) 100%)}
#ui-lowhp.on{opacity:1;animation:kbLow 1.3s ease-in-out infinite}
#ui-flash{background:radial-gradient(ellipse at center,rgba(179,32,42,0) 40%,rgba(179,32,42,.78) 100%)}
#ui-flash.hit{opacity:1;animation:kbHit .5s ease-out both}

/* ---------- level-up ---------- */
#ui-lu .lu-bk{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(4,10,16,.55),rgba(2,5,9,.94));
  backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}
#ui-lu .lu-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(12px,2.6vmin,30px);padding:4vmin}
.lu-h{text-align:center}
.lu-t{font-size:clamp(26px,5.6vmin,64px);font-weight:700;letter-spacing:.2em;background:linear-gradient(180deg,#fff1c2,#c9a24b 60%,#8a6428);
  -webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 3px 2px rgba(0,0,0,.7))}
.lu-sv{font-size:clamp(14px,2.4vmin,24px);letter-spacing:.3em;color:var(--gold-hi);text-transform:uppercase;margin-top:.2em;font-weight:700}
.lu-sub{font-style:italic;color:var(--mute);font-size:.95em;margin-top:.25em}
.lu-cards{display:flex;gap:clamp(12px,2.4vmin,30px);justify-content:center;flex-wrap:wrap;perspective:1200px}
.lc{position:relative;width:clamp(180px,25vmin,290px);border-radius:12px;padding:2px;cursor:pointer;pointer-events:auto;
  background:linear-gradient(160deg,var(--rc),rgba(20,20,20,.45) 55%,var(--rc));box-shadow:0 12px 30px rgba(0,0,0,.55);
  transition:transform .35s cubic-bezier(.2,.8,.2,1),box-shadow .35s ease,opacity .35s ease}
.lc:hover{transform:translateY(-12px) scale(1.03);box-shadow:0 0 34px rgba(var(--rgb),.6),0 18px 36px rgba(0,0,0,.6)}
.lc.r-legendary{background:linear-gradient(120deg,#8a5a12,#ffe39a,#ffb02e,#fff6d6,#b87418,#ffe39a,#8a5a12);background-size:300% 300%;animation:kbShine 3.2s linear infinite}
.lc.r-legendary:hover{box-shadow:0 0 40px rgba(255,176,46,.7),0 18px 36px rgba(0,0,0,.6)}
.lc-in{position:relative;min-height:clamp(290px,48vmin,440px);height:100%;border-radius:10px;padding:1.1em .95em 1em;
  background:radial-gradient(120% 60% at 50% 0%,rgba(var(--rgb),.24),transparent 62%),linear-gradient(180deg,rgba(14,26,38,.97),rgba(6,12,20,.98));
  display:flex;flex-direction:column;align-items:center;text-align:center;gap:.36em;
  animation:kbDeal .7s cubic-bezier(.2,.8,.2,1) both;animation-delay:var(--d,0s)}
.lc.sel .lc-in{animation:kbSel .45s ease-out both}
.lc.sel::after{content:'';position:absolute;inset:0;border-radius:12px;background:#fff;opacity:0;pointer-events:none;animation:kbFlash .45s ease-out}
.lu.picked .lc:not(.sel){opacity:0;transform:translateY(26px) scale(.9);pointer-events:none}
.lc-top{width:100%;display:flex;justify-content:space-between;align-items:center;font-size:.7em;letter-spacing:.14em}
.lc-bdg{padding:.2em .65em;border-radius:99px;border:1px solid rgba(var(--rgb),.75);color:var(--rc);font-weight:700}
.lc-bdg.new{background:rgba(var(--rgb),.22)}
.lc-key{width:1.9em;height:1.9em;display:grid;place-items:center;border-radius:4px;background:rgba(0,0,0,.45);border:1px solid rgba(201,162,75,.5);color:var(--gold-hi);font-weight:700;font-size:1.1em}
.lc-med{width:clamp(56px,8.5vmin,92px);height:clamp(56px,8.5vmin,92px);border-radius:50%;display:grid;place-items:center;
  font-size:clamp(26px,4.4vmin,48px);line-height:1;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.2),rgba(0,0,0,.45) 70%);
  border:2px solid var(--rc);box-shadow:0 0 18px rgba(var(--rgb),.5),inset 0 0 12px rgba(0,0,0,.6);margin:.25em 0}
.lc-name{font-size:1.2em;font-weight:700;letter-spacing:.08em;font-variant:small-caps;color:var(--parch);line-height:1.15}
.lc-rar{font-size:.72em;letter-spacing:.25em;text-transform:uppercase;color:var(--rc);font-weight:700}
.lc-pips{display:flex;gap:.35em;font-size:.95em;align-items:center;justify-content:center}
.lc-pips i{display:inline-block;width:.62em;height:.62em;border-radius:50%;border:1px solid rgba(201,162,75,.6);background:rgba(0,0,0,.35)}
.lc-pips i.f{background:var(--rc);border-color:var(--rc)}
.lc-pips i.nw{background:var(--gold-hi);border-color:#fff;box-shadow:0 0 8px var(--gold-hi);animation:kbGlow 1.2s ease-in-out infinite}
.lc-act{font-size:.7em;letter-spacing:.12em;color:#ffe9b0;background:rgba(201,162,75,.14);border:1px dashed rgba(201,162,75,.6);padding:.25em .6em;border-radius:3px}
.lc-desc{font-size:.86em;line-height:1.36;color:var(--parch);margin-top:.2em;flex:1}
.lc-tag{font-size:.75em;font-style:italic;color:var(--mute);padding-top:.55em;border-top:1px solid rgba(201,162,75,.25);width:100%}
.lu-foot{display:flex;flex-direction:column;align-items:center;gap:.5em}
.lu-re{pointer-events:auto;padding:.5em 1.4em;font-size:.95em;letter-spacing:.15em;color:var(--parch);
  background:linear-gradient(180deg,rgba(24,40,54,.95),rgba(8,14,22,.95));border:1px solid rgba(201,162,75,.6);border-radius:3px;cursor:pointer;transition:all .25s ease}
.lu-re:hover:not(:disabled){border-color:var(--gold-hi);box-shadow:0 0 16px rgba(201,162,75,.4);transform:translateY(-2px)}
.lu-re:disabled{opacity:.4;cursor:not-allowed;filter:grayscale(.6)}
.lu-hint{font-size:.72em;letter-spacing:.2em;color:var(--mute)}

/* ---------- pause ---------- */
#ui-pause .pz-bk{position:absolute;inset:0;background:rgba(2,6,10,.5);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
#ui-pause .pz{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(88vw,clamp(520px,62vmin,860px));padding:clamp(18px,3vmin,34px);text-align:center}
.pz-h{font-size:clamp(24px,4.6vmin,52px);font-weight:700;letter-spacing:.22em;background:linear-gradient(180deg,#fff1c2,#c9a24b 60%,#8a6428);
  -webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 2px 2px rgba(0,0,0,.7))}
.pz-cols{display:grid;grid-template-columns:1fr 1fr;gap:clamp(16px,3vmin,32px);text-align:left;margin-top:1.1em}
.pz-sub{font-size:.75em;letter-spacing:.3em;color:var(--gold-hi);margin-bottom:.7em;font-weight:700}
.pz-p{display:flex;gap:.7em;align-items:flex-start;margin-bottom:.7em}
.pz-i{font-size:1.4em;line-height:1.1}
.pz-p b{font-size:.95em}
.pz-p em{font-style:normal;color:var(--gold-hi);font-size:.8em;margin-left:.3em}
.pz-p p{margin:.15em 0 0;font-size:.8em;color:var(--mute);line-height:1.35}
.pz-none{color:var(--mute);font-style:italic}
.pz-hint{margin-top:1.3em;font-style:italic;color:var(--mute);letter-spacing:.1em}

/* ---------- game over ---------- */
#ui-go .go-bk{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(60,6,12,.4),rgba(0,0,0,.92))}
#ui-go .go-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(10px,2vmin,22px);padding:4vmin;text-align:center}
.go-skull{font-size:clamp(40px,8vmin,90px);line-height:1;color:var(--crim);text-shadow:0 0 24px rgba(179,32,42,.85);animation:kbSkull 2.4s ease-in-out infinite}
.go-t{font-size:clamp(34px,8vmin,96px);font-weight:700;letter-spacing:.18em;color:#f3d8c8;text-shadow:0 0 30px rgba(179,32,42,.8),0 4px 0 #3a0a0e}
#ui-go.on .go-t{animation:kbGoT 1.1s cubic-bezier(.2,.8,.2,1) both}
.go-grid{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:clamp(8px,1.6vmin,16px);width:min(90vw,clamp(520px,66vmin,920px))}
.go-st{padding:.7em .6em;background:linear-gradient(180deg,rgba(14,28,40,.88),rgba(8,18,28,.82));border:1px solid rgba(201,162,75,.38);border-radius:4px;box-shadow:inset 0 1px 0 rgba(255,236,190,.1)}
#ui-go.go .go-st{animation:kbFadeUp .6s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--i,0) * .12s + .5s)}
.go-st .k{font-size:.66em;letter-spacing:.2em;text-transform:uppercase;color:var(--mute)}
.go-st .v{font-size:clamp(18px,3.2vmin,34px);font-weight:700;color:var(--gold-hi);font-variant-numeric:tabular-nums;margin-top:.15em}
.go-rec{font-size:clamp(16px,3vmin,30px);letter-spacing:.2em;color:var(--gold-hi);opacity:0;transform:scale(.6);transition:opacity .5s ease,transform .6s cubic-bezier(.2,1.4,.4,1)}
.go-rec.show{opacity:1;transform:none;animation:kbGlow 1.6s ease-in-out infinite}
.go-perks{display:flex;flex-wrap:wrap;justify-content:center;gap:.45em;min-height:2.2em;font-size:1.5em;line-height:1.2}
.go-perks span{filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))}

/* ---------- keyframes ---------- */
@keyframes kbShim{from{background-position:0% 50%}to{background-position:250% 50%}}
@keyframes kbFadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@keyframes kbTipIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes kbGlow{0%,100%{filter:brightness(1)}50%{filter:brightness(1.4)}}
@keyframes kbPop{0%{opacity:0;transform:translateY(6px) scale(.8)}15%{opacity:1;transform:none}100%{opacity:0;transform:translateY(-24px)}}
@keyframes kbShk{0%,100%{transform:translate(0,0)}20%{transform:translate(-3px,1px)}40%{transform:translate(3px,-1px)}60%{transform:translate(-2px,0)}80%{transform:translate(2px,1px)}}
@keyframes kbHit{from{opacity:1}to{opacity:0}}
@keyframes kbLow{0%,100%{filter:brightness(.8)}50%{filter:brightness(1.25)}}
@keyframes kbRdy{0%,100%{box-shadow:0 0 0 rgba(243,216,138,0),inset 0 1px 0 rgba(255,236,190,.25)}50%{box-shadow:0 0 22px rgba(243,216,138,.75),inset 0 1px 0 rgba(255,236,190,.25)}}
@keyframes kbMedPop{0%{transform:translateY(-50%) scale(1)}40%{transform:translateY(-50%) scale(1.35)}100%{transform:translateY(-50%) scale(1)}}
@keyframes kbBnSweep{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes kbShine{0%{background-position:0% 50%}100%{background-position:300% 50%}}
@keyframes kbDeal{from{opacity:0;transform:translateY(60px) rotateY(-80deg) scale(.85)}to{opacity:1;transform:none}}
@keyframes kbSel{0%{transform:none}40%{transform:scale(1.08)}100%{transform:scale(1.04);filter:brightness(1.3)}}
@keyframes kbFlash{0%{opacity:0}30%{opacity:.7}100%{opacity:0}}
@keyframes kbGoT{from{opacity:0;letter-spacing:.5em;filter:blur(8px)}to{opacity:1;letter-spacing:.18em;filter:none}}
@keyframes kbSkull{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}

@media (max-width:980px){
  #ui-menu .mn-bl{display:none}
  .hud-bc{width:58vw}
  .pas{max-width:200px}
}
`;

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------
function buildHTML() {
  return `
<canvas id="ui-ov"></canvas>

<div id="ui-menu" class="ly">
  <div class="mn-top">
    <div class="fx" style="--d:0s"><div class="emb"><span class="sw l">⚔</span><span class="sw r">⚔</span><span class="sk">☠</span></div></div>
    <div class="fx" style="--d:.15s"><h1 class="ttl">KARA BAYRAK</h1></div>
    <div class="fx sub" style="--d:.3s">Korsan Denizleri</div>
    <div class="fx" style="--d:.45s"><button id="btn-start" class="btn-start pa">YELKEN AÇ</button></div>
  </div>
  <div class="mn-bl pnl fx" style="--d:.6s">
    <div class="pnl-h">KONTROLLER</div>
    <div class="ctl-g">${controlsHtml()}</div>
  </div>
  <div class="mn-br fx" style="--d:.75s">
    <div class="best">EN İYİ SKOR <b id="best-v">0</b></div>
    <div class="tip" id="tip"></div>
  </div>
</div>

<div id="ui-hud" class="ly">
  <div class="hud-bl">
    <div class="hp-pnl pnl" id="hp-pnl">
      <div class="hp-row"><span class="lbl">GÖVDE</span><span class="hp-n" id="hp-n">100 / 100</span></div>
      <div class="hp-bar"><div id="hp-ghost" class="hp-ghost"></div><div id="hp-fill" class="hp-fill g"></div><div class="hp-seg"></div></div>
      <div id="hp-pops" class="hp-pops"></div>
    </div>
    <div class="res pnl"><span>🪙 <b id="r-gold">0</b></span><span class="sep"></span><span>☠ <b id="r-kills">0</b></span></div>
  </div>

  <div class="hud-bc">
    <div class="rl-row">
      <div class="rl" id="rl-left"><div class="rl-lbl"><span>İSKELE</span><span class="rl-st">HAZIR</span></div><div class="rl-bar"><div class="rl-fill"></div></div></div>
      <div class="dash" id="dash"><div class="dash-ring" id="dash-ring"><div class="dash-in" id="dash-t">✦</div></div><div class="dash-l">HAMLE · SHIFT</div></div>
      <div class="rl" id="rl-right"><div class="rl-lbl"><span>SANCAK</span><span class="rl-st">HAZIR</span></div><div class="rl-bar"><div class="rl-fill"></div></div></div>
    </div>
    <div class="xp-wrap" id="xp-wrap">
      <div class="lvl-med" id="lvl-med"><span class="lvl-sv">SV</span><span class="lvl-n" id="lvl-n">1</span></div>
      <div class="xp-bar"><div class="xp-fill" id="xp-fill"></div><div class="xp-txt" id="xp-txt">0 / 0</div></div>
    </div>
  </div>

  <div class="hud-tc">
    <div class="t-row pnl"><span id="t-time">00:00</span><span class="sep"></span><span id="t-wave">DALGA 0</span><span class="sep"></span><span id="t-score">0</span></div>
    <div id="boss" class="boss"><div class="boss-n">KARA AMİRAL</div><div class="boss-bar"><div id="boss-fill" class="boss-fill"></div></div></div>
  </div>

  <div class="hud-tr"><canvas id="mm"></canvas></div>

  <div class="hud-br">
    <div class="pas" id="pas"></div>
    <div class="acts" id="acts"></div>
  </div>

  <div id="ui-tut" class="tut">W ile yelken aç · A/D ile dön · Düşmanı bordana al ve sol tıkla!</div>
</div>

<div id="ui-lowhp" class="fxl"></div>
<div id="ui-flash" class="fxl"></div>

<div id="ui-pause" class="ly">
  <div class="pz-bk"></div>
  <div class="pz pnl">
    <div class="pz-h">DURAKLATILDI</div>
    <div class="pz-cols">
      <div><div class="pz-sub">KONTROLLER</div><div class="ctl-g">${controlsHtml()}</div></div>
      <div><div class="pz-sub">NİMETLERİN</div><div id="pz-list"></div></div>
    </div>
    <div class="pz-hint">Devam etmek için Esc</div>
  </div>
</div>

<div id="ui-go" class="ly">
  <div class="go-bk"></div>
  <div class="go-c">
    <div class="go-skull">☠</div>
    <h2 class="go-t">GEMİN BATTI</h2>
    <div class="go-grid">
      <div class="go-st" style="--i:0"><div class="k">Süre</div><div class="v" id="go-v-time">00:00</div></div>
      <div class="go-st" style="--i:1"><div class="k">Seviye</div><div class="v" id="go-v-level">1</div></div>
      <div class="go-st" style="--i:2"><div class="k">Batırılan Gemi</div><div class="v" id="go-v-kills">0</div></div>
      <div class="go-st" style="--i:3"><div class="k">Boss</div><div class="v" id="go-v-boss">0</div></div>
      <div class="go-st" style="--i:4"><div class="k">Verilen Hasar</div><div class="v" id="go-v-dmg">0</div></div>
      <div class="go-st" style="--i:5"><div class="k">Altın</div><div class="v" id="go-v-gold">0</div></div>
      <div class="go-st" style="--i:6"><div class="k">Skor</div><div class="v" id="go-v-score">0</div></div>
      <div class="go-st" style="--i:7"><div class="k">En İyi Skor</div><div class="v" id="go-v-best">0</div></div>
    </div>
    <div id="go-rec" class="go-rec">✦ YENİ REKOR! ✦</div>
    <div id="go-perks" class="go-perks"></div>
    <button id="btn-retry" class="btn-main pa">TEKRAR DENE</button>
  </div>
</div>

<div id="ui-lu" class="ly lu">
  <div class="lu-bk"></div>
  <div class="lu-c">
    <div class="lu-h">
      <h2 class="lu-t">SEVİYE ATLADIN!</h2>
      <div id="lu-lvl" class="lu-sv">Seviye 1</div>
      <div class="lu-sub">Bir nimet seç, kaptan</div>
    </div>
    <div id="lu-cards" class="lu-cards"></div>
    <div class="lu-foot">
      <button id="lu-re" class="lu-re pa">🎲 Yeniden Çek (0)</button>
      <div class="lu-hint">1 · 2 · 3 ile seç</div>
    </div>
  </div>
</div>

<div id="ui-toasts" class="toasts"></div>
<div id="ui-banner" class="bn"><div class="bn-in"><div id="bn-t" class="bn-t"></div><div id="bn-s" class="bn-s"></div></div></div>
`;
}

// ---------------------------------------------------------------------------
// Init / reset / mode
// ---------------------------------------------------------------------------
function init() {
  if (root) return;
  const st = document.createElement('style');
  st.id = 'ui-style';
  st.textContent = CSS;
  document.head.appendChild(st);

  root = document.createElement('div');
  root.id = 'ui';
  root.innerHTML = buildHTML();
  document.body.appendChild(root);

  const $ = id => root.querySelector('#' + id);
  E.ov = $('ui-ov');
  E.menu = $('ui-menu');
  E.hud = $('ui-hud');
  E.pause = $('ui-pause');
  E.pzList = $('pz-list');
  E.go = $('ui-go');
  E.goRec = $('go-rec');
  E.goPerks = $('go-perks');
  E.goV = {
    time: $('go-v-time'), level: $('go-v-level'), kills: $('go-v-kills'), boss: $('go-v-boss'),
    dmg: $('go-v-dmg'), gold: $('go-v-gold'), score: $('go-v-score'), best: $('go-v-best')
  };
  E.lu = $('ui-lu');
  E.luCards = $('lu-cards');
  E.luLvl = $('lu-lvl');
  E.luRe = $('lu-re');
  E.toasts = $('ui-toasts');
  E.bn = $('ui-banner');
  E.bnT = $('bn-t');
  E.bnS = $('bn-s');
  E.tut = $('ui-tut');
  E.lowhp = $('ui-lowhp');
  E.flash = $('ui-flash');
  E.hpP = $('hp-pnl');
  E.hpF = $('hp-fill');
  E.hpG = $('hp-ghost');
  E.hpN = $('hp-n');
  E.hpPops = $('hp-pops');
  E.gold = $('r-gold');
  E.kills = $('r-kills');
  E.gL = gauge('rl-left');
  E.gR = gauge('rl-right');
  E.dWrap = $('dash');
  E.dRing = $('dash-ring');
  E.dT = $('dash-t');
  E.xpW = $('xp-wrap');
  E.xpF = $('xp-fill');
  E.xpT = $('xp-txt');
  E.lvlN = $('lvl-n');
  E.tTime = $('t-time');
  E.tWave = $('t-wave');
  E.tScore = $('t-score');
  E.boss = $('boss');
  E.bossF = $('boss-fill');
  E.mm = $('mm');
  E.pas = $('pas');
  E.acts = $('acts');
  E.actTiles = [];
  E.tip = $('tip');
  E.bestV = $('best-v');
  E.btnStart = $('btn-start');
  E.btnRetry = $('btn-retry');

  E.tip.textContent = TIPS[0];

  // Buttons
  E.btnStart.addEventListener('mouseenter', () => sfx('hover'));
  E.btnStart.addEventListener('click', () => { unlockAudio(); sfx('click'); startGame(); });
  E.btnRetry.addEventListener('mouseenter', () => sfx('hover'));
  E.btnRetry.addEventListener('click', () => { unlockAudio(); sfx('click'); startGame(); });
  E.luRe.addEventListener('click', onReroll);

  // Level-up cards: delegated click and hover
  E.luCards.addEventListener('click', e => {
    const el = e.target.closest ? e.target.closest('.lc') : null;
    if (el) pick(+el.dataset.i);
  });
  E.luCards.addEventListener('mouseover', e => {
    const el = e.target.closest ? e.target.closest('.lc') : null;
    if (!el) return;
    const i = +el.dataset.i;
    if (i === lu.lastHov) return;
    lu.lastHov = i;
    if (lu.on && !lu.done) sfx('hover');
  });
  window.addEventListener('keydown', e => {
    if (!lu.on || lu.done) return;
    const i = ['1', '2', '3'].indexOf(e.key);
    if (i >= 0) pick(i);
  });

  // One-shot animation cleanups
  E.hpP.addEventListener('animationend', () => E.hpP.classList.remove('shk'));
  E.flash.addEventListener('animationend', () => E.flash.classList.remove('hit'));

  window.addEventListener('resize', sizeCanvases);
  sizeCanvases();
  document.body.style.cursor = 'default';
  applyMode(G.state.mode || 'menu');
}

function reset() {
  if (!root) return;
  C = {};
  ghostPct = 100; ghostHold = 0; lastHp = null;
  tipT = 0;
  lu.on = false; lu.done = true; lu.onPick = null; lu.choices = []; lu.lastHov = -1;
  E.lu.classList.remove('on', 'picked');
  E.luCards.innerHTML = '';
  E.go.classList.remove('on', 'go');
  if (goRaf) { cancelAnimationFrame(goRaf); goRaf = 0; }
  E.toasts.innerHTML = '';
  clearTimeout(bnT1); clearTimeout(bnT2);
  E.bn.classList.remove('on');
  clearTimeout(lvlT);
  E.xpW.classList.remove('lvlup');
  tutState = 0;
  E.tut.classList.remove('on');
  E.lowhp.classList.remove('on');
  E.flash.classList.remove('hit');
  E.boss.classList.remove('on');
  E.hpPops.innerHTML = '';
  E.acts.innerHTML = '';
  E.actTiles = [];
  E.pas.innerHTML = '';
  E.hpF.classList.remove('g', 'a', 'r');
}

function applyMode(mode) {
  if (!root) return;
  const isMenu = mode === 'menu';
  const isPlay = mode === 'playing';
  const isGo = mode === 'gameover';
  E.menu.classList.toggle('on', isMenu);
  E.hud.classList.toggle('on', mode === 'playing' || mode === 'levelup' || mode === 'paused' || isGo);
  E.hud.classList.toggle('dim', !isPlay);
  E.pause.classList.toggle('on', mode === 'paused');
  if (mode === 'paused') buildPause();
  if (isMenu) {
    E.bestV.textContent = nf(readBest());
    restart(E.menu, 'go');
    E.menu.classList.add('go');
    E.go.classList.remove('on', 'go');
    E.lu.classList.remove('on', 'picked');
    lu.on = false;
  }
  if (isPlay) E.go.classList.remove('on', 'go');
  if (isMenu || isGo) {
    E.tut.classList.remove('on');
    if (tutState === 1) tutState = 2;
  }
  document.body.style.cursor = isPlay ? 'crosshair' : 'default';
  lastMode = mode;
}

function showMenu() {
  if (!root) return;
  applyMode('menu');
}

function buildPause() {
  const owned = (G.perks && G.perks.owned) || {};
  const defs = (G.perks && G.perks.DEFS) || {};
  const ids = Object.keys(owned).filter(id => owned[id] > 0);
  if (!ids.length) {
    E.pzList.innerHTML = '<p class="pz-none">Henüz nimet yok.</p>';
    return;
  }
  E.pzList.innerHTML = ids.map(id => {
    const d = defs[id] || { name: id, icon: '✦', desc: [] };
    const lv = owned[id];
    const txt = (d.desc && d.desc[lv - 1]) || '';
    return '<div class="pz-p"><span class="pz-i">' + esc(d.icon || '✦') + '</span><div><b>' + esc(d.name || id) +
      '</b><em>Seviye ' + lv + '</em><p>' + esc(txt) + '</p></div></div>';
  }).join('');
}

// ---------------------------------------------------------------------------
// Canvas sizing
// ---------------------------------------------------------------------------
function sizeCanvases() {
  if (!root) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  E.ov.width = Math.round(W * dpr);
  E.ov.height = Math.round(H * dpr);
  E.ovX = E.ov.getContext('2d');
  const S = Math.round(E.mm.clientWidth || 170);
  E.mmS = S;
  E.mm.width = Math.round(S * dpr);
  E.mm.height = Math.round(S * dpr);
  E.mmX = E.mm.getContext('2d');
}

// ---------------------------------------------------------------------------
// HUD update
// ---------------------------------------------------------------------------
function updHp(dt, p) {
  const maxHp = Math.max(1, p.stats.maxHp || 1);
  const hp = G.util.clamp(p.hp || 0, 0, maxHp);
  const pct = hp / maxHp * 100;
  if (lastHp !== null && hp < lastHp - 0.01) ghostHold = 0.7;
  lastHp = hp;
  if (ghostPct < pct) ghostPct = pct;
  if (ghostHold > 0) ghostHold -= dt;
  else if (ghostPct > pct) {
    ghostPct = pct + (ghostPct - pct) * Math.exp(-4 * dt);
    if (ghostPct - pct < 0.2) ghostPct = pct;
  }
  setS('hpf', E.hpF, 'width', pct.toFixed(2) + '%');
  setS('hpg', E.hpG, 'width', ghostPct.toFixed(2) + '%');
  const lvl = pct > 60 ? 'g' : pct > 30 ? 'a' : 'r';
  if (cached('hpl', lvl)) {
    E.hpF.classList.remove('g', 'a', 'r');
    E.hpF.classList.add(lvl);
  }
  setT('hpn', E.hpN, Math.ceil(hp) + ' / ' + Math.round(maxHp));
}

function updGauges(p) {
  const rt = Math.max(0.05, p.stats.reloadTime || 2.4);
  const sides = [['left', E.gL], ['right', E.gR]];
  for (let i = 0; i < sides.length; i++) {
    const side = sides[i][0], g = sides[i][1];
    const r = Math.max(0, (p.reload && p.reload[side]) || 0);
    const ready = r <= 0.02;
    const pct = ready ? 100 : (1 - Math.min(1, r / rt)) * 100;
    setS('gf' + side, g.fill, 'width', pct.toFixed(1) + '%');
    setT('gs' + side, g.st, ready ? 'HAZIR' : r.toFixed(1) + ' sn');
    if (cached('gr' + side, ready)) g.root.classList.toggle('rdy', ready);
  }
  const dmax = Math.max(0.05, p.dashCdMax || 5);
  const dcd = Math.max(0, p.dashCd || 0);
  const dReady = dcd <= 0.02;
  const frac = dReady ? 1 : 1 - Math.min(1, dcd / dmax);
  const deg = Math.round(frac * 360);
  setS('dsh', E.dRing, 'background',
    'conic-gradient(#f3d88a ' + deg + 'deg,rgba(10,20,30,.85) ' + deg + 'deg)');
  setT('dt', E.dT, dReady ? '✦' : String(Math.ceil(dcd)));
  if (cached('drd', dReady)) E.dWrap.classList.toggle('rdy', dReady);
}

function updXp() {
  const S = G.state;
  const xp = S.xp || 0;
  const nx = Math.max(1, S.xpNext || 1);
  setS('xpf', E.xpF, 'width', (G.util.clamp(xp / nx, 0, 1) * 100).toFixed(2) + '%');
  setT('xpt', E.xpT, nf(xp) + ' / ' + nf(nx));
  setT('lvl', E.lvlN, String(S.level || 1));
}

function levelFx() {
  if (!root) return;
  restart(E.xpW, 'lvlup');
  clearTimeout(lvlT);
  lvlT = setTimeout(() => E.xpW.classList.remove('lvlup'), 1800);
}

function updActives() {
  const list = (G.perks && G.perks.actives) || [];
  const sig = list.map(a => a.id).join('|');
  if (cached('actSig', sig)) {
    E.acts.innerHTML = list.map((a, i) =>
      '<div class="act" data-i="' + i + '"><div class="act-ic">' + esc((a.def && a.def.icon) || '✦') +
      '</div><div class="act-cd"></div><div class="act-t"></div><div class="act-k">' + esc(a.key || '') + '</div></div>'
    ).join('');
    E.actTiles = Array.prototype.map.call(E.acts.children, el => ({
      root: el, cd: el.querySelector('.act-cd'), t: el.querySelector('.act-t')
    }));
  }
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const tl = E.actTiles[i];
    if (!tl) continue;
    const cdMax = Math.max(0.05, a.cdMax || 1);
    const cd = Math.max(0, a.cd || 0);
    const ready = cd <= 0.02;
    const deg = ready ? 0 : Math.round(cd / cdMax * 360);
    setS('acd' + i, tl.cd, 'background', deg > 0
      ? 'conic-gradient(rgba(3,8,14,.74) ' + deg + 'deg,transparent ' + deg + 'deg)' : 'none');
    setT('att' + i, tl.t, ready ? '' : String(Math.ceil(cd)) + 's');
    if (cached('arr' + i, ready)) tl.root.classList.toggle('rdy', ready);
  }
}

function updPassives() {
  const owned = (G.perks && G.perks.owned) || {};
  const defs = (G.perks && G.perks.DEFS) || {};
  const ids = Object.keys(owned).filter(id => owned[id] > 0 && !(defs[id] && defs[id].active));
  const sig = ids.map(id => id + ':' + owned[id]).join('|');
  if (!cached('pasSig', sig)) return;
  E.pas.innerHTML = ids.map(id => {
    const d = defs[id] || { name: id, icon: '✦', desc: [] };
    const lv = owned[id];
    const mx = d.maxLevel || 3;
    let pips = '';
    for (let k = 0; k < mx; k++) pips += '<i class="' + (k < lv ? 'f' : '') + '"></i>';
    const tip = (d.name || id) + ' · Seviye ' + lv + ': ' + ((d.desc && d.desc[lv - 1]) || '');
    return '<div class="pc" title="' + esc(tip) + '"><span class="pc-i">' + esc(d.icon || '✦') +
      '</span><span class="pc-p">' + pips + '</span></div>';
  }).join('');
}

function updBoss() {
  let boss = null;
  const L = (G.ships && G.ships.list) || [];
  for (let i = 0; i < L.length; i++) {
    if (L[i].isBoss && L[i].alive) { boss = L[i]; break; }
  }
  if (cached('bossOn', !!boss)) E.boss.classList.toggle('on', !!boss);
  if (boss) {
    const mx = Math.max(1, boss.stats.maxHp || 1);
    setS('bossw', E.bossF, 'width', (G.util.clamp(boss.hp, 0, mx) / mx * 100).toFixed(2) + '%');
  }
}

function updHud(dt, mode) {
  const S = G.state;
  const p = G.player;
  if (p && p.stats) {
    updHp(dt, p);
    updGauges(p);
  } else {
    setS('hpf', E.hpF, 'width', '100%');
  }
  updXp();
  updActives();
  updPassives();
  setT('tt', E.tTime, mmss(S.runTime));
  setT('tw', E.tWave, 'DALGA ' + (S.wave || 0));
  setT('ts', E.tScore, nf(S.score));
  setT('gold', E.gold, nf(S.gold));
  setT('kills', E.kills, nf(S.kills));
  updBoss();
}

function lowHpCheck() {
  const p = G.player;
  if (!p || !p.stats || !p.alive) return false;
  return p.hp / Math.max(1, p.stats.maxHp || 1) < 0.3;
}

function updTutorial(mode) {
  if (tutState === 0 && mode === 'playing' && (G.state.runTime || 0) < 12) {
    tutState = 1;
    E.tut.classList.add('on');
  }
  if (tutState === 1 && (G.state.runTime || 0) >= 12) {
    tutState = 2;
    E.tut.classList.remove('on');
  }
}

// ---------------------------------------------------------------------------
// Minimap (canvas, rotates so heading is up)
// ---------------------------------------------------------------------------
function drawMini() {
  const x = E.mmX;
  if (!x) return;
  const S = E.mmS || 170;
  const R = S / 2;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, S, S);
  x.save();
  x.beginPath();
  x.arc(R, R, R - 1, 0, Math.PI * 2);
  x.clip();
  const bg = x.createRadialGradient(R, R, R * 0.1, R, R, R);
  bg.addColorStop(0, 'rgba(18,40,54,.92)');
  bg.addColorStop(1, 'rgba(3,9,14,.97)');
  x.fillStyle = bg;
  x.fillRect(0, 0, S, S);

  x.strokeStyle = 'rgba(201,162,75,.16)';
  x.lineWidth = 1;
  x.beginPath();
  x.arc(R, R, (R - 24) * 0.5, 0, Math.PI * 2);
  x.stroke();
  x.beginPath();
  x.arc(R, R, R - 24, 0, Math.PI * 2);
  x.stroke();

  const p = G.player;
  if (p && p.pos) {
    const yaw = p.yaw || 0;
    const sn = Math.sin(yaw), cs = Math.cos(yaw);
    const K = (R - 24) / MM_RANGE;
    const L = (G.ships && G.ships.list) || [];
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      if (s === p || !s.alive || s.sinking || !s.pos) continue;
      if (s.team !== 'enemy' && s.team !== 'ally') continue;
      const dx = s.pos.x - p.pos.x, dz = s.pos.z - p.pos.z;
      const f = dx * sn + dz * cs;
      const r = -dx * cs + dz * sn;
      const len = Math.sqrt(f * f + r * r);
      const clamped = len > MM_RANGE;
      const k = clamped ? (R - 12) / Math.max(1e-3, len) : K;
      const px = R + r * k, py = R - f * k;
      if (s.team === 'ally') x.fillStyle = '#5fe3f0';
      else if (s.isBoss) x.fillStyle = '#ff2f2f';
      else if (s.type === 'fireship') x.fillStyle = '#ff9a3c';
      else x.fillStyle = '#e0453c';
      if (clamped) {
        x.globalAlpha = 0.75;
        x.fillRect(px - 2, py - 2, 4, 4);
        x.globalAlpha = 1;
      } else {
        const rad = s.isBoss ? 5.5 : 3.2;
        x.beginPath();
        x.arc(px, py, rad, 0, Math.PI * 2);
        x.fill();
        if (s.isBoss) {
          x.strokeStyle = '#f3d88a';
          x.lineWidth = 1.2;
          x.stroke();
        }
      }
    }

    // compass letters rotate with the ring
    x.font = 'bold 11px ' + "'Palatino Linotype','Book Antiqua',Palatino,Georgia,serif";
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const dirs = [['N', 0, 1], ['E', 1, 0], ['S', 0, -1], ['W', -1, 0]];
    for (let i = 0; i < dirs.length; i++) {
      const dd = dirs[i];
      const f = dd[1] * sn + dd[2] * cs;
      const r = -dd[1] * cs + dd[2] * sn;
      x.fillStyle = dd[0] === 'N' ? '#ff7a6b' : 'rgba(241,227,194,.8)';
      x.fillText(dd[0], R + r * (R - 12), R - f * (R - 12));
    }

    // player arrow
    x.fillStyle = '#f3d88a';
    x.strokeStyle = 'rgba(0,0,0,.7)';
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(R, R - 9);
    x.lineTo(R + 6, R + 7);
    x.lineTo(R, R + 3);
    x.lineTo(R - 6, R + 7);
    x.closePath();
    x.fill();
    x.stroke();
  }
  x.restore();

  x.strokeStyle = 'rgba(201,162,75,.85)';
  x.lineWidth = 2;
  x.beginPath();
  x.arc(R, R, R - 1, 0, Math.PI * 2);
  x.stroke();
}

// ---------------------------------------------------------------------------
// Overlay canvas: enemy health bars and off-screen threat arrows
// ---------------------------------------------------------------------------
function drawOverlay() {
  const x = E.ovX;
  if (!x) return;
  const W = window.innerWidth, H = window.innerHeight;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, W, H);
  const p = G.player;
  if (!p || !p.pos || !G.camera || !G.util || !G.util.worldToScreen) return;
  if (!_tv && typeof THREE !== 'undefined') _tv = new THREE.Vector3();
  if (!_tv) return;
  const cx = W / 2, cy = H / 2;
  const L = (G.ships && G.ships.list) || [];
  for (let i = 0; i < L.length; i++) {
    const s = L[i];
    if (s === p || !s.alive || s.sinking || !s.pos || !s.stats) continue;
    const enemy = s.team === 'enemy';
    if (!enemy && s.team !== 'ally') continue;
    const dsq = G.util.dist2DSq(s.pos, p.pos);

    // health bars for damaged ships
    if (!s.isBoss && dsq < BAR_RANGE * BAR_RANGE && s.hp < s.stats.maxHp) {
      _tv.set(s.pos.x, s.pos.y + 9, s.pos.z);
      G.util.worldToScreen(_tv, _sc);
      if (_sc.visible && isFinite(_sc.x) && isFinite(_sc.y) &&
          _sc.x > -40 && _sc.x < W + 40 && _sc.y > -40 && _sc.y < H + 40) {
        const bw = 56;
        const frac = G.util.clamp(s.hp / s.stats.maxHp, 0, 1);
        const bx = _sc.x - bw / 2, by = _sc.y;
        x.fillStyle = 'rgba(0,0,0,.55)';
        x.fillRect(bx - 1, by - 1, bw + 2, 8);
        x.fillStyle = enemy ? '#d9352b' : '#5fe3f0';
        x.fillRect(bx, by, bw * frac, 6);
        x.strokeStyle = 'rgba(201,162,75,.6)';
        x.lineWidth = 1;
        x.strokeRect(bx - 0.5, by - 0.5, bw + 1, 7);
      }
    }

    // off-screen threat arrows
    if (enemy && dsq < THREAT_RANGE * THREAT_RANGE) {
      _tv.set(s.pos.x, s.pos.y + 2, s.pos.z);
      G.util.worldToScreen(_tv, _sc);
      if (!isFinite(_sc.x) || !isFinite(_sc.y)) continue;
      const onScreen = _sc.visible && _sc.x >= 0 && _sc.x <= W && _sc.y >= 0 && _sc.y <= H;
      if (onScreen) continue;
      let dx = _sc.x - cx, dy = _sc.y - cy;
      if (!_sc.visible) { dx = -dx; dy = -dy; }
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const M = 40;
      const tx = (W / 2 - M) / Math.max(Math.abs(dx), 1e-3);
      const ty = (H / 2 - M) / Math.max(Math.abs(dy), 1e-3);
      const t = Math.min(tx, ty);
      const ex = cx + dx * t, ey = cy + dy * t;
      x.save();
      x.translate(ex, ey);
      x.rotate(Math.atan2(dy, dx));
      x.fillStyle = 'rgba(217,53,43,.9)';
      x.strokeStyle = 'rgba(0,0,0,.6)';
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(10, 0);
      x.lineTo(-7, -7);
      x.lineTo(-4, 0);
      x.lineTo(-7, 7);
      x.closePath();
      x.fill();
      x.stroke();
      x.restore();
    }
  }
}

// ---------------------------------------------------------------------------
// Tips (menu)
// ---------------------------------------------------------------------------
function tipUpdate(dt) {
  tipT += dt;
  if (tipT < 5) return;
  tipT = 0;
  tipIdx = (tipIdx + 1) % TIPS.length;
  E.tip.textContent = TIPS[tipIdx];
  restart(E.tip, 'tin');
}

// ---------------------------------------------------------------------------
// Update loop
// ---------------------------------------------------------------------------
function update(dt) {
  if (!root) return;
  dt = dt || 0;
  const mode = G.state.mode;
  if (mode === 'menu') {
    tipUpdate(dt);
    return;
  }
  updHud(dt, mode);
  if (mode === 'playing' || mode === 'gameover') {
    drawMini();
    drawOverlay();
  }
  updTutorial(mode);
  if (cached('lowhp', mode === 'playing' && lowHpCheck())) {
    E.lowhp.classList.toggle('on', C.lowhp);
  }
}

// ---------------------------------------------------------------------------
// Level-up modal
// ---------------------------------------------------------------------------
function cardHtml(c, i) {
  const R = RARITY[c.rarity] || RARITY.common;
  const max = c.maxLevel || 3;
  const cur = Math.max(0, (c.nextLevel || 1) - 1);
  let pips = '';
  for (let k = 0; k < max; k++) {
    let cls = '';
    if (k < cur) cls = 'f';
    else if (k === cur) cls = 'nw';
    pips += '<i class="' + cls + '"></i>';
  }
  const badge = c.isNew ? 'YENİ' : 'GELİŞTİR';
  const active = c.isActive ? '<div class="lc-act">AKTİF YETENEK · [' + esc(c.key) + ']</div>' : '';
  return '<div class="lc r-' + esc(c.rarity || 'common') + '" data-i="' + i + '" style="--rc:' + R.c +
    ';--rgb:' + R.rgb + ';--d:' + (0.1 + i * 0.13).toFixed(2) + 's">' +
    '<div class="lc-in">' +
    '<div class="lc-top"><span class="lc-bdg ' + (c.isNew ? 'new' : '') + '">' + badge + '</span><span class="lc-key">' + (i + 1) + '</span></div>' +
    '<div class="lc-med">' + esc(c.icon || '✦') + '</div>' +
    '<div class="lc-name">' + esc(c.name) + '</div>' +
    '<div class="lc-rar">' + R.label + '</div>' +
    '<div class="lc-pips">' + pips + '</div>' +
    active +
    '<div class="lc-desc">' + esc(c.desc || '') + '</div>' +
    '<div class="lc-tag">' + esc(c.tagline || '') + '</div>' +
    '</div></div>';
}

function renderCards() {
  E.luCards.innerHTML = lu.choices.map((c, i) => cardHtml(c, i)).join('');
  lu.lastHov = -1;
}

function updateReroll() {
  const n = (G.perks && G.perks.rerollsLeft) || 0;
  E.luRe.textContent = '🎲 Yeniden Çek (' + n + ')';
  E.luRe.disabled = n <= 0;
}

function showLevelUp(choices, onPick) {
  const list = Array.isArray(choices) ? choices.slice(0, 3) : [];
  if (!root) {
    if (typeof onPick === 'function') onPick(list[0] ? list[0].id : '_gold');
    return;
  }
  if (!list.length) {
    // nothing to offer: never soft-lock the game
    setTimeout(() => { if (typeof onPick === 'function') onPick('_gold'); }, 0);
    return;
  }
  lu.onPick = typeof onPick === 'function' ? onPick : null;
  lu.done = false;
  lu.on = true;
  lu.t0 = performance.now();
  lu.choices = list;
  E.luLvl.textContent = 'Seviye ' + (G.state.level || 1);
  renderCards();
  updateReroll();
  E.lu.classList.remove('picked');
  E.lu.classList.add('on');
}

function pick(i) {
  if (!lu.on || lu.done) return;
  const c = lu.choices[i];
  if (!c) return;
  if (performance.now() - lu.t0 < 400) return;
  lu.done = true;
  E.lu.classList.add('picked');
  const card = E.luCards.children[i];
  if (card) card.classList.add('sel');
  sfx('click');
  setTimeout(() => {
    lu.on = false;
    E.lu.classList.remove('on', 'picked');
    const cb = lu.onPick;
    lu.onPick = null;
    if (typeof cb === 'function') {
      try { cb(c.id); } catch (e) { console.error(e); }
    }
  }, 350);
}

function onReroll() {
  if (!lu.on || lu.done) return;
  const perks = G.perks;
  if (!perks || !(perks.rerollsLeft > 0)) return;
  unlockAudio();
  sfx('click');
  let res = null;
  try { res = perks.reroll ? perks.reroll() : null; } catch (e) { console.error(e); }
  if (Array.isArray(res) && res.length) {
    lu.choices = res.slice(0, 3);
    renderCards();
  }
  updateReroll();
}

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------
function countUp(items) {
  if (goRaf) cancelAnimationFrame(goRaf);
  const t0 = performance.now();
  const D = 1100;
  const step = now => {
    const k = Math.min(1, (now - t0) / D);
    const e = 1 - Math.pow(1 - k, 3);
    for (let i = 0; i < items.length; i++) {
      if (items[i].el) items[i].el.textContent = items[i].fmt(items[i].to * e);
    }
    goRaf = k < 1 ? requestAnimationFrame(step) : 0;
  };
  step(t0);
}

function showGameOver(stats) {
  if (!root) return;
  stats = stats || {};
  const S = G.state;
  const num = (...vals) => {
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (typeof v === 'number' && isFinite(v)) return v;
    }
    return 0;
  };
  const time = num(stats.runTime, stats.time, S.runTime);
  const level = num(stats.level, S.level);
  const kills = num(stats.kills, S.kills);
  const boss = num(stats.bossKills, S.bossKills);
  const dmg = num(stats.damageDealt, S.damageDealt);
  const gold = num(stats.gold, S.gold);
  const score = num(stats.score, S.score);
  const prevBest = Math.max(num(stats.best), readBest());
  const isNew = score > 0 && score >= prevBest;
  const best = Math.max(prevBest, score);
  if (score > readBest()) writeBest(score);

  const fmtN = v => nf(v);
  countUp([
    { el: E.goV.time, to: time, fmt: mmss },
    { el: E.goV.level, to: level, fmt: v => String(Math.round(v)) },
    { el: E.goV.kills, to: kills, fmt: fmtN },
    { el: E.goV.boss, to: boss, fmt: fmtN },
    { el: E.goV.dmg, to: dmg, fmt: fmtN },
    { el: E.goV.gold, to: gold, fmt: fmtN },
    { el: E.goV.score, to: score, fmt: fmtN },
    { el: E.goV.best, to: best, fmt: fmtN }
  ]);
  E.goRec.classList.toggle('show', isNew);

  const owned = (G.perks && G.perks.owned) || {};
  const defs = (G.perks && G.perks.DEFS) || {};
  E.goPerks.innerHTML = Object.keys(owned).filter(id => owned[id] > 0).map(id => {
    const d = defs[id] || {};
    return '<span title="' + esc((d.name || id) + ' · Seviye ' + owned[id]) + '">' + esc(d.icon || '✦') + '</span>';
  }).join('');

  lu.on = false;
  lu.done = true;
  E.lu.classList.remove('on', 'picked');
  restart(E.go, 'go');
  E.go.classList.add('on');
}

// ---------------------------------------------------------------------------
// Toasts and banners
// ---------------------------------------------------------------------------
function toast(text, color) {
  if (!root) return;
  const box = E.toasts;
  while (box.children.length >= 4) box.firstElementChild.remove();
  const d = document.createElement('div');
  d.className = 'toast';
  d.textContent = String(text == null ? '' : text);
  d.style.setProperty('--tc', color || '#c9a24b');
  box.appendChild(d);
  requestAnimationFrame(() => d.classList.add('in'));
  setTimeout(() => {
    d.classList.remove('in');
    d.classList.add('out');
    setTimeout(() => d.remove(), 420);
  }, 2600);
}

function banner(title, subtitle) {
  if (!root) return;
  clearTimeout(bnT1);
  clearTimeout(bnT2);
  E.bnT.textContent = String(title || '');
  E.bnS.textContent = String(subtitle || '');
  restart(E.bn, 'on');
  E.bn.classList.add('on');
  bnT1 = setTimeout(() => { E.bn.classList.remove('on'); }, 2200);
}

function healPop(amount) {
  const el = document.createElement('div');
  el.className = 'hp-pop';
  el.textContent = '+' + Math.round(amount);
  E.hpPops.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// ---------------------------------------------------------------------------
// Event subscriptions (registration only; DOM is touched inside handlers)
// ---------------------------------------------------------------------------
G.on('mode:changed', d => { if (root && d) applyMode(d.mode); });

G.on('ship:damaged', d => {
  if (!root || !d || !G.player || d.ship !== G.player) return;
  restart(E.flash, 'hit');
  restart(E.hpP, 'shk');
});

G.on('player:healed', d => {
  if (!root || !d || !(d.amount > 0)) return;
  healPop(d.amount);
});

G.on('player:levelup', () => { if (root) levelFx(); });

G.on('wave:started', d => {
  if (!root) return;
  toast('Dalga ' + ((d && d.wave) || ''), '#c9a24b');
});

G.on('perk:acquired', d => {
  if (!root || !d || !d.def) return;
  const R = RARITY[d.def.rarity] || RARITY.common;
  toast((d.def.icon || '✦') + ' ' + (d.def.name || '') + ' · Seviye ' + (d.level || 1), R.c);
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
G.ui = {
  init: init,
  update: update,
  reset: reset,
  showLevelUp: showLevelUp,
  showGameOver: showGameOver,
  showMenu: showMenu,
  toast: toast,
  banner: banner
};
})();
