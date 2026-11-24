// ============================================================================
// GHOST.IO — FULL-STACK CLOUDFLARE WORKER (D1 + KV + DEEP BEHAVIORAL CLONING)
// ============================================================================
//
// [A] AI & DEVELOPER GOVERNANCE RULES (MANDATORY FOR ANY AI EDITING THIS FILE)
// ----------------------------------------------------------------------------
//   1. MANDATORY RATIONALE FOR EVERY EDIT (`FIX RATIONALE:` / `CHANGE REASON:`):
//      - Whenever you add, modify, or fix ANY code in this file, you MUST write
//        an inline comment directly above the changed lines explaining:
//          (a) WHAT symptom/bug or requirement triggered the change, and
//          (b) WHY this specific implementation solves it.
//      - NEVER delete, overwrite, or revert existing `FIX RATIONALE:` blocks
//        unless you have verified that the original bug cannot reoccur.
//   2. PERSISTENT DEVELOPER MANDATES REGISTRY (SECTION [B] BELOW):
//      - Whenever the developer (user) specifies a new core rule, architectural
//        constraint, gameplay behavior, or diagnostic requirement, you MUST
//        append it to Section [B] (`DEVELOPER MANDATES & CORE RULES`) in this
//        header so every future AI assistant sees all accumulated rules without
//        needing them repeated in future prompts.
//   3. COMPLETE SELF-EXPLANATORY DOCUMENTATION:
//      - Keep all section banners, JSDoc function headers, and complex algorithm
//        explanations thorough and up-to-date in clear technical English.
//
// [B] DEVELOPER MANDATES & CORE RULES (ACCUMULATED PROJECT REQUIREMENTS)
// ----------------------------------------------------------------------------
//   - [RULE-01] Every code edit or bug fix must include an inline `FIX RATIONALE:`
//               comment explaining why it was added so future edits stay safe.
//   - [RULE-02] All core rules and major feature requests from the developer
//               must be recorded here inside the source file itself.
//   - [RULE-03] Keep the `[DEV-LOG START] ... [DEV-LOG END]` telemetry system,
//               the HUD instant-copy button (`📋`), and end-of-round/pause copy
//               buttons active until the developer explicitly asks to remove them.
//   - [RULE-04] Strict Account Isolation: Authenticated users must NEVER have
//               `Local#` localStorage ghosts injected into their matches (only
//               cloud D1/KV ghosts or clean `BOT-N` fillers). localStorage runs
//               are strictly restricted to unauthenticated Guest sessions.
//   - [RULE-05] Single-File Cloudflare Worker Architecture: Keep the entire D1/KV
//               backend API and mobile-first HTML5 Canvas client self-contained
//               in `ghost-io.js` for zero-build `npx wrangler deploy`.
//   - [RULE-06] Zero Backticks (`) inside `const HTML = String.raw`...`;` so the
//               embedded frontend template literal never terminates prematurely.
//   - [RULE-07] Single-Round Ghost Learning: Each cloned ghost must learn a
//               player's playstyle exclusively from a SINGLE round (3 lives or
//               victory). NEVER merge, average, or accumulate behavioral models
//               across multiple matches.
//   - [RULE-08] Faithful Skill & Style Mirroring: Cloned ghosts must mirror the
//               human player's actual competence in that single round — smart
//               players produce smart ghosts, cautious players produce cautious
//               ghosts, and reckless/overextending players produce reckless ghosts.
//               Fallback `BOT-N` fillers must play clean baseline loops without
//               pathfinding bugs (no 100-tile straight-line stalls or 2x2 spins).
//   - [RULE-09] Unrestricted 180-Degree U-Turns & Phase-Scaled Loops: Never block
//               or heavily penalize 180-degree U-turns onto an entity's own trail
//               (stepping on own trail is safe in Ghost.io rules and is a core
//               human cutback maneuver). Track and replay early-game vs late-game
//               loop sizing (`earlyMaxTrail` vs `lateMaxTrail`) so ghosts scale
//               their loop ambition dynamically with territory percentage.
//   - [RULE-10] Zero Hardcoded "Smartness" Overrides: NEVER inject hardcoded
//               tactical safety/evasion/retreat intelligence that makes a ghost
//               smarter or more cautious than its human owner. Every tactical
//               reaction (head-on avoidance, trail-threat retreat, hunt range,
//               and loop selection) MUST scale proportionally from traits
//               observed in that player's single round (`caut`, `aggr`, `awareness`).
//   - [RULE-11] Player-Derived Tactical Thresholds & Death Screen Attribution:
//               All loop-closure, home-idle exit, late-game caution, and max
//               hunting trail thresholds (`maxHuntTrail`, `maxHomeIdle`, `lateCaut`)
//               must be measured from the player's single round rather than fixed
//               uniform constants across all ghosts, and the respawn countdown
//               overlay must display the name and cause of whoever killed the player.
//
// [C] SYSTEM ARCHITECTURE & DATABASE SCHEMA REFERENCE
// ----------------------------------------------------------------------------
//   1. Backend (Cloudflare Worker):
//      - Serves the single-file mobile-first HTML5 game at `/`.
//      - Exposes REST JSON endpoints under `/api/*` backed by Cloudflare D1
//        (relational SQL for accounts, ghost metadata, ELO, and battle logs)
//        and Cloudflare KV (key-value store for serialized behavioral brains).
//   2. Frontend (Embedded Single-Page Canvas Game):
//      - Real-time 80x80 grid territory-capture game (Paper.io mechanics).
//      - Observes human player decisions every tick to extract a 5-level
//        hierarchical context-action probability model, geometric loop shapes
//        ("trips"), and continuous behavioral DNA traits.
//      - Clones player behavior into autonomous AI ghosts that fight other
//        players asynchronously while the owner is offline.
//   3. Cloudflare D1 Tables:
//      - users(id, username, username_lower, pass_hash, salt, token, peak, kills, wins, games, elo, created_at)
//      - ghosts(id, user_id, owner_name, slot_num, badge, peak, aggr, caut, max_trail, elo, kills, matches, wins, locked, kv_key, created_at)
//      - battle_logs(id, owner_user_id, ghost_label, challenger_name, ghost_kills, ghost_won, elo_delta, seen, created_at)
//   4. Core Engine Invariants:
//      - `ents[0]` is ALWAYS the human player (`id = 1`); AI ghosts occupy `id = 2..5`.
//      - Grid buffers (`owner`, `trail`) store 1-based entity IDs (`0` = neutral/empty).
//
// DEPLOY COMMAND: npx wrangler deploy
// ============================================================================


// ============================================================================
// [WORKER SECTION 1] CRYPTOGRAPHY, AUTHENTICATION & DNA CLASSIFICATION HELPERS
// Purpose: Provides stateless JSON response builders, Web Crypto token/password
// hashing, Bearer token session resolution, input sanitization, and automatic
// archetype badge assignment based on a player's extracted Style DNA.
// ============================================================================

/**
 * Wraps any plain JS object into an HTTP Response with UTF-8 JSON headers
 * and `no-store` caching so live matchmaking/ELO data is never stale.
 */
function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * Generates a cryptographically secure random hexadecimal string.
 * Used for per-user password salts, session Bearer tokens, and unique KV keys.
 */
function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Computes a salted SHA-256 hex digest using the Web Crypto API.
 * Salt is prepended (`salt:password`) to prevent rainbow-table lookups.
 */
async function hashPassword(password, salt) {
  const enc = new TextEncoder().encode(salt + ":" + password);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Resolves the authenticated user row from the `Authorization: Bearer <token>` header.
 * Returns `null` if missing, malformed, or unmatched in D1 (guest session).
 */
async function getAuthUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token.length < 16) return null;
  return await env.DB.prepare(
    "SELECT id, username, peak, kills, wins, games, elo FROM users WHERE token = ?"
  ).bind(token).first();
}

/**
 * Assigns a human-readable archetype badge to a cloned ghost based on its
 * dominant behavioral traits recorded during the human player's single round.
 * Evaluated in priority order from most specialized combat/expansion style
 * down to the general-purpose "Phantom" fallback.
 */
function classifyGhostBadge(aggr, caut, maxTrail, stealPref, wallPref, defendPref) {
  if (aggr >= 0.68) return "🗡️ Hunter";       // Frequently chases & cuts rival trails
  if (stealPref >= 0.55) return "🏴‍☠️ Raider";   // Prefers carving territory directly from rivals
  if (defendPref >= 0.68) return "🏰 Warden";    // Aggressively intercepts intruders inside home land
  if (wallPref >= 0.68) return "🧱 Wall-Hugger"; // Hugs outer arena borders for safe expansion
  if (caut >= 0.68 && maxTrail <= 26) return "🛡️ Defender"; // Short loops, retreats early on threat
  if (maxTrail >= 42) return "👑 Greedy";        // Takes huge, risky high-reward loops
  return "👻 Phantom";                           // Balanced / adaptive playstyle
}

/**
 * Safely coerces client-submitted telemetry numbers into bounded finite values
 * to prevent NaN/Infinity or out-of-range payloads from corrupting D1/KV.
 */
function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}


// ============================================================================
// [WORKER SECTION 2] CLOUDFLARE D1 & KV API ENDPOINT HANDLERS
// Purpose: Implements all backend REST routes:
//   - POST /api/auth          : Account registration & login with token rotation
//   - GET  /api/me            : Session restore, ghost roster, & offline battle report
//   - GET  /api/leaderboards  : Global top 15 players & top 15 ghosts by ELO
//   - POST /api/match         : Matchmaking & parallel KV brain hydration
//   - POST /api/report        : Post-match ELO calculation & 5-slot ghost persistence
//   - POST /api/ghosts/manage : Lock/unlock or delete owned ghost slots
// ============================================================================

/**
 * Handles both `register` and `login` modes.
 * Enforces 3-14 alphanumeric/underscore usernames and case-insensitive uniqueness
 * via `username_lower` while preserving original display casing in `username`.
 */
async function handleAuth(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonRes({ ok: false, error: "Invalid JSON" }, 400); }

  const mode = body.mode === "register" ? "register" : "login";
  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  if (!/^[a-zA-Z0-9_]{3,14}$/.test(username)) {
    return jsonRes({ ok: false, error: "Username must be 3-14 chars (letters, numbers, _)" }, 400);
  }
  if (password.length < 4 || password.length > 64) {
    return jsonRes({ ok: false, error: "Password must be at least 4 characters" }, 400);
  }

  const lower = username.toLowerCase();
  const existing = await env.DB.prepare(
    "SELECT id, username, pass_hash, salt, peak, kills, wins, games, elo FROM users WHERE username_lower = ?"
  ).bind(lower).first();

  if (mode === "register") {
    if (existing) return jsonRes({ ok: false, error: "Username already taken" }, 409);
    const salt = randomHex(12);
    const passHash = await hashPassword(password, salt);
    const token = randomHex(24);
    const now = Date.now();

    const res = await env.DB.prepare(
      "INSERT INTO users (username, username_lower, pass_hash, salt, token, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(username, lower, passHash, salt, token, now).run();

    const userId = res.meta?.last_row_id;
    return jsonRes({
      ok: true,
      token,
      user: { id: userId, username, peak: 0, kills: 0, wins: 0, games: 0, elo: 1000 },
    });
  } else {
    if (!existing) return jsonRes({ ok: false, error: "Account not found" }, 404);
    const checkHash = await hashPassword(password, existing.salt);
    if (checkHash !== existing.pass_hash) {
      return jsonRes({ ok: false, error: "Incorrect password" }, 401);
    }
    // Rotate session token on every login
    const token = randomHex(24);
    await env.DB.prepare("UPDATE users SET token = ? WHERE id = ?").bind(token, existing.id).run();
    return jsonRes({
      ok: true,
      token,
      user: {
        id: existing.id,
        username: existing.username,
        peak: existing.peak,
        kills: existing.kills,
        wins: existing.wins,
        games: existing.games,
        elo: existing.elo,
      },
    });
  }
}

/**
 * Restores the current user's profile, their up-to-5 saved ghosts, and any
 * unseen asynchronous battles fought by their ghosts while offline.
 * Automatically marks fetched `battle_logs` as `seen = 1` so the popup shows once.
 */
async function handleMe(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return jsonRes({ ok: false, error: "Unauthorized" }, 401);

  const ghostsRes = await env.DB.prepare(
    "SELECT id, slot_num, badge, peak, aggr, caut, max_trail, elo, kills, matches, wins, locked, created_at FROM ghosts WHERE user_id = ? ORDER BY locked DESC, elo DESC, id DESC"
  ).bind(user.id).all();

  const logsRes = await env.DB.prepare(
    "SELECT id, ghost_label, challenger_name, ghost_kills, ghost_won, elo_delta, created_at FROM battle_logs WHERE owner_user_id = ? AND seen = 0 ORDER BY id DESC LIMIT 20"
  ).bind(user.id).all();

  const unseen = logsRes.results || [];
  if (unseen.length > 0) {
    await env.DB.prepare("UPDATE battle_logs SET seen = 1 WHERE owner_user_id = ? AND seen = 0").bind(user.id).run();
  }

  let report = null;
  if (unseen.length > 0) {
    let totalKills = 0, netElo = 0, wins = 0;
    for (const l of unseen) {
      totalKills += l.ghost_kills || 0;
      netElo += l.elo_delta || 0;
      if (l.ghost_won) wins++;
    }
    report = {
      battles: unseen.length,
      kills: totalKills,
      wins,
      netElo,
      logs: unseen.slice(0, 6), // Send top 6 recent entries for compact UI display
    };
  }

  return jsonRes({
    ok: true,
    user,
    ghosts: ghostsRes.results || [],
    report,
  });
}

/**
 * Fetches global Top 15 Players and Top 15 Ghosts ordered by ELO rating.
 */
async function handleLeaderboards(env) {
  const playersRes = await env.DB.prepare(
    "SELECT username, elo, peak, kills, wins, games FROM users ORDER BY elo DESC, peak DESC LIMIT 15"
  ).all();

  const ghostsRes = await env.DB.prepare(
    "SELECT id, user_id, owner_name, slot_num, badge, elo, kills, matches, wins, peak FROM ghosts ORDER BY elo DESC, kills DESC LIMIT 15"
  ).all();

  return jsonRes({
    ok: true,
    players: playersRes.results || [],
    ghosts: ghostsRes.results || [],
  });
}

/**
 * Selects up to 4 rival ghosts from D1 based on the requested game mode, then
 * hydrates each ghost's full neural/context model & trip templates from KV in parallel.
 * Modes:
 *   - 'mine'   : Practice against the logged-in user's own saved ghosts.
 *   - 'friend' : Challenge up to 4 ghosts belonging to a specific username.
 *   - 'ghost'  : Leaderboard revenge mode; guarantees target `ghostId` + up to 3
 *                teammates from the same owner, backfilled with random global ghosts.
 *   - 'others' : Standard ranked matchmaking against random ghosts from other users.
 */
