import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, SkipForward, RotateCcw, Trophy, Brain } from "lucide-react";

/* ============================ ENGINE (tested) ============================ */
const sign = (pl) => (pl === "W" ? 1 : -1);
const opp = (pl) => (pl === "W" ? "B" : "W");
const dir = (pl) => (pl === "W" ? -1 : 1);
function initialBoard() {
  const points = new Array(25).fill(0);
  points[24] = 2; points[13] = 5; points[8] = 3; points[6] = 5;
  points[1] = -2; points[12] = -5; points[17] = -3; points[19] = -5;
  return { points, bar: { W: 0, B: 0 }, off: { W: 0, B: 0 } };
}
const cloneBoard = (b) => ({ points: b.points.slice(), bar: { ...b.bar }, off: { ...b.off } });
const distanceToOff = (p, pl) => (pl === "W" ? p : 25 - p);
function allHome(b, pl) {
  if (b.bar[pl] > 0) return false;
  const s = sign(pl);
  if (pl === "W") { for (let p = 7; p <= 24; p++) if (s * b.points[p] > 0) return false; }
  else { for (let p = 1; p <= 18; p++) if (s * b.points[p] > 0) return false; }
  return true;
}
const canLand = (b, t, pl) => -sign(pl) * b.points[t] <= 1;
function singleDieMoves(b, pl, d) {
  const s = sign(pl), moves = [];
  if (b.bar[pl] > 0) {
    const entry = pl === "W" ? 25 - d : d;
    if (entry >= 1 && entry <= 24 && canLand(b, entry, pl))
      moves.push({ from: "bar", to: entry, die: d, hit: -s * b.points[entry] === 1 });
    return moves;
  }
  for (let p = 1; p <= 24; p++) {
    if (s * b.points[p] <= 0) continue;
    const t = p + dir(pl) * d;
    if (t >= 1 && t <= 24 && canLand(b, t, pl))
      moves.push({ from: p, to: t, die: d, hit: -s * b.points[t] === 1 });
  }
  if (allHome(b, pl)) {
    for (let p = 1; p <= 24; p++) {
      if (s * b.points[p] <= 0) continue;
      const dist = distanceToOff(p, pl);
      if (d === dist) moves.push({ from: p, to: "off", die: d, hit: false });
      else if (d > dist) {
        let deeper = false;
        if (pl === "W") { for (let q = p + 1; q <= 6; q++) if (b.points[q] > 0) { deeper = true; break; } }
        else { for (let q = p - 1; q >= 19; q--) if (b.points[q] < 0) { deeper = true; break; } }
        if (!deeper) moves.push({ from: p, to: "off", die: d, hit: false });
      }
    }
  }
  return moves;
}
function applyMove(b, mv, pl) {
  const nb = cloneBoard(b), s = sign(pl);
  if (mv.from === "bar") nb.bar[pl] -= 1; else nb.points[mv.from] -= s;
  if (mv.to !== "off") {
    if (-s * nb.points[mv.to] === 1) { nb.points[mv.to] = 0; nb.bar[opp(pl)] += 1; }
    nb.points[mv.to] += s;
  } else nb.off[pl] += 1;
  return nb;
}
const sigOf = (b) => b.points.join(",") + "|" + b.bar.W + "," + b.bar.B + "|" + b.off.W + "," + b.off.B;
function legalPlays(board, pl, dice) {
  const isDouble = dice[0] === dice[1];
  const orderings = isDouble ? [[dice[0], dice[0], dice[0], dice[0]]] : [[dice[0], dice[1]], [dice[1], dice[0]]];
  const results = [];
  function recurse(b, remaining, acc) {
    if (remaining.length === 0) { results.push({ moves: acc.slice(), board: b }); return; }
    const opts = singleDieMoves(b, pl, remaining[0]);
    if (opts.length === 0) { results.push({ moves: acc.slice(), board: b }); return; }
    for (const mv of opts) recurse(applyMove(b, mv, pl), remaining.slice(1), acc.concat([mv]));
  }
  for (const order of orderings) recurse(board, order, []);
  let maxUsed = 0; for (const r of results) maxUsed = Math.max(maxUsed, r.moves.length);
  let cands = results.filter((r) => r.moves.length === maxUsed);
  if (!isDouble && maxUsed === 1) {
    const higher = Math.max(dice[0], dice[1]);
    const wh = cands.filter((r) => r.moves[0].die === higher);
    if (wh.length) cands = wh;
  }
  if (maxUsed === 0) return [{ moves: [], board: cloneBoard(board) }];
  const seen = new Set(), uniq = [];
  for (const r of cands) { const s = sigOf(r.board); if (!seen.has(s)) { seen.add(s); uniq.push(r); } }
  return uniq;
}
const winner = (b) => (b.off.W === 15 ? "W" : b.off.B === 15 ? "B" : null);
function pipCount(b, pl) {
  let c = b.bar[pl] * 25; const s = sign(pl);
  for (let p = 1; p <= 24; p++) if (s * b.points[p] > 0) c += (s * b.points[p]) * distanceToOff(p, pl);
  return c;
}
function blots(b, pl) { let n = 0; const s = sign(pl); for (let p = 1; p <= 24; p++) if (s * b.points[p] === 1) n++; return n; }
function blotPoints(b, pl) { const r = []; const s = sign(pl); for (let p = 1; p <= 24; p++) if (s * b.points[p] === 1) r.push(p); return r; }
const notation = (moves) => !moves.length ? "no play" :
  moves.map((m) => `${m.from === "bar" ? "bar" : m.from}/${m.to === "off" ? "off" : m.to}${m.hit ? "*" : ""}`).join(" ");

