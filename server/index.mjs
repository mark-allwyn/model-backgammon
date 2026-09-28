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

// The UI sends model ids that match the Anthropic API; map any that the
// Agent SDK / Claude Code names differently (e.g. dated snapshots -> alias).
const MODEL_MAP = {
  "claude-opus-4-8": "claude-opus-4-8",
  "claude-sonnet-5": "claude-sonnet-5",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
};
const resolveModel = (id) => MODEL_MAP[id] || id;

async function askModel({ model, system, user }) {
  let text = "";
  for await (const msg of query({
    prompt: user,
    options: {
      model: resolveModel(model),
      systemPrompt: system, // a plain string replaces the default Claude Code prompt
      allowedTools: [], // pure reasoning task - no file/bash/web tools
      maxTurns: 1,
      settingSources: [], // don't load project/user CLAUDE.md into a game move
    },
  })) {
    if (msg.type === "result" && msg.subtype === "success") text = msg.result;
  }
  if (!text) throw new Error("empty response from model");
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
      const { model, system, user } = JSON.parse((await readBody(req)) || "{}");
      if (!model || !system || !user) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "model, system and user are required" }));
        return;
      }
      const text = await askModel({ model, system, user });
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