async function handleMatch(request, env) {
  let body = {};
  try { body = await request.json(); } catch {}

  const user = await getAuthUser(request, env);
  const mode = body.mode || "others";
  let rows = [];

  if (mode === "mine") {
    if (!user) return jsonRes({ ok: true, ghosts: [] });
    const res = await env.DB.prepare(
      "SELECT * FROM ghosts WHERE user_id = ? ORDER BY elo DESC, id DESC LIMIT 4"
    ).bind(user.id).all();
    rows = res.results || [];
  } else if (mode === "friend") {
    const target = String(body.targetName || "").trim().toLowerCase();
    if (!target) return jsonRes({ ok: false, error: "Enter a player name" }, 400);
    const friend = await env.DB.prepare(
      "SELECT id, username FROM users WHERE username_lower = ?"
    ).bind(target).first();
    if (!friend) return jsonRes({ ok: false, error: "Player not found" }, 404);
    const res = await env.DB.prepare(
      "SELECT * FROM ghosts WHERE user_id = ? ORDER BY elo DESC, id DESC LIMIT 4"
    ).bind(friend.id).all();
    rows = res.results || [];
    if (!rows.length) {
      return jsonRes({ ok: false, error: friend.username + " has no saved ghosts yet" }, 404);
    }
  } else if (mode === "ghost") {
    const ghostId = Number(body.ghostId || 0);
    const primary = await env.DB.prepare("SELECT * FROM ghosts WHERE id = ?").bind(ghostId).first();
    if (!primary) return jsonRes({ ok: false, error: "Ghost not found" }, 404);
    rows.push(primary);
    const teammates = await env.DB.prepare(
      "SELECT * FROM ghosts WHERE user_id = ? AND id != ? ORDER BY elo DESC LIMIT 3"
    ).bind(primary.user_id, primary.id).all();
    rows = rows.concat(teammates.results || []);
    if (rows.length < 4) {
      const fillers = await env.DB.prepare(
        "SELECT * FROM ghosts WHERE id != ? AND user_id != ? ORDER BY RANDOM() LIMIT ?"
      ).bind(primary.id, primary.user_id, 4 - rows.length).all();
      rows = rows.concat(fillers.results || []);
    }
  } else {
    const excludeId = user ? user.id : -1;
    const res = await env.DB.prepare(
      "SELECT * FROM ghosts WHERE user_id != ? ORDER BY RANDOM() LIMIT 4"
    ).bind(excludeId).all();
    rows = res.results || [];
  }

  // Hydrate each ghost's behavioral brain & style DNA from KV in parallel
  // FIX RATIONALE [RULE-11]: Hydrate player-observed `maxHuntTrail`, `maxHomeIdle`, and `lateCaut`
  // from KV (with trait-proportional fallbacks for legacy ghosts) so tactical thresholds reflect
  // the individual player's round rather than fixed constants.
  const hydrated = await Promise.all(
    rows.map(async (r) => {
      let brain = null;
      try {
        brain = await env.KV.get(r.kv_key, "json");
      } catch {}
      const fallbackMaxHunt = Math.max(4, Math.round((1 - r.caut) * r.max_trail * 0.8 + r.aggr * 6));
      const fallbackAwareness = Math.min(0.95, (r.aggr + r.caut) * 0.6);
      const fallbackHomeIdle = Math.max(5, Math.round(18 - r.aggr * 10 - fallbackAwareness * 6));
      return {
        dbId: r.id,
        ownerId: r.user_id,
        ownerName: r.owner_name,
        slotNum: r.slot_num,
        badge: r.badge,
        elo: r.elo,
        peak: r.peak,
        aggr: r.aggr,
        caut: r.caut,
        lateCaut: brain?.lateCaut ?? r.caut,
        maxTrail: r.max_trail,
        earlyMaxTrail: brain?.earlyMaxTrail ?? Math.min(r.max_trail, 26),
        lateMaxTrail: brain?.lateMaxTrail ?? r.max_trail,
        maxHuntTrail: brain?.maxHuntTrail ?? fallbackMaxHunt,
        maxHomeIdle: brain?.maxHomeIdle ?? fallbackHomeIdle,
        wallPref: brain?.wallPref ?? 0.35,
        stealPref: brain?.stealPref ?? 0.3,
        spinBias: brain?.spinBias ?? 0,
        defendPref: brain?.defendPref ?? 0.5,
        uturnRate: brain?.uturnRate ?? 0.03,
        awareness: brain?.awareness ?? fallbackAwareness,
        model: brain?.model || null,
        trips: brain?.trips || null,
      };
    })
  );

  return jsonRes({ ok: true, ghosts: hydrated });
}

/**
 * Processes end-of-round results in 3 transactional steps:
 *   1. Updates ELO & match counters for each rival D1 ghost (when `ranked = true`,
 *      ignoring any ghost owned by the challenger to prevent self-boosting) and
 *      inserts an unseen `battle_logs` entry for each ghost's owner.
 *   2. Updates the authenticated player's ELO rating, peak territory, and career stats.
 *   3. [RULE-07] If the player made >= 40 decisions (`ns >= 40`) in THIS single round,
 *      saves their newly trained behavioral model & trips to KV and registers a new
 *      ghost slot in D1 (max 5 slots; evicts lowest-ELO unlocked ghost when full).
 */
async function handleReport(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonRes({ ok: false, error: "Invalid JSON" }, 400); }

  const user = await getAuthUser(request, env);
  const round = body.round || {};
  const opponents = Array.isArray(body.opponents) ? body.opponents : [];
  const ranked = Boolean(body.ranked);

  const peak = clampNum(round.peak, 0, 100, 0);
  const kills = Math.round(clampNum(round.kills, 0, 50, 0));
  const ns = Math.round(clampNum(round.ns, 0, 100000, 0));
  const won = Boolean(round.won);
  const aggr = Math.round(clampNum(round.aggr, 0.05, 0.95, 0.4) * 100) / 100;
  const caut = Math.round(clampNum(round.caut, 0.05, 0.95, 0.4) * 100) / 100;
  const lateCaut = Math.round(clampNum(round.lateCaut, 0.05, 0.96, caut) * 100) / 100;
  const maxTrail = Math.round(clampNum(round.maxTrail, 10, 80, 20));
  const earlyMaxTrail = Math.round(clampNum(round.earlyMaxTrail, 10, 72, Math.min(maxTrail, 24)));
  const lateMaxTrail = Math.round(clampNum(round.lateMaxTrail, 10, 80, maxTrail));
  const maxHuntTrail = Math.round(clampNum(round.maxHuntTrail, 2, 70, 6));
  const maxHomeIdle = Math.round(clampNum(round.maxHomeIdle, 4, 40, 10));
  const wallPref = Math.round(clampNum(round.wallPref, 0, 1, 0.35) * 100) / 100;
  const stealPref = Math.round(clampNum(round.stealPref, 0, 1, 0.3) * 100) / 100;
  const spinBias = Math.round(clampNum(round.spinBias, -1, 1, 0) * 100) / 100;
  const defendPref = Math.round(clampNum(round.defendPref, 0, 1, 0.5) * 100) / 100;
  const uturnRate = Math.round(clampNum(round.uturnRate, 0, 0.5, 0.03) * 1000) / 1000;
  const awareness = Math.round(clampNum(round.awareness, 0.05, 0.98, 0.5) * 100) / 100;

  const challengerName = user ? user.username : "Guest";
  const challengerElo = user ? user.elo : 1000;
  const challengerId = user ? user.id : -1;

  // Step 1: Update ELO ratings & offline battle logs for rival D1 ghosts
  let oppEloSum = 0, oppCount = 0;
  const eloUpdates = [];

  if (ranked) {
    for (const opp of opponents) {
      const dbId = Number(opp.dbId || 0);
      if (!dbId) continue;
      const gRow = await env.DB.prepare(
        "SELECT id, user_id, owner_name, slot_num, elo FROM ghosts WHERE id = ?"
      ).bind(dbId).first();
      if (!gRow || gRow.user_id === challengerId) continue;

      oppEloSum += gRow.elo;
      oppCount++;

      const killsByGhost = Math.round(clampNum(opp.killsOnPlayer, 0, 10, 0));
      const killedByPlayer = Math.round(clampNum(opp.killedByPlayer, 0, 10, 0));
      const oppPeak = clampNum(opp.peak, 0, 100, 0);

      // Performance score for ELO: 1.0 if ghost killed player, 0.75 if ghost out-peaked losing player, 0.0 if beaten
      let ghostScore = 0.4;
      if (killsByGhost > 0) ghostScore = 1.0;
      else if (!won && oppPeak > peak) ghostScore = 0.75;
      else if (won || killedByPlayer > 0) ghostScore = 0.0;

      const expectedGhost = 1 / (1 + Math.pow(10, (challengerElo - gRow.elo) / 400));
      let delta = Math.round(24 * (ghostScore - expectedGhost));
      delta = Math.max(-18, Math.min(24, delta));

      const newGhostElo = Math.max(100, gRow.elo + delta);
      const ghostWon = ghostScore >= 0.75 ? 1 : 0;

      await env.DB.prepare(
        "UPDATE ghosts SET elo = ?, kills = kills + ?, matches = matches + 1, wins = wins + ? WHERE id = ?"
      ).bind(newGhostElo, killsByGhost, ghostWon, gRow.id).run();

      const label = gRow.owner_name + "#" + gRow.slot_num;
      await env.DB.prepare(
        "INSERT INTO battle_logs (owner_user_id, ghost_label, challenger_name, ghost_kills, ghost_won, elo_delta, seen, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)"
      ).bind(gRow.user_id, label, challengerName, killsByGhost, ghostWon, delta, Date.now()).run();

      eloUpdates.push({ label, delta, newElo: newGhostElo });
    }
  }

  // Step 2: Update Player ELO & Career Stats (if logged in)
  let playerDelta = 0;
  let updatedUser = user;
  if (user) {
    if (ranked && oppCount > 0) {
      const avgOppElo = oppEloSum / oppCount;
      const expectedPlayer = 1 / (1 + Math.pow(10, (avgOppElo - user.elo) / 400));
      const playerScore = won ? 1.0 : Math.min(0.6, kills * 0.12);
      playerDelta = Math.round(26 * (playerScore - expectedPlayer));
      playerDelta = Math.max(-16, Math.min(28, playerDelta));
    }
    const newPlayerElo = Math.max(100, user.elo + playerDelta);
    const newPeak = Math.max(user.peak, peak);

    await env.DB.prepare(
      "UPDATE users SET elo = ?, peak = ?, kills = kills + ?, wins = wins + ?, games = games + 1 WHERE id = ?"
    ).bind(newPlayerElo, newPeak, kills, won ? 1 : 0, user.id).run();

    updatedUser = {
      ...user,
      elo: newPlayerElo,
      peak: newPeak,
      kills: user.kills + kills,
      wins: user.wins + (won ? 1 : 0),
      games: user.games + 1,
    };
  }

  // Step 3: Save Player's New Single-Round Ghost to D1 + KV (max 5 slots per user)
  let ghostSaved = false;
  let ghostMsg = "";
  const badge = classifyGhostBadge(aggr, caut, maxTrail, stealPref, wallPref, defendPref);

  if (user && ns >= 40 && round.model) {
    // Query ordered by `locked ASC, elo ASC` so the first row is the best candidate for eviction
    const existingRes = await env.DB.prepare(
      "SELECT id, slot_num, elo, locked, kv_key FROM ghosts WHERE user_id = ? ORDER BY locked ASC, elo ASC, id ASC"
    ).bind(user.id).all();
    const existingGhosts = existingRes.results || [];

    let slotNum = 1;
    let evicted = null;

    if (existingGhosts.length < 5) {
      const usedSlots = new Set(existingGhosts.map((g) => g.slot_num));
      while (usedSlots.has(slotNum) && slotNum <= 5) slotNum++;
    } else {
      evicted = existingGhosts.find((g) => g.locked === 0) || null;
      if (!evicted) {
        ghostMsg = "All 5 ghost slots are locked — unlock one to save new ghosts.";
      } else {
        slotNum = evicted.slot_num;
      }
    }

    if (existingGhosts.length < 5 || evicted) {
      if (evicted) {
        await env.DB.prepare("DELETE FROM ghosts WHERE id = ?").bind(evicted.id).run();
        try { await env.KV.delete(evicted.kv_key); } catch {}
      }
      const kvKey = "ghost:" + user.id + ":" + Date.now() + ":" + randomHex(4);
      // FIX RATIONALE [RULE-11]: Persist player-observed `lateCaut`, `maxHuntTrail`, and `maxHomeIdle`
      // inside KV brainPayload so each ghost replays its owner's exact hunting/idle/caution limits.
      const brainPayload = JSON.stringify({
        model: round.model,
        trips: Array.isArray(round.trips) ? round.trips.slice(0, 40) : [],
        earlyMaxTrail,
        lateMaxTrail,
        maxHuntTrail,
        maxHomeIdle,
        lateCaut,
        wallPref,
        stealPref,
        spinBias,
        defendPref,
        uturnRate,
        awareness,
      });

      await env.KV.put(kvKey, brainPayload);
      await env.DB.prepare(
        "INSERT INTO ghosts (user_id, owner_name, slot_num, badge, peak, aggr, caut, max_trail, elo, kills, matches, wins, locked, kv_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1000, 0, 0, 0, 0, ?, ?)"
      ).bind(user.id, user.username, slotNum, badge, peak, aggr, caut, maxTrail, kvKey, Date.now()).run();

      ghostSaved = true;
      ghostMsg = "Saved as " + user.username + "#" + slotNum + " (" + badge + ")";
    }
  } else if (!user && ns >= 40) {
    ghostMsg = "Style learned: " + badge + " — Login to save your ghost online!";
  }

  return jsonRes({
    ok: true,
    user: updatedUser,
    playerDelta,
    eloUpdates,
    ghostSaved,
    ghostMsg,
    badge,
  });
}

/**
 * Allows an authenticated user to toggle the protection lock (`locked = 0|1`)
 * or permanently delete one of their own ghost slots (cleaning up both D1 & KV).
 */
