// Local model proxy for Tabula.
//
// The browser cannot call Claude directly (CORS + no credentials), so the app
// talks to this small server instead. It uses the Claude Agent SDK, which
// authenticates with the SAME login Claude Code uses - so if you are signed in
// to a Claude Pro/Max subscription, moves are played on that subscription with
// no separate API billing.
//
// Note: if ANTHROPIC_API_KEY is set in this shell, the Agent SDK uses that API
// key instead of your subscription. Unset it to force subscription auth.

import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";

const PORT = Number(process.env.TABULA_PORT) || 8787;
// A move that takes longer than this is abandoned so the game never stalls;
// the UI then falls back to its built-in heuristic for that move.
const MOVE_TIMEOUT_MS = Number(process.env.TABULA_MOVE_TIMEOUT_MS) || 12000;
// When the UI asks for extended thinking, allow a bounded budget and a longer
// timeout so the deeper reasoning has room to finish.
const THINK_BUDGET = Number(process.env.TABULA_THINK_BUDGET) || 4000;
const THINK_TIMEOUT_MS = Number(process.env.TABULA_THINK_TIMEOUT_MS) || 60000;

// The UI sends model ids that match the Anthropic API; map any that the
// Agent SDK / Claude Code names differently (e.g. dated snapshots -> alias).
const MODEL_MAP = {
  "claude-opus-4-8": "claude-opus-4-8",
  "claude-sonnet-5": "claude-sonnet-5",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
};
const resolveModel = (id) => MODEL_MAP[id] || id;

// List prices ($ per million tokens: [input, output]) for a notional per-move
// cost. On a subscription the SDK reports $0, so this shows what a move would
// cost on the pay-as-you-go API - the useful number for comparing models.
const PRICES = {
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5-20251001": [1, 5],
  "claude-fable-5-1": [10, 50],
};
// Notional $ for a move. The Agent SDK caches the prompt heavily, so most input
// arrives as cache reads (~0.1x the input price); include them or cost is wildly
// understated. Any token field may be null (older rows) and is treated as 0.
function notionalCost(model, inTok, outTok, cacheTok) {
  const p = PRICES[model];
  if (!p) return null;
  const i = inTok || 0, o = outTok || 0, c = cacheTok || 0;
  return (i / 1e6) * p[0] + (o / 1e6) * p[1] + (c / 1e6) * p[0] * 0.1;
}

/* ---------------- Leaderboard storage (SQLite) ----------------
 * Uses Node's built-in node:sqlite (no native build). If it is unavailable
 * (older Node) or the file cannot be opened, the server runs without a
 * leaderboard: results are not saved and the endpoints return empty. */
const DB_PATH = process.env.TABULA_DB ||
  join(dirname(fileURLToPath(import.meta.url)), "..", "data", "tabula.db");
// Glicko-2 rating settings. Each model has a rating, a rating deviation (RD, the
// +/- uncertainty) and a volatility. A model is "established" once its RD drops
// below RD_ESTABLISHED; until then it shows as provisional.
const GK = { r: 1500, rd: 350, vol: 0.06, tau: 0.5, scale: 173.7178, eps: 1e-6 };
const RD_ESTABLISHED = Number(process.env.TABULA_RD_ESTABLISHED) || 110;