/* ============================ GEOMETRY ============================ */
const VB_W = 1000, VB_H = 660, FRAME = 30, TRAY_W = 70, BAR_W = 56;
const fieldX0 = FRAME, fieldX1 = VB_W - FRAME - TRAY_W;
const groupW = (fieldX1 - fieldX0 - BAR_W) / 2, PW = groupW / 6;
const leftG1 = fieldX0 + groupW, rightG1 = fieldX1;
const barX0 = leftG1, barX1 = leftG1 + BAR_W, barCx = (barX0 + barX1) / 2;
const surfY0 = FRAME, surfY1 = VB_H - FRAME, POINT_LEN = 248;
const R = PW * 0.44, STEP = R * 1.82;
const trayX0 = VB_W - FRAME - TRAY_W, trayX1 = VB_W - FRAME, trayCx = (trayX0 + trayX1) / 2;
const SLAB_H = 13, SLAB_GAP = 3, SLAB_W = TRAY_W - 16;

function pointGeom(p) {
  let x, up;
  if (p >= 1 && p <= 6) { x = rightG1 - PW * (p - 1 + 0.5); up = true; }
  else if (p >= 7 && p <= 12) { x = leftG1 - PW * (p - 7 + 0.5); up = true; }
  else if (p >= 13 && p <= 18) { x = leftG1 - PW * (18 - p + 0.5); up = false; }
  else { x = rightG1 - PW * (24 - p + 0.5); up = false; }
  return { x, baseY: up ? surfY1 : surfY0, tipY: up ? surfY1 - POINT_LEN : surfY0 + POINT_LEN, up };
}
const checkerY = (p, i) => { const g = pointGeom(p); return g.up ? g.baseY - R - i * STEP : g.baseY + R + i * STEP; };
const colParity = (p) => Math.floor((pointGeom(p).x - fieldX0) / PW) % 2 === 0;
const barStackY = (pl, i) => (pl === "W" ? surfY1 - R - 10 - i * STEP : surfY0 + R + 10 + i * STEP);
const offCoords = (pl, i) => pl === "W"
  ? { x: trayCx, y: surfY1 - 12 - (i + 1) * (SLAB_H + SLAB_GAP) + SLAB_H / 2 }
  : { x: trayCx, y: surfY0 + 12 + i * (SLAB_H + SLAB_GAP) + SLAB_H / 2 };

/* ============================ MODELS ============================ */
const MODELS = [
  { id: "claude-opus-4-8", name: "Claude Opus 4.8", tier: "Most capable - deepest strategic play" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", tier: "Balanced reasoning and speed" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", tier: "Fast and reliable" },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", tier: "Fastest, most concise" },
];
const MODEL_NAME = (id) => (MODELS.find((m) => m.id === id) || { name: id }).name;

/* ============================ MODEL CALL ============================ */
function buildPrompt(board, pl, dice, plays) {
  const isD = dice[0] === dice[1];
  const lines = plays.map((p, i) => {
    const hits = p.moves.filter((m) => m.hit).length;
    return `${i}: ${notation(p.moves)}  | hits:${hits} | your pip after:${pipCount(p.board, pl)} | your blots after:${blots(p.board, pl)}`;
  }).join("\n");
  return `Dice: ${dice[0]}-${dice[1]}${isD ? " (doubles - four moves)" : ""}
Your pip count: ${pipCount(board, pl)} (lower is better, race to 0). Opponent pip: ${pipCount(board, opp(pl))}.
Your checkers on bar: ${board.bar[pl]}. Opponent on bar: ${board.bar[opp(pl)]}.
Opponent blots (vulnerable) at points: ${blotPoints(board, opp(pl)).join(", ") || "none"}.

Legal plays:
${lines}

Choose the best play index for your persona. Respond with ONLY JSON: {"choice": <index>, "reasoning": "<one sentence, max 28 words, in your persona's voice>"}.`;
}
function heuristicPick(plays, pl) {
  let best = 0, bs = -1e9;
  plays.forEach((p, i) => {
    const s = p.moves.filter((m) => m.hit).length * 1000 - pipCount(p.board, pl) - blots(p.board, pl) * 30;
    if (s > bs) { bs = s; best = i; }
  });
  return best;
}
async function callClaude(model, system, userContent, thinking) {
  // Calls the local proxy (server/index.mjs), which runs the move on your
  // Claude subscription via the Agent SDK. See vite.config.js for the /api proxy.
  const res = await fetch("/api/move", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, system, user: userContent, thinking: !!thinking }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || ("http " + res.status));
  let txt = (data.text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const m = txt.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : txt);
}
async function askModel(board, pl, dice, plays, modelId, thinking) {
  const colorName = pl === "W" ? "White (ivory)" : "Black (ebony)";
  const system = `You are ${MODEL_NAME(modelId)}, playing backgammon as ${colorName} at a world-class level. You will be shown the position and a numbered list of every legal play for your dice. Pick the single strongest play and briefly explain the idea behind it. Respond with ONLY a JSON object of the form {"choice": <int>, "reasoning": "<one sentence, max 28 words>"} and nothing else.`;
  const user = buildPrompt(board, pl, dice, plays);
  const parse = (obj) => {
    let choice = parseInt(obj.choice, 10);
    if (isNaN(choice) || choice < 0 || choice >= plays.length) choice = heuristicPick(plays, pl);
    const reasoning = typeof obj.reasoning === "string" && obj.reasoning.trim() ? obj.reasoning.trim() : "Playing the strongest line I see.";
    return { choice, reasoning };
  };
  try { return parse(await callClaude(modelId, system, user, thinking)); }
  catch (e1) {
    try { return parse(await callClaude("claude-sonnet-4-6", system, user, thinking)); }
    catch (e2) { return { choice: heuristicPick(plays, pl), reasoning: "(Reading the board directly - reaching for the sharpest line available.)" }; }
  }
}

