// ============================================================================
// Ghost.io — Cloudflare Worker Entry & Game Container
// A Paper.io-style arena game where opponents are "ghosts" cloned from your
// own previous runs via behavioral cloning.
// Architecture: No server API or database; the Worker serves the static HTML,
// the game runs 100% client-side, and run data persists in localStorage.
// Deploy command: npx wrangler deploy
// ============================================================================

const HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="theme-color" content="#0f1220">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Ghost.io</title>
<style>
  /* Full-viewport mobile-first layout; disables pull-to-refresh, selection, and scrolling */
  html,body{margin:0;height:100%;width:100%;position:fixed;background:#0f1220;color:#e8ebff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden;overscroll-behavior:none;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
  #wrap{display:flex;flex-direction:column;height:100%;height:100dvh;box-sizing:border-box;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
  #hud{display:flex;gap:4px;padding:0 6px;font-size:11px;align-items:center;height:32px;flex:none;overflow:hidden}
  #chips{display:flex;gap:4px;flex-wrap:nowrap}
  .chip{padding:2px 6px;border-radius:10px;background:#1b2040;border-left:5px solid #fff;white-space:nowrap}
  .me{font-weight:700;background:#262d5a}
  #time{margin-left:auto;flex:none;font-weight:700;color:#ff5d73;font-size:14px;letter-spacing:1px}
  #stage{flex:1;position:relative;min-height:0}
  canvas{position:absolute;left:0;top:0;width:100%;height:100%;background:#0a0b16}
  #ov{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,12,24,.85);text-align:center;padding:16px;box-sizing:border-box}
  #card{background:#1b2040;padding:22px 24px;border-radius:16px;max-width:340px;width:100%;max-height:100%;overflow:auto;box-sizing:border-box;line-height:1.45;font-size:14px}
  #card h1{margin:0 0 6px;font-size:26px}
  #card h2{margin:0 0 8px;font-size:22px}
  .muted{opacity:.7;font-size:12px}
  button{background:#4da3ff;color:#0f1220;border:0;padding:11px 22px;border-radius:10px;font-weight:700;font-size:16px;margin:10px 4px 0;min-height:44px;touch-action:manipulation}
  button.alt{background:#2a315c;color:#e8ebff;font-size:13px;padding:8px 14px}
  table{width:100%;border-collapse:collapse;margin:8px 0;font-size:13px}
  td{padding:3px 4px;text-align:left}
  td:last-child{text-align:right}
  .dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px}
</style>
</head>
<body>
<div id="wrap">
  <div id="hud"><div id="chips"></div><div id="time"></div></div>
  <div id="stage"><canvas id="cv"></canvas></div>
</div>
<div id="ov"><div id="card"></div></div>

<script>
(function(){

// ============================================================================
// [SECTION 1] GAME CONFIGURATION & CONSTANTS
// Purpose: Defines core game parameters (directions, palette, arena dimensions,
// tick rate, lives, and ML sample thresholds). Modify here to tune balance.
// ============================================================================
var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; // Direction vectors: 0=right, 1=down, 2=left, 3=up
var COLORS = ['#4da3ff','#ff5d73','#ffc14d','#59e0a0','#c58bff','#ff8f5a','#5ad7e6']; // Entity color palette
var CRGB = COLORS.map(function(h){ return [parseInt(h.substr(1,2),16), parseInt(h.substr(3,2),16), parseInt(h.substr(5,2),16)]; }); // Pre-parsed RGB tuples for fast minimap pixel buffer writes
var WALL = '#ff2bd6', OUTSIDE = '#0a0b16', FLOOR = '#161a30'; // Arena visual colors
var TICK_MS = 100;           // Logic update interval in ms (10 ticks/sec)
var LIVES = 3;               // Player lives per round
var MINS = 8;                // Minimum samples required in a context bucket before a ghost trusts it
var KEY = 'ghostio_runs_v1'; // localStorage key for persisted ghost runs
var W = 80, H = 80, N = W * H; // Fixed arena grid size in cells (80x80 = 6400 cells)


// ============================================================================
// [SECTION 2] GLOBAL GAME STATE & DOM REFERENCES
// Purpose: Holds mutable runtime state, grid buffers, active entities, and DOM
// nodes used across the simulation and rendering loop.
// ============================================================================
var cv = document.getElementById('cv'), ctx = cv.getContext('2d');
var chipsEl = document.getElementById('chips'), timeEl = document.getElementById('time');
var ov = document.getElementById('ov'), card = document.getElementById('card'), stage = document.getElementById('stage');

// Offscreen 1:1 pixel canvas for the minimap (redrawn via ImageData every tick)
var mini = document.createElement('canvas'); mini.width = W; mini.height = H;
var mctx = mini.getContext('2d'), mimg = mctx.createImageData(W, H);

var owner;          // Uint8Array(N): stores entity ID owning each cell (0 = neutral)
var trail;          // Uint8Array(N): stores entity ID of active trail in each cell (0 = none)
var ents = [];      // Array of all active entities in the current round (index 0 is always player)
var player = null;  // Direct reference to the human player entity
var tick = 0;       // Logic step counter since round start
var running = false;// Game loop active flag
var cell = 16;      // Dynamic pixel size of one grid cell (scaled on resize)
var dpr = 1, cw = 0, ch = 0; // Canvas CSS dimensions and device pixel ratio
var q = [];         // Input turn queue (max 2 buffered turns to prevent dropped rapid swipes)
var tripSum = 0, tripN = 0, trips = []; // Player excursion length stats recorded during the round
var last = 0, acc = 0; // Fixed-timestep accumulator variables for decoupling logic from render FPS
var toast = { msg: '', until: 0 }; // Floating feedback notification when player kills an opponent

// Shared utility helpers
function rnd(n){ return Math.floor(Math.random() * n); }
function byId(id){ return ents[id - 1]; }


// ============================================================================
// [SECTION 3] STORAGE & GHOST REPOSITORY (LOCALSTORAGE)
// Purpose: Manages reading/writing recorded runs in localStorage, pruning
// sparse ML models, and selecting which past ghosts to spawn against the player.
// ============================================================================
function loadRuns(){
  try {
    var r = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (r && r.runs) return r;
  } catch(e) {}
  return { n: 0, runs: [] };
}

function saveRuns(r){
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch(e) {}
}

// Generates a basic rectangular movement script for fallback BOTs when no ghosts exist yet
function genDefault(){
  var s = Math.random() < 0.5 ? 1 : 3, out = [];
  for (var i = 0; i < 40; i++){
    out.push([3 + rnd(7), Math.random() < 0.8 ? s : (s === 1 ? 3 : 1)]);
  }
  return out;
}

// Selects up to 4 ghosts: the top 3 peak-territory runs + the most recent run (deduplicated)
function pickGhosts(store){
  var runs = store.runs.slice(), out = [], i;
  var best = runs.slice().sort(function(a, b){ return b.peak - a.peak; });
  var latest = runs.slice().reverse();
  [best[0], best[1], best[2], latest[0]].forEach(function(r){
    if (r && out.indexOf(r) < 0) out.push(r);
  });
  for (i = 3; i < best.length && out.length < 4; i++) {
    if (out.indexOf(best[i]) < 0) out.push(best[i]);
  }
  return out;
}

// Strips under-sampled context keys before saving to keep localStorage payload compact
function pruneModel(m){
  var o = {}, k, c;
  for (k in m){
    c = m[k];
    if (k.charAt(0) === '4' || c[0] + c[1] + c[2] + c[3] >= MINS) o[k] = c;
  }
  return o;
}


// ============================================================================
// [SECTION 4] ENTITY MANAGEMENT, SPAWNING & DEATH
// Purpose: Handles entity instantiation, spatial search for safe spawn zones,
// territory initialization, and elimination/land-transfer mechanics.
// ============================================================================
function mk(id, name, isPlayer){
  return {
    id: id, name: name, isPlayer: isPlayer, color: COLORS[id - 1],
    x: 0, y: 0, px: 0, py: 0, d: 0, alive: false, // Grid pos, previous pos (for lerp), heading
    trail: [], exit: -1, respawn: 0, kills: 0, pct: 0, peak: 0, deaths: 0, wait: 0,
    // AI & Behavioral Cloning state:
    script: null, si: 0, sc: 0, maxTrail: 20, aggr: 0.4, caut: 0.3,
    idle: 0, goal: -1, since: 0, pend: -1, model: null, ns: 0,
    chT: 0, chA: 0, fT: 0, fA: 0, // Aggression (chase) & caution (flee) telemetry counters
    trips: null, tpl: null, ti: 0, tc: 0, ret: false, tripOn: false, tseg: [], tp0: 0, tlist: [], tHunt: false
  };
}

// Finds all cells whose (2*rad+1)^2 neighborhood is completely empty and at least dist away from rivals
function findSpots(e, rad, dist){
  var spots = [], x, y, dx, dy, n, o, ok;
  for (y = rad; y < H - rad; y++) for (x = rad; x < W - rad; x++){
    ok = true;
    for (dy = -rad; dy <= rad && ok; dy++) for (dx = -rad; dx <= rad; dx++){
      if (owner[(y + dy) * W + (x + dx)] || trail[(y + dy) * W + (x + dx)]){ ok = false; break; }
    }
    for (n = 0; n < ents.length && ok; n++){
      o = ents[n];
      if (o !== e && o.alive && Math.abs(o.x - x) + Math.abs(o.y - y) < dist) ok = false;
    }
    if (ok) spots.push(y * W + x);
  }
  return spots;
}

// Spawns an entity on a 3x3 starting patch. Returns false if the arena is too full to land.
function spawn(e, force){
  var x, y, s, spots = findSpots(e, 4, 24);
  if (!spots.length && e.isPlayer) spots = findSpots(e, 2, 8); // Player accepts tighter spawn gaps
  if (spots.length){ s = spots[rnd(spots.length)]; x = s % W; y = (s / W) | 0; }
  else if (force){ x = 4 + rnd(W - 8); y = 4 + rnd(H - 8); } // Forced placement only on initial round start
  else return false;

  for (var dy2 = -1; dy2 <= 1; dy2++) for (var dx2 = -1; dx2 <= 1; dx2++) {
    owner[(y + dy2) * W + (x + dx2)] = e.id;
  }
  e.x = x; e.y = y; e.px = x; e.py = y; e.alive = true; e.born = tick;
  e.trail = []; e.pend = -1; e.since = 0; e.exit = -1; e.idle = 0; e.goal = -1;
  e.tripOn = false; e.tpl = null; e.ret = false;
  // Orient initial heading toward the center of the arena
  var cx = W / 2, cy = H / 2;
  e.d = (Math.abs(cx - x) > Math.abs(cy - y)) ? (x < cx ? 0 : 2) : (y < cy ? 1 : 3);
  return true;
}

// Eliminates an entity, clears its trail, and transfers all its territory to the killer
function kill(e, by){
  if (!e.alive) return;
  e.alive = false;
  for (var k = 0; k < e.trail.length; k++) trail[e.trail[k]] = 0;
  e.trail = []; e.pend = -1; e.tripOn = false; e.deaths++;

  var to = (by && by.alive) ? by.id : 0, moved = 0;
  for (var i = 0; i < N; i++) if (owner[i] === e.id){ owner[i] = to; moved++; }
  if (to && by.isPlayer){
    toast.msg = '+' + (moved * 100 / N).toFixed(1) + '% from ' + e.name;
    toast.until = tick + 25;
  }
  e.respawn = tick + 30; e.wait = 0; // 3-second respawn cooldown (30 ticks)
  if (e.isPlayer && navigator.vibrate) navigator.vibrate(80);
}


// ============================================================================
// [SECTION 5] GAME RULES, PHYSICS & TERRITORY LOGIC
// Purpose: Handles grid movement, deferred trail commitment, loop-closing
// flood fill, head-on collision resolution, and territory percentage counts.
// ============================================================================
// Flood-fills from arena borders to find exterior cells; any unvisited cell is enclosed and claimed
function fill(id){
  var seen = new Uint8Array(N), st = [];
  function push(i){ if (!seen[i] && owner[i] !== id){ seen[i] = 1; st.push(i); } }
  var x, y;
  for (x = 0; x < W; x++){ push(x); push((H - 1) * W + x); }
  for (y = 0; y < H; y++){ push(y * W); push(y * W + W - 1); }
  while (st.length){
    var i = st.pop(); x = i % W; y = (i / W) | 0;
    if (x > 0) push(i - 1); if (x < W - 1) push(i + 1);
    if (y > 0) push(i - W); if (y < H - 1) push(i + W);
  }
  for (var j = 0; j < N; j++) if (!seen[j] && owner[j] !== id) owner[j] = id;
}

// Converts an entity's trail into owned territory upon returning to home land
function closeLoop(e){
  if (e.isPlayer){ tripSum += e.trail.length; tripN++; trips.push(e.trail.length); }
  for (var k = 0; k < e.trail.length; k++){ owner[e.trail[k]] = e.id; trail[e.trail[k]] = 0; }
  e.trail = [];
  fill(e.id);
}

// Commits a pending cell to the trail only after the head steps off it (prevents self-cut on head-on)
function commit(){
  for (var i = 0; i < ents.length; i++){
    var e = ents[i];
    if (!e.alive || e.pend < 0) continue;
    var nx = e.x + DX[e.d], ny = e.y + DY[e.d];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; // Stopped at arena wall
    trail[e.pend] = e.id; e.trail.push(e.pend); e.pend = -1;
  }
}

// Advances an entity by one cell, checks for trail cuts, and triggers loop closure
function move(e){
  if (!e.alive) return;
  var ox = e.x, oy = e.y, nx = ox + DX[e.d], ny = oy + DY[e.d];
  if (nx < 0 || ny < 0 || nx >= W || ny >= H){ e.px = ox; e.py = oy; return; } // Wall stops movement safely
  var i = ny * W + nx, t = trail[i];
  if (t && t !== e.id){ kill(byId(t), e); e.kills++; } // Cut rival's trail
  e.px = ox; e.py = oy; e.x = nx; e.y = ny;
  if (owner[i] === e.id){
    if (e.trail.length) closeLoop(e);
  } else if (t !== e.id){ // Own trail is harmless
    if (!e.trail.length) e.exit = oy * W + ox;
    e.pend = i;
  }
}

// Resolves head-on collisions (same target cell or cell swap): larger territory wins; tie kills both
function resolveHeadOn(){
  var n = ents.length, nx = [], i, j, a, b, tx, ty;
  for (i = 0; i < n; i++){
    a = ents[i]; tx = a.x + DX[a.d]; ty = a.y + DY[a.d];
    nx[i] = (a.alive && tx >= 0 && ty >= 0 && tx < W && ty < H) ? ty * W + tx : a.y * W + a.x;
  }
  for (i = 0; i < n; i++) for (j = i + 1; j < n; j++){
    a = ents[i]; b = ents[j];
    if (!a.alive || !b.alive) continue;
    if (nx[i] === nx[j] || (nx[i] === b.y * W + b.x && nx[j] === a.y * W + a.x)){
      if (a.pct > b.pct){ kill(b, a); a.kills++; }
      else if (b.pct > a.pct){ kill(a, b); b.kills++; }
      else { kill(a); kill(b); }
    }
  }
}

// Recalculates territory percentages and eliminates any entity reduced to 0% land
function recount(){
  var c = new Array(ents.length + 1), i;
  for (i = 0; i < c.length; i++) c[i] = 0;
  for (i = 0; i < N; i++) if (owner[i]) c[owner[i]]++;
  for (i = 0; i < ents.length; i++){
    var e = ents[i];
    e.pct = c[e.id] * 100 / N;
    if (e.pct > e.peak) e.peak = e.pct;
    if (e.alive && c[e.id] === 0 && tick > 3) kill(e);
  }
}


// ============================================================================
// [SECTION 6] PLAYER BEHAVIOR LEARNING (BEHAVIORAL CLONING)
// Purpose: Observes player actions every tick, encodes spatial context into
// multi-resolution feature keys, records geometric loop shapes, and measures
// aggression and caution tendencies.
// ============================================================================
// Maps a relative vector (dx, dy) into egocentric quadrants: 0=ahead, 1=right, 2=behind, 3=left
function sector(e, dx, dy){
  var f = dx * DX[e.d] + dy * DY[e.d], r = dx * DX[(e.d + 1) % 4] + dy * DY[(e.d + 1) % 4];
  return Math.abs(f) >= Math.abs(r) ? (f > 0 ? 0 : 2) : (r > 0 ? 1 : 3);
}

// Encodes the entity's current state into 5 hierarchical context keys (level 0 = finest, level 4 = coarsest)
function ctxKeys(e){
  var home = owner[e.y * W + e.x] === e.id, len = e.trail.length + (e.pend >= 0 ? 1 : 0);
  var lb = home ? 0 : len <= 2 ? 1 : len <= 6 ? 2 : len <= 12 ? 3 : len <= 20 ? 4 : len <= 30 ? 5 : 6;
  var hs = (!home && e.exit >= 0) ? sector(e, e.exit % W - e.x, ((e.exit / W) | 0) - e.y) : 0;
  var x2 = e.x + 2 * DX[e.d], y2 = e.y + 2 * DY[e.d], wl = (x2 < 0 || y2 < 0 || x2 >= W || y2 >= H) ? 1 : 0;
  var bd = 9, kind = 0, sx = 0, sy = 0, i, k, o, d;
  for (i = 0; i < ents.length; i++){
    o = ents[i]; if (o === e || !o.alive) continue;
    d = Math.abs(o.x - e.x) + Math.abs(o.y - e.y);
    if (d < bd){ bd = d; kind = 1; sx = o.x; sy = o.y; }
    for (k = 0; k < o.trail.length; k++){
      d = Math.abs(o.trail[k] % W - e.x) + Math.abs(((o.trail[k] / W) | 0) - e.y);
      if (d < bd){ bd = d; kind = 0; sx = o.trail[k] % W; sy = (o.trail[k] / W) | 0; }
    }
  }
  var thr = bd > 8 ? 0 : 1 + kind * 8 + (bd <= 3 ? 0 : 4) + sector(e, sx - e.x, sy - e.y), tp = thr ? 1 : 0;
  var s = e.since, rb = s <= 1 ? 0 : s <= 4 ? s - 1 : s <= 6 ? 4 : s <= 8 ? 5 : s <= 11 ? 6 : s <= 15 ? 7 : s <= 22 ? 8 : 9;
  return ['0' + lb + hs + wl + thr.toString(36) + rb, '1' + lb + hs + tp + rb, '2' + lb + hs + tp, '3' + lb + rb, '4' + (lb ? 1 : 0)];
}

// Increments action counts (0=straight, 1=right, 2=U-turn, 3=left) across all 5 context levels
function learn(p, act){
  var ks = ctxKeys(p), m = p.model, k, l;
  for (l = 0; l < ks.length; l++){ k = ks[l]; (m[k] || (m[k] = [0, 0, 0, 0]))[act]++; }
  p.ns++;
}

// Records the geometric sequence of [steps, relativeTurn] for each excursion outside home land
function tripTrack(p, rel){
  var out = owner[p.y * W + p.x] !== p.id;
  if (out){
    if (!p.tripOn){ p.tripOn = true; p.tseg = []; p.tc = 0; p.tp0 = p.pct; p.tHunt = false; }
    p.tc++;
    if (rel > 0){ p.tseg.push([Math.min(p.tc, 40), rel]); p.tc = 0; }
  } else if (p.tripOn){
    p.tripOn = false;
    if (p.tseg.length && p.tseg.length <= 10 && !p.tHunt) {
      p.tlist.push({ g: Math.max(0, Math.round((p.pct - p.tp0) * N / 100)), s: p.tseg });
    }
  }
}

// Retains the top 28 highest-yielding loop shapes plus the 12 most recent trips
function keepTrips(list){
  var a = list.slice().sort(function(x, y){ return y.g - x.g; }), out = a.slice(0, 28), rest = list.slice(-12), i;
  for (i = 0; i < rest.length; i++) if (out.indexOf(rest[i]) < 0) out.push(rest[i]);
  return out;
}

// Tracks aggression (moving toward nearby rival trails) and caution (retreating home when a head is near)
function track(p){
  var bd = 11, tx = 0, ty = 0, i, k, o, d;
  for (i = 0; i < ents.length; i++){
    o = ents[i]; if (o === p || !o.alive) continue;
    for (k = 0; k < o.trail.length; k++){
      d = Math.abs(o.trail[k] % W - p.x) + Math.abs(((o.trail[k] / W) | 0) - p.y);
      if (d < bd){ bd = d; tx = o.trail[k] % W; ty = (o.trail[k] / W) | 0; }
    }
  }
  if (bd <= 10){
    if (Math.abs(tx - p.x - DX[p.d]) + Math.abs(ty - p.y - DY[p.d]) < bd) p.chT++; else p.chA++;
    p.tHunt = true; // Flag excursion as a chase so it isn't stored as a standard loop template
  }
  if (p.trail.length + (p.pend >= 0 ? 1 : 0) >= 4 && headNear(p)){
    var n = nearestOwn(p);
    if (n >= 0){
      d = Math.abs(n % W - p.x) + Math.abs(((n / W) | 0) - p.y);
      if (Math.abs(n % W - p.x - DX[p.d]) + Math.abs(((n / W) | 0) - p.y - DY[p.d]) < d) p.fT++; else p.fA++;
    }
  }
}

function headNear(e){
  for (var i = 0; i < ents.length; i++) {
    if (ents[i] !== e && ents[i].alive && Math.abs(ents[i].x - e.x) + Math.abs(ents[i].y - e.y) <= 6) return true;
  }
  return false;
}


// ============================================================================
// [SECTION 7] GHOST AI & PATHFINDING
// Purpose: Executes ghost decision-making each tick by blending target hunting,
// safe retreats, recorded player loop replays, and probabilistic policy lookups.
// ============================================================================
function safe(e, c){
  var nx = e.x + DX[c], ny = e.y + DY[c];
  return nx >= 0 && ny >= 0 && nx < W && ny < H;
}

function okCell(e, c){
  var nx = e.x + DX[c], ny = e.y + DY[c];
  return nx >= 0 && ny >= 0 && nx < W && ny < H && trail[ny * W + nx] !== e.id;
}

// Human-like L-shaped pathfinding toward target cell t (avoids diagonal zig-zagging and self-trail overlap)
function goTo(e, t){
  var tx = t % W, ty = (t / W) | 0, best = -1, bs = 1e9, k, c, nx, ny, sc, d = e.d, ex = tx - e.x, ey = ty - e.y;
  var rem = (d % 2 === 0) ? ex * DX[d] : ey * DY[d];
  var side = (d % 2 === 0) ? ey : ex;
  if (rem > 0 && okCell(e, d)) return d;
  if (rem <= 0 && side !== 0){
    c = (d % 2 === 0) ? (side > 0 ? 1 : 3) : (side > 0 ? 0 : 2);
    if (okCell(e, c)) return c;
  }
  for (k = 0; k < 3; k++){
    c = (e.d + (k === 0 ? 0 : k === 1 ? 1 : 3)) % 4;
    nx = e.x + DX[c]; ny = e.y + DY[c];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    sc = Math.abs(tx - nx) + Math.abs(ty - ny) + (trail[ny * W + nx] === e.id ? 6 : 0) + (k ? 0.5 : 0);
    if (sc < bs){ bs = sc; best = c; }
  }
  return best;
}

// Finds the closest cell owned by entity e to close an active loop
function nearestOwn(e){
  var best = -1, bd = 1e9, i, d;
  for (i = 0; i < N; i++){
    if (owner[i] !== e.id) continue;
    d = Math.abs(i % W - e.x) + Math.abs(((i / W) | 0) - e.y);
    if (d < bd){ bd = d; best = i; }
  }
  return best;
}

// Weighted random selection of a recorded player trip (weighted by territory gained, capped at 120)
function pickTrip(list){
  var tot = 0, i, r;
  for (i = 0; i < list.length; i++) tot += 1 + Math.min(list[i].g, 120);
  r = Math.random() * tot;
  for (i = 0; i < list.length; i++){ r -= 1 + Math.min(list[i].g, 120); if (r < 0) return list[i].s; }
  return list[0].s;
}

// Scans for nearby rival trails within an aggression-scaled Manhattan radius
function hunt(e){
  if (tick - e.born < 30) return -1; // 3-second spawn grace period
  var range = 4 + Math.floor(e.aggr * 6), best = -1, bd = 1e9;
  for (var n = 0; n < ents.length; n++){
    var o = ents[n];
    if (o === e || !o.alive || !o.trail.length) continue;
    for (var k = 0; k < o.trail.length; k++){
      var i = o.trail[k], d = Math.abs((i % W) - e.x) + Math.abs(((i / W) | 0) - e.y);
      if (d < bd){ bd = d; best = i; }
    }
  }
  return bd <= range ? best : -1;
}

function pickGoal(e){
  for (var t = 0; t < 40; t++){
    var i = rnd(N), x = i % W, y = (i / W) | 0;
    if (owner[i] !== e.id && x > 1 && y > 1 && x < W - 2 && y < H - 2) return i;
  }
  return -1;
}

// Samples a relative turn action from the finest context bucket that meets the MINS sample threshold
function policy(e){
  var ks = ctxKeys(e), c, t, r, a;
  for (var l = 0; l < 5; l++){
    c = e.model[ks[l]];
    if (!c) continue;
    t = c[0] + c[1] + c[2] + c[3];
    if (t >= MINS || l === 4){
      r = Math.random() * t;
      for (a = 0; a < 4; a++){ r -= c[a]; if (r < 0) return a; }
      return 0;
    }
  }
  return Math.random() < 0.1 ? (Math.random() < 0.5 ? 1 : 3) : 0;
}

// Main AI tick controller. Priority: Hunt trail > Retreat home > Replay trip shape > Policy/Script
function ghostDecide(e){
  var d = e.d, prefs = [], target = -1, k, c, h, s;
  var out = owner[e.y * W + e.x] !== e.id, len = e.trail.length + (e.pend >= 0 ? 1 : 0);
  e.idle = (!out && !len) ? e.idle + 1 : 0;
  if (!e.model) e.sc++;
  if (!out){ e.tpl = null; e.ret = false; }
  else if (len > e.maxTrail) e.ret = true;
  else if (len >= 4 && !e.ret && headNear(e) && Math.random() < e.caut) e.ret = true;

  h = hunt(e);
  if (h >= 0){ target = h; e.tpl = null; e.ret = true; e.goal = -1; }
  else if (e.ret){ target = nearestOwn(e); }
  else if (!out && e.idle > (e.model ? 40 : 14)){
    if (e.goal < 0 || owner[e.goal] === e.id) e.goal = pickGoal(e);
    target = e.goal;
  } else {
    e.goal = -1;
    if (e.model && out && e.trips){
      if (!e.tpl){ e.tpl = pickTrip(e.trips); e.ti = 0; e.tc = 0; }
      e.tc++;
      if (e.ti < e.tpl.length){
        if (e.tc >= e.tpl[e.ti][0]){ prefs = [(d + e.tpl[e.ti][1]) % 4]; e.tc = 0; e.ti++; }
      } else { e.ret = true; target = nearestOwn(e); }
    }
  }

  if (target >= 0){ c = goTo(e, target); if (c >= 0) prefs = [c]; }
  else if (!prefs.length && !(e.model && e.trips)){
    if (e.model){ c = policy(e); if (c) prefs = [(d + c) % 4]; }
    else {
      s = e.script[e.si % e.script.length];
      if (e.sc >= s[0]){ prefs = [(d + s[1]) % 4]; e.sc = 0; e.si++; }
    }
  }

  var order = prefs.concat(Math.random() < 0.5 ? [d, (d + 1) % 4, (d + 3) % 4, (d + 2) % 4] : [d, (d + 3) % 4, (d + 1) % 4, (d + 2) % 4]);
  for (k = 0; k < order.length; k++){
    if (safe(e, order[k])){ e.d = order[k]; break; }
  }
  if (e.d !== d) e.since = 0;
  e.since++;
}


// ============================================================================
// [SECTION 8] GRAPHICS & RENDERING ENGINE (CANVAS & MINIMAP)
// Purpose: Renders the viewport-culled arena, smooth sub-tick interpolated
// heads, territory/trails, respawn overlays, kill toasts, and the minimap.
// ============================================================================
function updateMini(){
  var d = mimg.data, i, o;
  for (i = 0; i < N; i++){
    o = owner[i];
    d[i * 4] = o ? CRGB[o - 1][0] : 22;
    d[i * 4 + 1] = o ? CRGB[o - 1][1] : 26;
    d[i * 4 + 2] = o ? CRGB[o - 1][2] : 48;
    d[i * 4 + 3] = 255;
  }
  mctx.putImageData(mimg, 0, 0);
}

// Renders one frame; a (0..1) is the sub-tick interpolation factor for 60fps smoothness
function draw(a){
  if (!ents.length || !cw) return;
  var p = player, vw = cw / cell, vh = ch / cell;
  var hx = p.px + (p.x - p.px) * a + 0.5, hy = p.py + (p.y - p.py) * a + 0.5;
  var camX = Math.max(-2, Math.min(W + 2 - vw, hx - vw / 2));
  var camY = Math.max(-2, Math.min(H + 2 - vh, hy - vh / 2));
  var i, o, x, y, e;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = OUTSIDE; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(dpr, 0, 0, dpr, -Math.round(camX * cell * dpr), -Math.round(camY * cell * dpr));

  // Arena outer wall border and floor
  ctx.fillStyle = WALL; ctx.fillRect(-cell, -cell, (W + 2) * cell, (H + 2) * cell);
  ctx.fillStyle = FLOOR; ctx.fillRect(0, 0, W * cell, H * cell);

  // Viewport culling bounds (only draw cells visible on screen)
  var x0 = Math.max(0, Math.floor(camX)), x1 = Math.min(W, Math.ceil(camX + vw));
  var y0 = Math.max(0, Math.floor(camY)), y1 = Math.min(H, Math.ceil(camY + vh));

  // Subtle floor grid lines
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1; ctx.beginPath();
  for (x = x0; x <= x1; x++){ ctx.moveTo(x * cell, y0 * cell); ctx.lineTo(x * cell, y1 * cell); }
  for (y = y0; y <= y1; y++){ ctx.moveTo(x0 * cell, y * cell); ctx.lineTo(x1 * cell, y * cell); }
  ctx.stroke();

  // Claimed territory and active trails
  for (y = y0; y < y1; y++) for (x = x0; x < x1; x++){
    i = y * W + x;
    o = owner[i];
    if (o){ ctx.globalAlpha = 0.42; ctx.fillStyle = ents[o - 1].color; ctx.fillRect(x * cell, y * cell, cell, cell); }
    o = trail[i];
    if (o){ ctx.globalAlpha = 0.9; ctx.fillStyle = ents[o - 1].color; ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2); }
  }

  // Inner neon wall glow
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,43,214,.35)'; ctx.lineWidth = cell * 0.5;
  ctx.strokeRect(cell * 0.25, cell * 0.25, W * cell - cell * 0.5, H * cell - cell * 0.5);

  // Entity heads (ghosts have white eyes to distinguish them from the player)
  for (i = 0; i < ents.length; i++){
    e = ents[i];
    if (!e.alive) continue;
    var ex = (e.px + (e.x - e.px) * a) * cell, ey = (e.py + (e.y - e.py) * a) * cell;
    ctx.fillStyle = e.color; ctx.fillRect(ex - 1, ey - 1, cell + 2, cell + 2);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = e.isPlayer ? 2 : 1; ctx.strokeRect(ex - 1, ey - 1, cell + 2, cell + 2);
    if (!e.isPlayer){
      ctx.fillStyle = '#fff';
      var s = Math.max(2, cell * 0.2);
      ctx.fillRect(ex + cell * 0.2, ey + cell * 0.25, s, s);
      ctx.fillRect(ex + cell * 0.6, ey + cell * 0.25, s, s);
    }
  }

  // Reset transform to screen-space coordinates for HUD overlays
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 3-2-1 respawn countdown overlay when player is dead with lives remaining
  if (!p.alive && p.deaths < LIVES){
    var rem = p.respawn - tick, fs = Math.round(Math.min(cw, ch) * 0.3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(10,12,24,.5)'; ctx.fillRect(0, 0, cw, ch);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    ctx.font = '700 ' + fs + 'px system-ui,sans-serif';
    ctx.fillText(rem > 0 ? String(Math.ceil(rem / 10)) : '...', cw / 2, ch / 2);
    ctx.font = '600 16px system-ui,sans-serif';
    ctx.fillText('You died - ' + (LIVES - p.deaths) + (LIVES - p.deaths === 1 ? ' life' : ' lives') + ' left', cw / 2, ch / 2 - fs * 0.75);
  }

  // Floating "+X% from NAME" kill notification
  if (tick < toast.until){
    ctx.globalAlpha = Math.min(1, (toast.until - tick) / 8);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    ctx.font = '700 18px system-ui,sans-serif';
    ctx.fillText(toast.msg, cw / 2, ch - 40);
    ctx.globalAlpha = 1;
  }

  // Top-right minimap with camera viewport indicator and entity dots
  var ms = Math.round(Math.min(92, cw * 0.26)), mx = cw - ms - 6, my = 6;
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 0.9; ctx.drawImage(mini, mx, my, ms, ms);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = WALL; ctx.lineWidth = 2; ctx.strokeRect(mx, my, ms, ms);
  ctx.save(); ctx.beginPath(); ctx.rect(mx, my, ms, ms); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1;
  ctx.strokeRect(mx + camX / W * ms, my + camY / H * ms, vw / W * ms, vh / H * ms);
  ctx.restore();
  for (i = 0; i < ents.length; i++){
    e = ents[i];
    if (!e.alive) continue;
    var dx = mx + (e.x + 0.5) / W * ms, dy = my + (e.y + 0.5) / H * ms, r = e.isPlayer ? 3 : 2;
    ctx.fillStyle = e.isPlayer ? '#fff' : e.color;
    ctx.fillRect(dx - r, dy - r, r * 2, r * 2);
  }
}

function resize(){
  cw = stage.clientWidth; ch = stage.clientHeight;
  cell = Math.max(12, Math.min(28, Math.round(Math.min(cw, ch) / 22)));
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  draw(1);
}


// ============================================================================
// [SECTION 9] UI, PLAYER INPUTS & ROUND LIFECYCLE
// Purpose: Manages DOM overlays (start, game over, pause), top leaderboard HUD,
// touch swipe controls, and the main requestAnimationFrame loop.
// ============================================================================
function turn(nd){
  var lastD = q.length ? q[q.length - 1] : (player ? player.d : 0);
  if (nd === lastD) return;
  if (q.length < 2) q.push(nd);
}

function playerDecide(p){
  var nd = q.length ? q.shift() : -1, turned = nd >= 0 && nd !== p.d, rel = turned ? (nd - p.d + 4) % 4 : 0;
  learn(p, rel);
  tripTrack(p, rel);
  if (turned){ p.d = nd; p.since = 0; }
  p.since++;
  track(p);
}

function updateHud(){
  var list = ents.slice().sort(function(a, b){ return b.pct - a.pct; }), h = '';
  for (var i = 0; i < list.length; i++){
    var e = list[i];
    h += '<span class="chip' + (e.isPlayer ? ' me' : '') + '" style="border-color:' + e.color + (e.alive ? '' : ';opacity:.45') + '">' +
         e.name + ' ' + (e.pct >= 10 ? e.pct.toFixed(0) : e.pct.toFixed(1)) + '%</span>';
  }
  chipsEl.innerHTML = h;
  var lost = Math.min(LIVES, player.deaths);
  timeEl.textContent = '♥'.repeat(LIVES - lost) + '♡'.repeat(lost);
}

function rivalsOut(){
  for (var i = 1; i < ents.length; i++) if (ents[i].alive) return false;
  return true;
}

function roomLeft(){
  return findSpots(player, 4, 0).length > 0;
}

// Single fixed-timestep simulation step (runs every TICK_MS)
function step(){
  tick++;
  var i, e;
  for (i = 0; i < ents.length; i++){
    e = ents[i];
    if (!e.alive){
      if (tick >= e.respawn && (!e.isPlayer || e.deaths < LIVES)){
        if (spawn(e)){
          e.si = 0; e.sc = 0;
          if (e.isPlayer){ q = []; e.since = 0; }
        } else {
          e.respawn = tick + 5; e.wait += 5;
          if (e.isPlayer && e.wait >= 30) endRound('noroom');
        }
      }
      continue;
    }
    if (e.isPlayer) playerDecide(e); else ghostDecide(e);
  }
  if (!running) return;
  resolveHeadOn();
  commit();
  for (i = 0; i < ents.length; i++) move(ents[i]);
  recount();
  updateMini();
  if (tick % 3 === 0) updateHud();
  if (!player.alive && player.deaths >= LIVES) endRound('lives');
  else if (player.alive && tick % 5 === 0 && rivalsOut() && !roomLeft()) endRound('won');
}

// Main browser animation loop
function frame(t){
  if (!running) return;
  if (!last) last = t;
  acc += t - last; last = t;
  if (acc > 500) acc = 500;
  while (acc >= TICK_MS && running){ acc -= TICK_MS; step(); }
  draw(running ? acc / TICK_MS : 1);
  if (running) requestAnimationFrame(frame);
}

function startRound(){
  owner = new Uint8Array(N); trail = new Uint8Array(N);
  ents = []; tick = 0; q = []; tripSum = 0; tripN = 0; trips = []; toast.until = 0;
  player = mk(1, 'You', true); player.model = {}; ents.push(player);

  var store = loadRuns(), picks = pickGhosts(store), id = 2, g;
  picks.forEach(function(r){
    g = mk(id, 'R' + r.id, false);
    g.model = r.model || null;
    g.trips = r.trips && r.trips.length >= 3 ? r.trips : null;
    g.script = g.model ? null : (r.script && r.script.length >= 3 ? r.script : genDefault());
    g.maxTrail = r.t90 ? Math.max(10, Math.min(70, Math.round(r.t90 * 1.25 + 4))) : Math.max(10, Math.min(60, Math.round((r.trip || 20) * 1.3 + 4)));
    g.caut = r.caut != null ? r.caut : 0.4;
    g.aggr = r.aggr != null ? r.aggr : Math.min(0.9, 0.3 + (r.kills || 0) * 0.12);
    ents.push(g); id++;
  });

  // Backfill up to 5 total entities with fallback BOTs if fewer than 4 ghosts are saved
  while (ents.length < 5){
    g = mk(id, 'B' + (id - 1), false);
    g.script = genDefault(); g.maxTrail = 16 + rnd(12); g.aggr = 0.3 + Math.random() * 0.4;
    ents.push(g); id++;
  }

  for (var i = 0; i < ents.length; i++) spawn(ents[i], true);
  recount(); updateMini(); updateHud();
  ov.style.display = 'none';
  running = true; last = 0; acc = 0;
  resize();
  requestAnimationFrame(frame);
}

function showCard(html){ card.innerHTML = html; ov.style.display = 'flex'; }

function runsInfo(){
  var s = loadRuns(), best = 0;
  s.runs.forEach(function(r){ if (r.peak > best) best = r.peak; });
  return { n: s.runs.length, best: best };
}

function showStart(){
  var inf = runsInfo();
  showCard('<h1>&#128123; Ghost.io</h1>' +
    '<div>Claim land by closing loops. Cross a trail to cut its owner. The <b style="color:' + WALL + '">pink wall</b> is the edge of the arena and just stops you, your own trail is harmless, and you can U-turn any time. Head-on crash: the bigger land wins. <b>Kill someone and you take all their land.</b> You have <b>' + LIVES + ' lives</b> and no time limit. <b>Win by wiping out every rival and leaving no room for them to come back.</b></div>' +
    '<p>Your opponents are <b>ghosts of your past rounds</b>: each one learned how you played that round (the shape of your loops, how far you go, how hard you chase and when you play it safe).</p>' +
    '<div class="muted">Swipe anywhere to turn &middot; the minimap (top-right) shows everyone</div>' +
    '<p class="muted">' + (inf.n ? ('Saved ghosts: ' + inf.n + ' | best: ' + inf.best.toFixed(1) + '%') : 'No ghosts yet &mdash; BOTs will fill in until you have some.') + '</p>' +
    '<button id="go">Play</button>' +
    (inf.n ? '<button id="reset" class="alt">Reset ghosts</button>' : ''));
  document.getElementById('go').onclick = startRound;
  var rb = document.getElementById('reset');
  if (rb) rb.onclick = function(){ try { localStorage.removeItem(KEY); } catch(e) {} showStart(); };
}

function endRound(reason){
  if (!running) return;
  running = false;
  draw(1); updateHud();
  var store = loadRuns();
  var saved = player.ns >= 40; // Require at least 40 ticks of player data before saving a new ghost
  if (saved){
    var tl = trips.slice().sort(function(a, b){ return a - b; }), cs = player.chT + player.chA;
    var aggr = cs >= 30 ? Math.max(0.15, Math.min(0.9, (player.chT / cs - 0.4) / 0.4)) : Math.min(0.9, 0.3 + player.kills * 0.12);
    var fs = player.fT + player.fA, caut = fs >= 8 ? Math.max(0.2, Math.min(0.95, (player.fT / fs - 0.45) / 0.45)) : 0.4;
    store.n++;
    store.runs.push({
      id: store.n, model: pruneModel(player.model), ns: player.ns,
      peak: Math.round(player.peak * 10) / 10, trip: tripN ? tripSum / tripN : 20,
      t90: tl.length ? tl[Math.floor((tl.length - 1) * 0.9)] : 20, kills: player.kills,
      aggr: Math.round(aggr * 100) / 100, caut: Math.round(caut * 100) / 100,
      trips: keepTrips(player.tlist), t: Date.now()
    });
    // Cap stored ghosts at 20 by evicting the lowest peak-territory run
    while (store.runs.length > 20){
      var mi = 0;
      for (var k = 1; k < store.runs.length - 1; k++) if (store.runs[k].peak < store.runs[mi].peak) mi = k;
      store.runs.splice(mi, 1);
    }
    saveRuns(store);
  }

  var list = ents.slice().sort(function(a, b){ return b.peak - a.peak; }), rows = '', rank = 1;
  for (var i = 0; i < list.length; i++){
    var e = list[i];
    if (e === player) rank = i + 1;
    rows += '<tr><td><span class="dot" style="background:' + e.color + '"></span>' + (e.isPlayer ? '<b>You</b>' : '&#128123; ' + e.name) +
            '</td><td>' + e.kills + ' kills</td><td>' + e.peak.toFixed(1) + '%</td></tr>';
  }
  var won = reason === 'won';
  var sub = won ? 'Every rival is out and there is no room left for them to come back' :
            reason === 'noroom' ? 'No room left for you to come back' : 'You used all ' + LIVES + ' lives';
  showCard('<h2>' + (won ? 'You win!' : 'Game over') + '</h2>' +
    '<div class="muted">' + sub + '</div>' +
    '<div>Peak territory: <b>' + player.peak.toFixed(1) + '%</b> &mdash; rank <b>' + rank + '/' + list.length + '</b></div>' +
    '<table>' + rows + '</table>' +
    '<div class="muted">' + (saved ? 'This round is now a ghost that plays like you (learned from ' + player.ns + ' of your decisions).' : 'Too short to learn from - no ghost saved.') + '</div>' +
    '<button id="again">Play again</button>');
  document.getElementById('again').onclick = startRound;
}

// Event listeners: touch swipe input, viewport resize, and auto-pause on tab hide
var tsx = 0, tsy = 0;
window.addEventListener('touchstart', function(ev){
  var t = ev.touches[0]; tsx = t.clientX; tsy = t.clientY;
}, { passive: true });

window.addEventListener('touchmove', function(ev){
  if (!running) return;
  ev.preventDefault();
  var t = ev.touches[0], dx = t.clientX - tsx, dy = t.clientY - tsy;
  if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return;
  turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3));
  tsx = t.clientX; tsy = t.clientY;
}, { passive: false });

window.addEventListener('resize', resize);

document.addEventListener('visibilitychange', function(){
  if (!document.hidden || !running) return;
  running = false;
  showCard('<h2>Paused</h2><button id="res">Resume</button>');
  document.getElementById('res').onclick = function(){
    ov.style.display = 'none'; running = true; last = 0; acc = 0; requestAnimationFrame(frame);
  };
});

// Entry point
showStart();
})();
</script>
</body>
</html>`;

// ============================================================================
// CLOUDFLARE WORKER HTTP HANDLER
// ============================================================================
export default {
  async fetch() {
    return new Response(HTML, {
      headers: {
        "content-type": "text/html;charset=UTF-8",
        "cache-control": "no-cache",
      },
    });
  },
};