async function handleManageGhost(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return jsonRes({ ok: false, error: "Unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonRes({ ok: false, error: "Invalid JSON" }, 400); }

  const ghostId = Number(body.ghostId || 0);
  const action = body.action;

  const ghost = await env.DB.prepare(
    "SELECT id, user_id, locked, kv_key FROM ghosts WHERE id = ? AND user_id = ?"
  ).bind(ghostId, user.id).first();

  if (!ghost) return jsonRes({ ok: false, error: "Ghost not found" }, 404);

  if (action === "toggle_lock") {
    const nextLock = ghost.locked ? 0 : 1;
    await env.DB.prepare("UPDATE ghosts SET locked = ? WHERE id = ?").bind(nextLock, ghost.id).run();
    return jsonRes({ ok: true, locked: nextLock });
  } else if (action === "delete") {
    await env.DB.prepare("DELETE FROM ghosts WHERE id = ?").bind(ghost.id).run();
    try { await env.KV.delete(ghost.kv_key); } catch {}
    return jsonRes({ ok: true });
  }

  return jsonRes({ ok: false, error: "Unknown action" }, 400);
}


// ============================================================================
// CLIENT GAME HTML & ENGINE (MOBILE-FIRST PAPER.IO + DEEP BEHAVIORAL CLONING)
// [RULE-06] CRITICAL INVARIANT: Do NOT place any backtick character (`)
// anywhere inside this String.raw template literal.
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
  /* Full-viewport mobile-first layout; disables pull-to-refresh, text selection, and scrolling */
  html,body{margin:0;height:100%;width:100%;position:fixed;background:#0f1220;color:#e8ebff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden;overscroll-behavior:none;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
  #wrap{display:flex;flex-direction:column;height:100%;height:100dvh;box-sizing:border-box;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
  #hud{display:flex;gap:4px;padding:0 6px;font-size:11px;align-items:center;height:32px;flex:none;overflow:hidden}
  #chips{display:flex;gap:4px;flex-wrap:nowrap;overflow:hidden}
  .chip{padding:2px 6px;border-radius:10px;background:#1b2040;border-left:5px solid #fff;white-space:nowrap}
  .me{font-weight:700;background:#262d5a}
  #devHudBtn{margin-left:auto;flex:none;background:#1f332e;color:#59e0a0;border:1px solid #356357;border-radius:6px;font-size:11px;padding:2px 6px;min-height:22px;margin-top:0;margin-bottom:0}
  #time{margin-left:4px;flex:none;font-weight:700;color:#ff5d73;font-size:14px;letter-spacing:1px}
  #stage{flex:1;position:relative;min-height:0}
  canvas{position:absolute;left:0;top:0;width:100%;height:100%;background:#0a0b16}
  #ov{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,12,24,.88);text-align:center;padding:12px;box-sizing:border-box;z-index:10}
  #card{background:#1b2040;padding:18px 18px;border-radius:16px;max-width:380px;width:100%;max-height:94dvh;overflow-y:auto;box-sizing:border-box;line-height:1.4;font-size:13px;-webkit-overflow-scrolling:touch}
  #card h1{margin:0 0 4px;font-size:24px}
  #card h2{margin:0 0 6px;font-size:20px}
  .muted{opacity:.72;font-size:12px}
  .bar{display:flex;justify-content:space-between;align-items:center;background:#131730;padding:8px 10px;border-radius:10px;margin-bottom:10px;font-size:12px}
  .modes{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin:10px 0}
  .mbtn{background:#252c54;color:#cfd6ff;border:1px solid transparent;padding:8px 4px;border-radius:10px;font-size:12px;font-weight:600;margin:0;min-height:38px}
  .mbtn.on{background:#2c396e;border-color:#4da3ff;color:#fff}
  button{background:#4da3ff;color:#0f1220;border:0;padding:10px 18px;border-radius:10px;font-weight:700;font-size:15px;margin:8px 3px 0;min-height:42px;touch-action:manipulation;cursor:pointer}
  button.alt{background:#2a315c;color:#e8ebff;font-size:12px;padding:7px 12px;min-height:34px}
  button.sm{background:#2a315c;color:#e8ebff;font-size:11px;padding:4px 8px;min-height:28px;margin:0 2px}
  button.danger{background:#4d2336;color:#ff8fa0}
  button.dev{background:#263b36;color:#59e0a0;border:1px dashed #59e0a0;font-size:12px;padding:7px 12px;min-height:34px}
  button:disabled{opacity:.5}
  input{width:100%;box-sizing:border-box;background:#10142a;border:1px solid #323c73;color:#fff;padding:10px 12px;border-radius:10px;font-size:14px;margin:6px 0;-webkit-user-select:text;user-select:text}
  table{width:100%;border-collapse:collapse;margin:8px 0;font-size:12px}
  th{opacity:.65;font-weight:600;text-align:left;padding:4px;border-bottom:1px solid #2b3363}
  th:last-child{text-align:right}
  td{padding:5px 4px;text-align:left;border-bottom:1px solid rgba(255,255,255,.05)}
  td:last-child{text-align:right}
  .dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px}
  .report{background:#162836;border:1px solid #2e6f95;border-radius:10px;padding:8px 10px;margin:8px 0;text-align:left;font-size:12px}
  .dna{background:#131730;border:1px solid #2b3363;border-radius:10px;padding:7px 10px;margin:8px 0;font-size:11px;display:flex;justify-content:space-around;flex-wrap:wrap;gap:6px}
  .pos{color:#59e0a0;font-weight:700}
  .neg{color:#ff5d73;font-weight:700}
  .tabs{display:flex;gap:6px;margin:8px 0}
  .tabs button{flex:1;margin:0}
</style>
</head>
<body>
<div id="wrap">
  <div id="hud"><div id="chips"></div><button id="devHudBtn" title="Copy Dev Log">📋</button><div id="time"></div></div>
  <div id="stage"><canvas id="cv"></canvas></div>
</div>
<div id="ov"><div id="card"></div></div>

<script>
(function(){

// ============================================================================
// [SECTION 1] GAME CONFIGURATION & CONSTANTS
// Purpose: Centralizes core simulation constants, direction vectors, color
// palettes, tick frequency, and machine-learning confidence thresholds.
// ============================================================================
// Cardinal direction vectors: index 0=Right (+x), 1=Down (+y), 2=Left (-x), 3=Up (-y).
// Turning right (CW) is (d + 1) % 4; turning left (CCW) is (d + 3) % 4; U-turn is (d + 2) % 4.
var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

// Distinct neon palette for up to 7 entities; pre-parsed to RGB tuples for fast ImageData minimap writes
var COLORS = ['#4da3ff','#ff5d73','#ffc14d','#59e0a0','#c58bff','#ff8f5a','#5ad7e6'];
var CRGB = COLORS.map(function(h){ return [parseInt(h.substr(1,2),16), parseInt(h.substr(3,2),16), parseInt(h.substr(5,2),16)]; });
var WALL = '#ff2bd6', OUTSIDE = '#0a0b16', FLOOR = '#161a30';

var TICK_MS = 100;               // Fixed simulation step interval (100ms = 10 logic ticks/sec; decoupled from render FPS)
var LIVES = 3;                   // Total lives per round for the human player (rivals respawn indefinitely until out of room)
var MINS = 6;                    // Minimum observed samples in a context bucket before a ghost trusts that specific bucket
var KEY = 'ghostio_runs_v2';     // localStorage key storing offline/guest ghost models
var AUTH_KEY = 'ghostio_tok_v1'; // localStorage key storing persisted Bearer session token
var W = 80, H = 80, N = W * H;   // Arena grid dimensions (80x80 = 6,400 cells)


// ============================================================================
// [SECTION 2] GLOBAL GAME STATE, GRID BUFFERS & DIAGNOSTIC LOGGER
// Purpose: Holds mutable round state, flat TypedArray grid buffers for O(1)
// cell lookups, cloud session cache, and the persistent Dev Log system.
// ============================================================================
var cv = document.getElementById('cv'), ctx = cv.getContext('2d');
var chipsEl = document.getElementById('chips'), timeEl = document.getElementById('time');
var ov = document.getElementById('ov'), card = document.getElementById('card'), stage = document.getElementById('stage');

// Offscreen 80x80 1:1 pixel buffer for the minimap; updated via direct Uint8ClampedArray writes each tick
var mini = document.createElement('canvas'); mini.width = W; mini.height = H;
var mctx = mini.getContext('2d'), mimg = mctx.createImageData(W, H);

var owner;          // Uint8Array(6400): stores 1-based entity ID owning each cell (0 = neutral floor)
var trail;          // Uint8Array(6400): stores 1-based entity ID of active exposed trail in each cell (0 = none)
var ents = [];      // Active entity list; ents[0] is always the human player (id=1), ents[1..4] are AI ghosts/bots
var player = null;  // Direct pointer to ents[0]
var tick = 0;       // Monotonic simulation tick counter for the current round
var running = false;// True while the simulation & animation loop are active
var cell = 16;      // Dynamic pixel size of 1 grid cell, recalculated on viewport resize
var dpr = 1, cw = 0, ch = 0;
var q = [];         // Buffered turn queue (max 2 inputs) so rapid two-finger/quick swipes execute cleanly on consecutive ticks
var tripSum = 0, tripN = 0, trips = [];
var last = 0, acc = 0;
var toast = { msg: '', until: 0 };

// Cloud account & matchmaking session state
var authToken = '';
try { authToken = localStorage.getItem(AUTH_KEY) || ''; } catch(e) {}
var currentUser = null;     // Authenticated user object { id, username, elo, peak, kills, wins, games }
var myCloudGhosts = [];     // User's up-to-5 ghosts fetched from D1
var offlineReport = null;   // Unseen offline battle summary fetched on login/boot
var gameMode = 'others';    // Selected matchmaking mode: 'others' | 'mine' | 'friend' | 'ghost'
var friendQuery = '';       // Username entered in 'friend' challenge mode
var challengeGhostId = 0;   // Target ghost DB ID when challenging from Leaderboards
var lastMatchConfig = null; // Preserves match parameters for instant "Play again"

// [DEV-LOG START] [RULE-03] Comprehensive diagnostic ring-buffer logger
// FIX RATIONALE: Added persistent telemetry ring-buffer and instant HUD/modal copy
// buttons so mobile gameplay bugs (spinning, stalling, spawn failures) can be
// diagnosed from exact tick-by-tick logs without needing desktop DevTools.
var devLogs = [];
function dlog(msg){
  if (devLogs.length >= 800) devLogs.shift();
  devLogs.push('T' + tick + ' ' + msg);
}
function copyDevLog(btnEl){
  var text = '=== GHOST.IO DEV LOG (' + devLogs.length + ' entries) ===\n' + devLogs.join('\n');
  function done(){
    if (btnEl){
      var prev = btnEl.textContent;
      btnEl.textContent = btnEl.id === 'devHudBtn' ? '✅' : '✅ Copied! Paste in chat';
      setTimeout(function(){ if (btnEl) btnEl.textContent = prev; }, 1800);
    }
  }
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done).catch(fallbackCopy);
  } else {
    fallbackCopy();
  }
  // Fallback copy via hidden textarea for mobile WebViews that block async Clipboard API
  function fallbackCopy(){
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
    done();
  }
}
var devHudBtn = document.getElementById('devHudBtn');
if (devHudBtn){
  devHudBtn.addEventListener('touchstart', function(ev){ ev.stopPropagation(); }, { passive: true });
  devHudBtn.onclick = function(ev){ ev.stopPropagation(); copyDevLog(devHudBtn); };
}
// [DEV-LOG END]

// Shared utility helpers
function rnd(n){ return Math.floor(Math.random() * n); }
function byId(id){ return ents[id - 1]; }
function esc(s){
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


// ============================================================================
// [SECTION 3] API CLIENT, SESSION SYNC & LOCAL GHOST REPOSITORY
// Purpose: Wraps fetch() with automatic Bearer authentication, manages local
// offline fallback runs for guest users, and prunes low-confidence buckets
// before uploading trained behavioral models to Cloudflare KV.
// ============================================================================
function apiFetch(path, opts){
  opts = opts || {};
  var headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  return fetch(path, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).then(function(r){ return r.json(); });
}

function setToken(tok){
  authToken = tok || '';
  try {
    if (authToken) localStorage.setItem(AUTH_KEY, authToken);
    else localStorage.removeItem(AUTH_KEY);
  } catch(e) {}
}

function loadLocalRuns(){
  try {
    var r = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (r && r.runs) return r;
  } catch(e) {}
  return { n: 0, runs: [] };
}

function saveLocalRuns(r){
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch(e) {}
}

/**
 * Generates a simple procedural step-turn script for standard fallback BOT-N
 * entities when fewer than 4 real player ghosts are available.
 */
function genDefault(){
  var s = Math.random() < 0.5 ? 1 : 3, out = [];
  for (var i = 0; i < 40; i++){
    out.push([3 + rnd(7), Math.random() < 0.8 ? s : (s === 1 ? 3 : 1)]);
  }
  return out;
}

/**
 * Selects up to 4 local runs for Guest "My Ghosts" practice mode:
 * top 3 highest peak territory runs + the single most recent run.
 */
function pickLocalGhosts(store){
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

/**
 * Compresses a player's context-action table before KV serialization by
 * discarding fine-grained buckets with fewer than MINS (6) observations,
 * while always preserving level-4 ('40'/'41') global fallback buckets.
 */
function pruneModel(m){
  var o = {}, k, c;
  for (k in m){
    c = m[k];
    if (k.charAt(0) === '4' || c[0] + c[1] + c[2] + c[3] >= MINS) o[k] = c;
  }
  return o;
}

/**
 * Validates the stored Bearer token against '/api/me' and refreshes
 * 'currentUser', 'myCloudGhosts', and any unseen 'offlineReport'.
 */
function refreshSession(){
  if (!authToken){
    currentUser = null;
    myCloudGhosts = [];
    return Promise.resolve();
  }
  return apiFetch('/api/me').then(function(res){
    if (res && res.ok){
      currentUser = res.user;
      myCloudGhosts = res.ghosts || [];
      if (res.report) offlineReport = res.report;
    } else {
      setToken('');
      currentUser = null;
      myCloudGhosts = [];
    }
  }).catch(function(){});
}


// ============================================================================
// [SECTION 4] ENTITY MANAGEMENT, SPAWNING & ELIMINATION
// Purpose: Creates entity state objects, scans the 80x80 grid for safe empty
// 3x3 spawn locations away from rivals, and handles death/territory transfer.
// ============================================================================
function mk(id, name, isPlayer){
  return {
    id: id, name: name, isPlayer: isPlayer, color: COLORS[id - 1],
    // Grid coordinates: (x, y) is current cell; (px, py) is previous cell for smooth sub-tick rendering
    x: 0, y: 0, px: 0, py: 0, d: 0, alive: false,
    trail: [], exit: -1, respawn: 0, kills: 0, pct: 0, peak: 0, deaths: 0, wait: 0,
    // FIX RATIONALE [RULE-11]: Stores the killer's display name, color, and kill cause so the
    // death countdown overlay and final game-over summary can show who eliminated the player.
    lastKiller: '', lastKillerColor: '#ff5d73', lastKillCause: '',
    // Cloud metadata & combat telemetry for ELO calculation:
    dbId: 0, badge: '', elo: 1000, killsOnPlayer: 0, killedByPlayer: 0,
    // Behavioral Cloning DNA traits (loaded from KV for ghosts, or default for bots):
    // FIX RATIONALE [RULE-11]: Added player-learned `maxHuntTrail`, `maxHomeIdle`, and `lateCaut`
    // so ghosts inherit their owner's exact hunting trail tolerance, home-exit pacing, and late-game caution.
    script: null, si: 0, sc: 0, maxTrail: 20, earlyMaxTrail: 20, lateMaxTrail: 20,
    maxHuntTrail: 6, maxHomeIdle: 10, aggr: 0.4, caut: 0.3, lateCaut: 0.3,
    wallPref: 0.35, stealPref: 0.3, spinBias: 0, defendPref: 0.5, uturnRate: 0.03, awareness: 0.5,
    // Real-time single-round player telemetry accumulators (recorded only when isPlayer === true):
    idle: 0, goal: -1, since: 0, pend: -1, model: null, ns: 0,
    chT: 0, chA: 0, fT: 0, fA: 0, lateFT: 0, lateFA: 0,
    wallTicks: 0, totalTicks: 0, stealSteps: 0, neutralSteps: 0,
    rightTurns: 0, leftTurns: 0, uturns: 0, defT: 0, defA: 0,
    maxObservedHuntTrail: 0, curHomeIdle: 0, maxObservedIdle: 0,
    // FIX RATIONALE [RULE-08] & [RULE-09]: Tracks overall max observed trail plus
    // early-round (<20% land) vs late-round (>=20% land) trail peaks so ghosts mirror
    // how the player scales loop size as they gain map control.
    maxObservedTrail: 0, earlyObservedTrail: 0, lateObservedTrail: 0,
    // Geometric loop ("trip") recorder & playback state:
    trips: null, tpl: null, tplAway: 1, tplMirror: false, ti: 0, tc: 0, ret: false, tripOn: false,
    tseg: [], tp0: 0, tlist: [], tHunt: false, tripWall: 0, tripSteal: 0, tripSteps: 0, tripAway: 1,
    // FIX RATIONALE: Tracks last turn action chosen by policy() inside home land to prevent 2x2 self-loops
    lastPolicyAct: 0,
    // [DEV-LOG START] Per-entity diagnostic state trackers
    turnHist: [], lastReason: 'init', prevReason: 'init', spinWarnedTick: -99, wallStall: 0
    // [DEV-LOG END]
  };
}

/**
 * Scans the arena for candidate spawn centers (x, y) where:
 *   1. A (2*rad + 1)^2 square around (x, y) has zero owned cells and zero trails.
 *   2. Every living rival head is at least 'dist' Manhattan tiles away.
 */
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

/**
 * Spawns entity 'e' with a 3x3 home territory block and orients its initial
 * heading inward toward the center of the arena so it doesn't immediately hit a wall.
 */
function spawn(e, force){
  var x, y, s, spots = findSpots(e, 4, 24);
  if (!spots.length && e.isPlayer) spots = findSpots(e, 2, 8);
  if (spots.length){ s = spots[rnd(spots.length)]; x = s % W; y = (s / W) | 0; }
  else if (force){ x = 4 + rnd(W - 8); y = 4 + rnd(H - 8); }
  else return false;

  for (var dy2 = -1; dy2 <= 1; dy2++) for (var dx2 = -1; dx2 <= 1; dx2++) {
    owner[(y + dy2) * W + (x + dx2)] = e.id;
  }
  e.x = x; e.y = y; e.px = x; e.py = y; e.alive = true; e.born = tick;
  e.trail = []; e.pend = -1; e.since = 0; e.exit = -1; e.idle = 0; e.goal = -1;
  e.tripOn = false; e.tpl = null; e.ret = false; e.lastPolicyAct = 0;
  e.turnHist = []; e.wallStall = 0; e.prevReason = 'spawn';
  var cx = W / 2, cy = H / 2;
  e.d = (Math.abs(cx - x) > Math.abs(cy - y)) ? (x < cx ? 0 : 2) : (y < cy ? 1 : 3);
  // [DEV-LOG START]
  if (tick > 0) dlog('[SPAWN] ' + e.name + ' at (' + x + ',' + y + ') d=' + e.d);
  // [DEV-LOG END]
  return true;
}

/**
 * Eliminates entity 'e', clears its exposed trail, transfers all of its owned
 * territory to killer 'by' (or neutral 0 on tie/0%-land), updates ELO kill
 * counters, and schedules respawn after 30 ticks (3 seconds).
 */
function kill(e, by, cause){
  if (!e.alive) return;
  var tLen = e.trail.length;
  e.alive = false;
  for (var k = 0; k < tLen; k++) trail[e.trail[k]] = 0;
  e.trail = []; e.pend = -1; e.tripOn = false; e.deaths++;

  // FIX RATIONALE [RULE-11]: Record killer metadata on player death for the countdown overlay
  // and track the human player's exposed trail length when scoring a kill.
  if (e.isPlayer){
    e.lastKiller = by ? by.name : '';
    e.lastKillerColor = by ? by.color : '#ff5d73';
    e.lastKillCause = !cause ? 'trail cut' :
                      cause === 'trail-cut' ? 'trail cut' :
                      cause.indexOf('head-on') === 0 ? 'head-on' : cause;
  }
  if (by && by.isPlayer){
    var killerTrail = by.trail.length + (by.pend >= 0 ? 1 : 0);
    if (killerTrail > by.maxObservedHuntTrail) by.maxObservedHuntTrail = killerTrail;
  }

  if (e.isPlayer && by && !by.isPlayer) by.killsOnPlayer = (by.killsOnPlayer || 0) + 1;
  if (!e.isPlayer && by && by.isPlayer) e.killedByPlayer = (e.killedByPlayer || 0) + 1;

  var to = (by && by.alive) ? by.id : 0, moved = 0;
  for (var i = 0; i < N; i++) if (owner[i] === e.id){ owner[i] = to; moved++; }
  var gainPct = (moved * 100 / N).toFixed(1);

  // [DEV-LOG START]
  dlog('[KILL] ' + e.name + ' killed by ' + (by ? by.name : '0%-land') +
       ' cause=' + (cause || 'trail-cut') + ' at (' + e.x + ',' + e.y + ') trailLen=' + tLen + ' land=' + gainPct + '%');
  // [DEV-LOG END]

  if (to && by.isPlayer){
    toast.msg = '+' + gainPct + '% from ' + e.name;
    toast.until = tick + 25;
  }
  e.respawn = tick + 30; e.wait = 0;
  if (e.isPlayer && navigator.vibrate) navigator.vibrate(80);
}


// ============================================================================
// [SECTION 5] GAME RULES, PHYSICS & TERRITORY FLOOD-FILL ENGINE
// Purpose: Executes deterministic grid movement, deferred trail placement,
// exterior boundary flood-fill for loop enclosures, and head-on collisions.
// ============================================================================

/**
 * Flood-fills from all 4 outer arena borders across cells NOT owned by 'id'.
 * Any unvisited cell after the traversal is completely enclosed by 'id's
 * border and is converted to owner[j] = id. Returns count of newly enclosed cells.
 */
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
  var enclosed = 0;
  for (var j = 0; j < N; j++) if (!seen[j] && owner[j] !== id){ owner[j] = id; enclosed++; }
  return enclosed;
}

/**
 * Converts an entity's completed trail into owned territory and invokes fill()
 * to claim any interior area enclosed by the loop.
 */
function closeLoop(e){
  var tLen = e.trail.length;
  var prevPct = e.pct;
  if (e.isPlayer){ tripSum += tLen; tripN++; trips.push(tLen); }
  for (var k = 0; k < tLen; k++){ owner[e.trail[k]] = e.id; trail[e.trail[k]] = 0; }
  e.trail = [];
  var enclosed = fill(e.id);
  // [DEV-LOG START]
  var totalCells = tLen + enclosed;
  var gainPct = (totalCells * 100 / N).toFixed(1);
  if (tLen >= 4) dlog('[LOOP] ' + e.name + ' trail=' + tLen + ' enclosed=' + enclosed + ' (+' + gainPct + '% from ' + prevPct.toFixed(1) + '%)');
  // [DEV-LOG END]
}

/**
 * Commits the previous tick's pending trail cell (e.pend) onto the 'trail' grid.
 * FIX RATIONALE: Deferred by 1 tick so an entity stepping onto an unowned tile
 * occupies it with its head first; the trail segment behind it only materializes
 * once the head advances out of that cell (unless blocked by the outer arena wall).
 */
function commit(){
  for (var i = 0; i < ents.length; i++){
    var e = ents[i];
    if (!e.alive || e.pend < 0) continue;
    var nx = e.x + DX[e.d], ny = e.y + DY[e.d];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    trail[e.pend] = e.id; e.trail.push(e.pend); e.pend = -1;
  }
}

/**
 * Advances entity 'e' by 1 cell in direction 'e.d'.
 * Clamps at arena walls (surviving without dying, matching Paper.io rules),
 * cuts any rival trail stepped onto, closes loops upon re-entering home land,
 * or stages 'e.pend' when venturing outside home land.
 */
function move(e){
  if (!e.alive) return;
  var ox = e.x, oy = e.y, nx = ox + DX[e.d], ny = oy + DY[e.d];
  if (nx < 0 || ny < 0 || nx >= W || ny >= H){
    e.px = ox; e.py = oy;
    // [DEV-LOG START]
    e.wallStall++;
    if (e.wallStall === 3) dlog('[WALL-STALL] ' + e.name + ' hitting border at (' + ox + ',' + oy + ') d=' + e.d + ' reason=' + e.lastReason);
    // [DEV-LOG END]
    return;
  }
  e.wallStall = 0;
  var i = ny * W + nx, t = trail[i];
  if (t && t !== e.id){ kill(byId(t), e, 'trail-cut'); e.kills++; }
  e.px = ox; e.py = oy; e.x = nx; e.y = ny;
  if (owner[i] === e.id){
    if (e.trail.length) closeLoop(e);
  } else if (t !== e.id){
    if (!e.trail.length) e.exit = oy * W + ox;
    e.pend = i;
  }
}

/**
 * Resolves head-on collisions (two heads entering the same cell OR swapping cells)
 * BEFORE commit() and move(). The entity with larger territory % wins;
 * an exact tie eliminates both entities.
 */
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
      if (a.pct > b.pct){ kill(b, a, 'head-on(' + a.pct.toFixed(1) + '>' + b.pct.toFixed(1) + ')'); a.kills++; }
      else if (b.pct > a.pct){ kill(a, b, 'head-on(' + b.pct.toFixed(1) + '>' + a.pct.toFixed(1) + ')'); b.kills++; }
      else { kill(a, null, 'head-on-tie'); kill(b, null, 'head-on-tie'); }
    }
  }
}

/**
 * Recalculates live territory percentages for all entities and eliminates
 * any living entity whose territory was completely swallowed (c[e.id] === 0).
 */
function recount(){
  var c = new Array(ents.length + 1), i;
  for (i = 0; i < c.length; i++) c[i] = 0;
  for (i = 0; i < N; i++) if (owner[i]) c[owner[i]]++;
  for (i = 0; i < ents.length; i++){
    var e = ents[i];
    e.pct = c[e.id] * 100 / N;
    if (e.pct > e.peak) e.peak = e.pct;
    if (e.alive && c[e.id] === 0 && tick > 3) kill(e, null, '0%-land');
  }
}


// ============================================================================
// [SECTION 6] DEEP PLAYER BEHAVIOR LEARNING (STYLE DNA + CONTEXT CLONING)
// Purpose: Passively observes every human player tick within a SINGLE round
// ([RULE-07]) to extract:
//   1. A 5-level hierarchical context-action frequency table (ctxKeys) using
//      egocentric relative coordinates so learned habits generalize to any heading.
//   2. Geometric loop templates (tripTrack / keepTrips) capturing full return
//      legs and outward vs inward turn orientation.
//   3. Continuous behavioral DNA traits (aggr, caut, lateCaut, wallPref, stealPref,
//      spinBias, defendPref, uturnRate, awareness, maxHuntTrail, maxHomeIdle)
//      plus phase-scaled loop limits.
// ============================================================================

/**
 * Projects world-space vector (dx, dy) into entity 'e's egocentric frame:
 * returns 0 (ahead), 1 (right), 2 (behind), or 3 (left).
 */
function sector(e, dx, dy){
  var f = dx * DX[e.d] + dy * DY[e.d], r = dx * DX[(e.d + 1) % 4] + dy * DY[(e.d + 1) % 4];
  return Math.abs(f) >= Math.abs(r) ? (f > 0 ? 0 : 2) : (r > 0 ? 1 : 3);
}

/**
 * Computes minimum Manhattan distance from any living enemy head to either
 * entity 'e's head or any cell of 'e's exposed trail.
 */
function minEnemyDistToTrail(e){
  var bd = 99, n, o, k, d, ti;
  for (n = 0; n < ents.length; n++){
    o = ents[n];
    if (o === e || !o.alive) continue;
    d = Math.abs(o.x - e.x) + Math.abs(o.y - e.y);
    if (d < bd) bd = d;
    for (k = 0; k < e.trail.length; k++){
      ti = e.trail[k];
      d = Math.abs(o.x - (ti % W)) + Math.abs(o.y - ((ti / W) | 0));
      if (d < bd) bd = d;
    }
  }
  return bd;
}

/**
 * Builds a 5-level hierarchical array of context keys (from ultra-specific level 0
 * down to coarse level 4) representing the entity's immediate tactical state.
 * FIX RATIONALE [RULE-09]: Uses nearestOwn(e) instead of e.exit for the home
 * return sector 'hs' and home distance 'hd', and encodes territory phase (pctPhase)
 * so the ghost accurately mirrors how the player closes loops toward the nearest
 * border and scales aggression/loop size from early game to late game.
 */
function ctxKeys(e){
  var cellIdx = e.y * W + e.x;
  var home = owner[cellIdx] === e.id;
  var onEnemy = (!home && owner[cellIdx] > 0) ? 1 : 0;
  var len = e.trail.length + (e.pend >= 0 ? 1 : 0);
  var lb = home ? 0 : len <= 2 ? 1 : len <= 6 ? 2 : len <= 12 ? 3 : len <= 20 ? 4 : len <= 30 ? 5 : 6;
  var nearCell = !home ? nearestOwn(e) : -1;
  var hs = nearCell >= 0 ? sector(e, (nearCell % W) - e.x, ((nearCell / W) | 0) - e.y) : 0;
  var pctPhase = e.pct < 15 ? 0 : e.pct < 40 ? 1 : 2;

  var wallDist = Math.min(e.x, W - 1 - e.x, e.y, H - 1 - e.y);
  var nearWall = wallDist <= 3 ? 1 : 0;
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

  var td = home ? 99 : minEnemyDistToTrail(e);
  var hd = nearCell >= 0 ? (Math.abs((nearCell % W) - e.x) + Math.abs(((nearCell / W) | 0) - e.y)) : 0;
  var danger = (!home && td <= hd + 1 && td <= 7) ? 2 : (!home && td <= 5) ? 1 : 0;

  var thr = bd > 8 ? 0 : 1 + kind * 8 + (bd <= 3 ? 0 : 4) + sector(e, sx - e.x, sy - e.y), tp = thr ? 1 : 0;
  var s = e.since, rb = s <= 1 ? 0 : s <= 4 ? s - 1 : s <= 6 ? 4 : s <= 8 ? 5 : s <= 11 ? 6 : s <= 15 ? 7 : s <= 22 ? 8 : 9;

  return [
    '0' + lb + hs + wl + danger + onEnemy + pctPhase + thr.toString(36) + rb,
    '1' + lb + hs + danger + nearWall + pctPhase + rb,
    '2' + lb + hs + tp + danger,
    '3' + lb + rb,
    '4' + (lb ? 1 : 0)
  ];
}

/**
 * Increments action counts [straight, right, uturn, left] across all 5 context
 * specificity levels for the player's current decision 'act'.
 */
function learn(p, act){
  var ks = ctxKeys(p), m = p.model, k, l;
  for (l = 0; l < ks.length; l++){ k = ks[l]; (m[k] || (m[k] = [0, 0, 0, 0]))[act]++; }
  p.ns++;
  if (act === 1) p.rightTurns++;
  else if (act === 3) p.leftTurns++;
  else if (act === 2) p.uturns++;
}

/**
 * Records complete non-combat expansion excursions outside home territory as
 * relative [stepCount, relativeTurn] sequences so cloned ghosts can replay
 * the player's signature geometric loop shapes.
 * FIX RATIONALE [RULE-11]: Records whether the player's first turn turned outward
 * away from home (`away`) and pushes the final return leg `[p.tc, 0]` when closing
 * the loop so ghosts complete the full rectangular shape rather than cutting short.
 */
function tripTrack(p, rel){
  var cellIdx = p.y * W + p.x;
  var out = owner[cellIdx] !== p.id;
  if (out){
    if (!p.tripOn){
      p.tripOn = true; p.tseg = []; p.tc = 0; p.tp0 = p.pct; p.tHunt = false;
      p.tripWall = (Math.min(p.x, W - 1 - p.x, p.y, H - 1 - p.y) <= 4) ? 1 : 0;
      p.tripSteal = 0; p.tripSteps = 0; p.tripAway = 1;
    }
    p.tc++;
    p.tripSteps++;
    if (owner[cellIdx] > 0) p.tripSteal++;
    if (rel > 0){
      if (p.tseg.length === 0){
        var turnDir = (p.d + rel) % 4;
        var hc = nearestOwn(p);
        if (hc >= 0){
          var hx = hc % W, hy = (hc / W) | 0;
          var dCur = Math.abs(hx - p.x) + Math.abs(hy - p.y);
          var dNext = Math.abs(hx - (p.x + DX[turnDir])) + Math.abs(hy - (p.y + DY[turnDir]));
          p.tripAway = dNext >= dCur ? 1 : 0;
        }
      }
      p.tseg.push([Math.min(p.tc, 40), rel]);
      p.tc = 0;
    }
  } else if (p.tripOn){
    p.tripOn = false;
    if (p.tseg.length && p.tseg.length <= 12 && !p.tHunt){
      if (p.tc > 0) p.tseg.push([Math.min(p.tc, 40), 0]);
      var gain = Math.max(0, Math.round((p.pct - p.tp0) * N / 100));
      var steps = Math.max(1, p.tripSteps);
      var eff = Math.round((gain / steps) * 10) / 10;
      p.tlist.push({ g: gain, eff: eff, w: p.tripWall, st: p.tripSteal, away: p.tripAway, s: p.tseg });
    }
  }
}

/**
 * Retains a faithful representative sample (up to 40 trips) across the entire
 * single round without cherry-picking only high-gain loops.
 * FIX RATIONALE [RULE-10]: Previously sorted trips by highest (gain + eff * 6),
 * which discarded a cautious or beginner player's small/modest loops and made
 * their ghost play more ambitiously than the player actually did. Now uniformly
 * samples across the player's chronological trip list so loop sizes match reality.
 */
function keepTrips(list){
  if (list.length <= 40) return list.slice();
  var out = [], step = list.length / 40;
  for (var i = 0; i < 40; i++){
    out.push(list[Math.floor(i * step)]);
  }
  return out;
}

/**
 * Accumulates continuous behavioral telemetry on every tick to estimate the
 * player's high-level traits: Aggression (chT/chA), Caution (fT/fA & lateFT/lateFA),
 * Wall Preference, Steal Preference, Home Defense (defT/defA), max hunting trail
 * length (maxObservedHuntTrail), home-idle pacing (maxObservedIdle), and phase-scaled
 * trail lengths (earlyObservedTrail vs lateObservedTrail).
 */
function track(p){
  var cellIdx = p.y * W + p.x;
  var out = owner[cellIdx] !== p.id;
  var curTrail = p.trail.length + (p.pend >= 0 ? 1 : 0);
  if (curTrail > p.maxObservedTrail) p.maxObservedTrail = curTrail;
  if (p.pct < 20){
    if (curTrail > p.earlyObservedTrail) p.earlyObservedTrail = curTrail;
  } else {
    if (curTrail > p.lateObservedTrail) p.lateObservedTrail = curTrail;
  }

  // FIX RATIONALE [RULE-11]: Track how long the human player stays inside home territory
  // between loops so their ghost learns their natural home-exit tempo instead of a fixed timer.
  if (!out && curTrail === 0){
    p.curHomeIdle++;
    if (p.curHomeIdle > p.maxObservedIdle) p.maxObservedIdle = p.curHomeIdle;
  } else {
    p.curHomeIdle = 0;
  }

  p.totalTicks++;
  if (Math.min(p.x, W - 1 - p.x, p.y, H - 1 - p.y) <= 4) p.wallTicks++;
  if (out){
    if (owner[cellIdx] > 0) p.stealSteps++;
    else p.neutralSteps++;
  }

  // Measure Aggression & Max Hunting Trail: when within 10 tiles of a rival trail, does player close distance?
  var bd = 11, tx = 0, ty = 0, i, k, o, d;
  for (i = 0; i < ents.length; i++){
    o = ents[i]; if (o === p || !o.alive) continue;
    for (k = 0; k < o.trail.length; k++){
      d = Math.abs(o.trail[k] % W - p.x) + Math.abs(((o.trail[k] / W) | 0) - p.y);
      if (d < bd){ bd = d; tx = o.trail[k] % W; ty = (o.trail[k] / W) | 0; }
    }
  }
  if (bd <= 10){
    if (Math.abs(tx - p.x - DX[p.d]) + Math.abs(ty - p.y - DY[p.d]) < bd){
      p.chT++;
      if (curTrail > p.maxObservedHuntTrail) p.maxObservedHuntTrail = curTrail;
    } else {
      p.chA++;
    }
    p.tHunt = true;
  }

  // Measure Caution (overall + late-game when holding >= 30% land)
  if (curTrail >= 4 && headNear(p)){
    var n = nearestOwn(p);
    if (n >= 0){
      d = Math.abs(n % W - p.x) + Math.abs(((n / W) | 0) - p.y);
      var retreated = Math.abs(n % W - p.x - DX[p.d]) + Math.abs(((n / W) | 0) - p.y - DY[p.d]) < d;
      if (retreated){
        p.fT++;
        if (p.pct >= 30) p.lateFT++;
      } else {
        p.fA++;
        if (p.pct >= 30) p.lateFA++;
      }
    }
  }

  // Measure Home Defense: when a rival is actively carving inside player's land, does player intercept?
  for (i = 0; i < ents.length; i++){
    o = ents[i];
    if (o === p || !o.alive || !o.trail.length) continue;
    if (owner[o.y * W + o.x] === p.id){
      var distBefore = Math.abs(o.x - p.x) + Math.abs(o.y - p.y);
      if (distBefore <= 14){
        var distAfter = Math.abs(o.x - (p.x + DX[p.d])) + Math.abs(o.y - (p.y + DY[p.d]));
        if (distAfter < distBefore) p.defT++; else p.defA++;
      }
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
// [SECTION 7] TACTICAL GHOST AI & STYLE-MATCHED PATHFINDING
// Purpose: Drives autonomous AI ghosts strictly through the human player's
// learned behavioral parameters ([RULE-08], [RULE-10], [RULE-11]) — without
// hardcoded "smartness" overrides that make all ghosts play identically.
// ============================================================================
function safe(e, c){
  var nx = e.x + DX[c], ny = e.y + DY[c];
  return nx >= 0 && ny >= 0 && nx < W && ny < H;
}

function okCell(e, c){
  var nx = e.x + DX[c], ny = e.y + DY[c];
  return nx >= 0 && ny >= 0 && nx < W && ny < H && trail[ny * W + nx] !== e.id;
}

/**
 * Greedy Manhattan router toward cell index 't' with full 180-degree U-turn support.
 * FIX RATIONALE [RULE-09]: Previously goTo() only considered [d, (d+1)%4, (d+3)%4]
 * and excluded (d+2)%4 (180-degree U-turn), causing Boo#2 on the top wall (y=0)
 * with its trail at y=1 to walk 122 tiles around the perimeter instead of U-turning
 * 180 degrees back to its territory. Now:
 *   1. When target 't' is directly behind (rem <= 0 && side === 0), allows immediate
 *      180-degree U-turn (d + 2) % 4 (since stepping on own trail is safe in Ghost.io).
 *   2. Evaluates all 4 directions (0, 1, 2, 3) with only a tiny own-trail preference
 *      when NOT retreating (!e.ret), so retreating ghosts freely double back 180°
 *      along their trail to reach safety.
 */
function goTo(e, t){
  var tx = t % W, ty = (t / W) | 0, best = -1, bs = 1e9, k, c, nx, ny, sc, d = e.d, ex = tx - e.x, ey = ty - e.y;
  var rem = (d % 2 === 0) ? ex * DX[d] : ey * DY[d];
  var side = (d % 2 === 0) ? ey : ex;
  if (rem > 0 && okCell(e, d)) return d;
  if (rem <= 0 && side === 0){
    var uDir = (d + 2) % 4;
    if (safe(e, uDir)) return uDir;
  }
  if (rem <= 0 && side !== 0){
    c = (d % 2 === 0) ? (side > 0 ? 1 : 3) : (side > 0 ? 0 : 2);
    if (okCell(e, c)) return c;
  }
  for (k = 0; k < 4; k++){
    c = (e.d + k) % 4;
    nx = e.x + DX[c]; ny = e.y + DY[c];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    var wrongWayPen = (k === 0 && rem <= 0) ? 2.5 : (k ? 0.4 : 0);
    var ownTrailPen = (!e.ret && trail[ny * W + nx] === e.id) ? 1.5 : 0;
    sc = Math.abs(tx - nx) + Math.abs(ty - ny) + ownTrailPen + wrongWayPen;
    if (sc < bs){ bs = sc; best = c; }
  }
  return best;
}

function nearestOwn(e){
  var best = -1, bd = 1e9, i, d;
  for (i = 0; i < N; i++){
    if (owner[i] !== e.id) continue;
    d = Math.abs(i % W - e.x) + Math.abs(((i / W) | 0) - e.y);
    if (d < bd){ bd = d; best = i; }
  }
  return best;
}

/**
 * Selects a home territory cell to retreat to, scaling enemy-avoidance
 * awareness by e.awareness (so attentive players pick unguarded return borders
 * while oblivious players simply head to the nearest home tile).
 */
function safestOwn(e){
  var aw = e.awareness != null ? e.awareness : 0.5;
  if (aw < 0.25) return nearestOwn(e);
  var best = -1, bs = 1e9, i, cx, cy, mx, my, d, n, o, ed, md, pen;
  for (i = 0; i < N; i++){
    if (owner[i] !== e.id) continue;
    cx = i % W; cy = (i / W) | 0;
    d = Math.abs(cx - e.x) + Math.abs(cy - e.y);
    mx = (cx + e.x) >> 1; my = (cy + e.y) >> 1;
    pen = 0;
    for (n = 0; n < ents.length; n++){
      o = ents[n];
      if (o === e || !o.alive) continue;
      ed = Math.abs(o.x - cx) + Math.abs(o.y - cy);
      if (ed <= 4) pen += (5 - ed) * 4 * aw;
      md = Math.abs(o.x - mx) + Math.abs(o.y - my);
      if (md <= 3) pen += (4 - md) * 5 * aw;
    }
    if (d + pen < bs){ bs = d + pen; best = i; }
  }
  return best >= 0 ? best : nearestOwn(e);
}

/**
 * Samples a recorded player loop template (e.trips) weighted proportionally to
 * the actual enclosed cell gain (g) achieved by the player in that round and
 * matching wall-proximity context (nearWall), returning `{ s, away }`.
 * FIX RATIONALE [RULE-11]: Previously gave 0-cell accidental border slips the same
 * sampling weight as 300-cell rectangular loops. Weighting by `(1 + Math.sqrt(g))`
 * reflects the player's actual loop distribution (small if player only made small loops;
 * substantial if player regularly closed large rectangles) without hardcoded thresholds.
 */
function pickTrip(e){
  var list = e.trips;
  var nearWall = (Math.min(e.x, W - 1 - e.x, e.y, H - 1 - e.y) <= 4) ? 1 : 0;
  var tot = 0, i, r, w, gainW;
  for (i = 0; i < list.length; i++){
    gainW = 1 + Math.sqrt(Math.max(0, list[i].g || 0));
    w = gainW * ((list[i].w === nearWall) ? 1.6 : 0.8);
    tot += w;
  }
  r = Math.random() * tot;
  for (i = 0; i < list.length; i++){
    gainW = 1 + Math.sqrt(Math.max(0, list[i].g || 0));
    w = gainW * ((list[i].w === nearWall) ? 1.6 : 0.8);
    r -= w;
    if (r < 0) return { s: list[i].s, away: list[i].away != null ? list[i].away : 1 };
  }
  return { s: list[0].s, away: list[0].away != null ? list[0].away : 1 };
}

/**
 * Scans for exposed rival trails within 'e's learned aggression range.
 * Passive/non-aggressive players (e.aggr < 0.2) rarely hunt unless a rival
 * is literally 1-2 tiles in front of them; hunters pursue up to 11 tiles.
 */
function hunt(e){
  if (tick - e.born < 25) return -1;
  var baseRange = Math.max(2, Math.floor(e.aggr * 11));
  var best = -1, bestScore = 1e9;
  for (var n = 0; n < ents.length; n++){
    var o = ents[n];
    if (o === e || !o.alive || !o.trail.length) continue;
    var trespassing = (owner[o.y * W + o.x] === e.id);
    var range = trespassing ? Math.round(baseRange + (e.defendPref || 0.5) * 6) : baseRange;
    var rivalHome = nearestOwn(o);
    var rivalHomeDist = rivalHome >= 0 ? (Math.abs((rivalHome % W) - o.x) + Math.abs(((rivalHome / W) | 0) - o.y)) : 10;

    for (var k = 0; k < o.trail.length; k++){
      var idx = o.trail[k];
      var d = Math.abs((idx % W) - e.x) + Math.abs(((idx / W) | 0) - e.y);
      if (d <= range && (e.aggr < 0.45 || d <= rivalHomeDist + 3)){
        var score = d - (trespassing ? 3.5 : 0);
        if (score < bestScore){ bestScore = score; best = idx; }
      }
    }
  }
  return best;
}

/**
 * Frontier-aware expansion goal selector.
 * FIX RATIONALE [RULE-11]: Previously sampled only 80 global random cells up to 48
 * tiles away, causing ghosts holding 15-75% territory to spend 35+ ticks walking inside
 * their own interior (`[LONG-IDLE]`). Now scans nearby frontier cells within 18 tiles
 * of `(e.x, e.y)` plus global candidates, preferring unowned frontier tiles adjacent
 * (`adjOwn`) to `e`'s border while scoring by `e.wallPref` and `e.stealPref`.
 */
function pickGoal(e){
  var best = -1, bestScore = -1e9;
  var wantWall = e.wallPref != null ? e.wallPref : 0.35;
  var wantSteal = e.stealPref != null ? e.stealPref : 0.3;

  function evalCandidate(i){
    var x = i % W, y = (i / W) | 0;
    if (owner[i] === e.id || x <= 1 || y <= 1 || x >= W - 2 || y >= H - 2) return;
    var adjOwn = (x > 0 && owner[i - 1] === e.id) ||
                 (x < W - 1 && owner[i + 1] === e.id) ||
                 (y > 0 && owner[i - W] === e.id) ||
                 (y < H - 1 && owner[i + W] === e.id);
    var dist = Math.abs(x - e.x) + Math.abs(y - e.y);
    if (dist < 1 || dist > 48) return;

    var wd = Math.min(x, W - 1 - x, y, H - 1 - y);
    var isEdge = wd <= 5 ? 1 : 0;
    var isRival = owner[i] > 0 ? 1 : 0;
    var sc = (adjOwn ? 24 : 0) +
             (isEdge ? wantWall * 14 : (1 - wantWall) * 8) +
             (isRival ? wantSteal * 14 : (1 - wantSteal) * 6) -
             dist * 0.55 + Math.random() * 4;
    if (sc > bestScore){ bestScore = sc; best = i; }
  }

  for (var lt = 0; lt < 60; lt++){
    var lx = e.x + rnd(37) - 18, ly = e.y + rnd(37) - 18;
    if (lx > 1 && ly > 1 && lx < W - 2 && ly < H - 2) evalCandidate(ly * W + lx);
  }
  for (var t = 0; t < 50; t++){
    evalCandidate(rnd(N));
  }
  return best;
}

/**
 * Samples a relative turn action (0=straight, 1=right, 2=uturn, 3=left) from the
 * most specific context bucket in e.model that has at least MINS (6) samples.
 * FIX RATIONALE [RULE-09]: Uses the player's recorded e.uturnRate in fallback
 * sampling so ghosts naturally perform 180-degree cutbacks at the player's own rate,
 * while blocking repeated identical 90-degree turns inside home land to prevent 2x2 spins.
 */
function policy(e){
  var ks = ctxKeys(e), c, t, r, a;
  var home = owner[e.y * W + e.x] === e.id;
  for (var l = 0; l < 5; l++){
    c = e.model[ks[l]];
    if (!c) continue;
    t = c[0] + c[1] + c[2] + c[3];
    if (t >= MINS || l === 4){
      r = Math.random() * t;
      for (a = 0; a < 4; a++){
        r -= c[a];
        if (r < 0){
          if (home && e.since <= 2 && (a === 1 || a === 3) && a === e.lastPolicyAct) return 0;
          e.lastPolicyAct = a;
          return a;
        }
      }
      e.lastPolicyAct = 0;
      return 0;
    }
  }
  if (home && e.since > 3 && Math.random() < (e.uturnRate || 0.03)){
    e.lastPolicyAct = 2;
    return 2;
  }
  if (Math.random() < 0.12 && (!home || e.since > 2)){
    var bias = e.spinBias != null ? e.spinBias : 0;
    var chosen = Math.random() < (0.5 + bias * 0.35) ? 1 : 3;
    e.lastPolicyAct = chosen;
    return chosen;
  }
  e.lastPolicyAct = 0;
  return 0;
}

/**
 * Evaluates candidate direction 'c' for Style DNA alignment and player-scaled
 * hazard awareness.
 * FIX RATIONALE [RULE-10]: Previously applied hardcoded -80 / -28 collision
 * penalties to ALL ghosts regardless of player skill. Now scales head-on and
 * exposed-trail danger penalties by e.awareness (0.05..0.98) so oblivious or
 * reckless players produce ghosts that genuinely walk into danger just like
 * their owners, while attentive players produce sharp evasive ghosts.
 */
function scoreMove(e, c, isPreferred){
  var nx = e.x + DX[c], ny = e.y + DY[c];
  if (nx < 0 || ny < 0 || nx >= W || ny >= H) return -1e9;

  var idx = ny * W + nx;
  var len = e.trail.length + (e.pend >= 0 ? 1 : 0);
  var sc = isPreferred ? 50 : 0;
  var aw = e.awareness != null ? e.awareness : 0.5;

  if (e.ret && len > 0 && owner[idx] === e.id) sc += 35;
  if (!e.ret && trail[idx] === e.id) sc -= 1.5;

  for (var n = 0; n < ents.length; n++){
    var o = ents[n];
    if (o === e || !o.alive) continue;
    var d = Math.abs(o.x - nx) + Math.abs(o.y - ny);
    if (d === 0 && o.pct >= e.pct) sc -= 80 * aw;
    else if (d === 1 && len > 0) sc -= 28 * aw;
    else if (d === 1 && o.pct >= e.pct) sc -= 18 * aw;
  }

  var wd = Math.min(nx, W - 1 - nx, ny, H - 1 - ny);
  if (wd <= 4) sc += ((e.wallPref != null ? e.wallPref : 0.35) - 0.35) * 8;
  if (owner[idx] > 0 && owner[idx] !== e.id) sc += ((e.stealPref != null ? e.stealPref : 0.3) - 0.3) * 8;

  var rel = (c - e.d + 4) % 4;
  if (rel === 0) sc += 2.0;
  var bias = e.spinBias != null ? e.spinBias : 0;
  if (rel === 1) sc += bias * 0.6;
  else if (rel === 3) sc -= bias * 0.6;

  return sc;
}

/**
 * Computes the ghost's current effective trail limit by interpolating between
 * earlyMaxTrail (when pct < 15%) and lateMaxTrail (when pct >= 35%),
 * mirroring how human players scale loop size across early vs late game.
 */
function effectiveMaxTrail(e){
  var early = e.earlyMaxTrail != null ? e.earlyMaxTrail : Math.min(e.maxTrail, 26);
  var late = e.lateMaxTrail != null ? e.lateMaxTrail : e.maxTrail;
  if (e.pct <= 15) return early;
  if (e.pct >= 35) return late;
  var t = (e.pct - 15) / 20;
  return Math.round(early + (late - early) * t);
}

/**
 * Master per-tick decision pipeline for every AI ghost:
 *   1. Evaluates loop return purely from player-observed traits (effectiveMaxTrail,
 *      awareness-scaled threat horizon, and lateCaut when holding >= 30% land).
 *   2. Gates hunt() behind player-learned maxHuntTrail so ghosts never abandon
 *      long retreats to hunt unless their human owner actually hunted with long trails.
 *   3. Mirrors outward trip turns when `tplAway === 1` so replayed loops expand
 *      into open space rather than folding back onto the ghost's own border.
 *   4. Scores all 4 candidate directions (including 180° U-turns) via scoreMove().
 */
function ghostDecide(e){
  var d = e.d, prefs = [], target = -1, k, c, h, s;
  var out = owner[e.y * W + e.x] !== e.id, len = e.trail.length + (e.pend >= 0 ? 1 : 0);
  e.idle = (!out && !len) ? e.idle + 1 : 0;
  if (!e.model) e.sc++;
  var reason = 'none';
  var curMaxTrail = effectiveMaxTrail(e);
  var aw = e.awareness != null ? e.awareness : 0.5;
  var activeCaut = (e.pct >= 30 && e.lateCaut != null) ? e.lateCaut : e.caut;
  var homeIdleLimit = e.maxHomeIdle != null ? e.maxHomeIdle : 10;

  if (!out){
    e.tpl = null; e.ret = false;
  } else {
    var td = minEnemyDistToTrail(e);
    var safeHome = safestOwn(e);
    var hd = safeHome >= 0 ? (Math.abs((safeHome % W) - e.x) + Math.abs(((safeHome / W) | 0) - e.y)) : 0;
    // FIX RATIONALE [RULE-11]: Scale threat-detection radius by player-observed awareness
    // (`4 + aw * 8` = 5..12 tiles) and compare against return distance (`hd + 2`) using
    // `activeCaut` so attentive players' ghosts retreat in time even at 50%+ land, while
    // oblivious/reckless players' ghosts still overextend just like their owners.
    var threatRadius = Math.round(4 + aw * 8);
    if (len > curMaxTrail) e.ret = true;
    else if (len >= 2 && !e.ret && td <= hd + 2 && td <= threatRadius && Math.random() < (activeCaut * 1.15)) e.ret = true;
    else if (len >= 4 && !e.ret && headNear(e) && Math.random() < activeCaut) e.ret = true;
  }

  // FIX RATIONALE [RULE-11]: Only allow hunt() when exposed trail length is within the
  // player's observed `maxHuntTrail`, preventing ghosts from abandoning 35-80 tile retreats
  // to chase enemies unless their human owner actually hunted with long trails.
  var maxHuntLen = e.maxHuntTrail != null ? e.maxHuntTrail : Math.max(4, Math.round((1 - e.caut) * curMaxTrail * 0.8 + e.aggr * 6));
  h = (len <= maxHuntLen) ? hunt(e) : -1;
  if (h >= 0){
    target = h; e.tpl = null; e.ret = true; e.goal = -1; reason = 'hunt';
  } else if (e.ret){
    target = safestOwn(e); reason = 'retreat';
  } else if (!out && e.idle > homeIdleLimit){
    if (e.goal < 0 || owner[e.goal] === e.id || (e.idle % Math.max(6, homeIdleLimit) === 0)) e.goal = pickGoal(e);
    target = e.goal; reason = 'goal';
  } else {
    e.goal = -1;
    // FIX RATIONALE [RULE-10]: Abort trip launch near an enemy ONLY proportionally to
    // the human player's observed caution (activeCaut), allowing fearless/reckless ghosts
    // to step right out in front of rivals just like their human owner did.
    if (e.model && out && e.trips && e.trips.length){
      var enemyNearStart = !e.tpl && minEnemyDistToTrail(e) <= Math.round(3 + aw * 4) && Math.random() < activeCaut;
      if (enemyNearStart){
        e.ret = true;
        target = safestOwn(e);
        reason = 'retreat';
      } else {
        reason = 'trip';
        if (!e.tpl){
          var picked = pickTrip(e);
          e.tpl = picked.s;
          e.tplAway = picked.away;
          e.tplMirror = false;
          // FIX RATIONALE [RULE-11]: If the player's recorded loop turned outward away from
          // home (`tplAway === 1`), mirror left/right turns when needed so the ghost's first
          // turn also steers outward rather than folding back onto its own territory.
          if (e.tplAway === 1 && e.tpl.length && e.tpl[0][1] > 0){
            var firstRel = e.tpl[0][1];
            var testDir = (d + firstRel) % 4;
            var hc = nearestOwn(e);
            if (hc >= 0){
              var hx = hc % W, hy = (hc / W) | 0;
              var dCur = Math.abs(hx - e.x) + Math.abs(hy - e.y);
              var dTest = Math.abs(hx - (e.x + DX[testDir])) + Math.abs(hy - (e.y + DY[testDir]));
              if (dTest < dCur) e.tplMirror = true;
            }
          }
          e.ti = 0; e.tc = 0;
        }
        e.tc++;
        if (e.ti < e.tpl.length){
          if (e.tc >= e.tpl[e.ti][0]){
            var rawRel = e.tpl[e.ti][1];
            var useRel = (e.tplMirror && (rawRel === 1 || rawRel === 3)) ? (4 - rawRel) : rawRel;
            if (useRel > 0) prefs = [(d + useRel) % 4];
            e.tc = 0; e.ti++;
          }
        } else {
          e.ret = true; target = safestOwn(e); reason = 'trip-end';
        }
      }
    }
  }

  if (target >= 0){
    var uturnDir = (d + 2) % 4;
    var ux = e.x + DX[uturnDir], uy = e.y + DY[uturnDir];
    if (e.ret && len > 0 && ux >= 0 && uy >= 0 && ux < W && uy < H && owner[uy * W + ux] === e.id){
      prefs = [uturnDir];
    } else {
      c = goTo(e, target);
      if (c >= 0) prefs = [c];
    }
  } else if (!prefs.length && !(out && e.model && e.trips && e.trips.length)){
    if (e.model){
      reason = 'policy';
      c = policy(e);
      if (c) prefs = [(d + c) % 4];
    } else {
      reason = 'script';
      s = e.script[e.si % e.script.length];
      if (e.sc >= s[0]){ prefs = [(d + s[1]) % 4]; e.sc = 0; e.si++; }
    }
  }

  var candidates = [d, (d + 1) % 4, (d + 3) % 4, (d + 2) % 4];
  var bestDir = d, bestVal = -1e9;
  for (k = 0; k < candidates.length; k++){
    var cand = candidates[k];
    if (!safe(e, cand)) continue;
    var val = scoreMove(e, cand, prefs.indexOf(cand) >= 0);
    if (val > bestVal){ bestVal = val; bestDir = cand; }
  }
  e.d = bestDir;
  e.lastReason = reason;
  if (e.d !== d) e.since = 0;
  e.since++;

  // [DEV-LOG START] Log major AI mode switches and detect anomalous wandering spins or prolonged idle
  if (reason !== e.prevReason && (reason === 'hunt' || reason === 'retreat' || reason === 'goal' || reason === 'trip')){
    var tInfo = target >= 0 ? ('->(' + (target % W) + ',' + ((target / W) | 0) + ')') : '';
    dlog('[AI-MODE] ' + e.name + ' ' + e.prevReason + '->' + reason + tInfo + ' at (' + e.x + ',' + e.y + ') trail=' + len);
  }
  e.prevReason = reason;

  if (e.d !== d){
    e.turnHist.push(tick);
    if (e.turnHist.length > 5) e.turnHist.shift();
    if (!out && reason !== 'hunt' && e.turnHist.length === 5 && (tick - e.turnHist[0]) <= 10 && (tick - e.spinWarnedTick) >= 25){
      e.spinWarnedTick = tick;
      var tStr = target >= 0 ? ('(' + (target % W) + ',' + ((target / W) | 0) + ')') : 'none';
      dlog('[SPIN] ' + e.name + ' pos=(' + e.x + ',' + e.y + ') idle=' + e.idle + ' reason=' + reason +
           ' prefs=[' + prefs.join(',') + '] d=' + e.d + ' target=' + tStr + ' spinBias=' + e.spinBias);
    }
  }
  if (!out && e.idle === 35){
    dlog('[LONG-IDLE] ' + e.name + ' idle=35 pos=(' + e.x + ',' + e.y + ') pct=' + e.pct.toFixed(1) + '% reason=' + reason + ' goal=' + e.goal);
  }
  // [DEV-LOG END]
}


// ============================================================================
// [SECTION 8] CANVAS RENDERING ENGINE & MINIMAP COMPOSITOR
// Purpose: Renders smooth 60/120fps sub-tick interpolated movement on top of
// the 10Hz grid simulation, culls off-screen tiles, draws respawn/kill UI
// overlays, and composites the top-right radar minimap.
// ============================================================================

/**
 * Updates the 80x80 offscreen minimap ImageData pixel-by-pixel from owner[].
 */
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

/**
 * Main render pass. Parameter 'a' in [0, 1] is the fractional sub-tick
 * interpolation progress between (px, py) and (x, y) for silky motion.
 */
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

  // Arena neon border wall & floor
  ctx.fillStyle = WALL; ctx.fillRect(-cell, -cell, (W + 2) * cell, (H + 2) * cell);
  ctx.fillStyle = FLOOR; ctx.fillRect(0, 0, W * cell, H * cell);

  // Viewport culling bounds: only iterate cells currently visible on screen
  var x0 = Math.max(0, Math.floor(camX)), x1 = Math.min(W, Math.ceil(camX + vw));
  var y0 = Math.max(0, Math.floor(camY)), y1 = Math.min(H, Math.ceil(camY + vh));

  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1; ctx.beginPath();
  for (x = x0; x <= x1; x++){ ctx.moveTo(x * cell, y0 * cell); ctx.lineTo(x * cell, y1 * cell); }
  for (y = y0; y <= y1; y++){ ctx.moveTo(x0 * cell, y * cell); ctx.lineTo(x1 * cell, y * cell); }
  ctx.stroke();

  // Render owned territory blocks and active trails
  for (y = y0; y < y1; y++) for (x = x0; x < x1; x++){
    i = y * W + x;
    o = owner[i];
    if (o){ ctx.globalAlpha = 0.42; ctx.fillStyle = ents[o - 1].color; ctx.fillRect(x * cell, y * cell, cell, cell); }
    o = trail[i];
    if (o){ ctx.globalAlpha = 0.9; ctx.fillStyle = ents[o - 1].color; ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2); }
  }

  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,43,214,.35)'; ctx.lineWidth = cell * 0.5;
  ctx.strokeRect(cell * 0.25, cell * 0.25, W * cell - cell * 0.5, H * cell - cell * 0.5);

  // Render living entity heads (with eyes on AI ghosts to distinguish them from the human player)
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

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Player respawn countdown overlay
  // FIX RATIONALE [RULE-11]: Display the name and kill cause of whichever ghost eliminated
  // the player directly above the respawn countdown timer.
  if (!p.alive && p.deaths < LIVES){
    var rem = p.respawn - tick, fs = Math.round(Math.min(cw, ch) * 0.28);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(10,12,24,.58)'; ctx.fillRect(0, 0, cw, ch);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    ctx.font = '700 ' + fs + 'px system-ui,sans-serif';
    ctx.fillText(rem > 0 ? String(Math.ceil(rem / 10)) : '...', cw / 2, ch / 2 + fs * 0.12);
    var killerTitle = p.lastKiller ? ('Killed by ' + p.lastKiller) : 'You died';
    var causeLabel = p.lastKillCause ? (' (' + p.lastKillCause + ')') : '';
    ctx.fillStyle = p.lastKillerColor || '#ff5d73';
    ctx.font = '700 18px system-ui,sans-serif';
    ctx.fillText(killerTitle + causeLabel, cw / 2, ch / 2 - fs * 0.78);
    ctx.fillStyle = '#e8ebff';
    ctx.font = '600 14px system-ui,sans-serif';
    ctx.fillText((LIVES - p.deaths) + (LIVES - p.deaths === 1 ? ' life' : ' lives') + ' left', cw / 2, ch / 2 - fs * 0.54);
  }

  // Elimination territory-capture toast notification
  if (tick < toast.until){
    ctx.globalAlpha = Math.min(1, (toast.until - tick) / 8);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    ctx.font = '700 18px system-ui,sans-serif';
    ctx.fillText(toast.msg, cw / 2, ch - 40);
    ctx.globalAlpha = 1;
  }

  // Top-right radar minimap with camera viewport box and live head blips
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
// [SECTION 9] UI SCREENS, TOUCH INPUTS & FIXED-TIMESTEP SIMULATION LOOP
// Purpose: Manages player turn buffering, the 10Hz step() orchestrator,
// matchmaking launch (launchMatch / initArenaWithGhosts), and all 5 modal
// screens (Lobby, Auth, Leaderboards, Ghost Roster, and End-of-Round Summary).
// ============================================================================

/**
 * Enqueues a cardinal turn direction 'nd' into the 2-slot input buffer 'q'.
 * Deduplicates consecutive identical directions so a single swipe never wastes
 * both buffer slots.
 */
function turn(nd){
  var lastD = q.length ? q[q.length - 1] : (player ? player.d : 0);
  if (nd === lastD) return;
  if (q.length < 2){
    q.push(nd);
    // [DEV-LOG START]
    if (player && player.alive){
      dlog('[INPUT] turn->' + nd + ' at (' + player.x + ',' + player.y + ') trail=' + player.trail.length);
    }
    // [DEV-LOG END]
  }
}

/**
 * Pops the next buffered player turn, records the action in the behavioral
 * cloning model (learn + tripTrack + track) BEFORE updating p.d so the
 * context keys reflect the exact state in which the player made the decision.
 */
function playerDecide(p){
  var nd = q.length ? q.shift() : -1, turned = nd >= 0 && nd !== p.d, rel = turned ? (nd - p.d + 4) % 4 : 0;
  learn(p, rel);
  tripTrack(p, rel);
  if (turned){ p.d = nd; p.since = 0; }
  p.since++;
  track(p);
  p.lastReason = (owner[p.y * W + p.x] === p.id) ? 'home' : 'out(' + p.trail.length + ')';
}

function updateHud(){
  var list = ents.slice().sort(function(a, b){ return b.pct - a.pct; }), h = '';
  for (var i = 0; i < list.length; i++){
    var e = list[i];
    h += '<span class="chip' + (e.isPlayer ? ' me' : '') + '" style="border-color:' + e.color + (e.alive ? '' : ';opacity:.45') + '">' +
         esc(e.name) + ' ' + (e.pct >= 10 ? e.pct.toFixed(0) : e.pct.toFixed(1)) + '%</span>';
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

/**
 * Advances the simulation by 1 deterministic logic tick (100ms):
 *   1. Handles respawns for dead entities whose 30-tick timer expired.
 *   2. Collects movement decisions (playerDecide / ghostDecide) for all living entities.
 *   3. Resolves head-on collisions, commits pending trails, moves heads, and updates territory %.
 *   4. Checks round termination conditions (lives, noroom, or won).
 */
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
          // [DEV-LOG START]
          if (e.wait === 15) dlog('[SPAWN-FAIL] ' + e.name + ' waiting for free room (' + e.wait + ' ticks)');
          // [DEV-LOG END]
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

  // [DEV-LOG START] Periodic 5-second full-arena state snapshot
  if (tick % 50 === 0){
    var snap = ents.map(function(en){
      var isOut = en.alive && owner[en.y * W + en.x] !== en.id ? 1 : 0;
      return en.name + ':' + (en.alive ? (en.pct.toFixed(1) + '%@(' + en.x + ',' + en.y + ')d=' + en.d + ',out=' + isOut + ',t=' + en.trail.length + ',idle=' + en.idle + ',r=' + en.lastReason) : 'DEAD');
    }).join(' | ');
    dlog('[SNAP] ' + snap);
  }
  // [DEV-LOG END]

  if (!player.alive && player.deaths >= LIVES) endRound('lives');
  else if (player.alive && tick % 5 === 0 && rivalsOut() && !roomLeft()) endRound('won');
}

/**
 * requestAnimationFrame driver with fixed-timestep accumulator (acc >= TICK_MS)
 * and a 500ms frame-delta clamp to prevent spiral-of-death catchup after tab switches.
 */
function frame(t){
  if (!running) return;
  if (!last) last = t;
  acc += t - last; last = t;
  if (acc > 500) acc = 500;
  while (acc >= TICK_MS && running){ acc -= TICK_MS; step(); }
  draw(running ? acc / TICK_MS : 1);
  if (running) requestAnimationFrame(frame);
}

function showCard(html){ card.innerHTML = html; ov.style.display = 'flex'; }

/**
 * Fetches hydrated opponent ghosts from '/api/match' (or local storage if guest
 * in 'mine' mode) and transitions into initArenaWithGhosts.
 */
function launchMatch(opts){
  opts = opts || {};
  var mode = opts.mode || gameMode;
  var targetName = opts.targetName || friendQuery;
  var ghostId = opts.ghostId || challengeGhostId;
  lastMatchConfig = { mode: mode, targetName: targetName, ghostId: ghostId };

  var playBtn = document.getElementById('go');
  if (playBtn){ playBtn.disabled = true; playBtn.textContent = 'Finding Ghosts...'; }

  var fetchPromise;
  if (mode === 'mine' && !currentUser){
    var localPicks = pickLocalGhosts(loadLocalRuns()).map(function(r){
      var mt = r.t90 ? Math.max(10, Math.min(70, Math.round(r.t90 * 1.25 + 4))) : 22;
      var cautVal = r.caut != null ? r.caut : 0.4;
      var aggrVal = r.aggr != null ? r.aggr : 0.4;
      var awVal = r.awareness != null ? r.awareness : 0.5;
      return {
        dbId: 0, ownerName: 'Me', slotNum: r.id, badge: '👻 Local', elo: 1000,
        model: r.model || null, trips: r.trips || null, script: r.script || null,
        maxTrail: mt,
        earlyMaxTrail: r.earlyMaxTrail != null ? r.earlyMaxTrail : Math.min(mt, 26),
        lateMaxTrail: r.lateMaxTrail != null ? r.lateMaxTrail : mt,
        maxHuntTrail: r.maxHuntTrail != null ? r.maxHuntTrail : Math.max(4, Math.round((1 - cautVal) * mt * 0.8 + aggrVal * 6)),
        maxHomeIdle: r.maxHomeIdle != null ? r.maxHomeIdle : Math.max(5, Math.round(18 - aggrVal * 10 - awVal * 6)),
        caut: cautVal,
        lateCaut: r.lateCaut != null ? r.lateCaut : cautVal,
        aggr: aggrVal,
        wallPref: r.wallPref != null ? r.wallPref : 0.35,
        stealPref: r.stealPref != null ? r.stealPref : 0.3,
        spinBias: r.spinBias != null ? r.spinBias : 0,
        defendPref: r.defendPref != null ? r.defendPref : 0.5,
        uturnRate: r.uturnRate != null ? r.uturnRate : 0.03,
        awareness: awVal
      };
    });
    fetchPromise = Promise.resolve({ ok: true, ghosts: localPicks });
  } else {
    fetchPromise = apiFetch('/api/match', {
      method: 'POST',
      body: { mode: mode, targetName: targetName, ghostId: ghostId }
    }).catch(function(){
      return { ok: true, ghosts: [] };
    });
  }

  fetchPromise.then(function(res){
    if (!res || !res.ok){
      alert(res && res.error ? res.error : 'Could not start match');
      showStart();
      return;
    }
    initArenaWithGhosts(res.ghosts || []);
  });
}

/**
 * Resets grid buffers and populates the arena with the human player (ents[0])
 * plus up to 4 hydrated cloud ghosts.
 * FIX RATIONALE [RULE-04]: Local# localStorage backfill is strictly gated behind
 * 'if (!currentUser)' so authenticated accounts never face stale local browser ghosts.
 */
function initArenaWithGhosts(cloudGhosts){
  owner = new Uint8Array(N); trail = new Uint8Array(N);
  ents = []; tick = 0; q = []; tripSum = 0; tripN = 0; trips = []; toast.until = 0;

  // [DEV-LOG START] Reset match log at round start
  devLogs = [];
  // [DEV-LOG END]

  var myName = currentUser ? currentUser.username : 'You';
  player = mk(1, myName, true);
  player.model = {};
  player.elo = currentUser ? currentUser.elo : 1000;
  ents.push(player);

  var id = 2, g;
  cloudGhosts.slice(0, 4).forEach(function(r){
    var label = (r.ownerName || 'Ghost') + '#' + (r.slotNum || (id - 1));
    g = mk(id, label, false);
    g.dbId = r.dbId || 0;
    g.badge = r.badge || '';
    g.elo = r.elo || 1000;
    g.model = r.model || null;
    g.trips = r.trips && r.trips.length >= 3 ? r.trips : null;
    g.script = g.model ? null : (r.script && r.script.length >= 3 ? r.script : genDefault());
    g.maxTrail = r.maxTrail || 22;
    g.earlyMaxTrail = r.earlyMaxTrail != null ? r.earlyMaxTrail : Math.min(g.maxTrail, 26);
    g.lateMaxTrail = r.lateMaxTrail != null ? r.lateMaxTrail : g.maxTrail;
    g.caut = r.caut != null ? r.caut : 0.4;
    g.lateCaut = r.lateCaut != null ? r.lateCaut : g.caut;
    g.aggr = r.aggr != null ? r.aggr : 0.4;
    g.awareness = r.awareness != null ? r.awareness : Math.min(0.95, (g.aggr + g.caut) * 0.6);
    g.maxHuntTrail = r.maxHuntTrail != null ? r.maxHuntTrail : Math.max(4, Math.round((1 - g.caut) * g.maxTrail * 0.8 + g.aggr * 6));
    g.maxHomeIdle = r.maxHomeIdle != null ? r.maxHomeIdle : Math.max(5, Math.round(18 - g.aggr * 10 - g.awareness * 6));
    g.wallPref = r.wallPref != null ? r.wallPref : 0.35;
    g.stealPref = r.stealPref != null ? r.stealPref : 0.3;
    g.spinBias = r.spinBias != null ? r.spinBias : 0;
    g.defendPref = r.defendPref != null ? r.defendPref : 0.5;
    g.uturnRate = r.uturnRate != null ? r.uturnRate : 0.03;
    ents.push(g);
    id++;
  });

  if (!currentUser && ents.length < 5){
    var localFallbacks = pickLocalGhosts(loadLocalRuns());
    for (var lf = 0; lf < localFallbacks.length && ents.length < 5; lf++){
      var lr = localFallbacks[lf];
      g = mk(id, 'Local#' + lr.id, false);
      g.model = lr.model || null;
      g.trips = lr.trips && lr.trips.length >= 3 ? lr.trips : null;
      g.script = g.model ? null : genDefault();
      g.maxTrail = 20; g.earlyMaxTrail = lr.earlyMaxTrail || 20; g.lateMaxTrail = lr.lateMaxTrail || 24;
      g.aggr = lr.aggr || 0.4; g.caut = lr.caut || 0.4;
      g.lateCaut = lr.lateCaut != null ? lr.lateCaut : g.caut;
      g.awareness = lr.awareness != null ? lr.awareness : 0.5;
      g.maxHuntTrail = lr.maxHuntTrail != null ? lr.maxHuntTrail : Math.max(4, Math.round((1 - g.caut) * g.maxTrail * 0.8 + g.aggr * 6));
      g.maxHomeIdle = lr.maxHomeIdle != null ? lr.maxHomeIdle : Math.max(5, Math.round(18 - g.aggr * 10 - g.awareness * 6));
      g.wallPref = lr.wallPref != null ? lr.wallPref : 0.35;
      g.stealPref = lr.stealPref != null ? lr.stealPref : 0.3;
      g.spinBias = lr.spinBias != null ? lr.spinBias : 0;
      g.defendPref = lr.defendPref != null ? lr.defendPref : 0.5;
      g.uturnRate = lr.uturnRate != null ? lr.uturnRate : 0.03;
      ents.push(g); id++;
    }
  }

  while (ents.length < 5){
    g = mk(id, 'BOT-' + (id - 1), false);
    g.script = genDefault(); g.maxTrail = 16 + rnd(12); g.earlyMaxTrail = g.maxTrail; g.lateMaxTrail = g.maxTrail + 6;
    g.aggr = 0.3 + Math.random() * 0.4; g.awareness = 0.4;
    g.maxHuntTrail = Math.max(4, Math.round((1 - g.caut) * g.maxTrail * 0.8 + g.aggr * 6));
    g.maxHomeIdle = Math.max(5, Math.round(18 - g.aggr * 10 - g.awareness * 6));
    ents.push(g); id++;
  }

  for (var i = 0; i < ents.length; i++) spawn(ents[i], true);

  // [DEV-LOG START] Log initial roster & DNA configuration
  dlog('[START] user=' + myName + ' loggedIn=' + (currentUser ? 1 : 0) + ' mode=' + (lastMatchConfig ? lastMatchConfig.mode : gameMode));
  for (var di = 0; di < ents.length; di++){
    var de = ents[di];
    dlog('[ENT] ' + de.name + ' pos=(' + de.x + ',' + de.y + ') d=' + de.d + ' badge=' + de.badge +
         ' model=' + (de.model ? Object.keys(de.model).length : 0) + ' trips=' + (de.trips ? de.trips.length : 0) +
         ' aggr=' + de.aggr + ' caut=' + de.caut + ' lateCaut=' + de.lateCaut + ' aw=' + de.awareness +
         ' wall=' + de.wallPref + ' steal=' + de.stealPref + ' spin=' + de.spinBias + ' def=' + de.defendPref +
         ' maxTrail=' + de.earlyMaxTrail + '/' + de.lateMaxTrail + ' huntT=' + de.maxHuntTrail + ' idleT=' + de.maxHomeIdle);
  }
  // [DEV-LOG END]

  recount(); updateMini(); updateHud();
  ov.style.display = 'none';
  running = true; last = 0; acc = 0;
  resize();
  requestAnimationFrame(frame);
}

// --- Screen 1: Main Start Lobby ---
function showStart(){
  // Reset temporary leaderboard revenge mode back to standard ranked mode on lobby return
  if (gameMode === 'ghost') gameMode = 'others';
  var accountBar = '';
  if (currentUser){
    accountBar = '<div class="bar">' +
      '<div><b>👤 ' + esc(currentUser.username) + '</b> &middot; <span class="pos">' + currentUser.elo + ' ELO</span></div>' +
      '<button id="logoutBtn" class="sm">Logout</button>' +
    '</div>';
  } else {
    accountBar = '<div class="bar">' +
      '<div class="muted">Playing as <b>Guest</b></div>' +
      '<button id="authOpenBtn" class="sm">Login / Register</button>' +
    '</div>';
  }

  var reportHtml = '';
  if (offlineReport){
    var deltaClass = offlineReport.netElo >= 0 ? 'pos' : 'neg';
    var deltaSign = offlineReport.netElo >= 0 ? '+' : '';
    var logLines = offlineReport.logs.map(function(l){
      var dStr = (l.elo_delta >= 0 ? '+' : '') + l.elo_delta;
      return '<div>&bull; <b>' + esc(l.ghost_label) + '</b> vs ' + esc(l.challenger_name) +
             ' (' + l.ghost_kills + ' kills, ' + dStr + ' ELO)</div>';
    }).join('');
    reportHtml = '<div class="report">' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<b>📬 While You Were Away</b>' +
        '<button id="dismissRep" class="sm">OK</button>' +
      '</div>' +
      '<div>Your ghosts fought <b>' + offlineReport.battles + '</b> battles, scored <b>' + offlineReport.kills +
      '</b> kills (<span class="' + deltaClass + '">' + deltaSign + offlineReport.netElo + ' ELO</span>)</div>' +
      '<div class="muted" style="margin-top:4px">' + logLines + '</div>' +
    '</div>';
  }

  var friendInputHtml = gameMode === 'friend'
    ? '<input id="friendInput" placeholder="Enter friend username..." value="' + esc(friendQuery) + '">'
    : '';

  var ghostCountLabel = currentUser ? (myCloudGhosts.length + '/5') : (loadLocalRuns().runs.length);

  showCard(
    accountBar +
    '<h1>&#128123; Ghost.io</h1>' +
    '<div class="muted">Swipe to claim territory &middot; Cut trails &middot; Fight real players&apos; ghosts</div>' +
    reportHtml +
    '<div class="modes">' +
      '<button id="mOthers" class="mbtn' + (gameMode === 'others' ? ' on' : '') + '">🌍 Vs Others</button>' +
      '<button id="mMine" class="mbtn' + (gameMode === 'mine' ? ' on' : '') + '">👻 My Ghosts</button>' +
      '<button id="mFriend" class="mbtn' + (gameMode === 'friend' ? ' on' : '') + '">🎯 Friend</button>' +
    '</div>' +
    friendInputHtml +
    '<button id="go" style="width:100%">Play (' + (gameMode === 'others' ? 'Ranked' : gameMode === 'friend' ? 'Challenge' : 'Practice') + ')</button>' +
    '<div style="margin-top:8px">' +
      '<button id="lbBtn" class="alt">🏆 Leaderboards</button>' +
      '<button id="rosterBtn" class="alt">🧬 My Ghosts (' + ghostCountLabel + ')</button>' +
    '</div>'
  );

  if (document.getElementById('logoutBtn')){
    document.getElementById('logoutBtn').onclick = function(){
      setToken(''); currentUser = null; myCloudGhosts = []; offlineReport = null; showStart();
    };
  }
  if (document.getElementById('authOpenBtn')){
    document.getElementById('authOpenBtn').onclick = function(){ showAuth('login'); };
  }
  if (document.getElementById('dismissRep')){
    document.getElementById('dismissRep').onclick = function(){ offlineReport = null; showStart(); };
  }

  document.getElementById('mOthers').onclick = function(){ gameMode = 'others'; showStart(); };
  document.getElementById('mMine').onclick = function(){ gameMode = 'mine'; showStart(); };
  document.getElementById('mFriend').onclick = function(){ gameMode = 'friend'; showStart(); };

  var fi = document.getElementById('friendInput');
  if (fi) fi.oninput = function(){ friendQuery = fi.value; };

  document.getElementById('go').onclick = function(){
    if (fi) friendQuery = fi.value.trim();
    launchMatch({ mode: gameMode, targetName: friendQuery });
  };
  document.getElementById('lbBtn').onclick = showLeaderboards;
  document.getElementById('rosterBtn').onclick = showRoster;
}

// --- Screen 2: Login & Registration ---
function showAuth(tab){
  tab = tab || 'login';
  showCard(
    '<h2>' + (tab === 'login' ? 'Login to Account' : 'Create Account') + '</h2>' +
    '<div class="muted">Save your ghosts online, earn ELO, and play from any phone.</div>' +
    '<input id="uIn" placeholder="Username (3-14 chars)" maxlength="14">' +
    '<input id="pIn" type="password" placeholder="Password (min 4 chars)" maxlength="64">' +
    '<div id="authErr" class="neg" style="min-height:18px;font-size:12px"></div>' +
    '<button id="subAuth" style="width:100%">' + (tab === 'login' ? 'Login' : 'Create Account') + '</button>' +
    '<div style="margin-top:8px">' +
      '<button id="swAuth" class="alt">' + (tab === 'login' ? 'Need an account? Register' : 'Already have an account? Login') + '</button>' +
      '<button id="backAuth" class="alt">Back</button>' +
    '</div>'
  );

  document.getElementById('swAuth').onclick = function(){ showAuth(tab === 'login' ? 'register' : 'login'); };
  document.getElementById('backAuth').onclick = showStart;
  document.getElementById('subAuth').onclick = function(){
    var u = document.getElementById('uIn').value.trim();
    var p = document.getElementById('pIn').value;
    var errEl = document.getElementById('authErr');
    var btn = document.getElementById('subAuth');
    btn.disabled = true; errEl.textContent = '';

    apiFetch('/api/auth', { method: 'POST', body: { mode: tab, username: u, password: p } })
      .then(function(res){
        btn.disabled = false;
        if (!res || !res.ok){
          errEl.textContent = (res && res.error) ? res.error : 'Authentication failed';
          return;
        }
        setToken(res.token);
        currentUser = res.user;
        refreshSession().then(showStart);
      })
      .catch(function(){
        btn.disabled = false;
        errEl.textContent = 'Network error. Check your connection.';
      });
  };
}

// --- Screen 3: Global Leaderboards (Top Players & Top Ghosts + Direct Challenge Button) ---
function showLeaderboards(){
  showCard('<h2>🏆 Leaderboards</h2><div class="muted">Loading rankings...</div>');
  apiFetch('/api/leaderboards').then(function(res){
    if (!res || !res.ok){
      showCard('<h2>🏆 Leaderboards</h2><div class="neg">Failed to load rankings.</div><button id="bk">Back</button>');
      document.getElementById('bk').onclick = showStart;
      return;
    }
    var activeTab = 'ghosts';
    function renderTab(){
      var tableHtml = '';
      if (activeTab === 'players'){
        var pRows = res.players.map(function(p, idx){
          return '<tr><td><b>#' + (idx + 1) + '</b> ' + esc(p.username) + '</td><td>' + p.peak.toFixed(1) + '%</td><td><b>' + p.elo + '</b></td></tr>';
        }).join('') || '<tr><td colspan="3" class="muted">No players yet</td></tr>';
        tableHtml = '<table><tr><th>Player</th><th>Peak</th><th>ELO</th></tr>' + pRows + '</table>';
      } else {
        var gRows = res.ghosts.map(function(g, idx){
          var isMine = currentUser && g.user_id === currentUser.id;
          var btn = isMine ? '<span class="muted">Yours</span>' : '<button class="sm fightBtn" data-gid="' + g.id + '">⚔️ Fight</button>';
          return '<tr>' +
            '<td><b>#' + (idx + 1) + '</b> ' + esc(g.owner_name + '#' + g.slot_num) + '<div class="muted">' + esc(g.badge) + ' &middot; ' + g.kills + ' kills</div></td>' +
            '<td><b>' + g.elo + '</b><div class="muted">' + g.peak.toFixed(0) + '%</div></td>' +
            '<td>' + btn + '</td>' +
          '</tr>';
        }).join('') || '<tr><td colspan="3" class="muted">No ghosts ranked yet</td></tr>';
        tableHtml = '<table><tr><th>Ghost</th><th>ELO</th><th>Action</th></tr>' + gRows + '</table>';
      }

      showCard(
        '<h2>🏆 Global Rankings</h2>' +
        '<div class="tabs">' +
          '<button id="tabG" class="mbtn' + (activeTab === 'ghosts' ? ' on' : '') + '">👻 Top Ghosts</button>' +
          '<button id="tabP" class="mbtn' + (activeTab === 'players' ? ' on' : '') + '">👤 Top Players</button>' +
        '</div>' +
        tableHtml +
        '<button id="bkLb" class="alt">Back</button>'
      );

      document.getElementById('tabG').onclick = function(){ activeTab = 'ghosts'; renderTab(); };
      document.getElementById('tabP').onclick = function(){ activeTab = 'players'; renderTab(); };
      document.getElementById('bkLb').onclick = showStart;

      var fBtns = card.querySelectorAll('.fightBtn');
      for (var i = 0; i < fBtns.length; i++){
        fBtns[i].onclick = function(){
          var gid = Number(this.getAttribute('data-gid'));
          challengeGhostId = gid;
          launchMatch({ mode: 'ghost', ghostId: gid });
        };
      }
    }
    renderTab();
  }).catch(function(){
    showCard('<h2>🏆 Leaderboards</h2><div class="neg">Offline — cannot fetch rankings.</div><button id="bk">Back</button>');
    document.getElementById('bk').onclick = showStart;
  });
}

// --- Screen 4: Player's Ghost Roster Management (Lock / Delete) ---
function showRoster(){
  if (!currentUser){
    showCard(
      '<h2>🧬 My Ghosts</h2>' +
      '<div class="muted">You are playing as a Guest. Create a free account to manage up to 5 cloud ghosts, lock your best ones, and earn ELO while offline!</div>' +
      '<button id="regNow">Login / Register</button>' +
      '<button id="bkRos" class="alt">Back</button>'
    );
    document.getElementById('regNow').onclick = function(){ showAuth('register'); };
    document.getElementById('bkRos').onclick = showStart;
    return;
  }

  var rows = myCloudGhosts.map(function(g){
    return '<tr>' +
      '<td><b>' + esc(currentUser.username + '#' + g.slot_num) + '</b><div class="muted">' + esc(g.badge) + ' &middot; ' + g.peak.toFixed(1) + '%</div></td>' +
      '<td><b>' + g.elo + '</b><div class="muted">' + g.kills + 'K / ' + g.matches + 'M</div></td>' +
      '<td>' +
        '<button class="sm lockBtn" data-id="' + g.id + '">' + (g.locked ? '🔒' : '🔓') + '</button>' +
        '<button class="sm danger delBtn" data-id="' + g.id + '">🗑️</button>' +
      '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="3" class="muted">No saved ghosts yet. Play a round to clone your first ghost!</td></tr>';

  showCard(
    '<h2>🧬 My Ghosts (' + myCloudGhosts.length + '/5)</h2>' +
    '<div class="muted">Locked (🔒) ghosts are protected from being overwritten by new runs.</div>' +
    '<table><tr><th>Ghost</th><th>ELO</th><th>Manage</th></tr>' + rows + '</table>' +
    '<button id="bkRos" class="alt">Back</button>'
  );

  document.getElementById('bkRos').onclick = showStart;

  var lBtns = card.querySelectorAll('.lockBtn');
  for (var i = 0; i < lBtns.length; i++){
    lBtns[i].onclick = function(){
      var id = Number(this.getAttribute('data-id'));
      apiFetch('/api/ghosts/manage', { method: 'POST', body: { action: 'toggle_lock', ghostId: id } })
        .then(function(){ return refreshSession(); })
        .then(showRoster);
    };
  }

  var dBtns = card.querySelectorAll('.delBtn');
  for (var j = 0; j < dBtns.length; j++){
    dBtns[j].onclick = function(){
      var id = Number(this.getAttribute('data-id'));
      apiFetch('/api/ghosts/manage', { method: 'POST', body: { action: 'delete', ghostId: id } })
        .then(function(){ return refreshSession(); })
        .then(showRoster);
    };
  }
}

// --- Screen 5: End of Round, Style DNA Summary & Cloud Sync ---
// [RULE-07] & [RULE-08] & [RULE-10] & [RULE-11]: Extracts Style DNA strictly from this
// single round's telemetry with zero upward bias so every player type produces an authentic mirror.
function endRound(reason){
  if (!running) return;
  running = false;
  draw(1); updateHud();

  // Compute Style DNA ratios + early/late trail limits + tactical awareness from this single round
  // FIX RATIONALE [RULE-10] & [RULE-11]: Allows aggr and caut to drop down to 0.05 for genuinely
  // passive or reckless players, and computes `lateCaut`, `maxHuntTrail`, and `maxHomeIdle`
  // directly from observed player behavior in this round rather than fixed universal rules.
  var tl = trips.slice().sort(function(a, b){ return a - b; });
  var cs = player.chT + player.chA;
  var aggr = cs >= 6 ? Math.max(0.05, Math.min(0.92, (player.chT / cs - 0.30) / 0.50)) : Math.min(0.85, 0.15 + player.kills * 0.15);
  var fs = player.fT + player.fA;
  var caut = fs >= 4 ? Math.max(0.05, Math.min(0.95, (player.fT / fs - 0.35) / 0.50)) : (player.maxObservedTrail > 36 ? 0.15 : 0.35);
  var lateFs = player.lateFT + player.lateFA;
  var lateCaut = lateFs >= 3 ? Math.max(0.05, Math.min(0.96, (player.lateFT / lateFs - 0.35) / 0.50)) : caut;
  var awareness = (fs + cs >= 6)
    ? Math.max(0.10, Math.min(0.96, ((player.fT + player.chT) / (fs + cs) - 0.25) / 0.55))
    : Math.max(0.15, Math.min(0.85, 0.25 + player.kills * 0.10 - player.deaths * 0.06));
  var closedP90 = tl.length ? tl[Math.floor((tl.length - 1) * 0.9)] : 0;
  var rawTrailRef = tl.length ? Math.max(closedP90, Math.round(player.maxObservedTrail * 0.85)) : Math.max(12, player.maxObservedTrail);
  var maxTrailEst = Math.max(10, Math.min(72, Math.round(rawTrailRef * 1.15 + 3)));

  var earlyRef = player.earlyObservedTrail > 0 ? player.earlyObservedTrail : Math.min(rawTrailRef, 22);
  var lateRef = player.lateObservedTrail > 0 ? player.lateObservedTrail : rawTrailRef;
  var earlyMaxTrailEst = Math.max(10, Math.min(60, Math.round(earlyRef * 1.12 + 2)));
  var lateMaxTrailEst = Math.max(earlyMaxTrailEst, Math.min(72, Math.round(lateRef * 1.15 + 3)));

  var maxHuntTrailEst = Math.max(3, Math.min(65, Math.round(player.maxObservedHuntTrail + 2)));
  var maxHomeIdleEst = Math.max(4, Math.min(35, Math.round(player.maxObservedIdle > 0 ? (player.maxObservedIdle + 2) : 8)));

  var wallPref = player.totalTicks > 0 ? Math.round((player.wallTicks / player.totalTicks) * 100) / 100 : 0.35;
  var expTotal = player.stealSteps + player.neutralSteps;
  var stealPref = expTotal >= 10 ? Math.round((player.stealSteps / expTotal) * 100) / 100 : 0.3;
  var turnTotal = player.rightTurns + player.leftTurns;
  var spinBias = turnTotal >= 6 ? Math.round(((player.rightTurns - player.leftTurns) / turnTotal) * 100) / 100 : 0;
  var defTotal = player.defT + player.defA;
  var defendPref = defTotal >= 6 ? Math.round((player.defT / defTotal) * 100) / 100 : 0.5;
  var uturnRate = player.ns > 0 ? Math.round((player.uturns / player.ns) * 1000) / 1000 : 0.03;

  // [DEV-LOG START]
  dlog('[END] reason=' + reason + ' tick=' + tick + ' peak=' + player.peak.toFixed(1) + '% kills=' + player.kills +
       ' ns=' + player.ns + ' dna=(aggr=' + aggr.toFixed(2) + ',caut=' + caut.toFixed(2) + ',lateCaut=' + lateCaut.toFixed(2) +
       ',aw=' + awareness.toFixed(2) + ',wall=' + wallPref + ',steal=' + stealPref + ',spin=' + spinBias + ',def=' + defendPref +
       ',uturn=' + uturnRate + ',maxTrail=' + earlyMaxTrailEst + '/' + lateMaxTrailEst +
       ',huntT=' + maxHuntTrailEst + ',idleT=' + maxHomeIdleEst + ')');
  // [DEV-LOG END]

  var prunedModel = pruneModel(player.model);
  var bestTrips = keepTrips(player.tlist);
  var won = reason === 'won';

  // [RULE-04] Persist locally in localStorage ONLY when playing as an unauthenticated Guest
  if (!currentUser && player.ns >= 40){
    var store = loadLocalRuns();
    store.n++;
    store.runs.push({
      id: store.n, model: prunedModel, ns: player.ns,
      peak: Math.round(player.peak * 10) / 10, trip: tripN ? tripSum / tripN : 20,
      t90: tl.length ? tl[Math.floor((tl.length - 1) * 0.9)] : maxTrailEst, kills: player.kills,
      earlyMaxTrail: earlyMaxTrailEst, lateMaxTrail: lateMaxTrailEst,
      maxHuntTrail: maxHuntTrailEst, maxHomeIdle: maxHomeIdleEst,
      aggr: Math.round(aggr * 100) / 100, caut: Math.round(caut * 100) / 100,
      lateCaut: Math.round(lateCaut * 100) / 100,
      awareness: Math.round(awareness * 100) / 100,
      wallPref: wallPref, stealPref: stealPref, spinBias: spinBias, defendPref: defendPref, uturnRate: uturnRate,
      trips: bestTrips, t: Date.now()
    });
    while (store.runs.length > 20){
      var mi = 0;
      for (var k = 1; k < store.runs.length - 1; k++) if (store.runs[k].peak < store.runs[mi].peak) mi = k;
      store.runs.splice(mi, 1);
    }
    saveLocalRuns(store);
  }

  var list = ents.slice().sort(function(a, b){ return b.peak - a.peak; }), rows = '', rank = 1;
  for (var i = 0; i < list.length; i++){
    var e = list[i];
    if (e === player) rank = i + 1;
    var badgeTag = e.badge ? (' <span class="muted">(' + esc(e.badge) + ')</span>') : '';
    rows += '<tr><td><span class="dot" style="background:' + e.color + '"></span>' +
            (e.isPlayer ? '<b>' + esc(e.name) + '</b>' : '&#128123; ' + esc(e.name) + badgeTag) +
            '</td><td>' + e.kills + 'K</td><td>' + e.peak.toFixed(1) + '%</td></tr>';
  }

  // FIX RATIONALE [RULE-11]: Include the final killer's name and cause when the player loses all lives
  var killerNote = (reason === 'lives' && player.lastKiller)
    ? ('Killed by <b>' + esc(player.lastKiller) + '</b>' + (player.lastKillCause ? ' (' + esc(player.lastKillCause) + ')' : '') + ' &mdash; ')
    : '';
  var sub = won ? 'Every rival is out and no room is left for them to land' :
            reason === 'noroom' ? 'No room left for you to land' :
            killerNote + 'You used all ' + LIVES + ' lives';

  var spinLabel = spinBias > 0.2 ? 'CW ↻' : spinBias < -0.2 ? 'CCW ↺' : 'Balanced';
  var dnaBar = '<div class="dna">' +
    '<span>⚔️ Aggr: <b>' + Math.round(aggr * 100) + '%</b></span>' +
    '<span>🏴‍☠️ Steal: <b>' + Math.round(stealPref * 100) + '%</b></span>' +
    '<span>🧱 Wall: <b>' + Math.round(wallPref * 100) + '%</b></span>' +
    '<span>🔄 Turn: <b>' + spinLabel + '</b></span>' +
  '</div>';

  showCard(
    '<h2>' + (won ? 'You win!' : 'Game over') + '</h2>' +
    '<div class="muted">' + sub + '</div>' +
    '<div>Peak territory: <b>' + player.peak.toFixed(1) + '%</b> &mdash; rank <b>' + rank + '/' + list.length + '</b></div>' +
    dnaBar +
    '<table>' + rows + '</table>' +
    '<div id="syncStatus" class="muted" style="margin:6px 0">Syncing results &amp; ghost DNA...</div>' +
    '<button id="again">Play again</button>' +
    '<button id="homeBtn" class="alt">Lobby</button>' +
    // [DEV-LOG START]
    '<div style="margin-top:8px"><button id="copyLogEnd" class="dev">📋 Copy Dev Log (' + devLogs.length + ')</button></div>'
    // [DEV-LOG END]
  );

  document.getElementById('again').onclick = function(){ launchMatch(lastMatchConfig || { mode: gameMode }); };
  document.getElementById('homeBtn').onclick = function(){ refreshSession().then(showStart); };
  // [DEV-LOG START]
  var copyEndBtn = document.getElementById('copyLogEnd');
  if (copyEndBtn) copyEndBtn.onclick = function(){ copyDevLog(copyEndBtn); };
  // [DEV-LOG END]

  var oppPayload = [];
  for (var j = 1; j < ents.length; j++){
    if (ents[j].dbId > 0){
      oppPayload.push({
        dbId: ents[j].dbId,
        killsOnPlayer: ents[j].killsOnPlayer || 0,
        killedByPlayer: ents[j].killedByPlayer || 0,
        peak: Math.round(ents[j].peak * 10) / 10
      });
    }
  }

  // Practice matches against one's own ghosts (mode === 'mine') do not affect ELO
  var isRanked = !lastMatchConfig || lastMatchConfig.mode !== 'mine';

  apiFetch('/api/report', {
    method: 'POST',
    body: {
      ranked: isRanked,
      opponents: oppPayload,
      round: {
        won: won,
        peak: Math.round(player.peak * 10) / 10,
        kills: player.kills,
        ns: player.ns,
        aggr: Math.round(aggr * 100) / 100,
        caut: Math.round(caut * 100) / 100,
        lateCaut: Math.round(lateCaut * 100) / 100,
        awareness: Math.round(awareness * 100) / 100,
        maxTrail: maxTrailEst,
        earlyMaxTrail: earlyMaxTrailEst,
        lateMaxTrail: lateMaxTrailEst,
        maxHuntTrail: maxHuntTrailEst,
        maxHomeIdle: maxHomeIdleEst,
        wallPref: wallPref,
        stealPref: stealPref,
        spinBias: spinBias,
        defendPref: defendPref,
        uturnRate: uturnRate,
        model: player.ns >= 40 ? prunedModel : null,
        trips: player.ns >= 40 ? bestTrips : []
      }
    }
  }).then(function(res){
    // [DEV-LOG START]
    dlog('[API-SYNC] ok=' + (res && res.ok ? 1 : 0) + ' delta=' + (res ? res.playerDelta : 0) + ' msg="' + (res ? res.ghostMsg : '') + '"');
    var endBtn = document.getElementById('copyLogEnd');
    if (endBtn) endBtn.textContent = '📋 Copy Dev Log (' + devLogs.length + ')';
    // [DEV-LOG END]

    var st = document.getElementById('syncStatus');
    if (!st) return;
    if (!res || !res.ok){
      st.textContent = 'Saved locally (offline).';
      return;
    }
    if (res.user) currentUser = res.user;
    var lines = [];
    if (currentUser && res.playerDelta){
      var sign = res.playerDelta >= 0 ? '+' : '';
      var cls = res.playerDelta >= 0 ? 'pos' : 'neg';
      lines.push('Your ELO: <b>' + currentUser.elo + '</b> (<span class="' + cls + '">' + sign + res.playerDelta + '</span>)');
    }
    if (res.ghostMsg) lines.push(esc(res.ghostMsg));
    else if (player.ns < 40) lines.push('Round too short to clone a ghost (need 40+ moves).');
    st.innerHTML = lines.join('<br>') || 'Results synced!';
  }).catch(function(){
    // [DEV-LOG START]
    dlog('[API-SYNC] network-error');
    // [DEV-LOG END]
    var st = document.getElementById('syncStatus');
    if (st) st.textContent = 'Saved locally (network unavailable).';
  });
}

// Mobile touch swipe gesture recognizer (16px deadzone prevents accidental micro-turns)
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

// Automatically pauses the game if the mobile browser is backgrounded/minimized
document.addEventListener('visibilitychange', function(){
  if (!document.hidden || !running) return;
  running = false;
  showCard(
    '<h2>Paused</h2>' +
    '<button id="res">Resume</button>' +
    // [DEV-LOG START]
    '<div style="margin-top:8px"><button id="copyLogPause" class="dev">📋 Copy Dev Log (' + devLogs.length + ')</button></div>'
    // [DEV-LOG END]
  );
  document.getElementById('res').onclick = function(){
    ov.style.display = 'none'; running = true; last = 0; acc = 0; requestAnimationFrame(frame);
  };
  // [DEV-LOG START]
  var copyPauseBtn = document.getElementById('copyLogPause');
  if (copyPauseBtn) copyPauseBtn.onclick = function(){ copyDevLog(copyPauseBtn); };
  // [DEV-LOG END]
});

// Boot sequence: restore persisted user session if token exists, then open Start Lobby
refreshSession().then(showStart);
})();
</script>
</body>
</html>`;


// ============================================================================
// [WORKER SECTION 3] CLOUDFLARE WORKER HTTP FETCH ROUTER
// Purpose: Entrypoint for all incoming HTTP requests; routes `/api/*` paths to
// their respective D1/KV handlers and serves the HTML5 game client for `/`.
// ============================================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/auth" && request.method === "POST") {
      return handleAuth(request, env);
    }
    if (path === "/api/me" && request.method === "GET") {
      return handleMe(request, env);
    }
    if (path === "/api/leaderboards" && request.method === "GET") {
      return handleLeaderboards(env);
    }
    if (path === "/api/match" && request.method === "POST") {
      return handleMatch(request, env);
    }
    if (path === "/api/report" && request.method === "POST") {
      return handleReport(request, env);
    }
    if (path === "/api/ghosts/manage" && request.method === "POST") {
      return handleManageGhost(request, env);
    }

    return new Response(HTML, {
      headers: {
        "content-type": "text/html;charset=UTF-8",
        "cache-control": "no-cache",
      },
    });
  },
};
