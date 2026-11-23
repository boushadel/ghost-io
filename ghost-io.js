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

// Resolves head-on collisions (same target cell or cell swap): larger territory wins