/* ============================ THEME ============================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,900&family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap');
.tb-root{ --bg:#141009; --ink:#ece4d3; --ink-dim:#a99d84; --ink-faint:#6f6754;
  --wood:#4a3220; --wood-hi:#6d4a2d; --brass:#c9a35a; --brass-hi:#e6c884; --bone:#e8dcc0;
  font-family:'Hanken Grotesk',system-ui,sans-serif; color:var(--ink); min-height:100vh; width:100%;
  background:radial-gradient(130% 100% at 50% -15%, #251d12 0%, #14100a 55%, #0b0805 100%); -webkit-font-smoothing:antialiased; }
.tb-root *{box-sizing:border-box;}
.wrap{max-width:1340px;margin:0 auto;padding:clamp(16px,3vw,42px);}
.topbar{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:clamp(16px,2.5vw,30px);}
.brand h1{font-family:'Fraunces',serif;font-weight:900;font-size:clamp(40px,6.5vw,72px);line-height:.85;letter-spacing:.15em;margin:0;color:var(--bone);text-shadow:0 2px 0 rgba(0,0,0,.45);}
.brand .sub{font-family:'Fraunces',serif;font-style:italic;color:var(--brass);font-size:clamp(13px,1.5vw,17px);}
.controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.btn{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--wood-hi);background:linear-gradient(180deg,#2a2114,#1c160d);color:var(--ink);font-family:inherit;font-weight:600;font-size:14px;padding:10px 15px;border-radius:9px;cursor:pointer;transition:transform .12s,border-color .2s;}
.btn:hover:not(:disabled){transform:translateY(-1px);border-color:var(--brass);}
.btn:disabled{opacity:.4;cursor:not-allowed;}
.btn.primary{background:linear-gradient(180deg,var(--brass-hi),var(--brass));color:#2a1d08;border-color:var(--brass-hi);}
.speed{display:inline-flex;border:1px solid var(--wood-hi);border-radius:9px;overflow:hidden;}
.speed button{background:transparent;border:0;color:var(--ink-dim);font-family:inherit;font-weight:600;font-size:13px;padding:9px 12px;cursor:pointer;}
.speed button.on{background:var(--wood);color:var(--bone);}
.grid{display:grid;grid-template-columns:300px minmax(0,1fr) 300px;gap:clamp(14px,1.8vw,26px);align-items:start;}
@media(max-width:1080px){.grid{grid-template-columns:1fr;}}
.card{border:1px solid #34291a;border-radius:16px;background:linear-gradient(180deg,rgba(38,30,19,.72),rgba(20,16,11,.72));padding:18px;position:relative;overflow:hidden;transition:border-color .3s,box-shadow .3s;}
.card.active{border-color:var(--brass);box-shadow:0 0 0 1px rgba(201,163,90,.22),0 12px 46px -20px rgba(201,163,90,.55);}
.side-tag{font-weight:800;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-faint);}
.pcheck{width:18px;height:18px;border-radius:50%;display:inline-block;vertical-align:-3px;margin-right:9px;box-shadow:0 1px 3px rgba(0,0,0,.5);}
.pname{font-family:'Fraunces',serif;font-weight:600;font-size:22px;margin:3px 0 2px;display:flex;align-items:center;}
.selrow{margin:14px 0 4px;}
.selrow label{display:block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:6px;font-weight:700;}
.sel{width:100%;appearance:none;background:#1b150d url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23c9a35a' d='M6 8 0 0h12z'/%3E%3C/svg%3E") no-repeat right 14px center;border:1px solid var(--wood-hi);color:var(--ink);font-family:inherit;font-weight:600;font-size:14px;padding:11px 34px 11px 13px;border-radius:9px;cursor:pointer;}
.sel:focus-visible{outline:2px solid var(--brass);outline-offset:1px;}
.persona-desc{font-size:12.5px;line-height:1.5;color:var(--ink-dim);margin-top:9px;min-height:34px;}
.statrow{display:flex;gap:10px;margin:16px 0 6px;}
.stat{flex:1;border:1px solid #33281a;border-radius:11px;padding:10px 12px;background:rgba(0,0,0,.2);}
.stat .k{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint);font-weight:700;}
.stat .v{font-family:'Fraunces',serif;font-weight:600;font-size:28px;font-variant-numeric:tabular-nums;line-height:1;margin-top:3px;}
.think{margin-top:16px;border-top:1px dashed #362a1a;padding-top:14px;}
.think .lbl{display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint);font-weight:700;margin-bottom:9px;}
.dot{width:6px;height:6px;border-radius:50%;background:var(--brass);}
.dot.pulse{animation:pulse 1s infinite ease-in-out;}
@keyframes pulse{0%,100%{opacity:.25;transform:scale(.8);}50%{opacity:1;transform:scale(1.3);}}
.reason{font-family:'Fraunces',serif;font-style:italic;font-size:16.5px;line-height:1.5;color:var(--bone);min-height:76px;}
.reason .caret{display:inline-block;width:2px;height:1.05em;background:var(--brass);vertical-align:-2px;margin-left:1px;animation:blink 1s steps(1) infinite;}
@keyframes blink{50%{opacity:0;}}
.reason.empty{color:var(--ink-faint);}
.boardwrap{filter:drop-shadow(0 34px 66px rgba(0,0,0,.6));}
.boardwrap svg{width:100%;height:auto;display:block;}
.dice-tray{display:flex;gap:14px;align-items:center;justify-content:center;margin-top:10px;min-height:52px;}
.dieScene{width:46px;height:46px;perspective:280px;}
.cube3d{width:46px;height:46px;position:relative;transform-style:preserve-3d;transition:transform .68s cubic-bezier(.25,.75,.3,1);}
.face3d{position:absolute;width:46px;height:46px;border-radius:9px;background:linear-gradient(145deg,#f6eeda,#dccaa5);
  box-shadow:inset 0 0 0 1px rgba(120,95,55,.3),inset 3px 3px 6px rgba(255,255,255,.6),inset -3px -3px 7px rgba(120,90,50,.4);}
.face3d.blk{background:linear-gradient(145deg,#33291d,#140d06);box-shadow:inset 0 0 0 1px rgba(0,0,0,.6),inset 3px 3px 6px rgba(120,100,70,.35),inset -3px -3px 7px rgba(0,0,0,.6);}
.pip3d{position:absolute;width:8px;height:8px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#5a4324,#2c1e0c);transform:translate(-50%,-50%);box-shadow:inset 0 1px 1px rgba(0,0,0,.55);}
.face3d.blk .pip3d{background:radial-gradient(circle at 35% 35%,#f0e6cf,#b9a67f);}
.dielabel{color:var(--ink-faint);font-style:italic;font-family:'Fraunces',serif;}
.log{margin-top:22px;border:1px solid #34291a;border-radius:14px;background:rgba(15,12,8,.55);overflow:hidden;}
.log h3{font-weight:800;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-faint);margin:0;padding:13px 16px;border-bottom:1px solid #29200f;}
.logscroll{max-height:150px;overflow-y:auto;padding:6px 8px;}
.logrow{display:grid;grid-template-columns:38px 20px 1fr 62px;gap:10px;align-items:center;padding:6px 8px;font-size:13.5px;border-radius:8px;}
.logrow:nth-child(odd){background:rgba(255,255,255,.02);}
.logrow .n{color:var(--ink-faint);font-variant-numeric:tabular-nums;font-weight:600;}
.logrow .mv{font-family:'Fraunces',serif;color:var(--ink);}
.logrow .dc{color:var(--ink-dim);font-variant-numeric:tabular-nums;text-align:right;font-size:12px;}
.chip{width:11px;height:11px;border-radius:50%;}
.banner{display:flex;align-items:center;gap:12px;justify-content:center;margin:0 auto 6px;padding:14px 22px;border-radius:12px;background:linear-gradient(180deg,rgba(201,163,90,.18),rgba(201,163,90,.06));border:1px solid var(--brass);color:var(--brass-hi);font-family:'Fraunces',serif;font-size:20px;font-weight:600;max-width:520px;}
.turnpill{font-size:10px;letter-spacing:.18em;text-transform:uppercase;font-weight:800;color:var(--brass);border:1px solid var(--brass);border-radius:999px;padding:3px 10px;opacity:0;transition:opacity .3s;}
.turnpill.show{opacity:1;}
.logscroll::-webkit-scrollbar{width:8px;}
.logscroll::-webkit-scrollbar-thumb{background:#3a2c19;border-radius:4px;}
@media (prefers-reduced-motion: reduce){.dot.pulse,.reason .caret{animation:none;}.cube3d{transition:none;}}
`;

/* ============================ SVG PIECES ============================ */
function Checker({ cx, cy, isW }) {
  const rim = isW ? "#b39a68" : "#000";
  const groove = isW ? "rgba(120,95,55,.55)" : "rgba(0,0,0,.6)";
  const grooveHi = isW ? "rgba(255,248,230,.55)" : "rgba(150,130,95,.30)";
  const sheen = isW ? "rgba(255,252,244,.85)" : "rgba(210,195,160,.5)";
  return (
    <g>
      <ellipse cx={cx} cy={cy + R * 0.62} rx={R * 0.96} ry={R * 0.36} fill="url(#contact)" />
      <circle cx={cx} cy={cy} r={R} fill={isW ? "url(#discW)" : "url(#discB)"} stroke={rim} strokeWidth="1.4" />
      <circle cx={cx} cy={cy} r={R * 0.8} fill="none" stroke={groove} strokeWidth="2" />
      <circle cx={cx} cy={cy} r={R * 0.72} fill="none" stroke={grooveHi} strokeWidth="1.1" />
      <circle cx={cx} cy={cy} r={R * 0.62} fill={isW ? "url(#faceW)" : "url(#faceB)"} />
      <path d={`M ${cx - R * 0.55} ${cy - R * 0.35} A ${R * 0.66} ${R * 0.66} 0 0 1 ${cx + R * 0.15} ${cy - R * 0.62}`} fill="none" stroke={sheen} strokeWidth="2.2" strokeLinecap="round" />
    </g>
  );
}
function Stack({ p, count, isW }) {
  const items = [];
  const vis = Math.min(count, 5);
  for (let i = 0; i < vis; i++) items.push(<Checker key={i} cx={pointGeom(p).x} cy={checkerY(p, i)} isW={isW} />);
  if (count > 5) {
    const g = pointGeom(p), y = checkerY(p, 4);
    items.push(
      <g key="cnt">
        <circle cx={g.x} cy={y} r={R * 0.5} fill="rgba(0,0,0,.62)" />
        <text x={g.x} y={y} textAnchor="middle" dominantBaseline="central" fill="#f0e6cf" fontSize={R * 0.72} fontFamily="Hanken Grotesk" fontWeight="800">{count}</text>
      </g>
    );
  }
  return <g>{items}</g>;
}
function Board({ board, highlight, flyerRef, flyerW }) {
  const pts = [];
  for (let p = 1; p <= 24; p++) {
    const g = pointGeom(p), dark = colParity(p), half = PW / 2 - 3;
    const hl = highlight && (highlight.from === p || highlight.to === p);
    pts.push(
      <g key={"pt" + p}>
        <polygon points={`${g.x - half},${g.baseY} ${g.x + half},${g.baseY} ${g.x},${g.tipY}`} fill={dark ? "url(#ox)" : "url(#bone)"}
          style={{ filter: hl ? "drop-shadow(0 0 9px #e6c884)" : "none", transition: "filter .3s" }} />
        <polygon points={`${g.x - half},${g.baseY} ${g.x - half * 0.15},${g.baseY} ${g.x},${g.tipY}`} fill={dark ? "rgba(255,220,200,.10)" : "rgba(255,255,255,.16)"} />
        <rect x={g.x - half} y={g.up ? g.baseY - 6 : g.baseY} width={half * 2} height="6" fill="rgba(0,0,0,.2)" />
        {hl && <polygon points={`${g.x - half},${g.baseY} ${g.x + half},${g.baseY} ${g.x},${g.tipY}`} fill="none" stroke="#e6c884" strokeWidth="2" opacity="0.9" />}
        <text x={g.x} y={g.up ? surfY1 + (VB_H - surfY1) / 2 + 4 : surfY0 - (surfY0) / 2 + 2} textAnchor="middle" dominantBaseline="middle" fill="rgba(201,163,90,.5)" fontSize="12" fontFamily="Hanken Grotesk" fontWeight="700">{p}</text>
      </g>
    );
  }
  const stacks = [];
  for (let p = 1; p <= 24; p++) { const v = board.points[p]; if (v) stacks.push(<Stack key={"s" + p} p={p} count={Math.abs(v)} isW={v > 0} />); }
  const barW = [], barB = [];
  for (let i = 0; i < board.bar.W; i++) barW.push(<Checker key={"bw" + i} cx={barCx} cy={barStackY("W", i)} isW />);
  for (let i = 0; i < board.bar.B; i++) barB.push(<Checker key={"bb" + i} cx={barCx} cy={barStackY("B", i)} isW={false} />);
  const barHL = highlight && (highlight.from === "bar" || highlight.to === "bar");
  const offW = [], offB = [];
  for (let i = 0; i < board.off.W; i++) offW.push(<rect key={"ow" + i} x={trayCx - SLAB_W / 2} y={surfY1 - 12 - (i + 1) * (SLAB_H + SLAB_GAP)} width={SLAB_W} height={SLAB_H} rx="3" fill="url(#discW)" stroke="#b39a68" strokeWidth="0.8" />);
  for (let i = 0; i < board.off.B; i++) offB.push(<rect key={"ob" + i} x={trayCx - SLAB_W / 2} y={surfY0 + 12 + i * (SLAB_H + SLAB_GAP)} width={SLAB_W} height={SLAB_H} rx="3" fill="url(#discB)" stroke="#000" strokeWidth="0.8" />);

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" aria-label="Backgammon board">
      <defs>
        <filter id="wood" x="-2%" y="-2%" width="104%" height="104%">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.055" numOctaves="5" seed="15" result="n" />
          <feComponentTransfer in="n">
            <feFuncR type="table" tableValues="0.13 0.30 0.44 0.29 0.16" />
            <feFuncG type="table" tableValues="0.075 0.185 0.29 0.175 0.095" />
            <feFuncB type="table" tableValues="0.03 0.09 0.16 0.085 0.04" />
            <feFuncA type="table" tableValues="1 1 1 1 1" />
          </feComponentTransfer>
        </filter>
        <filter id="feltTex"><feTurbulence type="fractalNoise" baseFrequency="0.85 0.85" numOctaves="3" seed="8" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.4 0" /></filter>
        <linearGradient id="woodBevel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,220,170,.28)" /><stop offset="0.12" stopColor="rgba(255,220,170,0)" />
          <stop offset="0.85" stopColor="rgba(0,0,0,0)" /><stop offset="1" stopColor="rgba(0,0,0,.45)" /></linearGradient>
        <radialGradient id="felt" cx="0.5" cy="0.42" r="0.85"><stop offset="0" stopColor="#1c4535" /><stop offset="0.7" stopColor="#143528" /><stop offset="1" stopColor="#0c241b" /></radialGradient>
        <radialGradient id="vign" cx="0.5" cy="0.45" r="0.75"><stop offset="0.55" stopColor="rgba(0,0,0,0)" /><stop offset="1" stopColor="rgba(0,0,0,.5)" /></radialGradient>
        <linearGradient id="bone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#efe4c9" /><stop offset="1" stopColor="#cdb98f" /></linearGradient>
        <linearGradient id="ox" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8a332c" /><stop offset="1" stopColor="#571c18" /></linearGradient>
        <radialGradient id="discW" cx="0.34" cy="0.30" r="0.78"><stop offset="0" stopColor="#faf3e3" /><stop offset="0.55" stopColor="#e6d8bb" /><stop offset="1" stopColor="#c3ac7f" /></radialGradient>
        <radialGradient id="faceW" cx="0.5" cy="0.42" r="0.6"><stop offset="0" stopColor="#f2e8d1" /><stop offset="1" stopColor="#d9c8a2" /></radialGradient>
        <radialGradient id="discB" cx="0.34" cy="0.30" r="0.82"><stop offset="0" stopColor="#4f4132" /><stop offset="0.5" stopColor="#2c2217" /><stop offset="1" stopColor="#120c06" /></radialGradient>
        <radialGradient id="faceB" cx="0.5" cy="0.42" r="0.6"><stop offset="0" stopColor="#2e2418" /><stop offset="1" stopColor="#161009" /></radialGradient>
        <radialGradient id="contact" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="rgba(0,0,0,.45)" /><stop offset="1" stopColor="rgba(0,0,0,0)" /></radialGradient>
      </defs>

      <rect x="0" y="0" width={VB_W} height={VB_H} rx="18" filter="url(#wood)" />
      <rect x="0" y="0" width={VB_W} height={VB_H} rx="18" fill="url(#woodBevel)" />
      <rect x={FRAME - 8} y={FRAME - 8} width={VB_W - 2 * (FRAME - 8)} height={VB_H - 2 * (FRAME - 8)} rx="8" fill="#0b0703" />

      <rect x={fieldX0} y={surfY0} width={leftG1 - fieldX0} height={surfY1 - surfY0} fill="url(#felt)" />
      <rect x={barX1} y={surfY0} width={rightG1 - barX1} height={surfY1 - surfY0} fill="url(#felt)" />
      <rect x={fieldX0} y={surfY0} width={leftG1 - fieldX0} height={surfY1 - surfY0} fill="#0e2a20" filter="url(#feltTex)" opacity="0.32" />
      <rect x={barX1} y={surfY0} width={rightG1 - barX1} height={surfY1 - surfY0} fill="#0e2a20" filter="url(#feltTex)" opacity="0.32" />

      {pts}

      <rect x={barX0} y={surfY0} width={BAR_W} height={surfY1 - surfY0} filter="url(#wood)" style={{ filter: barHL ? "drop-shadow(0 0 9px #e6c884)" : undefined }} />
      <rect x={barX0} y={surfY0} width={BAR_W} height={surfY1 - surfY0} fill="url(#woodBevel)" />
      <rect x={barX0} y={surfY0} width="3" height={surfY1 - surfY0} fill="rgba(0,0,0,.5)" />
      <rect x={barX1 - 3} y={surfY0} width="3" height={surfY1 - surfY0} fill="rgba(0,0,0,.5)" />

      <rect x={trayX0} y={surfY0} width={TRAY_W} height={surfY1 - surfY0} fill="#0b0703" stroke="#1c120a" strokeWidth="2" rx="4" />
      <rect x={trayX0 + 4} y={surfY0 + 4} width={TRAY_W - 8} height={surfY1 - surfY0 - 8} fill="none" stroke="rgba(0,0,0,.6)" strokeWidth="6" rx="3" />

      <rect x={fieldX0} y={surfY0} width={fieldX1 - fieldX0} height={surfY1 - surfY0} fill="url(#vign)" pointerEvents="none" />

      {stacks}{barW}{barB}{offW}{offB}

      <g ref={flyerRef} style={{ opacity: 0 }}><Checker cx={0} cy={0} isW={flyerW} /></g>
    </svg>
  );
}