let db = null;
let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch { /* Node < 22.5 */ }
try {
  if (!DatabaseSync) throw new Error("node:sqlite unavailable");
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    played_at TEXT NOT NULL,
    winner_model TEXT NOT NULL,
    loser_model TEXT NOT NULL,
    winner_side TEXT,
    is_gammon INTEGER NOT NULL DEFAULT 0,
    margin_pips INTEGER,
    speed TEXT,
    thinking INTEGER NOT NULL DEFAULT 0
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER,
    played_at TEXT,
    model TEXT NOT NULL,
    side TEXT,
    outcome TEXT,               -- model | fallback | forced
    latency_ms INTEGER,         -- wall-clock, model decisions only
    api_ms INTEGER,             -- SDK-reported model duration
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cost_usd REAL,              -- SDK-reported (0 on a subscription)
    notional_usd REAL,         -- computed from list prices
    thinking INTEGER,
    options INTEGER,            -- number of legal plays offered
    optimal INTEGER,           -- 1/0/NULL: chose the engine-best play
    quality REAL,              -- 0..1/NULL: engine-agreement score of the pick
    board_context INTEGER      -- 1/0: full board was included in the prompt
  )`);
  // Add columns to a pre-existing moves table (no-op if they already exist).
  try { db.exec(`ALTER TABLE moves ADD COLUMN board_context INTEGER`); } catch { /* exists */ }
} catch (err) {
  console.log("NOTE: leaderboard database unavailable (" + (err && err.message) + "); results will not be saved.");
  db = null;
}

const intOrNull = (x) => (Number.isFinite(x) ? Math.round(x) : null);
const numOrNull = (x) => (Number.isFinite(x) ? x : null);
const triState = (x) => (x === 1 || x === 0 ? x : x === true ? 1 : x === false ? 0 : null);

// Insert one finished game and, atomically, its per-move metric rows.
function recordResult(r) {
  if (!db) return;
  const now = new Date().toISOString();
  const moves = Array.isArray(r.moves) ? r.moves : [];
  db.exec("BEGIN");
  try {
    const info = db.prepare(
      `INSERT INTO matches (played_at, winner_model, loser_model, winner_side, is_gammon, margin_pips, speed, thinking)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      now,
      String(r.winner_model),
      String(r.loser_model),
      r.winner_side ? String(r.winner_side) : null,
      r.is_gammon ? 1 : 0,
      intOrNull(r.margin_pips),
      r.speed ? String(r.speed) : null,
      r.thinking ? 1 : 0,
    );
    const matchId = info.lastInsertRowid;
    if (moves.length) {
      const stmt = db.prepare(
        `INSERT INTO moves (match_id, played_at, model, side, outcome, latency_ms, api_ms,
           input_tokens, output_tokens, cache_read_tokens, cost_usd, notional_usd, thinking, options, optimal, quality, board_context)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const m of moves) {
        stmt.run(
          matchId, now, String(m.model || ""), m.side ? String(m.side) : null,
          m.outcome ? String(m.outcome) : null,
          intOrNull(m.latency_ms), intOrNull(m.api_ms),
          intOrNull(m.input_tokens), intOrNull(m.output_tokens), intOrNull(m.cache_read_tokens),
          numOrNull(m.cost_usd), numOrNull(m.notional_usd),
          m.thinking ? 1 : 0, intOrNull(m.options), triState(m.optimal), numOrNull(m.quality),
          m.board_context ? 1 : 0,
        );
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const percentile = (sorted, p) => {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
};

// Aggregate the per-move rows into performance metrics per model.
function moveMetrics() {
  const map = new Map();
  if (!db) return map;
  const rows = db.prepare(
    `SELECT model, outcome, latency_ms, input_tokens, output_tokens, cache_read_tokens, optimal, quality, match_id FROM moves`,
  ).all();
  const acc = new Map();
  for (const r of rows) {
    if (!acc.has(r.model)) acc.set(r.model, {
      decisions: 0, fallbacks: 0, forced: 0, latencies: [], notional: 0,
      tokens: 0, optimalCount: 0, optimalSum: 0, quality: [], games: new Set(),
    });
    const a = acc.get(r.model);
    if (r.match_id != null) a.games.add(r.match_id);
    if (r.outcome === "model") {
      a.decisions++;
      if (r.latency_ms != null) a.latencies.push(r.latency_ms);
      // Recompute cost from tokens so pricing (incl. cache reads) is consistent
      // across all rows, even ones stored before the pricing was corrected.
      const cost = notionalCost(r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens);
      if (cost != null) a.notional += cost;
      a.tokens += (r.input_tokens || 0) + (r.output_tokens || 0) + (r.cache_read_tokens || 0);
      if (r.optimal != null) { a.optimalCount++; a.optimalSum += r.optimal; }
      if (r.quality != null) a.quality.push(r.quality);
    } else if (r.outcome === "fallback") a.fallbacks++;
    else if (r.outcome === "forced") a.forced++;
  }
  for (const [model, a] of acc) {
    const lat = a.latencies.slice().sort((x, y) => x - y);
    const attempts = a.decisions + a.fallbacks;
    const gameCount = a.games.size || 1;
    map.set(model, {
      decisions: a.decisions, fallbacks: a.fallbacks, forced: a.forced,
      medianLatencyMs: percentile(lat, 50),
      p95LatencyMs: percentile(lat, 95),
      avgTokensPerMove: a.decisions ? a.tokens / a.decisions : null,
      avgNotionalPerMove: a.decisions ? a.notional / a.decisions : null,
      avgNotionalPerGame: a.notional ? a.notional / gameCount : (a.decisions ? 0 : null),
      reliability: attempts ? a.decisions / attempts : null,
      agreement: a.optimalCount ? a.optimalSum / a.optimalCount : null,
      avgQuality: a.quality.length ? a.quality.reduce((s, q) => s + q, 0) / a.quality.length : null,
    });
  }
  return map;
}

// One Glicko-2 rating-period update for a single model.
// `results` is a list of { r, rd, s } for that model's games this period, where
// r/rd are the OPPONENT's pre-period rating/deviation and s is 1 (win) or 0 (loss).
// With no games, the model's RD widens (uncertainty grows while it sits idle).
function glicko2Update(rating, rd, vol, results) {
  const S = GK.scale;
  const phi0 = rd / S;
  if (results.length === 0) {
    const phiStar = Math.sqrt(phi0 * phi0 + vol * vol);
    return { rating, rd: Math.min(GK.rd, phiStar * S), vol };
  }
  const mu = (rating - GK.r) / S;
  const g = (p) => 1 / Math.sqrt(1 + (3 * p * p) / (Math.PI * Math.PI));
  const expected = (muj, phij) => 1 / (1 + Math.exp(-g(phij) * (mu - muj)));

  let vInv = 0, deltaSum = 0;
  for (const res of results) {
    const muj = (res.r - GK.r) / S;
    const phij = res.rd / S;
    const gj = g(phij);
    const ej = expected(muj, phij);
    vInv += gj * gj * ej * (1 - ej);
    deltaSum += gj * (res.s - ej);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Solve for the new volatility (Illinois algorithm, per Glickman's paper).
  const a = Math.log(vol * vol);
  const f = (x) => {
    const ex = Math.exp(x);
    const d2 = delta * delta;
    const num = ex * (d2 - phi0 * phi0 - v - ex);
    const den = 2 * Math.pow(phi0 * phi0 + v + ex, 2);
    return num / den - (x - a) / (GK.tau * GK.tau);
  };
  let A = a, B;
  if (delta * delta > phi0 * phi0 + v) {
    B = Math.log(delta * delta - phi0 * phi0 - v);
  } else {
    let k = 1;
    while (f(a - k * GK.tau) < 0) k++;
    B = a - k * GK.tau;
  }
  let fA = f(A), fB = f(B), iter = 0;
  while (Math.abs(B - A) > GK.eps && iter < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else { fA = fA / 2; }
    B = C; fB = fC; iter++;
  }
  const newVol = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi0 * phi0 + newVol * newVol);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;
  return { rating: newMu * S + GK.r, rd: newPhi * S, vol: newVol };
}

// Replay the whole match log to build per-model tallies and Glicko-2 ratings.
// Games are grouped into rating periods by calendar day (UTC): within a period,
// every model is rated against its opponents' ratings as they stood at the start
// of that period, which is how Glicko-2 is meant to be applied.
function computeStats() {
  const map = new Map();
  const get = (m) => {
    if (!map.has(m)) map.set(m, {
      model: m, rating: GK.r, rd: GK.rd, vol: GK.vol,
      games: 0, wins: 0, losses: 0, gammons: 0, gammonsAgainst: 0, opp: new Map(),
    });
    return map.get(m);
  };
  if (!db) return map;
  const matches = db.prepare(
    `SELECT winner_model, loser_model, is_gammon, played_at FROM matches ORDER BY played_at ASC, id ASC`,
  ).all();

  // Group into periods (one per UTC day that has games), preserving order.
  const periods = new Map();
  for (const mt of matches) {
    const day = String(mt.played_at || "").slice(0, 10) || "unknown";
    if (!periods.has(day)) periods.set(day, []);
    periods.get(day).push(mt);
  }

  for (const games of periods.values()) {
    // Ensure every model in this period exists, then snapshot pre-period ratings.
    for (const mt of games) { get(mt.winner_model); get(mt.loser_model); }
    const pre = new Map();
    for (const [m, s] of map) pre.set(m, { rating: s.rating, rd: s.rd });

    // Collect this period's results per model, and update plain tallies now.
    const played = new Map(); // model -> [{ r, rd, s }]
    const add = (m, r, rd, s) => { if (!played.has(m)) played.set(m, []); played.get(m).push({ r, rd, s }); };
    for (const mt of games) {
      const w = get(mt.winner_model), l = get(mt.loser_model);
      const pw = pre.get(mt.winner_model), pl = pre.get(mt.loser_model);
      add(w.model, pl.rating, pl.rd, 1);
      add(l.model, pw.rating, pw.rd, 0);
      w.games++; l.games++; w.wins++; l.losses++;
      if (mt.is_gammon) { w.gammons++; l.gammonsAgainst++; }
      const wh = w.opp.get(l.model) || { opponent: l.model, games: 0, wins: 0, losses: 0, gammonsFor: 0, gammonsAgainst: 0 };
      wh.games++; wh.wins++; if (mt.is_gammon) wh.gammonsFor++; w.opp.set(l.model, wh);
      const lh = l.opp.get(w.model) || { opponent: w.model, games: 0, wins: 0, losses: 0, gammonsFor: 0, gammonsAgainst: 0 };
      lh.games++; lh.losses++; if (mt.is_gammon) lh.gammonsAgainst++; l.opp.set(w.model, lh);
    }

    // Apply Glicko-2 to every model: those who played from their results, the
    // rest get the idle RD widening. Opponents come from the pre-period snapshot.
    for (const [m, s] of map) {
      const p = pre.get(m) || { rating: s.rating, rd: s.rd };
      const upd = glicko2Update(p.rating, p.rd, s.vol, played.get(m) || []);
      s.rating = upd.rating; s.rd = upd.rd; s.vol = upd.vol;
    }
  }
  return map;
}

function rowOf(s) {
  return {
    model: s.model, rating: Math.round(s.rating), rd: Math.round(s.rd),
    games: s.games, wins: s.wins, losses: s.losses,
    winPct: s.games ? s.wins / s.games : 0,
    gammons: s.gammons, gammonPct: s.wins ? s.gammons / s.wins : 0,
    provisional: s.rd > RD_ESTABLISHED,
  };
}

function leaderboard() {
  const perf = moveMetrics();
  const rows = [...computeStats().values()].map((s) => ({ ...rowOf(s), perf: perf.get(s.model) || null }));
  // Established models (tight RD) first by rating; provisional ones after, also by rating.
  rows.sort((a, b) =>
    (a.provisional - b.provisional) || (b.rating - a.rating) || (a.rd - b.rd) || a.model.localeCompare(b.model));
  return { rdEstablished: RD_ESTABLISHED, rows };
}

function headToHead(model) {
  const s = computeStats().get(model);
  const recent = db
    ? db.prepare(
        `SELECT played_at, winner_model, loser_model, is_gammon, margin_pips
         FROM matches WHERE winner_model = ? OR loser_model = ? ORDER BY id DESC LIMIT 15`,
      ).all(model, model)
    : [];
  if (!s) return { model, found: false, rating: GK.r, rd: GK.rd, games: 0, wins: 0, losses: 0, provisional: true, opponents: [], recent };
  const opponents = [...s.opp.values()].sort((a, b) => b.games - a.games || a.opponent.localeCompare(b.opponent));
  return {
    model, found: true, rating: Math.round(s.rating), rd: Math.round(s.rd),
    games: s.games, wins: s.wins, losses: s.losses,
    gammons: s.gammons, gammonsAgainst: s.gammonsAgainst,
    provisional: s.rd > RD_ESTABLISHED,
    perf: moveMetrics().get(model) || null,
    opponents, recent,
  };
}

// Suggest the most useful next matchup among a pool of models: favour models with
// high uncertainty (big RD, need games) and pairings close in rating (informative).
function nextMatch(candidates) {
  const pool = [...new Set((candidates || []).filter(Boolean))];
  if (pool.length < 2) return null;
  const stats = computeStats();
  const info = pool.map((id) => {
    const s = stats.get(id);
    return { id, rating: s ? s.rating : GK.r, rd: s ? s.rd : GK.rd, games: s ? s.games : 0 };
  });
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      const a = info[i], b = info[j];
      const uncertainty = (a.rd + b.rd) / 200;                                  // ~0..3.5, higher = needs games
      const closeness = 1 - Math.min(1, Math.abs(a.rating - b.rating) / 400);   // 1 = equal, 0 = >=400 apart
      const score = uncertainty + closeness * 3 + Math.random() * 0.6;
      if (score > bestScore) { bestScore = score; best = [a, b]; }
    }
  }
  if (!best) return null;
  const [x, y] = Math.random() < 0.5 ? best : [best[1], best[0]]; // randomise sides
  return {
    white: x.id, black: y.id,
    whiteRating: Math.round(x.rating), blackRating: Math.round(y.rating),
    whiteRd: Math.round(x.rd), blackRd: Math.round(y.rd),
  };
}

function recentMatches(limit) {
  if (!db) return [];
  const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return db.prepare(
    `SELECT played_at, winner_model, loser_model, winner_side, is_gammon, margin_pips
     FROM matches ORDER BY id DESC LIMIT ?`,
  ).all(n);
}

async function askModel({ model, system, user, thinking }) {
  const think = !!thinking;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), think ? THINK_TIMEOUT_MS : MOVE_TIMEOUT_MS);
  let text = "", meta = {};
  try {
    for await (const msg of query({
      prompt: user,
      options: {
        model: resolveModel(model),
        systemPrompt: system, // a plain string replaces the default Claude Code prompt
        allowedTools: [], // pure reasoning task - no file/bash/web tools
        maxTurns: 1,
        settingSources: [], // don't load project/user CLAUDE.md into a game move
        // Off by default keeps moves fast and consistent; the UI can turn on
        // extended thinking (bounded budget) for deeper, slower play.
        maxThinkingTokens: think ? THINK_BUDGET : 0,
        abortController: ac, // enforce the timeout so a slow move can't freeze the game
      },
    })) {
      if (msg.type === "result" && msg.subtype === "success") {
        text = msg.result;
        const u = msg.usage || {};
        meta = {
          apiMs: msg.duration_ms ?? null,
          costUsd: msg.total_cost_usd ?? null,
          inputTokens: u.input_tokens ?? null,
          outputTokens: u.output_tokens ?? null,
          cacheReadTokens: u.cache_read_input_tokens ?? null,
        };
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (!text) throw new Error("empty or timed-out response from model");
  return { text, meta };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.method === "POST" && url.pathname === "/api/move") {
      const { model, system, user, thinking } = JSON.parse((await readBody(req)) || "{}");
      if (!model || !system || !user) return send(400, { error: "model, system and user are required" });
      const { text, meta } = await askModel({ model, system, user, thinking });
      return send(200, {
        text,
        metrics: {
          durationMs: meta.apiMs,
          inputTokens: meta.inputTokens,
          outputTokens: meta.outputTokens,
          cacheReadTokens: meta.cacheReadTokens,
          costUsd: meta.costUsd,
          notionalUsd: notionalCost(model, meta.inputTokens, meta.outputTokens, meta.cacheReadTokens),
        },
      });
    }
    if (req.method === "POST" && url.pathname === "/api/result") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.winner_model || !body.loser_model) return send(400, { error: "winner_model and loser_model are required" });
      recordResult(body);
      return send(200, { ok: true, saved: !!db });
    }
    if (req.method === "GET" && url.pathname === "/api/leaderboard") {
      return send(200, leaderboard());
    }
    if (req.method === "GET" && url.pathname === "/api/matches") {
      return send(200, { matches: recentMatches(url.searchParams.get("limit")) });
    }
    if (req.method === "GET" && url.pathname === "/api/head-to-head") {
      const model = url.searchParams.get("model");
      if (!model) return send(400, { error: "model is required" });
      return send(200, headToHead(model));
    }
    if (req.method === "POST" && url.pathname === "/api/next-match") {
      const { models } = JSON.parse((await readBody(req)) || "{}");
      const pick = nextMatch(models);
      if (!pick) return send(400, { error: "need at least two models" });
      return send(200, pick);
    }
    return send(404, { error: "not found" });
  } catch (err) {
    return send(500, { error: String(err && err.message ? err.message : err) });
  }
});

server.listen(PORT, () => {
  console.log(`Tabula model proxy listening on http://localhost:${PORT}`);
  if (process.env.ANTHROPIC_API_KEY) {
    console.log(
      "NOTE: ANTHROPIC_API_KEY is set, so the Agent SDK will use that API key " +
        "(separate billing) instead of your Claude subscription. Unset it to use the subscription.",
    );
  }
});
