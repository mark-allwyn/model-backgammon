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

async function askModel({ model, system, user, thinking }) {
  const think = !!thinking;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), think ? THINK_TIMEOUT_MS : MOVE_TIMEOUT_MS);
  let text = "";
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
      if (msg.type === "result" && msg.subtype === "success") text = msg.result;
    }
  } finally {
    clearTimeout(timer);
  }
  if (!text) throw new Error("empty or timed-out response from model");
  return text;
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
  if (req.method === "POST" && req.url === "/api/move") {
    try {
      const { model, system, user, thinking } = JSON.parse((await readBody(req)) || "{}");
      if (!model || !system || !user) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "model, system and user are required" }));
        return;
      }
      const text = await askModel({ model, system, user, thinking });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
    }
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
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