/* ============================ DICE (3D) ============================ */
const PIP_MAP = {
  1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};
const FACES = [
  { v: 1, t: "rotateY(0deg) translateZ(23px)" }, { v: 6, t: "rotateY(180deg) translateZ(23px)" },
  { v: 3, t: "rotateY(90deg) translateZ(23px)" }, { v: 4, t: "rotateY(-90deg) translateZ(23px)" },
  { v: 2, t: "rotateX(90deg) translateZ(23px)" }, { v: 5, t: "rotateX(-90deg) translateZ(23px)" },
];
const SHOW = { 1: { x: 0, y: 0 }, 2: { x: -90, y: 0 }, 3: { x: 0, y: -90 }, 4: { x: 0, y: 90 }, 5: { x: 90, y: 0 }, 6: { x: 0, y: 180 } };
function Dice3D({ value, black }) {
  const [rot, setRot] = useState({ x: -24, y: 18 });
  const spins = useRef(0);
  useEffect(() => {
    if (!value) return;
    spins.current += 1;
    const b = SHOW[value];
    setRot({ x: b.x + 360 * spins.current, y: b.y + 360 * spins.current });
  }, [value]);
  return (
    <div className="dieScene">
      <div className="cube3d" style={{ transform: `translateZ(-23px) rotateX(${rot.x}deg) rotateY(${rot.y}deg)` }}>
        {FACES.map((f) => (
          <div key={f.v} className={"face3d" + (black ? " blk" : "")} style={{ transform: f.t }}>
            {(PIP_MAP[f.v] || []).map(([x, y], i) => <span key={i} className="pip3d" style={{ left: x + "%", top: y + "%" }} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================ REASONING ============================ */
function TypeReason({ text, empty, speed }) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    if (!text) { setShown(""); return; }
    let i = 0; setShown("");
    const per = speed === "fast" ? 8 : speed === "slow" ? 26 : 15;
    const id = setInterval(() => { i++; setShown(text.slice(0, i)); if (i >= text.length) clearInterval(id); }, per);
    return () => clearInterval(id);
  }, [text, speed]);
  if (!text) return <div className="reason empty">{empty}</div>;
  const done = shown.length >= text.length;
  return <div className="reason">{shown}{!done && <span className="caret" />}</div>;
}

/* ============================ PANEL ============================ */
function Panel({ side, model, setModel, board, dice, isTurn, thinking, reasoning, disabled, speed }) {
  const isW = side === "W";
  const meta = MODELS.find((m) => m.id === model) || MODELS[0];
  const chip = isW
    ? { background: "radial-gradient(circle at 35% 30%, #faf3e3, #c3ac7f)", border: "1px solid #b39a6c" }
    : { background: "radial-gradient(circle at 35% 30%, #4f4132, #120c06)", border: "1px solid #000" };
  return (
    <div className={`card${isTurn ? " active" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="side-tag">{isW ? "Ivory" : "Ebony"}</span>
        <span className={`turnpill${isTurn ? " show" : ""}`}>to move</span>
      </div>
      <div className="pname"><span className="pcheck" style={chip} />{meta.name}</div>
      <div className="selrow">
        <label>Model</label>
        <select className="sel" value={model} disabled={disabled} onChange={(e) => setModel(e.target.value)}>
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <div className="persona-desc">{meta.tier}</div>
      </div>
      <div className="statrow">
        <div className="stat"><div className="k">Pip count</div><div className="v">{pipCount(board, side)}</div></div>
        <div className="stat"><div className="k">Borne off</div><div className="v">{board.off[side]}<span style={{ fontSize: 15, color: "var(--ink-faint)" }}>/15</span></div></div>
      </div>
      <div className="dice-tray">
        {dice ? dice.map((d, i) => <Dice3D key={i} value={d} black={!isW} />) : <span className="dielabel">awaiting roll</span>}
      </div>
      <div className="think">
        <div className="lbl"><span className={`dot${thinking ? " pulse" : ""}`} />{thinking ? "Thinking" : "Last thought"}</div>
        <TypeReason text={reasoning} empty="Waiting for the dice…" speed={speed} />
      </div>
    </div>
  );
}

/* ============================ MAIN ============================ */
export default function App() {
  const [board, setBoard] = useState(initialBoard);
  const [turn, setTurn] = useState("W");
  const [dice, setDice] = useState({ W: null, B: null });
  const [phase, setPhase] = useState("idle");
  const [running, setRunning] = useState(false);
  const [models, setModels] = useState({ W: "claude-opus-4-8", B: "claude-sonnet-5" });
  const [reason, setReason] = useState({ W: "", B: "" });
  const [thinkingSide, setThinkingSide] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const [log, setLog] = useState([]);
  const [win, setWin] = useState(null);
  const [speed, setSpeed] = useState("fast");
  const [thinking, setThinking] = useState(false);
  const [flyerW, setFlyerW] = useState(true);

  const boardRef = useRef(board), turnRef = useRef(turn), runningRef = useRef(false);
  const modelsRef = useRef(models), speedRef = useRef(speed), runId = useRef(0), moveNo = useRef(0);
  const thinkingRef = useRef(thinking);
  const flyerRef = useRef(null);

  useEffect(() => { modelsRef.current = models; }, [models]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { thinkingRef.current = thinking; }, [thinking]);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const timings = () => {
    const s = speedRef.current;
    return s === "fast" ? { roll: 320, gap: 160, step: 300, read: 450 }
      : s === "slow" ? { roll: 850, gap: 650, step: 780, read: 1350 }
      : { roll: 520, gap: 340, step: 520, read: 800 };
  };

  const resetGame = useCallback(() => {
    runId.current++; runningRef.current = false; setRunning(false);
    const b = initialBoard();
    boardRef.current = b; turnRef.current = "W"; moveNo.current = 0;
    setBoard(b); setTurn("W"); setDice({ W: null, B: null }); setReason({ W: "", B: "" });
    setThinkingSide(null); setHighlight(null); setLog([]); setWin(null); setPhase("idle");
  }, []);

  function fly(el, from, to, dur) {
    const mx = (from.x + to.x) / 2;
    const my = Math.min(from.y, to.y) - Math.abs(to.x - from.x) * 0.1 - 34;
    if (!el.animate) { el.style.transform = `translate(${to.x}px,${to.y}px)`; return sleep(dur); }
    const a = el.animate([
      { transform: `translate(${from.x}px,${from.y}px) scale(1)`, offset: 0 },
      { transform: `translate(${mx}px,${my}px) scale(1.08)`, offset: 0.5 },
      { transform: `translate(${to.x}px,${to.y}px) scale(1)`, offset: 1 },
    ], { duration: dur, easing: "cubic-bezier(.38,.05,.3,1)", fill: "forwards" });
    return a.finished.catch(() => {});
  }

  async function runTurn(myId) {
    const pl = turnRef.current, t = timings();
    setPhase("rolling"); setThinkingSide(null); setHighlight(null);
    const d = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
    const end = Date.now() + t.roll;
    while (Date.now() < end) {
      setDice((prev) => ({ ...prev, [pl]: [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)] }));
      await sleep(80); if (runId.current !== myId) return;
    }
    setDice((prev) => ({ ...prev, [pl]: d }));
    await sleep(t.gap); if (runId.current !== myId) return;

    const plays = legalPlays(boardRef.current, pl, d);
    let chosen, reasoning;
    if (plays.length === 1 && plays[0].moves.length === 0) { chosen = plays[0]; reasoning = "No legal move with this roll - the turn passes."; }
    else if (plays.length === 1) { chosen = plays[0]; reasoning = "Only one legal play here - it makes itself."; }
    else {
      setPhase("thinking"); setThinkingSide(pl); setReason((r) => ({ ...r, [pl]: "" }));
      const res = await askModel(boardRef.current, pl, d, plays, modelsRef.current[pl], thinkingRef.current);
      if (runId.current !== myId) return;
      chosen = plays[res.choice]; reasoning = res.reasoning;
    }
    setThinkingSide(null); setReason((r) => ({ ...r, [pl]: reasoning }));
    await sleep(t.read); if (runId.current !== myId) return;

    setPhase("animating");
    let pre = boardRef.current;
    for (const mv of chosen.moves) {
      const post = applyMove(pre, mv, pl);
      let from;
      if (mv.from === "bar") from = { x: barCx, y: barStackY(pl, Math.min(pre.bar[pl] - 1, 4)) };
      else { const i = Math.abs(pre.points[mv.from]) - 1; from = { x: pointGeom(mv.from).x, y: checkerY(mv.from, Math.min(i, 4)) }; }
      let to;
      if (mv.to === "off") to = offCoords(pl, post.off[pl] - 1);
      else { const i = Math.abs(post.points[mv.to]) - 1; to = { x: pointGeom(mv.to).x, y: checkerY(mv.to, Math.min(i, 4)) }; }

      const inter = cloneBoard(pre);
      if (mv.from === "bar") inter.bar[pl] -= 1; else inter.points[mv.from] -= sign(pl);
      boardRef.current = inter; setBoard(inter);
      setHighlight({ from: mv.from, to: mv.to === "off" ? null : mv.to });
      setFlyerW(pl === "W");
      await raf();
      const el = flyerRef.current;
      if (el) { el.style.opacity = "1"; el.style.transform = `translate(${from.x}px,${from.y}px)`; await raf(); await fly(el, from, to, t.step); el.style.opacity = "0"; }
      else { await sleep(t.step); }
      boardRef.current = post; setBoard(post); pre = post;
      if (runId.current !== myId) return;
      await sleep(t.step * 0.14);
    }
    setHighlight(null);
    moveNo.current += 1;
    setLog((L) => [...L, { n: moveNo.current, color: pl, mv: notation(chosen.moves), dice: `${d[0]}-${d[1]}` }].slice(-60));

    const w = winner(boardRef.current);
    if (w) { setWin(w); setPhase("over"); runningRef.current = false; setRunning(false); return; }
    turnRef.current = opp(pl); setTurn(opp(pl));
  }

  async function gameLoop(myId) {
    while (runningRef.current && runId.current === myId && !winner(boardRef.current)) await runTurn(myId);
  }
  const start = () => { if (win) resetGame(); const id = ++runId.current; runningRef.current = true; setRunning(true); gameLoop(id); };
  const pause = () => { runningRef.current = false; setRunning(false); };
  const step = async () => { if (running || win) return; const id = ++runId.current; await runTurn(id); };

  const busy = running || phase === "thinking" || phase === "animating" || phase === "rolling";
  const winName = win ? MODEL_NAME(models[win]) : "";
  const gammon = win && board.off[opp(win)] === 0;

  return (
    <div className="tb-root">
      <style>{CSS}</style>
      <div className="wrap">
        <div className="topbar">
          <div className="brand">
            <h1>TABULA</h1>
            <span className="sub">an arena where two minds meet over the oldest game</span>
          </div>
          <div className="controls">
            <div className="speed" role="group" aria-label="Speed">
              {["slow", "normal", "fast"].map((s) => <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}
            </div>
            <button className={`btn${thinking ? " primary" : ""}`} onClick={() => setThinking((t) => !t)} aria-pressed={thinking} title={thinking ? "Extended thinking on - deeper play, slower moves" : "Extended thinking off - fast moves"}><Brain size={16} />Thinking</button>
            <button className="btn" onClick={step} disabled={busy || !!win}><SkipForward size={16} />Step</button>
            {running
              ? <button className="btn" onClick={pause}><Pause size={16} />Pause</button>
              : <button className="btn primary" onClick={start}>{win ? <><RotateCcw size={16} />Rematch</> : <><Play size={16} />{phase === "idle" ? "Start match" : "Resume"}</>}</button>}
            <button className="btn" onClick={resetGame}><RotateCcw size={16} />New game</button>
          </div>
        </div>

        {win && <div className="banner"><Trophy size={22} />{winName} wins{gammon ? " a gammon" : ""} · {win === "W" ? "Ivory" : "Ebony"}</div>}

        <div className="grid">
          <Panel side="W" model={models.W} setModel={(v) => setModels((p) => ({ ...p, W: v }))} board={board} dice={dice.W} isTurn={turn === "W" && !win} thinking={thinkingSide === "W"} reasoning={reason.W} disabled={busy} speed={speed} />
          <div className="boardwrap"><Board board={board} highlight={highlight} flyerRef={flyerRef} flyerW={flyerW} /></div>
          <Panel side="B" model={models.B} setModel={(v) => setModels((p) => ({ ...p, B: v }))} board={board} dice={dice.B} isTurn={turn === "B" && !win} thinking={thinkingSide === "B"} reasoning={reason.B} disabled={busy} speed={speed} />
        </div>

        <div className="log">
          <h3>Move history</h3>
          <div className="logscroll" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
            {log.length === 0
              ? <div style={{ padding: "18px 12px", color: "var(--ink-faint)", fontStyle: "italic", fontFamily: "'Fraunces',serif" }}>Press Start to watch the two models play. Every move is a real, legal backgammon play chosen by the selected model.</div>
              : log.map((row) => (
                <div className="logrow" key={row.n}>
                  <span className="n">{row.n}.</span>
                  <span className="chip" style={row.color === "W" ? { background: "radial-gradient(circle at 35% 30%, #faf3e3, #c3ac7f)" } : { background: "radial-gradient(circle at 35% 30%, #4f4132, #120c06)" }} />
                  <span className="mv">{row.mv}</span>
                  <span className="dc">{row.dice}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
